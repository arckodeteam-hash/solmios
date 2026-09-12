import { NotFoundError, ValidationError } from 'arckode-framework'
import type { StorageService, FileUpload } from 'arckode-framework/modules/storage'
import type { ReservasQueries } from './reservas-queries'

export async function getPreCheckinData(hash: string, hotelRepo: any, roomRepo: any, guestRepo: any, queries: ReservasQueries): Promise<any> {
  const reservation = await queries.findReservationByHash(hash)
  if (!reservation) throw new NotFoundError('Reserva no encontrada')
  const today = new Date().toISOString().split('T')[0]
  if (reservation.checkOut && String(reservation.checkOut).slice(0, 10) < today) throw new NotFoundError('Esta reserva ya expiró')
  const hotels = await hotelRepo.findMany({ id: reservation.hotelId }) as any[]
  const hotel = hotels?.[0] as any
  // REQ-HAC-04 (#259): la reserva puede llegar al pre-check-in sin unidad (`roomId = null`, HAC-01).
  // No se consulta Rooms con `{ id: null }`; el huésped ve el TIPO vendido y `roomNumber` vacío.
  const rooms = reservation.roomId ? await roomRepo.findMany({ id: reservation.roomId }) as any[] : []
  const room = rooms?.[0] as any
  const guests = reservation.guestId ? await guestRepo.findMany({ id: reservation.guestId }) as any[] : []
  const guest = guests?.[0] as any
  return { id: reservation.id, reservationId: reservation.id, hash, hotelName: hotel?.name || '', roomNumber: room?.number || '', roomType: reservation.roomType || room?.type || '', checkIn: reservation.checkIn, checkOut: reservation.checkOut, guestName: guest?.name || '', email: guest?.email || '' }
}

/**
 * Sube la foto del documento del titular (paso "Documentos" del flujo público) y la deja
 * como `guest.documentUrl`. Independiente del submit final: la foto queda de respaldo para el
 * staff aunque el OCR (Tesseract.js, corre en el navegador) no haya podido leer nada, o el
 * huésped haya elegido "llenar manualmente".
 */
export async function uploadPreCheckinPhoto(hash: string, file: FileUpload, queries: ReservasQueries, storage: StorageService | undefined): Promise<{ url: string }> {
  const reservation = await queries.findReservationByHash(hash)
  if (!reservation) throw new NotFoundError('Reserva no encontrada')
  if (!storage) throw new Error('StorageService no configurado para reservas')
  const stored = await storage.upload(file, 'guest-documents')
  // Sin guestId (reserva creada sin huésped asociado) la foto se sube igual (queda en storage,
  // no se pierde el trabajo del usuario) pero no hay a quién anclarla — mismo criterio que ya
  // aplicaba el resto de este usecase (`if (reservation.guestId) ...`) antes de este cambio.
  if (reservation.guestId) {
    await queries.updateGuest(reservation.guestId, { documentUrl: stored.url })
  }
  return { url: stored.url }
}

export async function submitPreCheckin(hash: string, body: any, queries: ReservasQueries, guestRepo: any, signatureFile: FileUpload, storage: StorageService | undefined): Promise<void> {
  const reservation = await queries.findReservationByHash(hash)
  if (!reservation) throw new NotFoundError('Reserva no encontrada')

  // Corte real ANTES de tocar storage o la DB — ver comentario en validators/schema.ts sobre por
  // qué `required: true` del schema no alcanza (un `false` explícito pasa esa capa).
  if (body.contractAccepted !== true) throw new ValidationError('Debes aceptar las normas del establecimiento')
  if (body.gdprAccepted !== true) throw new ValidationError('Debes aceptar el tratamiento de tus datos personales')
  if (!storage) throw new Error('StorageService no configurado para reservas')

  const stored = await storage.upload(signatureFile, 'signatures')
  const nowIso = new Date().toISOString()
  const reservationPatch: Record<string, unknown> = {
    signatureUrl: stored.url,
    contractAcceptedAt: nowIso,
    gdprAccepted: true,
    // `contractAccepted` (UI) === `termsAccepted` (DB): mismo concepto, "acepto las normas del
    // establecimiento" — ver CLAUDE.md.
    termsAccepted: true,
    preCheckinStatus: 'completed',
  }
  if (body.marketingAccepted === true) reservationPatch.marketingAccepted = true
  await queries.updateReservation(reservation.id, reservationPatch)

  if (reservation.guestId) {
    await guestRepo.update(reservation.guestId, {
      name: body.name || body.guestName || undefined,
      email: body.email || undefined,
      phone: body.phone || undefined,
      documentType: body.documentType || undefined,
      document: body.document || body.documentNumber || undefined,
      nationality: body.nationality || undefined,
      birthDate: body.birthDate || undefined,
      address: body.address || undefined,
      city: body.city || undefined,
      country: body.country || undefined,
    })
  }
  if (body.companions?.length) {
    for (const c of body.companions) {
      await queries.createCompanion({ id: crypto.randomUUID(), reservationId: reservation.id, name: c.name, documentNumber: c.documentNumber || '' })
    }
  }
}
