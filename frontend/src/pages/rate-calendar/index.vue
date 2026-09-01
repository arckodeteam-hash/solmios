<script setup lang="ts">
// /panel/config/tarifas-fecha — Tarifas y restricciones por FECHA.
//
// La matriz de /panel/config/tarifas define la REGLA (precio base por tipo + ajuste % por
// temporada). Esta vista define la EXCEPCIÓN: "este tipo, este plan, estos días, este precio".
// Es la capa más específica de la cadena de precio y la que se publica a las OTAs como delta —
// un guardado, una sola llamada al channel manager, sin importar cuántas celdas se tocaron.
//
// Dos formas de editar, a propósito:
//  - escribir directo en una celda → override de UN día (el caso "subime el 24 de diciembre");
//  - "Editar un rango" → override de un tramo entero en una sola fila (el caso "toda la
//    temporada de invierno"), que además es lo que evita mandar 180 entries por un semestre.
import { ref, computed, onMounted } from 'vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppModal from '@/components/ui/AppModal.vue'
import { HotelService, type RatePlan, type RateOverride, type RateOverrideInput } from '@/services/Hotel.service'
import { useToast } from '@/composables/useToast'
import { usePermissions } from '@/composables/usePermissions'

const toast = useToast()
const { can } = usePermissions()
// Mismo permiso que la matriz de temporadas (backend: modules/pricing/index.ts, ratesGuard).
const canEdit = computed(() => can('settings', 'edit'))

const loading = ref(true)
const saving = ref(false)
const roomTypes = ref<string[]>([])
const ratePlans = ref<RatePlan[]>([])
const overrides = ref<RateOverride[]>([])

// ── Ventana de fechas visible ────────────────────────────────────────────────────────────────
const WINDOW_OPTIONS = [14, 30, 60] as const
const windowStart = ref(todayISO())
const windowDays = ref<number>(14)

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

const visibleDates = computed(() =>
  Array.from({ length: windowDays.value }, (_, i) => addDays(windowStart.value, i)))

const windowEnd = computed(() => visibleDates.value[visibleDates.value.length - 1] ?? windowStart.value)

function shiftWindow(direction: -1 | 1) {
  const next = addDays(windowStart.value, direction * windowDays.value)
  // No se puede tarifar el pasado: el channel manager rechaza fechas anteriores a hoy.
  windowStart.value = next < todayISO() ? todayISO() : next
  void load()
}

/** Etiqueta corta de la columna: "lun 22/11". El fin de semana se resalta en la grilla. */
function dayLabel(date: string): { weekday: string; day: string } {
  const d = new Date(`${date}T00:00:00Z`)
  const weekday = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'][d.getUTCDay()] ?? ''
  return { weekday, day: `${d.getUTCDate()}/${d.getUTCMonth() + 1}` }
}

function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  return day === 0 || day === 6
}

// ── Ediciones pendientes ─────────────────────────────────────────────────────────────────────
// Clave `roomType|ratePlan|dateFrom|dateTo`: la misma con la que el backend hace el upsert, así
// tocar dos veces la misma celda no genera dos filas.
const pending = ref(new Map<string, RateOverrideInput>())
const dirty = computed(() => pending.value.size > 0)

const keyOf = (o: { roomType: string; ratePlan: string; dateFrom: string; dateTo?: string }) =>
  `${o.roomType}|${o.ratePlan}|${o.dateFrom}|${o.dateTo || o.dateFrom}`

/** Override guardado que aplica a una fecha. Gana el más específico (el rango más corto). */
function savedFor(roomType: string, ratePlan: string, date: string): RateOverride | null {
  const hits = overrides.value.filter((o) =>
    o.roomType.toLowerCase() === roomType.toLowerCase() &&
    o.ratePlan.toLowerCase() === ratePlan.toLowerCase() &&
    o.dateFrom <= date && o.dateTo >= date)
  if (!hits.length) return null
  return [...hits].sort((a, b) =>
    (Date.parse(a.dateTo) - Date.parse(a.dateFrom)) - (Date.parse(b.dateTo) - Date.parse(b.dateFrom)))[0]!
}

/** Lo que muestra la celda: primero la edición sin guardar, después lo guardado. */
function cellRate(roomType: string, ratePlan: string, date: string): number | null {
  const edited = pending.value.get(keyOf({ roomType, ratePlan, dateFrom: date }))
  if (edited) return Number(edited.rate) > 0 ? Number(edited.rate) : null
  const saved = savedFor(roomType, ratePlan, date)
  return saved && saved.rate > 0 ? saved.rate : null
}

function cellFlags(roomType: string, ratePlan: string, date: string): RateOverride | null {
  const saved = savedFor(roomType, ratePlan, date)
  return saved && (saved.stopSell || saved.minStay || saved.closedToArrival || saved.closedToDeparture) ? saved : null
}

function isPending(roomType: string, ratePlan: string, date: string): boolean {
  return pending.value.has(keyOf({ roomType, ratePlan, dateFrom: date }))
}

/**
 * Editar una celda. Vacío = borrar el override de ese día (vuelve a la tarifa de temporada);
 * el backend interpreta un override todo en cero como "borralo", así que se manda rate 0.
 */
function editCell(roomType: string, ratePlan: string, date: string, raw: string) {
  const value = Number(String(raw).replace(',', '.'))
  const rate = Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 0
  const saved = savedFor(roomType, ratePlan, date)
  const next = new Map(pending.value)
  next.set(keyOf({ roomType, ratePlan, dateFrom: date }), {
    roomType, ratePlan, dateFrom: date, dateTo: date, rate,
    // Un cambio de precio no debe borrar las restricciones que ya tenía ese día.
    minStay: saved?.minStay ?? 0,
    maxStay: saved?.maxStay ?? 0,
    stopSell: saved?.stopSell ?? 0,
    closedToArrival: saved?.closedToArrival ?? 0,
    closedToDeparture: saved?.closedToDeparture ?? 0,
    minStayThrough: saved?.minStayThrough ?? 0,
  })
  pending.value = next
}

// ── Edición por rango ────────────────────────────────────────────────────────────────────────
const rangeOpen = ref(false)
const rangeForm = ref({
  roomType: '', ratePlan: '', dateFrom: todayISO(), dateTo: todayISO(),
  rate: '', minStay: '', maxStay: '', minStayThrough: '',
  stopSell: false, closedToArrival: false, closedToDeparture: false,
})

function openRange() {
  rangeForm.value = {
    roomType: roomTypes.value[0] ?? '', ratePlan: ratePlans.value[0]?.code ?? '',
    dateFrom: windowStart.value, dateTo: windowStart.value,
    rate: '', minStay: '', maxStay: '', minStayThrough: '',
    stopSell: false, closedToArrival: false, closedToDeparture: false,
  }
  rangeOpen.value = true
}

const rangeValid = computed(() => {
  const f = rangeForm.value
  return !!f.roomType && !!f.ratePlan && !!f.dateFrom && !!f.dateTo && f.dateTo >= f.dateFrom
})

function applyRange() {
  const f = rangeForm.value
  const num = (v: string) => { const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : 0 }
  const next = new Map(pending.value)
  next.set(keyOf(f), {
    roomType: f.roomType, ratePlan: f.ratePlan, dateFrom: f.dateFrom, dateTo: f.dateTo,
    rate: num(f.rate), minStay: num(f.minStay), maxStay: num(f.maxStay), minStayThrough: num(f.minStayThrough),
    stopSell: f.stopSell ? 1 : 0,
    closedToArrival: f.closedToArrival ? 1 : 0,
    closedToDeparture: f.closedToDeparture ? 1 : 0,
  })
  pending.value = next
  rangeOpen.value = false
}

// ── Guardar y descartar ──────────────────────────────────────────────────────────────────────
async function save() {
  if (!dirty.value || saving.value) return
  saving.value = true
  const items = [...pending.value.values()]
  try {
    const res = await HotelService.saveRateOverrides(items)
    pending.value = new Map()
    await load()
    toast.success(
      `${res.saved} tarifa${res.saved === 1 ? '' : 's'} publicada${res.saved === 1 ? '' : 's'}`,
      'Se envió a los canales en una sola actualización.',
    )
  } catch {
    toast.error('No se pudieron guardar las tarifas')
  } finally {
    saving.value = false
  }
}

function discard() {
  pending.value = new Map()
}

async function removeOverride(o: RateOverride) {
  try {
    await HotelService.deleteRateOverride(o.id)
    await load()
    toast.success('Tarifa quitada', 'Esas fechas vuelven al precio de temporada.')
  } catch {
    toast.error('No se pudo quitar la tarifa')
  }
}

// ── Carga ────────────────────────────────────────────────────────────────────────────────────
async function load() {
  const [axes, ovr] = await Promise.all([
    HotelService.ratePlans().catch(() => ({ data: [] as RatePlan[], roomTypes: [] as string[] })),
    HotelService.rateOverrides(windowStart.value, windowEnd.value).catch(() => ({ data: [] as RateOverride[] })),
  ])
  // Tipos REALES del hotel: la matriz de temporadas solo lista los que ya tienen tarifa cargada,
  // y acá hay que poder tarifar cualquier tipo para una fecha.
  roomTypes.value = axes.roomTypes || []
  ratePlans.value = axes.data || []
  overrides.value = ovr.data || []
}

/** Overrides activos ordenados, para la tabla de abajo (incluye los que caen fuera de la ventana). */
const allOverrides = ref<RateOverride[]>([])
async function loadAll() {
  allOverrides.value = (await HotelService.rateOverrides().catch(() => ({ data: [] as RateOverride[] }))).data || []
}

const planLabel = (code: string) => ratePlans.value.find((p) => p.code === code)?.label || code

/** Resumen legible de qué fija un override — la tabla no pinta las dimensiones vacías. */
function overrideSummary(o: RateOverride): string[] {
  const out: string[] = []
  if (o.rate > 0) out.push(`${o.rate.toFixed(2)} USD`)
  if (o.minStay > 0) out.push(`mín. ${o.minStay} noches`)
  if (o.maxStay > 0) out.push(`máx. ${o.maxStay} noches`)
  if (o.minStayThrough > 0) out.push(`mín. pasante ${o.minStayThrough}`)
  if (o.stopSell) out.push('venta cerrada')
  if (o.closedToArrival) out.push('sin llegadas')
  if (o.closedToDeparture) out.push('sin salidas')
  return out
}

const ready = computed(() => roomTypes.value.length > 0 && ratePlans.value.length > 0)

onMounted(async () => {
  await Promise.all([load(), loadAll()])
  loading.value = false
})
</script>

<template>
  <div class="p-4 sm:p-6 max-w-[1600px] mx-auto">
    <header class="mb-6">
      <h1 class="text-2xl font-black text-navy">Tarifas por fecha</h1>
      <p class="text-sm text-text-muted mt-0.5">
        Precio y restricciones para días concretos. Pisan a la tarifa por temporada y se publican a los canales.
      </p>
    </header>

    <div v-if="loading" class="space-y-3">
      <div v-for="i in 4" :key="i" class="h-20 animate-pulse rounded-2xl bg-surface" />
    </div>

    <EmptyState
      v-else-if="!ready"
      title="Todavía no hay habitaciones cargadas"
      message="Creá los tipos de habitación del hotel. Después volvé acá para ponerle precio a días concretos."
    >
      <template #action>
        <router-link to="/panel/config/habitaciones"
          class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white">
          Ir a Habitaciones
        </router-link>
      </template>
    </EmptyState>

    <template v-else>
      <SectionCard title="Calendario de tarifas"
        :subtitle="`${windowStart} → ${windowEnd}`" body-class="p-0">
        <template #actions>
          <input v-model="windowStart" type="date" :min="todayISO()" aria-label="Primer día del calendario"
            class="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs text-white"
            @change="load()" />
          <select v-model.number="windowDays" aria-label="Cantidad de días"
            class="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs text-white"
            @change="load()">
            <option v-for="d in WINDOW_OPTIONS" :key="d" :value="d" class="text-navy">{{ d }} días</option>
          </select>
          <button type="button" aria-label="Días anteriores"
            class="h-8 w-8 grid place-items-center rounded-full border border-white/15 text-white hover:bg-white/10"
            @click="shiftWindow(-1)">‹</button>
          <button type="button" aria-label="Días siguientes"
            class="h-8 w-8 grid place-items-center rounded-full border border-white/15 text-white hover:bg-white/10"
            @click="shiftWindow(1)">›</button>
          <button v-if="canEdit" type="button"
            class="rounded-full border border-white/15 bg-white/10 px-4 py-1.5 text-xs font-bold text-white hover:bg-white/20"
            @click="openRange()">Editar un rango</button>
        </template>

        <div class="overflow-x-auto">
          <table class="w-full tbl-head" :style="{ minWidth: `${260 + windowDays * 76}px` }">
            <thead>
              <tr>
                <th class="sticky left-0 z-10 bg-surface px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wide text-text-muted">
                  Habitación · plan
                </th>
                <th v-for="d in visibleDates" :key="d"
                  class="px-1 py-2 text-center text-[10px] font-bold uppercase tracking-wide"
                  :class="isWeekend(d) ? 'text-cyan' : 'text-text-muted'">
                  <div>{{ dayLabel(d).weekday }}</div>
                  <div class="tabular-nums">{{ dayLabel(d).day }}</div>
                </th>
              </tr>
            </thead>
            <tbody>
              <template v-for="rt in roomTypes" :key="rt">
                <tr>
                  <td :colspan="visibleDates.length + 1" class="bg-surface px-4 py-2 text-xs font-black text-navy capitalize">
                    {{ rt }}
                  </td>
                </tr>
                <tr v-for="plan in ratePlans" :key="`${rt}-${plan.code}`" class="border-t border-border">
                  <td class="sticky left-0 z-10 bg-white px-4 py-2 text-xs font-bold text-text-secondary whitespace-nowrap">
                    {{ plan.label }}
                  </td>
                  <td v-for="d in visibleDates" :key="d" class="px-0.5 py-1 text-center">
                    <input
                      :value="cellRate(rt, plan.code, d) ?? ''"
                      :disabled="!canEdit"
                      type="number" min="0" step="0.01" inputmode="decimal"
                      :aria-label="`Tarifa de ${rt}, ${plan.label}, ${d}`"
                      class="w-[68px] rounded-lg border px-1 py-1.5 text-center text-xs tabular-nums focus:outline-none focus:border-navy disabled:bg-surface"
                      :class="isPending(rt, plan.code, d)
                        ? 'border-cyan bg-cyan/10 font-bold text-navy'
                        : (cellRate(rt, plan.code, d) !== null ? 'border-navy/30 font-bold text-navy' : 'border-border text-text-muted')"
                      placeholder="—"
                      @change="editCell(rt, plan.code, d, ($event.target as HTMLInputElement).value)" />
                    <div v-if="cellFlags(rt, plan.code, d)" class="mt-0.5 text-[9px] font-bold leading-tight">
                      <span v-if="cellFlags(rt, plan.code, d)!.stopSell" class="text-rose">cerrado</span>
                      <span v-else-if="cellFlags(rt, plan.code, d)!.minStay" class="text-text-muted">
                        mín {{ cellFlags(rt, plan.code, d)!.minStay }}
                      </span>
                      <span v-else class="text-text-muted">CTA/CTD</span>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </SectionCard>

      <!-- Barra de guardado: aparece solo cuando hay algo sin publicar. -->
      <div v-if="dirty"
        class="sticky bottom-4 z-20 mt-4 flex items-center justify-between gap-3 rounded-2xl border border-cyan/40 bg-white px-4 py-3 shadow-(--shadow-card)">
        <p class="text-xs text-text-secondary">
          <strong class="text-navy tabular-nums">{{ pending.size }}</strong>
          cambio{{ pending.size === 1 ? '' : 's' }} sin publicar. Se envían a los canales en una sola actualización.
        </p>
        <div class="flex items-center gap-2">
          <button type="button" class="px-4 py-2 text-sm text-text-secondary" @click="discard()">Descartar</button>
          <button type="button" :disabled="saving"
            class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
            @click="save()">{{ saving ? 'Publicando…' : 'Guardar y publicar' }}</button>
        </div>
      </div>

      <SectionCard class="mt-6" title="Tarifas por fecha activas"
        :subtitle="`${allOverrides.length} vigente${allOverrides.length === 1 ? '' : 's'}`" body-class="p-0">
        <EmptyState v-if="!allOverrides.length"
          title="Sin tarifas por fecha"
          message="Todo se cotiza con la tarifa por temporada. Escribí un precio en el calendario o usá “Editar un rango”." />
        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[720px] tbl-head">
            <thead>
              <tr>
                <th class="px-4 py-2.5 text-left">Habitación</th>
                <th class="px-4 py-2.5 text-left">Plan</th>
                <th class="px-4 py-2.5 text-left">Fechas</th>
                <th class="px-4 py-2.5 text-left">Fija</th>
                <th class="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="o in allOverrides" :key="o.id" class="border-t border-border">
                <td class="px-4 py-2.5 text-xs font-bold text-navy capitalize">{{ o.roomType }}</td>
                <td class="px-4 py-2.5 text-xs text-text-secondary">{{ planLabel(o.ratePlan) }}</td>
                <td class="px-4 py-2.5 text-xs tabular-nums text-text-secondary">
                  {{ o.dateFrom }}<span v-if="o.dateTo !== o.dateFrom"> → {{ o.dateTo }}</span>
                </td>
                <td class="px-4 py-2.5 text-xs text-text-secondary">{{ overrideSummary(o).join(' · ') }}</td>
                <td class="px-4 py-2.5 text-right">
                  <button v-if="canEdit" type="button" :aria-label="`Quitar la tarifa de ${o.roomType} del ${o.dateFrom}`"
                    class="h-8 w-8 grid place-items-center rounded-full text-text-muted hover:bg-navy/10 hover:text-navy"
                    @click="removeOverride(o)">✕</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>
    </template>

    <AppModal v-if="rangeOpen" size="lg" title="Editar un rango"
      subtitle="Un tramo entero en una sola tarifa — no un precio por día" @close="rangeOpen = false">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label class="block">
          <span class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Habitación</span>
          <select v-model="rangeForm.roomType" class="mt-1 w-full rounded-full border border-border px-3 py-2 text-sm">
            <option v-for="rt in roomTypes" :key="rt" :value="rt">{{ rt }}</option>
          </select>
        </label>
        <label class="block">
          <span class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Plan</span>
          <select v-model="rangeForm.ratePlan" class="mt-1 w-full rounded-full border border-border px-3 py-2 text-sm">
            <option v-for="p in ratePlans" :key="p.code" :value="p.code">{{ p.label }}</option>
          </select>
        </label>
        <label class="block">
          <span class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Desde</span>
          <input v-model="rangeForm.dateFrom" type="date" :min="todayISO()"
            class="mt-1 w-full rounded-full border border-border px-3 py-2 text-sm" />
        </label>
        <label class="block">
          <span class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Hasta</span>
          <input v-model="rangeForm.dateTo" type="date" :min="rangeForm.dateFrom"
            class="mt-1 w-full rounded-full border border-border px-3 py-2 text-sm" />
        </label>
      </div>

      <p class="mt-5 text-[10px] font-bold uppercase tracking-wide text-text-muted">
        Qué fijar — lo que dejes vacío sigue saliendo de la tarifa por temporada
      </p>
      <div class="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <label class="block">
          <span class="text-[10px] text-text-muted">Tarifa</span>
          <input v-model="rangeForm.rate" type="number" min="0" step="0.01" placeholder="—"
            class="mt-1 w-full rounded-lg border border-border px-2 py-2 text-sm tabular-nums" />
        </label>
        <label class="block">
          <span class="text-[10px] text-text-muted">Estadía mín.</span>
          <input v-model="rangeForm.minStay" type="number" min="0" step="1" placeholder="—"
            class="mt-1 w-full rounded-lg border border-border px-2 py-2 text-sm tabular-nums" />
        </label>
        <label class="block">
          <span class="text-[10px] text-text-muted">Estadía máx.</span>
          <input v-model="rangeForm.maxStay" type="number" min="0" step="1" placeholder="—"
            class="mt-1 w-full rounded-lg border border-border px-2 py-2 text-sm tabular-nums" />
        </label>
        <label class="block">
          <span class="text-[10px] text-text-muted">Mín. pasante</span>
          <input v-model="rangeForm.minStayThrough" type="number" min="0" step="1" placeholder="—"
            class="mt-1 w-full rounded-lg border border-border px-2 py-2 text-sm tabular-nums" />
        </label>
      </div>

      <div class="mt-4 flex flex-wrap gap-4">
        <label class="flex items-center gap-2 text-sm text-text-secondary">
          <input v-model="rangeForm.stopSell" type="checkbox" /> Cerrar ventas
        </label>
        <label class="flex items-center gap-2 text-sm text-text-secondary">
          <input v-model="rangeForm.closedToArrival" type="checkbox" /> Sin llegadas (CTA)
        </label>
        <label class="flex items-center gap-2 text-sm text-text-secondary">
          <input v-model="rangeForm.closedToDeparture" type="checkbox" /> Sin salidas (CTD)
        </label>
      </div>

      <template #footer>
        <button type="button" class="px-4 py-2 text-sm text-text-secondary" @click="rangeOpen = false">Cancelar</button>
        <button type="button" :disabled="!rangeValid"
          class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          @click="applyRange()">Aplicar</button>
      </template>
    </AppModal>
  </div>
</template>
