// reservas/tests/claim-refund.e2e.test.ts — El compare-and-swap del reembolso web contra SQLite REAL (#272).
//
// web-booking-refund.test.ts prueba la lógica con un `claimRefund` en memoria; acá se cierra el
// hueco de verdad: `ReservasQueries.claimRefund` sobre el ORM real, con dos reclamos simultáneos
// por la misma reserva. Si el UPDATE condicional (guard por `updatedAt`, que el ORM pisa en cada
// escritura) no fuera atómico, las dos invocaciones dirían `true` y Stripe devolvería dos veces —
// exactamente el doble reembolso que señaló el revisor.

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { ORM, OrmRepository } from 'arckode-framework'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import { registerReservasModels } from '../model'
import { ReservasQueries } from '../usecases/reservas-queries'

let orm: any
let adapter: any
let dbPath: string
let queries: ReservasQueries
let repo: OrmRepository<any>

async function sembrar(id: string, extra: Record<string, unknown> = {}): Promise<void> {
  await repo.create({
    id, hotelId: 'h-cas', roomId: 'room-1', guestId: 'g-1', checkIn: '2026-10-01', checkOut: '2026-10-03',
    status: 'cancelled', totalAmount: 200, refundAmount: 100, ...extra,
  } as any)
  // El guard es `updatedAt` con resolución de ms: se deja pasar el reloj para que la siembra
  // y el reclamo no caigan en el mismo milisegundo (en producción media el evento de cancelación).
  await new Promise((r) => setTimeout(r, 5))
}

beforeAll(async () => {
  dbPath = `/tmp/solmios-claim-refund-e2e-${crypto.randomUUID()}.db`
  adapter = new SqliteAdapter({ path: dbPath, wal: false, foreignKeys: true }) as any
  await adapter.connect()
  orm = new ORM(adapter)
  registerReservasModels(orm)
  await orm.migrate()
  queries = new ReservasQueries(orm)
  repo = new OrmRepository<any>(orm, 'Reservations')
}, 60_000) // migrate() sobre SQLite tarda varios segundos en este sandbox (ver season-pricing.e2e)

afterAll(() => {
  try { require('node:fs').unlinkSync(dbPath) } catch { /* tmp, best-effort */ }
})

describe('ReservasQueries.claimRefund — CAS sobre SQLite real (#272)', () => {
  it('dos reclamos concurrentes sobre una reserva refundStatus none → exactamente UN true y queda pending', async () => {
    await sembrar('cas-1', { refundStatus: 'none' })

    const results = await Promise.all([queries.claimRefund('cas-1'), queries.claimRefund('cas-1')])

    expect(results.filter(Boolean)).toHaveLength(1)
    const row = await repo.findById('cas-1')
    expect(row.refundStatus).toBe('pending')
  })

  it('fila vieja con refundStatus NULL (anterior al campo) también se reclama una sola vez', async () => {
    await sembrar('cas-null')
    // El default del modelo pone 'none' al crear; se fuerza NULL como quedaron las filas anteriores.
    await orm.updateMany('Reservations', { id: 'cas-null' }, { refundStatus: null })
    await new Promise((r) => setTimeout(r, 5))
    expect((await repo.findById('cas-null')).refundStatus).toBeNull()

    const results = await Promise.all([queries.claimRefund('cas-null'), queries.claimRefund('cas-null')])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect((await repo.findById('cas-null')).refundStatus).toBe('pending')
  })

  it('reserva ya done → false sin tocar la fila', async () => {
    await sembrar('cas-done', { refundStatus: 'done', refundPaymentId: 're-0', refundedAt: '2026-09-01T00:00:00.000Z' })
    const before = await repo.findById('cas-done')

    expect(await queries.claimRefund('cas-done')).toBe(false)

    const after = await repo.findById('cas-done')
    expect(after.refundStatus).toBe('done')
    expect(after.updatedAt).toBe(before.updatedAt)
  })

  // Hallazgo del revisor: sobre una fila YA `pending` el CAS solo devolvía true (nadie pisó
  // `updatedAt` mientras el primero espera a Stripe). Un `pending` fresco bloquea; uno viejo no.
  it('fila pending recién escrita (reembolso en vuelo) → el segundo claim es false y no toca la fila', async () => {
    await sembrar('cas-inflight', { refundStatus: 'none' })
    expect(await queries.claimRefund('cas-inflight')).toBe(true)
    await new Promise((r) => setTimeout(r, 5))
    const before = await repo.findById('cas-inflight')
    expect(before.refundStatus).toBe('pending')

    expect(await queries.claimRefund('cas-inflight')).toBe(false)

    const after = await repo.findById('cas-inflight')
    expect(after.refundStatus).toBe('pending')
    expect(after.updatedAt).toBe(before.updatedAt)
  })

  it('pending con updatedAt de hace 15 min (proceso muerto tras reclamar) → se vuelve a reclamar: true', async () => {
    await sembrar('cas-stale', { refundStatus: 'none' })
    const stale = new Date(Date.now() - 15 * 60_000).toISOString()
    // El ORM pisa `updatedAt` en cada escritura: la fecha vieja se fuerza por SQL, como quedaría tras un proceso muerto.
    await adapter.query('UPDATE reservations SET refundStatus = ?, updatedAt = ? WHERE id = ?', ['pending', stale, 'cas-stale'])
    const row = await repo.findById('cas-stale')
    expect(row.refundStatus).toBe('pending')
    expect(Date.now() - Date.parse(row.updatedAt)).toBeGreaterThan(10 * 60_000)

    expect(await queries.claimRefund('cas-stale')).toBe(true)

    const after = await repo.findById('cas-stale')
    expect(after.refundStatus).toBe('pending')
    expect(after.updatedAt).not.toBe(stale) // la reclamación pisó updatedAt: el próximo que llegue ve un pending fresco
    expect(await queries.claimRefund('cas-stale')).toBe(false)
  })

  it('failed (reintento a mano) → se puede reclamar de nuevo; inexistente → false', async () => {
    await sembrar('cas-failed', { refundStatus: 'failed' })
    expect(await queries.claimRefund('cas-failed')).toBe(true)
    expect((await repo.findById('cas-failed')).refundStatus).toBe('pending')
    expect(await queries.claimRefund('no-existe')).toBe(false)
  })
})
