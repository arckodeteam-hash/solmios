// reservas/tests/checkout-race.test.ts — R-1 (auditoría 2026-08-19).
//
// El check-in tenía guard CAS contra la carrera; el check-OUT no: dos checkouts concurrentes
// (doble click, dos recepcionistas) pasaban ambos la validación y ambos ejecutaban el
// settlement + el update de estado. Con dinero de por medio (folio → pago → factura), el
// segundo flujo duplicaba el cobro. Este harness congela al primero justo después de su
// claim (mismo patrón que checkin-race.test.ts) y exige: 1 ganador, 1 rechazado con 409.
import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import { ReservasService } from '../service'

const log = silentLogger()

/** orm fake con transaction + tx.updateMany CAS (devuelve filas afectadas reales). */
function makeWorld() {
  // any[]: el updateMany falso hace Object.assign(row, patch) — campos como checkedOutAt
  // aparecen en runtime y el assert final los lee (mismo patrón que checkin-race.test.ts).
  const reservas: any[] = [
    { id: 'r1', hotelId: 'h1', roomId: 'room1', guestId: 'g1', status: 'checked_in', checkIn: '2026-01-01', checkOut: '2026-01-03', totalAmount: 100 },
  ]
  const audit: any[] = []
  const match = (row: any, f: Record<string, unknown>) => Object.entries(f).every(([k, v]) => row[k] === v)
  const orm = {
    async transaction(fn: (tx: any) => Promise<void>) {
      const tx = {
        async updateMany(model: string, filter: any, patch: any) {
          const hit = (model === 'Reservations' ? reservas : []).filter((r: any) => match(r, filter))
          hit.forEach((r: any) => Object.assign(r, patch))
          return hit.length
        },
        async findOne(model: string, filter: any) {
          return (model === 'Reservations' ? reservas : []).find((r: any) => match(r, filter)) ?? null
        },
        async update(model: string, id: string, patch: any) {
          const row = (model === 'Reservations' ? reservas : []).find((r: any) => r.id === id)
          if (row) Object.assign(row, patch)
          return row ?? null
        },
      }
      await fn(tx)
    },
  }
  const queries = {
    updateReservation: async (id: string, patch: any) => { const r = reservas.find((x) => x.id === id); if (r) Object.assign(r, patch); return r },
    createAuditLog: async (entry: any) => { audit.push(entry) },
  }
  const service = new ReservasService(
    { findMany: async () => reservas, findById: async (id: string) => reservas.find((r) => r.id === id) ?? null } as any,
    log,
    { get: async () => null, set: async () => {}, delete: async () => {} } as any,
    { findById: async () => ({ hotelId: 'h1' }) } as any,
    { assertOwnership: () => {} } as any,
    { findById: async () => ({ email: 'a@b.com' }) } as any,
    { findById: async () => ({ number: '101' }) } as any,
    { findById: async () => ({ name: 'Hotel' }) } as any,
    queries as any,
  )
  return { reservas, audit, orm, service }
}

const user = { id: 'u1', role: 'hotel_admin', hotelId: 'h1' }

describe('executeCheckout — guard de carrera (R-1)', () => {
  it('dos checkouts concurrentes: 1 gana, el otro recibe ConflictError y NO duplica efectos', async () => {
    const { reservas, audit, orm, service } = makeWorld()
    const r = { ...reservas[0] } // snapshot con el que ambos "validaron"

    const results = await Promise.allSettled([
      service.executeCheckout(r, user, { orm }),
      service.executeCheckout(r, user, { orm }),
    ])
    const okCount = results.filter((x) => x.status === 'fulfilled').length
    const rejected = results.filter((x) => x.status === 'rejected') as PromiseRejectedResult[]
    expect(okCount).toBe(1)
    expect(rejected.length).toBe(1)
    expect((rejected[0].reason as Error).message).toMatch(/ya tiene check-out/)

    // El perdedor NO corrió efectos post-claim: un solo audit log, un solo estado final.
    expect(audit.length).toBe(1)
    expect(reservas[0].status).toBe('checked_out')
    expect(reservas[0].checkedOutAt).toBeTruthy()
  })

  it('checkout secuencial (retry tras el ganador) → 409 claro', async () => {
    const { reservas, orm, service } = makeWorld()
    const r = { ...reservas[0] }
    await service.executeCheckout(r, user, { orm }) // primero gana
    await expect(service.executeCheckout(r, user, { orm })).rejects.toThrow(/ya tiene check-out/)
  })
})
