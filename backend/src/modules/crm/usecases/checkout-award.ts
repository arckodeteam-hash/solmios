// crm/usecases/checkout-award.ts — Acreditación de la estadía al checkout.
// Idempotente por reservationId (el checkout llega por 2 eventos distintos) y respeta el
// flag `crm_loyalty.enabled`. Lo llama el connector reservas-huespedes, best-effort.
import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { pointsForStay } from './loyalty'
import type { LoyaltyConfig } from './loyalty-config'

export interface CheckoutAwardDeps {
  loyaltyRepo: RepositoryAdapter<any>
  guestRepo: RepositoryAdapter<any>
  logger: Pick<Logger, 'warn' | 'info'>
  awardPoints: (guestId: string, hotelId: string, points: number, description: string, reservationId?: string) => Promise<unknown>
  checkTierUpgrade: (guestId: string) => Promise<string>
}

export async function awardCheckoutStay(deps: CheckoutAwardDeps, reserva: any, config: LoyaltyConfig): Promise<void> {
  if (!config.enabled) return // flag apagado (rollback sin deploy)

  const guest = await deps.guestRepo.findById(reserva.guestId)
  if (!guest) {
    deps.logger.warn('Checkout sin huésped: no se acreditan puntos', { reservationId: reserva.id })
    return
  }

  // Una estadía se acredita UNA vez (onReservationCheckedOut + onReservasUpdated duplicarían).
  const yaAcreditada = await deps.loyaltyRepo.findMany({ reservationId: reserva.id, type: 'earn' })
  if (yaAcreditada.length > 0) {
    deps.logger.info('Checkout ya acreditado: se omite', { reservationId: reserva.id })
    return
  }

  await deps.guestRepo.update(guest.id, {
    totalStays: Number(guest.totalStays ?? 0) + 1,
    totalSpent: Number(guest.totalSpent ?? 0) + (Number(reserva.totalAmount) || 0),
  } as any)

  const puntos = pointsForStay(reserva.totalAmount, config.pointsPerCurrencyUnit)
  // Estadía de cortesía (importe 0): sin puntos, pero cuenta para el nivel.
  if (puntos > 0) await deps.awardPoints(reserva.guestId, reserva.hotelId, puntos, `Estadía ${reserva.id}`, reserva.id)
  else await deps.checkTierUpgrade(reserva.guestId)
}
