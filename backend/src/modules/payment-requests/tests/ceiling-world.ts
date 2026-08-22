// payment-requests/tests/ceiling-world.ts — Banco de pruebas REAL del camino del dinero.
//
// RTC-4.2. Hasta acá todo el flujo de Stripe se ejercía contra dobles de `RepositoryAdapter`
// escritos a mano en cada test: aceptaban cualquier campo, `findMany` filtraba por igualdad exacta
// sobre un array y `paidForReservation` —que consulta TRES tablas (`folios`, `invoices`,
// `payments`)— nunca se corrió contra una base. Los nombres de modelo y de campo estaban cotejados
// a mano contra los `orm.define`, y eso es exactamente lo que el anti-patrón ORM del CLAUDE.md
// (`allowedFields` descarta en silencio lo no declarado) convierte en un bug invisible.
//
// Acá el mundo es: SQLite in-memory (`SqliteAdapter(':memory:')`, patrón de
// `bookingengine/tests/migrate-public-bookings.test.ts:22`) + el ORM del framework + `ormMigrate`
// desde los MISMOS `ModelDefinition` que registra `composition-root` + `OrmRepository` de verdad +
// `PaymentRequestsService` de verdad + los usecases de `reservas` de verdad, cableados como los
// cablea `connectors/reservas-payment-requests.ts`.
//
// Lo único fingido es STRIPE, y se finge con un LIBRO DE SESIONES, no con un stub que devuelve
// `true`: cada sesión tiene estado (`open`/`complete`/`expired`) y las transiciones son las del
// proveedor real (expirar una sesión pagada devuelve `paid`, el huésped no puede pagar una muerta).
// Ese libro es lo que hace medible la propiedad: la exposición viva es la suma de las sesiones que
// el proveedor todavía deja pagar, no la suma de las filas que nuestra tabla dice tener `pending`.

import { ORM, OrmRepository, Logger, MemoryCache } from 'arckode-framework'
import type { RepositoryAdapter, Auth, CacheAdapter, DbAdapter } from 'arckode-framework'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import { jwtTokenAdapter } from 'arckode-framework/adapters/jwt'
import { HotelAuth } from '../../../infrastructure/auth/hotel-auth'
import { PaymentRequestsService } from '../service'
import { stripeChargeDto } from '../usecases/payment-port'
import { StripeService } from '../../../services/stripe-service'
import { PaymentEventStore } from '../../../services/payment-gateway/payment-events'
import { registerSharedModels } from '../../../shared/models'
import { ReservasModel } from '../../reservas/model'
import { FoliosModel, FolioChargesModel } from '../../folios/model'
import { FacturasModel } from '../../facturas/model'
import { registerPaymentsModels } from '../../payments/model'
import { PaymentsService } from '../../payments/service'
import { paymentsLinkedTo, settledNetOfReservation } from '../../payments/usecases/reservation-money'
import { liveChargesOf, liveChargeRowsOf } from '../../payments/usecases/live-charges'
import { foliosOfReservation, reservationIdOfFolio } from '../../folios/usecases/reservation-money'
import { invoicesOfReservation, reservationIdOfInvoice } from '../../facturas/usecases/reservation-money'
import {
  buildReservationMoneyPort, paidReposFrom, type ReservationMoneyPort,
} from '../../reservas/usecases/money-port'
import { syncPendingAfterPayment, pendingAfterPaymentDeps } from '../../reservas/usecases/sync-pending-after-payment'
import { PaymentGatewaysModel, PaymentEventsModel } from '../../payment-gateways/model'
import { PaymentGatewayRegistry } from '../../../services/payment-gateway/registry'
import { UsuariosModel } from '../../usuarios/model'
import { AuditlogModel } from '../../auditlog/model'
import { paidForReservation, paidSourceFrom, type ReservationPaidRepos } from '../../../shared/usecases/reservation-paid'
import { pendingBalance } from '../../../shared/utils/reservation-balance'
import { round2 } from '../../../shared/utils/money'
import type { PaymentRequestDTO } from '../types'

export const HOTEL = 'h1'
export const RESERVATION = 'r1'
export const ADDON = 'a1'
export const USER = { id: 'u1', hotelId: HOTEL, role: 'hotel_admin' }

/** Reserva del escenario base: $500 de alojamiento + $100 de extra − $200 de anticipo = $400. */
export const BASE_TOTAL = 500
export const BASE_DEPOSIT = 200
export const BASE_ADDON = 100

// ── El libro de sesiones de Stripe ─────────────────────────────────────────────────────────────

export interface FakeSession {
  id: string
  hotelId: string
  status: 'open' | 'complete' | 'expired'
  amountMinor: number
  metadata: Record<string, string>
  paymentIntent: string
}

export class StripeLedger {
  readonly sessions = new Map<string, FakeSession>()
  private seq = 0

  reset(): void { this.sessions.clear() }

  open(hotelId: string, amountMinor: number, metadata: Record<string, string>): FakeSession {
    const id = `cs_${++this.seq}`
    const s: FakeSession = { id, hotelId, status: 'open', amountMinor, metadata, paymentIntent: `pi_${this.seq}` }
    this.sessions.set(id, s)
    return s
  }

  /** Sesiones que el proveedor TODAVÍA deja pagar. Es el lado izquierdo de la propiedad. */
  liveFor(hotelId: string, reservationId: string): FakeSession[] {
    return [...this.sessions.values()].filter(
      (s) => s.status === 'open' && s.hotelId === hotelId && s.metadata.reservationId === reservationId,
    )
  }

  /** Importe total que un huésped podría abonar AHORA por esa reserva, en unidades de moneda. */
  liveExposure(hotelId: string, reservationId: string): number {
    return round2(this.liveFor(hotelId, reservationId).reduce((sum, s) => sum + s.amountMinor / 100, 0))
  }
}

/**
 * Instala el doble de Stripe sobre `StripeService` (el módulo lo consume como objeto, igual que
 * `tests/ceiling-bypass.test.ts`). Devuelve la función que restaura los métodos reales.
 */
export function installStripe(ledger: StripeLedger): () => void {
  const real = {
    isConfigured: StripeService.isConfigured,
    createCheckoutSession: StripeService.createCheckoutSession,
    getSession: StripeService.getSession,
    expireCheckoutSession: StripeService.expireCheckoutSession,
    verifyWebhook: StripeService.verifyWebhook,
  }
  const S = StripeService as unknown as Record<string, unknown>
  S.isConfigured = async () => true
  S.createCheckoutSession = async (input: any) => {
    const s = ledger.open(String(input.hotelId), Math.round(Number(input.amount) * 100), {
      paymentRequestId: String(input.paymentRequestId), ...(input.metadata || {}),
    })
    return { sessionId: s.id, sessionUrl: `https://pay.test/${s.id}` }
  }
  S.getSession = async (sessionId: string) => {
    const s = ledger.sessions.get(sessionId)
    if (!s) return null
    return {
      id: s.id,
      status: s.status === 'complete' ? 'complete' : s.status,
      amount_total: s.amountMinor,
      url: `https://pay.test/${s.id}`,
    }
  }
  // Espeja `StripeService.expireCheckoutSession`: 'paid' si ya se completó (el caller NO puede
  // liberar el techo), 'expired' si estaba abierta o ya vencida, 'gone' si no existe.
  S.expireCheckoutSession = async (sessionId: string) => {
    const s = ledger.sessions.get(sessionId)
    if (!s) return 'gone'
    if (s.status === 'complete') return 'paid'
    s.status = 'expired'
    return 'expired'
  }
  // El webhook llega ya firmado por Stripe; acá la firma es el propio cuerpo.
  S.verifyWebhook = async (_hotelId: string, rawBody: string | Buffer) => JSON.parse(String(rawBody))
  return () => { Object.assign(StripeService, real) }
}

// ── El mundo persistido ────────────────────────────────────────────────────────────────────────

export interface World {
  db: DbAdapter & { connect(): Promise<void> }
  orm: ORM
  service: PaymentRequestsService
  /** El módulo `payments` REAL: es el único escritor del libro del dinero (RTC-7.3). */
  payments: PaymentsService
  /** Camino reserva ↔ dinero por los módulos dueños, igual que `connectors/reservas-money`. */
  moneyPort: ReservationMoneyPort
  reservationRepo: RepositoryAdapter<any>
  addonRepo: RepositoryAdapter<any>
  requestRepo: RepositoryAdapter<PaymentRequestDTO>
  paymentRepo: RepositoryAdapter<any>
  folioRepo: RepositoryAdapter<any>
  userRepo: RepositoryAdapter<any>
  paidRepos: ReservationPaidRepos
  paidOf: ReturnType<typeof paidSourceFrom>
  auth: Auth
  cache: CacheAdapter
  logger: Logger
  ledger: StripeLedger
  /** Vacía las tablas y vuelve a sembrar el escenario base. */
  reset(): Promise<void>
  /** Saldo cobrable REAL de la reserva. 0 si la reserva ya no existe. */
  balance(): Promise<number>
}

const MODELS: Array<[string, any]> = [
  ['Reservations', ReservasModel],
  ['Folios', FoliosModel],
  ['FolioCharges', FolioChargesModel],
  ['Invoices', FacturasModel],
  ['PaymentEvents', PaymentEventsModel],
  // RTC-7: el módulo `payments` entra ENTERO (su service real emite `onPaymentCreated`, que es el
  // choke point por el que se enteran `reservas` y el techo de un cobro asentado — puerta RTC-7.3).
  ['PaymentGateways', PaymentGatewaysModel],
  ['Users', UsuariosModel],
  // El hook del alta (`shared/usecases/auto-payment-request.ts`, puerta RTC-0.4) escribe su rastro
  // en `Auditlog` FUERA del try/catch: sin el modelo, la operación reventaría por el andamiaje y
  // no por la propiedad. `Configuration` ya lo registra `registerSharedModels`.
  ['Auditlog', AuditlogModel],
]

const TABLES = [
  'reservations', 'reservation_addons', 'payment_requests', 'payments',
  'payment_links', 'deposits', 'payment_gateways',
  'folios', 'folio_charges', 'invoices', 'payment_events', 'users',
  'configuration', 'audit_log',
]

export async function makeWorld(): Promise<World> {
  const db = new SqliteAdapter({ path: ':memory:', wal: false, foreignKeys: false }) as DbAdapter & { connect(): Promise<void> }
  await db.connect()
  const orm = new ORM(db)
  // `ReservationAddons` y `PaymentRequests` NO se copian acá: se registran desde su dueño canónico
  // (`shared/models.ts`), igual que `composition-root`. Copiar la definición volvería ciego al test
  // frente al anti-patrón ORM del CLAUDE.md — un campo renombrado en el modelo real seguiría
  // persistiendo contra la copia del test.
  registerSharedModels(orm)
  // `payments` registra sus TRES tablas desde su propio módulo (misma razón que `registerSharedModels`).
  registerPaymentsModels(orm)
  for (const [name, def] of MODELS) orm.define(name, def)
  await orm.migrate()

  const logger = new Logger('ceiling-property', 'error')
  const cache = new MemoryCache()
  const auth = new HotelAuth(jwtTokenAdapter, 'test-secret', logger, '1h', '7d') as unknown as Auth

  const reservationRepo = new OrmRepository<any>(orm, 'Reservations')
  const addonRepo = new OrmRepository<any>(orm, 'ReservationAddons')
  const requestRepo = new OrmRepository<PaymentRequestDTO>(orm, 'PaymentRequests')
  const paymentRepo = new OrmRepository<any>(orm, 'Payment')
  const folioRepo = new OrmRepository<any>(orm, 'Folios')
  const folioChargeRepo = new OrmRepository<any>(orm, 'FolioCharges')
  const invoiceRepo = new OrmRepository<any>(orm, 'Invoices')
  const userRepo = new OrmRepository<any>(orm, 'Users')
  const eventRepo = new OrmRepository<any>(orm, 'PaymentEvents')

  // El camino reserva → dinero se arma como en producción (`connectors/reservas-money` y
  // `connectors/payment-requests-money`): lo leen los módulos DUEÑOS y sale por el puerto. Antes
  // acá había un `{ folioRepo, invoiceRepo, paymentRepo }` a mano, que es justo el atajo
  // (`paidRepos` como repo genérico) que este change saca del código de producción — con él, el
  // test no podía ver si el puerto real cubre lo que el clamp necesita.
  const moneyPort = buildReservationMoneyPort({
    folios: {
      foliosOfReservation: (h, r) => foliosOfReservation(folioRepo, h, r) as any,
      reservationIdOfFolio: (h, f) => reservationIdOfFolio(folioRepo, h, f),
    },
    facturas: {
      invoicesOfReservation: (h, r) => invoicesOfReservation(invoiceRepo, h, r) as any,
      reservationIdOfInvoice: (h, i) => reservationIdOfInvoice(invoiceRepo, h, i),
    },
    payments: { paymentsLinkedTo: (h, ref) => paymentsLinkedTo(paymentRepo, h, ref) as any },
  })
  const paidRepos: ReservationPaidRepos = paidReposFrom(moneyPort)

  const service = new PaymentRequestsService(
    requestRepo, reservationRepo, folioRepo, folioChargeRepo, userRepo, logger, auth, addonRepo,
  )
  service.setMoneyDeps({
    paidRepos,
    // RTC-7.4: "dinero YA asentado de esta reserva" es una pregunta del puerto, no una lectura
    // cruda de `payments` con `as any` (ver `usecases/clamp-to-ceiling.ts`).
    settledNet: (hotelId, reservationId) => settledNetOfReservation(paymentRepo, hotelId, reservationId),
    // RTC-8.2/8.3 — sesiones de checkout vivas de la vía charge-card: las funciones REALES del
    // dueño, cableadas como `connectors/payment-requests-money`. La cancelación pasa por el
    // service de `payments` (expira sesión + marca `cancelled` + emite `onPaymentExpired`).
    liveCharges: (hotelId, reservationId, excludePaymentId) => liveChargesOf(paymentRepo, hotelId, reservationId, excludePaymentId),
    liveChargeRows: (hotelId, reservationId) => liveChargeRowsOf(paymentRepo, hotelId, reservationId),
    cancelLiveCharge: (hotelId, chargeId) => payments.liveChargePort.cancelLiveChargeOf(hotelId, chargeId),
  })
  service.setEventStore(new PaymentEventStore(eventRepo, logger))
  // El asiento del cobro lo arma `stripeChargeDto` — el MISMO que usa
  // `connectors/payment-requests-payments.ts`. Antes acá había una copia a mano de ese mapeo y se
  // desincronizó: el connector empezó a escribir `reservationId` (RTC-0.5) y la copia no, así que
  // en este mundo el asiento nacía sin vínculo con la reserva. Lo único propio del doble es la
  // persistencia (repo directo en vez del service de `payments`).
  service.setPaymentDeps({
    paymentPort: {
      findBySession: async (hotelId: string, stripeSessionId: string) => {
        const found = await paymentRepo.findOne({ hotelId, stripeSessionId })
        return found ? { id: found.id, status: found.status } : null
      },
      recordPayment: async (input) => {
        const p = await paymentRepo.create(stripeChargeDto(input) as any)
        return { id: p.id, status: p.status }
      },
    },
  })

  const ledger = new StripeLedger()
  const paidOf = paidSourceFrom(paidRepos)

  // ── El módulo `payments` de verdad + su connector con `reservas` ──────────────────────────────
  //
  // RTC-7.3: TODA plata que entra al sistema nace de `payments.createPayment` (folios-payments,
  // facturas-payments, payment-requests-payments, restaurante-payments, charge-reschedule-diff) y
  // ése es el evento que `connectors/payments-reservas` escucha para resincronizar el saldo. El
  // mundo lo monta ENTERO —service real + sockets reales— porque el saldo cobrable baja por acá
  // sin que nadie toque la reserva: cobrar en caja, por folio o por factura era la puerta que
  // ninguna operación del alfabeto podía ejercitar.
  const payments = new PaymentsService(
    paymentRepo, new OrmRepository<any>(orm, 'PaymentLink'), new OrmRepository<any>(orm, 'Deposit'),
    logger, cache, auth, userRepo,
    new PaymentGatewayRegistry(new OrmRepository<any>(orm, 'PaymentGateways') as any, logger),
    new PaymentEventStore(eventRepo, logger),
    // Sin `guestRepo`: el modelo `Guests` es de otro módulo y ninguna operación del alfabeto manda
    // `guestId` (si alguna lo mandara, `payment-crud` es fail-closed y la rechaza — no la deja pasar).
    folioRepo, invoiceRepo, undefined, reservationRepo,
  )
  // Espeja `connectors/payments-reservas.ts` + `reservas.service.syncPendingAfterPayment`: el
  // movimiento de dinero resincroniza el saldo persistido Y recorta los links vivos al techo nuevo.
  const pendingDeps = pendingAfterPaymentDeps(
    reservationRepo,
    {
      getReservationAddons: (rid: string, hid: string) => addonRepo.findMany({ reservationId: rid, hotelId: hid }) as any,
      reservationIdOfMoneyRow: (hid: string, ref: any) => moneyPort.reservationIdOf(hid, ref),
    },
    paidOf,
    async () => {},
    logger,
    (hotelId: string, reservationId: string) =>
      service.clampRequestsToCeiling(hotelId, reservationId, { ...USER, role: 'super_admin' }).then(() => undefined),
  )
  const resync = (p: any) => syncPendingAfterPayment(pendingDeps, p).then(() => {}).catch(() => {})
  // RTC-8.5: los TRES estados terminales del webhook mueven el saldo (completed lo baja;
  // expired/failed lo devuelven) — mismo socket set que `connectors/payments-reservas`.
  payments.setSockets({ onPaymentCreated: resync, onPaymentCompleted: resync, onPaymentExpired: resync, onPaymentFailed: resync, onRefundProcessed: resync })
  // RTC-8.1: el guard entre módulos, como `connectors/payments-ceiling` — la vía charge-card
  // valida contra el MISMO techo antes de abrir sesión.
  payments.setCeilingGuard({ assertChargeable: (p) => service.assertChargeableFor(p) })

  async function reset(): Promise<void> {
    for (const t of TABLES) await db.run(`DELETE FROM ${t}`)
    ledger.reset()
    await orm.create('Users', { id: USER.id, hotelId: HOTEL, name: 'Staff', email: 's@x.com', password: 'x', role: 'hotel_admin' })
    await orm.create('Reservations', {
      id: RESERVATION, hotelId: HOTEL, roomId: 'room1', guestId: 'g1',
      checkIn: '2026-01-10', checkOut: '2026-01-12', status: 'confirmed',
      totalAmount: BASE_TOTAL, deposit: BASE_DEPOSIT, otherCharges: 0, currency: 'USD',
      pendingAmount: BASE_TOTAL + BASE_ADDON - BASE_DEPOSIT,
    })
    await orm.create('ReservationAddons', {
      id: ADDON, hotelId: HOTEL, reservationId: RESERVATION,
      description: 'Traslado', amount: BASE_ADDON, quantity: 1, kind: 'service', status: 'pending',
    })
    // Automatización de cobro ENCENDIDA: es la precondición de la puerta RTC-0.4. Sin esto el hook
    // del alta sale por el `if (!auto?.autoPaymentRequest) return` y la operación no ejercita nada.
    await orm.create('Configuration', {
      id: 'cfg-auto', hotelId: HOTEL, key: 'automation_config', value: { autoPaymentRequest: true },
    })
  }

  async function balance(): Promise<number> {
    const res = await reservationRepo.findById(RESERVATION)
    if (!res) return 0
    const addons = await addonRepo.findMany({ reservationId: RESERVATION, hotelId: HOTEL })
    const paid = await paidForReservation(paidRepos, HOTEL, RESERVATION, res)
    return pendingBalance(res, addons as any[], paid)
  }

  return {
    db, orm, service, payments, moneyPort,
    reservationRepo, addonRepo, requestRepo, paymentRepo, folioRepo, userRepo,
    paidRepos, paidOf, auth, cache, logger, ledger, reset, balance,
  }
}
