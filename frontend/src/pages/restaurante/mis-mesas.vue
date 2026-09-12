<script setup lang="ts">
// pages/restaurante/mis-mesas.vue — Pantalla del MOZO, centrada en sus cobros: las mesas que tiene
// abiertas (comandas con `waiterId` = el usuario del token), cuántas personas atiende en cada una
// (`covers`), qué está listo en cocina para llevar, cuánto tiene por cobrar y cuánto cobró hoy.
// Cada mesa lleva a su comanda y, con `restaurant:pay`, a cobrar. Se actualiza por el canal en vivo
// (#211) con polling de respaldo. No es el Salón (que es de todas las mesas y todos los mozos): es
// el resumen personal que la mesera mira entre viaje y viaje.
import { ref, computed, onMounted, onUnmounted } from 'vue'
import {
  RestaurantService,
  type Order, type RestaurantTable, type KdsTicket,
  ORDER_STATUS_LABELS, ORDER_TYPE_LABELS,
} from '@/services/Restaurant.service'
import { SettingsService } from '@/services/Settings.service'
import { currencySymbol } from '@/composables/useCurrency'
import { CurrencyCode } from '@/types/currency'
import { usePermissions } from '@/composables/usePermissions'
import { useAuthStore } from '@/stores/auth.store'
import { useRestaurantEvents } from '@/composables/useRestaurantEvents'
import { useNow } from '@/composables/useNow'
import { isLiveOrder } from './salon-helpers'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'

const { can } = usePermissions()
const auth = useAuthStore()
const payPerm = computed(() => can('restaurant', 'pay'))

const loading = ref(true)
const orders = ref<Order[]>([])
const tables = ref<RestaurantTable[]>([])
const kitchen = ref<KdsTicket[]>([])
const currency = ref<string>(CurrencyCode.USD)
const money = (n: number): string => `${currencySymbol(currency.value)}${Number(n || 0).toFixed(2)}`
const { now } = useNow(30_000)

// Comandas mías abiertas (vivas) y las cobradas hoy. "Hoy" = día local del dispositivo del mozo
// sobre `closedAt`; la caja del hotel (#282) hace el corte contable de verdad — acá es el número que
// la mesera quiere ver al final del turno, no el cierre.
const live = computed(() => orders.value.filter(isLiveOrder).sort((a, b) => String(a.openedAt || '').localeCompare(String(b.openedAt || ''))))
const todayKey = new Date().toDateString()
const paidToday = computed(() => orders.value
  .filter((o) => (o.status === 'paid' || o.status === 'charged') && o.closedAt && new Date(o.closedAt).toDateString() === todayKey)
  .sort((a, b) => String(b.closedAt || '').localeCompare(String(a.closedAt || ''))))

const covers = (o: Order): number => Number(o.covers || 0)
const kpis = computed(() => ({
  tables: live.value.length,
  people: live.value.reduce((s, o) => s + covers(o), 0),
  pending: live.value.reduce((s, o) => s + Math.max(0, Number(o.total || 0) - Number(o.amountPaid || 0)), 0),
  collected: paidToday.value.reduce((s, o) => s + Number(o.total || 0) + Number(o.tip || 0), 0),
  tips: paidToday.value.reduce((s, o) => s + Number(o.tip || 0), 0),
}))

const tableById = computed(() => new Map(tables.value.map((t) => [t.id, t])))
function placeLabel(o: Order): string {
  if (o.type === 'dine_in') {
    const t = o.tableId ? tableById.value.get(o.tableId) : undefined
    const name = t?.name || 'Mesa'
    return t?.zone ? `${t.zone} · ${name}` : name
  }
  if (o.type === 'room_service') return o.roomNumber ? `Hab. ${o.roomNumber}${o.guestName ? ` · ${o.guestName}` : ''}` : ORDER_TYPE_LABELS[o.type]
  return ORDER_TYPE_LABELS[o.type] || 'Para llevar'
}
function peopleLabel(o: Order): string {
  const n = covers(o)
  if (o.type !== 'dine_in') return o.guestName || '—'
  return n === 1 ? '1 persona' : `${n} personas`
}
/** Platos listos en cocina para llevar a esa mesa (línea `ready`) — lo que la mesera va a buscar ahora. */
function readyCount(o: Order): number {
  return kitchen.value.find((t) => t.order.id === o.id)?.lines.filter((l) => l.status === 'ready').length ?? 0
}
function sinceLabel(iso?: string): string {
  if (!iso) return ''
  const min = Math.max(0, Math.floor((now.value - new Date(iso).getTime()) / 60_000))
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`
}
function hhmm(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
}
const STATUS_TONE: Record<string, string> = {
  open: 'bg-navy/10 text-navy', sent: 'bg-navy/10 text-navy', preparing: 'bg-warning/15 text-warning', ready: 'bg-gold/15 text-gold',
  served: 'bg-teal/15 text-teal', billed: 'bg-success/15 text-success', processing_payment: 'bg-warning/15 text-warning',
}
/** Cobrar tiene sentido cuando ya hay algo servido o pedido de cuenta; una comanda `open` todavía se está armando. */
const canPay = (o: Order): boolean => payPerm.value && ['served', 'billed', 'ready', 'preparing', 'sent'].includes(o.status)

async function refresh(showSpinner = false) {
  if (showSpinner) loading.value = true
  try {
    const [mine, kds] = await Promise.all([
      RestaurantService.listOrders({ waiterId: 'me' }),
      RestaurantService.kdsQueue().catch(() => [] as KdsTicket[]),
    ])
    orders.value = mine
    kitchen.value = kds
  } finally {
    if (showSpinner) loading.value = false
  }
}
let refreshTimer: ReturnType<typeof setTimeout> | null = null
function refreshSoon() {
  if (refreshTimer) return
  refreshTimer = setTimeout(() => { refreshTimer = null; void refresh(false) }, 200)
}
const events = useRestaurantEvents({ onEvent: refreshSoon, onPoll: () => refresh(false), pollMs: 15_000 })

onMounted(async () => {
  const [tbls, settings] = await Promise.all([
    RestaurantService.listTables().catch(() => [] as RestaurantTable[]),
    SettingsService.get().catch(() => null),
  ])
  tables.value = tbls
  currency.value = settings?.hotel?.currency || CurrencyCode.USD
  await refresh(true)
  events.start()
})
onUnmounted(() => {
  events.stop()
  if (refreshTimer) clearTimeout(refreshTimer)
})
</script>

<template>
  <div class="space-y-4" data-testid="mis-mesas">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl sm:text-2xl font-black text-navy">Mis mesas</h1>
        <p class="text-sm text-text-muted mt-0.5">{{ auth.user?.name || 'Tu turno' }} · lo que tenés abierto, a quién atendés y qué cobraste hoy.</p>
      </div>
      <router-link to="/panel/restaurante/salon" class="min-h-11 inline-flex items-center px-3 py-1.5 rounded-lg border-2 border-navy/30 text-navy text-xs font-bold hover:bg-surface">Ir al salón</router-link>
    </header>

    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      <KpiHeroCard label="Mesas abiertas" :value="kpis.tables" icon="building" accent="blue" :unit="`${kpis.people} ${kpis.people === 1 ? 'persona' : 'personas'} atendiendo`" :show-bar="false" />
      <KpiHeroCard label="Por cobrar" :value="kpis.pending" :prefix="currencySymbol(currency)" :decimals="2" icon="money" accent="amber" unit="saldo de tus mesas abiertas" :show-bar="false" />
      <KpiHeroCard label="Cobrado hoy" :value="kpis.collected" :prefix="currencySymbol(currency)" :decimals="2" icon="money" accent="green" :unit="`${paidToday.length} ${paidToday.length === 1 ? 'cuenta' : 'cuentas'} · propinas ${money(kpis.tips)}`" :show-bar="false" />
      <KpiHeroCard label="Listos en cocina" :value="live.reduce((s, o) => s + readyCount(o), 0)" icon="bookings" accent="teal" unit="platos para llevar a la mesa" :show-bar="false" />
    </div>

    <div v-if="loading" class="py-16 text-center text-text-muted">Cargando…</div>
    <template v-else>
      <SectionCard title="Mesas que atiendo" :subtitle="`${live.length} abiertas`" body-class="p-3">
        <EmptyState v-if="!live.length" title="No tenés mesas abiertas" message="Cuando abras una mesa en el salón, aparece acá con sus personas y su cuenta." />
        <div v-else class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          <article v-for="o in live" :key="o.id" class="rounded-2xl border-2 border-border bg-white overflow-hidden flex flex-col" data-testid="my-table">
            <div class="px-3 py-2 bg-navy text-white flex items-center justify-between gap-2">
              <div class="min-w-0">
                <div class="font-black text-sm truncate">{{ placeLabel(o) }}</div>
                <div class="text-[11px] opacity-80 truncate">{{ o.number || 'Comanda' }} · abierta {{ hhmm(o.openedAt) }} · {{ sinceLabel(o.openedAt) }}</div>
              </div>
              <span :class="['shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/15']">{{ ORDER_STATUS_LABELS[o.status] ?? o.status }}</span>
            </div>
            <div class="p-3 space-y-2 flex-1">
              <div class="flex items-center justify-between gap-2">
                <span class="text-sm font-bold text-navy">👥 {{ peopleLabel(o) }}</span>
                <span v-if="readyCount(o)" class="text-xs font-black px-2 py-0.5 rounded-md bg-gold/15 text-gold" data-testid="ready-badge">🍽 {{ readyCount(o) }} para llevar</span>
              </div>
              <div class="flex items-end justify-between gap-2">
                <div class="text-[11px] text-text-muted">
                  <span :class="['inline-block px-1.5 py-0.5 rounded font-bold', STATUS_TONE[o.status] ?? 'bg-navy/10 text-navy']">{{ ORDER_STATUS_LABELS[o.status] ?? o.status }}</span>
                  <span v-if="Number(o.amountPaid) > 0" class="ml-1">· pagado {{ money(o.amountPaid ?? 0) }}</span>
                </div>
                <div class="text-right">
                  <div class="text-[11px] text-text-muted">Cuenta</div>
                  <div class="text-lg font-black text-navy tabular-nums">{{ money(o.total) }}</div>
                </div>
              </div>
              <div class="flex gap-2 pt-1">
                <router-link :to="`/panel/restaurante/comanda/${o.id}`" class="flex-1 min-h-11 inline-flex items-center justify-center px-3 rounded-lg border-2 border-navy/30 text-navy text-sm font-bold hover:bg-surface">Comanda</router-link>
                <router-link v-if="canPay(o)" :to="`/panel/restaurante/cobrar/${o.id}`" class="flex-1 min-h-11 inline-flex items-center justify-center px-3 rounded-lg bg-navy text-white text-sm font-black hover:opacity-90" data-testid="pay-link">Cobrar</router-link>
              </div>
            </div>
          </article>
        </div>
      </SectionCard>

      <SectionCard title="Cobrado hoy" :subtitle="`${paidToday.length} cuentas · ${money(kpis.collected)}`" body-class="p-0">
        <EmptyState v-if="!paidToday.length" title="Todavía no cobraste nada hoy" message="Las cuentas que cobres o cargues a habitación aparecen acá con su hora y propina." />
        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[640px] tbl-head text-sm">
            <thead>
              <tr>
                <th class="text-left">Hora</th>
                <th class="text-left">Mesa</th>
                <th class="text-left hidden lg:table-cell">Personas</th>
                <th class="text-left">Cómo</th>
                <th class="text-right">Propina</th>
                <th class="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="o in paidToday" :key="o.id" class="border-t border-border">
                <td class="px-3 py-2 tabular-nums">{{ hhmm(o.closedAt) }}</td>
                <td class="px-3 py-2 font-bold text-navy">{{ placeLabel(o) }} <span class="text-[11px] text-text-muted font-normal">{{ o.number }}</span></td>
                <td class="px-3 py-2 hidden lg:table-cell">{{ peopleLabel(o) }}</td>
                <td class="px-3 py-2">{{ o.status === 'charged' ? 'Cargo a habitación' : o.settlement === 'split' ? 'Cuenta dividida' : 'Pagada' }}</td>
                <td class="px-3 py-2 text-right tabular-nums">{{ money(o.tip) }}</td>
                <td class="px-3 py-2 text-right tabular-nums font-black text-navy">{{ money(o.total) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>
    </template>
  </div>
</template>

<style scoped></style>
