// Esta es la regla que corta el servicio. Los casos que importan son los bordes:
// el trial que venció hace un minuto, el hotel viejo sin suscripción (que NO se
// puede quedar afuera por una migración) y el hotel suspendido a mano.
import { describe, it, expect } from 'bun:test'
import { SubscriptionAccess } from '../usecases/access'
import type { RepositoryAdapter } from 'arckode-framework'

const NOW = new Date('2026-07-19T12:00:00Z')
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString()

function setup(
  sub: any | null,
  hotel: any = { id: 'h1', status: 'active' },
  readPolicy?: () => Promise<{ requireCardOnTrial: boolean }>,
) {
  const updates: any[] = []
  const subscriptionsRepo = {
    findMany: async () => (sub ? [sub] : []),
    update: async (id: string, patch: any) => { updates.push({ id, ...patch }); return patch },
  } as unknown as RepositoryAdapter<any>
  const hotelsRepo = { findById: async () => hotel } as unknown as RepositoryAdapter<any>
  return { access: new SubscriptionAccess(subscriptionsRepo, hotelsRepo, readPolicy), updates }
}

const CARD_REQUIRED = async () => ({ requireCardOnTrial: true })
const CARD_OPTIONAL = async () => ({ requireCardOnTrial: false })

describe('SubscriptionAccess — quién puede trabajar', () => {
  it('en prueba, con días por delante: entra y sabe cuántos le quedan', async () => {
    const { access } = setup({ id: 's1', status: 'trialing', trialEndsAt: inDays(3) })
    const r = await access.check('h1', NOW)
    expect(r.allowed).toBe(true)
    expect(r.daysLeft).toBe(3)
  })

  it('el último día todavía entra', async () => {
    const { access } = setup({ id: 's1', status: 'trialing', trialEndsAt: inDays(0.5) })
    expect((await access.check('h1', NOW)).allowed).toBe(true)
  })

  it('prueba vencida: se bloquea y se deja asentado', async () => {
    const { access, updates } = setup({ id: 's1', status: 'trialing', trialEndsAt: inDays(-0.001) })
    const r = await access.check('h1', NOW)
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe('trial_expired')
    expect(updates).toEqual([{ id: 's1', status: 'expired' }])
  })

  it('paga y está al día: entra', async () => {
    const { access } = setup({ id: 's1', status: 'active', currentPeriodEnd: inDays(20) })
    expect((await access.check('h1', NOW)).allowed).toBe(true)
  })

  it('período pago vencido: se bloquea', async () => {
    const { access } = setup({ id: 's1', status: 'active', currentPeriodEnd: inDays(-1) })
    const r = await access.check('h1', NOW)
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe('subscription_expired')
  })

  it('cancelada: se bloquea', async () => {
    const { access } = setup({ id: 's1', status: 'canceled' })
    const r = await access.check('h1', NOW)
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe('subscription_expired')
  })

  it('un cobro fallido todavía NO corta (hay margen para reintentar)', async () => {
    const { access } = setup({ id: 's1', status: 'past_due', currentPeriodEnd: inDays(5) })
    expect((await access.check('h1', NOW)).allowed).toBe(true)
  })

  it('hotel suspendido a mano: no entra, aunque la suscripción esté al día', async () => {
    const { access } = setup(
      { id: 's1', status: 'active', currentPeriodEnd: inDays(30) },
      { id: 'h1', status: 'suspended' },
    )
    const r = await access.check('h1', NOW)
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe('hotel_suspended')
  })

  it('los hoteles que ya existían (sin suscripción) siguen trabajando', async () => {
    const { access } = setup(null)
    expect((await access.check('h1', NOW)).allowed).toBe(true)
  })

  it('la plataforma nunca se bloquea a sí misma', async () => {
    const { access } = setup({ id: 's1', status: 'expired' })
    expect((await access.check('platform', NOW)).allowed).toBe(true)
  })

  it('sin hotel (super admin) tampoco se bloquea', async () => {
    const { access } = setup({ id: 's1', status: 'expired' })
    expect((await access.check('', NOW)).allowed).toBe(true)
  })
})

// #28 — cuando la plataforma exige tarjeta para arrancar la prueba, el trial no corre solo:
// abandonar el Checkout tiene que dejar al hotel afuera, no adentro con 7 días gratis.
describe('SubscriptionAccess — tarjeta obligatoria para la prueba (#28)', () => {
  it('mandado al Checkout y sin cargar la tarjeta: no entra, y el motivo es la tarjeta (no el vencimiento)', async () => {
    const { access, updates } = setup(
      { id: 's1', status: 'trialing', trialEndsAt: inDays(6), awaitingPaymentMethodSince: inDays(-0.01) },
      undefined, CARD_REQUIRED,
    )
    const r = await access.check('h1', NOW)
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe('payment_method_required')
    // No se marca `expired`: la prueba no venció, nunca arrancó.
    expect(updates).toEqual([])
  })

  // El caso que rompió producción antes de existir: los 6 planes tenían `stripePriceId` vacío, así
  // que la Checkout Session nunca se creaba. Con el corte atado sólo al switch, prender la política
  // dejaba a TODOS afuera sin ninguna forma de pagar — el alta pública quedaba inutilizable.
  it('si nunca se lo mandó al Checkout, entra igual aunque la política exija tarjeta', async () => {
    const { access } = setup({ id: 's1', status: 'trialing', trialEndsAt: inDays(6) }, undefined, CARD_REQUIRED)
    const r = await access.check('h1', NOW)
    expect(r.allowed).toBe(true)
    expect(r.daysLeft).toBe(6)
  })

  it('trial con la tarjeta ya cargada: entra normal', async () => {
    const { access } = setup(
      { id: 's1', status: 'trialing', trialEndsAt: inDays(6), awaitingPaymentMethodSince: inDays(-1), paymentMethodAddedAt: inDays(-1) },
      undefined, CARD_REQUIRED,
    )
    const r = await access.check('h1', NOW)
    expect(r.allowed).toBe(true)
    expect(r.daysLeft).toBe(6)
  })

  it('política apagada: ni siquiera el que fue al Checkout queda bloqueado', async () => {
    const { access } = setup(
      { id: 's1', status: 'trialing', trialEndsAt: inDays(6), awaitingPaymentMethodSince: inDays(-1) },
      undefined, CARD_OPTIONAL,
    )
    expect((await access.check('h1', NOW)).allowed).toBe(true)
  })

  it('sin el puerto cableado se comporta como antes del switch: entra', async () => {
    const { access } = setup(
      { id: 's1', status: 'trialing', trialEndsAt: inDays(6), awaitingPaymentMethodSince: inDays(-1) },
    )
    expect((await access.check('h1', NOW)).allowed).toBe(true)
  })

  it('si la config explota, no deja a nadie afuera: entra', async () => {
    const boom = async () => { throw new Error('configuration caída') }
    const { access } = setup(
      { id: 's1', status: 'trialing', trialEndsAt: inDays(6), awaitingPaymentMethodSince: inDays(-1) },
      undefined, boom,
    )
    expect((await access.check('h1', NOW)).allowed).toBe(true)
  })

  it('la prueba vencida sigue siendo trial_expired aunque falte la tarjeta... si ya la había dado', async () => {
    const { access } = setup(
      { id: 's1', status: 'trialing', trialEndsAt: inDays(-1), awaitingPaymentMethodSince: inDays(-8), paymentMethodAddedAt: inDays(-8) },
      undefined, CARD_REQUIRED,
    )
    expect((await access.check('h1', NOW)).reason).toBe('trial_expired')
  })
})
