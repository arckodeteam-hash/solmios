// payment-requests/tests/stripe-webhook.test.ts — Guardian de saldo del folio en el webhook.
//
// Regresión: `applyPaymentBridge` escribía el cargo `kind:'payment'` directo al repo, sin pasar
// por el guardián de `folio-entries.ts`. Un PaymentRequest de $100 sobre un folio con $20 de saldo
// (porque el huésped ya había pagado $80 en efectivo, p.ej.) dejaba el folio en negativo. Acá se
// prueba tanto el caso bloqueado (no escribe) como el happy path (escribe normalmente).
//
// BUG-1: además cubre la atomicidad del settle — asiento en `payments` + bridge corren como UN
// efecto tras el claim de `PaymentEventStore`; un reintento tras fallo parcial completa el bridge
// sin duplicar asiento, cargo foliar ni `deposit`.

import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test'
import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'

// ─── Mock de StripeService (antes del import del usecase) ────────────────────
// El webhook valida la firma con `StripeService.verifyWebhook` y chequea `isConfigured`. Como es
// un modulo importado directamente, se intercepta con mock.module para controlar ambos. El mock
// devuelve una sesión `checkout.session.completed` con metadata estándar (paymentRequestId 'pr1',
// reservationId 'r1', hotelId 'h1'); cada test puedeoverridear el amount_total o el metadata.
let nextSession: any = {
  id: 'cs_test_123',
  amount_total: 10000,
  payment_intent: 'pi_test_456',
  metadata: { paymentRequestId: 'pr1', reservationId: 'r1', hotelId: 'h1' },
}
const verifyWebhookMock = mock(async () => ({
  type: 'checkout.session.completed',
  data: { object: nextSession },
}))
// `mock.module` es GLOBAL al proceso de bun test: el módulo queda reemplazado
// para todos los archivos que corran después, no solo para este. Reemplazarlo
// entero dejaba a `StripeService` sin el resto de sus métodos y los tests de
// `service.test.ts` reventaban con "getConfig is not a function" según el orden
// de ejecución. Se parte del módulo real y solo se pisa lo que este test simula.
const actualStripe = await import('../../../services/stripe-service')
const realStripeService = { ...actualStripe.StripeService }
mock.module('../../../services/stripe-service', () => ({
  ...actualStripe,
  StripeService: {
    ...realStripeService,
    isConfigured: async () => true,
    verifyWebhook: verifyWebhookMock,
  },
}))

// Devolver el módulo a su estado real al terminar. Sin esto, el `isConfigured`
// simulado acá sobrevive al archivo y los tests que corran después creen que
// Stripe está configurado cuando no lo está.
afterAll(() => {
  mock.module('../../../services/stripe-service', () => ({
    ...actualStripe,
    StripeService: realStripeService,
  }))
})

import { processStripeWebhook } from '../usecases/stripe-webhook'
import type { WebhookDeps } from '../usecases/stripe-webhook'
import type { AuditEntry } from '../usecases/audit'
import { PaymentEventStore } from '../../../services/payment-gateway/payment-events'
import type { PaymentRequestDTO } from '../types'

const log = silentLogger()

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

/**
 * Construye los deps del webhook con repos que capturan lo que se escribe.
 * `opts.prStatus` controla si el PR está pendiente (para que el handler entre al flujo).
 * `opts.folioCharges` precarga las líneas que ya tiene el folio (para armar el saldo).
 * `opts.paymentPort` permite inyectar el puerto (por defecto: ya asentado => alreadyRecorded=false).
 */
function makeDeps(opts: {
  pr?: Partial<PaymentRequestDTO>
  folioCharges?: any[]
  paymentPort?: any
  logger?: Logger
  /** Campos extra de la reserva (p.ej. `otherCharges`). */
  reservation?: Record<string, any>
  /** Filas de `reservation_addons` de la reserva. */
  addons?: any[]
  /** Hotel dueño del folio abierto de la reserva. Por defecto el mismo del webhook ('h1'). */
  folioHotelId?: string
  /** Filas de `payments` visibles para el hotel 'h1' (camino folio → dinero cobrado, GH-0.2). */
  payments?: any[]
  /** Filas de `invoices` de la reserva. */
  invoices?: any[]
  /** BUG-1: hook de fallo parcial — la lectura de `reservations` revienta mientras devuelva true. */
  failReservationRead?: () => boolean
  /** BUG-1: hook de fallo parcial — el `repo.update` del PaymentRequest revienta mientras devuelva true. */
  failRequestUpdate?: () => boolean
} = {}): {
  deps: WebhookDeps; folioChargeCreates: any[]; reservationUpdates: any[]
  queryFilters: { reservation: any[]; addons: any[]; folio: any[] }
  requestUpdates: any[]
  auditEntries: AuditEntry[]
} {
  const folioChargeCreates: any[] = []
  const reservationUpdates: any[] = []
  const requestUpdates: any[] = []
  const auditEntries: AuditEntry[] = []
  const queryFilters: { reservation: any[]; addons: any[]; folio: any[] } = { reservation: [], addons: [], folio: [] }

  const pr: PaymentRequestDTO = {
    id: 'pr1', hotelId: 'h1', reservationId: 'r1', amount: 100,
    currency: 'USD', status: 'pending', sentTo: 'guest@x.com', sentVia: 'email',
    ...opts.pr,
  }
  const repo = makeRepo<PaymentRequestDTO>({
    findById: async () => pr,
    update: async (id: any, d: any) => {
      if (opts.failRequestUpdate?.()) throw new Error('payment_requests: update failed')
      requestUpdates.push({ id, ...d }); return { id, ...d } as any
    },
  })
  const reservationRepo = makeRepo<any>({
    findMany: async (f: any) => {
      if (opts.failReservationRead?.()) throw new Error('reservations: read failed')
      queryFilters.reservation.push(f)
      // Multi-tenant REAL: el doble sólo devuelve la fila si la query trae el hotel correcto,
      // igual que el WHERE del repo. Sin el filtro en el usecase, este mock no matchea (SEC-4).
      return f?.id === 'r1' && f?.hotelId === 'h1'
        ? [{ id: 'r1', hotelId: 'h1', deposit: 0, totalAmount: 100, status: 'pending', ...opts.reservation }]
        : []
    },
    update: async (id: any, d: any) => { reservationUpdates.push({ id, ...d }); return { id, ...d } },
  })
  const addonRepo = makeRepo<any>({
    findMany: async (f: any) => {
      queryFilters.addons.push(f)
      return f?.reservationId === 'r1' && f?.hotelId === 'h1' ? (opts.addons ?? []) : []
    },
  })
  // Multi-tenancy REAL (GH-0.3): el doble sólo devuelve el folio si la query trae el hotel dueño,
  // igual que el WHERE del repo. Sin el filtro en el usecase, un webhook del hotel A alcanzaba el
  // folio abierto de una reserva del hotel B y le escribía un cargo con el hotelId del A.
  const folioHotelId = opts.folioHotelId ?? 'h1'
  const folioRepo = makeRepo<any>({
    findMany: async (f: any) => {
      queryFilters.folio.push(f)
      return f?.reservationId === 'r1' && f?.hotelId === folioHotelId
        ? [{ id: 'f1', hotelId: folioHotelId, reservationId: 'r1', status: 'open' }]
        : []
    },
  })
  const invoiceRepo = makeRepo<any>({
    findMany: async (f: any) => (opts.invoices ?? []).filter((i: any) => i.hotelId === f?.hotelId && i.reservationId === f?.reservationId),
  })
  // MED-5: el doble filtra por los TRES vínculos reales de `reservation-paid` (folio, factura y
  // `reservationId` directo), no por uno scripado a mano — si el WHERE del usecase pidiera un
  // filtro que el doble no sabe responder, tiene que devolver vacío y no "todo lo del hotel".
  const paymentRepo = makeRepo<any>({
    findMany: async (f: any) => (opts.payments ?? []).filter((pay: any) => pay.hotelId === f?.hotelId
      && (f?.folioId !== undefined ? pay.folioId === f.folioId
        : f?.invoiceId !== undefined ? pay.invoiceId === f.invoiceId
        : f?.reservationId !== undefined ? pay.reservationId === f.reservationId
        : false)),
  })
  // BUG-1: doble con ESTADO — lo que el bridge crea queda visible para el próximo findMany, como
  // en la base real. Sin esto un reintento no ve el cargo foliar de la entrega previa y la
  // deduplicación por ref del bridge no se puede ejercitar.
  const folioChargeRepo = makeRepo<any>({
    findMany: async (f: any) => f?.folioId === 'f1' ? [...(opts.folioCharges ?? []), ...folioChargeCreates] : [],
    create: async (d: any) => { folioChargeCreates.push(d); return { id: 'fc-new', ...d } },
  })

  const paymentPort = opts.paymentPort ?? {
    findBySession: async () => null, // aún no asentado → el webhook entra al bridge
    recordPayment: async () => ({ id: 'pay1', status: 'completed' }),
  }

  // BUG-1: la MISMA `PaymentEventStore` de producción sobre un repo doble que reproduce la PK de
  // `payment_events` — insertar dos veces el mismo id revienta como lo haría el motor (mensaje
  // Postgres, que `isDuplicateError` detecta). Claim/release se ejercitan de verdad: nada del
  // mecanismo de idempotencia está mockeado.
  const claimedEvents = new Set<string>()
  const eventRepo = makeRepo<any>({
    create: async (d: any) => {
      if (claimedEvents.has(String(d.id))) {
        throw new Error('duplicate key value violates unique constraint "payment_events_pkey"')
      }
      claimedEvents.add(String(d.id))
      return d
    },
    delete: async (id: any) => claimedEvents.delete(String(id)),
  })
  const events = new PaymentEventStore(eventRepo as any, log)

  return {
    deps: {
      repo, reservationRepo, folioRepo, folioChargeRepo, addonRepo,
      // STR-A: camino reserva → dinero por el puerto, igual que en producción (connector
      // payment-requests-money). El `folioRepo` doble sirve a la vez al bridge del folio abierto.
      paidRepos: { folioRepo, invoiceRepo, paymentRepo },
      logger: opts.logger ?? log, sockets: {}, paymentPort, events,
      // SC-05: captura del rastro de auditoría (en producción lo inyecta el service vía connector).
      audit: async (e) => { auditEntries.push(e) },
    },
    folioChargeCreates,
    reservationUpdates,
    queryFilters,
    requestUpdates,
    auditEntries,
  }
}

describe('processStripeWebhook — guardián de saldo del folio', () => {
  beforeEach(() => {
    verifyWebhookMock.mockClear()
    // Reset al session default entre tests (algunos tests lo mutan).
    nextSession = {
      id: 'cs_test_123',
      amount_total: 10000,
      payment_intent: 'pi_test_456',
      metadata: { paymentRequestId: 'pr1', reservationId: 'r1', hotelId: 'h1' },
    }
  })

  it('happy path: monto <= saldo → escribe el cargo normalmente', async () => {
    // PR.amount = 100 (amount_total en centavos = 10000). Folio tiene $100 de cargo y $0 pagos
    // → balance = 100. El pago de $100 entra justo.
    const { deps, folioChargeCreates, reservationUpdates } = makeDeps({
      folioCharges: [
        { id: 'c1', folioId: 'f1', kind: 'charge', total: 100 },
      ],
    })

    const result = await processStripeWebhook(deps, 'h1', 'raw-body', 'sig')

    expect(result.received).toBe(true)
    expect(folioChargeCreates).toHaveLength(1)
    expect(folioChargeCreates[0].kind).toBe('payment')
    expect(Number(folioChargeCreates[0].total)).toBe(-100)
    expect(folioChargeCreates[0].source).toBe('stripe')
    // La reserva también recibió el patch de depósito.
    expect(reservationUpdates).toHaveLength(1)
    expect(Number(reservationUpdates[0].deposit)).toBe(100)
  })

  it('regresión: monto > saldo → se aplica hasta el saldo, nunca deja el folio en negativo', async () => {
    // PR.amount = 100. Folio tiene $100 de cargos y $80 de pagos previos → balance = 20.
    // Un cargo de -$100 dejaría el folio en -$80: el tope lo recorta a -$20.
    const { deps, folioChargeCreates, reservationUpdates } = makeDeps({
      folioCharges: [
        { id: 'c1', folioId: 'f1', kind: 'charge', total: 100 },
        { id: 'p1', folioId: 'f1', kind: 'payment', total: -80 },
      ],
    })

    const result = await processStripeWebhook(deps, 'h1', 'raw-body', 'sig')

    // El webhook NO rompe: devuelve received=true (Stripe no reintenta un evento que técnicamente
    // procesó — el dinero ya está asentado en `payments`; el excedente queda para reconciliación).
    expect(result.received).toBe(true)
    // Clave: el folio queda en 0, NO en negativo, y NO queda mostrando una deuda ya cobrada.
    expect(folioChargeCreates).toHaveLength(1)
    expect(Number(folioChargeCreates[0].total)).toBe(-20)
    // La descripción deja escrito cuánto se aplicó de cuánto, para cruzar contra `payments`.
    expect(folioChargeCreates[0].description).toContain('aplicado 20 de 100')
    // La reserva igual recibe el depósito completo — no se rompe el puente.
    expect(reservationUpdates).toHaveLength(1)
    expect(Number(reservationUpdates[0].deposit)).toBe(100)
  })

  it('folio sin saldo (todo pagado antes) → no escribe cargo de $0', async () => {
    const { deps, folioChargeCreates } = makeDeps({
      folioCharges: [
        { id: 'c1', folioId: 'f1', kind: 'charge', total: 100 },
        { id: 'p1', folioId: 'f1', kind: 'payment', total: -100 },
      ],
    })

    await processStripeWebhook(deps, 'h1', 'raw-body', 'sig')

    expect(folioChargeCreates).toHaveLength(0)
  })

  it('regresión: monto levemente mayor al saldo dentro de epsilon → acepta (tolerancia centavos)', async () => {
    // PR.amount = 100. Folio tiene charge +100 y pago previo -0.01 → balance = 99.99.
    // amountPaid (100) > balance (99.99) por 0.01, que es <= BALANCE_EPSILON → el guardián acepta
    // (no bloquea por diferencias de redondeo de centavos).
    const { deps, folioChargeCreates } = makeDeps({
      folioCharges: [
        { id: 'c1', folioId: 'f1', kind: 'charge', total: 100 },
        { id: 'p1', folioId: 'f1', kind: 'payment', total: -0.01 },
      ],
    })

    const result = await processStripeWebhook(deps, 'h1', 'raw-body', 'sig')

    expect(result.received).toBe(true)
    expect(folioChargeCreates).toHaveLength(1)
    expect(Number(folioChargeCreates[0].total)).toBe(-100)
  })

  it('BUG-1: reintento con el asiento ya persistido → el bridge SÍ corre y no duplica el pago', async () => {
    // Ventana del bug: `recordStripePayment` persistió en la entrega previa pero el bridge no
    // llegó a correr. El reintento encuentra el cobro asentado (findBySession → existing): el
    // asiento NO se repite (recordPayment nunca se llama), pero el bridge TIENE que completar
    // reserva y folio — antes el `!alreadyRecorded` lo saltaba y el PR se marcaba paid con la
    // reserva sin deposit/pendingAmount y el folio sin cargo.
    const recordCalls: string[] = []
    const { deps, folioChargeCreates, reservationUpdates } = makeDeps({
      paymentPort: {
        findBySession: async () => ({ id: 'pay-existente', status: 'completed' }),
        recordPayment: async (i: any) => { recordCalls.push(i.stripeSessionId); return { id: 'pay2', status: 'completed' } },
      },
      folioCharges: [{ id: 'c1', folioId: 'f1', kind: 'charge', total: 100 }],
    })

    const result = await processStripeWebhook(deps, 'h1', 'raw-body', 'sig')

    expect(result.received).toBe(true)
    expect(recordCalls).toHaveLength(0)         // el asiento en `payments` no se duplica
    expect(folioChargeCreates).toHaveLength(1)  // el bridge completa el folio
    expect(reservationUpdates).toHaveLength(1)  // y la reserva (deposit/pendingAmount)
  })

  it('BUG-1 (regresión end-to-end): bridge que revienta → 500, y el reintento completa sin duplicar nada', async () => {
    // Primera entrega: el asiento persiste, después la mitad de reserva del bridge falla →
    // settleOnce LIBERA el claim y el webhook corta con 500 para que Stripe reintente. Segunda
    // entrega: el asiento ya está (findBySession → existing, recordPayment no se repite) y el
    // bridge reentrante completa — cargo foliar deduplicado por ref, `deposit` bumpeado una vez.
    let reservationReadsFailed = 0
    let recorded = false
    const recordCalls: string[] = []
    const { deps, folioChargeCreates, reservationUpdates, requestUpdates } = makeDeps({
      paymentPort: {
        findBySession: async () => (recorded ? { id: 'pay1', status: 'completed' } : null),
        recordPayment: async (i: any) => { recorded = true; recordCalls.push(i.stripeSessionId); return { id: 'pay1', status: 'completed' } },
      },
      folioCharges: [{ id: 'c1', folioId: 'f1', kind: 'charge', total: 100 }],
      failReservationRead: () => reservationReadsFailed++ < 1,
    })

    const first = await processStripeWebhook(deps, 'h1', 'raw-body', 'sig')
    // `WebhookResult` no declara `status` (el corte HTTP va con `as any` en el usecase): ídem acá.
    expect((first as any).status).toBe(500)     // el handler corta con 500 → Stripe reintenta
    expect(requestUpdates).toHaveLength(0)      // el PR quedó pending, nada marcado paid

    const second = await processStripeWebhook(deps, 'h1', 'raw-body', 'sig')
    expect(second.received).toBe(true)
    expect(recordCalls).toHaveLength(1)         // el asiento se persistió UNA sola vez
    expect(folioChargeCreates).toHaveLength(1)  // el cargo foliar quedó exactamente una vez
    expect(reservationUpdates).toHaveLength(1)  // la reserva se completó una sola vez
    expect(Number(reservationUpdates[0].deposit)).toBe(100) // sin doble bumpeo del deposit
    expect(requestUpdates.filter((u: any) => u.status === 'paid')).toHaveLength(1)
  })

  it('BUG-1: efecto completo + fallo al marcar paid → el reintento NO re-corre el bridge', async () => {
    // La entrega previa terminó asiento+bridge pero murió antes de marcar el PR: el claim queda
    // TOMADO (el efecto no falló, no se libera) y el reintento sólo remarca el estado — sin
    // volver a tocar folio ni reserva.
    let updatesFailed = 0
    const { deps, folioChargeCreates, reservationUpdates, requestUpdates } = makeDeps({
      folioCharges: [{ id: 'c1', folioId: 'f1', kind: 'charge', total: 100 }],
      failRequestUpdate: () => updatesFailed++ < 1,
    })

    const first = await processStripeWebhook(deps, 'h1', 'raw-body', 'sig')
    expect((first as any).status).toBe(500)

    const second = await processStripeWebhook(deps, 'h1', 'raw-body', 'sig')
    expect(second.received).toBe(true)
    expect(folioChargeCreates).toHaveLength(1)
    expect(reservationUpdates).toHaveLength(1)
    expect(requestUpdates.filter((u: any) => u.status === 'paid')).toHaveLength(1)
  })

  it('sin folio abierto → no escribe cargo foliar (comportamiento previo preservado)', async () => {
    // Ni el session.metadata ni el PR tienen reservationId → findOpenFolio devuelve null y el
    // bridge hace return temprano. Verifica que el guardián no rompe el flujo sin folio.
    nextSession.metadata = { paymentRequestId: 'pr1', hotelId: 'h1' } // sin reservationId
    const { deps, folioChargeCreates, reservationUpdates } = makeDeps({
      pr: { id: 'pr1', hotelId: 'h1', reservationId: '', amount: 100, currency: 'USD', status: 'pending' },
      folioCharges: [],
    })

    const result = await processStripeWebhook(deps, 'h1', 'raw-body', 'sig')

    expect(result.received).toBe(true)
    expect(folioChargeCreates).toHaveLength(0)
    expect(reservationUpdates).toHaveLength(0)
  })
})


describe('processStripeWebhook — el pendiente de la reserva incluye los extras', () => {
  beforeEach(() => {
    verifyWebhookMock.mockClear()
    nextSession = {
      id: 'cs_test_123',
      amount_total: 10000,
      payment_intent: 'pi_test_456',
      metadata: { paymentRequestId: 'pr1', reservationId: 'r1', hotelId: 'h1' },
    }
  })

  it('con addons y otros cobros deja `pendingAmount` con el saldo REAL, no `totalAmount - deposit`', async () => {
    // Reserva: 100 de alojamiento + 40 de otros cobros + 60 de extras (2×30) = 200 cobrables.
    // Stripe cobra 100 → deposit 100 → quedan 100 pendientes. Antes del fix escribía 0
    // (100 - 100) y la reserva figuraba saldada con 100 sin cobrar.
    // El folio tiene SOLO el cargo de habitación: es lo único que postea el check-in
    // (`reservas/usecases/checkin.ts`) — los extras y `otherCharges` nunca llegan al folio.
    const { deps, reservationUpdates, folioChargeCreates } = makeDeps({
      reservation: { otherCharges: 40 },
      addons: [{ id: 'a1', reservationId: 'r1', amount: 30, quantity: 2, kind: 'service' }],
      folioCharges: [{ id: 'c1', folioId: 'f1', kind: 'charge', total: 100 }],
    })

    await processStripeWebhook(deps, 'h1', 'raw-body', 'sig')

    expect(reservationUpdates).toHaveLength(1)
    expect(reservationUpdates[0].deposit).toBe(100)
    expect(reservationUpdates[0].pendingAmount).toBe(100)
    // El pago SÍ entra al folio: el huésped pagó, el folio no puede seguir mostrando la deuda.
    expect(folioChargeCreates).toHaveLength(1)
    expect(Number(folioChargeCreates[0].total)).toBe(-100)
  })

  it('cargar un extra NO desconfirma una reserva con el alojamiento 100% pagado', async () => {
    // Alojamiento 100, pagado 100 → confirmada. Que recepción cargue un extra de 60 deja saldo
    // pendiente (se cobra aparte), pero la habitación está reservada: el estado no depende del extra.
    const { deps, reservationUpdates } = makeDeps({
      addons: [{ id: 'a1', reservationId: 'r1', amount: 60, quantity: 1, kind: 'service' }],
      folioCharges: [{ id: 'c1', folioId: 'f1', kind: 'charge', total: 100 }],
    })

    await processStripeWebhook(deps, 'h1', 'raw-body', 'sig')

    expect(reservationUpdates[0].status).toBe('confirmed')
    expect(reservationUpdates[0].pendingAmount).toBe(60)
  })

  it('sin extras el comportamiento no cambia: pago total → pendiente 0 y confirmada', async () => {
    const { deps, reservationUpdates } = makeDeps({
      folioCharges: [{ id: 'c1', folioId: 'f1', kind: 'charge', total: 100 }],
    })

    await processStripeWebhook(deps, 'h1', 'raw-body', 'sig')

    expect(reservationUpdates[0].pendingAmount).toBe(0)
    expect(reservationUpdates[0].status).toBe('confirmed')
  })

  // ── SEC-4: toda query del bridge lleva el hotel de la RUTA ─────────────────────────────────
  // El `reservationId` viaja en la metadata de la sesión de Stripe. Sin el filtro por hotelId, el
  // webhook de un hotel leía (y escribía) la reserva y los extras de otro. El mismo diff ya aplica
  // la regla en `reservas-queries`; acá faltaba.
  it('filtra reserva y extras por hotelId, no sólo por el id que viene en la metadata', async () => {
    const { deps, queryFilters } = makeDeps({
      folioCharges: [{ id: 'c1', folioId: 'f1', kind: 'charge', total: 100 }],
    })

    await processStripeWebhook(deps, 'h1', 'raw-body', 'sig')

    expect(queryFilters.reservation[0]).toEqual({ id: 'r1', hotelId: 'h1' })
    expect(queryFilters.addons[0]).toEqual({ reservationId: 'r1', hotelId: 'h1' })
  })

  it('la metadata NO puede redirigir el cobro al hotel de otro: manda el hotel de la ruta', async () => {
    // Sesión firmada por el hotel 'h1' pero con `metadata.hotelId` apuntando a 'h2'.
    nextSession = { ...nextSession, metadata: { ...nextSession.metadata, hotelId: 'h2' } }
    const { deps, queryFilters, reservationUpdates } = makeDeps({
      folioCharges: [{ id: 'c1', folioId: 'f1', kind: 'charge', total: 100 }],
    })

    await processStripeWebhook(deps, 'h1', 'raw-body', 'sig')

    expect(queryFilters.reservation[0].hotelId).toBe('h1')
    expect(reservationUpdates).toHaveLength(1)
  })

  // ── COR-6: `pr.amount` está en UNIDADES, no en centavos ────────────────────────────────────
  it('sin amount_total cae a pr.amount SIN dividir por 100', async () => {
    // Stripe cotiza en centavos (`amount_total`), pero `payment_requests.amount` se persiste en
    // unidades. El fallback dividía igual: un cobro de $100 se asentaba como $1 en `payments`,
    // en el `deposit` de la reserva y en el cargo del folio.
    nextSession = { ...nextSession, amount_total: undefined }
    const recorded: any[] = []
    const { deps, folioChargeCreates, reservationUpdates } = makeDeps({
      folioCharges: [{ id: 'c1', folioId: 'f1', kind: 'charge', total: 100 }],
      paymentPort: {
        findBySession: async () => null,
        recordPayment: async (input: any) => { recorded.push(input); return { id: 'pay1', status: 'completed' } },
      },
    })

    await processStripeWebhook(deps, 'h1', 'raw-body', 'sig')

    expect(recorded[0].amount).toBe(100)
    expect(reservationUpdates[0].deposit).toBe(100)
    expect(Number(folioChargeCreates[0].total)).toBe(-100)
  })
})


// ── GH-0.3: el webhook no puede alcanzar el folio ni el cobro de otro hotel ─────────────────────
describe('processStripeWebhook — multi-tenancy del folio y del expired', () => {
  beforeEach(() => {
    verifyWebhookMock.mockClear()
    // Este bloque cambia el `type` del evento en algunos tests: `mockClear` NO restaura la
    // implementación, así que se vuelve a fijar la default (completed) en cada test.
    verifyWebhookMock.mockImplementation(async () => ({
      type: 'checkout.session.completed', data: { object: nextSession },
    }) as any)
    nextSession = {
      id: 'cs_test_123',
      amount_total: 10000,
      payment_intent: 'pi_test_456',
      metadata: { paymentRequestId: 'pr1', reservationId: 'r1', hotelId: 'h1' },
    }
  })

  it('busca el folio abierto filtrando por hotelId, no sólo por el reservationId de la metadata', async () => {
    const { deps, queryFilters, folioChargeCreates } = makeDeps({
      folioCharges: [{ id: 'c1', folioId: 'f1', kind: 'charge', total: 100 }],
    })

    await processStripeWebhook(deps, 'h1', 'raw-body', 'sig')

    expect(queryFilters.folio[0]).toEqual({ reservationId: 'r1', hotelId: 'h1' })
    expect(folioChargeCreates).toHaveLength(1)
  })

  it('folio de OTRO hotel: no lo resuelve y no le escribe ningún cargo', async () => {
    // La reserva 'r1' de la metadata tiene su folio abierto en el hotel 'h2'. El webhook está
    // firmado por 'h1'. Antes, `findOpenFolio` consultaba sólo por `reservationId`: encontraba ese
    // folio ajeno y le posteaba un `folio_charges` negativo con `hotelId: 'h1'`.
    const { deps, folioChargeCreates } = makeDeps({
      folioHotelId: 'h2',
      folioCharges: [{ id: 'c1', folioId: 'f1', kind: 'charge', total: 100 }],
    })

    const result = await processStripeWebhook(deps, 'h1', 'raw-body', 'sig')

    expect(result.received).toBe(true)
    expect(folioChargeCreates).toHaveLength(0)
  })

  it('checkout.session.expired de un cobro de otro hotel → 403 y NO lo expira', async () => {
    // Espejo del cotejo que ya hacía la rama `completed`. Sin él, el webhook del hotel A cancelaba
    // un link de pago vivo del hotel B con sólo mandar su id en la metadata.
    verifyWebhookMock.mockImplementation(async () => ({
      type: 'checkout.session.expired',
      data: { object: nextSession },
    }) as any)
    const { deps, requestUpdates } = makeDeps({ pr: { hotelId: 'h2' } })

    const result = await processStripeWebhook(deps, 'h1', 'raw-body', 'sig')

    expect((result as any).status).toBe(403)
    expect(requestUpdates).toHaveLength(0)
  })

  it('checkout.session.expired del propio hotel sí expira el cobro', async () => {
    verifyWebhookMock.mockImplementation(async () => ({
      type: 'checkout.session.expired',
      data: { object: nextSession },
    }) as any)
    const { deps, requestUpdates } = makeDeps()

    const result = await processStripeWebhook(deps, 'h1', 'raw-body', 'sig')

    expect(result.received).toBe(true)
    expect(requestUpdates).toHaveLength(1)
    expect(requestUpdates[0].status).toBe('expired')
  })

  // GH-0.3: cancelar desde el panel EXPIRA la sesión en Stripe, y Stripe manda de vuelta el
  // `checkout.session.expired`. Ese eco no puede pisar el estado que puso el operador.
  it('el eco de una sesión que expiramos nosotros NO pisa un estado ya resuelto', async () => {
    verifyWebhookMock.mockImplementation(async () => ({
      type: 'checkout.session.expired',
      data: { object: nextSession },
    }) as any)
    const { deps, requestUpdates } = makeDeps({ pr: { status: 'cancelled' } })
    const result = await processStripeWebhook(deps, 'h1', 'raw-body', 'sig')
    expect(result.received).toBe(true)
    expect(requestUpdates).toHaveLength(0)
  })
})

// ── SEC-1: el rastro del cobro fallido queda en el tenant que FIRMÓ el webhook ─────────────────
// `payment_intent.payment_failed` no toca plata ni estado, pero sí escribe en el audit log. La
// rama tomaba `intent.metadata.hotelId` (payload) con fallback al hotel de la ruta: un webhook
// firmado por el hotel A podía dejar rastro en el audit log del hotel B. Las ramas
// completed/expired ya descartaban la metadata y cotejaban contra la ruta.
describe('processStripeWebhook — tenant del rastro de auditoría del cobro fallido', () => {
  beforeEach(() => {
    verifyWebhookMock.mockClear()
    nextSession = {
      id: 'cs_test_123',
      amount_total: 10000,
      payment_intent: 'pi_test_456',
      metadata: { paymentRequestId: 'pr1', reservationId: 'r1', hotelId: 'h1' },
    }
  })

  it('la metadata NO puede elegir el tenant del rastro: manda el hotel de la ruta', async () => {
    // Intent firmado por el secreto del hotel 'h1' pero con `metadata.hotelId` apuntando a 'h2'.
    verifyWebhookMock.mockImplementation(async () => ({
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: 'pi_failed_1',
          amount: 10000,
          currency: 'usd',
          metadata: { paymentRequestId: 'pr1', hotelId: 'h2' },
          last_payment_error: { code: 'card_declined' },
        },
      },
    }) as any)
    const { deps, auditEntries } = makeDeps()

    const result = await processStripeWebhook(deps, 'h1', 'raw-body', 'sig')

    expect(result.received).toBe(true)
    expect(auditEntries).toHaveLength(1)
    expect(auditEntries[0].action).toBe('payment_request.payment_failed')
    expect(auditEntries[0].hotelId).toBe('h1')
  })

  it('sin metadata de hotel el rastro igual queda con tenant (el de la ruta)', async () => {
    verifyWebhookMock.mockImplementation(async () => ({
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: 'pi_failed_2',
          amount: 5000,
          currency: 'usd',
          metadata: { paymentRequestId: 'pr1' },
          last_payment_error: { code: 'insufficient_funds' },
        },
      },
    }) as any)
    const { deps, auditEntries } = makeDeps()

    await processStripeWebhook(deps, 'h1', 'raw-body', 'sig')

    expect(auditEntries).toHaveLength(1)
    expect(auditEntries[0].hotelId).toBe('h1')
    expect(auditEntries[0].entityId).toBe('pr1')
  })
})

// ── GH-0.2: el `pendingAmount` que persiste el bridge mide contra `payments` ────────────────────
describe('processStripeWebhook — el pendiente persistido usa lo cobrado real', () => {
  beforeEach(() => {
    verifyWebhookMock.mockClear()
    verifyWebhookMock.mockImplementation(async () => ({
      type: 'checkout.session.completed', data: { object: nextSession },
    }) as any)
    nextSession = {
      id: 'cs_test_123',
      amount_total: 10000,
      payment_intent: 'pi_test_456',
      metadata: { paymentRequestId: 'pr1', reservationId: 'r1', hotelId: 'h1' },
    }
  })

  it('un cobro previo en efectivo por folio ya no queda como saldo pendiente', async () => {
    // Reserva de 500. El huésped pagó 300 en efectivo por folio (fila en `payments`, `deposit`
    // intacto en 0) y ahora paga 100 por Stripe. Pendiente real: 500 − 400 = 100.
    // Con `deposit` como fuente el bridge escribía 400 y el listado seguía reclamando plata cobrada.
    const { deps, reservationUpdates } = makeDeps({
      reservation: { totalAmount: 500, deposit: 0 },
      folioCharges: [{ id: 'c1', folioId: 'f1', kind: 'charge', total: 500 }],
      payments: [
        // Efectivo por folio: NO toca `deposit`, así que la fila nace sin sesión de Stripe.
        { id: 'cash1', hotelId: 'h1', folioId: 'f1', type: 'charge', status: 'completed', amount: 300 },
        // El cobro de este mismo webhook: `connectors/payment-requests-payments.ts` lo asienta CON
        // la sesión, y esa sesión es lo que delata que espeja al `deposit` que el bridge bumpea
        // (GH-0.5) — sin ella se contaría dos veces la misma plata.
        { id: 'stripe1', hotelId: 'h1', folioId: 'f1', type: 'charge', status: 'completed', amount: 100, stripeSessionId: 'cs_test_123' },
      ],
    })

    await processStripeWebhook(deps, 'h1', 'raw-body', 'sig')

    expect(reservationUpdates).toHaveLength(1)
    expect(reservationUpdates[0].deposit).toBe(100)
    expect(reservationUpdates[0].pendingAmount).toBe(100)
  })

  // ── SEC-2: el payload NO elige a qué reserva se aplica el cobro ──────────────────────────────
  it('ignora session.metadata.reservationId y usa la reserva del PaymentRequest', async () => {
    // Mismo hotel, otra reserva: el chequeo de tenant (pr.hotelId === hotelId) no lo frena. Si el
    // payload ganara, el cobro de r1 se aplicaría al folio y al `deposit` de r99.
    nextSession.metadata = { paymentRequestId: 'pr1', reservationId: 'r99', hotelId: 'h1' }
    const { deps, reservationUpdates, queryFilters, folioChargeCreates } = makeDeps({
      folioCharges: [{ id: 'c1', folioId: 'f1', kind: 'charge', total: 500 }],
    })

    await processStripeWebhook(deps, 'h1', 'raw-body', 'sig')

    // El folio se busca por la reserva del PaymentRequest, no por la del payload.
    expect(queryFilters.folio.every((f) => f.reservationId === 'r1')).toBe(true)
    expect(queryFilters.reservation.every((f) => f.id === 'r1')).toBe(true)
    expect(reservationUpdates).toHaveLength(1)
    expect(reservationUpdates[0].id).toBe('r1')
    // Y el cargo cae en el folio de r1 (el doble sólo devuelve f1 para r1).
    expect(folioChargeCreates).toHaveLength(1)
    expect(folioChargeCreates[0].folioId).toBe('f1')
  })
})
