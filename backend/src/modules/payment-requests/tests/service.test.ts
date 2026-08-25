// payment-requests/tests/service.ts — Tests del servicio.
// Usa RepositoryAdapter mock — sin dependencia de SQLite ni Stripe real.

import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, Auth } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { PaymentRequestsService } from '../service'
import { StripeService } from '../../../services/stripe-service'
import type { PaymentRequestDTO, CurrentUser } from '../types'
import { sumPayments } from '../../../shared/usecases/reservation-paid'

const log = silentLogger()
const currentUser: CurrentUser = { id: 'u1', hotelId: 'h1', role: 'hotel_admin' }

// Auth que SÍ valida ownership: throw si el recurso no es del hotel del user (y no es super_admin).
const strictAuth: Auth = {
  assertOwnership: (resourceHotelId: string, userHotelId: string, role: string, adminRole: string) => {
    if (role === adminRole) return
    if (resourceHotelId !== userHotelId) throw new Error('Forbidden: sin ownership')
  },
  authenticate: (() => []) as any,
} as unknown as Auth

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
function makeUserRepo(hotelId = 'h1'): RepositoryAdapter<any> {
  return { ...makeRepo<any>(), findById: async () => ({ id: 'u1', hotelId }) }
}

// Reserva contra la que se valida el techo del monto (SEC-1): 500 de alojamiento, 200 pagados
// → saldo cobrable 300 (más lo que agreguen los addons del `makeAddonRepo`).
function makeReservationRepo(over: Record<string, any> = {}): RepositoryAdapter<any> {
  return {
    ...makeRepo<any>(),
    findById: async () => ({ id: 'r1', hotelId: 'h1', totalAmount: 500, deposit: 200, otherCharges: 0, ...over }),
  }
}
function makeAddonRepo(addons: any[] = []): RepositoryAdapter<any> {
  return { ...makeRepo<any>(), findMany: async () => addons }
}

// ── GH-0.2: lo cobrado sale de `payments`, no de `reservations.deposit` ─────────────────────────
// A `payments` se llega por TRES vínculos: folio, factura y `reservationId` directo (COR-A).
// Los dobles respetan ese camino y el filtro por hotel, igual que el WHERE del repo.
function makeFolioRepo(folios: any[] = []): RepositoryAdapter<any> {
  return { ...makeRepo<any>(), findMany: async (f: any) => folios.filter((x) => x.hotelId === f?.hotelId && x.reservationId === f?.reservationId) }
}
function makeInvoiceRepo(invoices: any[] = []): RepositoryAdapter<any> {
  return { ...makeRepo<any>(), findMany: async (f: any) => invoices.filter((x) => x.hotelId === f?.hotelId && x.reservationId === f?.reservationId) }
}
function makePaymentRepo(payments: any[] = []): RepositoryAdapter<any> {
  return {
    ...makeRepo<any>(),
    findMany: async (f: any) => payments.filter((p) => p.hotelId === f?.hotelId
      && (f?.folioId !== undefined ? p.folioId === f.folioId : p.invoiceId === f?.invoiceId)),
  }
}

function makeService(opts: { userHotelId?: string; auth?: Auth; prHotelId?: string } = {}) {
  const prHotelId = opts.prHotelId ?? 'h1'
  const pr: PaymentRequestDTO = {
    id: 'pr1', hotelId: prHotelId, reservationId: 'r1', amount: 100,
    currency: 'USD', status: 'pending', sentTo: 'guest@x.com', sentVia: 'email',
  }
  const repo = makeRepo<PaymentRequestDTO>({ findById: async () => pr })
  const auth = opts.auth ?? strictAuth
  const userRepo = makeUserRepo(opts.userHotelId ?? 'h1')
  return wireMoney(new PaymentRequestsService(
    repo, makeReservationRepo(), makeRepo<any>(), makeRepo<any>(), userRepo, log, auth, makeAddonRepo(),
  ))
}


/** STR-A: el service lee el dinero por el puerto que cablea `payment-requests-money`. */
function wireMoney(s: PaymentRequestsService, opts: { folios?: any[]; invoices?: any[]; payments?: any[] } = {}): PaymentRequestsService {
  s.setMoneyDeps({
    paidRepos: {
      folioRepo: makeFolioRepo(opts.folios ?? []),
      invoiceRepo: makeInvoiceRepo(opts.invoices ?? []),
      paymentRepo: makePaymentRepo(opts.payments ?? []),
    },
    // RTC-7.4: lo contesta `payments` (settledNetOfReservation). Se deriva de las MISMAS filas del
    // doble para que el mundo del test no diga dos cosas distintas sobre la misma plata.
    settledNet: async () => sumPayments((opts.payments ?? []) as any[]),
    // RTC-8.2/8.3 — sin sesiones de la vía charge-card en este doble.
    liveCharges: async () => 0,
    liveChargeRows: async () => [],
    cancelLiveCharge: async () => 'cancelled' as const,
  })
  return s
}

describe('PaymentRequestsService', () => {
  it('list filtra por hotelId del JWT', async () => {
    let captured: any = null
    const repo = makeRepo<PaymentRequestDTO>({ findMany: async (f: any) => { captured = f; return [] } })
    const s = wireMoney(new PaymentRequestsService(repo, makeReservationRepo(), makeRepo<any>(), makeRepo<any>(), makeUserRepo(), log, strictAuth, makeAddonRepo()))
    await s.list({ reservationId: 'r1' }, currentUser)
    expect(captured.hotelId).toBe('h1')
    expect(captured.reservationId).toBe('r1')
  })

  it('create fuerza hotelId del JWT (P0 IDOR)', async () => {
    const created: any[] = []
    const repo = makeRepo<PaymentRequestDTO>({ create: async (d: any) => { created.push(d); return { id: 'pr1', ...d } } })
    const s = wireMoney(new PaymentRequestsService(repo, makeReservationRepo(), makeRepo<any>(), makeRepo<any>(), makeUserRepo(), log, strictAuth, makeAddonRepo()))
    // Intento IDOR: body pide hotelId='h2', user es 'h1'.
    await s.create({ reservationId: 'r1', amount: 100, hotelId: 'h2' } as any, currentUser)
    expect(created[0].hotelId).toBe('h1') // forzado al del JWT
    expect(created[0].status).toBe('pending')
  })

  // ── SEC-1: el monto del cobro lo decide el SERVIDOR, no el navegador ──────────────────────
  describe('techo del monto (SEC-1)', () => {
    function serviceWith(opts: {
      reservation?: Record<string, any> | null; addons?: any[]; existing?: any[]
      /** Folios/facturas/pagos de la reserva: el camino real a `payments` (GH-0.2). */
      folios?: any[]; invoices?: any[]; payments?: any[]
    } = {}) {
      const created: any[] = []
      const repo = makeRepo<PaymentRequestDTO>({
        create: async (d: any) => { created.push(d); return { id: 'pr1', ...d } },
        // `payment_requests` ya vivos de la MISMA reserva: el techo los descuenta (SEC-2).
        findMany: async () => (opts.existing ?? []) as any,
      })
      const reservationRepo = opts.reservation === null
        ? makeRepo<any>({ findById: async () => null })
        : makeReservationRepo(opts.reservation ?? {})
      const s = wireMoney(new PaymentRequestsService(
        repo, reservationRepo, makeRepo<any>(), makeRepo<any>(), makeUserRepo(), log, strictAuth,
        makeAddonRepo(opts.addons ?? []),
      ), { folios: opts.folios, invoices: opts.invoices, payments: opts.payments })
      return { s, created, repo, reservationRepo }
    }

    it('rechaza un cobro por encima del saldo pendiente de la reserva', async () => {
      // Saldo real: 500 − 200 = 300. Pedir 400 es cobrar de más.
      const { s, created } = serviceWith()
      await expect(s.create({ reservationId: 'r1', amount: 400 } as any, currentUser))
        .rejects.toThrow('supera el saldo cobrable')
      expect(created).toHaveLength(0)
    })

    it('el techo incluye los extras: con addons sube y el mismo monto pasa', async () => {
      const { s, created } = serviceWith({ addons: [{ amount: 60, quantity: 2, kind: 'service' }] })
      await s.create({ reservationId: 'r1', amount: 400 } as any, currentUser)
      expect(created[0].amount).toBe(400) // 500 + 120 − 200 = 420 de saldo
    })

    it('rechaza monto <= 0 (el schema sólo pedía min:0)', async () => {
      const { s, created } = serviceWith()
      await expect(s.create({ reservationId: 'r1', amount: 0 } as any, currentUser))
        .rejects.toThrow('mayor a 0')
      expect(created).toHaveLength(0)
    })

    it('rechaza cobrar contra una reserva de OTRO hotel (IDOR por reservationId)', async () => {
      const { s, created } = serviceWith({ reservation: { hotelId: 'h2' } })
      await expect(s.create({ reservationId: 'r1', amount: 100 } as any, currentUser))
        .rejects.toThrow('no pertenece a este hotel')
      expect(created).toHaveLength(0)
    })

    it('rechaza una reserva inexistente', async () => {
      const { s } = serviceWith({ reservation: null })
      await expect(s.create({ reservationId: 'fantasma', amount: 100 } as any, currentUser))
        .rejects.toThrow('Reserva no encontrada')
    })

    it('el update tampoco puede subir el monto por encima del saldo', async () => {
      const s = makeService({ prHotelId: 'h1', userHotelId: 'h1' })
      await expect(s.update('pr1', { amount: 9999 }, currentUser)).rejects.toThrow('supera el saldo cobrable')
    })

    it('un anticipo parcial sigue siendo válido', async () => {
      const { s, created } = serviceWith()
      await s.create({ reservationId: 'r1', amount: 50 } as any, currentUser)
      expect(created[0].amount).toBe(50)
    })

    // ── SEC-2: el techo es AGREGADO, no por cobro ──────────────────────────────────────────
    // `ReservationModal.vue:requirePayment` crea un PaymentRequest nuevo por click, siempre por el
    // pendiente completo. Con el techo por-cobro, tres clicks dejaban tres links de $300 vivos
    // sobre un saldo de $300 y el huésped podía pagar $900.
    it('descuenta del techo los links de pago pendientes de la misma reserva', async () => {
      const { s, created } = serviceWith({ existing: [{ id: 'prA', status: 'pending', amount: 300 }] })
      await expect(s.create({ reservationId: 'r1', amount: 300 } as any, currentUser))
        .rejects.toThrow('cobros pendientes')
      expect(created).toHaveLength(0)
    })

    it('el saldo remanente sí se puede cobrar (techo = saldo − comprometido)', async () => {
      const { s, created } = serviceWith({ existing: [{ id: 'prA', status: 'pending', amount: 200 }] })
      await s.create({ reservationId: 'r1', amount: 100 } as any, currentUser) // 300 − 200 = 100
      expect(created[0].amount).toBe(100)
      await expect(s.create({ reservationId: 'r1', amount: 101 } as any, currentUser))
        .rejects.toThrow('supera el saldo cobrable')
    })

    it('un link ya pagado/cancelado NO consume techo', async () => {
      const { s, created } = serviceWith({ existing: [
        { id: 'prA', status: 'paid', amount: 300 },
        { id: 'prB', status: 'cancelled', amount: 300 },
      ] })
      await s.create({ reservationId: 'r1', amount: 300 } as any, currentUser)
      expect(created[0].amount).toBe(300)
    })

    it('el update no se cuenta a sí mismo: subir el propio monto hasta el saldo pasa', async () => {
      const pr: PaymentRequestDTO = {
        id: 'pr1', hotelId: 'h1', reservationId: 'r1', amount: 100,
        currency: 'USD', status: 'pending', sentTo: '', sentVia: 'email',
      }
      const repo = makeRepo<PaymentRequestDTO>({
        findById: async () => pr,
        findMany: async () => [pr] as any,
        update: async (id: any, d: any) => ({ ...pr, id, ...d }),
      })
      const s = wireMoney(new PaymentRequestsService(
        repo, makeReservationRepo(), makeRepo<any>(), makeRepo<any>(), makeUserRepo(), log, strictAuth, makeAddonRepo(),
      ))
      const out = await s.update('pr1', { amount: 300 }, currentUser)
      expect(out.amount).toBe(300)
    })

    // ── QA7-4: el checkout cobraba `Number(pr.amount)` sin volver a validar ───────────────
    // El techo sólo corría en create/update. Entre el alta del link y el click de "generar
    // checkout" el saldo puede haber bajado (pago en efectivo, baja de extras) y la sesión de
    // Stripe se creaba igual por el monto viejo.
    it('createCheckout revalida el monto contra el saldo antes de abrir la sesión de Stripe', async () => {
      const realIsConfigured = StripeService.isConfigured
      const realCreate = StripeService.createCheckoutSession
      let sessionsCreated = 0
      StripeService.isConfigured = (async () => true) as typeof StripeService.isConfigured
      StripeService.createCheckoutSession = (async () => { sessionsCreated++; return { sessionId: 's', sessionUrl: 'u' } }) as typeof StripeService.createCheckoutSession
      try {
        // El link quedó por 400 pero la reserva sólo debe 300 (500 − 200 de anticipo).
        const pr: PaymentRequestDTO = {
          id: 'pr1', hotelId: 'h1', reservationId: 'r1', amount: 400,
          currency: 'USD', status: 'pending', sentTo: '', sentVia: 'email',
        }
        const repo = makeRepo<PaymentRequestDTO>({ findById: async () => pr, findMany: async () => [pr] as any })
        const s = wireMoney(new PaymentRequestsService(
          repo, makeReservationRepo(), makeRepo<any>(), makeRepo<any>(), makeUserRepo(), log, strictAuth, makeAddonRepo(),
      ))
        await expect(s.createCheckout('pr1', currentUser, 'https://panel')).rejects.toThrow('supera el saldo cobrable')
        expect(sessionsCreated).toBe(0)
      } finally {
        StripeService.isConfigured = realIsConfigured
        StripeService.createCheckoutSession = realCreate
      }
    })

    // ── GH-0.2: lo ya cobrado sale de `payments`, no de `reservations.deposit` ────────────
    // `folios.applyPayment` y `facturas.pay` asientan en `payments` y NO tocan
    // `reservations.deposit`. Con el techo midiendo contra `deposit`, un huésped que pagó $300 en
    // efectivo por folio seguía figurando con $500 de saldo y el panel podía emitir un link de
    // Stripe por esos $500: se le cobraba dos veces la misma plata.
    it('descuenta del techo lo cobrado por folio aunque `deposit` sea 0', async () => {
      const { s, created } = serviceWith({
        reservation: { deposit: 0 },                                   // nadie tocó la columna
        folios: [{ id: 'f1', hotelId: 'h1', reservationId: 'r1', status: 'open' }],
        payments: [{ id: 'pay1', hotelId: 'h1', folioId: 'f1', type: 'charge', status: 'completed', amount: 300 }],
      })
      // Total cobrable 500, cobrado 300 → techo 200. Antes del fix el techo era 500 y esto pasaba.
      await expect(s.create({ reservationId: 'r1', amount: 400 } as any, currentUser))
        .rejects.toThrow('supera el saldo cobrable')
      expect(created).toHaveLength(0)
    })

    it('el saldo que queda tras el cobro por folio sí se puede cobrar', async () => {
      const { s, created } = serviceWith({
        reservation: { deposit: 0 },
        folios: [{ id: 'f1', hotelId: 'h1', reservationId: 'r1', status: 'open' }],
        payments: [{ id: 'pay1', hotelId: 'h1', folioId: 'f1', type: 'charge', status: 'completed', amount: 300 }],
      })
      await s.create({ reservationId: 'r1', amount: 200 } as any, currentUser)
      expect(created[0].amount).toBe(200)
    })

    it('cuenta también lo cobrado contra la factura de la reserva', async () => {
      const { s, created } = serviceWith({
        reservation: { deposit: 0 },
        invoices: [{ id: 'inv1', hotelId: 'h1', reservationId: 'r1' }],
        payments: [{ id: 'pay2', hotelId: 'h1', invoiceId: 'inv1', type: 'charge', status: 'completed', amount: 500 }],
      })
      await expect(s.create({ reservationId: 'r1', amount: 100 } as any, currentUser))
        .rejects.toThrow('no tiene saldo pendiente')
      expect(created).toHaveLength(0)
    })

    it('una devolución vuelve a abrir saldo cobrable (el refund resta)', async () => {
      const { s, created } = serviceWith({
        reservation: { deposit: 0 },
        folios: [{ id: 'f1', hotelId: 'h1', reservationId: 'r1', status: 'open' }],
        payments: [
          // Cobro de 500 devuelto entero: el original queda `refunded` y nace una fila `refund`.
          { id: 'pay1', hotelId: 'h1', folioId: 'f1', type: 'charge', status: 'refunded', amount: 500 },
          { id: 'pay2', hotelId: 'h1', folioId: 'f1', type: 'refund', status: 'completed', amount: 500 },
        ],
      })
      await s.create({ reservationId: 'r1', amount: 500 } as any, currentUser)
      expect(created[0].amount).toBe(500)
    })

    it('multi-tenancy: los pagos del folio de OTRO hotel no bajan el techo', async () => {
      const { s, created } = serviceWith({
        reservation: { deposit: 0 },
        folios: [{ id: 'f9', hotelId: 'h2', reservationId: 'r1', status: 'open' }],
        payments: [{ id: 'pay9', hotelId: 'h2', folioId: 'f9', type: 'charge', status: 'completed', amount: 500 }],
      })
      await s.create({ reservationId: 'r1', amount: 500 } as any, currentUser)
      expect(created[0].amount).toBe(500)
    })

    // ── SEC-3: sin reservationId, el update se salteaba TODA la validación ─────────────────
    it('el update exige monto > 0 aunque el request no tenga reserva', async () => {
      const pr: PaymentRequestDTO = {
        id: 'pr1', hotelId: 'h1', reservationId: '', amount: 100,
        currency: 'USD', status: 'pending', sentTo: '', sentVia: 'email',
      }
      const updates: any[] = []
      const repo = makeRepo<PaymentRequestDTO>({
        findById: async () => pr,
        update: async (id: any, d: any) => { updates.push(d); return { ...pr, id, ...d } },
      })
      const s = wireMoney(new PaymentRequestsService(
        repo, makeReservationRepo(), makeRepo<any>(), makeRepo<any>(), makeUserRepo(), log, strictAuth, makeAddonRepo(),
      ))
      await expect(s.update('pr1', { amount: 0 }, currentUser)).rejects.toThrow('mayor a 0')
      await expect(s.update('pr1', { amount: -50 }, currentUser)).rejects.toThrow('mayor a 0')
      expect(updates).toHaveLength(0)
    })
  })

  it('getById lanza NotFound si no existe', async () => {
    const s = makeService()
    // forzar findById null
    const s2 = new PaymentRequestsService(
      makeRepo<PaymentRequestDTO>({ findById: async () => null }),
      makeReservationRepo(), makeRepo<any>(), makeRepo<any>(), makeUserRepo(), log, strictAuth, makeAddonRepo(),
      )
    await expect(s2.getById('no-existe', currentUser)).rejects.toThrow('Payment request no encontrado')
    void s
  })

  it('update bloquea IDOR: PR de otro hotel → Forbidden (CR-26)', async () => {
    // PR pertenece a 'h2', user es 'h1' → assertOwnership debe throw.
    const s = makeService({ prHotelId: 'h2', userHotelId: 'h1' })
    await expect(s.update('pr1', { status: 'paid' }, currentUser)).rejects.toThrow('Forbidden')
  })

  it('update permite PR del propio hotel', async () => {
    const s = makeService({ prHotelId: 'h1', userHotelId: 'h1' })
    const updated = await s.update('pr1', { status: 'paid' }, currentUser)
    expect(updated.status).toBe('paid')
  })

  it('delete bloquea IDOR: PR de otro hotel → Forbidden (CR-25)', async () => {
    const s = makeService({ prHotelId: 'h2', userHotelId: 'h1' })
    await expect(s.delete('pr1', currentUser)).rejects.toThrow('Forbidden')
  })

  it('stripeStatus retorna configured:false sin keys', async () => {
    const s = makeService()
    const status = await s.stripeStatus(currentUser)
    expect(status.configured).toBe(false)
  })

  it('createCheckout retorna 503 si Stripe no configurado', async () => {
    const s = makeService()
    const res = await s.createCheckout('pr1', currentUser, 'http://localhost') as any
    expect(res.status).toBe(503)
  })
})
