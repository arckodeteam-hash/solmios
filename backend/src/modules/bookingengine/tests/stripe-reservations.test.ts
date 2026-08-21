// bookingengine/tests/stripe-reservations.test.ts — F0 0.15
// spec: openspec/changes/solmi-direct-booking/specs/booking-unification/spec.md
//
// Cubre la reescritura de StripeUseCase para operar sobre `Reservations` (NO `BookingEngine`):
//   1. createCheckoutSession lee de `repo('Reservations').findOne({id})`, NO bookingRepo.
//   2. createCheckoutSession pasa `idempotencyKey: reservationId` al gateway (spec §7).
//   3. handleWebhook actualiza `repo('Reservations')` con status='confirmed' (NO bookingRepo).
//   4. Webhook duplicado → idempotencia (PaymentEventStore bloquea el doble efecto).
//   5. Flujo completo: createCheckoutSession → webhook → reservation confirmed.
//   6. Webhook de hotel A no confirma reserva del hotel B (multi-tenancy guard).
//
// El test mockea `gw` (gateway Stripe) con un PaymentOutcome válido. No llama a la API real.
import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { StripeUseCase } from '../usecases/stripe'
import type { PaymentGatewayRegistry } from '../../../services/payment-gateway/registry'
import type { PaymentGateway, PaymentOutcome } from '../../../services/payment-gateway/types'
import { PaymentEventStore } from '../../../services/payment-gateway/payment-events'
import type { PaymentEventRow } from '../../../services/payment-gateway/payment-events'

const log: Logger = silentLogger()

// ─── Mocks ────────────────────────────────────────────────

interface MockGwOptions {
  outcome?: PaymentOutcome | null   // null = "firma inválida" (gw.confirm devuelve null)
  charge?: { redirectUrl: string; providerRef: string; status: 'redirect' } | { status: 'failed'; reason: string }
}

function makeMockGw(opts: MockGwOptions = {}): PaymentGateway {
  const defaultOutcome: PaymentOutcome = {
    eventId: 'evt_test_1',
    providerRef: 'cs_test_1',
    status: 'paid',
    amountMinor: 20000,
    currency: 'usd',
    reference: 'res-1',
  }
  return {
    provider: 'stripe',
    mode: 'test',
    capabilities: { refund: true, void: true, paymentLinks: true, confirmation: 'push' },
    createCharge: async () => opts.charge ?? {
      status: 'redirect',
      redirectUrl: 'https://stripe.example/checkout/cs_test_1',
      providerRef: 'cs_test_1',
    },
    confirm: async () => opts.outcome === undefined ? defaultOutcome : opts.outcome,
  } as PaymentGateway
}

function makeMockRegistry(gw: PaymentGateway | null): PaymentGatewayRegistry {
  return {
    isConfigured: async () => gw !== null,
    resolve: async () => gw,
    invalidate: () => {},
  } as unknown as PaymentGatewayRegistry
}

function makeReservationsRepo(initial: any[] = []): { repo: RepositoryAdapter<any>; store: any[]; updates: any[] } {
  const store = [...initial]
  const updates: Array<{ id: string; patch: any }> = []
  const repo: RepositoryAdapter<any> = {
    findMany: async () => store.slice(),
    findById: async (id: string) => store.find((r) => r.id === id) ?? null,
    findOne: async (q: any) => store.find((r) => r.id === q?.id) ?? null,
    create: async (data: any) => { store.push(data); return data },
    update: async (id: string, patch: any) => {
      updates.push({ id, patch })
      const idx = store.findIndex((r) => r.id === id)
      if (idx >= 0) store[idx] = { ...store[idx], ...patch }
      return store[idx]
    },
    delete: async () => true,
    count: async () => store.length,
    paginate: async () => ({ data: store.slice(), total: store.length, limit: 20, offset: 0, pages: 1 }),
  }
  return { repo, store, updates }
}

function makeEventStoreRepo(): { repo: RepositoryAdapter<PaymentEventRow>; rows: any[] } {
  const rows: any[] = []
  const repo: RepositoryAdapter<PaymentEventRow> = {
    findMany: async () => rows.slice(),
    findById: async () => null,
    findOne: async () => null,
    // Simula la PK del DB: si el id ya está, tira "UNIQUE constraint failed" (igual que SQLite).
    // Sin esto, el mock siempre acepta el create y el PaymentEventStore nunca detecta duplicados.
    create: async (data: any) => {
      if (rows.some((r) => r.id === data.id)) {
        const err = new Error(`UNIQUE constraint failed: payment_events.id='${data.id}'`)
        ;(err as any).code = 'SQLITE_CONSTRAINT'
        throw err
      }
      rows.push(data)
      return data
    },
    update: async () => null,
    delete: async (id: string) => {
      const idx = rows.findIndex((r) => r.id === id)
      if (idx >= 0) rows.splice(idx, 1)
      return true
    },
    count: async () => rows.length,
    paginate: async () => ({ data: rows.slice(), total: rows.length, limit: 20, offset: 0, pages: 1 }),
  }
  return { repo, rows }
}

// Reserva fixture: pre-pago, pendiente, con accessToken (creada por flujo público F0 0.13).
const PENDING_RESERVATION = {
  id: 'res-1',
  hotelId: 'hotel-A',
  roomId: 'room-1',
  guestId: 'guest-1',
  checkIn: '2026-08-10',
  checkOut: '2026-08-12',
  totalAmount: 200,
  currency: 'USD',
  status: 'pending',
  depositStatus: 'unpaid',
  paymentMethod: '',
  pendingAmount: 200,
  accessToken: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
}

// ─── Tests ────────────────────────────────────────────────

describe('StripeUseCase — createCheckoutSession sobre Reservations (F0 0.15)', () => {
  it('lee la reserva de repo(Reservations) y pasa idempotencyKey=reservationId al gw', async () => {
    const { repo: reservationsRepo } = makeReservationsRepo([{ ...PENDING_RESERVATION }])
    let capturedCharge: any = null
    const gw = makeMockGw()
    gw.createCharge = async (req: any) => {
      capturedCharge = req
      return { status: 'redirect', redirectUrl: 'https://stripe.example/c/cs_test_1', providerRef: 'cs_test_1' }
    }
    const stripe = new StripeUseCase(reservationsRepo, log, makeMockRegistry(gw))

    const session = await stripe.createCheckoutSession('res-1', 200, 'https://app/s', 'https://app/c')

    expect(session.url).toBe('https://stripe.example/c/cs_test_1')
    expect(session.id).toBe('cs_test_1')
    // F0 0.15 spec §7 — idempotency_key es NUEVO. Debe viajar al gw como reservationId.
    expect(capturedCharge.idempotencyKey).toBe('res-1')
    expect(capturedCharge.reference).toBe('res-1')
    // Multi-tenancy: el hotelId del charge es el de la reserva, no un default global.
    expect(capturedCharge.hotelId).toBe('hotel-A')
    // Monto en centavos (no se multiplica dos veces).
    expect(capturedCharge.amountMinor).toBe(20000)
  })

  it('throw ValidationError si la reserva no existe en Reservations', async () => {
    const { repo: reservationsRepo } = makeReservationsRepo([]) // sin reservas
    const gw = makeMockGw()
    const stripe = new StripeUseCase(reservationsRepo, log, makeMockRegistry(gw))

    expect(stripe.createCheckoutSession('missing', 100, 'https://s', 'https://c'))
      .rejects.toThrow(/Reserva no encontrada/)
  })

  it('throw ValidationError si el hotel no tiene pasarela configurada', async () => {
    const { repo: reservationsRepo } = makeReservationsRepo([{ ...PENDING_RESERVATION }])
    const stripe = new StripeUseCase(reservationsRepo, log, makeMockRegistry(null))

    expect(stripe.createCheckoutSession('res-1', 200, 'https://s', 'https://c'))
      .rejects.toThrow(/pasarela de pago configurada/)
  })
})

describe('StripeUseCase — handleWebhook sobre Reservations (F0 0.15)', () => {
  it('actualiza Reservations con status=confirmed + depositStatus=paid (NO bookingRepo)', async () => {
    const { repo: reservationsRepo, updates } = makeReservationsRepo([{ ...PENDING_RESERVATION }])
    const { repo: eventRepo } = makeEventStoreRepo()
    const eventStore = new PaymentEventStore(eventRepo, log)
    const gw = makeMockGw({ outcome: {
      eventId: 'evt_001', providerRef: 'cs_001', status: 'paid',
      amountMinor: 20000, currency: 'usd', reference: 'res-1',
    } })
    const stripe = new StripeUseCase(reservationsRepo, log, makeMockRegistry(gw), eventStore)

    const result = await stripe.handleWebhook('hotel-A', 'raw-body-bytes', 'sig-header')

    expect(result).not.toBeNull()
    expect(result?.type).toBe('reservation_confirmed')
    expect(result?.reservationId).toBe('res-1')
    // El update fue sobre Reservations (NO bookingRepo).
    expect(updates).toHaveLength(1)
    expect(updates[0].id).toBe('res-1')
    expect(updates[0].patch.status).toBe('confirmed')
    // paymentStatus no existe en tabla Reservations → equivalentes operacionales (spec §7).
    expect(updates[0].patch.depositStatus).toBe('paid')
    expect(updates[0].patch.paymentMethod).toBe('card')
    expect(updates[0].patch.pendingAmount).toBe(0)
    // STR-2: `deposit` asienta lo realmente cobrado. Antes quedaba en 0 y sólo se escribía
    // `pendingAmount: 0` hardcodeado → el detalle (que recalcula total − deposit) decía "debe 200".
    expect(updates[0].patch.deposit).toBe(200)
    // B-1 (2026-08-19): el result arrastra los datos que el socket onBookingPaid necesita
    // para que el connector de payments asiente el cobro (antes solo {id} → early-return).
    expect(result?.providerRef).toBe('cs_001')
    expect(result?.amountMinor).toBe(20000)
    expect(result?.currency).toBe('usd')
    expect(result?.totalAmount).toBe(Number(PENDING_RESERVATION.totalAmount) || 0)
    expect(result?.checkIn).toBe(PENDING_RESERVATION.checkIn)
  })

  // STR-2: `pendingAmount: 0` estaba hardcodeado. Un cobro parcial (seña) dejaba la fila diciendo
  // "no debe nada" mientras el detalle de la reserva mostraba el saldo real.
  it('un pago PARCIAL deja el saldo real, no 0 (pendingAmount ya no es hardcodeado)', async () => {
    const { repo: reservationsRepo, updates } = makeReservationsRepo([{ ...PENDING_RESERVATION }])
    const { repo: eventRepo } = makeEventStoreRepo()
    const eventStore = new PaymentEventStore(eventRepo, log)
    const gw = makeMockGw({ outcome: {
      eventId: 'evt_partial', providerRef: 'cs_partial', status: 'paid',
      amountMinor: 5000, currency: 'usd', reference: 'res-1', // $50 de $200
    } })
    const stripe = new StripeUseCase(reservationsRepo, log, makeMockRegistry(gw), eventStore)

    await stripe.handleWebhook('hotel-A', 'raw-body-bytes', 'sig-header')

    expect(updates[0].patch.deposit).toBe(50)
    expect(updates[0].patch.pendingAmount).toBe(150)
  })

  it('webhook del Hotel A NO confirma reserva del Hotel B (multi-tenancy)', async () => {
    const { repo: reservationsRepo } = makeReservationsRepo([{ ...PENDING_RESERVATION }])
    const { repo: eventRepo } = makeEventStoreRepo()
    const eventStore = new PaymentEventStore(eventRepo, log)
    const gw = makeMockGw({ outcome: {
      eventId: 'evt_002', providerRef: 'cs_002', status: 'paid',
      amountMinor: 20000, currency: 'usd', reference: 'res-1', // reserva es del hotel-A
    } })
    const stripe = new StripeUseCase(reservationsRepo, log, makeMockRegistry(gw), eventStore)

    // El webhook llega con hotelId='hotel-B' tratando de confirmar la reserva de 'hotel-A'.
    const result = await stripe.handleWebhook('hotel-B', 'raw', 'sig')

    expect(result).toBeNull() // se rechaza silenciosamente, mismo que firma inválida
  })

  it('webhook duplicado → idempotencia: NO se updatea dos veces (no doble cobro)', async () => {
    const { repo: reservationsRepo, updates } = makeReservationsRepo([{ ...PENDING_RESERVATION }])
    const { repo: eventRepo } = makeEventStoreRepo()
    const eventStore = new PaymentEventStore(eventRepo, log)
    const gw = makeMockGw({ outcome: {
      eventId: 'evt_dup', providerRef: 'cs_dup', status: 'paid',
      amountMinor: 20000, currency: 'usd', reference: 'res-1',
    } })
    const stripe = new StripeUseCase(reservationsRepo, log, makeMockRegistry(gw), eventStore)

    const first = await stripe.handleWebhook('hotel-A', 'raw', 'sig')
    const second = await stripe.handleWebhook('hotel-A', 'raw', 'sig') // reintento Stripe

    expect(first?.type).toBe('reservation_confirmed')
    // Segundo webhook: mismo eventId → ya procesado, no vuelve a correr el effect.
    expect(second?.type).toBe('already_processed')
    expect(updates).toHaveLength(1) // UN solo update sobre la reserva, no dos
  })

  it('firma inválida → null (no toca nada)', async () => {
    const { repo: reservationsRepo, updates } = makeReservationsRepo([{ ...PENDING_RESERVATION }])
    const { repo: eventRepo } = makeEventStoreRepo()
    const eventStore = new PaymentEventStore(eventRepo, log)
    const gw = makeMockGw({ outcome: null }) // gw.confirm devuelve null = firma inválida
    const stripe = new StripeUseCase(reservationsRepo, log, makeMockRegistry(gw), eventStore)

    const result = await stripe.handleWebhook('hotel-A', 'raw', 'bad-sig')

    expect(result).toBeNull()
    expect(updates).toHaveLength(0)
  })
})

// Tarea 10 (QA 2026-08-20/21) — reserva de GRUPO: la Checkout Session se abre sobre la reserva
// LÍDER (`createPublicBookingGroup`), pero el pago cubre TODAS las habitaciones del grupo. El
// webhook tiene que confirmar el grupo entero, no solo la fila sobre la que se armó la sesión.
describe('StripeUseCase — handleWebhook cascada a reservas de GRUPO (Tarea 10)', () => {
  const GROUP_ID = 'grp-1'
  const SIBLING_A = { ...PENDING_RESERVATION, id: 'res-2', roomId: 'room-2', groupId: GROUP_ID, totalAmount: 100 }
  const SIBLING_B = { ...PENDING_RESERVATION, id: 'res-3', roomId: 'room-3', groupId: GROUP_ID, totalAmount: 100 }
  const LEADER = { ...PENDING_RESERVATION, id: 'res-1', groupId: GROUP_ID, totalAmount: 200 }

  it('confirma la líder Y a las hermanas del mismo groupId (un solo cobro, 3 reservas)', async () => {
    const { repo: reservationsRepo, store, updates } = makeReservationsRepo([LEADER, SIBLING_A, SIBLING_B])
    const { repo: eventRepo } = makeEventStoreRepo()
    const eventStore = new PaymentEventStore(eventRepo, log)
    const gw = makeMockGw({ outcome: {
      eventId: 'evt_group', providerRef: 'cs_group', status: 'paid',
      amountMinor: 40000, currency: 'usd', reference: 'res-1', // Stripe confirma sobre la LÍDER
    } })
    const stripe = new StripeUseCase(reservationsRepo, log, makeMockRegistry(gw), eventStore)

    const result = await stripe.handleWebhook('hotel-A', 'raw', 'sig')

    expect(result?.type).toBe('reservation_confirmed')
    expect(result?.reservationId).toBe('res-1')
    // Las 3 quedan `confirmed` — no solo la líder sobre la que se abrió la sesión.
    expect(store.find((r) => r.id === 'res-1')!.status).toBe('confirmed')
    expect(store.find((r) => r.id === 'res-2')!.status).toBe('confirmed')
    expect(store.find((r) => r.id === 'res-3')!.status).toBe('confirmed')
    expect(store.every((r) => r.depositStatus === 'paid' && r.paymentMethod === 'card' && r.pendingAmount === 0)).toBe(true)
    // 1 update por la líder + 1 por cada hermana = 3 (no se re-actualiza la líder dos veces).
    expect(updates).toHaveLength(3)
    expect(updates.map((u) => u.id).sort()).toEqual(['res-1', 'res-2', 'res-3'])
  })

  it('reserva SIN groupId (flujo normal de 1 habitación) no dispara ninguna cascada', async () => {
    const { repo: reservationsRepo, updates } = makeReservationsRepo([{ ...PENDING_RESERVATION }]) // sin groupId
    const { repo: eventRepo } = makeEventStoreRepo()
    const eventStore = new PaymentEventStore(eventRepo, log)
    const gw = makeMockGw({ outcome: {
      eventId: 'evt_solo', providerRef: 'cs_solo', status: 'paid',
      amountMinor: 20000, currency: 'usd', reference: 'res-1',
    } })
    const stripe = new StripeUseCase(reservationsRepo, log, makeMockRegistry(gw), eventStore)

    await stripe.handleWebhook('hotel-A', 'raw', 'sig')

    expect(updates).toHaveLength(1) // solo la propia reserva, sin cascada
  })

  it('webhook duplicado de un grupo → cascada NO se repite (idempotencia también para las hermanas)', async () => {
    const { repo: reservationsRepo, updates } = makeReservationsRepo([LEADER, SIBLING_A, SIBLING_B])
    const { repo: eventRepo } = makeEventStoreRepo()
    const eventStore = new PaymentEventStore(eventRepo, log)
    const gw = makeMockGw({ outcome: {
      eventId: 'evt_group_dup', providerRef: 'cs_group_dup', status: 'paid',
      amountMinor: 40000, currency: 'usd', reference: 'res-1',
    } })
    const stripe = new StripeUseCase(reservationsRepo, log, makeMockRegistry(gw), eventStore)

    await stripe.handleWebhook('hotel-A', 'raw', 'sig')
    const second = await stripe.handleWebhook('hotel-A', 'raw', 'sig') // reintento Stripe

    expect(second?.type).toBe('already_processed')
    expect(updates).toHaveLength(3) // sigue en 3 — el reintento no vuelve a cascadear
  })
})

describe('StripeUseCase — flujo completo createSession → webhook (F0 0.15)', () => {
  it('crea sesión y luego el webhook confirma la reserva', async () => {
    // Estado inicial: reserva pending pre-pago (acaba de crearse por createPublicBookingDirect).
    const { repo: reservationsRepo, store, updates } = makeReservationsRepo([{ ...PENDING_RESERVATION }])
    const { repo: eventRepo } = makeEventStoreRepo()
    const eventStore = new PaymentEventStore(eventRepo, log)
    const gw = makeMockGw()
    const stripe = new StripeUseCase(reservationsRepo, log, makeMockRegistry(gw), eventStore)

    // 1. createCheckoutSession → devuelve URL de Stripe.
    const session = await stripe.createCheckoutSession('res-1', 200, 'https://app/s', 'https://app/c')
    expect(session.url).toMatch(/stripe\.example/)

    // 2. El webhook llega (simulado): el mismo `reference` vuelve como `res-1`.
    const result = await stripe.handleWebhook('hotel-A', 'raw-body', 'stripe-sig')
    expect(result?.type).toBe('reservation_confirmed')

    // 3. La reserva en store quedó confirmada.
    const final = store.find((r) => r.id === 'res-1')
    expect(final.status).toBe('confirmed')
    expect(final.depositStatus).toBe('paid')
    expect(updates).toHaveLength(1)
  })
})

// ─── Hardening go-live — successUrl/cancelUrl REALES (no placeholders) ───────
// El frontend manda `/h/:slug/confirm?booking=:id&token=:token` (placeholders literales).
// Antes el backend los pasaba así a Stripe → redirect rompía booking-confirmation.vue si el
// huésped limpiaba sessionStorage. Ahora el backend construye URLs reales con valores reales.
describe('StripeUseCase — successUrl/cancelUrl con valores reales (hardening go-live)', () => {
  it('con PUBLIC_BASE_URL + hotelsRepo → successUrl real con slug + reservationId + accessToken', async () => {
    const prevBase = process.env.PUBLIC_BASE_URL
    process.env.PUBLIC_BASE_URL = 'https://book.example.com'
    try {
      const { repo: reservationsRepo } = makeReservationsRepo([{ ...PENDING_RESERVATION }])
      const hotelsRepo: RepositoryAdapter<any> = {
        findMany: async () => [],
        findById: async () => null,
        findOne: async () => ({ id: 'hotel-A', slug: 'caribe-paradise' }),
        create: async () => null, update: async () => null, delete: async () => true,
        count: async () => 0, paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0 }),
      }
      let captured: any = null
      const gw = makeMockGw()
      gw.createCharge = async (req: any) => { captured = req; return { status: 'redirect', redirectUrl: 'https://stripe/c/cs', providerRef: 'cs' } }
      const stripe = new StripeUseCase(reservationsRepo, log, makeMockRegistry(gw), undefined, hotelsRepo)

      // El widget pasa placeholders LITERALES — el backend los descarta y construye reales.
      await stripe.createCheckoutSession(
        'res-1', 200,
        'https://widget.example/h/:slug/confirm?booking=:id&token=:token',
        'https://widget.example/book/:slug',
      )

      expect(captured).not.toBeNull()
      // successUrl REAL: baseUrl del env + slug del hotel + reservationId + accessToken.
      expect(captured.successUrl).toBe(
        'https://book.example.com/h/caribe-paradise/confirm?booking=res-1&token=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      )
      // cancelUrl REAL: baseUrl del env + slug.
      expect(captured.cancelUrl).toBe('https://book.example.com/book/caribe-paradise?cancelled=1')
      // CRÍTICO: no quedan placeholders literales en la URL que llega a Stripe.
      expect(captured.successUrl).not.toMatch(/:id|:token/)
      expect(captured.cancelUrl).not.toMatch(/:id|:token|:slug/)
    } finally {
      if (prevBase === undefined) delete process.env.PUBLIC_BASE_URL
      else process.env.PUBLIC_BASE_URL = prevBase
    }
  })

  it('sin PUBLIC_BASE_URL → usa origin del successUrl del caller (widget pasa window.location.origin)', async () => {
    const prevBase = process.env.PUBLIC_BASE_URL
    delete process.env.PUBLIC_BASE_URL
    try {
      const { repo: reservationsRepo } = makeReservationsRepo([{ ...PENDING_RESERVATION }])
      const hotelsRepo: RepositoryAdapter<any> = {
        findMany: async () => [], findById: async () => null,
        findOne: async () => ({ id: 'hotel-A', slug: 'caribe-paradise' }),
        create: async () => null, update: async () => null, delete: async () => true,
        count: async () => 0, paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0 }),
      }
      let captured: any = null
      const gw = makeMockGw()
      gw.createCharge = async (req: any) => { captured = req; return { status: 'redirect', redirectUrl: 'https://stripe/c/cs', providerRef: 'cs' } }
      const stripe = new StripeUseCase(reservationsRepo, log, makeMockRegistry(gw), undefined, hotelsRepo)

      await stripe.createCheckoutSession(
        'res-1', 200,
        'https://app.hotel.test/h/caribe-paradise/confirm?booking=:id&token=:token',
        'https://app.hotel.test/book/caribe-paradise',
      )

      // El origin del successUrl del caller se usa como baseUrl cuando PUBLIC_BASE_URL no está.
      expect(captured.successUrl).toBe(
        'https://app.hotel.test/h/caribe-paradise/confirm?booking=res-1&token=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      )
      expect(captured.successUrl).not.toMatch(/:id|:token/)
    } finally {
      if (prevBase === undefined) delete process.env.PUBLIC_BASE_URL
      else process.env.PUBLIC_BASE_URL = prevBase
    }
  })

  it('sin hotelsRepo → extrae slug de las URLs del caller (/h/:slug/... o /book/:slug)', async () => {
    const prevBase = process.env.PUBLIC_BASE_URL
    process.env.PUBLIC_BASE_URL = 'https://book.example.com'
    try {
      const { repo: reservationsRepo } = makeReservationsRepo([{ ...PENDING_RESERVATION }])
      let captured: any = null
      const gw = makeMockGw()
      gw.createCharge = async (req: any) => { captured = req; return { status: 'redirect', redirectUrl: 'https://stripe/c/cs', providerRef: 'cs' } }
      // Sin hotelsRepo (5to param) — tests legacy no lo cablean.
      const stripe = new StripeUseCase(reservationsRepo, log, makeMockRegistry(gw))

      await stripe.createCheckoutSession(
        'res-1', 200,
        'https://widget.example/h/some-slug/confirm?booking=:id&token=:token',
        'https://widget.example/book/some-slug',
      )

      // El slug se extrae del path del caller cuando no hay hotelsRepo.
      expect(captured.successUrl).toBe(
        'https://book.example.com/h/some-slug/confirm?booking=res-1&token=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      )
      expect(captured.cancelUrl).toBe('https://book.example.com/book/some-slug?cancelled=1')
    } finally {
      if (prevBase === undefined) delete process.env.PUBLIC_BASE_URL
      else process.env.PUBLIC_BASE_URL = prevBase
    }
  })

  it('reserva sin accessToken (creada desde panel) → ValidationError antes de llamar al gw', async () => {
    const { repo: reservationsRepo } = makeReservationsRepo([{ ...PENDING_RESERVATION, accessToken: null }])
    const gw = makeMockGw()
    let called = false
    gw.createCharge = async () => { called = true; return { status: 'redirect', redirectUrl: '', providerRef: '' } }
    const stripe = new StripeUseCase(reservationsRepo, log, makeMockRegistry(gw))

    await expect(stripe.createCheckoutSession('res-1', 200, 'https://s', 'https://c'))
      .rejects.toThrow(/accessToken/)
    expect(called).toBe(false) // el gw NO se llama si falla el guard
  })
})
