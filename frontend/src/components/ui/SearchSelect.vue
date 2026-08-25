<script setup lang="ts">
// SearchSelect.vue — Combobox con buscador dinámico (estilo select2), 100% nativo Vue 3.
// Sin dependencias externas. Reutilizable para string[] (País, Nacionalidad)
// o { value, label }[] (Habitaciones: value=id, label='101 — Suite ($120/n)').
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'

// `disabled` (#648): opción visible pero no seleccionable, con motivo en el label — usado por
// el selector de habitación de ReservationWizardModal.vue para mostrar cuartos ocupados esas
// fechas sin ocultarlos (deshabilitar, no ocultar, con el motivo visible).
type Opt = { value: string; label: string; disabled?: boolean }

const props = withDefaults(defineProps<{
  /** Puede llegar undefined mientras el formulario no cargó: se trata como vacío. */
  modelValue: string | undefined
  options: string[] | Opt[]
  placeholder?: string
  disabled?: boolean
}>(), { modelValue: '', placeholder: 'Buscar...', disabled: false })

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const open = ref(false)
const query = ref('')
const root = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLInputElement | null>(null)
const dropdownEl = ref<HTMLElement | null>(null)

// M1 (qa-ui config-2026-08-22): `@focus` no refire sobre un input ya enfocado — tras un scroll
// (closeOnScroll) el dropdown quedaba cerrado con el foco dentro y el click no reabría. El
// `@mousedown` de abajo llama a openDropdown (idempotente) y repara eso.
//
// M2: índice de la opción activa para navegación por teclado (flechas + Enter). -1 = ninguna.
const activeIndex = ref(-1)
// Ids estables para aria-activedescendant (el dropdown se teleporta a body: los li quedan
// fuera del árbol del componente, el lector de pantalla los vincula por id).
const uid = `ss-listbox-${Math.random().toString(36).slice(2, 9)}`

// El dropdown se teletransporta a <body>: si queda dentro de un ancestro con overflow-hidden
// (p.ej. SectionCard, que lo necesita para recortar el header navy a las esquinas redondeadas),
// el `absolute` de acá adentro se corta contra ese borde en vez de flotar sobre toda la pantalla.
// Se posiciona con coordenadas de viewport (position:fixed), recalculadas al abrir.
const dropdownStyle = ref({ top: '0px', left: '0px', width: '0px' })
function updatePosition() {
  if (!root.value) return
  const r = root.value.getBoundingClientRect()
  dropdownStyle.value = { top: `${r.bottom + 4}px`, left: `${r.left}px`, width: `${r.width}px` }
}
// Reposicionar en vivo sería lo ideal, pero cerrar al scrollear (patrón común de combobox) evita
// que el dropdown quede "flotando" desalineado sin necesidad de un listener de scroll costoso.
// Con capture:true este listener también ve el scroll INTERNO de la propia lista (overflow-auto)
// — sin el chequeo de abajo, intentar scrollear las opciones cerraba el dropdown al primer intento.
function closeOnScroll(e: Event) {
  if (!open.value) return
  if (dropdownEl.value && e.target instanceof Node && dropdownEl.value.contains(e.target)) return
  open.value = false
  query.value = ''
}

/** Quita acentos y pasa a minúsculas para tolerar la búsqueda. */
function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** Normaliza las options a { value, label } (un string suelto → value = label). */
const normalized = computed<Opt[]>(() =>
  props.options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o))
)

const filtered = computed<Opt[]>(() => {
  const q = norm(query.value).trim()
  if (!q) return normalized.value
  return normalized.value.filter((o) => norm(o.label).includes(q))
})

/** Etiqueta del valor seleccionado (lo que se muestra cuando está cerrado). */
const selectedLabel = computed(() =>
  normalized.value.find((o) => o.value === props.modelValue)?.label ?? props.modelValue
)

const displayValue = computed(() => (open.value ? query.value : selectedLabel.value))

async function openDropdown() {
  if (props.disabled) return
  open.value = true
  query.value = ''
  activeIndex.value = -1
  await nextTick()
  updatePosition()
}

function onInput(e: Event) {
  if (props.disabled) return
  query.value = (e.target as HTMLInputElement).value
  activeIndex.value = -1
  open.value = true
  updatePosition()
}

function choose(opt: Opt) {
  if (opt.disabled) return
  emit('update:modelValue', opt.value)
  query.value = ''
  activeIndex.value = -1
  open.value = false
  inputEl.value?.blur()
}

/** Mueve la opción activa saltando las deshabilitadas (#648). */
function moveActive(delta: number) {
  const opts = filtered.value
  if (opts.length === 0) return
  let i = activeIndex.value + delta
  while (i >= 0 && i < opts.length && opts[i].disabled) i += delta
  if (i < 0 || i >= opts.length) return
  activeIndex.value = i
  nextTick(() => {
    // happy-dom no implementa scrollIntoView: guard antes de llamarlo (tests de componente).
    const el = dropdownEl.value?.querySelector(`[data-index="${activeIndex.value}"]`) as HTMLElement | null
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' })
  })
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    open.value = false
    query.value = ''
    activeIndex.value = -1
    inputEl.value?.blur()
    return
  }
  // M2 (qa-ui config-2026-08-22): selección por teclado — flechas navegan (abren si estaba
  // cerrado, como un select nativo), Enter elige la activa, Escape cierra (ya está arriba).
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    if (!open.value) { openDropdown(); return }
    moveActive(e.key === 'ArrowDown' ? 1 : -1)
    return
  }
  if (e.key === 'Enter' && open.value) {
    e.preventDefault() // no hace submit del form contenedor (settings tiene uno global)
    const opt = filtered.value[activeIndex.value]
    if (opt && !opt.disabled) choose(opt)
  }
}

function onDocClick(e: MouseEvent) {
  const t = e.target as Node
  // El dropdown vive fuera de `root` en el DOM (Teleport a body): sin este chequeo aparte,
  // cualquier clic adentro de la lista se leía como "afuera" y la cerraba de encuentro.
  if (root.value?.contains(t) || dropdownEl.value?.contains(t)) return
  open.value = false
  query.value = ''
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
  window.addEventListener('scroll', closeOnScroll, true)
  window.addEventListener('resize', closeOnScroll)
})
onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
  window.removeEventListener('scroll', closeOnScroll, true)
  window.removeEventListener('resize', closeOnScroll)
})
</script>

<template>
  <div ref="root" class="relative">
    <input
      ref="inputEl"
      type="text"
      role="combobox"
      autocomplete="off"
      :aria-expanded="open"
      aria-autocomplete="list"
      :aria-controls="uid"
      :aria-activedescendant="activeIndex >= 0 ? `${uid}-${activeIndex}` : undefined"
      :value="displayValue"
      :placeholder="selectedLabel || placeholder"
      :disabled="disabled"
      @focus="openDropdown"
      @mousedown="openDropdown"
      @input="onInput"
      @keydown="onKeydown"
      class="w-full px-3 py-2.5 pr-9 rounded-lg border border-border text-sm bg-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-navy/20 focus:border-navy transition disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-surface"
    />
    <span class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-muted text-xs">▼</span>
    <Teleport to="body">
      <ul
        v-if="open"
        :id="uid"
        ref="dropdownEl"
        role="listbox"
        :style="dropdownStyle"
        class="fixed z-[100] max-h-52 overflow-auto rounded-lg border border-border bg-white shadow-lg"
      >
        <li v-if="filtered.length === 0" class="px-3 py-2 text-sm text-text-muted" role="option" aria-disabled="true">Sin resultados</li>
        <li
          v-for="(opt, i) in filtered"
          :key="opt.value"
          :id="`${uid}-${i}`"
          :data-index="i"
          role="option"
          @mousedown.prevent="choose(opt)"
          :aria-disabled="opt.disabled"
          :aria-selected="!opt.disabled && opt.value === modelValue"
          :class="[
            'px-3 py-2 text-sm',
            opt.disabled ? 'cursor-not-allowed text-text-muted opacity-60' : 'cursor-pointer hover:bg-navy/10',
            !opt.disabled && opt.value === modelValue ? 'bg-navy/5 font-semibold text-navy' : '',
            !opt.disabled && opt.value !== modelValue ? 'text-text' : '',
            !opt.disabled && i === activeIndex ? 'bg-navy/10' : '',
          ]"
        >{{ opt.label }}</li>
      </ul>
    </Teleport>
  </div>
</template>

<style scoped></style>
