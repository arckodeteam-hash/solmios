// reservas/tests/ceiling-wiring.test.ts — RTC-7.2/7.3: el clamp del techo LLEGA hasta el borde.
//
// `payment-requests/tests/ceiling-property.test.ts` mide que el usecase HONRE el guard cuando se lo
// pasan; no puede ver si el borde se lo pasa. Las dos puertas de RTC-7 eran exactamente eso —
// código correcto al que nadie llamaba:
//   · `controller.createAddon` no le pasaba `service.addonsCeilingGuard()` (el `deleteAddon` de la
//     línea siguiente sí);
//   · `service.syncPendingAfterPayment` no le pasaba el clamp, y `clampRequestsToCeiling` no tenía
//     un solo caller fuera de una EDICIÓN de la reserva: cobrar en caja no recortaba nada.
// Este test es el que cae si alguien saca cualquiera de los dos argumentos.

import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, CacheAdapter, Auth } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { ReservasService } from '../service'
import { ReservasController } from '../controller'
import { ReservasQueries } from '../usecases/reservas-queries'

const log = silentLogger()
const cache: CacheAdapter = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} }
const auth = { assertOwnership: () => {} } as unknown as Auth
const USER = { id: 'u1', role: 'hotel_admin', hotelId: 'h1' }
const RESERVA = { id: 'r1', hotelId: 'h1', totalAmount: 500, otherCharges: 0, deposit: 200, pendingAmount: 300 }

function makeQueries() {
  const q = new ReservasQueries({
    findMany: async () => [], findById: async () => null, create: async (d: any) => d, update: async () => {},
  })
  // Reserva sin plata cobrada; el camino inverso dinero → reserva resuelve al vínculo directo.
  q.setMoneyPort({
    folios: async () => [], invoices: async () => [], payments: async () => [],
    reservationIdOf: async () => 'r1',
  })
  return q
}

/** Service con el connector `reservas-payment-requests` cableado a un espía del clamp. */
function makeService() {
  const clamped: Array<[string, string]> = []
  const repo = {
    findById: async () => RESERVA,
    findMany: async () => [RESERVA],
    update: async (id: string, patch: any) => ({ ...RESERVA, id, ...patch }),
  } as unknown as RepositoryAdapter<any>
  const userRepo = { findById: async () => ({ id: 'u1', hotelId: 'h1' }) } as unknown as RepositoryAdapter<any>
  const emptyRepo = { findById: async () => null, findOne: async () => null } as unknown as RepositoryAdapter<any>
  const svc = new ReservasService(repo, log, cache, userRepo, auth, emptyRepo, emptyRepo, emptyRepo, makeQueries())
  svc.setOrchestrationDeps({
    paymentRequestsCeiling: {
      clamp: async (hotelId: string, reservationId: string) => { clamped.push([hotelId, reservationId]) },
      releaseAll: async () => {},
    },
  } as any)
  return { svc, clamped, repo, userRepo }
}

describe('RTC-7 · el clamp del techo llega desde el borde', () => {
  it('7.2 — `POST /api/reservations/:id/addons` recorta los links vivos (un `discount` baja el techo)', async () => {
    const { svc, clamped, repo, userRepo } = makeService()
    const addons: any[] = []
    const addonRepo = {
      create: async (d: any) => { const row = { id: 'a1', ...d }; addons.push(row); return row },
      findMany: async () => addons,
    } as unknown as RepositoryAdapter<any>
    const controller = new ReservasController(svc, log, {} as any, addonRepo, repo, userRepo, auth)

    await controller.createAddon({
      params: { id: 'r1' }, user: USER,
      body: { description: 'Descuento comercial', kind: 'discount', amount: 300, quantity: 1 },
    } as any)

    expect(clamped).toEqual([['h1', 'r1']])
  })

  it('7.3 — un movimiento de dinero (`payments.onPaymentCreated`) recorta los links vivos', async () => {
    const { svc, clamped } = makeService()
    await svc.syncPendingAfterPayment({ hotelId: 'h1', reservationId: 'r1' })
    expect(clamped).toEqual([['h1', 'r1']])
  })

  it('un movimiento SIN reserva (cobro de caja suelto) no dispara clamp de nadie', async () => {
    const { svc, clamped } = makeService()
    await svc.syncPendingAfterPayment({ hotelId: 'h1' })
    expect(clamped).toEqual([])
  })
})
