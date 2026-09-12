// night-audit-addons.test.ts — #269 (MR-04): el night audit postea al folio los extras pagados
// online (`reservation_addons` source booking_engine) que todavía no tienen su cargo.
//
// Cubre a las reservas que YA estaban `checked_in` cuando se desplegó el posteo del check-in:
// el cron hace el mismo posteo, idempotente por `reference: 'addon:<id>'`. Se corre contra el
// `FoliosService` real con repos en memoria para que el impuesto salga del `postCharge` real
// (`configuration('taxes')` del fixture), no de un mock que lo calcule por su cuenta.
import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, CacheAdapter, Auth } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { FoliosService } from '../service'
import type { FolioDTO, FolioChargeDTO } from '../types'

const log = silentLogger()
const silentCache: CacheAdapter = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} }
const mockAuth = {
  assertOwnership: (rid: string, uid: string, role?: string, admin = 'admin') => {
    if (rid === uid) return; if (role === admin) return; throw new Error('Forbidden')
  },
} as unknown as Auth

const TODAY = new Date().toISOString().slice(0, 10)
const TAX_RATE = 18
const SYSTEM = { id: 'system', role: 'super_admin', hotelId: 'h1' }

// Igualdad estricta, igual que `buildWhere` del framework: sin operadores.
const matches = (row: any, filter: any) => Object.entries(filter ?? {}).every(([k, v]) => row[k] === v)

function memRepo(rows: any[], prefix: string): RepositoryAdapter<any> {
  return {
    findMany: async (f?: any) => rows.filter((r) => matches(r, f)),
    findOne: async (f?: any) => rows.find((r) => matches(r, f)) ?? null,
    findById: async (id: string) => rows.find((r) => r.id === id) ?? null,
    create: async (d: any) => { const c = { id: d.id ?? `${prefix}-${rows.length + 1}`, ...d }; rows.push(c); return c },
    update: async (id: string, d: any) => { const i = rows.findIndex((r) => r.id === id); rows[i] = { ...rows[i], ...d }; return rows[i] },
    delete: async () => true, count: async () => rows.length,
    paginate: async () => ({ data: rows, total: rows.length, limit: 20, offset: 0, pages: 1 }),
  } as unknown as RepositoryAdapter<any>
}

interface WorldOpts { addons?: any[]; charges?: any[] }

function makeWorld(opts: WorldOpts = {}) {
  const hotels = [{ id: 'h1', name: 'Demo', taxRate: TAX_RATE }]
  const rooms = [{ id: 'room-1', hotelId: 'h1', number: '101', basePrice: 100 }]
  const reservations = [{
    id: 'res-1', hotelId: 'h1', roomId: 'room-1', guestId: 'g1',
    status: 'checked_in', checkIn: TODAY, checkOut: '2099-01-01',
  }]
  const addons = [...(opts.addons ?? [])]
  const charges: any[] = [...(opts.charges ?? [])]
  const folios: any[] = [{ id: 'folio-1', hotelId: 'h1', reservationId: 'res-1', guestId: 'g1', roomId: 'room-1', status: 'open', currency: 'USD' }]
  const configuration = [{ id: 'cfg-1', hotelId: 'h1', key: 'taxes', value: [{ tasa: TAX_RATE, activo: true }] }]

  const tables: Record<string, any[]> = {
    Hotels: hotels, Rooms: rooms, Reservations: reservations, ReservationAddons: addons,
    FolioCharges: charges, Folios: folios, Configuration: configuration,
  }
  const orm: any = {
    async findMany(model: string, filter: any = {}) {
      return (tables[model] ?? []).filter((r: any) => matches(r, filter))
    },
  }

  const svc = new FoliosService(
    memRepo(folios, 'folio') as RepositoryAdapter<FolioDTO>,
    memRepo(charges, 'c') as RepositoryAdapter<FolioChargeDTO>,
    memRepo(configuration, 'cfg'),
    {
      guest: memRepo([{ id: 'g1', name: 'Ana' }], 'g'),
      reservation: memRepo(reservations, 'res'),
      room: memRepo(rooms, 'room'),
      user: memRepo([{ id: 'system', hotelId: 'h1', role: 'super_admin' }], 'u'),
    },
    log, silentCache, mockAuth,
  )

  const run = () => svc.postNightAuditRoomCharges(orm, SYSTEM, {})
  const extras = () => charges.filter((c) => c.category === 'extra')
  return { run, charges, extras }
}

const BOOKING_ADDONS = [
  { id: 'ad-1', hotelId: 'h1', reservationId: 'res-1', description: 'Late checkout', amount: 30, quantity: 1, kind: 'service', source: 'booking_engine' },
  { id: 'ad-2', hotelId: 'h1', reservationId: 'res-1', description: 'Cuna', amount: 10, quantity: 1, kind: 'service', source: 'booking_engine' },
]

describe('postNightAuditRoomCharges — extras pagados online (#269)', () => {
  it('reserva checked_in con 2 addons booking_engine y folio sin extras → 2 cargos extra con reference addon:<id> e impuesto del hotel', async () => {
    const w = makeWorld({ addons: BOOKING_ADDONS })

    const r = await w.run()

    expect(r.posted).toBe(1)          // la noche
    expect(r.extrasPosted).toBe(2)    // los dos extras
    const extras = w.extras()
    expect(extras).toHaveLength(2)
    expect(extras.map((c) => c.reference).sort()).toEqual(['addon:ad-1', 'addon:ad-2'])
    for (const c of extras) {
      expect(c.category).toBe('extra')
      expect(c.kind).toBe('charge')
      expect(c.source).toBe('night_audit')
      expect(c.folioId).toBe('folio-1')
    }
    const late = extras.find((c) => c.reference === 'addon:ad-1')!
    expect(late.amount).toBe(30)
    expect(late.taxes).toBe(5.4)      // 30 × 18 %
    expect(late.total).toBe(35.4)
    const cuna = extras.find((c) => c.reference === 'addon:ad-2')!
    expect(cuna.amount).toBe(10)
    expect(cuna.taxes).toBe(1.8)
    expect(cuna.total).toBe(11.8)
    // 100 + 18 (noche) + 35.40 + 11.80 = 165.20
    expect(w.charges.reduce((s, c) => s + c.total, 0)).toBeCloseTo(165.2, 2)
  })

  it('segunda corrida: extrasPosted 0 y siguen siendo 2 (idempotente por reference)', async () => {
    const w = makeWorld({ addons: BOOKING_ADDONS })

    const r1 = await w.run()
    const r2 = await w.run()
    const r3 = await w.run()

    expect(r1.extrasPosted).toBe(2)
    expect(r2.extrasPosted).toBe(0)
    expect(r2.skipped).toBe(1)        // la noche tampoco se repite
    expect(r3.extrasPosted).toBe(0)
    expect(w.extras()).toHaveLength(2)
    expect(w.charges).toHaveLength(3) // noche + 2 extras, nada más
  })

  it('un addon manual (source manual) NO se postea: lo carga recepción y no está en el prepago', async () => {
    const w = makeWorld({
      addons: [
        ...BOOKING_ADDONS,
        { id: 'ad-manual', hotelId: 'h1', reservationId: 'res-1', description: 'Minibar', amount: 25, quantity: 1, kind: 'service', source: 'manual' },
      ],
    })

    const r = await w.run()

    expect(r.extrasPosted).toBe(2)
    expect(w.extras().map((c) => c.reference)).not.toContain('addon:ad-manual')
    expect(w.extras()).toHaveLength(2)
  })

  it('reserva con la noche ya posteada (por el check-in) igual recibe sus extras', async () => {
    const w = makeWorld({
      addons: BOOKING_ADDONS,
      charges: [{
        id: 'c0', folioId: 'folio-1', hotelId: 'h1', description: `Habitación 101 — ${TODAY}`,
        category: 'room', kind: 'charge', quantity: 1, amount: 100, taxes: 18, total: 118, source: 'checkin',
      }],
    })

    const r = await w.run()

    expect(r.posted).toBe(0)
    expect(r.skipped).toBe(1)
    expect(r.extrasPosted).toBe(2)
    expect(w.extras()).toHaveLength(2)
    expect(w.charges).toHaveLength(3)
  })

  it('addon con cantidad > 1: base = unitario × cantidad y la cantidad se persiste', async () => {
    const w = makeWorld({
      addons: [{ id: 'ad-q', hotelId: 'h1', reservationId: 'res-1', description: 'Desayuno', amount: 15, quantity: 2, kind: 'service', source: 'booking_engine' }],
    })

    const r = await w.run()

    expect(r.extrasPosted).toBe(1)
    const [c] = w.extras()
    expect(c.quantity).toBe(2)
    expect(c.amount).toBe(30)
    expect(c.taxes).toBe(5.4)
    expect(c.description).toBe('Desayuno ×2')
  })

  it('sin addons: el resultado trae extrasPosted 0 y la noche se postea igual', async () => {
    const w = makeWorld()
    const r = await w.run()
    expect(r.posted).toBe(1)
    expect(r.extrasPosted).toBe(0)
    expect(w.extras()).toHaveLength(0)
  })
})
