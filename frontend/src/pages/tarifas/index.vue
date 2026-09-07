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
        <p class="text-sm text-text-muted mt-0.5">Un precio por temporada para cada tipo de habitación</p>
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

      <SectionCard title="Temporadas"
        :subtitle="currentSeasonLabel
          ? `Hoy rige ${currentSeasonLabel} — la temporada sale de estas fechas y de los días marcados en el planning`
          : 'Definí el rango de fechas de cada una. La que rige cada día sale de acá y del planning'">
        <div class="grid md:grid-cols-4 gap-4">
          <!-- "Rige hoy" NO es un botón: sale de la fecha y del planning, la misma regla con la que
               se cobra (`GET /api/season-calendar`). Antes había un botón "Activar temporada" que
               escribía `seasons.active`, un campo que ningún cálculo de precio lee: la tarjeta podía
               decir "Activa: Alta" mientras el motor y las OTAs cobraban Baja, y no había forma de
               notarlo desde la pantalla. Una sola fuente, en las tres vistas. Por eso sigue sin
               haber un botón "activar": no existe un interruptor que cambie la temporada.
               Lo que SÍ cambia la temporada es "Aplicar temporada", que pinta el rango elegido en
               `season_assignments` (`POST /api/season-assignments`). Esa es la tabla que lee
               `buildSeasonByDate` y con ella cotizan el motor público, el reprice, los cargos, la
               disponibilidad y el push a canales: el cambio es real y se ve acá mismo, porque al
               volver se relee `GET /api/season-calendar` y el badge "Rige hoy" se recalcula. -->
          <div v-for="(s, i) in seasonsList" :key="i" class="bg-surface rounded-xl p-4"
            :class="s.name === currentSeason ? 'ring-2 ring-cyan' : ''">
            <div class="flex items-center gap-2 mb-3">
              <div class="w-4 h-4 rounded-full" :style="{ backgroundColor: s.color || '#3b82f6' }"></div>
              <span class="text-sm font-bold text-navy">{{ s.label || s.name }}</span>
              <span v-if="s.name === currentSeason"
                :title="currentSeasonSource === 'planning' ? 'Marcada para hoy en el planning' : 'Hoy cae dentro de su rango de fechas'"
                class="ml-auto inline-flex items-center gap-1 rounded-full bg-[#DCFCE7] px-2 py-0.5 text-[9px] font-extrabold uppercase text-[#16A34A]">Rige hoy</span>
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
              <div v-if="s.name !== currentSeason" class="pt-1 space-y-1.5">
                <!-- Acción principal: aplica la temporada acá mismo, sin salir de la pantalla.
                     Pide `settings:edit` porque es el permiso del endpoint (ratesGuard): ofrecerlo
                     sin permiso termina en 403. -->
                <button v-if="canEditRates" type="button" @click="openApplyDialog(s)"
                  class="block w-full px-3 py-2 rounded-full bg-navy/5 hover:bg-navy text-navy hover:text-white text-[11px] font-bold text-center transition-colors cursor-pointer">
                  Aplicar temporada
                </button>
                <!-- El planning no se va: el diálogo pinta un rango corrido, y para días sueltos
                     (fines de semana, feriados) hace falta el calendario. -->
                <router-link :to="{ name: 'planning' }"
                  class="block text-center text-[10px] font-bold text-text-muted hover:text-navy underline transition-colors">
                  Marcar días sueltos en el planning
                </router-link>
              </div>
            </div>
          </div>
        </div>
      </SectionCard>

      <!-- Diálogo "Aplicar temporada". Va en esta misma pantalla (no es un AppModal teleportado)
           para que aplicar la temporada no obligue a irse a otra vista y volver a buscar la tarjeta:
           el hotel confirma el rango y ve el badge "Rige hoy" moverse en el acto. -->
      <div v-if="applyDlg.show" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-navy/50" @click="applyDlg.show = false"></div>
        <div role="dialog" aria-modal="true" :aria-label="`Aplicar temporada ${applyDlg.label}`"
          class="relative w-full max-w-md rounded-2xl border border-border bg-white p-5 shadow-(--shadow-card)">
          <h3 class="text-base font-black text-navy">Aplicar {{ applyDlg.label }}</h3>
          <p class="mt-1 text-[11px] text-text-muted">
            Los días del rango pasan a cobrarse con esta temporada, en el panel y en todos los canales.
          </p>
          <div class="grid grid-cols-2 gap-3 mt-4">
            <div>
              <label for="aplicar-desde" class="text-[10px] font-bold text-text-muted uppercase">Desde</label>
              <input id="aplicar-desde" v-model="applyDlg.from" type="date" :min="applyDlg.minDate"
                class="w-full mt-1 px-3 py-2 rounded-full border border-border text-xs focus:outline-none focus:border-navy" />
            </div>
            <div>
              <label for="aplicar-hasta" class="text-[10px] font-bold text-text-muted uppercase">Hasta</label>
              <input id="aplicar-hasta" v-model="applyDlg.to" type="date" :min="applyDlg.minDate"
                class="w-full mt-1 px-3 py-2 rounded-full border border-border text-xs focus:outline-none focus:border-navy" />
            </div>
          </div>
          <div class="flex items-center justify-end gap-3 mt-5">
            <button type="button" @click="applyDlg.show = false"
              class="text-xs font-bold text-text-muted hover:text-navy cursor-pointer">Cancelar</button>
            <button id="aplicar-confirmar" type="button" :disabled="applying" @click="confirmApplySeason"
              class="rounded-full bg-cyan px-4 py-2 text-xs font-bold text-navy hover:shadow-lg transition-all cursor-pointer disabled:opacity-50">
              {{ applying ? 'Aplicando...' : 'Aplicar temporada' }}
            </button>
          </div>
        </div>
      </div>

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
                          Precio base — se cobra los días sin temporada asignada
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
                    <!-- El precio de la temporada es un IMPORTE, no un recargo: el hotel piensa en
                         pesos. El porcentaje sigue existiendo, pero es cosa del CANAL, que lo aplica
                         sobre este número (ver backend/src/shared/utils/season-price.ts). -->
                    <div class="flex flex-col items-center gap-1">
                      <div class="flex items-center gap-1">
                        <span class="text-xs font-black" :style="{ color: s.color }">$</span>
                        <input :aria-label="`Precio de ${roomType}, ${occ} huésped(es), temporada ${s.name}`" :value="getSeasonPrice(roomType, occ, s.name)" @input="setSeasonPrice(roomType, occ, s.name, $event)"
                          type="number" min="0" step="1"
                          class="w-20 px-2 py-1 rounded-full border border-border text-sm font-bold text-navy text-right tabular-nums focus:outline-none focus:border-cyan" />
                      </div>
                      <div v-if="priceDeltaLabel(roomType, occ, s.name)" class="text-[10px] font-bold text-text-muted">
                        {{ priceDeltaLabel(roomType, occ, s.name) }}
                      </div>
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
          Cada celda es el precio de esa temporada, en {{ '$' }}. Una celda sin precio propio cobra el precio base
          del tipo. Los canales no fijan importes: le suman su porcentaje a este número, desde
          <router-link :to="{ name: 'channel-manager' }" class="font-bold text-cyan hover:underline">Channel</router-link>.
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
import { proposedApplyRange, applyRangeError } from '@/utils/season-apply'

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

    await Promise.all([loadRates(), loadCurrentSeason()])
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

/**
 * Cambiar el precio base del TIPO no mueve los precios de temporada ya cargados: cada temporada
 * tiene su importe propio, decidido por el hotel. Solo se arrastran las celdas que todavía valen lo
 * mismo que la base (nunca se les puso un precio distinto) y las vacías.
 */
function setBasePrice(roomType: string, event: Event) {
  const val = Number((event.target as HTMLInputElement).value) || 0
  for (const row of ratesMatrix.value) {
    if (row.roomType !== roomType) continue
    for (const s of seasonsList.value) {
      const previousBase = row.basePrices[s.name] ?? 0
      const price = row.prices[s.name] ?? 0
      row.basePrices[s.name] = val
      if (!price || price === previousBase) row.prices[s.name] = val
    }
  }
}

/** El precio de esa temporada, en pesos. Es el dato que el hotel escribe. */
function getSeasonPrice(roomType: string, occupancy: number, season: string): number {
  const row = ratesMatrix.value.find(r => r.roomType === roomType && r.occupancy === occupancy)
  return row?.prices?.[season] ?? 0
}

function setSeasonPrice(roomType: string, occupancy: number, season: string, event: Event) {
  const val = Number((event.target as HTMLInputElement).value) || 0
  const row = ratesMatrix.value.find(r => r.roomType === roomType && r.occupancy === occupancy)
  if (!row) return
  row.prices[season] = val
  // El porcentaje pasa a ser informativo: cuánto se aparta del precio base del tipo. Se sigue
  // mandando para que el backend lo guarde como espejo, pero ya no decide nada.
  const base = row.basePrices[season] ?? 0
  row.percentages[season] = base > 0 ? Math.round((val / base - 1) * 10000) / 100 : 0
}

/** "= precio base" o "+25% sobre la base": ubica el importe sin obligar a hacer la cuenta. */
function priceDeltaLabel(roomType: string, occupancy: number, season: string): string {
  const row = ratesMatrix.value.find(r => r.roomType === roomType && r.occupancy === occupancy)
  const base = row?.basePrices?.[season] ?? 0
  const price = row?.prices?.[season] ?? 0
  if (!base || !price) return ''
  if (price === base) return '= precio base'
  const pct = Math.round((price / base - 1) * 1000) / 10
  return `${pct > 0 ? '+' : ''}${pct}% sobre la base`
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

/**
 * La temporada que RIGE HOY. No es una elección: sale de `GET /api/season-calendar`, que resuelve el
 * rango del catálogo con los días del planning encima — la misma regla con la que cobra el motor y
 * con la que se publica a las OTAs. Ver `backend/src/modules/pricing/usecases/season-calendar.ts`.
 *
 * Reemplaza al viejo botón "Activar temporada", que escribía `seasons.active`: un campo que ningún
 * cálculo de precio lee. Medido en producción el 2026-09-05, esta pantalla decía "Activa: Alta"
 * mientras el motor y el editor de canal cobraban Baja.
 */
const currentSeason = ref('')
const currentSeasonSource = ref('')
const currentSeasonLabel = computed(() => {
  const s = seasonsList.value.find((x) => x.name === currentSeason.value)
  return s ? (s.label || s.name) : ''
})

async function loadCurrentSeason() {
  const today = new Date().toISOString().slice(0, 10)
  try {
    const r = await HotelService.seasonCalendar(today, today)
    const day = (r.data || [])[0]
    currentSeason.value = day?.season || ''
    currentSeasonSource.value = day?.source || ''
  } catch { currentSeason.value = ''; currentSeasonSource.value = '' }
}

/**
 * Aplicar una temporada desde acá = pintar un rango de días en `season_assignments`
 * (`POST /api/season-assignments`), que es lo que el motor lee para cobrar. NO se toca
 * `seasons.active` (`activateSeason`): ese flag no lo mira ningún cálculo de precio y por eso el
 * botón que lo escribía se sacó de esta pantalla.
 *
 * El rango que se propone y su validación viven en `@/utils/season-apply` — el mismo criterio que
 * usa el planning: nunca repintar días pasados, y frenar un rango invertido ANTES del backend
 * (pinta cero días y devuelve OK, así que el hotel se quedaría creyendo que aplicó).
 */
const applyDlg = ref<{ show: boolean; season: string; label: string; from: string; to: string; minDate: string }>({
  show: false, season: '', label: '', from: '', to: '', minDate: '',
})
/**
 * Qué diálogo tiene una llamada en vuelo — no un booleano suelto. Con un `applying` global, cancelar
 * y reabrir con otra temporada dejaba el botón de confirmar deshabilitado por una llamada que ya no
 * era la de este diálogo: el hotel veía un diálogo limpio que no podía confirmar, sin ningún motivo
 * en pantalla, hasta que la llamada vieja terminara.
 */
const applyingFor = ref<object | null>(null)
const applying = computed(() => applyingFor.value !== null && applyingFor.value === applyDlg.value)

function openApplyDialog(s: any) {
  const today = new Date().toISOString().slice(0, 10)
  // Se propone lo que la tarjeta tiene EN PANTALLA (el hotel puede haber editado las fechas sin
  // guardar todavía), recortado contra hoy por `proposedApplyRange`.
  const { from, to } = proposedApplyRange({ startDate: s.startDate, endDate: s.endDate }, today)
  applyDlg.value = { show: true, season: s.name, label: s.label || s.name, from, to, minDate: today }
}

async function confirmApplySeason() {
  const d = applyDlg.value
  if (applyingFor.value === d) return   // doble click sobre ESTE diálogo
  // `todayISO` va sí o sí: el `min` de los inputs es una ayuda del navegador, no una garantía —
  // la fecha se puede tipear igual. Sin este chequeo, confirmar con un rango pasado repinta
  // `season_assignments` de noches ya vendidas y facturadas.
  const err = applyRangeError(d.from, d.to, new Date().toISOString().slice(0, 10))
  if (err) { toast.error(err); return }
  applyingFor.value = d
  try {
    const r = await HotelService.assignSeason({ from: d.from, to: d.to, season: d.season })
    // Cerrar SOLO si sigue abierto el mismo diálogo que se confirmó. `openApplyDialog` reemplaza el
    // objeto entero, así que si el hotel canceló y reabrió con otra temporada mientras la llamada
    // estaba en vuelo, este `false` le cerraría el diálogo nuevo en la cara y le borraría el rango
    // que estaba escribiendo.
    if (applyDlg.value === d) applyDlg.value.show = false
    // Releer la temporada vigente: "Rige hoy" tiene que salir de la misma fuente con la que se
    // cobra, no de lo que acabamos de mandar.
    await loadCurrentSeason()
    toast.success(`Temporada ${d.label} aplicada (${r.count} día/s)`)
  } catch (e: any) {
    // El error nombra la temporada: si el hotel ya cerró este diálogo y abrió otro, un
    // "No se pudo aplicar" pelado se lee como si hubiera fallado lo que tiene en pantalla.
    toast.error(`No se pudo aplicar ${d.label}: ${e?.message || 'error al guardar'}`)
  } finally {
    // Solo si sigue siendo esta llamada la que manda: una anterior que llega tarde no destraba el
    // diálogo que el hotel acaba de confirmar.
    if (applyingFor.value === d) applyingFor.value = null
  }
}
</script>
