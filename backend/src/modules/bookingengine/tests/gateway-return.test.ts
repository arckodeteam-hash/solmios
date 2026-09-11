// gateway-return.test.ts — #196 (PG-4.3): retorno del navegador desde una pasarela SIN webhook.
//
// Azul Payment Page manda al huésped de vuelta con el resultado en la query (hash sobre campos
// fijos) y CardNet devuelve un token para ir a consultar. Ninguno avisa por webhook: si el
// retorno cae directo en la página del frontend, nadie llama a `confirm()` y la reserva queda
// `pending` con el dinero cobrado. Estos tests fijan que:
//   1. createCheckoutSession envuelve las URLs de retorno por `/api/pay/return/:provider/:hotelId`
//      SOLO para proveedores sin webhook (Stripe sigue yendo directo).
//   2. handleReturn asienta el pago igual que el webhook (misma barrera de idempotencia, misma
//      cascada de grupo) y NO asienta nada si el hash es inválido, si el proveedor no es el del
//      hotel, o si la reserva es de otro hotel.
//   3. El controller redirige (302) a `next` con `payment=…`, y `next` no puede ser un open redirect.
import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { StripeUseCase, wrapReturnUrls } from '../usecases/stripe'
import { safeReturnTarget, redirectTo } from '../controller'
import type { PaymentGatewayRegistry } from '../../../services/payment-gateway/registry'
import type { PaymentGateway, PaymentOutcome, ConfirmContext } from '../../../services/payment-gateway/types'
import { PaymentEventStore } from '../../../services/payment-gateway/payment-events'
import type { PaymentEventRow } from '../../../services/payment-gateway/payment-events'

const PAID: PaymentOutcome = { eventId: 'azul-order-77', providerRef: 'azul-order-77', status: 'paid', amountMinor: 20000, currency: 'usd', reference: 'res-1' }

function makeAzulGw(confirm: (ctx: ConfirmContext) => Promise<PaymentOutcome | null>, provider: PaymentGateway['provider'] = 'azul'): PaymentGateway {
  return {
    provider, mode: 'test',
    capabilities: { refund: false, void: false, paymentLinks: false, confirmation: 'return' },
    createCharge: async (req: any) => ({ status: 'redirect', redirectUrl: `https://pruebas.azul.com.do/pp?ok=${encodeURIComponent(req.successUrl)}`, providerRef: 'RES-1' }),
    confirm,
  } as PaymentGateway
}
const registryOf = (gw: PaymentGateway | null): PaymentGatewayRegistry =>
  ({ isConfigured: async () => gw !== null, resolve: async () => gw, invalidate: () => {} }) as unknown as PaymentGatewayRegistry

function reservationsRepo(initial: any[]) {
  const store = [...initial]; const updates: Array<{ id: string; patch: any }> = []
  const repo = {
    findMany: async (q: any = {}) => store.filter((r) => Object.entries(q).every(([k, v]) => r[k] === v)),
    findById: async (id: string) => store.find((r) => r.id === id) ?? null,
    findOne: async (q: any) => store.find((r) => r.id === q?.id) ?? null,
    create: async (d: any) => { store.push(d); return d },
    update: async (id: string, patch: any) => { updates.push({ id, patch }); const i = store.findIndex((r) => r.id === id); if (i >= 0) store[i] = { ...store[i], ...patch }; return store[i] },
    delete: async () => true, count: async () => store.length,
    paginate: async () => ({ data: store.slice(), total: store.length, limit: 20, offset: 0, pages: 1 }),
  } as RepositoryAdapter<any>
  return { repo, store, updates }
}
function eventsStore() {
  const rows: any[] = []
  const repo = {
    findMany: async () => rows.slice(), findById: async () => null, findOne: async () => null,
    create: async (d: any) => { if (rows.some((r) => r.id === d.id)) { const e = new Error(`UNIQUE constraint failed: payment_events.id='${d.id}'`); (e as any).code = 'SQLITE_CONSTRAINT'; throw e } rows.push(d); return d },
    update: async () => null, delete: async (id: string) => { const i = rows.findIndex((r) => r.id === id); if (i >= 0) rows.splice(i, 1); return true },
    count: async () => rows.length, paginate: async () => ({ data: rows.slice(), total: rows.length, limit: 20, offset: 0, pages: 1 }),
  } as RepositoryAdapter<PaymentEventRow>
  return new PaymentEventStore(repo, silentLogger())
}
const pending = (over: any = {}) => ({ id: 'res-1', hotelId: 'hotel-A', roomId: 'room-1', checkIn: '2026-10-10', checkOut: '2026-10-12', totalAmount: 200, deposit: 0, currency: 'USD', status: 'pending', accessToken: 'tok-1', ...over })

describe('createCheckoutSession — URLs de retorno (#196)', () => {
  it('para un proveedor sin webhook, el retorno pasa por /api/pay/return con `next` = página final', async () => {
    const { repo } = reservationsRepo([pending()])
    const gw = makeAzulGw(async () => PAID)
    const uc = new StripeUseCase(repo, silentLogger(), registryOf(gw), eventsStore())
    const session = await uc.createCheckoutSession('res-1', 200, 'https://hotel.test/h/demo/confirm?booking=:id&token=:token', 'https://hotel.test/book/demo?cancelled=1')
    const ok = new URL(session.url).searchParams.get('ok') || ''
    expect(ok.startsWith('https://hotel.test/api/pay/return/azul/hotel-A?next=')).toBe(true)
    const next = new URL(ok).searchParams.get('next') || ''
    expect(next).toContain('/confirm?booking=res-1&token=tok-1')
  })

  it('Stripe (webhook) sigue yendo directo a la página de confirmación', async () => {
    const { repo } = reservationsRepo([pending()])
    const gw = { ...makeAzulGw(async () => PAID), provider: 'stripe', capabilities: { refund: true, void: true, paymentLinks: true, confirmation: 'push' } } as PaymentGateway
    const uc = new StripeUseCase(repo, silentLogger(), registryOf(gw), eventsStore())
    const session = await uc.createCheckoutSession('res-1', 200, 'https://hotel.test/h/demo/confirm?booking=:id&token=:token', 'https://hotel.test/book/demo?cancelled=1')
    const ok = new URL(session.url).searchParams.get('ok') || ''
    expect(ok).toContain('https://hotel.test/h/demo/confirm?booking=res-1')
    expect(ok).not.toContain('/api/pay/return/')
  })

  it('wrapReturnUrls sin base absoluta deja las URLs como estaban (no rompe dev)', () => {
    const urls = { successUrl: '/h/demo/confirm?booking=1', cancelUrl: '/book/demo' }
    expect(wrapReturnUrls('azul', 'h1', urls, '')).toEqual(urls)
  })
})

describe('handleReturn — asiento del pago por retorno (#196)', () => {
  it('hash válido + aprobado → la reserva queda confirmada con el depósito cobrado, y el retorno repetido no duplica', async () => {
    const { repo, store } = reservationsRepo([pending()])
    const seen: ConfirmContext[] = []
    const gw = makeAzulGw(async (ctx) => { seen.push(ctx); return PAID })
    const uc = new StripeUseCase(repo, silentLogger(), registryOf(gw), eventsStore())

    const first = await uc.handleReturn('hotel-A', 'azul', { OrderNumber: 'res-1', Amount: '20000', ResponseCode: '00', AuthHash: 'abc' })
    expect(first?.type).toBe('reservation_confirmed')
    expect(first?.reservationId).toBe('res-1')
    expect(store[0].status).toBe('confirmed')
    expect(store[0].depositStatus).toBe('paid')
    expect(store[0].deposit).toBe(200)
    expect(store[0].pendingAmount).toBe(0)
    // El adapter recibió la query cruda: él decide si el hash es auténtico.
    expect(seen[0]?.query?.AuthHash).toBe('abc')

    // El huésped aprieta F5 en la página de retorno: mismo eventId → ya procesado, sin segundo asiento.
    const again = await uc.handleReturn('hotel-A', 'azul', { OrderNumber: 'res-1', Amount: '20000', ResponseCode: '00', AuthHash: 'abc' })
    expect(again?.type).toBe('already_processed')
  })

  it('hash inválido (confirm → null) → null y la reserva NO se toca', async () => {
    const { repo, store, updates } = reservationsRepo([pending()])
    const uc = new StripeUseCase(repo, silentLogger(), registryOf(makeAzulGw(async () => null)), eventsStore())
    expect(await uc.handleReturn('hotel-A', 'azul', { OrderNumber: 'res-1', AuthHash: 'forjado' })).toBeNull()
    expect(store[0].status).toBe('pending')
    expect(updates).toHaveLength(0)
  })

  it('el proveedor de la ruta tiene que ser el del hotel: /return/cardnet/ contra un hotel con Azul → null', async () => {
    const { repo, updates } = reservationsRepo([pending()])
    const uc = new StripeUseCase(repo, silentLogger(), registryOf(makeAzulGw(async () => PAID)), eventsStore())
    expect(await uc.handleReturn('hotel-A', 'cardnet', { TrxToken: 'x' })).toBeNull()
    expect(updates).toHaveLength(0)
  })

  it('un proveedor con webhook (push) no confirma por redirect', async () => {
    const { repo, updates } = reservationsRepo([pending()])
    const gw = { ...makeAzulGw(async () => PAID), provider: 'stripe', capabilities: { refund: true, void: true, paymentLinks: true, confirmation: 'push' } } as PaymentGateway
    const uc = new StripeUseCase(repo, silentLogger(), registryOf(gw), eventsStore())
    expect(await uc.handleReturn('hotel-A', 'stripe', { OrderNumber: 'res-1' })).toBeNull()
    expect(updates).toHaveLength(0)
  })

  it('la reserva de OTRO hotel no se confirma aunque el hash sea válido', async () => {
    const { repo, updates } = reservationsRepo([pending({ hotelId: 'hotel-B' })])
    const uc = new StripeUseCase(repo, silentLogger(), registryOf(makeAzulGw(async () => PAID)), eventsStore())
    expect(await uc.handleReturn('hotel-A', 'azul', { OrderNumber: 'res-1', AuthHash: 'abc' })).toBeNull()
    expect(updates).toHaveLength(0)
  })

  it('declinado → type failed, sin asiento', async () => {
    const { repo, updates } = reservationsRepo([pending()])
    const uc = new StripeUseCase(repo, silentLogger(), registryOf(makeAzulGw(async () => ({ ...PAID, status: 'failed' }))), eventsStore())
    expect((await uc.handleReturn('hotel-A', 'azul', { OrderNumber: 'res-1', ResponseCode: 'Declined', AuthHash: 'abc' }))?.type).toBe('failed')
    expect(updates).toHaveLength(0)
  })

  it('CardNet (pull): el TrxToken de la query llega al adapter como providerRef', async () => {
    const { repo } = reservationsRepo([pending()])
    const seen: ConfirmContext[] = []
    const gw = { ...makeAzulGw(async (ctx) => { seen.push(ctx); return PAID }, 'cardnet'), capabilities: { refund: false, void: false, paymentLinks: false, confirmation: 'pull' } } as PaymentGateway
    const uc = new StripeUseCase(repo, silentLogger(), registryOf(gw), eventsStore())
    await uc.handleReturn('hotel-A', 'cardnet', { TrxToken: 'trx-9' })
    expect(seen[0]?.providerRef).toBe('trx-9')
  })
})

describe('controller — redirect seguro (#196)', () => {
  it('acepta path relativo y URL absoluta del propio origen; rechaza otros orígenes y esquemas raros', () => {
    const base = 'https://hotel.zx89.site'
    expect(safeReturnTarget('/h/demo/confirm?booking=1&token=t', base)).toBe('/h/demo/confirm?booking=1&token=t')
    expect(safeReturnTarget('https://hotel.zx89.site/h/demo/confirm?booking=1', base)).toBe('https://hotel.zx89.site/h/demo/confirm?booking=1')
    expect(safeReturnTarget('https://impostor.example/robo', base)).toBe('/')
    expect(safeReturnTarget('//impostor.example/robo', base)).toBe('/')
    expect(safeReturnTarget('javascript:alert(1)', base)).toBe('/')
    expect(safeReturnTarget('', base)).toBe('/')
    // Sin PUBLIC_BASE_URL no hay con qué comparar un absoluto: solo se aceptan relativos.
    expect(safeReturnTarget('https://hotel.zx89.site/x', undefined)).toBe('/')
  })

  it('redirectTo agrega payment= sin pisar la query existente', () => {
    expect(redirectTo('/h/demo/confirm?booking=1', 'confirmed')).toEqual({ status: 302, headers: { Location: '/h/demo/confirm?booking=1&payment=confirmed' }, body: '' })
    expect(redirectTo('/book/demo', 'unverified').headers.Location).toBe('/book/demo?payment=unverified')
  })
})
