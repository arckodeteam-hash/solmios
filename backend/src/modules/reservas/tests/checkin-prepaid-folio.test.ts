import { describe, it, expect } from 'bun:test'
import { executeCheckin } from '../usecases/checkin'
import { computeTotals } from '../../folios/usecases/folio-math'

// Reporte de cliente (2026-08-30): "el pago de Stripe no está conectado con nada".
// El motor web cobra ANTES del check-in, cuando no hay folio. El folio nacía con el cargo de la
// habitación y CERO pagos; como `settle-folio-at-checkout` factura contra el folio, se volvía a
// cobrar plata ya cobrada. Reproducido en producción: pago 613,60 y folio sin pagos.

function harness(payments: any[]) {
  const rooms = [{ id: 'room-1', hotelId: 'h1', number: '203', basePrice: 130, status: 'available' }]
  const reservations = [{
    id: 'res-1', hotelId: 'h1', roomId: 'room-1', guestId: 'g1',
    checkIn: '2026-08-31', checkOut: '2026-09-01',
    status: 'confirmed', totalAmount: 130, currency: 'USD',
  }]
  const folios: any[] = []
  const charges: any[] = []
  const pick = (m: string) =>
    m === 'Rooms' ? rooms : m === 'Reservations' ? reservations
    : m === 'Folios' ? folios : m === 'FolioCharges' ? charges : []
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
        // Reclamo anti-carrera del check-in: mueve la reserva y devuelve cuántas filas tocó.
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
  const queries = { paidRepos: { paymentRepo: { findMany: async () => payments } }, createAuditLog() {} }
  return { orm, charges, folios, reservations, queries }
}

const USER = { id: 'u1', role: 'hotel_admin', hotelId: 'h1' }
const run = (h: any) => executeCheckin(h.reservations[0], USER, {
  orm: h.orm, logger: { info() {}, warn() {}, error() {} }, repo: {} as any, queries: h.queries,
})

// 130 = la tarifa del cuarto. El harness no tiene `configuration('taxes')`, así que el cargo va
// sin impuesto; en producción el cargo lleva el ITBIS y el cobro también.
const COBRO = { id: 'pay-1', hotelId: 'h1', reservationId: 'res-1', type: 'charge', status: 'completed', method: 'link', amount: 130 }

describe('check-in: el pago del motor web llega al folio', () => {
  it('el folio queda SALDADO cuando la estadía ya estaba pagada', async () => {
    const h = harness([COBRO])
    await run(h)
    const t = computeTotals(h.charges as any)
    expect(t.chargesTotal).toBe(130)   // la habitación
    expect(t.paymentsTotal).toBe(130)  // el cobro de Stripe
    expect(t.balance).toBe(0)            // no se le vuelve a cobrar
  })

  it('REGRESIÓN: sin el pago anticipado el folio pedía la estadía entera de nuevo', async () => {
    const h = harness([])                // el comportamiento viejo: el folio no veía el cobro
    await run(h)
    expect(computeTotals(h.charges as any).balance).toBe(130)
  })

  it('la línea del pago guarda el id del cobro para trazarlo', async () => {
    const h = harness([COBRO])
    await run(h)
    const pago = h.charges.find((c: any) => c.kind === 'payment')
    expect(pago.reference).toBe('pay-1')
    expect(pago.source).toBe('prepaid')
  })

  it('NO crea filas nuevas en payments: el cobro ya está asentado ahí', async () => {
    const h = harness([COBRO])
    await run(h)
    // El harness registraría cualquier create sobre 'Payments' en pick(), que devuelve [].
    expect(h.charges.filter((c: any) => c.kind === 'payment')).toHaveLength(1)
  })

  it('un pago pendiente NO salda el folio', async () => {
    const h = harness([{ ...COBRO, status: 'pending' }])
    await run(h)
    expect(computeTotals(h.charges as any).balance).toBe(130)
  })

  it('un pago parcial deja el saldo exacto', async () => {
    const h = harness([{ ...COBRO, amount: 100 }])
    await run(h)
    expect(computeTotals(h.charges as any).balance).toBe(30)
  })

  it('si el puerto de dinero falla, el check-in igual se completa', async () => {
    const h = harness([])
    h.queries = { paidRepos: { paymentRepo: { findMany: async () => { throw new Error('caído') } } }, createAuditLog() {} } as any
    const r = await run(h)
    expect(r.status).toBe('checked_in')
    expect(h.folios).toHaveLength(1)
  })

  it('sin queries (caller viejo) el check-in sigue funcionando', async () => {
    const h = harness([COBRO])
    const r = await executeCheckin(h.reservations[0], USER, {
      orm: h.orm, logger: { info() {}, warn() {}, error() {} }, repo: {} as any,
    })
    expect(r.status).toBe('checked_in')
  })
})
