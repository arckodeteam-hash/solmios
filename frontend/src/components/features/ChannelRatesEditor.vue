<template>
  <SectionCard title="Tarifas por canal" subtitle="Precio base + ajuste por temporada" class="mb-8">
    <template #actions>
      <select v-if="channels.length > 1" v-model="selectedChannel" @change="loadRates"
        class="px-3 py-2 rounded-lg border-2 border-white/20 bg-white/10 text-sm font-bold text-white outline-none cursor-pointer">
        <option v-for="c in channels" :key="c.code" :value="c.code" class="text-navy">{{ c.name }}</option>
      </select>
      <span v-else class="px-3 py-2 rounded-lg bg-white/10 text-sm font-bold text-white">{{ channels[0]?.name }}</span>
      <button @click="openSeasonsModal"
        class="rounded-lg border-2 border-white/20 bg-white/10 text-white text-sm font-bold px-4 py-2 hover:bg-white/20 transition-all cursor-pointer flex items-center gap-1.5">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5"/></svg>
        Temporadas
      </button>
      <button @click="saveAndPush" :disabled="saving || pushing || !selectedChannel"
        title="Guarda los precios, cierres y estadías, y los publica en el canal"
        class="rounded-lg bg-teal text-white text-sm font-extrabold px-5 py-2 border-2 border-teal hover:bg-teal-light transition-all cursor-pointer disabled:opacity-50">
        {{ saving ? 'Guardando…' : pushing ? 'Enviando…' : 'Guardar y enviar a canales' }}
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
          <div class="bg-navy px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
            <div class="min-w-0">
              <h3 class="text-base font-black text-white capitalize leading-tight">{{ tc.roomType }}</h3>
              <p class="text-[10px] font-bold uppercase tracking-wide text-white/45 mt-0.5">
                {{ tc.groups.length }} {{ tc.groups.length === 1 ? 'ocupación' : 'ocupaciones' }} · un solo precio para todas
              </p>
            </div>
            <!-- El precio base es UNO SOLO por tipo de habitación: las temporadas y los canales solo
                 le aplican su porcentaje. Se muestra grande y una sola vez — repetido en cada bloque
                 de ocupación hacía parecer que había un base por ocupación, y de chiquito parecía un
                 dato de relleno cuando es el número del que se deriva todo lo demás de la tarjeta. -->
            <div class="flex items-center gap-3 rounded-2xl bg-white/10 ring-1 ring-white/15 px-4 py-2">
              <div class="leading-none">
                <span class="block text-[10px] font-bold uppercase tracking-wide text-white/55 mb-1.5">Tarifa base</span>
                <span class="text-3xl font-black tabular-nums text-white">{{ tc.basePrice.toLocaleString() }}</span>
                <span class="ml-1 text-xs font-bold text-white/60">{{ currency }}</span>
              </div>
              <router-link :to="{ name: 'tarifas' }" title="El precio base se edita en la grilla de tarifas: vale para todo el tipo de habitación"
                class="shrink-0 rounded-full border-2 border-white/25 px-4 py-1.5 text-[11px] font-black text-white hover:bg-white/15 hover:border-white/50 transition-colors">
                Cambiar
              </router-link>
            </div>
          </div>
          <div v-for="g in tc.groups" :key="g.key" :class="g !== tc.groups[0] ? 'border-t-2 border-navy/10' : ''">
          <!-- Los límites de estadía son del par (tipo × ocupación), no de la temporada: van en el
               encabezado de la fila, no en una tarjeta que competía de igual a igual con las cuatro
               temporadas y se leía como si fuera una quinta. -->
          <div class="px-4 pt-3 pb-1 flex items-center justify-between gap-3 flex-wrap">
            <span class="text-[11px] font-black text-text-muted uppercase">
              {{ g.occupancy }} {{ g.occupancy === 1 ? 'persona' : 'personas' }}
            </span>
            <div class="flex items-center gap-2">
              <label class="flex items-center gap-1.5" title="Mínimo de noches para poder LLEGAR (min stay arrival): se exige el día del check-in">
                <span class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Mín. al llegar</span>
                <input type="number" min="0" inputmode="numeric" v-model.number="g.minStay"
                  class="w-14 px-2 py-1 rounded-lg border-2 border-navy/20 text-xs font-bold text-navy text-right tabular-nums focus:border-navy outline-none" />
              </label>
              <label class="flex items-center gap-1.5" title="Tope de noches para una estadía que empieza en estos días">
                <span class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Días máx.</span>
                <input type="number" min="0" inputmode="numeric" v-model.number="g.maxStay"
                  class="w-14 px-2 py-1 rounded-lg border-2 border-navy/20 text-xs font-bold text-navy text-right tabular-nums focus:border-navy outline-none" />
              </label>
            </div>
          </div>
          <div class="p-3 pt-2">
            <!-- Temporadas: 2 columnas en móvil, 4 en desktop -->
            <div class="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
              <div v-for="cell in g.cells" :key="cell.season"
                class="rounded-xl border-2 overflow-hidden flex flex-col transition-opacity"
                :class="seasonState(cell.season).publishes ? 'border-navy' : 'border-navy/25 opacity-60'">
                <div class="px-2.5 py-1.5 flex items-center justify-between gap-1.5" :style="{ background: seasonColor(cell.season) }">
                  <span class="text-[10px] font-black uppercase text-white truncate">{{ seasonLabel(cell.season) }}</span>
                  <span v-if="seasonState(cell.season).live"
                    class="shrink-0 px-1.5 py-0.5 rounded-full bg-white text-[8px] font-black uppercase tracking-wide text-navy">Vigente hoy</span>
                  <span v-else class="shrink-0 text-[9px] font-bold text-white/80 whitespace-nowrap">{{ seasonState(cell.season).badge }}</span>
                </div>
                <!-- Lo que el push saltea: sin esto, el % se escribe y no llega nunca al canal. -->
                <div v-if="seasonState(cell.season).reason"
                  class="px-2.5 py-1.5 bg-coral/10 border-b-2 border-coral/20 flex flex-col gap-0.5">
                  <span class="text-[9px] font-black text-coral leading-tight">⚠ {{ seasonState(cell.season).reason }}</span>
                  <button @click="openSeasonsModal"
                    class="self-start text-[9px] font-bold text-navy underline underline-offset-2 hover:text-cyan cursor-pointer">
                    Definir fechas →
                  </button>
                </div>
                <div class="p-2.5 flex flex-col gap-1.5 flex-1">
                  <div class="flex items-center gap-1">
                    <span class="text-xs font-black text-navy">+</span>
                    <input type="number" step="1" inputmode="decimal" v-model.number="cell.percentage"
                      class="w-full min-w-0 px-2 py-1.5 rounded-lg border-2 border-navy/30 text-sm font-black text-navy text-right focus:border-navy outline-none" />
                    <span class="text-xs text-text-muted">%</span>
                  </div>
                  <!-- Se deriva del base del TIPO (el número grande de arriba), no del que traiga la
                       fila: son el mismo dato y mostrar dos fuentes distintas es justo lo que hacía
                       que el editor anunciara un precio y la OTA publicara otro. -->
                  <div class="text-sm font-black text-teal">= {{ resultPrice(tc.basePrice, cell.percentage) }} <span class="text-[10px] text-text-muted">{{ currency }}</span></div>
                  <!-- Restricciones de la temporada: CTA/CTD + estadía mínima through (P4 certificación) -->
                  <div class="flex items-center gap-1">
                    <button @click="cell.cta = cell.cta ? 0 : 1" title="Cerrado a llegadas (CTA): no se puede llegar este día"
                      class="flex-1 py-1 text-[9px] font-black rounded-lg border-2 transition-colors cursor-pointer"
                      :class="cell.cta ? 'bg-coral border-coral text-white' : 'border-navy/30 text-text-secondary hover:border-coral hover:text-coral'">CTA</button>
                    <button @click="cell.ctd = cell.ctd ? 0 : 1" title="Cerrado a salidas (CTD): no se puede salir este día"
                      class="flex-1 py-1 text-[9px] font-black rounded-lg border-2 transition-colors cursor-pointer"
                      :class="cell.ctd ? 'bg-coral border-coral text-white' : 'border-navy/30 text-text-secondary hover:border-coral hover:text-coral'">CTD</button>
                  </div>
                  <div class="flex items-center gap-1" title="Mínimo de noches para estadías que ATRAVIESAN estos días (min stay through), aunque la llegada sea anterior">
                    <span class="text-[9px] text-text-muted shrink-0">Mín. en estadía</span>
                    <input type="number" min="0" inputmode="numeric" v-model.number="cell.minStayThrough"
                      class="w-full min-w-0 px-1.5 py-1 rounded-lg border-2 border-navy/30 text-[11px] font-bold text-navy text-right focus:border-navy outline-none" />
                  </div>
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
import { seasonState as computeSeasonState, type SeasonState } from '@/utils/season-state'

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

interface Cell { season: string; percentage: number; closed: number; cta: number; ctd: number; minStayThrough: number }
interface Group { key: string; roomType: string; occupancy: number; basePrice: number; minStay: number; maxStay: number; cells: Cell[] }
const groups = ref<Group[]>([])

/**
 * Tarjetas POR TIPO DE HABITACIÓN: agrupa las combinaciones tipo×ocupación bajo un
 * encabezado por tipo ("Triple" con 1/2/3 pers. adentro) en vez de una card suelta por
 * cada una — con varios tipos × varias ocupaciones la lista se hacía etérea y repetía el
 * nombre del tipo en cada card. Solo presentación: `groups` sigue siendo la fuente que
 * se edita y la que `toFlatRows()` expande para guardar.
 */
const typeCards = computed<Array<{ roomType: string; groups: Group[]; basePrice: number }>>(() => {
  const byType = new Map<string, Group[]>()
  for (const g of groups.value) {
    const list = byType.get(g.roomType)
    if (list) list.push(g)
    else byType.set(g.roomType, [g])
  }
  // El base es uno solo por tipo (el backend lo deriva de la habitación), así que alcanza con el
  // primer grupo no-cero. Se toma el primero positivo y no el del grupo [0] por si una ocupación
  // quedara sin fila cargada.
  return [...byType.entries()].map(([roomType, gs]) => ({
    roomType, groups: gs, basePrice: gs.find((g) => g.basePrice > 0)?.basePrice ?? 0,
  }))
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

// ── Qué temporadas llegan realmente al canal ──────────────────────────────────
// Espeja la regla del backend (`canales/usecases/channex.ts:487,501`): una temporada se publica si
// tiene fechas propias que no terminaron, o si está pintada en el planning a futuro. Si no, el push
// la saltea y lo único que cubre esos días es la línea base, que va con `percentage: 0`. Sin esta
// señal, escribir un % en una temporada muerta no hacía nada y la pantalla no lo decía.
const assignedFuture = ref<Set<string>>(new Set())
const todayISO = new Date().toISOString().slice(0, 10)

/**
 * Estado de publicación por temporada. La regla vive en `utils/season-state.ts` (testeada ahí).
 * Precalculado en un mapa: el template lo consulta varias veces por celda y resolverlo con un
 * `find` en cada lectura recorre el catálogo entero en cada render.
 */
const seasonStates = computed<Map<string, SeasonState>>(() => {
  const m = new Map<string, SeasonState>()
  for (const s of seasons.value) m.set(s.name, computeSeasonState(s, todayISO, assignedFuture.value))
  return m
})
const UNKNOWN_SEASON: SeasonState = { publishes: false, live: false, badge: 'Sin fechas', reason: 'Sin fechas · no se publica' }
function seasonState(name: string): SeasonState {
  return seasonStates.value.get(name) ?? UNKNOWN_SEASON
}

async function loadSeasonAssignments() {
  try {
    const to = new Date(Date.now() + 500 * 86400000).toISOString().slice(0, 10)
    const r = await HotelService.seasonAssignments(todayISO, to)
    assignedFuture.value = new Set((r.data || []).map((a) => a.season))
  } catch { assignedFuture.value = new Set() }
}

// Agrupa las filas planas (una por roomType×occupancy×season) en tarjetas por habitación.
// `restrictions` (CTA/CTD/through por roomType×season) se mergea en las celdas — P4 certificación.
function buildGroups(rates: RoomRate[], restrictions: Array<{ roomType: string; season: string; cta?: number; ctd?: number; closedToArrival?: number; closedToDeparture?: number; minStayThrough?: number }> = []): Group[] {
  const restrictionBy = new Map(restrictions.map((r) => [`${r.roomType.toLowerCase()}|${r.season}`, r]))
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
    const restriction = restrictionBy.get(`${String(r.roomType).toLowerCase()}|${r.season}`)
    g.cells.push({
      season: r.season, percentage: r.percentage ?? 0, closed: r.closed ? 1 : 0,
      cta: (restriction && (restriction.closedToArrival || restriction.cta)) ? 1 : 0,
      ctd: (restriction && (restriction.closedToDeparture || restriction.ctd)) ? 1 : 0,
      minStayThrough: restriction?.minStayThrough ?? 0,
    })
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
    const [r, restrictions] = await Promise.all([
      HotelService.rates(selectedChannel.value),
      HotelService.rateRestrictions().catch(() => ({ data: [] })),
      loadSeasonAssignments(),
    ])
    groups.value = buildGroups(r.data || [], restrictions.data || [])
  } catch { toast.error('Error al cargar tarifas') } finally { loading.value = false }
}

async function save(): Promise<boolean> {
  if (!selectedChannel.value) return false
  saving.value = true
  try {
    // Expande las tarjetas a filas planas: una por (roomType, occupancy, season), con la base/estadías
    // de la habitación repetidas en cada temporada.
    const rates: Partial<RoomRate>[] = []
    // Restricciones CTA/CTD/through: una por (roomType, season) — sin duplicar por ocupación.
    const restrictions = new Map<string, { roomType: string; season: string; closedToArrival: number; closedToDeparture: number; minStayThrough: number }>()
    for (const g of groups.value) {
      for (const cell of g.cells) {
        rates.push({
          roomType: g.roomType, occupancy: g.occupancy, season: cell.season, channel: selectedChannel.value,
          basePrice: g.basePrice, percentage: cell.percentage, closed: cell.closed, minStay: g.minStay, maxStay: g.maxStay,
        })
        restrictions.set(`${g.roomType}|${cell.season}`, {
          roomType: g.roomType, season: cell.season,
          closedToArrival: cell.cta, closedToDeparture: cell.ctd, minStayThrough: cell.minStayThrough,
        })
      }
    }
    await HotelService.saveRates(rates)
    await HotelService.saveRateRestrictions([...restrictions.values()])
    await loadRates()
    return true
  } catch {
    toast.error('Error al guardar tarifas')
    return false
  } finally { saving.value = false }
}

/**
 * Guardar y publicar en una sola acción.
 *
 * `PUT /api/rates` ya dispara el push por evento (`pricing/service.ts:110` → `pricing-canales.ts`),
 * pero ese camino es silencioso: si una temporada no se puede publicar —sin fechas, ya terminada,
 * sin rate plan— nadie se entera. Se vuelve a pedir el push explícito para poder mostrar el motivo.
 */
async function saveAndPush() {
  if (!(await save())) return
  await pushToChannex()
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
    // Los mensajes separan las dos mitades del botón: lo guardado ya está guardado aunque el
    // envío falle, y callarlo dejaba al usuario sin saber si tenía que volver a cargar todo.
    if (r.pushed > 0) {
      // Éxito parcial: se avisa igual, con nombre y apellido de lo que quedó afuera.
      if (reasons) toast.warning(`Guardado. Se enviaron ${r.pushed} tarifa(s); ${r.skipped} no: ${reasons}`)
      else toast.success(`Guardado y enviado: ${r.pushed} tarifa(s)`)
    } else if (r.notConnected) {
      toast.warning('Guardado. El hotel todavía no está sincronizado con los canales: sincronizá la propiedad antes de enviar tarifas')
    } else if (reasons) {
      toast.warning(`Guardado, pero no se publicó ninguna tarifa: ${reasons}`)
    } else {
      toast.warning('Guardado. No hay tarifas para publicar en este canal')
    }
  } catch {
    toast.error('Se guardó, pero no se pudo enviar a Canales')
  } finally { pushing.value = false }
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
  await loadSeasons()
  await loadRates()
})
</script>
