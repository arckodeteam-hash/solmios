<template>
  <SectionCard title="Tarifas por canal" subtitle="Precio base + ajuste por temporada" class="mb-8">
    <template #actions>
      <select v-if="channels.length > 1" v-model="selectedChannel" @change="loadRates"
        class="px-3 py-2 rounded-lg border-2 border-white/20 bg-white/10 text-sm font-bold text-white outline-none cursor-pointer">
        <option v-for="c in channels" :key="c.code" :value="c.code" class="text-navy">{{ c.name }}</option>
      </select>
      <span v-else class="px-3 py-2 rounded-lg bg-white/10 text-sm font-bold text-white">{{ channels[0]?.name }}</span>
      <button @click="togglePricingMode" :title="pricingMode === 'per_person' ? 'Cambiar a precio por habitación' : 'Cambiar a precio por persona'"
        class="rounded-lg border-2 border-white/20 bg-white/10 text-white text-sm font-bold px-4 py-2 hover:bg-white/20 transition-all cursor-pointer flex items-center gap-1.5">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"/></svg>
        {{ pricingMode === 'per_person' ? 'Por persona' : 'Por habitación' }}
      </button>
      <button @click="openSeasonsModal"
        class="rounded-lg border-2 border-white/20 bg-white/10 text-white text-sm font-bold px-4 py-2 hover:bg-white/20 transition-all cursor-pointer flex items-center gap-1.5">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5"/></svg>
        Temporadas
      </button>
      <button @click="save" :disabled="saving || !selectedChannel"
        class="rounded-lg bg-cyan text-navy text-sm font-extrabold px-5 py-2 border-2 border-cyan hover:bg-cyan-light transition-all cursor-pointer disabled:opacity-50">
        {{ saving ? 'Guardando…' : 'Guardar' }}
      </button>
      <button @click="pushToChannex" :disabled="pushing || !selectedChannel" title="Enviar los precios, cierres y estadías a los canales conectados"
        class="rounded-lg bg-teal text-white text-sm font-extrabold px-5 py-2 border-2 border-teal hover:bg-teal-light transition-all cursor-pointer disabled:opacity-50">
        {{ pushing ? 'Enviando…' : 'Enviar a canales' }}
      </button>
    </template>

    <!-- Leyenda de temporadas -->
      <div class="flex flex-wrap gap-x-4 gap-y-2 mb-4">
        <span v-for="s in seasons" :key="s.name" class="flex items-center gap-1.5 text-[11px] font-bold text-text-secondary">
          <span class="w-3 h-3 rounded-full border border-navy/20" :style="{ background: s.color }"></span>{{ s.label || s.name }}
        </span>
      </div>

      <div v-if="loading" class="text-center py-10 text-text-muted text-sm">Cargando tarifas…</div>
      <div v-else-if="groups.length === 0" class="text-center py-10 text-text-muted text-sm">
        No hay habitaciones con tipo definido para configurar tarifas.
      </div>

      <!-- Una tarjeta POR TIPO DE HABITACIÓN, con una sub-sección por ocupación -->
      <div v-else class="space-y-4">
        <div v-for="tc in typeCards" :key="tc.roomType" class="rounded-2xl border-2 border-navy overflow-hidden">
          <div class="bg-navy px-4 py-2.5 flex items-center justify-between gap-2">
            <h3 class="text-sm font-black text-white capitalize">{{ tc.roomType }}</h3>
            <span class="text-[10px] font-black uppercase text-white/70">
              {{ tc.groups.length }} {{ tc.groups.length === 1 ? 'ocupación' : 'ocupaciones' }}
            </span>
          </div>
          <div v-for="g in tc.groups" :key="g.key" :class="g !== tc.groups[0] ? 'border-t-2 border-navy/10' : ''">
          <div class="px-4 pt-2.5 pb-0.5 text-[11px] font-black text-text-muted uppercase">
            {{ g.occupancy }} {{ g.occupancy === 1 ? 'persona' : 'personas' }}
          </div>
          <!-- Responsive: en móvil General arriba + temporadas 2×2; en desktop General a la izq + 4 temporadas en fila -->
          <div class="p-3 grid grid-cols-1 lg:grid-cols-[190px_1fr] gap-3">
            <!-- General + días mín/máx -->
            <div class="rounded-xl border-2 border-navy bg-surface p-3">
              <div class="text-[10px] font-black text-text-muted uppercase mb-1">Tarifa base (General)</div>
              <div class="flex items-center gap-1 mb-2">
                <input type="number" min="0" step="0.01" inputmode="decimal" v-model.number="g.basePrice"
                  class="w-full px-2 py-1.5 rounded-lg border-2 border-navy/30 text-sm font-black text-navy text-right focus:border-navy outline-none" />
                <span class="text-xs text-text-muted shrink-0">{{ currency }}</span>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <div class="text-[10px] text-text-muted">Días mín.</div>
                  <input type="number" min="0" inputmode="numeric" v-model.number="g.minStay" class="w-full px-2 py-1 rounded-lg border-2 border-navy/30 text-xs text-right focus:border-navy outline-none" />
                </div>
                <div>
                  <div class="text-[10px] text-text-muted">Días máx.</div>
                  <input type="number" min="0" inputmode="numeric" v-model.number="g.maxStay" class="w-full px-2 py-1 rounded-lg border-2 border-navy/30 text-xs text-right focus:border-navy outline-none" />
                </div>
              </div>
            </div>

            <!-- Temporadas: 2 columnas en móvil, 4 en desktop -->
            <div class="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
              <div v-for="cell in g.cells" :key="cell.season" class="rounded-xl border-2 border-navy overflow-hidden flex flex-col">
                <div class="px-2.5 py-1.5 text-[10px] font-black uppercase text-white truncate" :style="{ background: seasonColor(cell.season) }">{{ seasonLabel(cell.season) }}</div>
                <div class="p-2.5 flex flex-col gap-1.5 flex-1">
                  <div class="flex items-center gap-1">
                    <span class="text-xs font-black text-navy">+</span>
                    <input type="number" step="1" inputmode="decimal" v-model.number="cell.percentage"
                      class="w-full min-w-0 px-2 py-1.5 rounded-lg border-2 border-navy/30 text-sm font-black text-navy text-right focus:border-navy outline-none" />
                    <span class="text-xs text-text-muted">%</span>
                  </div>
                  <div class="text-sm font-black text-teal">= {{ resultPrice(g.basePrice, cell.percentage) }} <span class="text-[10px] text-text-muted">{{ currency }}</span></div>
                  <button @click="cell.closed = cell.closed ? 0 : 1"
                    class="mt-auto w-full py-1.5 text-[10px] font-black rounded-lg border-2 transition-colors cursor-pointer"
                    :class="cell.closed ? 'bg-coral border-coral text-white' : 'border-navy/30 text-text-secondary hover:border-coral hover:text-coral'">
                    {{ cell.closed ? 'Ventas cerradas' : 'Cerrar ventas' }}
                  </button>
                </div>
              </div>
            </div>
          </div>
          </div>
        </div>
      </div>

    <!-- Modal: editar fechas/colores de las temporadas del hotel -->
    <AppModal :open="showSeasonsModal" title="Temporadas del hotel" subtitle="Las fechas son opcionales: si no las ponés, marcá los días en el planning" size="lg" @close="showSeasonsModal = false">
      <p class="mb-3 rounded-xl bg-surface px-3 py-2.5 text-[11px] leading-relaxed text-text-secondary">
        Una temporada puede no tener fechas fijas (por ejemplo la especial: Semana Santa, Navidad).
        En ese caso cargá el precio igual y marcá los días en <span class="font-bold text-navy">Planning → Asignación de temporadas</span>:
        esos días son los que se publican en los canales.
      </p>
      <div class="space-y-3">
        <div v-for="(s, i) in seasonsDraft" :key="i" class="rounded-xl border-2 border-navy p-3">
          <div class="flex items-center gap-2 mb-3">
            <span class="w-4 h-4 rounded-full border border-navy/20 shrink-0" :style="{ background: s.color }"></span>
            <span class="flex-1 min-w-0 text-sm font-black text-navy truncate">{{ s.label || s.name }}</span>
            <span
              v-if="!s.startDate || !s.endDate"
              class="shrink-0 rounded-full bg-warning/15 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-warning"
              title="Sin fechas fijas: se publica según los días marcados en Planning → Asignación de temporadas"
            >Por días</span>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block text-[10px] font-black text-text-muted uppercase mb-1">Desde</label>
              <input type="date" v-model="s.startDate" class="w-full px-2 py-1.5 rounded-lg border-2 border-navy/30 text-xs focus:border-navy outline-none" />
            </div>
            <div>
              <label class="block text-[10px] font-black text-text-muted uppercase mb-1">Hasta</label>
              <input type="date" v-model="s.endDate" class="w-full px-2 py-1.5 rounded-lg border-2 border-navy/30 text-xs focus:border-navy outline-none" />
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <button @click="showSeasonsModal = false" class="px-4 py-2.5 border-2 border-navy/30 rounded-xl text-sm font-bold text-text-secondary hover:bg-surface transition-colors cursor-pointer">Cancelar</button>
        <button @click="saveSeasons" :disabled="savingSeasons" class="px-5 py-2.5 rounded-xl bg-navy border-2 border-navy text-white text-sm font-extrabold hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-50">
          {{ savingSeasons ? 'Guardando…' : 'Guardar temporadas' }}
        </button>
      </template>
    </AppModal>
  </SectionCard>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import AppModal from '@/components/ui/AppModal.vue'
import { HotelService, type RoomRate } from '@/services/Hotel.service'
import { ChannelService, type PushRatesResult } from '@/services/Channel.service'
import { useToast } from '@/composables/useToast'

const props = defineProps<{
  hotelId?: string
  channels: { code: string; name: string }[]
  currency?: string
}>()

const toast = useToast()
const currency = props.currency || 'USD'
interface SeasonRow { name: string; label?: string; color?: string; startDate?: string; endDate?: string }
const seasons = ref<SeasonRow[]>([])
const selectedChannel = ref(props.channels[0]?.code || '')
const loading = ref(false)
const saving = ref(false)

// Modal para editar las fechas/colores de las temporadas del hotel.
const showSeasonsModal = ref(false)
const savingSeasons = ref(false)
const seasonsDraft = ref<SeasonRow[]>([])

function openSeasonsModal() {
  seasonsDraft.value = seasons.value.map((s) => ({ ...s }))
  showSeasonsModal.value = true
}

async function saveSeasons() {
  savingSeasons.value = true
  try {
    // Conserva label/color/orden y persiste las fechas; el backend re-siembra si el hotel no tenía.
    await HotelService.saveSeasons(seasonsDraft.value.map((s, i) => ({
      name: s.name, label: s.label || s.name, color: s.color || '#3b82f6',
      startDate: s.startDate || '', endDate: s.endDate || '', sortOrder: i, active: i === 0 ? 1 : 0,
    })))
    showSeasonsModal.value = false
    await loadSeasons()
    await loadRates()
    toast.success('Temporadas actualizadas')
  } catch { toast.error('Error al guardar temporadas') } finally { savingSeasons.value = false }
}

interface Cell { season: string; percentage: number; closed: number }
interface Group { key: string; roomType: string; occupancy: number; basePrice: number; minStay: number; maxStay: number; cells: Cell[] }
const groups = ref<Group[]>([])

/**
 * Tarjetas POR TIPO DE HABITACIÓN: agrupa las combinaciones tipo×ocupación bajo un
 * encabezado por tipo ("Triple" con 1/2/3 pers. adentro) en vez de una card suelta por
 * cada una — con varios tipos × varias ocupaciones la lista se hacía etérea y repetía el
 * nombre del tipo en cada card. Solo presentación: `groups` sigue siendo la fuente que
 * se edita y la que `toFlatRows()` expande para guardar.
 */
const typeCards = computed<Array<{ roomType: string; groups: Group[] }>>(() => {
  const byType = new Map<string, Group[]>()
  for (const g of groups.value) {
    const list = byType.get(g.roomType)
    if (list) list.push(g)
    else byType.set(g.roomType, [g])
  }
  return [...byType.entries()].map(([roomType, gs]) => ({ roomType, groups: gs }))
})

const DEFAULT_COLORS: Record<string, string> = { baja: '#e2e8f0', media: '#38bdf8', alta: '#22c55e', especial: '#eab308' }
function seasonColor(name: string): string {
  return seasons.value.find((s) => s.name === name)?.color || DEFAULT_COLORS[name.toLowerCase()] || '#94a3b8'
}
function seasonLabel(name: string): string {
  return seasons.value.find((s) => s.name === name)?.label || name.charAt(0).toUpperCase() + name.slice(1)
}
function resultPrice(base: number, pct: number): string {
  return (Math.round((base || 0) * (1 + (pct || 0) / 100) * 100) / 100).toLocaleString()
}

// Agrupa las filas planas (una por roomType×occupancy×season) en tarjetas por habitación.
function buildGroups(rates: RoomRate[]): Group[] {
  const byRoom = new Map<string, Group>()
  for (const r of rates) {
    const key = `${r.roomType}|${r.occupancy}`
    let g = byRoom.get(key)
    if (!g) {
      g = { key, roomType: r.roomType, occupancy: r.occupancy, basePrice: r.basePrice ?? 0, minStay: r.minStay ?? 0, maxStay: r.maxStay ?? 0, cells: [] }
      byRoom.set(key, g)
    }
    // basePrice/minStay/maxStay son de la habitación: tomamos el primero no-cero que aparezca.
    if (!g.basePrice && r.basePrice) g.basePrice = r.basePrice
    if (!g.minStay && r.minStay) g.minStay = r.minStay
    if (!g.maxStay && r.maxStay) g.maxStay = r.maxStay
    g.cells.push({ season: r.season, percentage: r.percentage ?? 0, closed: r.closed ? 1 : 0 })
  }
  // Ordena las celdas según el orden de temporadas del hotel.
  const order = seasons.value.map((s) => s.name)
  for (const g of byRoom.values()) g.cells.sort((a, b) => order.indexOf(a.season) - order.indexOf(b.season))
  return [...byRoom.values()]
}

async function loadRates() {
  if (!selectedChannel.value) return
  loading.value = true
  try {
    const r = await HotelService.rates(selectedChannel.value)
    groups.value = buildGroups(r.data || [])
  } catch { toast.error('Error al cargar tarifas') } finally { loading.value = false }
}

async function save() {
  if (!selectedChannel.value) return
  saving.value = true
  try {
    // Expande las tarjetas a filas planas: una por (roomType, occupancy, season), con la base/estadías
    // de la habitación repetidas en cada temporada.
    const rates: Partial<RoomRate>[] = []
    for (const g of groups.value) {
      for (const cell of g.cells) {
        rates.push({
          roomType: g.roomType, occupancy: g.occupancy, season: cell.season, channel: selectedChannel.value,
          basePrice: g.basePrice, percentage: cell.percentage, closed: cell.closed, minStay: g.minStay, maxStay: g.maxStay,
        })
      }
    }
    await HotelService.saveRates(rates)
    toast.success('Tarifas guardadas')
    await loadRates()
  } catch { toast.error('Error al guardar tarifas') } finally { saving.value = false }
}

// Empuja las tarifas por temporada a los canales (precio por rango de fecha + cierre + estadía).
const pushing = ref(false)

/**
 * Motivos legibles de las tarifas que no se pudieron publicar. Devuelve '' si no hubo ninguno.
 * Nombra las temporadas/tipos concretos: un contador anónimo no le dice al usuario qué ir a arreglar.
 */
function pushSkipReasons(r: PushRatesResult): string {
  const parts: string[] = []
  if (r.seasonsWithoutDates?.length) {
    parts.push(`${r.seasonsWithoutDates.join(', ')} no tiene fechas ni días asignados en el planning`)
  }
  if (r.expiredSeasons?.length) {
    parts.push(`${r.expiredSeasons.join(', ')} ya terminó`)
  }
  if (r.roomTypesWithoutRatePlan?.length) {
    parts.push(`sin tarifa publicable para ${r.roomTypesWithoutRatePlan.join(', ')} (falta sincronizar)`)
  }
  return parts.join(' · ')
}
async function pushToChannex() {
  pushing.value = true
  try {
    const r = await ChannelService.pushRates(selectedChannel.value)
    const reasons = pushSkipReasons(r)
    if (r.pushed > 0) {
      // Éxito parcial: se avisa igual, con nombre y apellido de lo que quedó afuera.
      if (reasons) toast.warning(`${r.pushed} tarifa(s) enviada(s). No se pudieron enviar ${r.skipped}: ${reasons}`)
      else toast.success(`${r.pushed} tarifa(s) enviada(s) a Canales`)
    } else if (r.notConnected) {
      toast.warning('El hotel todavía no está sincronizado con los canales: sincronizá la propiedad antes de enviar tarifas')
    } else if (reasons) {
      toast.warning(`No se envió ninguna tarifa. ${reasons}`)
    } else {
      toast.warning('Nada que enviar: no hay tarifas cargadas para este canal')
    }
  } catch { toast.error('No se pudo enviar a Canales') } finally { pushing.value = false }
}

// Modo de tarificación (config PMS por hotel): por habitación o por persona/ocupación.
const pricingMode = ref<'per_room' | 'per_person'>('per_room')
async function loadPricingMode() {
  try { pricingMode.value = (await HotelService.pricingMode()).mode } catch { /* default per_room */ }
}
async function togglePricingMode() {
  const next = pricingMode.value === 'per_person' ? 'per_room' : 'per_person'
  try {
    pricingMode.value = (await HotelService.setPricingMode(next)).mode
    await loadRates()
    toast.success(pricingMode.value === 'per_person' ? 'Precio por persona' : 'Precio por habitación')
  } catch { toast.error('No se pudo cambiar el modo') }
}

// Temporadas del hotel. El backend (GET /seasons) las siembra por defecto si el hotel no tiene
// ninguna, así que siempre vuelven las 4 (Baja/Media/Alta/Especial).
async function loadSeasons() {
  try {
    const s = await HotelService.seasons()
    seasons.value = (s.data || []).map((x: any) => ({ name: x.name, label: x.label, color: x.color, startDate: x.startDate, endDate: x.endDate }))
  } catch { /* sin temporadas → columnas por defecto del backend */ }
}

onMounted(async () => {
  await loadPricingMode()
  await loadSeasons()
  await loadRates()
})
</script>
