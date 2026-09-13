// publicapi/types.ts — Contrato de la API pública v1 (integraciones externas por API key).
// Son DTOs propios, deliberadamente distintos de HabitacionesDTO/ReservasDTO: la API pública no
// expone el modelo interno tal cual (campos administrativos, ids internos de otras tablas, etc.).

export interface PublicRoomAvailabilityDTO {
  id: string
  number: string
  name?: string
  type?: string
  basePrice: number
  currency?: string
  capacity?: number
  available: boolean
}

export interface PublicRoomsQuery {
  checkIn?: string
  checkOut?: string
}

export interface CreatePublicReservationDTO {
  /** Unidad concreta (opcional, REQ-HAC-05): sólo fija el tipo y se valida su disponibilidad; sin ella hace falta `roomType`. */
  roomId?: string
  /** Tipo de habitación a reservar (el `type` que devuelve GET /rooms). Obligatorio si no viene `roomId`. */
  roomType?: string
  checkIn: string
  checkOut: string
  adults?: number
  children?: number
  totalAmount: number
  currency?: string
  notes?: string
  guestName: string
  guestEmail?: string
  guestPhone?: string
}

export interface PublicReservationDTO {
  id: string
  hotelId: string
  /** `null` hasta que recepción asigne la unidad (REQ-HAC-05). */
  roomId: string | null
  /** Tipo vendido. */
  roomType: string | null
  checkIn: string
  checkOut: string
  status?: string
  totalAmount: number
  currency?: string
  guestId?: string
  createdAt: string
  updatedAt: string
}

/** Datos que adjunta el middleware `api-key-auth` en `req.apiKeyAuth` (ver infrastructure/auth). */
export interface PublicApiAuthContext {
  hotelId?: string
  scope?: string
}

// ─── Puertos inyectados por connectors (regla: publicapi NUNCA importa habitaciones/reservas/huespedes) ───
export interface PublicApiRoomsPort {
  listAvailability(hotelId: string, query: PublicRoomsQuery): Promise<PublicRoomAvailabilityDTO[]>
}

export interface PublicApiReservationsPort {
  create(hotelId: string, dto: CreatePublicReservationDTO): Promise<PublicReservationDTO>
  getById(hotelId: string, id: string): Promise<PublicReservationDTO>
}
