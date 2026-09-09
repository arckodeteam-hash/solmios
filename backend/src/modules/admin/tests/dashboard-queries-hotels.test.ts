// dashboard-queries-hotels.test.ts — Listado de hoteles del super-admin (GET /api/admin/hoteles).
//
// Lo que se prueba acá es el `ownerUserId`: el usuario al que impersona el botón "Entrar" de
// `/admin/hotels`. La impersonación es contra un USUARIO, nunca contra un hotel, así que si esta
// resolución elige mal, el admin entra a la cuenta equivocada (o a ninguna).
import { describe, it, expect, vi, beforeEach } from 'bun:test'
import { DashboardQueries } from '../usecases/dashboard-queries'

const HOTELS = [
  { id: 'h1', name: 'Hotel Caribe' },   // tiene hotel_admin + recepcionista
  { id: 'h2', name: 'Hotel Sol' },      // solo recepcionista
  { id: 'h3', name: 'Hotel Luna' },     // solo un usuario inactivo
  { id: 'h4', name: 'Hotel Vacio' },    // sin usuarios
]

const USERS = [
  // h1: dos candidatos; gana el hotel_admin aunque el otro venga primero en la lista.
  { id: 'u-recep', name: 'Rosa', role: 'receptionist', hotelId: 'h1', active: 1 },
  { id: 'u-admin', name: 'Ana', role: 'hotel_admin', hotelId: 'h1', active: 1 },
  // h2: no hay hotel_admin → cae al que haya.
  { id: 'u-sol', name: 'Carlos', role: 'receptionist', hotelId: 'h2', active: 1 },
  // h3: el único está inactivo → no se puede entrar.
  { id: 'u-luna', name: 'Luis', role: 'hotel_admin', hotelId: 'h3', active: 0 },
  // Un super_admin de plataforma: nunca es owner de nadie (impersonateUser lo rechaza con 403).
  { id: 'u-root', name: 'Root', role: 'super_admin', hotelId: null, active: 1 },
]

function makeOrm(users: any[] = USERS, hotels: any[] = HOTELS) {
  return {
    findMany: vi.fn(async (table: string) => {
      if (table === 'Hotels') return hotels.map((h) => ({ ...h }))
      if (table === 'Users') return users.map((u) => ({ ...u }))
      return []
    }),
  }
}

describe('DashboardQueries.listHotels — owner para impersonar', () => {
  let orm: any
  beforeEach(() => { orm = makeOrm() })

  it('elige el hotel_admin activo aunque no sea el primero de la lista', async () => {
    const { data } = await new DashboardQueries(orm).listHotels()
    const h1 = data.find((h: any) => h.id === 'h1')
    expect(h1.ownerUserId).toBe('u-admin')
    expect(h1.ownerName).toBe('Ana')
    expect(h1.ownerRole).toBe('hotel_admin')
  })

  it('sin hotel_admin, cae a otro usuario activo del hotel (entrar como recepcionista > no entrar)', async () => {
    const { data } = await new DashboardQueries(orm).listHotels()
    const h2 = data.find((h: any) => h.id === 'h2')
    expect(h2.ownerUserId).toBe('u-sol')
    expect(h2.ownerRole).toBe('receptionist')
  })

  it('ignora usuarios inactivos: sin candidatos, ownerUserId es null (el botón se deshabilita)', async () => {
    const { data } = await new DashboardQueries(orm).listHotels()
    const h3 = data.find((h: any) => h.id === 'h3')
    expect(h3.ownerUserId).toBeNull()
    expect(h3.ownerName).toBe('')
  })

  it('un hotel sin usuarios queda con ownerUserId null', async () => {
    const { data } = await new DashboardQueries(orm).listHotels()
    const h4 = data.find((h: any) => h.id === 'h4')
    expect(h4.ownerUserId).toBeNull()
  })

  it('NUNCA elige un super_admin: impersonarlo devuelve 403, sería un botón que falla al clickearlo', async () => {
    // Un super_admin con hotelId (caso raro pero posible: el dueño de la plataforma asignado a un hotel).
    const users = [{ id: 'u-root2', name: 'Root', role: 'super_admin', hotelId: 'h4', active: 1 }]
    const { data } = await new DashboardQueries(makeOrm(users)).listHotels()
    const h4 = data.find((h: any) => h.id === 'h4')
    expect(h4.ownerUserId).toBeNull()
  })

  it('acepta active como booleano (true/false), no solo 1/0', async () => {
    const users = [
      { id: 'u-a', name: 'Ana', role: 'hotel_admin', hotelId: 'h1', active: false },
      { id: 'u-b', name: 'Beto', role: 'receptionist', hotelId: 'h1', active: true },
    ]
    const { data } = await new DashboardQueries(makeOrm(users)).listHotels()
    expect(data.find((h: any) => h.id === 'h1').ownerUserId).toBe('u-b')
  })

  it('una fila sin la columna active se considera activa (no se pierde el botón por datos viejos)', async () => {
    const users = [{ id: 'u-viejo', name: 'Vieja', role: 'hotel_admin', hotelId: 'h1' }]
    const { data } = await new DashboardQueries(makeOrm(users)).listHotels()
    expect(data.find((h: any) => h.id === 'h1').ownerUserId).toBe('u-viejo')
  })

  it('con dos hotel_admin el elegido es SIEMPRE el mismo (desempate estable por id)', async () => {
    const users = [
      { id: 'u-zzz', name: 'Zoe', role: 'hotel_admin', hotelId: 'h1', active: 1 },
      { id: 'u-aaa', name: 'Ana', role: 'hotel_admin', hotelId: 'h1', active: 1 },
    ]
    const primera = await new DashboardQueries(makeOrm(users)).listHotels()
    // La base puede devolver las filas en otro orden en el request siguiente: el resultado no cambia.
    const segunda = await new DashboardQueries(makeOrm([...users].reverse())).listHotels()
    expect(primera.data.find((h: any) => h.id === 'h1').ownerUserId).toBe('u-aaa')
    expect(segunda.data.find((h: any) => h.id === 'h1').ownerUserId).toBe('u-aaa')
  })

  it('conserva los campos del hotel y el total', async () => {
    const { data, total } = await new DashboardQueries(orm).listHotels()
    expect(total).toBe(HOTELS.length)
    expect(data[0]).toMatchObject({ id: 'h1', name: 'Hotel Caribe' })
  })

  it('consulta cada tabla UNA sola vez (sin N+1 por hotel)', async () => {
    await new DashboardQueries(orm).listHotels()
    const tables = orm.findMany.mock.calls.map((c: any[]) => c[0])
    expect(tables.filter((t: string) => t === 'Hotels')).toHaveLength(1)
    expect(tables.filter((t: string) => t === 'Users')).toHaveLength(1)
    expect(orm.findMany).toHaveBeenCalledTimes(2)
  })
})
