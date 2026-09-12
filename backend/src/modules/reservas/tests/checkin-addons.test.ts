import { describe, it, expect } from 'bun:test'
import { ConflictError } from 'arckode-framework'
import { executeCheckin, checkinValidation } from '../usecases/checkin'
import { computeTotals } from '../../folios/usecases/folio-math'
import { buildAddonFolioCharges, addonChargesTotal, ADDON_CHARGE_REFERENCE_PREFIX } from '../../../shared/usecases/addon-folio-charges'

// #269 (MR-04): el huésped pagó online habitación 100 + transfer 30 + amenidad 10 con 18 % =
// 165.20. El check-in acreditaba el prepago entero contra un folio con SOLO la habitación (118):
// el tope de `capPrepaidLines` dejaba 47.20 "a favor" que no existía y el checkout facturaba una
// estadía sin los extras ya pagados. Ahora cada addon `booking_engine` entra como cargo `extra`
// antes del prepago y el folio cuadra a 0.

const TRANSFER = { id: 'ad-1', reservationId: 'res-1', hotelId: 'h1', kind: 'upsell', description: 'Transfer aeropuerto', quantity: 1, amount: 30, unitPrice: 30, taxRate: 18, source: 'booking_engine', status: 'pending' }
const AMENIDAD = { id: 'ad-2', reservationId: 'res-1', hotelId: 'h1', kind: 'room_amenity', description: 'Botella de vino', quantity: 1, amount: 10, unitPrice: 10, taxRate: 18, source: 'booking_engine', status: 'pending' }
const MANUAL = { id: 'ad-3', reservationId: 'res-1', hotelId: 'h1', kind: 'service', description: 'Lavandería', quantity: 1, amount: 25, source: 'manual', status: 'pending' }

function harness(opts: { payments?: any[]; addons?: any[]; reservations?: any[] } = {}) {
  const rooms = [{ id: 'room-1', hotelId: 'h1', number: '101', basePrice: 100, status: 'available' }]
  const reservations = opts.reservations ?? [{
    id: 'res-1', hotelId: 'h1', roomId: 'room-1', guestId: 'g1',
    checkIn: '2026-09-12', checkOut: '2026-09-13',
    status: 'confirmed', totalAmount: 165.20, currency: 'USD',
  }]
  const addons = opts.addons ?? []
  const configuration = [{ hotelId: 'h1', key: 'taxes', value: [{ tasa: 18, activo: true }] }]
  const folios: any[] = []
  const charges: any[] = []
  const pick = (m: string) =>
    m === 'Rooms' ? rooms : m === 'Reservations' ? reservations
    : m === 'Folios' ? folios : m === 'FolioCharges' ? charges
    : m === 'ReservationAddons' ? addons : m === 'Configuration' ? configuration : []
  const match = (row: any, f: any) => Object.entries(f ?? {}).every(([k, v]) => row[k] === v)

  const orm: any = {
    async findMany(model: string, filter: any = {}) { return pick(model).filter((r: any) => match(r, filter)) },
    async findOne(model: string, filter: any = {}) { return (await orm.findMany(model, filter))[0] ?? null },
    async transaction(fn: (tx: any) => Promise<void>) {
      await fn({
        async create(model: string, data: any) { const row = { ...data }; pick(model).push(row); return row },
        async update(model: string, id: string, patch: any) {
          const row = pick(model).find((r: any) => r.id === id); if (row) Object.assign(row, patch); return row ?? null
        },
        async updateMany(model: string, filter: any, patch: any) {
          const hit = pick(model).filter((r: any) => match(r, filter))
          hit.forEach((r: any) => Object.assign(r, patch))
          return hit.length
        },
        async findOne(model: string, filter: any = {}) { return pick(model).filter((r: any) => match(r, filter))[0] ?? null },
        async findMany(model: string, filter: any = {}) { return pick(model).filter((r: any) => match(r, filter)) },
      })
    },
  }
  const audit: any[] = []
  const queries = {
    paidRepos: { paymentRepo: { findMany: async () => opts.payments ?? [] } },
    createAuditLog(row: any) { audit.push(row) },
  }
  return { orm, charges, folios, reservations, addons, queries, audit }
}

const USER = { id: 'u1', role: 'hotel_admin', hotelId: 'h1' }
const run = (h: any, r = h.reservations[0]) => executeCheckin(r, USER, {
  orm: h.orm, logger: { info() {}, warn() {}, error() {} }, repo: {} as any, queries: h.queries,
})

const PAGO = { id: 'pay-1', hotelId: 'h1', reservationId: 'res-1', type: 'charge', status: 'completed', method: 'stripe', amount: 165.20 }
const isAddonCharge = (c: any) => String(c.reference ?? '').startsWith(ADDON_CHARGE_REFERENCE_PREFIX)

describe('check-in: los extras pagados online entran al folio (#269)', () => {
  it('folio con 3 cargos (habitación + 2 extras con 18 %) y crédito 165.20 → saldo 0', async () => {
    const h = harness({ payments: [PAGO], addons: [TRANSFER, AMENIDAD] })
    const res = await run(h)

    const cargos = h.charges.filter((c: any) => c.kind === 'charge')
    expect(cargos).toHaveLength(3)

    const room = cargos.find((c: any) => c.category === 'room')
    expect(room).toMatchObject({ amount: 100, taxes: 18, total: 118, source: 'checkin' })

    const transfer = cargos.find((c: any) => c.reference === 'addon:ad-1')
    expect(transfer).toMatchObject({
      description: 'Transfer aeropuerto', category: 'extra', kind: 'charge', quantity: 1,
      amount: 30, taxes: 5.40, total: 35.40, source: 'checkin', folioId: h.folios[0].id, hotelId: 'h1',
    })
    const amenidad = cargos.find((c: any) => c.reference === 'addon:ad-2')
    expect(amenidad).toMatchObject({ category: 'extra', amount: 10, taxes: 1.80, total: 11.80, source: 'checkin' })

    // El prepago se acredita ENTERO: el tope ahora es noche + extras.
    const pagos = h.charges.filter((c: any) => c.kind === 'payment')
    expect(pagos.reduce((s: number, c: any) => s + c.total, 0)).toBeCloseTo(165.20, 2)
    expect(pagos[0].description).not.toContain('(parcial)')

    const t = computeTotals(h.charges as any)
    expect(t.chargesTotal).toBe(165.20)
    expect(t.paymentsTotal).toBe(165.20)
    expect(t.balance).toBe(0)

    expect(res.extrasCharge).toBe(40)
    expect(JSON.parse(h.audit[0].detail).extrasCharge).toBe(40)
  })

  it('los extras se postean ANTES del prepago (orden de las líneas del folio)', async () => {
    const h = harness({ payments: [PAGO], addons: [TRANSFER, AMENIDAD] })
    await run(h)
    const kinds = h.charges.map((c: any) => c.kind)
    expect(kinds).toEqual(['charge', 'charge', 'charge', 'payment'])
  })

  it('un segundo check-in sobre la misma reserva rechaza con 409 y no duplica los cargos addon:', async () => {
    const h = harness({ payments: [PAGO], addons: [TRANSFER, AMENIDAD] })
    // Mismo camino que el service: checkinValidation (repo) → executeCheckin.
    const repo = { findById: async (id: string) => h.reservations.find((r: any) => r.id === id) ?? null }
    const checkin = async () => run(h, (await checkinValidation(repo, 'res-1', USER)).reservation)
    await checkin()
    expect(h.charges.filter(isAddonCharge)).toHaveLength(2)

    let err: any
    try { await checkin() } catch (e) { err = e }
    expect(err).toBeInstanceOf(ConflictError)
    expect(err.httpStatus).toBe(409)

    // Reintento con un snapshot viejo de la reserva (cliente que repite el POST con el estado
    // que tenía): el UPDATE condicional de la tx ve 0 filas y aborta con el mismo 409.
    const stale = { ...h.reservations[0], status: 'confirmed', folioId: undefined }
    let err2: any
    try { await run(h, stale) } catch (e) { err2 = e }
    expect(err2).toBeInstanceOf(ConflictError)

    expect(h.folios).toHaveLength(1)
    expect(h.charges.filter(isAddonCharge)).toHaveLength(2)
  })

  it('hermana de grupo sin addons → folio sólo con el cargo de habitación', async () => {
    const hermana = {
      id: 'res-2', hotelId: 'h1', roomId: 'room-1', guestId: 'g2', groupId: 'grp-1',
      checkIn: '2026-09-12', checkOut: '2026-09-13', status: 'confirmed', totalAmount: 118, currency: 'USD',
    }
    // Los addons del grupo cuelgan de la líder (res-1): la hermana no los ve.
    const h = harness({ addons: [TRANSFER, AMENIDAD], reservations: [hermana] })
    await run(h)
    const cargos = h.charges.filter((c: any) => c.kind === 'charge')
    expect(cargos).toHaveLength(1)
    expect(cargos[0].category).toBe('room')
    expect(h.charges.filter(isAddonCharge)).toHaveLength(0)
  })

  it('un addon manual (source manual) NO se postea: lo carga recepción a mano', async () => {
    const h = harness({ payments: [PAGO], addons: [TRANSFER, AMENIDAD, MANUAL] })
    const res = await run(h)
    const cargos = h.charges.filter((c: any) => c.kind === 'charge')
    expect(cargos).toHaveLength(3)
    expect(cargos.find((c: any) => c.reference === 'addon:ad-3')).toBeUndefined()
    expect(res.extrasCharge).toBe(40)
  })

  it('REGRESIÓN tope: sin addons el crédito sigue capado a la noche (118 de 165.20)', async () => {
    const h = harness({ payments: [PAGO] })
    await run(h)
    const pagos = h.charges.filter((c: any) => c.kind === 'payment')
    expect(pagos).toHaveLength(1)
    expect(pagos[0].total).toBe(118)
    expect(pagos[0].description).toContain('(parcial)')
    expect(computeTotals(h.charges as any).balance).toBe(0)
  })

  it('addon con quantity > 1: base = unitario × cantidad y la descripción lo indica', async () => {
    const h = harness({ payments: [PAGO], addons: [{ ...TRANSFER, quantity: 2 }] })
    await run(h)
    const c = h.charges.find((x: any) => x.reference === 'addon:ad-1')
    expect(c).toMatchObject({ description: 'Transfer aeropuerto ×2', quantity: 2, amount: 60, taxes: 10.80, total: 70.80 })
  })

  it('si tx no expone findMany (driver viejo) lee por el ORM y postea igual', async () => {
    const h = harness({ payments: [PAGO], addons: [TRANSFER, AMENIDAD] })
    const inner = h.orm.transaction
    h.orm.transaction = (fn: any) => inner(async (tx: any) => { const { findMany, ...rest } = tx; await fn(rest) })
    await run(h)
    expect(h.charges.filter(isAddonCharge)).toHaveLength(2)
  })
})

describe('buildAddonFolioCharges (helper puro)', () => {
  const base = { folioId: 'f1', hotelId: 'h1', taxRate: 18, source: 'checkin' as const, postedAt: '2026-09-12T10:00:00.000Z' }

  it('es idempotente contra los cargos existentes por reference addon:<id>', () => {
    const first = buildAddonFolioCharges({ ...base, addons: [TRANSFER, AMENIDAD], existingCharges: [] })
    expect(first).toHaveLength(2)
    const again = buildAddonFolioCharges({ ...base, addons: [TRANSFER, AMENIDAD], existingCharges: first })
    expect(again).toHaveLength(0)
    const partial = buildAddonFolioCharges({ ...base, addons: [TRANSFER, AMENIDAD], existingCharges: [{ reference: 'addon:ad-1' }] })
    expect(partial.map((r) => r.reference)).toEqual(['addon:ad-2'])
  })

  it('ignora manuales, descuentos y sin importe; usa el taxRate del caller y no el snapshot', () => {
    const rows = buildAddonFolioCharges({
      ...base, taxRate: 10, existingCharges: [],
      addons: [MANUAL, { ...TRANSFER, id: 'd', kind: 'discount' }, { ...AMENIDAD, id: 'z', amount: 0 }, TRANSFER],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ reference: 'addon:ad-1', amount: 30, taxes: 3, total: 33, source: 'checkin' })
    expect(addonChargesTotal(rows)).toBe(33)
  })

  it('source night_audit se propaga a la fila', () => {
    const rows = buildAddonFolioCharges({ ...base, source: 'night_audit', addons: [TRANSFER], existingCharges: [] })
    expect(rows[0].source).toBe('night_audit')
    expect(addonChargesTotal(rows)).toBe(35.40)
  })
})
