import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { DashboardStats } from '@/types'
import { DashboardService } from '@/services/Dashboard.service'

interface DashboardState extends DashboardStats {
  totalRooms: number
  occupied: number
  roomsByType: Record<string, number>
  roomsByStatus: Record<string, number>
  reservations: number
  guests: number
  pendingInvoices: number
  /** HAC-06 (#261): llegadas de hoy sin habitación asignada. Opcional: el backend viejo no lo manda. */
  arrivalsUnassigned?: number
  trends?: {
    ocupacion: { value: number; direction: 'up' | 'down' | 'stable' }
    revenue: { value: number; direction: 'up' | 'down' | 'stable' }
  }
}

const empty: DashboardState = {
  occupancy: 0,
  arrivalsToday: 0,
  departuresToday: 0,
  pendingClean: 0,
  openIncidents: 0,
  revenueToday: 0,
  revenueMTD: 0,
  avgRate: 0,
  revpar: 0,
  totalRooms: 0,
  occupied: 0,
  roomsByType: {},
  roomsByStatus: {},
  reservations: 0,
  guests: 0,
  pendingInvoices: 0,
}

export const useDashboardStore = defineStore('dashboard', () => {
  const stats = ref<DashboardState>({ ...empty })
  const loading = ref(false)
  const error = ref('')

  const occupancyPct = computed(() => stats.value.occupancy)

  async function fetchStats(hotelId?: string) {
    loading.value = true
    error.value = ''
    try {
      stats.value = await DashboardService.stats(hotelId)
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Error al cargar dashboard'
    } finally {
      loading.value = false
    }
  }

  return { stats, loading, error, occupancyPct, fetchStats }
})
