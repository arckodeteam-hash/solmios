// bookingengine/usecases/config.ts — Config management use cases

import type { RepositoryAdapter, Logger, CacheAdapter } from 'arckode-framework'
import { NotFoundError } from 'arckode-framework'
import type { BookingConfigDTO, UpdateBookingConfigDTO } from '../types'

/** #266 — Minutos para completar el pago de una reserva web (15–1440). */
export const DEFAULT_PENDING_TTL_MINUTES = 60

export class ConfigUseCase {
  constructor(
    private readonly repo: RepositoryAdapter<BookingConfigDTO>,
    private readonly cache: CacheAdapter,
  ) {}

  async get(hotelId: string): Promise<BookingConfigDTO> {
    const items = await this.repo.findMany({ hotelId })
    if (!items || items.length === 0) {
      return this.repo.create({
        hotelId,
        enabled: true,
        theme: 'navy',
        position: 'corner',
        currency: 'USD',
        language: 'es',
        minNights: 1,
        maxNights: 30,
        cancellationPolicy: 'flexible',
        showComparison: true,
        googleAdsEnabled: false,
        whatsappConfirmation: false,
        instantConfirmation: true,
        stripeAccountId: '',
        allowedCountries: [],
        pendingTtlMinutes: DEFAULT_PENDING_TTL_MINUTES,
      } as any)
    }
    const config = items[0]
    // Filas anteriores a #266 no tienen la columna: se normaliza la salida, sin persistir.
    if (config.pendingTtlMinutes === null || config.pendingTtlMinutes === undefined) {
      return { ...config, pendingTtlMinutes: DEFAULT_PENDING_TTL_MINUTES }
    }
    return config
  }

  async update(hotelId: string, dto: UpdateBookingConfigDTO): Promise<BookingConfigDTO> {
    const existing = await this.get(hotelId)
    const updated = await this.repo.update(existing.id, dto as any)
    if (!updated) throw new NotFoundError('Config not found')
    await this.cache.delete(`booking-config:${hotelId}`)
    return updated
  }
}
