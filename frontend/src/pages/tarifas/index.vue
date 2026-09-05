<template>
  <div>
    <!-- Loading skeleton -->
    <div v-if="loading" class="space-y-6">
      <div class="h-6 w-56 bg-surface rounded-lg animate-pulse mb-6"></div>
      <div class="rounded-2xl border border-border bg-white shadow-(--shadow-card) overflow-hidden">
        <div class="h-14 bg-navy animate-pulse"></div>
        <div class="grid md:grid-cols-4 gap-4 p-5">
          <div v-for="i in 4" :key="i" class="h-32 bg-surface rounded-xl animate-pulse"></div>
        </div>
      </div>
      <div class="rounded-2xl border border-border bg-white shadow-(--shadow-card) overflow-hidden">
        <div class="h-14 bg-navy animate-pulse"></div>
        <div class="p-5"><div class="h-64 w-full bg-surface rounded-xl animate-pulse"></div></div>
      </div>
    </div>

    <!-- Page content -->
    <div v-else class="space-y-6">
      <div>
        <h2 class="text-xl font-black text-navy">Temporadas y Tarifas</h2>
        <p class="text-sm text-text-muted mt-0.5">Precio base por tipo de habitación y ajuste porcentual por temporada</p>
      </div>

      <!-- Sin un rango de fechas guardado el motor no sabe qué temporada aplicarle a una reserva:
           no es una lista vacía, es el tarifado parado. Por eso va como alerta y no como cartel. -->
      <SetupAlert
        v-if="!hasDatedSeason"
        title="El motor de tarifas todavía no puede calcular precios"
        message="Ninguna temporada tiene fechas de inicio y fin. Sin ese rango el sistema no sabe qué tarifa corresponde a cada reserva. Completá al menos una temporada y guardá."
      >
        <template v-if="canEditRates" #action>
          <button
            @click="focusFirstSeasonDate"
            class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer"
          >
            Definir fechas de temporada
          </button>
        </template>
      </SetupAlert>

      <SectionCard title="Temporadas" subtitle="Definí el rango de fechas de cada una y cuál está activa">
        <div class="grid md:grid-cols-4 gap-4">
          <div v-for="(s, i) in seasonsList" :key="i" class="bg-surface rounded-xl p-4"
            :class="s.active ? 'ring-2 ring-cyan' : ''">
            <div class="flex items-center gap-2 mb-3">
              <div class="w-4 h-4 rounded-full" :style="{ backgroundColor: s.color || '#3b82f6' }"></div>
              <span class="text-sm font-bold text-navy">{{ s.label || s.name }}</span>
              <span v-if="s.active" class="ml-auto inline-flex items-center gap-1 rounded-full bg-[#DCFCE7] px-2 py-0.5 text-[9px] font-extrabold uppercase text-[#16A34A]">Activa</span>
            </div>
            <div class="space-y-2">
              <div>
                <label class="text-[10px] font-bold text-text-muted uppercase">Inicio</label>
                <input :id="`temporada-${i}-inicio`" :aria-label="`Inicio de la temporada ${s.name}`" v-model="s.startDate" type="date" class="w-full mt-1 px-3 py-2 rounded-full border border-border text-xs focus:outline-none focus:border-navy" />
              </div>
              <div>
                <label class="text-[10px] font-bold text-text-muted uppercase">Fin</label>
                <input :id="`temporada-${i}-fin`" :aria-label="`Fin de la temporada ${s.name}`" v-model="s.endDate" type="date" class="w-full mt-1 px-3 py-2 rounded-full border border-border text-xs focus:outline-none focus:border-navy" />
              </div>
              <button v-if="!s.active" @click="activateSeason(s.name)" :disabled="activatingSeason"
                class="w-full mt-1 px-3 py-2 rounded-full bg-navy/5 hover:bg-navy text-navy hover:text-white text-[11px] font-bold transition-colors cursor-pointer disabled:opacity-50">
                Activar temporada
              </button>
            </div>
          </div>
        </div>
      </SectionCard>

      <!-- Matriz de Tarifas: filas roomType × occupancy, columnas seasons -->
      <SectionCard title="Matriz de Tarifas" :subtitle="`${roomTypes.length} tipo(s) de habitación`" body-class="p-0">
        <template #actions>
          <button @click="copyRatesNextYear" :disabled="copying"
            class="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-bold text-white hover:bg-white/20 transition-colors cursor-pointer disabled:opacity-50">
            {{ copying ? 'Copiando...' : 'Copiar al próximo año' }}
          </button>
          <button @click="saveRates" :disabled="savingRates"
            class="rounded-full bg-cyan px-4 py-2 text-xs font-bold text-navy hover:shadow-lg transition-all cursor-pointer disabled:opacity-50">
            {{ savingRates ? 'Guardando...' : 'Guardar' }}
          </button>
        </template>

        <div class="overflow-auto max-h-[70vh]">
          <table class="w-full border-collapse text-sm" style="min-width: 560px">
            <thead>
              <tr>
                <th class="sticky top-0 left-0 z-30 bg-navy text-white px-4 py-3 text-left font-extrabold whitespace-nowrap">
                  Tipo / Ocupación
                </th>
                <th v-for="s in seasonsList" :key="s.name"
                  class="sticky top-0 z-20 px-3 py-3 text-center font-extrabold text-white whitespace-nowrap"
                  style="min-width: 130px" :style="{ backgroundColor: s.color }">
                  {{ s.label || s.name }}
                </th>
              </tr>
            </thead>
            <tbody>
              <template v-for="roomType in roomTypes" :key="roomType">
                <!-- Fila separadora de grupo: nombre + precio base editable -->
                <tr class="border-t-2" style="border-color: rgba(13, 43, 78, 0.3)">
                  <td :colspan="seasonsList.length + 1" class="bg-surface px-4 py-2.5">
                    <div class="flex items-center gap-3 flex-wrap">
                      <div class="w-8 h-8 rounded-full bg-gradient-to-br from-navy to-cyan flex items-center justify-center text-white text-xs font-bold">
                        {{ roomType.charAt(0).toUpperCase() }}
                      </div>
                      <span class="font-extrabold text-navy capitalize">{{ roomType }}</span>
                      <label class="flex items-center gap-2 ml-auto text-[10px] font-bold text-text-muted uppercase">
                        <span class="normal-case text-[11px] text-text-muted font-semibold">
                          Precio base — uno solo; las temporadas y los canales le aplican su porcentaje
                        </span>
                        $
                        <input :aria-label="`Precio base de ${roomType}`" :value="getBasePrice(roomType)" @input="setBasePrice(roomType, $event)" type="number" min="0"
                          class="w-24 px-3 py-1.5 rounded-full border border-border text-sm font-bold text-navy focus:outline-none focus:border-cyan" />
                      </label>
                    </div>
                  </td>
                </tr>
                <!-- Filas por ocupación -->
                <tr v-for="occ in getOccupancies(roomType)" :key="occ" class="border-t border-border">
                  <td class="sticky left-0 z-10 bg-white px-4 py-2 text-xs font-bold text-text-muted whitespace-nowrap">
                    {{ occ }} huésped{{ occ > 1 ? 'es' : '' }}
                  </td>
                  <td v-for="s in seasonsList" :key="s.name" class="px-2 py-2 text-center align-top"
                    :class="isCellClosed(roomType, occ, s.name) ? 'opacity-60' : ''"
                    :style="!isCellClosed(roomType, occ, s.name) ? { backgroundColor: s.color + '0D' } : { backgroundColor: 'rgba(239,68,68,0.12)' }">
                    <div class="flex flex-col items-center gap-1">
                      <div class="flex items-center gap-1">
                        <span class="text-xs font-black" :style="{ color: s.color }">+</span>
                        <input :aria-label="`Recargo % de ${roomType}, ${occ} huésped(es), temporada ${s.name}`" :value="getPercentage(roomType, occ, s.name)" @input="setPercentage(roomType, occ, s.name, $event)"
                          type="number" min="0" max="500" step="0.5"
                          class="w-14 px-2 py-1 rounded-full border border-border text-sm font-bold text-navy text-right focus:outline-none focus:border-cyan" />
                        <span class="text-xs font-bold text-text-muted">%</span>
                      </div>
                      <div class="text-xs font-extrabold text-navy">= ${{ getCalculatedPrice(roomType, occ, s.name) }}</div>
                      <button @click="toggleClosed(roomType, occ, s.name)"
                        class="text-[10px] font-bold px-2 py-0.5 rounded-md transition-colors cursor-pointer"
                        :class="isCellClosed(roomType, occ, s.name) ? 'bg-red-100 text-red-600 hover:bg-red-200' : 'bg-surface text-text-muted hover:bg-surface-dark'">
                        {{ isCellClosed(roomType, occ, s.name) ? 'Cerrado' : 'Abierto' }}
                      </button>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
          <EmptyState v-if="roomTypes.length === 0" title="No hay tarifas configuradas"
            message="La matriz se arma con los tipos de habitación del hotel. Creá al menos una habitación con su tipo para poder cargar precios.">
            <template v-if="canCreateRooms" #action>
              <router-link
                to="/panel/config/habitaciones"
                class="inline-flex rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-colors"
              >
                Crear habitaciones
              </router-link>
            </template>
          </EmptyState>
        </div>

        <p class="px-5 pb-4 text-[11px] text-text-muted">
          Cada celda aplica un % sobre el precio base del tipo de habitación. Precio final = base × (1 + % / 100).
        </p>
      </SectionCard>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import SetupAlert from '@/components/ui/SetupAlert.vue'
import { HotelService } from '@/services/Hotel.service'
import { useToast } from '@/composables/useToast'
import { usePermissions } from '@/composables/usePermissions'

const toast = useToast()
const { can } = usePermissions()
// Guardar temporadas/tarifas es `settings:edit` (backend: modules/pricing/index.ts, ratesGuard).
// Crear habitaciones es `rooms:create`. Sin el permiso el CTA no se muestra: ofrecerlo termina en 403.
const canEditRates = computed(() => can('settings', 'edit'))
const canCreateRooms = computed(() => can('rooms', 'create'))
const loading = ref(true)

// Seasons & Rates
const seasonsList = ref<any[]>([])
const ratesMatrix = ref<any[]>([])

// El hotel tarifa SIEMPRE por persona: la matriz abre una fila por cada ocupación 1..capacidad de
// cada tipo. Existió un switch "Por habitación / Por huésped" y se sacó — ver la nota del
// encabezado de `backend/src/modules/pricing/usecases/pricing-queries.ts`.

async function loadRates() {
  const rt = await HotelService.rates().catch(() => ({ data: [] }))
  rebuildMatrix(rt.data || [])
}


// Cuando el backend no devuelve temporadas, la vista precarga 4 plantillas SIN fechas (ver
// onMounted). Se ven como si estuvieran configuradas, pero no lo están: la condición real de
// "puedo tarifar" es que alguna temporada tenga inicio Y fin.
const hasDatedSeason = computed(() => seasonsList.value.some((s) => !!s.startDate && !!s.endDate))

/** Primer paso concreto: llevar al usuario al campo de fecha que falta (ya existe en esta vista). */
function focusFirstSeasonDate() {
  const el = document.getElementById('temporada-0-inicio') as HTMLInputElement | null
  if (!el) return
  el.scrollIntoView({ block: 'center' })
  el.focus()
}

onMounted(async () => {
  try {
    const seas = await HotelService.seasons().catch(() => ({ data: [] }))
    if (seas.data.length === 0) {
      seasonsList.value = [
        { name: 'baja', label: 'Baja', startDate: '', endDate: '', color: '#3b82f6', sortOrder: 0, active: 1 },
        { name: 'media', label: 'Media', startDate: '', endDate: '', color: '#f59e0b', sortOrder: 1, active: 0 },
        { name: 'alta', label: 'Alta', startDate: '', endDate: '', color: '#ef4444', sortOrder: 2, active: 0 },
        { name: 'especial', label: 'Especial', startDate: '', endDate: '', color: '#8b5cf6', sortOrder: 3, active: 0 },
      ]
    } else {
      seasonsList.value = seas.data
    }

    await loadRates()
  } catch {
    toast.error('Error al cargar tarifas')
  } finally {
    loading.value = false
    await nextTick()
  }
})

function rebuildMatrix(ratesData: any[]) {
  const roomMap = new Map<string, Set<number>>()
  for (const r of ratesData) {
    if (!roomMap.has(r.roomType)) roomMap.set(r.roomType, new Set())
    roomMap.get(r.roomType)!.add(r.occupancy)
  }
  const matrix: any[] = []
  for (const [roomType, occs] of roomMap) {
    for (const occ of [...occs].sort()) {
      const prices: Record<string, number> = {}
      const basePrices: Record<string, number> = {}
      const percentages: Record<string, number> = {}
      const closedCells: Record<string, boolean> = {}
      for (const s of seasonsList.value) {
        const existing = ratesData.find((r: any) => r.roomType === roomType && r.occupancy === occ && r.season === s.name)
        prices[s.name] = existing ? existing.price : 0
        basePrices[s.name] = existing?.basePrice ?? 0
        percentages[s.name] = existing?.percentage ?? 0
        closedCells[s.name] = existing?.closed === 1 || existing?.closed === true
      }
      matrix.push({ roomType, occupancy: occ, prices, basePrices, percentages, closedCells })
    }
  }
  ratesMatrix.value = matrix
}

// ════════════════════════════════════════════════════════════════════════════
// Tarifas estilo MisterPlan — precio base + % por temporada
// ════════════════════════════════════════════════════════════════════════════
const savingRates = ref(false)
const roomTypes = computed(() => [...new Set(ratesMatrix.value.map(r => r.roomType))])

// FIX (revisión Tarea 2, 2026-08-20): buscaba SIEMPRE la fila de occupancy===1. En modo
// 'per_room' (Configuración B, la que activa listBaseRates() cuando el hotel todavía no
// guardó tarifas) se genera UNA sola fila por tipo en occupancy=capacity, no en 1 — con
// capacidad > 1 (el caso común) esto devolvía 0 y el input "Precio Base $" mostraba $0
// aunque la fila de abajo mostrara el precio real. Usar la ocupación MÍNIMA generada para
// ese tipo funciona igual en per_person (min = 1, mismo resultado de antes) y en per_room.
function getBasePrice(roomType: string): number {
  const rows = ratesMatrix.value.filter(r => r.roomType === roomType)
  if (rows.length === 0) return 0
  const row = rows.reduce((min, r) => (r.occupancy < min.occupancy ? r : min))
  return row.basePrices?.[seasonsList.value[0]?.name] ?? 0
}

function setBasePrice(roomType: string, event: Event) {
  const val = Number((event.target as HTMLInputElement).value) || 0
  for (const row of ratesMatrix.value) {
    if (row.roomType === roomType) {
      for (const s of seasonsList.value) {
        row.basePrices[s.name] = val
        const pct = row.percentages[s.name] ?? 0
        row.prices[s.name] = Math.round(val * (1 + pct / 100) * 100) / 100
      }
    }
  }
}

function getPercentage(roomType: string, occupancy: number, season: string): number {
  const row = ratesMatrix.value.find(r => r.roomType === roomType && r.occupancy === occupancy)
  return row?.percentages?.[season] ?? 0
}

function setPercentage(roomType: string, occupancy: number, season: string, event: Event) {
  const val = Number((event.target as HTMLInputElement).value) || 0
  const row = ratesMatrix.value.find(r => r.roomType === roomType && r.occupancy === occupancy)
  if (row) {
    row.percentages[season] = val
    const base = row.basePrices[season] ?? 0
    row.prices[season] = Math.round(base * (1 + val / 100) * 100) / 100
  }
}

function getCalculatedPrice(roomType: string, occupancy: number, season: string): number {
  const row = ratesMatrix.value.find(r => r.roomType === roomType && r.occupancy === occupancy)
  return row?.prices?.[season] ?? 0
}

function isCellClosed(roomType: string, occupancy: number, season: string): boolean {
  const row = ratesMatrix.value.find(r => r.roomType === roomType && r.occupancy === occupancy)
  return row?.closedCells?.[season] ?? false
}

function toggleClosed(roomType: string, occupancy: number, season: string) {
  const row = ratesMatrix.value.find(r => r.roomType === roomType && r.occupancy === occupancy)
  if (row) {
    row.closedCells[season] = !row.closedCells[season]
  }
}

function getOccupancies(roomType: string): number[] {
  const occs = new Set<number>()
  for (const r of ratesMatrix.value) {
    if (r.roomType === roomType) occs.add(r.occupancy)
  }
  return [...occs].sort()
}

function buildRatesPayload() {
  const rates: any[] = []
  for (const row of ratesMatrix.value) {
    for (const s of seasonsList.value) {
      rates.push({
        roomType: row.roomType,
        occupancy: row.occupancy,
        season: s.name,
        basePrice: row.basePrices?.[s.name] ?? 0,
        percentage: row.percentages?.[s.name] ?? 0,
        price: row.prices?.[s.name] ?? 0,
        closed: row.closedCells?.[s.name] ?? false,
      })
    }
  }
  return rates
}

/** Un precio base por TIPO de habitación — no por temporada ni por ocupación. El backend lo escribe
 *  en las habitaciones de ese tipo y de ahí lo deriva todo lo demás (ver backend
 *  `pricing/usecases/base-price.ts`). Se manda el valor que muestra el input, que es el del grupo. */
function buildBasePricesPayload(): Array<{ roomType: string; basePrice: number }> {
  const out: Array<{ roomType: string; basePrice: number }> = []
  for (const type of roomTypes.value) {
    const base = getBasePrice(type)
    if (base > 0) out.push({ roomType: type, basePrice: base })
  }
  return out
}

const copying = ref(false)
async function copyRatesNextYear() {
  if (copying.value) return
  copying.value = true
  try {
    const r = await HotelService.copyRatesNextYear()
    toast.success(`${r.copied} tarifa(s) copiadas al próximo año`)
    const rt = await HotelService.rates()
    rebuildMatrix(rt.data || [])
  } catch {
    toast.error('Error al copiar tarifas')
  } finally {
    copying.value = false
  }
}

async function saveRates() {
  if (savingRates.value) return
  savingRates.value = true
  try {
    const seasons = seasonsList.value.map((s, i) => ({
      name: s.name, label: s.label, startDate: s.startDate, endDate: s.endDate,
      color: s.color, sortOrder: i, active: s.active ? 1 : 0,
    }))
    await HotelService.saveSeasons(seasons)
    await HotelService.saveRates(buildRatesPayload(), buildBasePricesPayload())
    toast.success('Tarifas guardadas')
  } catch {
    toast.error('Error al guardar tarifas')
  } finally {
    savingRates.value = false
  }
}

const activatingSeason = ref(false)
async function activateSeason(name: string) {
  if (activatingSeason.value) return
  activatingSeason.value = true
  try {
    const res = await HotelService.activateSeason(name)
    // Reflejar la nueva activa (el backend deja una sola). Fallback: marcar localmente.
    if (res?.data?.length) seasonsList.value = res.data
    else seasonsList.value.forEach((s) => (s.active = s.name === name ? 1 : 0))
    toast.success(`Temporada activa: ${name}`)
  } catch {
    toast.error('No se pudo cambiar la temporada activa')
  } finally {
    activatingSeason.value = false
  }
}
</script>
