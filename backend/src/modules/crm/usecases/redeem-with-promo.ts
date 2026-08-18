// crm/usecases/redeem-with-promo.ts — Canje con propósito: puntos → promo code real.
//
// Extraído del service (el analyzer marca God Object >200 líneas; además el canje con
// compensación merece vivir solo y testeable). Compensación en vez de transacción: el
// ORM no da atomicidad cross-repo (guests + loyalty + promo-codes), así que si el promo
// falla se RE-ACREDITAN los puntos con una reversa auditada — nunca quedan evaporados.
import type { RepositoryAdapter, Auth, Logger } from 'arckode-framework'
import { ValidationError, NotFoundError } from 'arckode-framework'
import type { LoyaltyTransactionDTO } from '../types'
import { applyPoints } from './loyalty'
import type { LoyaltyConfig } from './loyalty-config'
import type { LoyaltyPromoPort } from '../service'

export interface RedeemDeps {
  loyaltyRepo: RepositoryAdapter<LoyaltyTransactionDTO>
  guestRepo: RepositoryAdapter<any>
  auth?: Auth
  promoPort: LoyaltyPromoPort | null
  config: LoyaltyConfig
  logger: Pick<Logger, 'error'>
}

export type RedeemResult = LoyaltyTransactionDTO & { promoCode?: string; discountValue?: number }

export async function redeemWithPromo(
  deps: RedeemDeps,
  guestId: string, hotelId: string, points: number, description: string, role?: string,
): Promise<RedeemResult> {
  const guest = await deps.guestRepo.findById(guestId)
  if (!guest) throw new NotFoundError('Guest not found')
  if (deps.auth) deps.auth.assertOwnership(guest.hotelId, hotelId, role, 'super_admin')
  if (points <= 0) throw new ValidationError('Los puntos a canjear deben ser positivos')

  const available = Number(guest.loyaltyPoints ?? 0)
  if (available < points) throw new ValidationError(`Puntos insuficientes. Disponibles: ${available}`)

  const txn = await deps.loyaltyRepo.create({ guestId, hotelId, type: 'redeem', points: -points, description } as any)
  await deps.guestRepo.update(guestId, { loyaltyPoints: applyPoints(available, -points) } as any)

  if (!deps.promoPort) return txn

  const discountValue = Math.round(points * deps.config.pointValue * 100) / 100
  const code = `POINTS-${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`
  try {
    const promo = await deps.promoPort.createForLoyalty(hotelId, code, discountValue, deps.config.promoValidDays)
    return { ...txn, promoCode: promo.code, discountValue }
  } catch (e) {
    await deps.loyaltyRepo.create({ guestId, hotelId, type: 'earn', points, description: `Reversa de canje fallido (${code})` } as any)
    await deps.guestRepo.update(guestId, { loyaltyPoints: applyPoints(available - points, points) } as any)
    deps.logger.error('Canje: falló la creación del promo, puntos devueltos', { guestId, code, error: (e as Error)?.message })
    throw new ValidationError('No se pudo generar el código de descuento. Puntos devueltos, probá de nuevo.')
  }
}
