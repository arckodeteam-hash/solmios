// crm/usecases/points-ops.ts — Operaciones de puntos con ownership común (spec crm-loyalty).
// Extraídas del service (regla analyzer <200): award/history/balance comparten el mismo
// check de huésped+hotel; acá vive una sola vez.
import type { RepositoryAdapter, Auth } from 'arckode-framework'
import { NotFoundError, ValidationError } from 'arckode-framework'
import type { LoyaltyTransactionDTO } from '../types'
import { applyPoints } from './loyalty'

export interface PointsDeps {
  loyaltyRepo: RepositoryAdapter<LoyaltyTransactionDTO>
  guestRepo: RepositoryAdapter<any>
  auth?: Auth
  onPointsAwarded?: (guestId: string, points: number) => Promise<void> | void
  checkTierUpgrade: (guestId: string) => Promise<string>
}

/** Huésped con ownership verificado — prefijo común de las tres operaciones. */
async function ownedGuest(deps: PointsDeps, guestId: string, hotelId: string, role?: string) {
  const guest = await deps.guestRepo.findById(guestId)
  if (!guest) throw new NotFoundError('Guest not found')
  if (deps.auth) deps.auth.assertOwnership(guest.hotelId, hotelId, role, 'super_admin')
  return guest
}

export async function awardPoints(
  deps: PointsDeps,
  guestId: string, hotelId: string, points: number, description: string, reservationId?: string, role?: string,
): Promise<LoyaltyTransactionDTO> {
  const guest = await ownedGuest(deps, guestId, hotelId, role)
  if (points <= 0) throw new ValidationError('Los puntos a acreditar deben ser positivos')

  const txn = await deps.loyaltyRepo.create({ guestId, hotelId, reservationId: reservationId ?? null, type: 'earn', points, description } as any)
  // Leer, sumar, escribir: el ORM no entiende `{ increment }` — ver usecases/loyalty.ts.
  const balance = applyPoints(guest.loyaltyPoints, points)
  await deps.guestRepo.update(guestId, { loyaltyPoints: balance } as any)

  await deps.onPointsAwarded?.(guestId, points)
  await deps.checkTierUpgrade(guestId)
  return txn
}

export async function getPointsHistory(deps: PointsDeps, guestId: string, hotelId: string, role?: string): Promise<LoyaltyTransactionDTO[]> {
  await ownedGuest(deps, guestId, hotelId, role)
  return deps.loyaltyRepo.findMany({ guestId })
}

export async function getPointsBalance(deps: PointsDeps, guestId: string, hotelId: string, role?: string): Promise<number> {
  const guest = await ownedGuest(deps, guestId, hotelId, role)
  return guest.loyaltyPoints ?? 0
}
