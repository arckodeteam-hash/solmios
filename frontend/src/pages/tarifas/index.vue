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
                <input v-model="s.startDate" type="date" class="w-full mt-1 px-3 py-2 rounded-full border border-border text-xs focus:outline-none focus:border-navy" />
              </div>
              <div>
                <label class="text-[10px] font-bold text-text-muted uppercase">Fin</label>
                <input v-model="s.endDate" type="date" class="w-full mt-1 px-3 py-2 rounded-full border border-border text-xs focus:outline-none focus:border-navy" />
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
          <button
            @click="togglePricingMode"
            :disabled="togglingMode"
            :title="pricingMode === 'per_person'
              ? 'El precio sube o baja según cuántos huéspedes se busquen. Cambiar a un precio fijo por habitación.'
              : 'Un solo precio por habitación, sin importar cuántos huéspedes se busquen. Cambiar a precio por cantidad de huéspedes.'"
            class="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-bold text-white hover:bg-white/20 transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"/></svg>
            {{ pricingMode === 'per_person' ? 'Por huésped' : 'Por habitación' }}
          </button>
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
                        Precio Base $
                        <input :value="getBasePrice(roomType)" @input="setBasePrice(roomType, $event)" type="number" min="0"
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
                        <input :value="getPercentage(roomType, occ, s.name)" @input="setPercentage(roomType, occ, s.name, $event)"
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
            message="Creá habitaciones con tipo definido para generar la matriz." />
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
import { HotelService } from '@/services/Hotel.service'
import { useToast } from '@/composables/useToast'

const toast = useToast()
const loading = ref(true)

// Seasons & Rates
const seasonsList = ref<any[]>([])
const ratesMatrix = ref<any[]>([])

// Modo de tarificación (Tarea 2, QA 2026-08-20): 'per_room' = un precio fijo por habitación sin
// importar ocupación; 'per_person' = precio distinto por cantidad de huéspedes (la Configuración A
// del hallazgo). Antes esto solo se podía activar entrando a Channel Manager → un canal OTA ya
// conectado (`ChannelRatesEditor.vue`) — inalcanzable para un hotel sin canales conectados. El
// switch vive acá ahora, en la pantalla donde un hotelero realmente va a configurar tarifas.
const pricingMode = ref<'per_room' | 'per_person'>('per_room')
const togglingMode = ref(false)

async function loadRates() {
  const rt = await HotelService.rates().catch(() => ({ data: [] }))
  rebuildMatrix(rt.data || [])
}

async function togglePricingMode() {
  if (togglingMode.value) return
  togglingMode.value = true
  const next = pricingMode.value === 'per_person' ? 'per_room' : 'per_person'
  try {
    pricingMode.value = (await HotelService.setPricingMode(next)).mode
    // Solo tiene efecto visible si todavía no hay tarifas base guardadas (la grilla derivada
    // se re-arma con la nueva cantidad de filas por ocupación) — si ya hay filas reales,
    // `listRates` las devuelve tal cual y cambiar el modo no las reparte de nuevo (evita perder
    // precios/cierres ya configurados sin que el hotelero lo pida explícitamente).
    await loadRates()
    toast.success(pricingMode.value === 'per_person' ? 'Precio por huésped' : 'Precio por habitación')
  } catch {
    toast.error('No se pudo cambiar el modo de tarificación')
  } finally {
    togglingMode.value = false
  }
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

    pricingMode.value = (await HotelService.pricingMode().catch(() => ({ mode: 'per_room' as const }))).mode
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
    await HotelService.saveRates(buildRatesPayload())
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
