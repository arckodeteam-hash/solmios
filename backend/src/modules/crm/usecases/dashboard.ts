// crm/usecases/dashboard.ts — KPIs del panel CRM sobre data real (guests/reservas/puntos).
import type { RepositoryAdapter } from 'arckode-framework'
import type { CrmDashboard } from '../types'

export interface DashboardDeps {
  guestRepo: RepositoryAdapter<any>
  reservaRepo: RepositoryAdapter<any>
  loyaltyRepo: RepositoryAdapter<any>
}

export async function buildDashboard(deps: DashboardDeps, hotelId: string): Promise<CrmDashboard> {
  const guests = await deps.guestRepo.findMany({ hotelId, active: 1 })
  const pointsTxns = await deps.loyaltyRepo.findMany({ hotelId })

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  let activeThisMonth = 0
  for (const g of guests) {
    const ress = await deps.reservaRepo.findMany({ guestId: g.id, hotelId })
    if (ress.some((r: any) => r.checkIn && r.checkIn >= monthStart)) activeThisMonth++
  }

  const topTierCounts: Record<string, number> = {}
  for (const g of guests) { const t = g.tier ?? 'bronze'; topTierCounts[t] = (topTierCounts[t] ?? 0) + 1 }

  // PC-7 (2026-08-19): se eliminó `couponUsageRate` — leía la tabla `coupons` deprecada
  // (rutas en 410 desde la migración a promo-codes), devolvía 0/stale y NADIE lo renderiza
  // (el tab de cupones del CRM lista PromoCodeService). Si se quiere el KPI, computarlo
  // sobre promo_codes (uses>0 / total).
  return {
    totalGuests: guests.length,
    activeThisMonth,
    totalPointsIssued: pointsTxns.filter(t => t.type === 'earn').reduce((s, t) => s + t.points, 0),
    totalPointsRedeemed: pointsTxns.filter(t => t.type === 'redeem').reduce((s, t) => s + Math.abs(t.points), 0),
    topTierCounts,
    avgLTV: guests.length > 0 ? Math.round(guests.reduce((s, g) => s + (g.totalSpent ?? 0), 0) / guests.length) : 0,
  }
}
