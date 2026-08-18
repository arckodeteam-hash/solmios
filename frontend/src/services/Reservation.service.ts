import { http } from './http'
import type {
  Reservation, ReservationStatus, ReservationSource, ReservationDetail, GuaranteeCardData, AuditLogEntry,
  ReservationApiRecord as RawReservation,
  RescheduleInput, RescheduleCommitInput, RescheduleQuote, RescheduleResult,
  CancelPreview, CancelReservationInput, StayQuote,
} from '@/types'

// Los tipos del reagendado viven en `@/types` (dominio), no acá. Se re-exportan para no romper
// los imports existentes que los tomaban de este service.
export type {
  RescheduleInput, RescheduleCommitInput, RescheduleQuote, RescheduleResult,
  RescheduleCharge, RescheduleTarget, ReschedulePricingMode, RescheduleChargeMethod,
  CancelPreview, CancelReservationInput, CancelPolicySource, StayQuote,
} from '@/types'

export const STATUS_MAP: Record<string, ReservationStatus> = {
  pendiente: 'pending', pending: 'pending',
  confirmada: 'confirmed', confirmed: 'confirmed',
  check_in: 'checked_in', 'checked-in': 'checked_in', checked_in: 'checked_in', checkin: 'checked_in',
  check_out: 'checked_out', 'checked-out': 'checked_out', checked_out: 'checked_out', checkout: 'checked_out',
  cancelada: 'cancelled', cancelled: 'cancelled', canceled: 'cancelled',
}

const SOURCE_MAP: Record<string, ReservationSource> = {
  direct: 'direct', directa: 'direct',
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
    status,
    source: SOURCE_MAP[r.channel?.toLowerCase()] ?? 'other',
    totalAmount: r.totalAmount,
    depositAmount: r.deposit ?? 0,
    paymentStatus: (r.deposit ?? 0) >= r.totalAmount ? 'paid' : (r.deposit ?? 0) > 0 ? 'partial' : 'pending',
    roomNumber: r.roomNumber,
    roomType: r.roomType,
    guestName: r.guestName,
    guestEmail: r.guestEmail,
    // Snapshot de la cancelación: lo devuelve POST /cancel y es el monto que el servidor
    // realmente aplicó (el del preview es una cotización anterior).
    cancellationFee: r.cancellationFee,
    refundAmount: r.refundAmount,
  } as Reservation
}

interface ReservationsResponse {
  data: RawReservation[]
  total: number
}

export const ReservationService = {
  async list(params?: { hotelId?: string; status?: string; limit?: number; guestId?: string }): Promise<{ reservations: Reservation[]; total: number }> {
    const qs = new URLSearchParams()
    if (params?.hotelId) qs.set('hotelId', params.hotelId)
    if (params?.status) qs.set('status', params.status)
    if (params?.limit) qs.set('limit', String(params.limit))
    if (params?.guestId) qs.set('guestId', params.guestId)
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
  async checkout(id: string, settle?: { method: string; amount: number; reference?: string } | null): Promise<{ settlement?: { folioId: string; invoiceId: string | null; balance: number; amountPaid: number; invoiceNumber: string | null } }> {
    return http.post(`/reservas/${id}/checkout`, { settle })
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

  /** Elimina una reserva (la UI lo limita a pendientes/canceladas). */
  async remove(id: string): Promise<void> {
    await http.delete(`/reservas/${id}`)
  },

  /** Envía el código de cerradura al email del huésped (botón del modal de reserva). */
  async sendLockCodeEmail(id: string): Promise<{ sentTo: string }> {
    const data = await http.post<{ success: boolean; sentTo: string }>(`/reservas/${id}/send-lock-code-email`, {})
    return { sentTo: data.sentTo }
  },
}

