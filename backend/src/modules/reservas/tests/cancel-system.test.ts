// reservas/tests/cancel-system.test.ts — Cancelación por actor de SISTEMA (sin usuario logueado).
//
// Cubre los tres flujos automáticos que antes cancelaban con `repo.update({status:'cancelled'})`
// directo (ingesta OTA de Channex, ai-recepcionista, ai-gerente): ahora todos pasan por
// `cancelReservationBySystem`, que aplica la política, persiste el snapshot financiero y emite
// `onReservationCancelled` — el único disparador del release del depósito retenido.
//
// El último bloque NO se conforma con "se emitió el evento": cablea el connector REAL
// (reservas-deposits) contra el usecase REAL de payments y comprueba que el depósito `held`
// termina `released`.
import { describe, it, expect } from 'bun:test'
import { cancelReservationBySystem } from '../usecases/cancel-system'
import { reservasDepositsConnector } from '../../../connectors/reservas-deposits'
import { DepositsUseCase } from '../../payments/usecases/deposits'
import { cancelHeldDeposits } from '../../payments/usecases/cancel-deposits'

const noopLogger = { info() {}, warn() {}, error() {}, debug() {}, child: () => noopLogger } as any
const noopCache = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} } as any

const HOTEL = 'hotel-a'
const OTRO_HOTEL = 'hotel-b'

/** Fecha date-only ~48h en el futuro (determinística). */
const inTwoDays = () => new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)

const baseItem = (over: Record<string, any> = {}) => ({
  id: 'r1', hotelId: HOTEL, roomId: 'room-1', status: 'confirmed',
  checkIn: inTwoDays(), deposit: 100, ...over,
})

/**
 * Repo mock con estado: `findMany({id})` devuelve el item VIVO, así que una segunda llamada
 * ve el `status:'cancelled'` que dejó la primera (es lo que hace posible testear idempotencia).
 */
function statefulRepo(item: any, updates: any[]) {
  let current = { ...item }
  return {
    findMany: async (q: any) => (q?.id === current.id ? [current] : []),
    findById: async (id: string) => (id === current.id ? current : null),
    update: async (_id: string, patch: any) => {
      updates.push(patch)
      current = { ...current, ...patch }
      return current
    },
  } as any
}

const policyRepoWith = (tiers: any[]) => ({
  findMany: async () => [{ id: 'p1', hotelId: HOTEL, scope: 'base', scopeId: '', name: 'test', tiers, priority: 1, active: true }],
}) as any

const FREE_CANCEL = [{ deadlineHours: 99_999, penaltyPercent: 0, refundable: true }]
const HALF_PENALTY = [{ deadlineHours: 0, penaltyPercent: 50, refundable: true }]

function depsFor(repo: any, sockets: any, tiers: any[] = FREE_CANCEL) {
  // RTC-8.7: el release de sesiones de cobro es no-op acá (sin Stripe en este world).
  return { repo, policyRepo: policyRepoWith(tiers), logger: noopLogger, cache: noopCache, sockets, releaseChargeSessions: async () => {} }
}

describe('cancelReservationBySystem — política + snapshot + evento', () => {
  it('aplica la política del hotel, persiste el snapshot y emite onReservationCancelled', async () => {
    const updates: any[] = []
    const emitted: any[] = []
    const repo = statefulRepo(baseItem(), updates)
    const sockets = { onReservationCancelled: async (d: any) => { emitted.push(d) } }

    const out = await cancelReservationBySystem(depsFor(repo, sockets, HALF_PENALTY), 'r1', {
      hotelId: HOTEL, reason: 'Cancelada por el huésped vía asistente virtual',
    })

    expect(out.ok).toBe(true)
    // Snapshot financiero persistido (lo que el update directo NUNCA escribía).
    expect(updates).toHaveLength(1)
    expect(updates[0].status).toBe('cancelled')
    expect(updates[0].cancelledAt).toBeTruthy()
    expect(updates[0].cancellationReason).toBe('Cancelada por el huésped vía asistente virtual')
    expect(updates[0].cancellationFee).toBe(50)   // 50% de un depósito de 100
    expect(updates[0].refundAmount).toBe(50)
    expect(updates[0].policyApplied).toBeTruthy()
    // Evento emitido con los montos ya calculados (lo consume reservas-deposits).
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({ reservationId: 'r1', hotelId: HOTEL, refundAmount: 50, cancellationFee: 50 })
  })

  it('guard de tenant: una reserva de otro hotel es como si no existiera (no toca nada)', async () => {
    const updates: any[] = []
    const emitted: any[] = []
    const repo = statefulRepo(baseItem(), updates)
    const sockets = { onReservationCancelled: async (d: any) => { emitted.push(d) } }

    const out = await cancelReservationBySystem(depsFor(repo, sockets), 'r1', { hotelId: OTRO_HOTEL })

    expect(out).toMatchObject({ ok: false, error: 'not_found' })
    expect(updates).toHaveLength(0)
    expect(emitted).toHaveLength(0)
  })

  it('checked_in → invalid_state (requiere gestión humana), sin persistir ni emitir', async () => {
    const updates: any[] = []
    const emitted: any[] = []
    const repo = statefulRepo(baseItem({ status: 'checked_in' }), updates)
    const sockets = { onReservationCancelled: async (d: any) => { emitted.push(d) } }

    const out = await cancelReservationBySystem(depsFor(repo, sockets), 'r1', { hotelId: HOTEL })

    expect(out).toMatchObject({ ok: false, error: 'invalid_state' })
    expect(updates).toHaveLength(0)
    expect(emitted).toHaveLength(0)
  })
})

describe('cancelReservationBySystem — idempotencia (la ingesta OTA reprocesa revisiones)', () => {
  it('una segunda cancelación no persiste de nuevo ni re-emite el evento', async () => {
    const updates: any[] = []
    const emitted: any[] = []
    const repo = statefulRepo(baseItem(), updates)
    const sockets = { onReservationCancelled: async (d: any) => { emitted.push(d) } }
    const deps = depsFor(repo, sockets, HALF_PENALTY)

    const first = await cancelReservationBySystem(deps, 'r1', { hotelId: HOTEL })
    const second = await cancelReservationBySystem(deps, 'r1', { hotelId: HOTEL })
    const third = await cancelReservationBySystem(deps, 'r1', { hotelId: HOTEL })

    expect(first).toMatchObject({ ok: true, idempotent: false })
    expect(second).toMatchObject({ ok: true, idempotent: true })
    expect(third).toMatchObject({ ok: true, idempotent: true })
    // Un solo update y UN SOLO evento: el connector de depósitos no puede liberar dos veces.
    expect(updates).toHaveLength(1)
    expect(emitted).toHaveLength(1)
    // Y el snapshot que devuelve la corrida idempotente es el ya persistido, no un recálculo.
    expect(second).toMatchObject({ refundAmount: 50, cancellationFee: 50 })
  })
})

describe('cancelReservationBySystem — penaltyMode channel-managed (cancelación OTA)', () => {
  it('no aplica la penalidad del hotel: fee 0, reembolso total, snapshot marcado', async () => {
    const updates: any[] = []
    const emitted: any[] = []
    // Política del hotel = 50% de penalidad. La cancelación OTA NO debe aplicarla.
    const repo = statefulRepo(baseItem(), updates)
    const sockets = { onReservationCancelled: async (d: any) => { emitted.push(d) } }

    const out = await cancelReservationBySystem(depsFor(repo, sockets, HALF_PENALTY), 'r1', {
      hotelId: HOTEL, reason: 'Cancelada por el canal Booking.com', penaltyMode: 'channel-managed',
    })

    expect(out).toMatchObject({ ok: true, cancellationFee: 0, refundAmount: 100 })
    expect(updates[0].cancellationFee).toBe(0)
    expect(updates[0].refundAmount).toBe(100)
    // Queda auditable con qué criterio se canceló.
    expect((updates[0].policyApplied as any).policyId).toBe('channel-managed')
    expect(emitted).toHaveLength(1)
  })
})

// ── El depósito retenido se libera DE VERDAD (no sólo "se emitió el evento") ────────────────

/** Repo en memoria de deposits, suficiente para DepositsUseCase. */
function memDepositRepo(rows: any[]) {
  return {
    findMany: async (f: any) => rows.filter((r) => Object.entries(f).every(([k, v]) => r[k] === v)),
    findById: async (id: string) => rows.find((r) => r.id === id) ?? null,
    update: async (id: string, patch: any) => {
      const row = rows.find((r) => r.id === id)
      Object.assign(row, patch)
      return row
    },
  } as any
}

/**
 * Arma la cadena REAL: connector reservas-deposits → payments.cancelHeldDepositsByReservation
 * → cancelHeldDeposits → DepositsUseCase. Devuelve los sockets que el connector registró.
 */
function wireDepositRelease(depositRows: any[]) {
  const deposits = new DepositsUseCase(memDepositRepo(depositRows), noopLogger)
  const paymentsModule = {
    releaseHeldDepositsByReservation: (reservationId: string) => deposits.releaseHeldByReservation(reservationId),
    cancelHeldDepositsByReservation: (reservationId: string, refundAmount: number, cancellationFee: number) =>
      cancelHeldDeposits({ deposits, audit: async () => {}, sockets: {} } as any, reservationId, refundAmount, cancellationFee),
  }
  let sockets: any = {}
  const ctx: any = {
    resolveModule: (name: string) => {
      if (name === 'reservas') return { setSockets: (s: any) => { sockets = s } }
      if (name === 'payments') return paymentsModule
      throw new Error(`módulo inesperado: ${name}`)
    },
  }
  reservasDepositsConnector(ctx)
  return sockets
}

describe('cancelReservationBySystem — libera el depósito retenido (cadena real)', () => {
  it('un depósito held pasa a released al cancelar sin penalidad', async () => {
    const depositRows = [{ id: 'd1', hotelId: HOTEL, reservationId: 'r1', amount: 100, status: 'held', refundAmount: 0, releasedAt: null }]
    const sockets = wireDepositRelease(depositRows)
    const updates: any[] = []
    const repo = statefulRepo(baseItem(), updates)

    const out = await cancelReservationBySystem(depsFor(repo, sockets, FREE_CANCEL), 'r1', {
      hotelId: HOTEL, penaltyMode: 'channel-managed',
    })

    expect(out.ok).toBe(true)
    expect(depositRows[0].status).toBe('released')
    expect(depositRows[0].releasedAt).toBeTruthy()
  })

  it('reprocesar la MISMA cancelación OTA no vuelve a tocar el depósito (sin doble release)', async () => {
    const depositRows = [{ id: 'd1', hotelId: HOTEL, reservationId: 'r1', amount: 100, status: 'held', refundAmount: 0, releasedAt: null }]
    const sockets = wireDepositRelease(depositRows)
    const updates: any[] = []
    const repo = statefulRepo(baseItem(), updates)
    const deps = depsFor(repo, sockets, FREE_CANCEL)

    await cancelReservationBySystem(deps, 'r1', { hotelId: HOTEL, penaltyMode: 'channel-managed' })
    const releasedAt = depositRows[0].releasedAt
    const second = await cancelReservationBySystem(deps, 'r1', { hotelId: HOTEL, penaltyMode: 'channel-managed' })

    expect(second).toMatchObject({ ok: true, idempotent: true })
    expect(depositRows[0].status).toBe('released')
    // Mismo timestamp → el release NO se ejecutó una segunda vez.
    expect(depositRows[0].releasedAt).toBe(releasedAt)
    expect(updates).toHaveLength(1)
  })

  // La forma REAL de una reserva que llega del feed de Channex: `mapBookingRevision` no manda
  // `deposit`, así que la reserva vale 0 por ese lado. Pero el hotel igual pudo haberle tomado una
  // garantía, y esa vive en la tabla `deposits`, no en la reserva. Los tests de arriba usan
  // `deposit: 100`, una forma que este flujo NO produce — con la reserva real el hold se quedaba
  // retenido para siempre pese a que la penalidad de una cancelación OTA es cero.
  it('OTA sin `deposit` en la reserva: igual libera la garantía retenida', async () => {
    const depositRows = [{ id: 'd1', hotelId: HOTEL, reservationId: 'r1', amount: 100, status: 'held', refundAmount: 0, releasedAt: null }]
    const sockets = wireDepositRelease(depositRows)
    const repo = statefulRepo(baseItem({ deposit: undefined }), [])

    const out = await cancelReservationBySystem(depsFor(repo, sockets, FREE_CANCEL), 'r1', {
      hotelId: HOTEL, penaltyMode: 'channel-managed',
    })

    expect(out.ok).toBe(true)
    expect(depositRows[0].status).toBe('released')
    expect(depositRows[0].releasedAt).toBeTruthy()
  })

  it('con penalidad parcial el depósito se reembolsa a prorrata, no se libera entero', async () => {
    const depositRows = [{ id: 'd1', hotelId: HOTEL, reservationId: 'r1', amount: 100, status: 'held', refundAmount: 0, releasedAt: null }]
    const sockets = wireDepositRelease(depositRows)
    const updates: any[] = []
    const repo = statefulRepo(baseItem(), updates)

    await cancelReservationBySystem(depsFor(repo, sockets, HALF_PENALTY), 'r1', { hotelId: HOTEL })

    expect(depositRows[0].refundAmount).toBe(50)
    expect(depositRows[0].status).not.toBe('released')
  })
})
