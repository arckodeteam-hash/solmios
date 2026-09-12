// facturas/usecases/hotel-header.ts — Datos del hotel para la cabecera de la factura renderizada.
// Cubre el CA 5 de #298: la factura (impresión, PDF y email) lleva nombre, dirección, teléfono y email del hotel.
// No incluye logo a propósito: una URL inalcanzable colgaría el setContent de puppeteer al generar el PDF.

import type { RepositoryAdapter } from 'arckode-framework'

export interface HotelHeader {
  hotelName: string
  hotelAddress?: string
  hotelPhone?: string
  hotelEmail?: string
}

const DEFAULT_HEADER: HotelHeader = { hotelName: 'Hotel' }

/** Devuelve el string recortado si viene no vacío; undefined en cualquier otro caso. */
function nonEmpty(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

/**
 * Resuelve la cabecera del hotel para renderInvoiceHtml. Nunca lanza: sin repo, sin hotelId,
 * hotel inexistente o error de lectura → `{ hotelName: 'Hotel' }`.
 */
export async function hotelHeaderOf(
  hotelRepo: Pick<RepositoryAdapter<any>, 'findById'> | undefined | null,
  hotelId: string | null | undefined,
): Promise<HotelHeader> {
  if (!hotelRepo || !hotelId) return { ...DEFAULT_HEADER }

  let hotel: any
  try {
    hotel = await hotelRepo.findById(hotelId)
  } catch {
    return { ...DEFAULT_HEADER }
  }
  if (!hotel) return { ...DEFAULT_HEADER }

  const header: HotelHeader = { hotelName: nonEmpty(hotel.name) ?? DEFAULT_HEADER.hotelName }
  const address = nonEmpty(hotel.address)
  const phone = nonEmpty(hotel.phone)
  const email = nonEmpty(hotel.email)
  if (address) header.hotelAddress = address
  if (phone) header.hotelPhone = phone
  if (email) header.hotelEmail = email
  return header
}
