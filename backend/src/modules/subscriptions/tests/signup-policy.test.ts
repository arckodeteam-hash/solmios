// signup-policy.test.ts — #28: quién queda esperando la tarjeta, y quién no.
//
// La regla que se prueba acá nació de un incidente evitado en el deploy: en producción los 6
// planes tenían `stripePriceId` vacío, así que la Checkout Session NUNCA se creaba. Si la
// exigencia dependiera sólo del switch, prenderlo dejaba a todo hotel nuevo sin poder entrar y
// sin ninguna forma de pagar. Por eso la exigencia se ata a un HECHO —se lo mandó al Checkout—
// y no a una configuración.
import { describe, it, expect } from 'bun:test'
import { checkoutUrlForSignup, resumeAbandonedCheckout, pendingTrialDays } from '../usecases/signup-policy'
import type { RepositoryAdapter } from 'arckode-framework'

const log = { warn() {} }
const REQUIRED = { requireCardOnTrial: true }
const OPTIONAL = { requireCardOnTrial: false }
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString()

function repoOf(rows: any[]): RepositoryAdapter<any> {
  return {
    findMany: async (f: any = {}) => rows.filter(r => Object.entries(f).every(([k, v]) => r[k] === v)),
    update: async (id: string, patch: any) => {
      const r = rows.find(x => x.id === id)
      if (r) Object.assign(r, patch)
      return r
    },
  } as unknown as RepositoryAdapter<any>
}

describe('checkoutUrlForSignup — la marca se sella sólo si Stripe abrió el Checkout', () => {
  it('Checkout OK: devuelve la URL y deja al hotel esperando la tarjeta', async () => {
    const rows: any[] = [{ id: 's1', hotelId: 'h1', status: 'trialing' }]
    const url = await checkoutUrlForSignup(
      { subscriptionsRepo: repoOf(rows), createCheckout: async () => ({ url: 'https://stripe/x' }), logger: log },
      REQUIRED, 'h1', 'p1', 'https://app.test',
    )
    expect(url).toBe('https://stripe/x')
    expect(rows[0]!.awaitingPaymentMethodSince).toBeTruthy()
  })

  it('plan sin stripePriceId: sin URL y SIN marca — el hotel entra con la prueba normal', async () => {
    const rows: any[] = [{ id: 's1', hotelId: 'h1', status: 'trialing' }]
    const url = await checkoutUrlForSignup(
      {
        subscriptionsRepo: repoOf(rows),
        createCheckout: async () => { throw new Error('Plan sin precio configurado en Stripe') },
        logger: log,
      },
      REQUIRED, 'h1', 'p1', 'https://app.test',
    )
    expect(url).toBeUndefined()
    expect(rows[0]!.awaitingPaymentMethodSince).toBeUndefined()
  })

  it('política apagada: ni se intenta abrir el Checkout', async () => {
    let llamado = false
    const rows: any[] = [{ id: 's1', hotelId: 'h1', status: 'trialing' }]
    const url = await checkoutUrlForSignup(
      {
        subscriptionsRepo: repoOf(rows),
        createCheckout: async () => { llamado = true; return { url: 'https://stripe/x' } },
        logger: log,
      },
      OPTIONAL, 'h1', 'p1', 'https://app.test',
    )
    expect(url).toBeUndefined()
    expect(llamado).toBe(false)
    expect(rows[0]!.awaitingPaymentMethodSince).toBeUndefined()
  })

  it('alta sin plan elegido: no hay contra qué cobrar, no se marca nada', async () => {
    const rows: any[] = [{ id: 's1', hotelId: 'h1', status: 'trialing' }]
    const url = await checkoutUrlForSignup(
      { subscriptionsRepo: repoOf(rows), createCheckout: async () => ({ url: 'x' }), logger: log },
      REQUIRED, 'h1', undefined, 'https://app.test',
    )
    expect(url).toBeUndefined()
    expect(rows[0]!.awaitingPaymentMethodSince).toBeUndefined()
  })
})

describe('pendingTrialDays — cuántos días quedan por cobrar', () => {
  const marcado = (over: any = {}) => [{
    id: 's1', hotelId: 'h1', planId: 'p1', status: 'trialing',
    trialEndsAt: inDays(2), awaitingPaymentMethodSince: inDays(-5), ...over,
  }]

  it('devuelve los días que FALTAN, no los 7 originales', async () => {
    expect(await pendingTrialDays(repoOf(marcado()), REQUIRED, 'h1')).toBe(2)
  })

  it('sin la marca no hay nada pendiente', async () => {
    expect(await pendingTrialDays(repoOf(marcado({ awaitingPaymentMethodSince: undefined })), REQUIRED, 'h1')).toBeUndefined()
  })

  it('con la tarjeta ya cargada no hay nada pendiente', async () => {
    expect(await pendingTrialDays(repoOf(marcado({ paymentMethodAddedAt: inDays(-1) })), REQUIRED, 'h1')).toBeUndefined()
  })

  it('prueba vencida: no se retoma, ya no es un alta a medias', async () => {
    expect(await pendingTrialDays(repoOf(marcado({ trialEndsAt: inDays(-1) })), REQUIRED, 'h1')).toBeUndefined()
  })
})

describe('resumeAbandonedCheckout — retomar el pago sin poder loguearse', () => {
  const deps = (rows: any[], verifyOwner?: any) => ({
    subscriptionsRepo: repoOf(rows),
    createCheckout: async (h: string, p: string) => ({ url: `https://stripe/${h}/${p}` }),
    verifyOwner,
    logger: log,
  })
  const pendiente = [{
    id: 's1', hotelId: 'h1', planId: 'p1', status: 'trialing',
    trialEndsAt: inDays(3), awaitingPaymentMethodSince: inDays(-4),
  }]

  it('credenciales válidas y pago pendiente: devuelve el Checkout del plan que eligió', async () => {
    const r = await resumeAbandonedCheckout(deps(pendiente, async () => ({ hotelId: 'h1' })), REQUIRED, 'a@b.com', 'ok', 'https://app.test')
    expect(r.url).toBe('https://stripe/h1/p1')
  })

  it('credenciales que no validan: no abre nada', async () => {
    expect(resumeAbandonedCheckout(deps(pendiente, async () => null), REQUIRED, 'a@b.com', 'mala', 'https://app.test')).rejects.toThrow()
  })

  it('sin verificador cableado: no abre nada', async () => {
    expect(resumeAbandonedCheckout(deps(pendiente), REQUIRED, 'a@b.com', 'ok', 'https://app.test')).rejects.toThrow()
  })

  it('un hotel al que nunca se le pidió tarjeta no tiene pago que retomar', async () => {
    const rows = [{ ...pendiente[0], awaitingPaymentMethodSince: undefined }]
    expect(resumeAbandonedCheckout(deps(rows, async () => ({ hotelId: 'h1' })), REQUIRED, 'a@b.com', 'ok', 'https://app.test'))
      .rejects.toThrow(/pago pendiente/i)
  })
})
