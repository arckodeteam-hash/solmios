// payment-requests/tests/live-session.test.ts — GH-0.3 / GH-0.4: UNA sesión de Stripe viva por
// cobro, y UN solo tenant para emitirla.
//
// Antes de este fix el repo tenía 0 hits de `checkout.sessions.expire`. Consecuencias medidas por
// los auditores del gate CHK-20260819:
//   · `PUT {status:'cancelled'}` (valor VÁLIDO del enum) sacaba la fila del filtro `pending` de
//     `charge-ceiling.ts:committedPending`, liberaba el techo agregado y dejaba el link vivo:
//     reserva con saldo $300 → `pr1 cancelled` con URL pagable + `pr2 pending 300` = $600 cobrables.
//   · `createCheckoutForRequest` pisaba `stripeSessionId` sin expirar la anterior: N clicks del
//     modal = N sesiones vivas por el mismo importe.
//   · `createCheckout` resolvía el tenant de dos maneras (JWT para la cuenta Stripe, `pr.hotelId`
//     para el techo y la metadata): un `super_admin` emitía la sesión en la cuenta equivocada y el
//     webhook la rechazaba con 403 → el huésped pagaba y el cobro no se asentaba en ningún lado.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import type { RepositoryAdapter, Auth } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { PaymentRequestsService } from '../service'
import { StripeService } from '../../../services/stripe-service'
import type { PaymentRequestDTO, CurrentUser } from '../types'

const log = silentLogger()
const currentUser: CurrentUser = { id: 'u1', hotelId: 'h1', role: 'hotel_admin' }
const permissiveAuth = { assertOwnership: () => {}, authenticate: (() => []) as any } as unknown as Auth

function makeRepo<T extends object>(ov: Partial<RepositoryAdapter<T>> = {}): RepositoryAdapter<T> {
  return {
    findMany: async () => [], findById: async () => null, findOne: async () => null,
    create: async (d: any) => ({ id: 'x1', ...d } as T),
    update: async (id: any, d: any) => ({ id, ...d } as T),
    delete: async () => true, count: async () => 0,
    paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0 }),
    ...ov,
  } as RepositoryAdapter<T>
}

/** Doble de Stripe: registra las llamadas y devuelve lo que el caso necesite. */
interface StripeSpy {
  expired: Array<{ sessionId: string; hotelId?: string }>
  created: Array<{ hotelId?: string; metadata?: Record<string, string>; amount: number }>
  configuredFor: Array<string | undefined>
  retrieved: Array<{ sessionId: string; hotelId?: string }>
}
let spy: StripeSpy
const real = {
  isConfigured: StripeService.isConfigured,
  createCheckoutSession: StripeService.createCheckoutSession,
  getSession: StripeService.getSession,
  expireCheckoutSession: StripeService.expireCheckoutSession,
}

function stubStripe(over: Partial<typeof StripeService> = {}): void {
  spy = { expired: [], created: [], configuredFor: [], retrieved: [] }
  StripeService.isConfigured = (async (h?: string) => { spy.configuredFor.push(h); return true }) as typeof StripeService.isConfigured
  StripeService.createCheckoutSession = (async (input: any) => {
    spy.created.push({ hotelId: input.hotelId, metadata: input.metadata, amount: input.amount })
    return { sessionId: `sess_${spy.created.length}`, sessionUrl: `https://pay/${spy.created.length}` }
  }) as typeof StripeService.createCheckoutSession
  StripeService.getSession = (async (sessionId: string, hotelId?: string) => {
    spy.retrieved.push({ sessionId, hotelId })
    return null
  }) as typeof StripeService.getSession
  StripeService.expireCheckoutSession = (async (sessionId: string, hotelId?: string) => {
    spy.expired.push({ sessionId, hotelId })
    return 'expired'
  }) as typeof StripeService.expireCheckoutSession
  Object.assign(StripeService, over)
}

beforeEach(() => stubStripe())
afterEach(() => { Object.assign(StripeService, real) })

/** Servicio con un PaymentRequest concreto; devuelve el service y lo que se persistió. */
function serviceWith(pr: PaymentRequestDTO, reservationHotelId = 'h1') {
  const patches: Array<Partial<PaymentRequestDTO>> = []
  const deleted: string[] = []
  const repo = makeRepo<PaymentRequestDTO>({
    findById: async () => pr,
    findMany: async () => [pr] as any,
    update: async (id: any, d: any) => { patches.push(d); return { ...pr, id, ...d } },
    delete: async (id: any) => { deleted.push(id); return true },
  })
  const reservationRepo = makeRepo<any>({
    findById: async () => ({ id: 'r1', hotelId: reservationHotelId, totalAmount: 500, deposit: 200, otherCharges: 0 }),
  })
  const s = new PaymentRequestsService(
    repo, reservationRepo, makeRepo<any>(), makeRepo<any>(),
    makeRepo<any>({ findById: async () => ({ id: 'u1', hotelId: 'h1' }) }),
    log, permissiveAuth, makeRepo<any>(),
  )
  // STR-A: puerto de dinero del connector payment-requests-money (sin folios/facturas/pagos: paid=deposit).
  s.setMoneyDeps({ paidRepos: { folioRepo: makeRepo<any>(), invoiceRepo: makeRepo<any>(), paymentRepo: makeRepo<any>() }, settledNet: async () => 0 })
  return { s, patches, deleted }
}

const pendingWithLink = (over: Partial<PaymentRequestDTO> = {}): PaymentRequestDTO => ({
  id: 'pr1', hotelId: 'h1', reservationId: 'r1', amount: 300, currency: 'USD',
  status: 'pending', sentTo: '', sentVia: 'email',
  stripeSessionId: 'sess_old', stripePaymentUrl: 'https://pay/old', ...over,
})

describe('GH-0.3 · sacar un cobro de `pending` mata su Checkout Session', () => {
  it('cancelar expira la sesión ANTES de liberar el techo y borra la URL muerta', async () => {
    const { s, patches } = serviceWith(pendingWithLink())
    await s.update('pr1', { status: 'cancelled' }, currentUser)
    expect(spy.expired).toEqual([{ sessionId: 'sess_old', hotelId: 'h1' }])
    expect(patches[0]).toMatchObject({ status: 'cancelled', stripePaymentUrl: '' })
  })

  it('expirar a mano también mata la sesión', async () => {
    const { s } = serviceWith(pendingWithLink())
    await s.update('pr1', { status: 'expired' }, currentUser)
    expect(spy.expired).toHaveLength(1)
  })

  it('si la sesión YA fue abonada, cancelar corta con 409 y el estado no cambia', async () => {
    stubStripe({ expireCheckoutSession: (async () => 'paid') as typeof StripeService.expireCheckoutSession })
    const { s, patches } = serviceWith(pendingWithLink())
    await expect(s.update('pr1', { status: 'cancelled' }, currentUser)).rejects.toThrow('ya fue abonado')
    expect(patches).toHaveLength(0)
  })

  it('si Stripe falla, el estado NO cambia (liberar el techo con el link vivo es el bug)', async () => {
    stubStripe({ expireCheckoutSession: (async () => { throw new Error('stripe caido') }) as typeof StripeService.expireCheckoutSession })
    const { s, patches } = serviceWith(pendingWithLink())
    await expect(s.update('pr1', { status: 'cancelled' }, currentUser)).rejects.toThrow('stripe caido')
    expect(patches).toHaveLength(0)
  })

  it('COR-C: marcar `paid` a mano sobre una sesión YA abonada corta con 409 — lo liquida el webhook', async () => {
    stubStripe({ expireCheckoutSession: (async () => 'paid') as typeof StripeService.expireCheckoutSession })
    const { s, patches } = serviceWith(pendingWithLink())
    // Antes este PUT pasaba: la fila quedaba `paid` y `stripe-webhook.ts` descartaba la liquidación
    // entera (`pr.status === 'paid'` → return) — sin fila en `payments`, sin cargo de folio, sin
    // bump de `deposit` y sin audit. Ahora se corta: el webhook es quien asienta esa plata.
    await expect(s.update('pr1', { status: 'paid' }, currentUser)).rejects.toThrow('ya fue abonado')
    expect(patches).toHaveLength(0)
  })

  it('marcar `paid` a mano con sesión SIN abonar sigue siendo válido (cobró por otra vía)', async () => {
    stubStripe({ expireCheckoutSession: (async () => 'expired') as typeof StripeService.expireCheckoutSession })
    const { s, patches } = serviceWith(pendingWithLink())
    await s.update('pr1', { status: 'paid' }, currentUser)
    expect(patches[0]).toMatchObject({ status: 'paid', stripePaymentUrl: '' })
  })

  it('un update que no toca el estado no expira nada', async () => {
    const { s } = serviceWith(pendingWithLink())
    await s.update('pr1', { sentTo: 'otro@x.com' }, currentUser)
    expect(spy.expired).toHaveLength(0)
  })

  it('borrar un cobro pendiente mata su sesión antes de sacar la fila', async () => {
    const { s, deleted } = serviceWith(pendingWithLink())
    await s.delete('pr1', currentUser)
    expect(spy.expired).toEqual([{ sessionId: 'sess_old', hotelId: 'h1' }])
    expect(deleted).toEqual(['pr1'])
  })

  it('borrar un cobro ya abonado por el link corta con 409 y NO borra la fila', async () => {
    stubStripe({ expireCheckoutSession: (async () => 'paid') as typeof StripeService.expireCheckoutSession })
    const { s, deleted } = serviceWith(pendingWithLink())
    await expect(s.delete('pr1', currentUser)).rejects.toThrow('ya fue abonado')
    expect(deleted).toHaveLength(0)
  })
})

describe('GH-0.3 · un cobro, a lo sumo una sesión viva', () => {
  it('dos clicks sobre el mismo cobro reutilizan la sesión abierta: NO se crea una segunda', async () => {
    stubStripe({
      getSession: (async () => ({
        id: 'sess_old', status: 'open', url: 'https://pay/old', amount_total: 30000,
      })) as unknown as typeof StripeService.getSession,
    })
    const { s } = serviceWith(pendingWithLink())
    const a = await s.createCheckout('pr1', currentUser, 'https://panel') as any
    const b = await s.createCheckout('pr1', currentUser, 'https://panel') as any
    expect(a.sessionId).toBe('sess_old')
    expect(b.sessionId).toBe('sess_old')
    expect(spy.created).toHaveLength(0)
    expect(spy.expired).toHaveLength(0)
  })

  it('si el monto del cobro cambió, la sesión vieja se expira antes de emitir la nueva', async () => {
    stubStripe({
      getSession: (async () => ({
        id: 'sess_old', status: 'open', url: 'https://pay/old', amount_total: 10000, // $100 ≠ $300
      })) as unknown as typeof StripeService.getSession,
    })
    const { s } = serviceWith(pendingWithLink())
    const out = await s.createCheckout('pr1', currentUser, 'https://panel') as any
    expect(spy.expired).toEqual([{ sessionId: 'sess_old', hotelId: 'h1' }])
    expect(spy.created).toHaveLength(1)
    expect(out.sessionId).toBe('sess_1')
  })

  it('sin sesión previa se emite una sola y no se consulta Stripe de más', async () => {
    const { s } = serviceWith(pendingWithLink({ stripeSessionId: '', stripePaymentUrl: '' }))
    await s.createCheckout('pr1', currentUser, 'https://panel')
    expect(spy.retrieved).toHaveLength(0)
    expect(spy.created).toHaveLength(1)
  })
})

describe('GH-0.4 · el tenant del checkout sale de la fila, no del JWT', () => {
  it('un super_admin de otro hotel emite la sesión contra la cuenta Stripe del cobro', async () => {
    const superAdmin: CurrentUser = { id: 'u1', hotelId: 'h1', role: 'super_admin' }
    const { s } = serviceWith(pendingWithLink({ hotelId: 'h2', stripeSessionId: '', stripePaymentUrl: '' }), 'h2')
    await s.createCheckout('pr1', superAdmin, 'https://panel')
    // Antes: isConfigured y la cuenta Stripe salían de `hotelOfUser(user)` = 'h1', mientras la
    // metadata (que el webhook coteja) decía 'h2' → 403 con la plata ya cobrada.
    expect(spy.configuredFor).toEqual(['h2'])
    expect(spy.created[0].hotelId).toBe('h2')
    expect(spy.created[0].metadata?.hotelId).toBe('h2')
  })
})
