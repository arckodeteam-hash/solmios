// folios/usecases/open-folio.ts — Apertura de la cuenta corriente del huésped.
// Extraído del service para mantenerlo < 200 líneas.
//
// El `hotelId` sale del JWT, nunca del body (V-02 IDOR): un merchant no puede abrir un folio
// en otro hotel pasando `hotelId` en el request.

import type { RepositoryAdapter, Logger } from 'arckode-framework'
import type { FolioDTO, OpenFolioDTO } from '../types'

const now = () => new Date().toISOString()

export interface OpenFolioDeps {
  folioRepo: RepositoryAdapter<FolioDTO>
  reservationRepo: RepositoryAdapter<any>
  logger: Logger
}

export async function openFolio(
  deps: OpenFolioDeps,
  dto: OpenFolioDTO,
  hotelId: string,
): Promise<FolioDTO> {
  deps.logger.info('Abriendo folio', { hotelId, reservationId: dto.reservationId })

  // R-1 (auditoría 2026-08-19): unicidad de folio ABIERTO por reserva — sin esto, dos
  // caminos concurrentes (settlement de checkout + apertura manual) creaban DOS folios open
  // para la misma estadía y el pago/cierre se partía entre ambos. Si ya hay uno abierto,
  // se devuelve ESE (idempotente) en vez de crear otro.
  if (dto.reservationId) {
    const existing = await deps.folioRepo.findOne({ hotelId, reservationId: dto.reservationId, status: 'open' })
    if (existing) return existing
  }

  let guestId = dto.guestId ?? null
  let roomId = dto.roomId ?? null

  // Si viene de una reserva, hereda huésped y habitación.
  if (dto.reservationId) {
    const reservation = await deps.reservationRepo.findById(dto.reservationId)
    if (reservation) {
      guestId = guestId ?? reservation.guestId ?? null
      roomId = roomId ?? reservation.roomId ?? null
    }
  }

  return deps.folioRepo.create({
    hotelId,
    reservationId: dto.reservationId ?? null,
    guestId,
    roomId,
    status: 'open',
    currency: dto.currency ?? 'USD',
    invoiceId: null,
    openedAt: now(),
    closedAt: null,
  } as any)
}
