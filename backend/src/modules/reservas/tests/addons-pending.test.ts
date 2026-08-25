// reservas/tests/addons-pending.test.ts — Alta/baja de un extra recalcula el saldo persistido.
//
// Hallazgo ARCH-6 (2026-08-19): el detalle empezó a devolver el pendiente CON extras, pero
// `reservations.pendingAmount` (lo que ve el listado y el planning) no se tocaba al agregar o
// quitar un addon: la misma reserva mostraba un saldo en el modal y otro en la grilla.

import { describe, it, expect } from 'bun:test'
import { Auth } from 'arckode-framework'
import { createAddon, deleteAddon } from '../usecases/addons'
import { listReservations, updateReservationWithBalance } from '../usecases/crud'
import { reservationChangedNotifier } from '../usecases/reservation-changed'
import { paidSourceFrom } from '../../../shared/usecases/reservation-paid'

// Lo cobrado real (GH-0.2): se usa la implementación DE VERDAD sobre repos vacíos, así el saldo
// cae al `deposit` de la reserva — que es el escenario de estos tests (no hay folio ni factura).
// Un doble que devolviera un número fijo taparía un cambio de criterio de `paidForReservation`.
const noMoneyRows = { findMany: async () => [] as any[] }
const paidOf = paidSourceFrom({ folioRepo: noMoneyRows, invoiceRepo: noMoneyRows, paymentRepo: noMoneyRows })

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} } as any
const realAuth = new Auth({ sign: () => '', verify: () => ({}) } as any, 'test-secret', noopLogger)

const HOTEL = 'h1'
const USER = { id: 'u1', role: 'hotel_admin', hotelId: HOTEL }

/** CacheAdapter en memoria: TTL ignorado (los tests no esperan 300s), semántica de claves REAL. */
function memoryCache() {
  const store = new Map<string, any>()
  return {
    store,
    get: async (k: string) => (store.has(k) ? store.get(k) : null),
    set: async (k: string, v: any) => { store.set(k, v) },
    delete: async (k: string) => { store.delete(k) },
  } as any
}

/** Notificador REAL (socket + invalidación versionada), el mismo que arma el service. */
const notifierOn = (cache: any, sockets: any = {}) => reservationChangedNotifier({ logger: noopLogger, cache, sockets })

/** RTC-8.10: deps por objeto. El clamp de techo es no-op acá — este world no tiene links vivos. */
const depsOf = (h: ReturnType<typeof harness>, notifyChanged: any) => ({
  repo: h.addonRepo, reservationRepo: h.reservationRepo, userRepo: h.userRepo, auth: realAuth,
  notifyChanged, paidOf, ceilingGuard: async () => {},
})

function harness(initialAddons: any[] = []) {
  const addons = [...initialAddons]
  const reservation = { id: 'r1', hotelId: HOTEL, totalAmount: 500, otherCharges: 40, deposit: 100, pendingAmount: 440 }
  const reservationUpdates: any[] = []

  const addonRepo = {
    findMany: async (f: any) => addons.filter((a) => a.reservationId === f.reservationId),
    findById: async (id: string) => addons.find((a) => a.id === id) ?? null,
    create: async (d: any) => { const row = { id: `a${addons.length + 1}`, ...d }; addons.push(row); return row },
    delete: async (id: string) => { const i = addons.findIndex((a) => a.id === id); if (i >= 0) addons.splice(i, 1); return i >= 0 },
  } as any
  const reservationRepo = {
    findById: async () => reservation,
    update: async (id: string, patch: any) => { reservationUpdates.push({ id, ...patch }); Object.assign(reservation, patch); return reservation },
  } as any
  const userRepo = { findById: async (id: string) => ({ id, hotelId: HOTEL }) } as any

  const listRepo = {
    // El listado lee la MISMA fila que muta el sync: si la caché no se invalida, nunca se llega acá.
    paginate: async () => ({ data: [{ ...reservation }], total: 1 }),
  } as any

  return { addons, reservation, reservationUpdates, addonRepo, reservationRepo, userRepo, listRepo }
}

describe('addons → pendingAmount persistido', () => {
  it('agregar un extra sube el saldo persistido', async () => {
    const h = harness()
    await createAddon(depsOf(h, notifierOn(memoryCache())), { reservationId: 'r1', dto: { description: 'Cena', amount: 30, quantity: 2, kind: 'service' } as any, user: USER })
    // 500 + 40 + 60 − 100 = 500
    expect(h.reservationUpdates).toEqual([{ id: 'r1', pendingAmount: 500 }])
  })

  it('quitar el extra vuelve a bajar el saldo persistido', async () => {
    const h = harness([{ id: 'a1', reservationId: 'r1', hotelId: HOTEL, amount: 30, quantity: 2, kind: 'service' }])
    h.reservation.pendingAmount = 500
    await deleteAddon(depsOf(h, notifierOn(memoryCache())), { id: 'a1', user: USER })
    expect(h.reservationUpdates).toEqual([{ id: 'r1', pendingAmount: 440 }])
    expect(h.addons).toHaveLength(0)
  })

  it('un descuento baja el saldo persistido', async () => {
    const h = harness()
    await createAddon(depsOf(h, notifierOn(memoryCache())), { reservationId: 'r1', dto: { description: 'Promo', amount: 40, quantity: 1, kind: 'discount' } as any, user: USER })
    expect(h.reservationUpdates).toEqual([{ id: 'r1', pendingAmount: 400 }])
  })

  it('un usuario de otro hotel no puede cargar extras (multi-tenant)', async () => {
    const h = harness()
    h.userRepo.findById = async (id: string) => ({ id, hotelId: 'h2' })
    await expect(
      createAddon(depsOf(h, notifierOn(memoryCache())), { reservationId: 'r1', dto: { description: 'x', amount: 10 } as any, user: USER }),
    ).rejects.toThrow()
    expect(h.reservationUpdates).toHaveLength(0)
  })
})

// ── COR-1: persistir el saldo NO alcanza si el listado sigue sirviendo la caché vieja ─────────
//
// `listReservations` cachea la página por 300s (crud.ts, CACHE_TTL). Antes de este fix, alta y baja
// de un extra escribían `pendingAmount` y no tocaban la caché: `GET /api/reservas` devolvía el saldo
// anterior durante CINCO MINUTOS mientras el detalle ya mostraba el nuevo. El test usa la caché y la
// invalidación REALES (`usecases/cache.ts`), no dobles: sin la llamada al notificador, falla.
describe('addons → caché del listado', () => {
  const listQuery = {} as any

  it('agregar un extra hace que GET /api/reservas deje de servir el saldo viejo', async () => {
    const h = harness()
    const cache = memoryCache()
    const before = await listReservations(h.listRepo, h.userRepo, cache, noopLogger, listQuery, USER)
    expect(before.data[0].pendingAmount).toBe(440)

    await createAddon(depsOf(h, notifierOn(cache)), { reservationId: 'r1', dto: { description: 'Cena', amount: 30, quantity: 2, kind: 'service' } as any, user: USER })

    const after = await listReservations(h.listRepo, h.userRepo, cache, noopLogger, listQuery, USER)
    expect(after.data[0].pendingAmount).toBe(500)
  })

  it('quitar un extra también invalida el listado', async () => {
    const h = harness([{ id: 'a1', reservationId: 'r1', hotelId: HOTEL, amount: 30, quantity: 2, kind: 'service' }])
    h.reservation.pendingAmount = 500
    const cache = memoryCache()
    expect((await listReservations(h.listRepo, h.userRepo, cache, noopLogger, listQuery, USER)).data[0].pendingAmount).toBe(500)

    await deleteAddon(depsOf(h, notifierOn(cache)), { id: 'a1', user: USER })

    expect((await listReservations(h.listRepo, h.userRepo, cache, noopLogger, listQuery, USER)).data[0].pendingAmount).toBe(440)
  })

  it('emite onReservasUpdated con el saldo NUEVO (el planning escucha ese socket)', async () => {
    const h = harness()
    const emitted: any[] = []
    await createAddon(
      depsOf(h, notifierOn(memoryCache(), { onReservasUpdated: async (r: any) => { emitted.push(r) } })),
      { reservationId: 'r1', dto: { description: 'Cena', amount: 30, quantity: 2, kind: 'service' } as any, user: USER },
    )
    expect(emitted).toHaveLength(1)
    expect(emitted[0].pendingAmount).toBe(500)
  })
})

// ── El mismo saldo, por el otro camino de escritura: editar `otherCharges` ────────────────────
describe('updateReservationWithBalance → pendingAmount persistido', () => {
  function updateHarness(addons: any[] = []) {
    const row = { id: 'r1', hotelId: HOTEL, totalAmount: 500, otherCharges: 0, deposit: 100, pendingAmount: 400 }
    const updates: any[] = []
    const repo = {
      findById: async () => row,
      update: async (id: string, patch: any) => { updates.push({ id, ...patch }); Object.assign(row, patch); return { ...row } },
    } as any
    const cache = { get: async () => null, set: async () => {}, delete: async () => {} } as any
    return { row, updates, repo, cache, addonsOf: async () => addons }
  }

  it('subir otherCharges deja el pendiente persistido con el saldo real', async () => {
    const h = updateHarness()
    const out = await updateReservationWithBalance(h.addonsOf, paidOf, h.repo, noopLogger, h.cache, {}, 'r1', { otherCharges: 40 } as any, USER)
    // 500 + 40 − 100 = 440 (antes quedaba en 400: el listado mostraba menos deuda de la real)
    expect(out.pendingAmount).toBe(440)
    expect(h.updates.at(-1)).toEqual({ id: 'r1', pendingAmount: 440 })
  })

  it('el pendiente persistido también cuenta los extras ya cargados', async () => {
    const h = updateHarness([{ amount: 25, quantity: 2, kind: 'service' }])
    const out = await updateReservationWithBalance(h.addonsOf, paidOf, h.repo, noopLogger, h.cache, {}, 'r1', { otherCharges: 40 } as any, USER)
    expect(out.pendingAmount).toBe(490)
  })

  // ── COR-2: el recálculo va DENTRO de la ventana de escritura ───────────────────────────────
  // Antes el sync corría después de `updateReservation`, o sea después del socket y después de la
  // invalidación: el planning recibía el saldo VIEJO por socket, y cualquier lectura que entrara
  // entre la invalidación y el sync recacheaba el número pre-sync por 300s.
  it('emite onReservasUpdated con el saldo NUEVO y recién después invalida la caché', async () => {
    const h = updateHarness()
    const order: string[] = []
    const emitted: any[] = []
    const repo = {
      findById: h.repo.findById,
      update: async (id: string, patch: any) => {
        order.push('pendingAmount' in patch ? 'sync' : 'update')
        return h.repo.update(id, patch)
      },
    } as any
    const cache = { get: async () => null, set: async () => { order.push('cache') }, delete: async () => {} } as any
    const sockets = { onReservasUpdated: async (r: any) => { order.push('emit'); emitted.push(r) } }

    await updateReservationWithBalance(h.addonsOf, paidOf, repo, noopLogger, cache, sockets, 'r1', { otherCharges: 40 } as any, USER)

    expect(emitted).toHaveLength(1)
    expect(emitted[0].pendingAmount).toBe(440) // antes salía 400: el saldo del `otherCharges` viejo
    expect(order).toEqual(['update', 'sync', 'emit', 'cache', 'cache'])
  })
})
