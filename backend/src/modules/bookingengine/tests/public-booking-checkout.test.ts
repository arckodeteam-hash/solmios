// bookingengine/tests/public-booking-checkout.test.ts — F0 0.16
// spec: openspec/changes/solmi-direct-booking/specs/booking-unification/spec.md
//
// Cubre el cableo de `createPublicBookingDirect` con StripeUseCase:
//   1. Tras crear la reserva pending, llama a createReservationCheckout → devuelve checkoutUrl.
//   2. Acepta `promoCode` y `upsells` en el body (HOOK F2 — se persisten, no se validan todavía).
//   3. Stripe falla → la reserva SE CREA igual (201), checkoutUrl=null + paymentError (NO 500).
//   4. Sin stripe deps (compat retro) → reserva se crea sin intentar cobro.
//   5. El flujo viejo (sin pago) sigue funcionando (no regresión del widget actual).
import { describe, it, expect } from 'bun:test'
import { createPublicBookingDirect, type PublicBookingStripeDeps } from '../usecases/public-booking'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function makeOrm(overrides: Partial<{ room: any; reservations: any[] }> = {}) {
  const created: any[] = []
  const room = overrides.room ?? { id: 'r1', hotelId: 'h1', basePrice: 100, status: 'available' }
  const reservations = overrides.reservations ?? []
  const orm: any = {
    findById: async (_model: string, _id: string) => room,
    findMany: async (_model: string) => reservations,
    create: async (model: string, payload: any) => {
      const row = { id: payload.id || 'row-1', ...payload }
      created.push({ model, row })
      return row
    },
    // F2 2.5 — El usecase ahora envuelve guest+reservation en orm.transaction. El mock invoca
    // el callback pasándose a sí mismo como `tx` (los creates van al array `created`).
    transaction: async (cb: (tx: any) => Promise<any>) => cb(orm),
    update: async () => null,
    findOne: async () => null,
  }
  return { orm, created }
}

const baseBody = {
  hotelId: 'h1',
  roomId: 'r1',
  guestName: 'Ana',
  guestEmail: 'ana@example.com',
  guestPhone: '+18095550000',
  checkIn: '2026-08-10',
  checkOut: '2026-08-12',
  adults: 2,
  children: 0,
}

function makeStripeDeps(opts: { url?: string; fail?: boolean } = {}): {
  deps: PublicBookingStripeDeps
  calls: Array<{ reservationId: string; amount: number; successUrl: string; cancelUrl: string }>
} {
  const calls: any[] = []
  const deps: PublicBookingStripeDeps = {
    createReservationCheckout: async (reservationId, amount, successUrl, cancelUrl) => {
      calls.push({ reservationId, amount, successUrl, cancelUrl })
      if (opts.fail) throw new Error('Stripe mal configurado para hotel h1')
      return {
        id: 'cs_test_1',
        url: opts.url ?? 'https://stripe.example/checkout/cs_test_1',
        payment_status: 'unpaid',
      }
    },
  }
  return { deps, calls }
}

function makeLogger(): { logger: any; warnings: string[] } {
  const warnings: string[] = []
  const logger = {
    warn: (msg: string) => warnings.push(msg),
    error: () => {},
    info: () => {},
    child: () => logger,
  }
  return { logger, warnings }
}

describe('createPublicBookingDirect — cableo Stripe (F0 0.16)', () => {
  it('devuelve checkoutUrl tras crear la reserva + llama al stripe deps con reservationId', async () => {
    const { orm, created } = makeOrm()
    const { deps, calls } = makeStripeDeps()
    const { logger } = makeLogger()
    const urls = { successUrl: 'https://app/s', cancelUrl: 'https://app/c' }

    const res = await createPublicBookingDirect(orm, baseBody, undefined, undefined, deps, logger, urls)

    expect(res.status).toBe(201)
    expect(res.body.checkoutUrl).toBe('https://stripe.example/checkout/cs_test_1')
    expect(UUID_RE.test(res.body.reservation.accessToken)).toBe(true)

    // El stripe deps recibió el reservationId real (UUID) y amount = basePrice * nights = 100*2.
    expect(calls).toHaveLength(1)
    expect(calls[0].reservationId).toBe(res.body.reservation.id)
    expect(calls[0].amount).toBe(200)
    expect(calls[0].successUrl).toBe('https://app/s')
    expect(calls[0].cancelUrl).toBe('https://app/c')

    // La reserva se persistió con status pending + accessToken.
    const reservationCreate = created.find((c) => c.model === 'Reservations')
    expect(reservationCreate.row.status).toBe('pending')
    expect(UUID_RE.test(reservationCreate.row.accessToken)).toBe(true)
  })

  it('ACEPTA promoCode + upsells como HOOK F2 (persiste en promoCode y notes, sin validar)', async () => {
    const { orm, created } = makeOrm()
    const { deps } = makeStripeDeps()
    const { logger } = makeLogger()

    const body = {
      ...baseBody,
      promoCode: 'VERANO10',
      upsells: [{ id: 'desayuno', quantity: 2 }, { id: 'parking', quantity: 1 }],
    }
    const res = await createPublicBookingDirect(orm, body, undefined, undefined, deps, logger, {
      successUrl: 'https://s', cancelUrl: 'https://c',
    })

    expect(res.status).toBe(201)
    const reservationCreate = created.find((c) => c.model === 'Reservations')
    // Hook F2: el promoCode se persiste en la reserva (F2 task 2.5 validará + aplicará descuento).
    expect(reservationCreate.row.promoCode).toBe('VERANO10')
    // Los upsells (sin schema propio todavía) van al `notes` para que el recepcionista los vea.
    expect(reservationCreate.row.notes).toContain('Promo: VERANO10')
    expect(reservationCreate.row.notes).toContain('Upsells: desayuno×2, parking×1')
    // Mientras F2 no aplique descuentos, el monto cobrado es el clásico (room * nights).
    expect(res.body.reservation.totalAmount).toBe(200)
  })

  it('Tarea 3.1 — estimatedArrival llega a Reservations.notes (el textarea viejo "notes" ' +
    'nunca llegaba: no estaba en el schema, validateSchema lo descartaba en el controller ' +
    'antes de que el usecase lo viera)', async () => {
    const { orm, created } = makeOrm()
    const { deps } = makeStripeDeps()
    const { logger } = makeLogger()

    const body = { ...baseBody, estimatedArrival: '15:00' }
    const res = await createPublicBookingDirect(orm, body, undefined, undefined, deps, logger, {
      successUrl: 'https://s', cancelUrl: 'https://c',
    })

    expect(res.status).toBe(201)
    const reservationCreate = created.find((c) => c.model === 'Reservations')
    expect(reservationCreate.row.notes).toContain('Llegada estimada: 15:00')
  })

  it('sin estimatedArrival, Reservations.notes no menciona "Llegada estimada" (opcional real)', async () => {
    const { orm, created } = makeOrm()
    const { deps } = makeStripeDeps()
    const { logger } = makeLogger()

    const res = await createPublicBookingDirect(orm, baseBody, undefined, undefined, deps, logger, {
      successUrl: 'https://s', cancelUrl: 'https://c',
    })

    expect(res.status).toBe(201)
    const reservationCreate = created.find((c) => c.model === 'Reservations')
    expect(reservationCreate.row.notes).not.toContain('Llegada estimada')
  })

  it('Corrección 2026-08-22 — specialRequests llega a Reservations.notes, etiquetado ' +
    '"Pedido especial" (feedback directo del dueño del producto: recibir pedidos del ' +
    'huésped es un requisito duro)', async () => {
    const { orm, created } = makeOrm()
    const { deps } = makeStripeDeps()
    const { logger } = makeLogger()

    const body = { ...baseBody, specialRequests: 'Cuna y piso alto, por favor' }
    const res = await createPublicBookingDirect(orm, body, undefined, undefined, deps, logger, {
      successUrl: 'https://s', cancelUrl: 'https://c',
    })

    expect(res.status).toBe(201)
    const reservationCreate = created.find((c) => c.model === 'Reservations')
    expect(reservationCreate.row.notes).toContain('Pedido especial: Cuna y piso alto, por favor')
  })

  it('estimatedArrival + specialRequests juntos: ambos aparecen, cada uno con su etiqueta', async () => {
    const { orm, created } = makeOrm()
    const { deps } = makeStripeDeps()
    const { logger } = makeLogger()

    const body = { ...baseBody, estimatedArrival: '15:00', specialRequests: 'Alergia al maní' }
    const res = await createPublicBookingDirect(orm, body, undefined, undefined, deps, logger, {
      successUrl: 'https://s', cancelUrl: 'https://c',
    })

    expect(res.status).toBe(201)
    const reservationCreate = created.find((c) => c.model === 'Reservations')
    expect(reservationCreate.row.notes).toContain('Llegada estimada: 15:00')
    expect(reservationCreate.row.notes).toContain('Pedido especial: Alergia al maní')
  })

  it('Stripe falla → reserva se crea igual (201) + checkoutUrl=null + paymentError + warn', async () => {
    const { orm, created } = makeOrm()
    const { deps } = makeStripeDeps({ fail: true })
    const { logger, warnings } = makeLogger()

    const res = await createPublicBookingDirect(orm, baseBody, undefined, undefined, deps, logger, {
      successUrl: 'https://s', cancelUrl: 'https://c',
    })

    // CRÍTICO: status 201 (no 500). La reserva está creada aunque Stripe no ande.
    expect(res.status).toBe(201)
    expect(res.body.checkoutUrl).toBeNull()
    expect(res.body.paymentError).toMatch(/Stripe mal configurado/)
    expect(UUID_RE.test(res.body.reservation.accessToken)).toBe(true)
    // La reserva quedó pending (NO confirmed porque el pago nunca llegó).
    const reservationCreate = created.find((c) => c.model === 'Reservations')
    expect(reservationCreate.row.status).toBe('pending')
    // Aviso al logger (no silencioso — el dev/prod necesita verlo).
    expect(warnings.some((w) => w.includes('Stripe falló'))).toBe(true)
  })

  it('sin stripe deps (compat retro) → reserva se crea sin intentar cobro', async () => {
    const { orm, created } = makeOrm()
    const res = await createPublicBookingDirect(orm, baseBody)
    // Caller viejo (reservas/tests/ownership.test.ts): no pasa stripe ni logger ni urls.
    // La reserva se crea, no se intenta cobro, no se rompe. El body nuevo incluye
    // `checkoutUrl: null` (campo nuevo del contrato F0 0.16) — los callers viejos no lo
    // conocen pero no rompe: simplemente lo ignoran.
    expect(res.status).toBe(201)
    expect(res.body.checkoutUrl).toBeNull()
    expect(res.body.paymentError).toBeUndefined()
    expect(UUID_RE.test(res.body.reservation.accessToken)).toBe(true)
    const reservationCreate = created.find((c) => c.model === 'Reservations')
    expect(reservationCreate.row.status).toBe('pending')
  })

  it('sin stripeUrls → no se intenta cobro aunque se pase stripe deps (no rompe)', async () => {
    const { orm, created } = makeOrm()
    const { deps, calls } = makeStripeDeps()
    const { logger } = makeLogger()
    // Caso real: controller no pudo derivar PUBLIC_BASE_URL y no arma URLs.
    const res = await createPublicBookingDirect(orm, baseBody, undefined, undefined, deps, logger, undefined)
    expect(res.status).toBe(201)
    expect(res.body.checkoutUrl).toBeNull()
    expect(calls).toHaveLength(0) // no se llamó al stripe deps
    expect(created.find((c) => c.model === 'Reservations').row.status).toBe('pending')
  })

  it('NO regresión: el flujo viejo de crear reserva (sin pago) sigue funcionando', async () => {
    // Replica del test F0 0.13 (public-booking.test.ts) para verificar que el cableo de
    // checkoutUrl NO rompe el comportamiento existente del widget actual (D-1 del design.md).
    // La reserva se crea con los mismos campos que antes; el nuevo `checkoutUrl: null` es
    // aditivo y los callers viejos lo ignoran.
    const { orm, created } = makeOrm()
    const res = await createPublicBookingDirect(orm, baseBody)
    expect(res.status).toBe(201)
    expect(res.body.reservation).toBeDefined()
    expect(res.body.guest).toBeDefined()
    expect(UUID_RE.test(res.body.reservation.accessToken)).toBe(true)
    // La reserva sigue siendo pending (sin pago) — el comportamiento del widget actual.
    const reservationCreate = created.find((c) => c.model === 'Reservations')
    expect(reservationCreate.row.status).toBe('pending')
  })
})
