import { http } from './http'
import type {
  Reservation, ReservationStatus, ReservationSource, ReservationDetail, GuaranteeCardData, AuditLogEntry,
  ReservationApiRecord as RawReservation, AssignableRoom,
  RescheduleInput, RescheduleCommitInput, RescheduleQuote, RescheduleResult,
  CancelPreview, CancelReservationInput, StayQuote, ReservationDetailMessageLog,
} from '@/types'

// Los tipos del reagendado viven en `@/types` (dominio), no acá. Se re-exportan para no romper
// los imports existentes que los tomaban de este service.
export type {
  RescheduleInput, RescheduleCommitInput, RescheduleQuote, RescheduleResult,
  RescheduleCharge, RescheduleTarget, ReschedulePricingMode, RescheduleChargeMethod,
  CancelPreview, CancelReservationInput, CancelPolicySource, StayQuote,
} from '@/types'

/** Medio por el que entró un cobro manual (REQ-RWP-06). */
export type MarkPaidMethod = 'cash' | 'transfer' | 'card' | 'other'

/** Body de `POST /reservas/:id/mark-paid`. `reference` es obligatoria para transfer/card. */
export interface MarkPaidInput {
  method: MarkPaidMethod
  amount: number
  reference?: string
  note?: string
}

export const STATUS_MAP: Record<string, ReservationStatus> = {
  pendiente: 'pending', pending: 'pending',
  confirmada: 'confirmed', confirmed: 'confirmed',
  check_in: 'checked_in', 'checked-in': 'checked_in', checked_in: 'checked_in', checkin: 'checked_in',
  check_out: 'checked_out', 'checked-out': 'checked_out', checked_out: 'checked_out', checkout: 'checked_out',
  cancelada: 'cancelled', cancelled: 'cancelled', canceled: 'cancelled',
}

const SOURCE_MAP: Record<string, ReservationSource> = {
  direct: 'direct', directa: 'direct',
  web: 'web',
  phone: 'phone',
  whatsapp: 'whatsapp',
  booking: 'booking', 'booking.com': 'booking',
  expedia: 'expedia',
  agoda: 'agoda',
  airbnb: 'airbnb',
  google: 'google',
  other: 'other',
}

export function mapReservation(r: RawReservation): Reservation {
  const status = STATUS_MAP[r.status?.toLowerCase()] ?? 'pending'
  return {
    id: r.id,
    hotelId: r.hotelId,
    guestId: r.guestId || '',
    roomId: r.roomId || '',
    checkIn: r.checkIn as unknown as Date,
    checkOut: r.checkOut as unknown as Date,
    adults: r.adults ?? 2,
    children: r.children ?? 0,
    childrenAges: r.childrenAges,
    groupId: r.groupId ?? undefined,
    status,
    // REQ-RWP-04 — `source` del backend distingue la reserva del widget web ('web') de la cargada
    // por recepción ('direct'); `channel` sigue siendo 'direct' en ambas, por eso no alcanza solo.
    source: r.source === 'web' ? 'web' : (SOURCE_MAP[r.channel?.toLowerCase()] ?? 'other'),
    totalAmount: r.totalAmount,
    depositAmount: r.deposit ?? 0,
    // El listado ya trae el estado real de cobro desde `payments` (backend, `paymentState`). La
    // fórmula deposit-vs-total queda SOLO como fallback para respuestas que no lo traen.
    paymentStatus: r.paymentState ?? ((r.deposit ?? 0) >= r.totalAmount ? 'paid' : (r.deposit ?? 0) > 0 ? 'partial' : 'pending'),
    paymentState: r.paymentState,
    paidAmount: r.paidAmount,
    roomNumber: r.roomNumber,
    roomType: r.roomType,
    guestName: r.guestName,
    guestEmail: r.guestEmail,
    // Snapshot de la cancelación: lo devuelve POST /cancel y es el monto que el servidor
    // realmente aplicó (el del preview es una cotización anterior).
    cancellationFee: r.cancellationFee,
    refundAmount: r.refundAmount,
    // Tarea 3.4 (corrección 2026-08-25) — bug real de QA: este allow-list no lo declaraba y
    // `pages/reservations/index.vue:load()` lee `r.approvalStatus` del objeto YA mapeado acá,
    // así que la KPI "Por aprobar", el badge de la fila y el botón "Aprobar" quedaban muertos
    // (siempre `null`) aunque el backend devolviera el campo correcto.
    approvalStatus: r.approvalStatus ?? null,
    // REQ-HAC-03/06 — auditoría de la asignación de unidad; `roomId` queda '' cuando viene null.
    roomAssignedAt: r.roomAssignedAt ?? null,
    roomAssignedBy: r.roomAssignedBy ?? null,
  } as Reservation
}

interface ReservationsResponse {
  data: RawReservation[]
  total: number
}

/** Resultado de `POST /api/reservas/:id/invoice` (REQ-FDR-02, #253). Espejo del backend
 *  `reservas/usecases/issue-invoice.ts`: el servidor emite la factura (con o sin folio) y
 *  vincula los pagos que ya existían; no crea pagos. */
export interface IssueInvoiceResult {
  invoiceId: string
  invoiceNumber?: string
  source: 'folio' | 'reservation'
  folioId?: string
  linkedPayments?: number
  amountPaid?: number
}

/**
 * Los tres endpoints de asignación (#258) devuelven `{ success, data }` DENTRO del envelope del
 * framework, así que `http` deja `{ success, data }` en vez del payload. Se desenvuelve acá para no
 * depender de que el backend lo corrija (y seguir andando si lo hace).
 */
function unwrapAssign<T>(raw: T | { data?: T }): T | undefined {
  if (raw && typeof raw === 'object' && 'data' in (raw as object) && 'success' in (raw as object)) return (raw as { data?: T }).data
  return raw as T
}

export const ReservationService = {
  /**
   * Envío REAL por WhatsApp al huésped, por la Cloud API de Meta.
   * Distinto del enlace `wa.me`, que solo abre WhatsApp en el navegador del recepcionista y no
   * puede confirmar si el mensaje llegó.
   */
  sendWhatsapp: (reservationId: string, payload: { templateId?: string; text?: string }) =>
    http.post<{ id: string; status: string; providerMessageId?: string; errorMessage?: string }>(
      `/reservas/${reservationId}/whatsapp`, payload,
    ),

  async list(params?: { hotelId?: string; status?: string; limit?: number; guestId?: string; groupId?: string }): Promise<{ reservations: Reservation[]; total: number }> {
    const qs = new URLSearchParams()
    if (params?.hotelId) qs.set('hotelId', params.hotelId)
    if (params?.status) qs.set('status', params.status)
    if (params?.limit) qs.set('limit', String(params.limit))
    if (params?.guestId) qs.set('guestId', params.guestId)
    // Requerimiento 13 — trae las demás habitaciones de una reserva de varias (mismo groupId),
    // para que ReservationModal.vue pueda mostrar la composición de cada una.
    if (params?.groupId) qs.set('groupId', params.groupId)
    const query = qs.toString()
    const data = await http.get<ReservationsResponse>(`/reservas${query ? `?${query}` : ''}`)
    return { reservations: data.data.map(mapReservation), total: data.total }
  },

  async create(input: {
    hotelId: string
    roomId: string
    guestId?: string
    checkIn: string
    checkOut: string
    channel?: string
    source?: string
    totalAmount: number
    status?: string
    deposit?: number
    depositPercentage?: number
    depositStatus?: string
    paymentMethod?: string
    adults?: number
    children?: number
    notes?: string
    ownerNotes?: string
    commission?: number
    commissionAmount?: number
    externalLocator?: string
    otaNotes?: string
    regime?: string
    promoCode?: string
    autoSendEnabled?: boolean
    emergencyContact?: { name: string; phone: string; relation: string; email?: string }
    creditCard?: { holderName: string; brand: string; number: string; cvv: string; expMonth: string; expYear: string }
  }): Promise<Reservation> {
    const data = await http.post<RawReservation>('/reservas', input)
    return mapReservation(data)
  },

  async update(id: string, patch: Partial<RawReservation>): Promise<Reservation> {
    const data = await http.put<RawReservation>(`/reservas/${id}`, patch)
    return mapReservation(data)
  },

  /**
   * Detalle extendido: reserva + guest + room + companions + lockCodes + payments + messageLogs.
   * Usa /reservations/:id (handler enriquecido en composition-root) — DISTINTO del CRUD del módulo
   * (/reservas). No es inconsistencia: son dos endpoints con propósito distinto — list/create/update
   * usan el módulo estándar; el detalle usa el handler con joins cross-module.
   */
  async getById(id: string): Promise<ReservationDetail> {
    return http.get<ReservationDetail>(`/reservations/${id}`)
  },

  /** Tarjeta de garantía: revela los datos parciales tras validar el PIN del hotel (MisterPlan). */
  async unlockGuaranteeCard(id: string, pin: string): Promise<GuaranteeCardData> {
    return http.post<GuaranteeCardData>(`/reservations/${id}/guarantee-card/unlock`, { pin })
  },

  /** Historial de cambios (audit trail) de una reserva. */
  async getAudit(id: string): Promise<{ data: AuditLogEntry[] }> {
    return http.get<{ data: AuditLogEntry[] }>(`/reservations/${id}/audit`)
  },

  /** Check-in real: reserva → checked_in + habitación occupied + folio abierto + huésped. */
  async checkin(id: string): Promise<{ folioId: string; guestId: string }> {
    const data = await http.post<{ ok: boolean; folioId: string; guestId: string }>(`/reservas/${id}/checkin`, {})
    return { folioId: data.folioId, guestId: data.guestId }
  },

  /** Check-out real: reserva → checked_out + habitación cleaning + tarea de limpieza.
   * Opcionalmente cierra folio, genera factura y registra pago. */
  /**
   * `acknowledgeDebt` es la confirmación de cerrar con saldo pendiente. El servidor la EXIGE
   * (409 con el importe si falta): la guarda dejó de vivir sólo en esta pantalla para valer también
   * en la app móvil y en cualquier integración. Ver `reservas/usecases/checkout-debt-guard.ts`.
   */
  async checkout(id: string, settle?: { method: string; amount: number; reference?: string } | null, acknowledgeDebt = false): Promise<{ settlement?: { folioId: string; invoiceId: string | null; balance: number; amountPaid: number; invoiceNumber: string | null } }> {
    return http.post(`/reservas/${id}/checkout`, { settle, acknowledgeDebt })
  },

  /**
   * Cotiza (dry-run) mover/extender una reserva: NO escribe. Devuelve noches, disponibilidad de la
   * habitación en el rango nuevo y los DOS precios posibles (`keepTotal` / `repricedTotal`), para
   * que el modal del planning haga elegir (#204/#207). Una sola llamada alcanza: cambiar de opción
   * en la UI NO requiere re-cotizar, porque el quote ya trae ambos totales.
   */
  async rescheduleQuote(id: string, input: RescheduleInput): Promise<RescheduleQuote> {
    return http.post<RescheduleQuote>(`/reservas/${id}/reschedule/quote`, input)
  },

  /**
   * Cotiza una estadía NUEVA con la cadena de precio del hotel (temporadas incluidas):
   * desglose noche a noche con la temporada y el precio de cada fecha. Lo usa el wizard de
   * nueva reserva — antes cotizaba `basePrice × noches` en el frontend e ignoraba la grilla
   * de temporadas. POST (no GET): la ruta `/reservas/:id` está registrada antes en el router
   * del backend y capturaría `quote` como id.
   */
  async stayQuote(input: { roomId: string; checkIn: string; checkOut: string; guests: number }): Promise<StayQuote> {
    return http.post<StayQuote>('/reservas/quote', input)
  },

  /**
   * Aplica el cambio de habitación/fechas con el `pricingMode` elegido (mantener el precio pactado
   * o repreciar a tarifa vigente) y cobra la diferencia según el método elegido (folio / efectivo /
   * tarjeta). El cobro lo orquesta el servidor en una sola operación.
   */
  async reschedule(id: string, input: RescheduleCommitInput): Promise<RescheduleResult> {
    return http.post<RescheduleResult>(`/reservas/${id}/reschedule`, input)
  },

  /**
   * REQ-HAC-06 (#261) — habitaciones LIBRES para las noches de la reserva. Sin `allTypes` el backend
   * devuelve sólo las del tipo vendido (`roomType`); con `allTypes` también las de otros tipos, que
   * vienen con `typeMismatch: true` y exigen `allowTypeChange` al asignar.
   */
  async assignableRooms(id: string, allTypes = false): Promise<AssignableRoom[]> {
    const data = await http.get<AssignableRoom[] | { data?: AssignableRoom[] }>(`/reservas/${id}/assignable-rooms${allTypes ? '?allTypes=1' : ''}`)
    return Array.isArray(data) ? data : unwrapAssign(data) ?? []
  },

  /**
   * REQ-HAC-03 (#258) — asigna (o reasigna) la unidad concreta a la reserva. Es el ÚNICO camino que
   * escribe `roomId` sobre una reserva existente: valida solape, bloqueo, tipo y estado en el backend.
   * 409 con `ApiError.details.reason` (room_overlap / type_mismatch / room_not_sellable /
   * invalid_status) — `utils/room-assign.ts` `assignErrorMessage` lo traduce para el toast.
   */
  async assignRoom(id: string, roomId: string, allowTypeChange = false): Promise<Reservation> {
    const data = await http.post<RawReservation | { data?: RawReservation }>(`/reservas/${id}/assign-room`, allowTypeChange ? { roomId, allowTypeChange: true } : { roomId })
    return mapReservation(unwrapAssign(data) as RawReservation)
  },

  /** Suelta la unidad asignada (sólo pending/confirmed): la reserva vuelve a "Sin asignar". */
  async unassignRoom(id: string): Promise<Reservation> {
    const data = await http.delete<RawReservation | { data?: RawReservation }>(`/reservas/${id}/assign-room`)
    return mapReservation(unwrapAssign(data) as RawReservation)
  },

  /**
   * Cancela la reserva aplicando la POLÍTICA de cancelación del hotel: calcula penalidad y
   * reembolso, guarda el motivo y libera/devuelve los depósitos retenidos.
   *
   * NO reemplazable por `update(id, { status: 'cancelled' })`: eso solo pisa el estado y deja
   * la plata sin resolver (sin penalidad, sin reembolso, sin motivo, con el depósito retenido).
   */
  async cancel(id: string, body: CancelReservationInput = {}): Promise<Reservation> {
    const data = await http.post<RawReservation>(`/reservas/${id}/cancel`, body)
    return mapReservation(data)
  },

  /**
   * Cotiza (dry-run) la cancelación: NO escribe. Devuelve la consecuencia económica exacta
   * (penalidad, reembolso, política aplicada) para mostrarla ANTES de confirmar.
   */
  async cancelPreview(id: string): Promise<CancelPreview> {
    return http.get<CancelPreview>(`/reservas/${id}/cancel-preview`)
  },

  /**
   * Tarea 3.4 (corrección 2026-08-25) — aprueba una reserva pública que quedó pendiente de
   * revisión porque el hotel apagó "Confirmación instantánea". Solo mueve `approvalStatus`
   * ('pending' → 'approved'); NO toca `status`, folio ni disponibilidad — la reserva ya
   * estaba pagada y ocupando la habitación desde que se creó.
   */
  async approve(id: string): Promise<Reservation> {
    const data = await http.post<RawReservation>(`/reservas/${id}/approve`, {})
    return mapReservation(data)
  },

  /**
   * REQ-RWP-06 (#249) — registra un cobro MANUAL recibido fuera de Stripe (efectivo, transferencia,
   * tarjeta en el mostrador, otro). Antes la recepción "confirmaba" la reserva cambiando el status
   * a mano y la plata no quedaba en ningún lado: ni en el historial de cobros ni en la caja.
   * El backend inserta el pago en `payments` (con quién lo registró), recalcula `pendingAmount` /
   * `paymentState` y, si saldó todo, confirma la reserva. NUNCA toca `deposit`: el anticipo es
   * un dato de la reserva, no un cobro. Reference es obligatoria para transfer/card y el monto
   * no puede superar el saldo pendiente (400 con mensaje legible en ambos casos).
   */
  async markPaid(id: string, body: MarkPaidInput): Promise<Reservation> {
    const data = await http.post<RawReservation>(`/reservas/${id}/mark-paid`, body)
    return mapReservation(data)
  },

  /**
   * REQ-FDR-02 (#253) — emite la factura de la reserva desde el modal: `POST /reservas/:id/invoice`.
   * El backend decide si sale por el folio abierto (`source: 'folio'`) o directo desde la reserva
   * (`source: 'reservation'`) y vincula los pagos que ya existían; NO crea pagos. Si la reserva ya
   * tiene factura responde 409 con `invoiceId` (idempotente). El body se devuelve tal cual: `http.post`
   * ya desenvuelve `{ success, data }` y el controller manda el resultado directo.
   */
  async issueInvoice(id: string, notes?: string): Promise<IssueInvoiceResult> {
    return http.post<IssueInvoiceResult>(`/reservas/${id}/invoice`, notes ? { notes } : {})
  },

  /** Elimina una reserva (la UI lo limita a pendientes/canceladas). */
  async remove(id: string): Promise<void> {
    await http.delete(`/reservas/${id}`)
  },

  /** Envía el código de cerradura al email del huésped (botón del modal de reserva). */
  async sendLockCodeEmail(id: string): Promise<{ sentTo: string }> {
    const data = await http.post<{ success: boolean; sentTo: string }>(`/reservas/${id}/send-lock-code-email`, {})
    return { sentTo: data.sentTo }
  },

  /**
   * Deja constancia en `message_logs` de un envío MANUAL al huésped (plantillas de WhatsApp
   * del modal). El envío lo hace el staff en su propio WhatsApp: por eso el estado es
   * `queued` ("abierto/preparado") y no `sent` — el sistema no puede confirmar la entrega.
   * Permiso backend: `reservations:edit`.
   */
  async logManualMessage(
    id: string,
    payload: { messageType?: 'whatsapp' | 'sms' | 'email'; recipient?: string; reference?: string; status?: 'queued' | 'failed' },
  ): Promise<ReservationDetailMessageLog> {
    return http.post<ReservationDetailMessageLog>(`/reservas/${id}/message-log`, payload)
  },
}

