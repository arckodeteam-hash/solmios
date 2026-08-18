// crm/usecases/tiers-recompute.ts — Backfill masivo de tiers (spec crm-loyalty).
// Ratchet: un nivel nunca baja, aunque los umbrales configuras sean otros.
import type { RepositoryAdapter } from 'arckode-framework'
import { nextTier, type TierThreshold } from './loyalty'

export interface TierProgress {
  onUpgrade: (guestId: string, from: string, to: string) => Promise<void> | void
}

export async function recomputeTiers(
  guestRepo: RepositoryAdapter<any>,
  hotelId: string,
  thresholds: readonly TierThreshold[],
  progress: TierProgress,
): Promise<{ recomputed: number; upgraded: number }> {
  const guests = await guestRepo.findMany({ hotelId })
  let upgraded = 0
  for (const guest of guests) {
    const current = guest.tier ?? 'bronze'
    const next = nextTier(current, Number(guest.totalStays ?? 0), Number(guest.totalSpent ?? 0), thresholds)
    if (next !== current) {
      await guestRepo.update(guest.id, { tier: next } as any)
      await progress.onUpgrade(guest.id, current, next)
      upgraded++
    }
  }
  return { recomputed: guests.length, upgraded }
}
