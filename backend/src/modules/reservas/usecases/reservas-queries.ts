import { checkinHashFromId } from '../../../shared/utils/checkin-hash'
import type { ReservationPaidRepos } from '../../../shared/usecases/reservation-paid'
import { isRefundInFlight } from '../../../shared/usecases/web-booking-refund'
import { paidReposFrom, requireMoneyPort, type MoneyRowRef, type ReservationMoneyPort } from './money-port'

export class ReservasQueries {
  constructor(private readonly orm: any) {}

  async findReservationByHash(hash: string): Promise<any> {
    const reservas = await this.orm.findMany('Reservations', {}) as any[]
    return reservas.find((r: any) => checkinHashFromId(r.id) === hash || r.id === hash)
  }

  async getCompanions(reservationId: string): Promise<any[]> {
    return this.orm.findMany('Companions', { reservationId }) as any[]
  }

  async createCompanion(data: any): Promise<any> {
    return this.orm.create('Companions', data)
  }

  async getLockCodes(reservationId: string): Promise<any[]> {
    return this.orm.findMany('LockCodes', { reservationId }) as any[]
  }

  /**
   * SEC3-6: `hotelId` OBLIGATORIO, igual que `getReservationAddons` (SEC-4). Estas filas alimentan
   * `detail.payments` y muestran plata cobrable del huésped: sin el filtro, un `reservationId` de
   * un payload leía cobros de otro hotel. Falla fuerte — es un error de programación del caller.
   */
  async getPaymentRequests(reservationId: string, hotelId: string): Promise<any[]> {
    if (!hotelId) throw new Error(`reservas-queries: getPaymentRequests('${reservationId}') sin hotelId (multi-tenancy)`)
    return this.orm.findMany('PaymentRequests', { reservationId, hotelId }) as any[]
  }

  /**
   * Extras de la reserva. `hotelId` es OBLIGATORIO (SEC-4): el `reservationId` puede venir de un
   * payload y estos importes ahora entran al saldo cobrable (`shared/utils/reservation-balance`),
   * que es el techo de la Checkout Session de Stripe. Sin el filtro, un extra de otro hotel movía
   * ese techo. Falla fuerte —igual que `paidRepos`— porque es un error de programación del caller.
   */
  async getReservationAddons(reservationId: string, hotelId: string): Promise<any[]> {
    if (!hotelId) throw new Error(`reservas-queries: getReservationAddons('${reservationId}') sin hotelId (multi-tenancy)`)
    return this.orm.findMany('ReservationAddons', { reservationId, hotelId }) as any[]
  }

  // ── Camino reserva → dinero (GH-0.2) ────────────────────────────────────────────────────────
  // `payments` es la única fuente de verdad del dinero (CLAUDE.md), pero las tablas `folios`,
  // `invoices` y `payments` son de OTROS módulos. Este getter hacía `orm.findMany('Folios')`,
  // `orm.findMany('Invoices')` y `orm.findMany('Payment')` directo, contra la regla del proyecto
  // que `usecases/message-log.ts` escribe textual: nunca acceso directo a otro módulo, va por
  // conector. Ahora la lectura la hacen los dueños y llega por `usecases/money-port.ts`, cableado
  // en `connectors/reservas-money.ts`.

  /** Lo inyecta `connectors/reservas-money`. Sin él no hay número honesto de "lo cobrado". */
  setMoneyPort(port: ReservationMoneyPort): void { this.moneyPort = port }
  private moneyPort: ReservationMoneyPort | null = null

  /**
   * Repos con forma `RepositoryAdapter` para `shared/usecases/reservation-paid`.
   *
   * STR-2: el shim EXIGE `hotelId` en cada lectura (lo impone `paidReposFrom`). Un caller que lo
   * omitiera leería las filas de TODOS los hoteles y el saldo de la reserva saldría inflado con
   * plata ajena, sin un solo aviso. Falla fuerte a propósito — es un error de programación del
   * caller, no un caso de datos.
   */
  get paidRepos(): ReservationPaidRepos {
    return paidReposFrom(requireMoneyPort(this.moneyPort))
  }

  /**
   * Camino INVERSO al de `paidRepos`: de un movimiento de dinero a la reserva dueña (COR-1).
   * Los tres vínculos (`reservationId` directo, `folioId`, `invoiceId`) los resuelve el puerto
   * contra los módulos dueños. Siempre filtrado por `hotelId`: el id del folio/factura llega desde
   * una fila de `payments` y no puede autorizar una lectura cross-tenant.
   */
  async reservationIdOfMoneyRow(hotelId: string, ref: MoneyRowRef): Promise<string | null> {
    if (!hotelId) return null
    return requireMoneyPort(this.moneyPort).reservationIdOf(hotelId, ref)
  }

  async getAuditLogs(entity: string, entityId: string): Promise<any[]> {
    return this.orm.findMany('Auditlog', { entity, entityId }) as any[]
  }

  async createAuditLog(data: any): Promise<void> {
    this.orm.create('Auditlog', data).catch((e: any) => {})
  }

  async updateReservation(id: string, patch: any): Promise<void> {
    await this.orm.update('Reservations', id, patch)
  }

  async updateRoom(roomId: string, patch: any): Promise<void> {
    await this.orm.update('Rooms', roomId, patch)
  }

  async findGuestById(guestId: string): Promise<any> {
    const rows = await this.orm.findMany('Guests', { id: guestId })
    return rows?.[0] || null
  }

  async createGuest(data: any): Promise<any> {
    return this.orm.create('Guests', data)
  }

  async updateGuest(guestId: string, patch: any): Promise<void> {
    await this.orm.update('Guests', guestId, patch)
  }

  async findConfiguration(hotelId: string, key: string): Promise<any> {
    return (await this.orm.findMany('Configuration', { hotelId, key }))[0] || null
  }

  async upsertConfiguration(hotelId: string, key: string, value: string): Promise<void> {
    const existing = (await this.orm.findMany('Configuration', { hotelId, key }))[0] as any
    if (existing) await this.orm.update('Configuration', existing.id, { value })
    else await this.orm.create('Configuration', { id: crypto.randomUUID(), hotelId, key, value })
  }

  async findHotels(): Promise<any[]> {
    return this.orm.findMany('Hotels', {})
  }

  async findHotelById(hotelId: string): Promise<any> {
    return (await this.orm.findMany('Hotels', { id: hotelId }))[0] || null
  }

  async findRoomsByHotel(hotelId: string): Promise<any[]> {
    return this.orm.findMany('Rooms', { hotelId }) as any[]
  }

  async findReservationsByHotel(hotelId: string): Promise<any[]> {
    return this.orm.findMany('Reservations', { hotelId }) as any[]
  }

  async findReservationById(id: string): Promise<any> {
    return (await this.orm.findMany('Reservations', { id }))[0] || null
  }

  /**
   * #272 — Reclamo atómico del reembolso web: compare-and-swap que deja `refundStatus: 'pending'`
   * y devuelve `true` sólo al que ganó. Dos invocaciones concurrentes (evento duplicado + reintento
   * a mano) leen la misma fila; la primera escribe y el ORM pisa `updatedAt`, así que el UPDATE de
   * la segunda —guardado por el `updatedAt` leído— cambia 0 filas. Mismo patrón que
   * ari-outbox/usecases/outbox-store.ts. NO se filtra por `refundStatus`: las filas anteriores al
   * campo lo traen NULL y `campo = NULL` no matchea nunca en SQL (ver ese archivo).
   * `false` también si la reserva no existe, ya está `done` (no hay nada que reclamar) o tiene un
   * `pending` FRESCO (`isRefundInFlight`): un reembolso en vuelo esperando a Stripe, que el CAS solo
   * no ve porque nadie pisó `updatedAt` mientras tanto. Un `pending` VIEJO (el proceso murió tras
   * reclamar) sí se reclama de nuevo: justamente porque el guard es `updatedAt` y esta escritura lo
   * pisa, el segundo que llegue después ya ve un `pending` fresco y se queda afuera.
   */
  async claimRefund(id: string): Promise<boolean> {
    const row = (await this.orm.findMany('Reservations', { id }))[0] as any
    if (!row) return false
    if (row.refundStatus === 'done') return false
    if (isRefundInFlight(row)) return false
    // El guard es `updatedAt`, que el ORM setea con resolución de milisegundo: si este UPDATE cae
    // en el MISMO ms que la escritura anterior (la cancelación que disparó el evento), el valor
    // nuevo sería igual al leído y el perdedor también matchearía. Se espera a que el reloj avance
    // (acotado: un `updatedAt` en el futuro por desfase de reloj no puede colgar el reembolso).
    for (let i = 0; i < 5 && row.updatedAt && new Date().toISOString() <= String(row.updatedAt); i++) await new Promise((r) => setTimeout(r, 2))
    const guard = row.updatedAt ? { id, updatedAt: row.updatedAt } : { id }
    const changes = await this.orm.updateMany('Reservations', guard, { refundStatus: 'pending' })
    return Number(changes) === 1
  }
}
