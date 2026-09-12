// shared/usecases/notify-reservation-received.ts — Al hotel le entró una reserva (o un pago): que se entere.
//
// Antes el motor web y las OTA escribían la fila en `reservations` y nadie del hotel se enteraba
// hasta abrir el listado. Acá se arma UN aviso por reserva (o por grupo) y se reparte por tres vías,
// todas best-effort:
//   1) campanita (`notifications`) a cada usuario del hotel que puede VER reservas,
//   2) correo al buzón del hotel (`hotels.email`; si está vacío, al primer hotel_admin activo con
//      email) por la plantilla `reservation_new_staff` con el estado del pago (#267) — o por
//      `reservation_new_ota_staff` si vino de una OTA: ahí el cobro lo rige el canal y la ingestión
//      de Channex no trae ningún dato de pago, así que no se afirma nada sobre él,
//   3) push al teléfono de cada uno de esos usuarios, si hay Firebase.
//
// Quién recibe se decide con los permisos EFECTIVOS: la fila `roles` del hotel si existe (el hotel
// puede haber recortado o ampliado un rol) y, si no hay fila, el default del rol de sistema. Nunca
// se mira el mapa estático directo (#205).
//
// El cableado (qué repos, qué cola de correo, qué push) lo inyecta el connector desde el
// composition-root; acá sólo vive la lógica, para que se pueda testear con deps a mano.

import { getRolePermissions, hasPermission, type Permission } from '../permissions'
import type { PlatformIdentity } from '../utils/platform-identity'
import type { NotificationInput } from '../../services/email-sender'
import type { NotificationEvent } from '../../services/notification-defaults'
import type { NotificacionesPort, PushPort, RoomsPort } from './notify-task-assigned'

/**
 * Cola de correo al hotel. `enqueueNotification` (plantilla `reservation_new_staff`, #267) es la vía
 * preferida; `enqueue` (HTML crudo) queda como camino viejo para fakes/inyectores que todavía no la
 * exponen.
 */
export interface ReservationEmailSender {
  enqueue(input: {
    to: string
    subject: string
    html: string
    hotelId: string
    relatedType?: string
    relatedId?: string
  }): Promise<string>
  enqueueNotification?(input: NotificationInput): Promise<string>
}

export interface ReservationNotifyDeps {
  notificaciones: NotificacionesPort
  users: { list(hotelId?: string): Promise<any[]> }
  roles: {
    list(
      query: { hotelId: string; limit: number },
      user: { id: string; role: string; hotelId?: string },
    ): Promise<{ data: Array<{ name: string; permissions?: unknown }> }>
  }
  reservations: {
    findById(id: string): Promise<any | null>
    findMany(where: Record<string, unknown>): Promise<any[]>
  }
  hotels: { findById(id: string): Promise<{ name?: string; email?: string } | null> }
  guests?: { findById(id: string): Promise<{ name?: string; email?: string; phone?: string } | null> } | null
  rooms?: RoomsPort | null
  emailSender?: ReservationEmailSender | null
  push?: PushPort | null
  platformIdentity: () => Promise<PlatformIdentity>
  logger?: { warn(msg: string, meta?: Record<string, unknown>): void }
}

export type ReservationOrigin = 'web' | 'ota'

/** Lo que trae el socket: parcial. La reserva se recarga acá, no se confía en el payload. */
export interface ReservationRef {
  id: string
  hotelId: string
  /** nombre de la OTA cuando origin === 'ota' */
  ota?: string
}

export interface PaymentAttempt {
  totalAmount: number
  currency?: string
  provider?: string
  paymentRef?: string
}

export interface NotifyResult {
  notified: number
  emailed: boolean
}

/** Lo que el connector sabe del alta y la fila no: si ya se pagó y si había pasarela para pagar. */
export interface ReceivedOptions {
  paid?: boolean
  /** `false` = el hotel no tiene pasarela: el huésped NO pudo pagar y hay que contactarlo. */
  hasCheckout?: boolean
}

export const PAYMENT_STATUS_PAID = 'Pagado'
export const PAYMENT_STATUS_PENDING = 'Pendiente de pago'
export const PAYMENT_STATUS_UNPAID_NO_CHECKOUT = 'SIN PAGO — contactar al huésped'

/** Separador con el que `bookingengine/usecases/public-booking.ts` une `notesParts` en `notes`. */
const NOTES_SEPARATOR = ' | '

/** Prefijo del título cuando la reserva espera aprobación del hotel (`approvalStatus === 'pending'`). */
const PENDING_APPROVAL_PREFIX = 'Por aprobar: '

export const RESERVATION_NOTIFICATION_TYPE = 'reservation'

const GUEST_FALLBACK = 'Huésped sin nombre'

const SYSTEM_ROOMS_USER = { id: 'system', role: 'super_admin' } as const

export function reservationPanelLink(id: string): string {
  return `/panel/reservations?open=${id}`
}

const esc = (v: unknown): string => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function money(amount: unknown, currency: string): string {
  const n = Number(amount ?? 0)
  if (!Number.isFinite(n) || n <= 0) return '—'
  return `${n.toFixed(2)} ${currency}`
}

/** `YYYY-MM-DD` de un ISO. Con la hora no aporta nada en un aviso de una línea. */
function day(iso: unknown): string {
  const s = String(iso ?? '')
  return s.length >= 10 ? s.slice(0, 10) : s
}

function systemActor(hotelId: string): { id: string; role: string; hotelId: string } {
  return { id: 'system', role: 'super_admin', hotelId }
}

/**
 * Usuarios del hotel que pueden ver reservas, con los permisos que REALMENTE tienen.
 *
 * Mismo criterio que `infrastructure/auth/load-permissions.ts`: si hay fila `roles` con ese nombre
 * en el hotel se usan sus `permissions`; si no, `getRolePermissions` cae al default del rol de
 * sistema. Se excluyen los inactivos (`active === 0`) y super_admin (es de la plataforma, no del
 * hotel). Exportada para poder testearla sola.
 */
export async function findReservationViewers(
  deps: Pick<ReservationNotifyDeps, 'users' | 'roles' | 'logger'>,
  hotelId: string,
): Promise<Array<{ id: string; role: string; name?: string; email?: string }>> {
  let users: any[] = []
  try {
    users = await deps.users.list(hotelId)
  } catch (e) {
    deps.logger?.warn('No se pudieron listar los usuarios del hotel para avisar la reserva', {
      hotelId, error: (e as Error).message,
    })
    return []
  }

  // Una fila por rol del hotel; si el listado falla se sigue con los defaults (igual que el middleware).
  const customByRole = new Map<string, unknown>()
  try {
    const roles = await deps.roles.list({ hotelId, limit: 100 }, systemActor(hotelId))
    for (const row of roles?.data ?? []) {
      if (row?.name) customByRole.set(row.name, row.permissions)
    }
  } catch (e) {
    deps.logger?.warn('No se pudieron leer los roles del hotel; se usan los defaults', {
      hotelId, error: (e as Error).message,
    })
  }

  const out: Array<{ id: string; role: string; name?: string; email?: string }> = []
  for (const u of users) {
    if (!u?.id || !u.role) continue
    if (u.role === 'super_admin') continue
    if (Number(u.active ?? 1) === 0) continue
    const perms = getRolePermissions(u.role, customByRole.get(u.role) as Permission[] | undefined)
    if (!hasPermission(perms, 'reservations', 'view')) continue
    out.push({ id: String(u.id), role: String(u.role), name: u.name, email: u.email })
  }
  return out
}

interface GuestInfo {
  name: string
  email: string
  phone: string
}

/**
 * Huésped: fila `guests` (nombre, email, teléfono), o lo que trajo la reserva/OTA inline, o un
 * genérico. El nombre nunca queda vacío; email y teléfono sí pueden.
 */
async function resolveGuest(deps: ReservationNotifyDeps, row: any): Promise<GuestInfo> {
  const inlineName = row?.guestName ? String(row.guestName).trim() : ''
  const out: GuestInfo = {
    name: inlineName || GUEST_FALLBACK,
    email: row?.guestEmail ? String(row.guestEmail).trim() : '',
    phone: row?.guestPhone ? String(row.guestPhone).trim() : '',
  }
  if (row?.guestId && deps.guests) {
    try {
      const guest = await deps.guests.findById(String(row.guestId))
      if (guest) {
        const name = guest.name ? String(guest.name).trim() : ''
        if (name) out.name = name
        if (guest.email) out.email = String(guest.email).trim() || out.email
        if (guest.phone) out.phone = String(guest.phone).trim() || out.phone
      }
    } catch {
      // sin ficha, se sigue con lo que traiga la reserva
    }
  }
  return out
}

/** "hab. 101" si hay número; si no, el tipo; si no hay nada, vacío (se omite del texto). */
async function resolveRoomLabel(deps: ReservationNotifyDeps, row: any): Promise<string> {
  let roomType = row?.roomType ? String(row.roomType) : ''
  if (row?.roomId && deps.rooms) {
    try {
      const room = await deps.rooms.getById(String(row.roomId), SYSTEM_ROOMS_USER) as
        { number?: string | number; type?: string } | null
      if (room?.number) return String(room.number)
      if (!roomType && room?.type) roomType = String(room.type)
    } catch {
      // sin habitación cargada, se cae al tipo
    }
  }
  return roomType
}

interface ReservationSummary {
  row: any
  guest: string
  guestEmail: string
  guestPhone: string
  /** "hab. 101" / "hab. Doble" / "hab. ×3" / '' */
  room: string
  checkIn: string
  checkOut: string
  total: string
  /** Cantidad de reservas que cubre el aviso (1 salvo grupo). */
  count: number
}

/**
 * Carga la reserva y arma lo que va en el texto.
 *
 * Grupo: si la reserva tiene `groupId` se cargan las hermanas y se arma UN aviso ("hab. ×N", total
 * sumado). No hace falta dedupe persistente: los sockets del motor y de canales ya se emiten una
 * sola vez por grupo, así que este usecase corre una vez por alta.
 */
async function loadSummary(deps: ReservationNotifyDeps, ref: ReservationRef): Promise<ReservationSummary | null> {
  const row = await deps.reservations.findById(ref.id)
  if (!row) {
    deps.logger?.warn('Reserva a avisar no encontrada', { reservationId: ref.id, hotelId: ref.hotelId })
    return null
  }
  if (row.hotelId && String(row.hotelId) !== String(ref.hotelId)) {
    deps.logger?.warn('Reserva a avisar no pertenece al hotel indicado', {
      reservationId: ref.id, hotelId: ref.hotelId, rowHotelId: row.hotelId,
    })
    return null
  }

  const currency = String(row.currency || 'USD')
  let siblings: any[] = [row]
  if (row.groupId) {
    try {
      const found = await deps.reservations.findMany({ hotelId: ref.hotelId, groupId: row.groupId })
      if (Array.isArray(found) && found.length > 0) siblings = found
    } catch (e) {
      deps.logger?.warn('No se pudieron cargar las reservas del grupo; se avisa sólo esta', {
        reservationId: ref.id, groupId: row.groupId, error: (e as Error).message,
      })
    }
  }
  const count = siblings.length
  const totalAmount = siblings.reduce((acc, r) => acc + (Number(r?.totalAmount) || 0), 0)

  const guest = await resolveGuest(deps, row)
  let room = ''
  if (count > 1) {
    room = `hab. ×${count}`
  } else {
    const label = await resolveRoomLabel(deps, row)
    room = label ? `hab. ${label}` : ''
  }

  return {
    row,
    guest: guest.name,
    guestEmail: guest.email,
    guestPhone: guest.phone,
    room,
    checkIn: day(row.checkIn),
    checkOut: day(row.checkOut),
    total: money(totalAmount, currency),
    count,
  }
}

/** Plantillas de correo al staff (`notification-defaults.ts`): una por origen de la reserva. */
type StaffEmailEvent = Extract<NotificationEvent, 'reservation_new_staff' | 'reservation_new_ota_staff'>

interface Announcement {
  title: string
  message: string
  html: string
  metadata: Record<string, unknown>
  relatedType: string
  /**
   * Plantilla del correo al hotel. Junto con `summary` habilita el camino por plantilla (#267);
   * un aviso sin estos dos (el recordatorio de aprobación vencida, #271 MR-06) sale con el HTML
   * crudo de `html`.
   */
  event?: StaffEmailEvent
  /**
   * Texto del estado del pago (`{payment_status}`). Sólo lo llevan los avisos del motor web: la
   * OTA no informa cobro y el correo no lo inventa (queda `undefined` → sin línea de estado).
   */
  paymentStatus?: string
  /** Nombre del canal (`{channel_name}`) cuando la reserva vino de una OTA. */
  channelName?: string
  summary?: ReservationSummary
  /** Tipo de la campanita; por defecto `reservation`. */
  type?: string
}

/** "Por aprobar: " adelante cuando la reserva espera el visto bueno del hotel. */
function withApprovalPrefix(title: string, row: any): string {
  return row?.approvalStatus === 'pending' ? `${PENDING_APPROVAL_PREFIX}${title}` : title
}

export function paymentStatusFor(opts?: ReceivedOptions): string {
  if (opts?.paid) return PAYMENT_STATUS_PAID
  if (opts?.hasCheckout === false) return PAYMENT_STATUS_UNPAID_NO_CHECKOUT
  return PAYMENT_STATUS_PENDING
}

/** `notes` del motor viene como "a | b | c": una línea por nota para `{details}` (texto plano). */
function detailsFromNotes(notes: unknown): string {
  const raw = String(notes ?? '').trim()
  if (!raw) return ''
  return raw.split(NOTES_SEPARATOR).map((p) => p.trim()).filter(Boolean).join('\n')
}

/**
 * Link absoluto al panel para el correo: un path relativo dentro de un mail no abre nada. Sin
 * `PUBLIC_URL` devuelve '' y avisa por log — el correo sale sin botón (HTML crudo) o con
 * `{panel_link}` vacío (plantilla), nunca con un enlace muerto.
 */
function absolutePanelLink(deps: Pick<ReservationNotifyDeps, 'logger'>, ref: ReservationRef): string {
  const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '')
  if (!base) {
    deps.logger?.warn('PUBLIC_URL no configurado: el correo de reserva al hotel sale sin enlace al panel', {
      reservationId: ref.id, hotelId: ref.hotelId,
    })
    return ''
  }
  return `${base}${reservationPanelLink(ref.id)}`
}

/**
 * Destinatario del correo: `hotels.email`; si está vacío, el primer hotel_admin activo con email de
 * la lista del hotel (ya cargada para las campanitas: no se vuelve a consultar).
 */
function resolveHotelRecipient(
  hotel: { email?: string } | null,
  viewers: Array<{ id: string; role?: string; email?: string }>,
): string {
  const direct = (hotel?.email || '').trim()
  if (direct) return direct
  const admin = viewers.find((v) => v.role === 'hotel_admin' && (v.email || '').trim())
  return admin ? String(admin.email).trim() : ''
}

function templateVariables(
  a: Announcement,
  s: ReservationSummary,
  panelLink: string,
  hotelName: string,
  platformName: string,
): NotificationInput['variables'] {
  const row = s.row ?? {}
  const ages = Array.isArray(row.childrenAges) ? row.childrenAges.map((x: unknown) => String(x)).join(', ') : ''
  return {
    title: a.title,
    hotel_name: hotelName,
    guest_name: s.guest,
    guest_email: s.guestEmail || '—',
    guest_phone: s.guestPhone || '—',
    checkin_date: s.checkIn,
    checkout_date: s.checkOut,
    room: s.room ? s.room.replace(/^hab\. /, '') : (row.roomType ? String(row.roomType) : '—'),
    adults: Number(row.adults ?? 0) || 0,
    children: Number(row.children ?? 0) || 0,
    children_ages: ages || '—',
    crib: row.needsCrib ? 'Sí' : 'No',
    regime: row.regime ? String(row.regime) : '—',
    details: detailsFromNotes(row.notes),
    total_amount: s.total,
    payment_status: a.paymentStatus ?? '',
    channel_name: a.channelName ?? '',
    panel_link: panelLink,
    platform_name: platformName,
  }
}

/** Reparte el aviso: campanita por usuario, correo al hotel, push por usuario. Nunca tira. */
async function deliver(deps: ReservationNotifyDeps, ref: ReservationRef, a: Announcement): Promise<NotifyResult> {
  const actor = systemActor(ref.hotelId)
  const link = reservationPanelLink(ref.id)
  let notified = 0
  let emailed = false

  const viewers = await findReservationViewers(deps, ref.hotelId)

  // 1) Campanita: una fila por usuario con permiso. Si una falla, las demás siguen.
  for (const user of viewers) {
    try {
      await deps.notificaciones.create({
        hotelId: ref.hotelId,
        userId: user.id,
        type: a.type ?? RESERVATION_NOTIFICATION_TYPE,
        title: a.title,
        message: a.message,
        read: 0,
        date: new Date().toISOString(),
        metadata: a.metadata,
      }, actor)
      notified++
    } catch (e) {
      deps.logger?.warn('No se pudo crear la notificación de reserva', {
        reservationId: ref.id, userId: user.id, error: (e as Error).message,
      })
    }
  }

  // 2) Correo al hotel: `hotels.email` o, si falta, el primer hotel_admin activo con email. Sin
  //    ninguno no hay a quién escribirle: las campanitas ya quedaron.
  if (deps.emailSender) {
    const hotel = await deps.hotels.findById(ref.hotelId).catch(() => null)
    const to = resolveHotelRecipient(hotel, viewers)
    if (to) {
      const identity = await deps.platformIdentity().catch(() => null)
      const platformName = identity?.platformName?.trim() ?? ''
      const panelLink = absolutePanelLink(deps, ref)
      try {
        if (a.summary && a.event && typeof deps.emailSender.enqueueNotification === 'function') {
          // Plantilla por origen (editable por hotel en auto_messages, default en código).
          await deps.emailSender.enqueueNotification({
            to,
            hotelId: ref.hotelId,
            event: a.event,
            // El correo es al STAFF del hotel y no hay idioma de hotel en el modelo (`hotels` no lo
            // tiene; `booking_config.language` es el del widget para el huésped): queda 'es'.
            language: 'es',
            variables: templateVariables(a, a.summary, panelLink, String(hotel?.name || '').trim(), platformName),
            relatedType: a.relatedType,
            relatedId: ref.id,
          })
        } else {
          // HTML crudo: inyectores que sólo exponen `enqueue`, y los avisos sin `summary`/`event`
          // (aprobación vencida), que no llevan plantilla y salen como antes de #267.
          const html = [
            `<p><strong>${esc(a.title)}</strong></p>`,
            a.html,
            a.paymentStatus !== undefined ? `<p>Estado del pago: ${esc(a.paymentStatus)}</p>` : '',
            panelLink ? `<p><a href="${esc(panelLink)}">Abrir la reserva en el panel</a></p>` : '',
            platformName ? `<p style="color:#888;font-size:12px">Enviado por ${esc(platformName)}</p>` : '',
          ].filter(Boolean).join('\n')
          await deps.emailSender.enqueue({
            to,
            subject: `${platformName ? `[${platformName}] ` : ''}${a.title}`,
            html,
            hotelId: ref.hotelId,
            relatedType: a.relatedType,
            relatedId: ref.id,
          })
        }
        emailed = true
      } catch (e) {
        deps.logger?.warn('No se pudo encolar el correo de reserva al hotel', {
          reservationId: ref.id, error: (e as Error).message,
        })
      }
    }
  }

  // 3) Push al teléfono, para que llegue con la app cerrada. Sin Firebase o con error, no rompe.
  if (deps.push) {
    for (const user of viewers) {
      try {
        await deps.push.notifyUser(user.id, ref.hotelId, {
          title: a.title,
          body: a.message,
          data: { link, reservationId: ref.id },
        })
      } catch (e) {
        deps.logger?.warn('No se pudo enviar el push de reserva', {
          reservationId: ref.id, userId: user.id, error: (e as Error).message,
        })
      }
    }
  }

  return { notified, emailed }
}

function summaryMessage(s: ReservationSummary): string {
  return [s.guest, s.room, `${s.checkIn} → ${s.checkOut}`, s.total].filter(Boolean).join(', ')
}

function summaryHtml(s: ReservationSummary): string {
  return [
    `<p>Huésped: ${esc(s.guest)}</p>`,
    s.room ? `<p>Habitación: ${esc(s.room.replace(/^hab\. /, ''))}</p>` : '',
    `<p>Estadía: ${esc(s.checkIn)} → ${esc(s.checkOut)}</p>`,
    `<p>Total: ${esc(s.total)}</p>`,
  ].filter(Boolean).join('\n')
}

/**
 * Nueva reserva (motor web u OTA): avisa a quien puede ver reservas y al buzón del hotel.
 *
 * `opts` es lo que la fila no cuenta: si el alta ya vino pagada (`paid`) y si el hotel tenía
 * pasarela (`hasCheckout`). Sin opts el estado es "Pendiente de pago" (comportamiento anterior).
 *
 * Devuelve cuántas campanitas y si salió el correo, para que el llamador lo registre. Nunca tira:
 * un aviso que falla no puede deshacer una reserva que ya está guardada.
 */
export async function notifyReservationReceived(
  deps: ReservationNotifyDeps,
  reservation: ReservationRef,
  origin: ReservationOrigin,
  opts?: ReceivedOptions,
): Promise<NotifyResult> {
  try {
    const s = await loadSummary(deps, reservation)
    if (!s) return { notified: 0, emailed: false }

    const otaName = origin === 'ota'
      ? (reservation.ota || (s.row.channel && s.row.channel !== 'direct' ? String(s.row.channel) : '') || 'OTA')
      : ''
    const title = withApprovalPrefix(
      origin === 'ota'
        ? `Nueva reserva de ${otaName} — ${s.guest}`
        : `Nueva reserva web — ${s.guest}`,
      s.row,
    )

    // OTA: plantilla propia y SIN estado del pago — la ingestión de Channex no sabe si el canal
    // ya cobró (`canales/usecases/booking-ingestion.ts` no recibe dato de cobro) y "Pendiente de
    // pago" sobre una reserva que Booking ya cobró mandaba a recepción a reclamarle al huésped.
    const staff: Pick<Announcement, 'event' | 'paymentStatus' | 'channelName'> = origin === 'ota'
      ? { event: 'reservation_new_ota_staff', channelName: otaName }
      : { event: 'reservation_new_staff', paymentStatus: paymentStatusFor(opts) }

    return await deliver(deps, reservation, {
      title,
      message: summaryMessage(s),
      html: summaryHtml(s),
      metadata: { link: reservationPanelLink(reservation.id), reservationId: reservation.id, origin },
      relatedType: `reservation:${origin}`,
      ...staff,
      summary: s,
    })
  } catch (e) {
    deps.logger?.warn('No se pudo avisar la reserva recibida', {
      reservationId: reservation.id, hotelId: reservation.hotelId, error: (e as Error).message,
    })
    return { notified: 0, emailed: false }
  }
}

/**
 * Pago confirmado por la pasarela: mismo reparto, con monto y proveedor.
 */
export async function notifyReservationPaid(
  deps: ReservationNotifyDeps,
  reservation: ReservationRef,
  attempt: PaymentAttempt,
): Promise<NotifyResult> {
  try {
    const s = await loadSummary(deps, reservation)
    if (!s) return { notified: 0, emailed: false }

    const provider = attempt.provider?.trim() || 'la pasarela'
    const currency = attempt.currency || String(s.row.currency || 'USD')
    const amount = money(attempt.totalAmount, currency)
    const title = withApprovalPrefix(`Pago recibido — ${s.guest} — ${amount}`, s.row)
    const message = `${s.guest}, ${amount} por ${provider}`
    const html = [
      `<p>Huésped: ${esc(s.guest)}</p>`,
      `<p>Monto: ${esc(amount)} por ${esc(provider)}</p>`,
      attempt.paymentRef ? `<p>Referencia: ${esc(attempt.paymentRef)}</p>` : '',
      s.room ? `<p>Habitación: ${esc(s.room.replace(/^hab\. /, ''))}</p>` : '',
      `<p>Estadía: ${esc(s.checkIn)} → ${esc(s.checkOut)}</p>`,
    ].filter(Boolean).join('\n')

    return await deliver(deps, reservation, {
      title,
      message,
      html,
      metadata: { link: reservationPanelLink(reservation.id), reservationId: reservation.id, provider },
      relatedType: 'reservation:paid',
      event: 'reservation_new_staff',
      paymentStatus: PAYMENT_STATUS_PAID,
      summary: s,
    })
  } catch (e) {
    deps.logger?.warn('No se pudo avisar el pago confirmado', {
      reservationId: reservation.id, hotelId: reservation.hotelId, error: (e as Error).message,
    })
    return { notified: 0, emailed: false }
  }
}

/**
 * #272 — Aviso `system` (sin reserva que recargar, sin correo ni push) a cada usuario del hotel que
 * puede ver reservas. Lo usa el reembolso web cuando la pasarela no devolvió: el hotel tiene que
 * enterarse para reintentar desde la reserva. Nunca tira.
 */
export async function notifySystemToViewers(
  deps: Pick<ReservationNotifyDeps, 'notificaciones' | 'users' | 'roles' | 'logger'>,
  hotelId: string,
  n: { title: string; message: string; metadata?: Record<string, unknown> },
): Promise<{ notified: number }> {
  const actor = systemActor(hotelId)
  let notified = 0
  try {
    const viewers = await findReservationViewers(deps, hotelId)
    for (const user of viewers) {
      try {
        await deps.notificaciones.create({
          hotelId,
          userId: user.id,
          type: 'system',
          title: n.title,
          message: n.message,
          read: 0,
          date: new Date().toISOString(),
          metadata: n.metadata ?? {},
        }, actor)
        notified++
      } catch (e) {
        deps.logger?.warn('No se pudo crear la notificación de sistema', {
          hotelId, userId: user.id, title: n.title, error: (e as Error).message,
        })
      }
    }
  } catch (e) {
    deps.logger?.warn('No se pudo repartir la notificación de sistema', {
      hotelId, title: n.title, error: (e as Error).message,
    })
  }
  return { notified }
}

export interface CancellationInfo {
  refundAmount: number
  cancellationFee: number
  /** `reservations.refundStatus` tras intentar el reembolso (none | pending | done | failed). */
  refundStatus?: string
  /** Habitaciones que cubre la cancelación (grupo). Si no viene se cuenta el grupo. */
  roomsCount?: number
}

function refundStateLabel(info: CancellationInfo): string {
  if (!(Number(info.refundAmount) > 0)) return 'sin reembolso'
  if (info.refundStatus === 'done') return 'reembolsado'
  if (info.refundStatus === 'failed' || info.refundStatus === 'pending') return 'reembolso pendiente'
  return 'sin reembolso'
}

/**
 * #272 — El huésped canceló desde la web: campanita + push a quien puede ver reservas.
 *
 * El correo al hotel NO sale de acá: lo encola `email-bootstrap` con la plantilla editable
 * `reservation_cancelled_staff`. Por eso se reparte con `emailSender: null`. Nunca tira.
 */
export async function notifyReservationCancelled(
  deps: ReservationNotifyDeps,
  reservation: ReservationRef,
  info: CancellationInfo,
): Promise<NotifyResult> {
  try {
    const s = await loadSummary(deps, reservation)
    if (!s) return { notified: 0, emailed: false }

    const currency = String(s.row.currency || 'USD')
    const refund = Number(info.refundAmount) > 0 ? money(info.refundAmount, currency) : `0.00 ${currency}`
    const fee = money(info.cancellationFee, currency)
    const state = refundStateLabel(info)
    const count = info.roomsCount && info.roomsCount > 0 ? info.roomsCount : s.count
    const room = count > 1 ? `hab. ×${count}` : s.room
    const title = `Cancelación web · ${s.guest}`
    const message = [s.guest, room, `${s.checkIn} → ${s.checkOut}`, `reembolso ${refund} (${state})`]
      .filter(Boolean).join(', ')
    const html = [
      `<p>Huésped: ${esc(s.guest)}</p>`,
      room ? `<p>Habitación: ${esc(room.replace(/^hab\. /, ''))}</p>` : '',
      `<p>Estadía: ${esc(s.checkIn)} → ${esc(s.checkOut)}</p>`,
      `<p>Reembolso: ${esc(refund)} (${esc(state)})</p>`,
      fee !== '—' ? `<p>Penalidad: ${esc(fee)}</p>` : '',
    ].filter(Boolean).join('\n')

    // Sólo campanita + push: el correo al hotel va por la plantilla `reservation_cancelled_staff`.
    return await deliver({ ...deps, emailSender: null }, reservation, {
      title,
      message,
      html,
      metadata: {
        link: reservationPanelLink(reservation.id),
        reservationId: reservation.id,
        refundAmount: Number(info.refundAmount) || 0,
        refundStatus: info.refundStatus ?? (Number(info.refundAmount) > 0 ? 'pending' : 'none'),
      },
      relatedType: 'reservation:cancelled',
    })
  } catch (e) {
    deps.logger?.warn('No se pudo avisar la cancelación web', {
      reservationId: reservation.id, hotelId: reservation.hotelId, error: (e as Error).message,
    })
    return { notified: 0, emailed: false }
  }
}

export interface ApprovalOverdueInput {
  /** Plazo del hotel (`booking_config.approvalDeadlineHours`), ya resuelto por el llamador. */
  deadlineHours: number
  /** ISO: desde cuándo la reserva espera respuesta (`createdAt`). */
  pendingSince: string
}

/** Horas enteras transcurridas desde `since` (0 si no parsea o es futuro). */
function wholeHoursSince(since: string, now: Date): number {
  const t = new Date(since).getTime()
  if (!Number.isFinite(t)) return 0
  return Math.max(0, Math.floor((now.getTime() - t) / 3_600_000))
}

/**
 * #271 MR-06 — Reserva pagada que sigue `approvalStatus: 'pending'` pasado el plazo del hotel:
 * mismo reparto (campanita a quien ve reservas, correo al buzón del hotel, push), con las horas
 * de espera en el título. Quién y cuándo se avisa lo decide `approval-reminder.ts` (una sola vez
 * por reserva vía `reservations.approvalReminderAt`); acá sólo se arma y reparte el aviso.
 */
export async function notifyApprovalOverdue(
  deps: ReservationNotifyDeps,
  reservation: ReservationRef,
  input: ApprovalOverdueInput,
  now: Date = new Date(),
): Promise<NotifyResult> {
  try {
    const s = await loadSummary(deps, reservation)
    if (!s) return { notified: 0, emailed: false }

    const hours = wholeHoursSince(input.pendingSince, now)
    const deadlineHours = Number(input.deadlineHours)
    const title = `Reserva por aprobar hace ${hours} h — ${s.guest}`
    const advice = `El huésped ya pagó y espera respuesta. Plazo del hotel: ${deadlineHours} h. Aprobá o rechazá desde el panel.`
    const message = `${summaryMessage(s)}. ${advice}`
    const html = [
      summaryHtml(s),
      `<p>${esc(advice)}</p>`,
    ].join('\n')

    return await deliver(deps, reservation, {
      title,
      message,
      html,
      metadata: { link: reservationPanelLink(reservation.id), reservationId: reservation.id, kind: 'approval_overdue' },
      relatedType: 'reservation:approval_overdue',
    })
  } catch (e) {
    deps.logger?.warn('No se pudo avisar la aprobación vencida', {
      reservationId: reservation.id, hotelId: reservation.hotelId, error: (e as Error).message,
    })
    return { notified: 0, emailed: false }
  }
}
