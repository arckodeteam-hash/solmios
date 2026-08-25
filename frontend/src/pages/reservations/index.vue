<template>
  <div class="space-y-5">
    <!-- Header -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-black text-navy">Reservas</h1>
        <div class="mt-0.5 flex flex-wrap items-center gap-2.5">
          <p class="text-sm text-text-muted">Gestión de reservaciones del hotel</p>
          <span class="inline-flex items-center gap-1.5 rounded-full bg-[#DCFCE7] px-2.5 py-1 text-[10px] font-extrabold uppercase text-[#16A34A]">
            <span class="relative flex h-1.5 w-1.5">
              <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22C55E] opacity-60"></span>
              <span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#22C55E]"></span>
            </span>
            En vivo
          </span>
        </div>
      </div>
      <div class="flex gap-2.5">
        <button @click="exportCSV" class="flex items-center gap-2 border border-border bg-white text-text-secondary font-semibold text-sm px-4 py-2.5 rounded-full hover:bg-surface transition-colors cursor-pointer">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"/>
          </svg>
          Exportar
        </button>
        <button @click="openNew" data-testid="reservations-new-button" class="flex items-center gap-2 bg-navy text-white font-bold text-sm px-5 py-2.5 rounded-full hover:bg-navy-light transition-colors cursor-pointer">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/>
          </svg>
          Nueva Reserva
        </button>
      </div>
    </div>

    <!-- KPIs — mismas tarjetas hero del dashboard (gradiente + glow + ícono grande) -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <KpiHeroCard v-for="s in statsCards" :key="s.label"
        :label="s.label" :value="s.value" :icon="s.icon" :accent="s.accent"
        :prefix="s.prefix" :trend="s.trend ?? null" :unit="s.caption"
        @click="s.link && s.link()" :class="s.link ? 'cursor-pointer' : ''" />
    </div>

    <!-- Filters + Table -->
    <div class="rounded-[20px] border-2 border-navy bg-white shadow-(--shadow-card) overflow-hidden">
      <!-- Header de sección (design system) -->
      <div class="flex items-center justify-between gap-3 flex-wrap bg-navy px-4 sm:px-5 py-4">
        <div>
          <h2 class="text-base sm:text-lg font-black text-white">Listado de reservas</h2>
          <p class="text-[11px] text-white/60 mt-0.5">Buscá, filtrá y gestioná todas las reservas del hotel</p>
        </div>
        <span class="px-3 py-1 rounded-lg bg-white/10 text-xs font-black text-white">{{ filtered.length }}</span>
      </div>
      <!-- Toolbar -->
      <div class="flex items-center gap-3 p-4 border-b-2 border-navy flex-wrap">
        <div class="relative">
          <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/>
          </svg>
          <input id="reservations-search" name="search" v-model="search" type="text" aria-label="Buscar reservas por huésped, número o correo" placeholder="Buscar huésped, reserva, correo..." data-testid="reservations-search" class="pl-9 pr-4 py-2 text-sm rounded-full border border-border bg-surface focus:outline-none focus:border-blue focus:ring-2 focus:ring-blue/10 w-64 transition-all" />
        </div>
        <select id="reservations-filter-status" name="filterStatus" aria-label="Filtrar reservas por estado" v-model="filterStatus" class="px-3 py-2 rounded-full border border-border text-xs font-semibold text-text-secondary bg-white cursor-pointer focus:outline-none focus:border-blue focus:ring-2 focus:ring-blue/10 transition-all">
          <option value="">Todos los estados</option>
          <option value="confirmed">Confirmadas</option>
          <option value="pending">Pendientes</option>
          <option value="checked_in">Check-in</option>
          <option value="checked_out">Check-out</option>
          <option value="cancelled">Canceladas</option>
        </select>
        <select id="reservations-filter-channel" name="filterChannel" aria-label="Filtrar reservas por canal" v-model="filterChannel" class="px-3 py-2 rounded-full border border-border text-xs font-semibold text-text-secondary bg-white cursor-pointer focus:outline-none focus:border-blue focus:ring-2 focus:ring-blue/10 transition-all">
          <option value="">Todos los canales</option>
          <option value="direct">Directa</option>
          <option value="booking">Booking</option>
          <option value="expedia">Expedia</option>
          <option value="airbnb">Airbnb</option>
        </select>
        <span class="text-xs text-text-muted ml-auto font-medium">{{ filtered.length }} reservas encontradas</span>
      </div>

      <!-- Table -->
      <SkeletonLoader v-if="loading" variant="table" :rows="8" />
      <div v-else class="overflow-x-auto">
        <table class="w-full">
        <thead>
          <tr class="border-b border-border bg-surface/50">
            <th class="text-left px-4 py-3 text-[10px] font-bold text-text-muted uppercase tracking-wider">Huésped</th>
            <th class="text-left px-4 py-3 text-[10px] font-bold text-text-muted uppercase tracking-wider">Hab.</th>
            <th class="text-left px-4 py-3 text-[10px] font-bold text-text-muted uppercase tracking-wider">Check-in</th>
            <th class="text-left px-4 py-3 text-[10px] font-bold text-text-muted uppercase tracking-wider">Check-out</th>
            <th class="text-left px-4 py-3 text-[10px] font-bold text-text-muted uppercase tracking-wider">N</th>
            <th class="text-left px-4 py-3 text-[10px] font-bold text-text-muted uppercase tracking-wider">Estado</th>
            <th class="text-left px-4 py-3 text-[10px] font-bold text-text-muted uppercase tracking-wider">Canal</th>
            <th class="text-right px-4 py-3 text-[10px] font-bold text-text-muted uppercase tracking-wider">Total</th>
            <th class="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border/40">
          <tr v-for="(r, i) in filtered" :key="r.id" data-testid="reservation-row" :data-res-id="r.id"
            class="hover:bg-surface/60 cursor-pointer transition-colors"
            @click="openDetail(r)">
            <td class="px-4 py-5">
              <div class="flex items-center gap-2.5">
                <div class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black shrink-0" :class="[avatarStyle(i).bg, avatarStyle(i).text]">
                  {{ (r.guestName || '?').slice(0,1).toUpperCase() }}
                </div>
                <div>
                  <div class="font-bold text-sm text-navy" data-testid="reservation-guest-name">{{ r.guestName }}</div>
                  <div class="text-[11px] text-text-muted">{{ r.email }}</div>
                </div>
              </div>
            </td>
            <td class="px-4 py-5">
              <span class="text-sm font-bold text-navy">{{ r.roomNumber }}</span>
            </td>
            <td class="px-4 py-5">
              <div class="flex items-baseline gap-1">
                <span class="text-sm font-black text-navy">{{ fmtDay(r.checkIn) }}</span>
                <span class="text-[10px] font-bold text-text-muted uppercase">{{ fmtMonthAbbr(r.checkIn) }}</span>
              </div>
              <div class="text-[10px] text-text-muted capitalize">{{ fmtWeekdayAbbr(r.checkIn) }}</div>
            </td>
            <td class="px-4 py-5">
              <div class="flex items-baseline gap-1">
                <span class="text-sm font-black text-navy">{{ fmtDay(r.checkOut) }}</span>
                <span class="text-[10px] font-bold text-text-muted uppercase">{{ fmtMonthAbbr(r.checkOut) }}</span>
              </div>
              <div class="text-[10px] text-text-muted capitalize">{{ fmtWeekdayAbbr(r.checkOut) }}</div>
            </td>
            <td class="px-4 py-5">
              <span class="text-xs font-bold text-text-secondary">{{ r.nights }}n</span>
            </td>
            <td class="px-4 py-5">
              <div class="flex flex-col items-start gap-1">
                <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold" :class="stClass(r.status)">
                  <span class="h-1.5 w-1.5 rounded-full shrink-0" :class="stDotClass(r.status)"></span>{{ stLabel(r.status) }}
                </span>
                <!-- Tarea 3.4 (corrección 2026-08-25) — badge aparte, eje independiente de
                     `status`: la reserva puede estar "Confirmada" (pagada) Y "Por aprobar"
                     (el hotel todavía no la revisó) al mismo tiempo. -->
                <span v-if="r.approvalStatus === 'pending'" data-testid="reservation-approval-badge"
                  class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-gold/15 text-gold">
                  <span class="h-1.5 w-1.5 rounded-full shrink-0 bg-gold"></span>Por aprobar
                </span>
              </div>
            </td>
            <td class="px-4 py-5">
              <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold" :class="srcClass(r.source)">
                <span class="inline-flex w-3.5 h-3.5 shrink-0" v-html="srcIcon(r.source)"></span>
                {{ srcLabel(r.source) }}
              </span>
            </td>
            <td class="px-4 py-5 text-right">
              <div class="text-sm font-extrabold text-navy">${{ r.total }}</div>
              <div class="text-[9px] font-semibold text-text-muted">USD</div>
            </td>
            <td class="px-4 py-5" @click.stop>
              <div class="flex items-center justify-end gap-1.5">
                <button @click="openDetail(r)" class="flex items-center gap-1 px-2.5 py-1.5 border border-border rounded-lg text-[10px] font-bold text-text-secondary cursor-pointer hover:bg-surface transition-colors">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.01 9.963 7.183.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.01-9.964-7.178z"/>
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                  </svg>
                  Ver
                </button>
                <button v-if="r.approvalStatus==='pending'" data-testid="reservation-row-approve" :disabled="approving===r.id" @click="approveReservation(r)" class="flex items-center gap-1 px-2.5 py-1.5 bg-gold/15 text-gold rounded-lg text-[10px] font-bold cursor-pointer hover:bg-gold/25 transition-colors disabled:opacity-50">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/>
                  </svg>
                  {{ approving===r.id ? 'Aprobando…' : 'Aprobar' }}
                </button>
                <button v-if="r.status==='confirmed'" @click="confirmAction('checkin',r)" class="flex items-center gap-1 px-2.5 py-1.5 bg-teal/10 text-teal rounded-lg text-[10px] font-bold cursor-pointer hover:bg-teal/20 transition-colors">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/>
                  </svg>
                  Check-in
                </button>
                <button v-if="r.status==='pending'||r.status==='confirmed'" data-testid="reservation-row-cancel" @click="openCancel(r)" class="flex items-center gap-1 px-2.5 py-1.5 bg-coral/10 text-coral rounded-lg text-[10px] font-bold cursor-pointer hover:bg-coral/20 transition-colors">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
                  </svg>
                  Cancelar
                </button>
                <div class="relative">
                  <button @click.stop="openMenuId = openMenuId === r.id ? '' : r.id" class="w-7 h-7 grid place-items-center rounded-lg text-text-muted cursor-pointer hover:bg-surface hover:text-navy transition-colors">⋮</button>
                  <template v-if="openMenuId === r.id">
                    <div class="fixed inset-0 z-20" @click="openMenuId = ''"></div>
                    <div class="absolute right-0 top-8 z-30 w-36 rounded-xl border border-border bg-white shadow-lg py-1 text-left" @click.stop>
                      <button @click="openEdit(r); openMenuId=''" data-testid="reservation-row-edit" class="w-full text-left px-3 py-2 text-xs font-semibold text-text-secondary hover:bg-surface cursor-pointer">Editar</button>
                      <button v-if="r.status==='pending'||r.status==='cancelled'" @click="confirmAction('delete',r); openMenuId=''" class="w-full text-left px-3 py-2 text-xs font-semibold text-coral hover:bg-coral/10 cursor-pointer">Eliminar</button>
                    </div>
                  </template>
                </div>
              </div>
            </td>
          </tr>
          <tr v-if="filtered.length === 0">
            <td colspan="9" class="px-4 py-12">
              <EmptyState title="No hay reservas"
                message="Ninguna reserva coincide con los filtros, o todavía no hay reservas cargadas.">
                <template #action>
                  <button @click="openNew" class="bg-navy text-white font-bold text-sm px-5 py-2.5 rounded-full hover:bg-navy-light transition-colors cursor-pointer">
                    Nueva Reserva
                  </button>
                </template>
              </EmptyState>
            </td>
          </tr>
        </tbody>
        </table>
      </div>
    </div>

    <!-- ═══════════════════════════ WIZARD NUEVA / EDITAR RESERVA ═══════════════════════════ -->
    <ReservationWizardModal
      v-if="wizardOpen"
      :edit-id="wizardEditId"
      :rooms="rooms"
      @close="wizardOpen = false"
      @saved="onWizardSaved"
    />

    <!-- Confirm Dialog -->
    <Teleport to="body">
      <div v-if="cfg.show" class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl w-full max-w-sm p-6 text-center">
          <div class="text-3xl mb-3">{{ cfg.icon }}</div>
          <h3 class="text-lg font-black text-navy mb-2">{{ cfg.title }}</h3>
          <p class="text-sm text-text-secondary">{{ cfg.msg }}</p>
          <div class="flex items-center justify-center gap-4 mt-6">
            <button @click="cfg.show=false" class="text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Cancelar</button>
            <button @click="cfg.fn();cfg.show=false" class="rounded-full px-5 py-2.5 text-sm font-extrabold text-white cursor-pointer" :class="cfg.btn">Confirmar</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Cancelación con política a la vista (penalidad + reembolso) y motivo obligatorio.
         El confirm genérico de arriba NO alcanzaba: además de no mostrar la plata en juego,
         cancelaba con `update({status:'cancelled'})`, salteando la política del hotel. -->
    <CancelReservationModal :open="cancelDlg.show" :reservation="cancelDlg.res"
      @close="cancelDlg.show = false" @cancelled="load" />

    <!-- ═══ Vista de DETALLE (F3 match-misterplan) ═══ -->
    <ReservationModal
      v-if="detailId"
      :reservation-id="detailId"
      @close="detailId = ''"
      @edit="onEditDetail"
      @changed="load"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useCountUp } from '@/composables/useCountUp'
import { ReservationService } from '@/services/Reservation.service'
import ReservationModal from '@/components/features/ReservationModal.vue'
import ReservationWizardModal from '@/components/features/ReservationWizardModal.vue'
import CancelReservationModal from '@/components/features/CancelReservationModal.vue'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import SkeletonLoader from '@/components/ui/SkeletonLoader.vue'
import { useAuthStore } from '@/stores/auth.store'
import { useToast } from '@/composables/useToast'
import { useRoute, useRouter } from 'vue-router'
import type { CancellableReservation } from '@/types'

const loading = ref(true)

const auth = useAuthStore()
const toast = useToast()
const route = useRoute()
const router = useRouter()
const hid = computed(() => (auth.user?.hotelId && auth.user.hotelId !== 'platform' ? auth.user.hotelId : undefined))

// ── State ──
const search = ref('')
const filterStatus = ref('')
const filterChannel = ref('')
// Tarea 3.4 (corrección 2026-08-25) — '' | 'pending'. Eje independiente de filterStatus.
const filterApproval = ref('')
const list = ref<any[]>([])
const rooms = ref<any[]>([])
// Detalle (F3): clic en fila abre ReservationModal (vista lectura), no el form directo.
const detailId = ref('')
const lastRow = ref<Record<string, unknown> | null>(null)
const cfg = ref({ show: false, icon: '', title: '', msg: '', btn: '', fn: () => {} })
const cancelDlg = ref<{ show: boolean; res: CancellableReservation | null }>({ show: false, res: null })
// Menú contextual (⋮) de la fila abierta en la tabla de reservas
const openMenuId = ref('')

const MS_PER_DAY = 86_400_000

// ── Wizard compartido (crear/editar) ──
const wizardOpen = ref(false)
const wizardEditId = ref<string | null>(null)

// ── Computed ──
const today = new Date().toISOString().split('T')[0]
const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().split('T')[0] })()

// Fuentes numéricas de cada KPI — separadas de statsCards para poder animarlas con useCountUp
// (el composable debe llamarse en el cuerpo de setup, no dentro del computed que arma las cards).
const checkinsTodayCount = computed(() => list.value.filter((r: any) => r.checkIn === today && (r.status === 'confirmed' || r.status === 'checked_in')).length)
const checkoutsTodayCount = computed(() => list.value.filter((r: any) => r.checkOut === today && r.status === 'checked_in').length)
const revenueTodayAmount = computed(() => list.value.filter((r: any) => r.checkIn === today).reduce((s: number, r: any) => s + (r.total || 0), 0))
const totalBilledAmount = computed(() => list.value.filter((r: any) => r.status !== 'cancelled').reduce((s: number, r: any) => s + (r.total || 0), 0))
const pendingCount = computed(() => list.value.filter((r: any) => r.status === 'pending').length)
const confirmedCount = computed(() => list.value.filter((r: any) => r.status === 'confirmed').length)
// Tarea 3.4 (corrección 2026-08-25) — eje independiente de `status` (ver comentario en `load()`).
const approvalPendingCount = computed(() => list.value.filter((r: any) => r.approvalStatus === 'pending').length)

// "vs ayer": mismas métricas de check-in/out/ingresos pero con fecha de ayer — ya tenemos
// todas las reservas cargadas en `list`, no hace falta pedir un histórico aparte.
const checkinsYesterdayCount = computed(() => list.value.filter((r: any) => r.checkIn === yesterday && r.status !== 'cancelled').length)
const checkoutsYesterdayCount = computed(() => list.value.filter((r: any) => r.checkOut === yesterday && r.status !== 'cancelled').length)
const revenueYesterdayAmount = computed(() => list.value.filter((r: any) => r.checkIn === yesterday).reduce((s: number, r: any) => s + (r.total || 0), 0))

function pctChange(cur: number, prev: number) {
  if (!prev) return cur > 0 ? 100 : 0
  return Math.round(((cur - prev) / prev) * 100)
}
const checkinsTrend = computed(() => pctChange(checkinsTodayCount.value, checkinsYesterdayCount.value))
const checkoutsTrend = computed(() => pctChange(checkoutsTodayCount.value, checkoutsYesterdayCount.value))
const revenueTrend = computed(() => pctChange(revenueTodayAmount.value, revenueYesterdayAmount.value))

const checkinsAnim = useCountUp(checkinsTodayCount)
const checkoutsAnim = useCountUp(checkoutsTodayCount)
const revenueAnim = useCountUp(revenueTodayAmount)
const totalBilledAnim = useCountUp(totalBilledAmount)
const pendingAnim = useCountUp(pendingCount)
const confirmedAnim = useCountUp(confirmedCount)
const approvalPendingAnim = useCountUp(approvalPendingCount)

function setStatusFilter(status: string) { filterStatus.value = status }
// Tarea 3.4 (corrección 2026-08-25) — toggle: un segundo click sobre la misma vista la
// apaga (mismo criterio que un filtro de chip, no un radio permanente).
function toggleApprovalFilter() { filterApproval.value = filterApproval.value === 'pending' ? '' : 'pending' }

const statsCards = computed(() => [
  { label: 'Check-ins Hoy', value: checkinsAnim.value, icon: 'checkin' as const, accent: 'blue' as const, trend: checkinsTrend.value, caption: undefined as string | undefined, link: undefined as (() => void) | undefined },
  { label: 'Check-outs Hoy', value: checkoutsAnim.value, icon: 'checkout' as const, accent: 'rose' as const, trend: checkoutsTrend.value, caption: undefined as string | undefined, link: undefined as (() => void) | undefined },
  { label: 'Ingresos Hoy', value: revenueAnim.value, prefix: '$', icon: 'money' as const, accent: 'green' as const, trend: revenueTrend.value, caption: undefined as string | undefined, link: undefined as (() => void) | undefined },
  { label: 'Total Facturado', value: totalBilledAnim.value, prefix: '$', icon: 'money' as const, accent: 'purple' as const, trend: null as number | null, caption: 'Acumulado' as string | undefined, link: undefined as (() => void) | undefined },
  { label: 'Pendientes', value: pendingAnim.value, icon: 'bookings' as const, accent: 'amber' as const, trend: null as number | null, caption: undefined as string | undefined, link: (() => setStatusFilter('pending')) as (() => void) | undefined },
  { label: 'Confirmadas', value: confirmedAnim.value, icon: 'bookings' as const, accent: 'teal' as const, trend: null as number | null, caption: undefined as string | undefined, link: (() => setStatusFilter('confirmed')) as (() => void) | undefined },
  // Tarea 3.4 — vista dedicada para reservas pagadas que el hotel todavía no revisó
  // ("confirmación instantánea" apagada). Eje independiente del filtro de Estado de arriba.
  { label: 'Por aprobar', value: approvalPendingAnim.value, icon: 'bookings' as const, accent: 'amber' as const, trend: null as number | null, caption: 'Confirmación manual' as string | undefined, link: toggleApprovalFilter as (() => void) | undefined },
])

const filtered = computed(() => {
  let l = list.value
  if (search.value) { const q = search.value.toLowerCase(); l = l.filter((r: any) => (r.guestName || '').toLowerCase().includes(q) || (r.email || '').toLowerCase().includes(q)) }
  if (filterStatus.value) l = l.filter((r: any) => r.status === filterStatus.value)
  if (filterChannel.value) l = l.filter((r: any) => r.source === filterChannel.value)
  if (filterApproval.value) l = l.filter((r: any) => r.approvalStatus === filterApproval.value)
  return l
})

// ── Helpers ──
function fmtDate(d: string) { return new Date(d + 'T12:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) }
function fmtDay(d: string) { return d ? new Date(d + 'T12:00:00').getDate() : '--' }
function fmtMonthAbbr(d: string) { return d ? new Date(d + 'T12:00:00').toLocaleDateString('es-ES', { month: 'short' }).replace('.', '') : '' }
function fmtWeekdayAbbr(d: string) { return d ? new Date(d + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', '') : '' }
function stLabel(s: string) { const m: any = { pending: 'Pendiente', confirmed: 'Confirmada', checked_in: 'Check-in', checked_out: 'Check-out', cancelled: 'Cancelada' }; return m[s] || s }
function stClass(s: string) { const m: any = { pending: 'bg-gold/10 text-gold', confirmed: 'bg-teal/10 text-teal', checked_in: 'bg-cyan/10 text-cyan', checked_out: 'bg-gray-100 text-gray-500', cancelled: 'bg-coral/10 text-coral' }; return m[s] || '' }
function stDotClass(s: string) { const m: any = { pending: 'bg-gold', confirmed: 'bg-teal', checked_in: 'bg-cyan', checked_out: 'bg-gray-400', cancelled: 'bg-coral' }; return m[s] || 'bg-gray-400' }
function srcLabel(s: string) { const m: any = { direct: 'Directa', booking: 'Booking', expedia: 'Expedia', airbnb: 'Airbnb', google: 'Google', whatsapp: 'WhatsApp', phone: 'Teléfono' }; return m[s] || s }
function srcClass(s: string) { const m: any = { direct: 'bg-teal/10 text-teal', booking: 'bg-cyan/10 text-cyan', expedia: 'bg-gold/10 text-gold', airbnb: 'bg-coral/10 text-coral', google: 'bg-blue-100 text-blue-700', whatsapp: 'bg-emerald-100 text-emerald-700' }; return m[s] || 'bg-gray-100 text-gray-500' }

// Iconos de canal — logos reales de marca (mismo SVG que la sección #integrations del
// landing, frontend/src/pages/landing/index.vue) para las OTAs; ícono genérico de línea
// (currentColor) solo para canales sin marca propia (directa, teléfono) o sin asset
// verificado en el repo (Google — no se inventa un logo de marca no auditado).
const SRC_ICON_SVG: Record<string, string> = {
  direct: '<svg class="w-full h-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"/></svg>',
  booking: '<svg class="w-full h-full" viewBox="0 0 24 24" fill="#003A9A"><path d="M24 0H0v24h24ZM8.575 6.563h2.658c2.108 0 3.473 1.15 3.473 2.898 0 1.15-.575 1.82-.91 2.108l-.287.263.335.192c.815.479 1.318 1.389 1.318 2.395 0 1.988-1.51 3.257-3.857 3.257H7.449V7.713c0-.623.503-1.126 1.126-1.15zm1.7 1.868c-.479.024-.694.264-.694.79v1.893h1.676c.958 0 1.294-.743 1.294-1.365 0-.815-.503-1.318-1.318-1.318zm-.096 4.36c-.407.071-.598.31-.598.79v2.251h1.868c.934 0 1.509-.55 1.509-1.533 0-.934-.599-1.509-1.51-1.509zm7.737 2.394c.743 0 1.341.599 1.341 1.342a1.34 1.34 0 0 1-1.341 1.341 1.355 1.355 0 0 1-1.341-1.341c0-.743.598-1.342 1.34-1.342z"/></svg>',
  expedia: '<svg class="w-full h-full" viewBox="0 0 24 24" fill="#191E3B"><path d="M19.067 0H4.933A4.94 4.94 0 0 0 0 4.933v14.134A4.932 4.932 0 0 0 4.933 24h14.134A4.932 4.932 0 0 0 24 19.067V4.933C24.01 2.213 21.797 0 19.067 0ZM7.336 19.341c0 .19-.148.337-.337.337h-2.33a.333.333 0 0 1-.337-.337v-2.33c0-.189.148-.336.337-.336H7c.19 0 .337.147.337.337zm12.121-1.486-2.308 2.298c-.169.168-.422.053-.422-.2V9.57l-6.44 6.44a.533.533 0 0 1-.421.17H8.169a.32.32 0 0 1-.338-.338v-1.697c0-.2.053-.316.169-.422l6.44-6.44H4.058c-.253 0-.369-.253-.2-.421l2.297-2.309c.137-.137.285-.232.517-.232H18.15c.854 0 1.539.686 1.539 1.54v11.478c-.01.231-.095.368-.232.516z"/></svg>',
  airbnb: '<svg class="w-full h-full" viewBox="0 0 24 24" fill="#FF5A5F"><path d="M12.001 18.275c-1.353-1.697-2.148-3.184-2.413-4.457-.263-1.027-.16-1.848.291-2.465.477-.71 1.188-1.056 2.121-1.056s1.643.345 2.12 1.063c.446.61.558 1.432.286 2.465-.291 1.298-1.085 2.785-2.412 4.458zm9.601 1.14c-.185 1.246-1.034 2.28-2.2 2.783-2.253.98-4.483-.583-6.392-2.704 3.157-3.951 3.74-7.028 2.385-9.018-.795-1.14-1.933-1.695-3.394-1.695-2.944 0-4.563 2.49-3.927 5.382.37 1.565 1.352 3.343 2.917 5.332-.98 1.085-1.91 1.856-2.732 2.333-.636.344-1.245.558-1.828.609-2.679.399-4.778-2.2-3.825-4.88.132-.345.395-.98.845-1.961l.025-.053c1.464-3.178 3.242-6.79 5.285-10.795l.053-.132.58-1.116c.45-.822.635-1.19 1.351-1.643.346-.21.77-.315 1.246-.315.954 0 1.698.558 2.016 1.007.158.239.345.557.582.953l.558 1.089.08.159c2.041 4.004 3.821 7.608 5.279 10.794l.026.025.533 1.22.318.764c.243.613.294 1.222.213 1.858zm1.22-2.39c-.186-.583-.505-1.271-.9-2.094v-.03c-1.889-4.006-3.642-7.608-5.307-10.844l-.111-.163C15.317 1.461 14.468 0 12.001 0c-2.44 0-3.476 1.695-4.535 3.898l-.081.16c-1.669 3.236-3.421 6.843-5.303 10.847v.053l-.559 1.22c-.21.504-.317.768-.345.847C-.172 20.74 2.611 24 5.98 24c.027 0 .132 0 .265-.027h.372c1.75-.213 3.554-1.325 5.384-3.317 1.829 1.989 3.635 3.104 5.382 3.317h.372c.133.027.239.027.265.027 3.37.003 6.152-3.261 4.802-6.975z"/></svg>',
  google: '<svg class="w-full h-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"/></svg>',
  whatsapp: '<svg class="w-full h-full" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>',
  phone: '<svg class="w-full h-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106a1.125 1.125 0 0 0-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z"/></svg>',
}
function srcIcon(s: string) { return SRC_ICON_SVG[s] ?? SRC_ICON_SVG.booking }

// Paleta de avatares del listado — reusa los tokens reales del tema (no hex sueltos) para
// que cada huésped tenga un color reconocible sin depender de datos que no tenemos (ids estables).
const AVATAR_PALETTE = [
  { bg: 'bg-blue/10', text: 'text-blue' },
  { bg: 'bg-purple/10', text: 'text-purple' },
  { bg: 'bg-gold/10', text: 'text-gold' },
  { bg: 'bg-teal/10', text: 'text-teal' },
  { bg: 'bg-coral/10', text: 'text-coral' },
  { bg: 'bg-cyan/10', text: 'text-cyan' },
]
function avatarStyle(i: number) { return AVATAR_PALETTE[i % AVATAR_PALETTE.length] }

// pct opcional: algunos stats (link/caption) no traen trend → default 0 = neutral.
function trendClass(pct = 0) {
  if (pct > 0) return 'text-[#16A34A]'
  if (pct < 0) return 'text-[#DC2626]'
  return 'text-text-muted'
}
function trendLabel(pct = 0) {
  if (pct > 0) return `+${pct}% vs ayer`
  return `${pct}% vs ayer`
}

// ── Data Loading ──
async function load() {
  loading.value = true
  try {
    const [{ RoomService }, { GuestService }] = await Promise.all([import('@/services/Room.service'), import('@/services/Guest.service')])
    const [res, rom, gst] = await Promise.all([
      ReservationService.list({ hotelId: hid.value }).catch(() => ({ reservations: [], total: 0 })),
      RoomService.list({ hotelId: hid.value }).catch(() => ({ rooms: [], total: 0 })),
      GuestService.list({ hotelId: hid.value }).catch(() => ({ guests: [], total: 0 })),
    ])
    rooms.value = rom.rooms || []
    const rm = new Map(rooms.value.map((r: any) => [r.id, r]))
    const gm = new Map((gst.guests || []).map((g: any) => [g.id, g]))
    list.value = (res.reservations || []).map((r: any) => {
      const room = rm.get(r.roomId)
      const guest = gm.get(r.guestId)
      return {
        id: r.id, guestName: guest?.name || 'Guest', email: guest?.email || '',
        roomNumber: room?.number || r.roomNumber || '—', roomId: r.roomId, guestId: r.guestId,
        checkIn: String(r.checkIn || '').slice(0, 10), checkOut: String(r.checkOut || '').slice(0, 10),
        nights: nBetween(r.checkIn, r.checkOut), status: r.status, source: r.source,
        total: r.totalAmount, adults: r.adults, children: r.children, notes: r.notes || '',
        // Tarea 3.4 (corrección 2026-08-25) — eje independiente de `status`: la reserva ya
        // está pagada/ocupando la habitación, pero el hotel todavía no la revisó.
        approvalStatus: r.approvalStatus || null,
      }
    })
  } catch (e: any) { console.error('[reservations/load]', e); toast.error('No se pudieron cargar las reservas') }
  finally { loading.value = false }
}

function nBetween(a?: string, b?: string): number {
  if (!a || !b) return 0
  return Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / MS_PER_DAY))
}

// ── Wizard compartido: abrir para crear o editar (el componente hace su propio fetch por id) ──
function openNew() {
  wizardEditId.value = null
  wizardOpen.value = true
}

function openEdit(r: any) {
  wizardEditId.value = r.id
  wizardOpen.value = true
}

function onWizardSaved() {
  wizardOpen.value = false
  load()
}

// ── Detalle (F3): abrir vista de lectura; Editar reusa el wizard existente ──
function openDetail(r: any) {
  lastRow.value = r
  detailId.value = r.id
}
function onEditDetail() {
  const r = lastRow.value
  detailId.value = ''
  if (r) openEdit(r)
}

function confirmAction(type: string, r: any) {
  if (type === 'checkin') { cfg.value = { show: true, icon: '🛎️', title: '¿Check-in?', msg: `${r.guestName} — Hab. ${r.roomNumber} — ${r.checkIn}`, btn: 'bg-teal', fn: () => doCheckin(r) } }
  else { cfg.value = { show: true, icon: '🗑️', title: '¿Eliminar reserva?', msg: `${r.guestName} — Hab. ${r.roomNumber} — esta acción no se puede deshacer`, btn: 'bg-coral', fn: () => doDelete(r) } }
}

// Cancelar tiene su propio modal (no el confirm genérico): hay que ver la penalidad y el
// reembolso ANTES de confirmar, y dejar el motivo asentado. La cancelación real la hace el
// modal contra `POST /reservas/:id/cancel`, el único endpoint que aplica la política del hotel.
function openCancel(r: any) {
  cancelDlg.value = {
    show: true,
    res: { id: r.id, guestName: r.guestName, roomNumber: r.roomNumber, checkIn: r.checkIn, checkOut: r.checkOut, amount: r.total },
  }
}

async function doCheckin(r: any) {
  try {
    // Check-in real: abre el folio de la reserva + marca checked_in + habitación occupied.
    // NO usar update({status:'checked_in'}) — eso NO abriría el folio y rompería el cobro posterior.
    const res = await ReservationService.checkin(r.id)
    await load()
    const folioTag = res?.folioId ? ` · Folio ${String(res.folioId).slice(0, 8)}` : ''
    toast.success(`Check-in realizado${folioTag}`)
    // Toast de notificación de email de bienvenida (spec 11.1.1).
    if (r.email) toast.info(`Email de bienvenida enviado a ${r.email}`)
    else toast.info('Sin email registrado')
  } catch (e: any) { toast.error(e.message || 'Error en check-in') }
}
async function doDelete(r: any) {
  try { await ReservationService.remove(r.id); await load(); toast.success('Reserva eliminada') }
  catch (e: any) { toast.error(e.message || 'Error al eliminar') }
}

// Tarea 3.4 (corrección 2026-08-25) — aprobar una reserva pendiente de revisión ("confirmación
// instantánea" apagada). `approving` deshabilita el botón de ESA fila mientras la request está
// en vuelo (anti doble-click), no toda la tabla.
const approving = ref('')
async function approveReservation(r: any) {
  approving.value = r.id
  try {
    await ReservationService.approve(r.id)
    await load()
    toast.success(`Reserva de ${r.guestName} aprobada`)
  } catch (e: any) {
    toast.error(e.message || 'Error al aprobar la reserva')
  } finally {
    approving.value = ''
  }
}

// Export CSV de las reservas filtradas (BOM UTF-8 → Excel respeta tildes).
function exportCSV() {
  const head = ['Huésped', 'Email', 'Hab', 'CheckIn', 'CheckOut', 'Noches', 'Estado', 'Canal', 'Total']
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = [head.join(','), ...filtered.value.map((r: any) =>
    [r.guestName, r.email, r.roomNumber, r.checkIn, r.checkOut, r.nights, r.status, r.source, r.total].map(esc).join(','),
  )]
  const csv = '﻿' + lines.join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `reservas-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(async () => {
  await load()
  // Si viene de planning con ?edit=id (botón Editar del ReservationModal), abrir el wizard.
  const editQ = route.query.edit
  if (editQ && typeof editQ === 'string') {
    const r = (list.value as any[]).find((x) => x.id === editQ)
    if (r) openEdit(r)
    router.replace({ query: {} })
  }
})
</script>

<style scoped>
.modal-fade-enter-active, .modal-fade-leave-active { transition: opacity 0.2s ease; }
.modal-fade-enter-active .modal-panel, .modal-fade-leave-active .modal-panel { transition: transform 0.2s ease, opacity 0.2s ease; }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }
.modal-fade-enter-from .modal-panel, .modal-fade-leave-to .modal-panel { opacity: 0; transform: translateY(8px) scale(0.98); }
</style>
