// crm/usecases/dashboard.ts — KPIs del panel CRM sobre data real (guests/reservas/puntos).
import type { RepositoryAdapter } from 'arckode-framework'
import type { CrmDashboard } from '../types'

export interface DashboardDeps {
  guestRepo: RepositoryAdapter<any>
  reservaRepo: RepositoryAdapter<any>
  loyaltyRepo: RepositoryAdapter<any>
  couponRepo: RepositoryAdapter<any>
}

export async function buildDashboard(deps: DashboardDeps, hotelId: string): Promise<CrmDashboard> {
  const guests = await deps.guestRepo.findMany({ hotelId, active: 1 })
  const pointsTxns = await deps.loyaltyRepo.findMany({ hotelId })
  const coupons = await deps.couponRepo.findMany({ hotelId })

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  let activeThisMonth = 0
  for (const g of guests) {
    const ress = await deps.reservaRepo.findMany({ guestId: g.id, hotelId })
    if (ress.some((r: any) => r.checkIn && r.checkIn >= monthStart)) activeThisMonth++
  }

  const topTierCounts: Record<string, number> = {}
  for (const g of guests) { const t = g.tier ?? 'bronze'; topTierCounts[t] = (topTierCounts[t] ?? 0) + 1 }

  return {
    totalGuests: guests.length,
    activeThisMonth,
    totalPointsIssued: pointsTxns.filter(t => t.type === 'earn').reduce((s, t) => s + t.points, 0),
    totalPointsRedeemed: pointsTxns.filter(t => t.type === 'redeem').reduce((s, t) => s + Math.abs(t.points), 0),
    topTierCounts,
    avgLTV: guests.length > 0 ? Math.round(guests.reduce((s, g) => s + (g.totalSpent ?? 0), 0) / guests.length) : 0,
    couponUsageRate: coupons.length > 0 ? Math.round(coupons.reduce((s, c) => s + c.useCount, 0) / coupons.length * 100) / 100 : 0,
  }
}
