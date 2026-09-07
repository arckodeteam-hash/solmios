// dashboard-queries-users.test.ts — Listado de usuarios del super-admin (GET /api/admin/users).
import { describe, it, expect, vi, beforeEach } from 'bun:test'
import { DashboardQueries } from '../usecases/dashboard-queries'

const USERS = [
  { id: 'u1', name: 'Ana', email: 'ana@hotel.com', role: 'hotel_admin', hotelId: 'h1', password: 'hash', token: 'jwt', resetToken: 'reset-abc', resetExpires: 123, pinHash: '$2b$10$hashdelpin', pinEnabled: 1, emailVerificationToken: 'sha256-del-token', emailVerificationExpires: 456 },
  { id: 'u2', name: 'Root', email: 'root@solmios.com', role: 'super_admin', password: 'hash' },
  { id: 'u3', name: 'Huerfano', email: 'huerfano@hotel.com', role: 'staff', hotelId: 'borrado' },
]
const HOTELS = [{ id: 'h1', name: 'Hotel Caribe' }, { id: 'h2', name: 'Hotel Sol' }]

describe('DashboardQueries.listUsers', () => {
  let orm: any

  beforeEach(() => {
    orm = {
      findMany: vi.fn(async (table: string) => {
        if (table === 'Users') return USERS.map((u) => ({ ...u }))
        if (table === 'Hotels') return HOTELS.map((h) => ({ ...h }))
        return []
      }),
    }
  })

  it('resuelve hotelName del hotel del usuario', async () => {
    const { data } = await new DashboardQueries(orm).listUsers()
    expect(data[0].hotelName).toBe('Hotel Caribe')
  })

  it('deja hotelName vacío para un usuario sin hotelId (el frontend muestra "Plataforma")', async () => {
    const { data } = await new DashboardQueries(orm).listUsers()
    expect(data[1].hotelName).toBe('')
  })

  it('no rompe si el hotelId ya no existe: hotelName vacío', async () => {
    const { data } = await new DashboardQueries(orm).listUsers()
    expect(data[2].hotelName).toBe('')
  })

  it('no expone password ni credenciales de sesión/recuperación', async () => {
    const { data } = await new DashboardQueries(orm).listUsers()
    for (const row of data) {
      expect(row).not.toHaveProperty('password')
      expect(row).not.toHaveProperty('token')
      // `resetToken` es el token de recuperación de contraseña: si viaja en la respuesta,
      // cualquiera que la lea puede resetear la clave y tomar la cuenta.
      expect(row).not.toHaveProperty('resetToken')
      expect(row).not.toHaveProperty('resetExpires')
      // `pinHash` es el hash del PIN de 6 dígitos con el que el staff entra desde el móvil
      // (staff-auth): 10^6 combinaciones se crackean offline en segundos.
      expect(row).not.toHaveProperty('pinHash')
      expect(row).not.toHaveProperty('emailVerificationToken')
      expect(row).not.toHaveProperty('emailVerificationExpires')
    }
  })

  it('conserva los campos visibles del listado', async () => {
    const { data } = await new DashboardQueries(orm).listUsers()
    expect(data[0]).toMatchObject({ id: 'u1', name: 'Ana', email: 'ana@hotel.com', role: 'hotel_admin', hotelId: 'h1' })
  })

  it('total es la cantidad de usuarios', async () => {
    const { data, total } = await new DashboardQueries(orm).listUsers()
    expect(total).toBe(USERS.length)
    expect(data).toHaveLength(USERS.length)
  })

  it('consulta cada tabla UNA sola vez (sin N+1 por usuario)', async () => {
    await new DashboardQueries(orm).listUsers()
    const tables = orm.findMany.mock.calls.map((c: any[]) => c[0])
    expect(tables.filter((t: string) => t === 'Users')).toHaveLength(1)
    expect(tables.filter((t: string) => t === 'Hotels')).toHaveLength(1)
    expect(orm.findMany).toHaveBeenCalledTimes(2)
  })
})
