<template>
  <div class="cc-dashboard -m-6 min-h-screen space-y-4 p-5">
    <!-- Guía de configuración: solo aparece mientras falte algo obligatorio. -->
    <OnboardingGuide />

    <!-- 1. Centro de operaciones -->
    <CommandCenterHeader
      :hotel-name="hotelName"
      :logo-url="hotelLogo"
      :star-rating="hotelStars"
      :api-online="apiOnline"
      :last-sync="channelLastSync"
      :weather="weather"
      :alerts="dashboard.stats.openIncidents"
    />

    <!-- 2. KPIs gigantes — ocupación e ingresos pesan más que check-in/out -->
    <div class="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-[1.3fr_1fr_1fr_1.25fr]">
      <KpiHeroCard
        label="Ocupación Actual" accent="blue" suffix="%" icon="bed"
        :value="dashboard.stats.occupancy"
        :progress="dashboard.stats.occupancy"
        :trend="occupancyTrend"
        :sub-stats="[
          { label: 'Habitaciones', value: dashboard.stats.totalRooms },
          { label: 'Disponibles', value: availableRooms, tone: 'text-[#16A34A]' },
          { label: 'Mantenimiento', value: maintenanceRooms, tone: 'text-[#D97706]' },
        ]"
      />
      <KpiHeroCard
        label="Check-in Hoy" accent="green" icon="checkin"
        :value="dashboard.stats.arrivalsToday"
        unit="Huéspedes"
        :progress="arrivalsProgress"
        :show-bar="false"
        :sub-stats="[
          { label: 'Realizados', value: arrivalsDone, tone: 'text-[#16A34A]' },
          { label: 'Pendientes', value: arrivalsPending, tone: 'text-[#D97706]' },
        ]"
      />
      <KpiHeroCard
        label="Check-out Hoy" accent="purple" icon="checkout"
        :value="dashboard.stats.departuresToday"
        unit="Huéspedes"
        :progress="departuresProgress"
        :show-bar="false"
        :sub-stats="[
          { label: 'Realizados', value: departuresDone, tone: 'text-[#7C3AED]' },
          { label: 'Pendientes', value: departuresPending, tone: 'text-[#D97706]' },
        ]"
      />
      <KpiHeroCard
        label="Ingresos Hoy" accent="amber" :prefix="currencyPrefix" icon="money"
        :value="dashboard.stats.revenueToday"
        :trend="revenueTrend"
        :spark="revenueSpark"
      />
    </div>

    <!-- 2.5. Pendientes de hoy — llegadas y salidas concretas (feedback #619) -->
    <SectionCard title="Pendientes de hoy" subtitle="Llegadas y salidas programadas para hoy">
      <template #actions>
        <span v-if="!checkinLoading && !checkinError && checkinData" class="text-xs font-bold text-white/70">
          {{ checkinData.pendingCheckins }} llegadas · {{ checkinData.todayCheckouts }} salidas
        </span>
      </template>

      <!-- Error de carga — EmptyState cubre vacío Y error (mem: empty-state-vs-load-error) -->
      <EmptyState
        v-if="checkinError"
        icon="⚠️"
        title="No se pudieron cargar los pendientes"
        message="Reintentá en unos minutos."
      />
      <div v-else-if="checkinLoading" class="py-10 text-center text-sm text-text-muted">
        Cargando pendientes…
      </div>
      <EmptyState
        v-else-if="!checkinData?.checkins.length && !checkinData?.checkouts.length"
        icon="📭"
        title="Día tranquilo"
        message="No hay check-ins ni check-outs programados para hoy."
      />
      <div v-else class="grid gap-5 md:grid-cols-2">
        <!-- Check-ins de hoy -->
        <div>
          <h3 class="mb-2 text-xs font-black uppercase tracking-wide text-text-muted">Check-ins</h3>
          <ul class="space-y-1.5">
            <li
              v-for="item in checkinData?.checkins"
              :key="item.id"
              class="flex items-center gap-3 rounded-xl border border-border bg-surface/60 px-3 py-2"
            >
              <div class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-navy/10 text-xs font-bold text-navy">
                {{ initialsOf(item.guestName) }}
              </div>
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-bold text-navy">{{ item.guestName || 'Huésped' }}</div>
                <div class="text-[11px] text-text-muted">Hab. {{ item.roomNumber || '—' }}</div>
              </div>
              <span
                v-if="depositBadge(item)"
                class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold"
                :style="badgeStyle(depositBadge(item)!)"
              >
                {{ depositBadge(item)!.label }}
              </span>
            </li>
          </ul>
          <p v-if="!checkinData?.checkins.length" class="py-4 text-center text-xs text-text-muted">
            Sin check-ins para hoy
          </p>
        </div>

        <!-- Check-outs de hoy -->
        <div>
          <h3 class="mb-2 text-xs font-black uppercase tracking-wide text-text-muted">Check-outs</h3>
          <ul class="space-y-1.5">
            <li
              v-for="item in checkinData?.checkouts"
              :key="item.id"
              class="flex items-center gap-3 rounded-xl border border-border bg-surface/60 px-3 py-2"
            >
              <div class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-navy/10 text-xs font-bold text-navy">
                {{ initialsOf(item.guestName) }}
              </div>
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-bold text-navy">{{ item.guestName || 'Huésped' }}</div>
                <div class="text-[11px] text-text-muted">Hab. {{ item.roomNumber || '—' }}</div>
              </div>
              <span
                v-if="depositBadge(item)"
                class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold"
                :style="badgeStyle(depositBadge(item)!)"
              >
                {{ depositBadge(item)!.label }}
              </span>
            </li>
          </ul>
          <p v-if="!checkinData?.checkouts.length" class="py-4 text-center text-xs text-text-muted">
            Sin check-outs para hoy
          </p>
        </div>
      </div>
      <!-- TODO #619 v2: agregar tareas de housekeeping de hoy -->
    </SectionCard>

    <!-- 3. Calendario + actividad/canales/estados -->
    <div class="grid min-w-0 gap-4 xl:grid-cols-[1.3fr_1fr_1fr_1.25fr]">
      <div class="min-w-0 xl:col-span-3">
        <ReservationCalendar
          :key="hotelId"
          embedded
          @changed="refreshOperationalData"
        />
      </div>
      <div class="flex min-w-0 flex-col gap-4">
        <LiveActivityFeed :items="activityItems" class="min-h-0 flex-1" />
        <div class="grid min-w-0 gap-4 sm:grid-cols-2">
          <ChannelDistributionBars :channels="channelDistribution" />
          <RoomsStatusDonut :by-status="dashboard.stats.roomsByStatus" />
        </div>
      </div>
    </div>

    <!-- 4. Estado del hotel + IA + ingresos -->
    <div class="grid min-w-0 gap-4 lg:grid-cols-3">
      <HotelStatusPanel :services="hotelServices" />
      <AiInsightsPanel :user-name="userFirstName" :insights="aiInsights" />
      <RevenueChart
        :daily="revenueDaily"
        :currency="hotelCurrency"
        :revenue-today="dashboard.stats.revenueToday"
        :trend-pct="revenueTrend"
        :loading="revenueLoading"
      />
    </div>

    <!-- 5. Heat map de habitaciones -->
    <FloorHeatMap :rooms="roomStore.rooms" @select="selectedRoom = $event" />

    <!-- Modal de habitación (heat map) -->
    <Teleport to="body">
      <div v-if="selectedRoom" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/50 backdrop-blur-sm"></div>

        <div class="relative w-full max-w-md overflow-hidden rounded-[20px] border border-border bg-white shadow-2xl">
          <div class="border-b border-border p-5">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <div class="grid h-12 w-12 place-items-center rounded-xl text-xl font-black" :style="{ background: `${roomAccent}22`, color: roomAccent }">
                  {{ selectedRoom.number }}
                </div>
                <div>
                  <h3 class="text-lg font-black text-navy">Habitación {{ selectedRoom.number }}</h3>
                  <p class="text-sm capitalize text-text-secondary">{{ selectedRoom.type }} · Piso {{ selectedRoom.floor }}</p>
                </div>
              </div>
              <button @click="selectedRoom = null" class="grid h-8 w-8 place-items-center rounded-lg bg-surface text-text-secondary transition-colors hover:text-navy cursor-pointer">✕</button>
            </div>
          </div>

          <div class="space-y-4 p-5">
            <div class="flex items-center justify-between rounded-xl bg-surface p-3">
              <span class="text-sm font-bold text-text-secondary">Estado</span>
              <span class="rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase" :style="{ background: `${roomAccent}1A`, color: roomAccent }">
                {{ roomStatusLabel }}
              </span>
            </div>

            <div v-if="selectedRoom.status === 'occupied' && roomGuest" class="rounded-xl bg-surface p-4">
              <div class="mb-3 text-[10px] font-bold uppercase tracking-wide text-text-muted">Huésped Actual</div>
              <div class="flex items-center gap-3">
                <div class="grid h-11 w-11 place-items-center rounded-full bg-[#2563EB]/12 text-sm font-bold text-[#2563EB]">{{ roomGuest.initials }}</div>
                <div class="flex-1">
                  <div class="text-sm font-bold text-navy">{{ roomGuest.name }}</div>
                  <div class="text-[10px] text-text-secondary">{{ roomGuest.checkIn }} → {{ roomGuest.checkOut }}</div>
                </div>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div class="rounded-xl bg-surface p-3 text-center">
                <div class="text-lg font-black tabular-nums text-navy">{{ currencyPrefix }}{{ selectedRoom.basePrice }}</div>
                <div class="text-[10px] text-text-muted">Tarifa/Noche</div>
              </div>
              <div class="rounded-xl bg-surface p-3 text-center">
                <div class="text-lg font-black tabular-nums text-navy">{{ selectedRoom.maxGuests }}</div>
                <div class="text-[10px] text-text-muted">Max. Ocupantes</div>
              </div>
            </div>
          </div>

          <div class="border-t border-border bg-surface p-5">
            <div class="flex gap-2">
              <!-- Check-in / Check-out abren el flujo REAL de recepción. Antes estos dos botones
                   solo cambiaban el estado de la habitación, sin tocar la reserva ni el folio. -->
              <button v-if="frontDeskAction" @click="goToFrontDesk" class="cc-modal-btn flex-1"
                :class="frontDeskAction === 'checkin' ? 'bg-[#22C55E] text-[#052E16]' : 'bg-[#2563EB] text-white'">
                {{ FRONT_DESK_LABEL[frontDeskAction] }}
              </button>
              <button v-if="selectedRoom.status === 'cleaning' || selectedRoom.status === 'dirty'" @click="setRoomStatus('available')" class="cc-modal-btn flex-1 bg-[#06B6D4] text-[#083344]">Marcar Limpia</button>
              <!-- Una habitación con huésped adentro no se saca de servicio: dejaría la reserva
                   viva sobre una habitación no vendible. Primero el check-out. -->
              <button v-if="selectedRoom.status !== 'out_of_service'"
                @click="setRoomStatus('out_of_service')"
                :disabled="selectedRoom.status === 'occupied'"
                :title="selectedRoom.status === 'occupied' ? 'Hacé el check-out antes de sacarla de servicio' : 'Marcar fuera de servicio'"
                class="cc-modal-btn border border-border bg-white text-text-secondary disabled:cursor-not-allowed disabled:opacity-40">F/S</button>
              <button v-else @click="setRoomStatus('available')" class="cc-modal-btn border border-border bg-white text-text-secondary">Reactivar</button>
              <button @click="selectedRoom = null" class="cc-modal-btn border border-border bg-white text-text-secondary">Cerrar</button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useToast } from '@/composables/useToast'
import type { Room, RoomStatus, Reservation } from '@/types'
import { useDashboardStore } from '@/stores/dashboard.store'
import { useRoomStore } from '@/stores/room.store'
import { useReservationStore } from '@/stores/reservation.store'
import { useAuthStore } from '@/stores/auth.store'
import { NotificationsService, type AppNotification } from '@/services/Notifications.service'
import { ChannelService } from '@/services/Channel.service'
import { HotelService, type HotelData } from '@/services/Hotel.service'
import { ReportsService, type FacturacionReport } from '@/services/Reports.service'
import CommandCenterHeader from '@/components/features/dashboard/CommandCenterHeader.vue'
import OnboardingGuide from '@/components/features/OnboardingGuide.vue'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'
import ReservationCalendar from '@/components/features/ReservationCalendar.vue'
import LiveActivityFeed, { type FeedItem } from '@/components/features/dashboard/LiveActivityFeed.vue'
import ChannelDistributionBars, { type ChannelSlice } from '@/components/features/dashboard/ChannelDistributionBars.vue'
import RoomsStatusDonut from '@/components/features/dashboard/RoomsStatusDonut.vue'
import HotelStatusPanel, { type ServiceStatus } from '@/components/features/dashboard/HotelStatusPanel.vue'
import AiInsightsPanel, { type AiInsight } from '@/components/features/dashboard/AiInsightsPanel.vue'
import RevenueChart, { type DailyPoint } from '@/components/features/dashboard/RevenueChart.vue'
import FloorHeatMap from '@/components/features/dashboard/FloorHeatMap.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { DashboardService } from '@/services/Dashboard.service'
import { WeatherService, type WeatherInfo } from '@/services/Weather.service'
import { currencySymbol } from '@/composables/useCurrency'
import { CurrencyCode } from '@/types/currency'
import { channelBrandOrDefault, normalizeChannelKey } from '@/composables/useChannelBrand'
import { roomStatusMeta, frontDeskActionFor, FRONT_DESK_PERMISSION, FRONT_DESK_LABEL } from '@/data/room-status'
import { usePermissions } from '@/composables/usePermissions'
import type { CheckinListData, CheckinListItem } from '@/types'

const router = useRouter()
const toast = useToast()
const dashboard = useDashboardStore()
const roomStore = useRoomStore()
const reservationStore = useReservationStore()
const auth = useAuthStore()
const { can } = usePermissions()

/** Refresco del feed/KPIs en vivo */
const REFRESH_INTERVAL_MS = 60_000
/** Ventana de la serie de ingresos que alimenta el gráfico */
const REVENUE_WINDOW_DAYS = 365
const MS_DAY = 86_400_000
/** Notificaciones que se piden por refresco (el feed muestra ACTIVITY_LIMIT, se pide de más
 *  porque se mezclan con reservas y se reordenan por fecha antes de recortar). */
const NOTIFICATIONS_FETCH_LIMIT = 20
/** Puntos de la sparkline del KPI de ingresos (últimos N días de la serie diaria). */
const REVENUE_SPARK_DAYS = 14

const hotelId = computed(() => (auth.user?.hotelId && auth.user.hotelId !== 'platform' ? auth.user.hotelId : undefined))

// ── Estado remoto ────────────────────────────────────────────────────────
const apiOnline = ref(true)
const hotelData = ref<HotelData | null>(null)
const roomBlocks = ref<{ id: string; roomId: string; reason: string; startDate: string; endDate: string }[]>([])
const channelLastSync = ref<string | null>(null)
const channelConnected = ref(0)
const channelSyncEnabled = ref(false)
const notifications = ref<AppNotification[]>([])
const weather = ref<WeatherInfo | null>(null)
const revenueDaily = ref<DailyPoint[]>([])
const revenueLoading = ref(true)

// ── Pendientes de hoy (GET /api/checkin — feedback #619) ──────────────────
const checkinData = ref<CheckinListData | null>(null)
const checkinLoading = ref(true)
const checkinError = ref(false)

const DEPOSIT_BADGE: Record<string, { label: string; color: string }> = {
  paid: { label: 'Pagado', color: '#16A34A' },
  partial: { label: 'Parcial', color: '#D97706' },
  unpaid: { label: 'Pendiente', color: '#DC2626' },
}

function initialsOf(name?: string): string {
  if (!name) return '?'
  return name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?'
}

function depositBadge(item: CheckinListItem): { label: string; color: string } | null {
  const key = item.depositStatus
  if (!key) return null
  return DEPOSIT_BADGE[key] ?? null
}

function badgeStyle(badge: { color: string }): Record<string, string> {
  return { background: `${badge.color}1A`, color: badge.color }
}

const hotelName = computed(() => hotelData.value?.name || auth.currentHotel || 'Mi Hotel')
/** Moneda de facturación del hotel (`hotels.currency`, default USD del modelo). */
const hotelCurrency = computed(() => hotelData.value?.currency || CurrencyCode.USD)
/** Símbolo a anteponer a los importes. NUNCA hardcodear '$': un hotel en RD factura en RD$
 *  y uno en España en €, y el dashboard mostraba dólares para todos. */
const currencyPrefix = computed(() => currencySymbol(hotelCurrency.value))
const hotelStars = computed(() => hotelData.value?.starRating ?? null)
/** Identidad visual del hotel para el header. Viene de GET /settings (`settings:view`), el
 *  mismo request que ya trae nombre y estrellas — no de `hotel-media`, que exige `media:view`
 *  y dejaría a recepción sin logo y con un 403 por carga. */
const hotelLogo = computed(() => hotelData.value?.logo || null)
const userFirstName = computed(() => (auth.user?.name ?? 'Admin').split(' ')[0])

function todayStr() { return new Date().toISOString().slice(0, 10) }
function dstr(v: unknown) { return String(v ?? '').slice(0, 10) }

// ── KPIs ─────────────────────────────────────────────────────────────────
const availableRooms = computed(() => dashboard.stats.roomsByStatus.available ?? 0)
const maintenanceRooms = computed(() =>
  (dashboard.stats.roomsByStatus.out_of_service ?? 0) + (dashboard.stats.roomsByStatus.dirty ?? 0) + (dashboard.stats.roomsByStatus.cleaning ?? 0))

function signedTrend(t?: { value: number; direction: string }) {
  if (!t || t.direction === 'stable' || !t.value) return null
  return t.direction === 'down' ? -Math.abs(t.value) : Math.abs(t.value)
}
const occupancyTrend = computed(() => signedTrend(dashboard.stats.trends?.ocupacion))
const revenueTrend = computed(() => signedTrend(dashboard.stats.trends?.revenue))

const todaysArrivals = computed(() =>
  reservationStore.reservations.filter(r => dstr(r.checkIn) === todayStr() && r.status !== 'cancelled'))
const arrivalsDone = computed(() => todaysArrivals.value.filter(r => r.status === 'checked_in' || r.status === 'checked_out').length)
const arrivalsPending = computed(() => todaysArrivals.value.length - arrivalsDone.value)
const arrivalsProgress = computed(() =>
  todaysArrivals.value.length ? Math.round((arrivalsDone.value / todaysArrivals.value.length) * 100) : 0)

const todaysDepartures = computed(() =>
  reservationStore.reservations.filter(r => dstr(r.checkOut) === todayStr() && (r.status === 'checked_in' || r.status === 'checked_out')))
const departuresDone = computed(() => todaysDepartures.value.filter(r => r.status === 'checked_out').length)
const departuresPending = computed(() => todaysDepartures.value.length - departuresDone.value)
const departuresProgress = computed(() =>
  todaysDepartures.value.length ? Math.round((departuresDone.value / todaysDepartures.value.length) * 100) : 0)

const revenueSpark = computed(() => revenueDaily.value.slice(-REVENUE_SPARK_DAYS).map(p => p.value))

// ── Actividad en tiempo real ─────────────────────────────────────────────
const SVG = (path: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="${path}"/></svg>`
const ACTIVITY_META: Record<string, { icon: string; color: string; badge: string }> = {
  reservation: { icon: SVG('M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5'), color: '#3B82F6', badge: 'Reserva' },
  payment: { icon: SVG('M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5h-15A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z'), color: '#22C55E', badge: 'Pago' },
  housekeeping: { icon: SVG('M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z'), color: '#F59E0B', badge: 'Limpieza' },
  maintenance: { icon: SVG('M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085'), color: '#FB923C', badge: 'Mantenimiento' },
  review: { icon: SVG('M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.562.562 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z'), color: '#A78BFA', badge: 'Opinión' },
  message: { icon: SVG('M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155'), color: '#06B6D4', badge: 'Mensaje' },
  system: { icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" class="w-full h-full"><path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.992l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.992l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.281z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`, color: '#94A3B8', badge: 'Sistema' },
}
const ACTIVITY_LIMIT = 9

function hhmm(iso?: string) {
  if (!iso) return '--:--'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '--:--' : d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false })
}

const activityItems = computed<FeedItem[]>(() => {
  const fromNotifs: FeedItem[] = notifications.value.map(n => {
    const meta = ACTIVITY_META[n.type] ?? ACTIVITY_META.system
    const metaChannel = n.metadata && typeof n.metadata === 'object'
      ? ((n.metadata as Record<string, unknown>).source ?? (n.metadata as Record<string, unknown>).channel)
      : undefined
    return {
      id: `n-${n.id}`,
      time: hhmm(n.createdAt ?? n.date),
      title: n.title,
      subtitle: n.message ?? '',
      badge: meta.badge,
      color: meta.color,
      icon: meta.icon,
      channel: n.type === 'reservation' && typeof metaChannel === 'string' ? metaChannel : undefined,
      _ts: new Date(n.createdAt ?? n.date ?? 0).getTime(),
    } as FeedItem & { _ts: number }
  })

  // Fallback/complemento: reservas recientes como eventos
  const fromReservations = [...reservationStore.reservations]
    .filter(r => r.createdAt)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, ACTIVITY_LIMIT)
    .map(r => ({
      id: `r-${r.id}`,
      time: hhmm(String(r.createdAt)),
      title: 'Nueva reserva',
      subtitle: `${r.guestName ?? 'Huésped'} · Hab. ${r.roomNumber ?? '—'} · ${r.source}`,
      badge: 'Reserva',
      color: '#3B82F6',
      icon: ACTIVITY_META.reservation.icon,
      channel: r.source,
      _ts: new Date(r.createdAt).getTime(),
    }))

  const merged = fromNotifs.length ? fromNotifs : fromReservations
  return (merged as (FeedItem & { _ts: number })[])
    .sort((a, b) => b._ts - a._ts)
    .slice(0, ACTIVITY_LIMIT)
})

// ── Distribución por canal ───────────────────────────────────────────────
// El catálogo de canales vive en `composables/useChannelBrand` (12 canales + alias), NO acá.
// La copia local que había antes solo conocía 6 y usaba colores inventados: una reserva de
// Trip.com, Despegar, Hostelworld, walk-in o email caía toda junta en un bucket "Otros" gris,
// y Booking salía #2563EB en vez de su azul de marca #003580.
// `icon` es la key cruda del canal — <ChannelIcon> normaliza los alias por su cuenta.
const channelDistribution = computed<ChannelSlice[]>(() => {
  const active = reservationStore.reservations.filter(r => r.status !== 'cancelled')
  if (!active.length) return []
  const counts = new Map<string, { label: string; color: string; icon: string; count: number }>()
  for (const r of active) {
    const key = normalizeChannelKey(r.source)
    const prev = counts.get(key)
    if (prev) { prev.count++; continue }
    const brand = channelBrandOrDefault(key)
    counts.set(key, { label: brand.label, color: brand.color, icon: key, count: 1 })
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .map(c => ({ ...c, pct: Math.round((c.count / active.length) * 100) }))
})

// ── Estado de servicios ──────────────────────────────────────────────────
const hotelServices = computed<ServiceStatus[]>(() => {
  const offline: ServiceStatus['tone'] = 'error'
  const services: ServiceStatus[] = [
    { label: 'Recepción', status: apiOnline.value ? 'Online' : 'Offline', tone: apiOnline.value ? 'ok' : offline },
  ]

  const engineOn = Boolean(hotelData.value?.bookingEngineUrl) || hotelData.value?.onlineBookingStatus === 'active'
  services.push({
    label: 'Motor de Reservas',
    status: !apiOnline.value ? 'Offline' : engineOn ? 'Online' : 'Inactivo',
    tone: !apiOnline.value ? offline : engineOn ? 'ok' : 'warn',
  })

  services.push({
    label: 'Channel Manager',
    status: channelConnected.value > 0 ? (channelSyncEnabled.value ? 'Sincronizado' : 'Conectado') : 'Sin conectar',
    tone: channelConnected.value > 0 ? 'sync' : 'off',
  })

  const paymentsConfigured = Boolean(hotelData.value?.defaultPaymentMethod || hotelData.value?.depositType)
  services.push({
    label: 'Sistema de Pagos',
    status: !apiOnline.value ? 'Offline' : paymentsConfigured ? 'Online' : 'Sin configurar',
    tone: !apiOnline.value ? offline : paymentsConfigured ? 'ok' : 'warn',
  })

  services.push({ label: 'IA Hotel', status: apiOnline.value ? 'Disponible' : 'Offline', tone: apiOnline.value ? 'ok' : offline })
  return services
})

// ── Insights de IA (derivados de datos reales) ───────────────────────────
const AI_INSIGHTS_LIMIT = 5
/** Umbral de ocupación estimada a partir del cual sugerimos revisar tarifas */
const HIGH_OCCUPANCY_THRESHOLD = 85
/** Crecimiento semanal mínimo de un canal para destacarlo */
const CHANNEL_GROWTH_THRESHOLD = 20

const aiInsights = computed<AiInsight[]>(() => {
  const out: AiInsight[] = []
  const active = reservationStore.reservations.filter(r => r.status !== 'cancelled' && r.status !== 'checked_out')
  const total = dashboard.stats.totalRooms

  // Sobreventa mañana
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = tomorrow.toISOString().slice(0, 10)
  const occupyingTomorrow = active.filter(r => dstr(r.checkIn) <= tomorrowStr && dstr(r.checkOut) > tomorrowStr)
  if (total > 0 && occupyingTomorrow.length > total) {
    out.push({ tone: 'danger', text: `Hay <b>sobreventa para mañana</b>: ${occupyingTomorrow.length} reservas para ${total} habitaciones.` })
  } else if (total > 0) {
    const pct = Math.round((occupyingTomorrow.length / total) * 100)
    out.push({ tone: 'info', text: `Se estima una ocupación del <b>${pct}%</b> para mañana.` })
    if (pct >= HIGH_OCCUPANCY_THRESHOLD) {
      out.push({ tone: 'ok', text: `Demanda alta para mañana — conviene <b>revisar tarifas al alza</b>.` })
    }
  }

  // Limpieza pendiente
  const dirtyCount = (dashboard.stats.roomsByStatus.dirty ?? 0) + (dashboard.stats.roomsByStatus.cleaning ?? 0)
  if (dirtyCount > 0) {
    out.push({ tone: 'warn', text: `<b>${dirtyCount} habitación${dirtyCount === 1 ? '' : 'es'}</b> pendiente${dirtyCount === 1 ? '' : 's'} de limpieza.` })
  }

  // Mantenimiento abierto
  if (dashboard.stats.openIncidents > 0) {
    out.push({ tone: 'warn', text: `${dashboard.stats.openIncidents} incidencia${dashboard.stats.openIncidents === 1 ? '' : 's'} de mantenimiento abierta${dashboard.stats.openIncidents === 1 ? '' : 's'}.` })
  }

  // Canal que crece semana contra semana
  const now = Date.now()
  const growth = new Map<string, { cur: number; prev: number }>()
  for (const r of reservationStore.reservations) {
    const created = new Date(r.createdAt).getTime()
    if (Number.isNaN(created)) continue
    const age = now - created
    const label = channelBrandOrDefault(r.source).label
    const g = growth.get(label) ?? { cur: 0, prev: 0 }
    if (age <= 7 * MS_DAY) g.cur++
    else if (age <= 14 * MS_DAY) g.prev++
    growth.set(label, g)
  }
  for (const [label, g] of growth) {
    if (g.prev >= 1 && g.cur >= 2) {
      const pct = Math.round(((g.cur - g.prev) / g.prev) * 100)
      if (pct >= CHANNEL_GROWTH_THRESHOLD) {
        out.push({ tone: 'ok', text: `<b>${label}</b> aumentó reservas un <b>${pct}%</b> vs semana pasada.` })
        break
      }
    }
  }

  // Llegadas de hoy
  if (dashboard.stats.arrivalsToday > 0) {
    out.push({ tone: 'info', text: `Hoy llegan <b>${dashboard.stats.arrivalsToday} huésped${dashboard.stats.arrivalsToday === 1 ? '' : 'es'}</b>.` })
  }

  return out.slice(0, AI_INSIGHTS_LIMIT)
})

// ── Clima ────────────────────────────────────────────────────────────────
// El proveedor, los códigos WMO y el manejo de error viven en WeatherService: acá solo se
// le pasan las coordenadas del hotel. Antes esto era un `fetch()` a una URL de open-meteo
// escrita a mano dentro del componente (dos reglas rotas: fetch en componente + endpoint
// de un tercero clavado en el bundle, sin forma de apuntarlo a otro lado ni de apagarlo).
async function fetchWeather() {
  weather.value = await WeatherService.current(hotelData.value?.latitude, hotelData.value?.longitude)
}

// ── Fetch / refresco ─────────────────────────────────────────────────────
async function fetchCheckinList() {
  checkinLoading.value = true
  checkinError.value = false
  try {
    checkinData.value = await DashboardService.getCheckinList(hotelId.value)
  } catch {
    checkinData.value = null
    checkinError.value = true
  } finally {
    checkinLoading.value = false
  }
}

async function fetchLiveData() {
  try {
    await dashboard.fetchStats(hotelId.value)
    apiOnline.value = !dashboard.error
  } catch { apiOnline.value = false }

  fetchCheckinList()

  NotificationsService.list({ hotelId: hotelId.value })
    .then(r => { notifications.value = (r.data ?? []).slice(0, NOTIFICATIONS_FETCH_LIMIT) })
    .catch(() => { /* módulo sin permiso o sin datos: el feed cae a reservas */ })

  ChannelService.status(hotelId.value)
    .then(s => {
      channelLastSync.value = s.lastSync
      channelConnected.value = s.connectedCount ?? 0
      channelSyncEnabled.value = Boolean(s.syncEnabled)
    })
    .catch(() => { /* sin channel manager configurado */ })
}

async function fetchBlocks() {
  try {
    const r = await HotelService.blocks()
    roomBlocks.value = r.data ?? []
  } catch { /* settings:view puede no estar habilitado para el rol — el calendario sigue sin bloqueos */ }
}

async function refreshOperationalData() {
  await Promise.all([
    roomStore.fetchRooms({ hotelId: hotelId.value }),
    reservationStore.fetchReservations({ hotelId: hotelId.value }),
    dashboard.fetchStats(hotelId.value),
    fetchBlocks(),
  ])
}

async function fetchStaticData() {
  HotelService.settings(hotelId.value)
    .then(r => { hotelData.value = r.hotel ?? null; fetchWeather() })
    .catch(() => { /* settings puede requerir permisos extra */ })

  revenueLoading.value = true
  const to = todayStr()
  const from = new Date(Date.now() - REVENUE_WINDOW_DAYS * MS_DAY).toISOString().slice(0, 10)
  ReportsService.get<FacturacionReport>('facturacion', { from, to })
    .then(r => { revenueDaily.value = r.daily ?? [] })
    .catch(() => { /* rol sin reports:view → el gráfico muestra vacío */ })
    .finally(() => { revenueLoading.value = false })
}

let refreshTimer = 0

onMounted(async () => {
  await Promise.all([
    fetchLiveData(),
    roomStore.fetchRooms({ hotelId: hotelId.value }),
    reservationStore.fetchReservations({ hotelId: hotelId.value }),
    fetchBlocks(),
  ])
  fetchStaticData()
  refreshTimer = window.setInterval(fetchLiveData, REFRESH_INTERVAL_MS)
})

onUnmounted(() => clearInterval(refreshTimer))

// PC-2.1.4 — recargar data al switchear hotel (el token refresca auth.user.hotelId).
watch(hotelId, async (id) => {
  if (!id) return
  await refreshOperationalData()
  fetchStaticData()
})

// ── Modal de habitación (heat map) ────────────────────────────────────────
const selectedRoom = ref<Room | null>(null)

// Label y color del estado salen de `data/room-status` — la copia local que vivía acá tenía
// otro color y otro nombre que las del mapa de habitaciones y el donut de la MISMA pantalla.
const roomStatusLabel = computed(() => (selectedRoom.value ? roomStatusMeta(selectedRoom.value.status).label : ''))
const roomAccent = computed(() => roomStatusMeta(selectedRoom.value?.status ?? '').color)

// ── Recepción desde el mapa de habitaciones ──────────────────────────────
// El check-in real es una transacción del módulo de reservas (reclama la reserva, abre folio,
// postea el cargo de habitación con impuesto) y el check-out cierra el folio, factura, cobra y
// empuja la disponibilidad a Channex. Nada de eso se logra cambiando `rooms.status`, así que el
// modal no lo intenta: manda al mostrador, que es donde vive ese flujo (con su settlement).
const FRONT_DESK_ROUTE = '/panel/reservas/checkin'

const frontDeskAction = computed(() => {
  const action = frontDeskActionFor(selectedRoom.value?.status ?? '')
  if (!action) return null
  // El backend igual responde 403; esto evita ofrecer un camino que termina en error.
  const perm = FRONT_DESK_PERMISSION[action]
  return can(perm.module, perm.action) ? action : null
})

function goToFrontDesk() {
  selectedRoom.value = null
  router.push(FRONT_DESK_ROUTE)
}

const roomGuest = computed(() => {
  if (!selectedRoom.value) return null
  const r = reservationStore.reservations.find(x => x.status === 'checked_in' && String(x.roomId) === String(selectedRoom.value!.id))
  if (!r) return null
  const name = r.guestName ?? 'Huésped'
  return {
    name,
    initials: name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join(''),
    checkIn: dstr(r.checkIn),
    checkOut: dstr(r.checkOut),
  }
})

async function setRoomStatus(status: RoomStatus) {
  if (!selectedRoom.value) return
  const id = selectedRoom.value.id
  selectedRoom.value = null
  try {
    await roomStore.updateRoomStatus(id, status)
    dashboard.fetchStats(hotelId.value)
  } catch {
    toast.error('No se pudo actualizar el estado de la habitación')
    await roomStore.fetchRooms({ hotelId: hotelId.value }).catch(() => {})
  }
}
</script>

<style scoped>
.cc-dashboard {
  background:
    radial-gradient(1000px 500px at 80% -10%, rgba(37, 99, 235, 0.05), transparent),
    radial-gradient(800px 400px at 0% 110%, rgba(6, 182, 212, 0.04), transparent),
    #F8FAFC;
}
.cc-modal-btn {
  padding: 10px 16px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  transition: all 0.2s ease;
}
.cc-modal-btn:hover { filter: brightness(1.15); }
</style>
