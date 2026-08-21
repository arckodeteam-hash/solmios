// payment-requests/tests/clamp-to-ceiling.test.ts — SEC3-2/SEC3-3: cuando el techo BAJA desde el
// lado de la reserva, los links vivos lo siguen.
//
// Escenario del hallazgo: inflar `totalAmount` a 5000, emitir dos links de $300 con sesión viva y
// volver a 500 dejaba $600 abiertos sobre un saldo de $300. El clamp recalcula el saldo con la
// MISMA fórmula del techo y expira lo que ya no entra — sesión de Stripe primero, fila después.

import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { StripeService } from '../../../services/stripe-service'
import { clampRequestsToCeiling, releaseRequestsOfReservation } from '../usecases/clamp-to-ceiling'
import type { PaymentRequestDTO, CurrentUser } from '../types'

const log = silentLogger()
const user: CurrentUser = { id: 'u1', hotelId: 'h1', role: 'hotel_admin' }

const link = (over: Partial<PaymentRequestDTO> = {}): PaymentRequestDTO => ({
  id: 'pr1', hotelId: 'h1', reservationId: 'r1', amount: 300, currency: 'USD',
  status: 'pending', sentTo: '', sentVia: 'email', createdAt: '2026-08-01T00:00:00Z',
  ...over,
})

function makeDeps(opts: {
  rows?: PaymentRequestDTO[]; reservation?: any | null
  expireOutcome?: 'expired' | 'paid' | 'gone'
} = {}) {
  const updates: any[] = []
  const audited: any[] = []
  const repo = {
    findMany: async () => opts.rows ?? [],
    update: async (id: string, patch: any) => { updates.push({ id, ...patch }); return { ...(opts.rows ?? []).find((r) => r.id === id), ...patch } },
  } as unknown as RepositoryAdapter<PaymentRequestDTO>
  const deps = {
    requestRepo: repo, // ClampDeps hereda el nombre de ChargeCeilingDeps
    reservationRepo: {
      findById: async () => opts.reservation === undefined
        ? { id: 'r1', hotelId: 'h1', totalAmount: 500, deposit: 200, otherCharges: 0 }
        : opts.reservation,
    } as unknown as RepositoryAdapter<any>,
    addonRepo: { findMany: async () => [] } as unknown as RepositoryAdapter<any>,
    // Sin folios/facturas/pagos: paid = deposit = 200 → saldo cobrable 300 (500 − 200).
    paidRepos: {
      folioRepo: { findMany: async () => [] },
      invoiceRepo: { findMany: async () => [] },
      paymentRepo: { findMany: async () => [] },
    },
    sockets: { onPaymentRequestUpdated: async (p: any) => { updates.push({ socket: p.id }) } },
    audit: async (e: any) => { audited.push(e) },
    logger: log,
  }
  return { deps, updates, audited }
}

/** Expone lo que el clamp le pidió a Stripe. */
function stubStripe(outcome: 'expired' | 'paid' | 'gone') {
  const real = StripeService.expireCheckoutSession
  const asked: string[] = []
  StripeService.expireCheckoutSession = (async (sessionId: string) => {
    asked.push(sessionId)
    return outcome
  }) as typeof StripeService.expireCheckoutSession
  return { asked, restore: () => { StripeService.expireCheckoutSession = real } }
}

describe('clampRequestsToCeiling (SEC3-2)', () => {
  it('expira el link que el saldo nuevo ya no respalda y deja la fila `expired` sin URL', async () => {
    // Reserva 500 con 200 pagados → saldo 300. Dos links de 300: el segundo sobra.
    const stub = stubStripe('expired')
    try {
      const { deps, updates, audited } = makeDeps({
        rows: [
          link({ id: 'pr-viejo', createdAt: '2026-08-01T00:00:00Z', stripeSessionId: 'sess_old' }),
          link({ id: 'pr-nuevo', createdAt: '2026-08-02T00:00:00Z', stripeSessionId: 'sess_new' }),
        ],
      })
      const retired = await clampRequestsToCeiling(deps, 'h1', 'r1', user)
      expect(retired).toBe(1)
      // Se mata la sesión del MÁS NUEVO (FIFO: el link más viejo es el que el huésped ya tiene).
      expect(stub.asked).toEqual(['sess_new'])
      expect(updates).toContainEqual({ id: 'pr-nuevo', status: 'expired', stripePaymentUrl: '' })
      expect(audited).toHaveLength(1) // el recorte deja rastro
    } finally { stub.restore() }
  })

  it('links dentro del saldo nuevo no se tocan', async () => {
    const stub = stubStripe('expired')
    try {
      const { deps, updates } = makeDeps({
        rows: [link({ id: 'pr1', amount: 150, stripeSessionId: 's1' }), link({ id: 'pr2', amount: 150, stripeSessionId: 's2' })],
      })
      expect(await clampRequestsToCeiling(deps, 'h1', 'r1', user)).toBe(0)
      expect(stub.asked).toHaveLength(0)
      expect(updates).toHaveLength(0)
    } finally { stub.restore() }
  })

  it('una sesión YA abonada no se cancela: la fila queda `pending` para que el webhook la liquide', async () => {
    const stub = stubStripe('paid')
    try {
      const { deps, updates } = makeDeps({
        rows: [link({ id: 'pr1', stripeSessionId: 's1' })], // 300 sobre saldo 300: entra justo…
      })
      // …pero forzamos recorte con saldo menor: reserva 400 con 200 pagados → saldo 200 < 300.
      deps.reservationRepo = { findById: async () => ({ id: 'r1', hotelId: 'h1', totalAmount: 400, deposit: 200, otherCharges: 0 }) } as any
      expect(await clampRequestsToCeiling(deps, 'h1', 'r1', user)).toBe(0)
      expect(stub.asked).toEqual(['s1'])
      expect(updates).toHaveLength(0) // la fila no se toca: sigue contando para el techo
    } finally { stub.restore() }
  })

  it('sin cobros pending es no-op', async () => {
    const { deps } = makeDeps({ rows: [] })
    expect(await clampRequestsToCeiling(deps, 'h1', 'r1', user)).toBe(0)
  })
})

describe('releaseRequestsOfReservation (SEC3-3)', () => {
  it('reserva inexistente: libera TODOS los links vivos (el cobro posterior quedaría huérfano)', async () => {
    const stub = stubStripe('expired')
    try {
      const { deps, updates } = makeDeps({
        reservation: null,
        rows: [link({ id: 'pr1', stripeSessionId: 's1' }), link({ id: 'pr2', stripeSessionId: 's2' })],
      })
      expect(await releaseRequestsOfReservation(deps, 'h1', 'r1', user)).toBe(2)
      expect(stub.asked).toEqual(['s1', 's2'])
      expect(updates.filter((u) => u.status)).toEqual([
        { id: 'pr1', status: 'expired', stripePaymentUrl: '' },
        { id: 'pr2', status: 'expired', stripePaymentUrl: '' },
      ])
    } finally { stub.restore() }
  })

  it('el clamp con reserva de OTRO hotel también libera todo (multi-tenancy)', async () => {
    const stub = stubStripe('expired')
    try {
      const { deps } = makeDeps({
        reservation: { id: 'r1', hotelId: 'h-otro', totalAmount: 500, deposit: 0 },
        rows: [link({ stripeSessionId: 's1' })],
      })
      expect(await clampRequestsToCeiling(deps, 'h1', 'r1', user)).toBe(1)
    } finally { stub.restore() }
  })
})
