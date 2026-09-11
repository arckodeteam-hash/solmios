<script setup lang="ts">
// restaurante/ReservationPicker.vue — #209: elegir a qué huésped alojado se le carga algo, sin tipear un UUID.
// Buscador por número de habitación (prefijo: "2" lista 201, 204…) o apellido, sobre las reservas
// `checked_in` del hotel más las confirmadas que llegan hoy sin check-in (badge "Sin check-in"), vía
// `RestaurantService.searchInHouse` → GET /restaurant/in-house — va por el restaurante porque el mozo no
// tiene `reservations:view`, y por eso vive en `features/restaurante/`: fuera del POS ese endpoint da 403.
// Lo usan Cobrar (cargo a habitación) y Salón (abrir Room service). Con una elegida muestra la ficha y un
// "Cambiar"; el que la usa decide qué hacer con la selección (v-model). Sin resultados: "No hay huésped
// alojado en 204". No muestra saldo: el buscador no lo necesita y el mozo no tiene por qué verlo.
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { RestaurantService, inHouseStatusLabel, type InHouseReservation } from '@/services/Restaurant.service'

const props = withDefaults(defineProps<{
  modelValue: InHouseReservation | null
  /** Etiqueta del campo (para el id/label accesible). */
  label?: string
  placeholder?: string
  /** Enfoca el buscador al montar (modal). */
  autofocus?: boolean
  disabled?: boolean
}>(), { label: 'Huésped alojado', placeholder: 'Habitación o apellido…', autofocus: false, disabled: false })

const emit = defineEmits<{ 'update:modelValue': [value: InHouseReservation | null] }>()

const DEBOUNCE_MS = 250
const query = ref('')
const results = ref<InHouseReservation[]>([])
// Coincidencias reales del server; si supera a `results`, la lista vino recortada y se avisa.
const total = ref(0)
const searching = ref(false)
const error = ref('')
const searched = ref(false)
const inputEl = ref<HTMLInputElement | null>(null)
const uid = `reservation-picker-${Math.random().toString(36).slice(2, 8)}`
let timer: ReturnType<typeof setTimeout> | null = null
// Cada búsqueda lleva un número: si vuelve una vieja después de una nueva, se descarta (tipeo rápido).
let seq = 0

const selected = computed(() => props.modelValue)
const isNumeric = (s: string) => /^\d+$/.test(s.trim())
const emptyMessage = computed(() => {
  const q = query.value.trim()
  if (!q) return 'No hay huéspedes alojados en este momento.'
  return isNumeric(q) ? `No hay huésped alojado en ${q}.` : `No hay huésped alojado que coincida con «${q}».`
})

/** "Hab. 204 · Pérez, Juan · 2 noches" — lo que ve el mozo en la lista y en la ficha elegida. */
function summary(r: InHouseReservation): string {
  const parts: string[] = []
  if (r.roomNumber) parts.push(`Hab. ${r.roomNumber}`)
  if (r.guestName) parts.push(r.guestName)
  parts.push(`${r.nights} ${r.nights === 1 ? 'noche' : 'noches'}`)
  return parts.join(' · ')
}
const truncatedNote = computed(() => (total.value > results.value.length ? `Mostrando ${results.value.length} de ${total.value}: afiná la búsqueda por habitación o apellido.` : ''))

async function search(term: string) {
  const mine = ++seq
  searching.value = true
  error.value = ''
  try {
    const res = await RestaurantService.searchInHouse(term)
    if (mine !== seq) return
    results.value = res.data
    total.value = res.total
    searched.value = true
  } catch (e: unknown) {
    if (mine !== seq) return
    results.value = []
    total.value = 0
    error.value = e instanceof Error ? e.message : 'No se pudo buscar'
  } finally {
    if (mine === seq) searching.value = false
  }
}

function scheduleSearch() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { timer = null; void search(query.value) }, DEBOUNCE_MS)
}
watch(query, scheduleSearch)

function pick(r: InHouseReservation) { emit('update:modelValue', r) }
function change() {
  emit('update:modelValue', null)
  query.value = ''
  void search('')
  requestAnimationFrame(() => inputEl.value?.focus())
}

onMounted(() => {
  if (!selected.value) void search('')
  if (props.autofocus) inputEl.value?.focus()
})
onUnmounted(() => { if (timer) clearTimeout(timer) })
</script>

<template>
  <div data-testid="reservation-picker">
    <!-- Elegida: ficha + Cambiar. El cargo/apertura se confirma afuera, en un toque. -->
    <div v-if="selected" data-testid="reservation-picker-selected"
      class="flex items-center justify-between gap-3 rounded-xl border-2 border-navy bg-navy/5 px-3 py-2.5">
      <div class="min-w-0">
        <div class="text-sm font-black text-navy truncate">{{ summary(selected) }}</div>
        <span v-if="inHouseStatusLabel(selected)" data-testid="reservation-status" class="inline-block mt-0.5 rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-bold text-gold">{{ inHouseStatusLabel(selected) }}</span>
      </div>
      <button type="button" @click="change" :disabled="disabled"
        class="shrink-0 rounded-full border-2 border-navy/30 px-3 py-1 text-xs font-bold text-navy hover:bg-surface disabled:opacity-50">Cambiar</button>
    </div>

    <template v-else>
      <label :for="uid" class="block text-xs font-bold text-text-muted mb-1">{{ label }}</label>
      <input :id="uid" ref="inputEl" v-model="query" type="search" :placeholder="placeholder" :disabled="disabled"
        autocomplete="off" inputmode="search" role="combobox" :aria-expanded="results.length > 0" :aria-controls="`${uid}-list`"
        class="w-full px-3 py-2 rounded-lg border-2 border-border text-sm text-navy focus:border-navy focus:outline-none" />

      <div v-if="error" role="alert" class="mt-2 text-xs font-bold text-coral">{{ error }}</div>
      <div v-else-if="searching && !results.length" class="mt-2 space-y-1.5" aria-busy="true" data-testid="reservation-picker-loading">
        <div v-for="i in 3" :key="i" class="h-10 animate-pulse rounded-xl bg-surface"></div>
      </div>
      <p v-else-if="searched && !results.length" role="status" data-testid="reservation-picker-empty"
        class="mt-2 rounded-xl bg-surface px-3 py-3 text-center text-sm text-text-muted">{{ emptyMessage }}</p>
      <ul v-else-if="results.length" :id="`${uid}-list`" role="listbox" :aria-label="label"
        class="mt-2 max-h-64 overflow-y-auto divide-y divide-border rounded-xl border-2 border-border">
        <li v-for="r in results" :key="r.id" role="option" :aria-selected="false">
          <button type="button" @click="pick(r)" :disabled="disabled" :data-reservation="r.id"
            class="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-surface disabled:opacity-50">
            <span class="min-w-0">
              <span class="block text-sm font-bold text-navy truncate">{{ summary(r) }}</span>
              <span class="block text-[11px] text-text-muted">{{ r.checkIn }} → {{ r.checkOut }}</span>
            </span>
            <!-- Llega hoy y todavía no pasó por recepción: se puede cargar igual, pero que el mozo lo sepa. -->
            <span v-if="inHouseStatusLabel(r)" data-testid="reservation-status" class="shrink-0 rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-bold text-gold">{{ inHouseStatusLabel(r) }}</span>
          </button>
        </li>
      </ul>
      <p v-if="truncatedNote && results.length" role="status" data-testid="reservation-picker-truncated" class="mt-1.5 text-[11px] text-text-muted">{{ truncatedNote }}</p>
    </template>
  </div>
</template>

<style scoped></style>
