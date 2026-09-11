// hoteles/tests/settings-persistence.test.ts — Panel → Configuración: lo que se guarda es lo
// que se vuelve a leer (#80, CA112-113: teléfono, tipo de alojamiento, clasificación, Wi-Fi,
// propietario y automatizaciones).
//
// Round-trip contra `HotelesQueries`, el write/read path real de la pantalla:
//   PUT /api/hoteles/:id          → updateHotel(id, body)   → getSettings(id).hotel
//   POST /api/configuracion       → setConfig(body, user)   → getConfig(hotelId, key)
// El fake del orm hace UPDATE parcial (merge del patch sobre la fila), igual que el adaptador
// real: así un test de "update parcial no pisa lo demás" prueba lo que hace el usecase y no el
// fake. El adaptador real descarta columnas que no existen en el modelo; acá el fake acepta
// todo, y lo que se verifica es que el allowlist de updateHotel deja pasar los campos del
// issue y frena los ajenos.

import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter } from 'arckode-framework'
import { HotelesQueries } from '../usecases/hoteles-queries'

const MERCHANT = { id: 'u-adm', hotelId: 'h1', role: 'hotel_admin' }
const SUPER_CON_HOTEL = { id: 'u-super', hotelId: 'h1', role: 'super_admin' }

/** Fake del orm en memoria: Hotels (findById + update con merge) y Configuration (findMany/update/create). */
function fakeRepo(hotels: any[] = [], configs: any[] = []) {
  const updates: { model: string; id: string; patch: any }[] = []
  const creates: any[] = []
  const table = (model: string) => (model === 'Hotels' ? hotels : model === 'Configuration' ? configs : [])
  const orm = {
    findById: async (model: string, id: string) => {
      const row = table(model).find((r) => r.id === id)
      return row ? { ...row } : null
    },
    findMany: async (model: string, filter: any = {}) =>
      table(model).filter((r) => Object.entries(filter).every(([k, v]) => r[k] === v)),
    update: async (model: string, id: string, patch: any) => {
      updates.push({ model, id, patch })
      const row = table(model).find((r) => r.id === id)
      if (row) Object.assign(row, patch)
    },
    create: async (model: string, data: any) => { creates.push(data); table(model).push(data) },
  } as unknown as RepositoryAdapter<any>
  return { orm, updates, creates, hotels, configs }
}

function hotelRow(over: Record<string, any> = {}) {
  return {
    id: 'h1', name: 'Hotel Prueba', country: 'AR', email: 'hotel@prueba.test',
    phone: '', phone2: '', accommodationType: 'hotel', starRating: '',
    wifiNetwork: '', wifiPassword: '', ownerName: '', ownerTaxId: '',
    freeCancellation: false, cancellationType: 'flexible',
    ...over,
  }
}

/** Campos del issue con el valor exactamente como lo manda el frontend (starRating es string). */
const CAMPOS_ISSUE: Record<string, string> = {
  phone: '+54 11 4000-0001',
  phone2: '+54 11 4000-0002',
  accommodationType: 'villa',
  starRating: '3',
  wifiNetwork: 'SolmiosGuest',
  wifiPassword: 'clave-wifi-2026',
  ownerName: 'María Pérez',
  ownerTaxId: '20-12345678-9',
}

describe('HotelesQueries — round-trip updateHotel → getSettings (#80 CA112-113)', () => {
  it('cada campo del issue vuelve con el mismo valor al releer, y la recarga post-write ya lo trae', async () => {
    const repo = fakeRepo([hotelRow()])
    const queries = new HotelesQueries(repo.orm)
    const devuelto = await queries.updateHotel('h1', { ...CAMPOS_ISSUE })
    const { hotel } = await queries.getSettings('h1')
    for (const [k, v] of Object.entries(CAMPOS_ISSUE)) {
      expect(devuelto[k]).toBe(v)
      expect(hotel[k]).toBe(v)
    }
    // starRating se persiste como string, tal cual lo manda el <select> del frontend.
    expect(typeof hotel.starRating).toBe('string')
    expect(repo.updates.length).toBe(1)
    expect(repo.updates[0].model).toBe('Hotels')
  })

  it('campo por campo: un PUT con un solo campo del issue lo persiste y getSettings lo devuelve', async () => {
    for (const [k, v] of Object.entries(CAMPOS_ISSUE)) {
      const repo = fakeRepo([hotelRow()])
      const queries = new HotelesQueries(repo.orm)
      await queries.updateHotel('h1', { [k]: v })
      expect(repo.updates[0].patch).toEqual({ [k]: v })
      const { hotel } = await queries.getSettings('h1')
      expect(hotel[k]).toBe(v)
    }
  })

  it('update parcial (sólo wifiNetwork) NO pisa phone2 ni ownerName ya guardados', async () => {
    const repo = fakeRepo([hotelRow({ phone2: '+54 11 4000-0002', ownerName: 'María Pérez', wifiPassword: 'vieja' })])
    const queries = new HotelesQueries(repo.orm)
    await queries.updateHotel('h1', { wifiNetwork: 'SolmiosGuest' })
    // El patch que llega al orm lleva SÓLO lo que vino en el body.
    expect(repo.updates[0].patch).toEqual({ wifiNetwork: 'SolmiosGuest' })
    const { hotel } = await queries.getSettings('h1')
    expect(hotel.wifiNetwork).toBe('SolmiosGuest')
    expect(hotel.phone2).toBe('+54 11 4000-0002')
    expect(hotel.ownerName).toBe('María Pérez')
    expect(hotel.wifiPassword).toBe('vieja')
  })

  it('valores vacíos se persisten tal cual: starRating "" (N/A) y email "" limpian el valor anterior', async () => {
    const repo = fakeRepo([hotelRow({ starRating: '4', email: 'viejo@prueba.test', phone2: '111' })])
    const queries = new HotelesQueries(repo.orm)
    await queries.updateHotel('h1', { starRating: '', email: '', phone2: '' })
    expect(repo.updates[0].patch).toEqual({ starRating: '', email: '', phone2: '' })
    const { hotel } = await queries.getSettings('h1')
    expect(hotel.starRating).toBe('')
    expect(hotel.email).toBe('')
    expect(hotel.phone2).toBe('')
  })

  it('undefined en el body no toca el campo (patchHotel del frontend descarta undefined; el backend también)', async () => {
    const repo = fakeRepo([hotelRow({ starRating: '4' })])
    const queries = new HotelesQueries(repo.orm)
    await queries.updateHotel('h1', { starRating: undefined, phone: '+1 555' })
    expect(repo.updates[0].patch).toEqual({ phone: '+1 555' })
    const { hotel } = await queries.getSettings('h1')
    expect(hotel.starRating).toBe('4')
  })

  it('campos fuera del allowlist (id, plan_secret, hotelId) no llegan al update', async () => {
    const repo = fakeRepo([hotelRow()])
    const queries = new HotelesQueries(repo.orm)
    await queries.updateHotel('h1', { id: 'h-otro', plan_secret: 'x', hotelId: 'h2', phone: '+1 555' })
    expect(repo.updates.length).toBe(1)
    expect(repo.updates[0].patch).toEqual({ phone: '+1 555' })
    const { hotel } = await queries.getSettings('h1')
    expect(hotel.id).toBe('h1')
    expect(hotel.plan_secret).toBeUndefined()
  })

  it('getSettings devuelve wifiPassword y ownerTaxId (la pantalla de Configuración los recarga; sólo /api/hoteles/:id los oculta)', async () => {
    const repo = fakeRepo([hotelRow()])
    const queries = new HotelesQueries(repo.orm)
    await queries.updateHotel('h1', { wifiNetwork: 'SolmiosGuest', wifiPassword: 'clave-wifi-2026', ownerTaxId: '20-12345678-9' })
    const { hotel, baseRates } = await queries.getSettings('h1')
    expect(hotel.wifiPassword).toBe('clave-wifi-2026')
    expect(hotel.ownerTaxId).toBe('20-12345678-9')
    expect(baseRates).toEqual([])
  })

  it('con auth+user: hotel_admin del hotel y super_admin pasan por assertOwnership y persisten igual', async () => {
    const owned: any[] = []
    const auth = { assertOwnership: (hotelId: string, userHotelId: string, role: string, bypass: string) => { owned.push({ hotelId, userHotelId, role, bypass }) } }
    for (const user of [MERCHANT, SUPER_CON_HOTEL]) {
      const repo = fakeRepo([hotelRow()])
      const queries = new HotelesQueries(repo.orm)
      await queries.updateHotel('h1', { phone: '+1 555' }, auth, user)
      const { hotel } = await queries.getSettings('h1', auth, user)
      expect(hotel.phone).toBe('+1 555')
    }
    // updateHotel + getSettings por cada usuario → 4 chequeos de ownership, todos sobre h1.
    expect(owned.length).toBe(4)
    expect(owned.every((o) => o.hotelId === 'h1' && o.userHotelId === 'h1' && o.bypass === 'super_admin')).toBe(true)
  })
})

describe('HotelesQueries — round-trip setConfig → getConfig automation_config (#80 CA112-113)', () => {
  const AUTOMATION_A = { autoLockCode: false, autoPaymentRequest: true }
  const AUTOMATION_B = { autoLockCode: true, autoPaymentRequest: false }

  it('hotel_admin: setConfig guarda la fila del hotel y getConfig devuelve el objeto deep-equal', async () => {
    const repo = fakeRepo()
    const queries = new HotelesQueries(repo.orm)
    const result = await queries.setConfig({ clave: 'automation_config', valor: AUTOMATION_A }, MERCHANT)
    expect(result.success).toBe(true)
    expect(repo.creates.length).toBe(1)
    expect(repo.creates[0]).toMatchObject({ hotelId: 'h1', key: 'automation_config' })
    const leido = await queries.getConfig('h1', 'automation_config')
    expect(leido.valor).toEqual(AUTOMATION_A)
  })

  it('segundo setConfig con otro valor: actualiza la misma fila (no duplica) y getConfig devuelve el nuevo', async () => {
    const repo = fakeRepo()
    const queries = new HotelesQueries(repo.orm)
    await queries.setConfig({ clave: 'automation_config', valor: AUTOMATION_A }, MERCHANT)
    await queries.setConfig({ clave: 'automation_config', valor: AUTOMATION_B }, MERCHANT)
    expect(repo.creates.length).toBe(1)
    expect(repo.updates.length).toBe(1)
    expect(repo.updates[0].id).toBe(repo.creates[0].id)
    expect(repo.configs.filter((r) => r.hotelId === 'h1' && r.key === 'automation_config').length).toBe(1)
    const leido = await queries.getConfig('h1', 'automation_config')
    expect(leido.valor).toEqual(AUTOMATION_B)
  })

  it('super_admin con hotel en el token (impersonando): mismo round-trip sobre la fila del hotel, sin tocar platform', async () => {
    const platformDefault = { id: 'cfg-p', hotelId: 'platform', key: 'automation_config', value: JSON.stringify({ autoLockCode: true, autoPaymentRequest: true }) }
    const repo = fakeRepo([], [platformDefault])
    const queries = new HotelesQueries(repo.orm)
    await queries.setConfig({ clave: 'automation_config', valor: AUTOMATION_A }, SUPER_CON_HOTEL)
    expect(repo.creates.length).toBe(1)
    expect(repo.creates[0].hotelId).toBe('h1')
    expect(JSON.parse(platformDefault.value)).toEqual({ autoLockCode: true, autoPaymentRequest: true })
    const leido = await queries.getConfig('h1', 'automation_config')
    expect(leido.valor).toEqual(AUTOMATION_A)
  })

  it('sin fila del hotel: getConfig cae al default de platform; tras setConfig gana la fila del hotel', async () => {
    const platformDefault = { id: 'cfg-p', hotelId: 'platform', key: 'automation_config', value: JSON.stringify(AUTOMATION_B) }
    const repo = fakeRepo([], [platformDefault])
    const queries = new HotelesQueries(repo.orm)
    expect((await queries.getConfig('h1', 'automation_config')).valor).toEqual(AUTOMATION_B)
    await queries.setConfig({ clave: 'automation_config', valor: AUTOMATION_A }, MERCHANT)
    expect((await queries.getConfig('h1', 'automation_config')).valor).toEqual(AUTOMATION_A)
  })
})
