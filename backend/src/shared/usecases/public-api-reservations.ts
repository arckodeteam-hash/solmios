// shared/usecases/public-api-reservations.ts — Lógica de creación/lectura de reservas para la API
// pública v1. Extraído del connector `publicapi-reservas.ts` (los conectores SOLO deben wirear).

import { ValidationError } from 'arckode-framework'
import type { CreatePublicReservationDTO, PublicReservationDTO } from '../../modules/publicapi/types'
import { publicApiSystemUser } from './public-api-availability'

export interface HuespedesCreatePort { create: (dto: any, user: any) => Promise<any> }
export interface ReservasCreatePort {
  create: (dto: any, user: any) => Promise<any>
  getById: (id: string, user: any) => Promise<any>
}

export async function createPublicReservation(
  huespedes: HuespedesCreatePort,
  reservas: ReservasCreatePort,
  hotelId: string,
  dto: CreatePublicReservationDTO,
): Promise<PublicReservationDTO> {
  const user = publicApiSystemUser(hotelId)
  // REQ-HAC-05 (#260): la API vende un TIPO. `roomId` es opcional; sin él hace falta `roomType`.
  // Regla cruzada que el schema del controller no expresa → 400 (mismo `ValidationError` que
  // `validateSchema`). Va ANTES de crear el huésped para no dejar una ficha huérfana.
  const roomId = dto.roomId ? String(dto.roomId) : undefined
  const roomType = dto.roomType ? String(dto.roomType) : undefined
  if (!roomId && !roomType) {
    throw new ValidationError('Indicá roomId o roomType', { roomType: ['Obligatorio si no viene roomId'] })
  }
  // La API pública recibe datos de contacto (nombre/email/teléfono), no un guestId: se crea un
  // huésped por reserva. v1 simplificado — sin dedupe por email (ver reporte final).
  const guest = await huespedes.create({ name: dto.guestName, email: dto.guestEmail, phone: dto.guestPhone }, user)
  // `reservas.create` (crud.ts `createReservation`) ya valida: tipo existente en el hotel,
  // disponibilidad por tipo (`availableOfType`), unidad libre si viene `roomId`, y persiste
  // `roomId: null` + `roomType` cuando no hay unidad.
  const reservation = await reservas.create({
    hotelId,
    roomId,
    roomType,
    checkIn: dto.checkIn,
    checkOut: dto.checkOut,
    adults: dto.adults,
    children: dto.children,
    totalAmount: dto.totalAmount,
    currency: dto.currency,
    notes: dto.notes,
    guestId: guest.id,
    status: 'pending',
    channel: 'direct',
    source: 'public-api',
  }, user)
  return toPublicReservation(reservation)
}

/** Respuesta pública: `roomId` nullable (sin unidad hasta el check-in) y `roomType` siempre presentes. */
export function toPublicReservation(reservation: any): PublicReservationDTO {
  return { ...reservation, roomId: reservation?.roomId ?? null, roomType: reservation?.roomType ?? null } as PublicReservationDTO
}

export async function getPublicReservation(
  reservas: ReservasCreatePort,
  hotelId: string,
  id: string,
): Promise<PublicReservationDTO> {
  const user = publicApiSystemUser(hotelId)
  // reservas.getById ya lanza AuthError si item.hotelId !== user.hotelId (ownership real: el
  // usuario sintético NO es super_admin).
  const item = await reservas.getById(id, user)
  return item ? toPublicReservation(item) : (item as PublicReservationDTO)
}
