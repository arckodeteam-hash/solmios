<script setup lang="ts">
// PillTabs.vue — Tabs compartidas (patrón "pill" de CashRegisterView.vue): tablist accesible
// (role="tablist"/"tab", aria-selected, flechas/Home/End) con sincronía OPCIONAL con `?tab=` en
// la URL. Toda vista con 3+ secciones independientes del mismo nivel debería usar esto en vez de
// reimplementar el patrón a mano (ver solmios-ui/SKILL.md).
import { computed, useTemplateRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'

export interface PillTab {
  value: string
  label: string
  /** Si viene, se muestra como "Label (count)". Ausente = sin contador (no "(0)" a la fuerza). */
  count?: number
}

const props = withDefaults(defineProps<{
  tabs: PillTab[]
  modelValue: string
  ariaLabel?: string
  /** Refleja la pestaña activa en `?tab=` (lee al montar, escribe con router.replace al cambiar). */
  syncQuery?: boolean
}>(), {
  ariaLabel: 'Secciones',
  syncQuery: false,
})

const emit = defineEmits<{ 'update:modelValue': [string] }>()

// Solo se pide el router cuando de verdad se va a usar: una vista que consume PillTabs sin
// `sync-query` (CashRegisterView.vue, por ahora) puede montarse en un test que no instala
// vue-router — `useRoute()`/`useRouter()` incondicionales tiraban "[Vue warn]: injection
// 'Symbol(route location)' not found" en esos casos, aunque no rompía nada porque route/router
// quedaban `undefined` y el resto del código nunca los toca sin `syncQuery`.
const route = props.syncQuery ? useRoute() : null
const router = props.syncQuery ? useRouter() : null

// `route.query.tab` puede llegar como array si la URL repite el param (mismo caso que
// integraciones/index.vue:78-84) — se toma el último.
function readQueryTab(): string | null {
  const raw = route?.query.tab
  const v = Array.isArray(raw) ? raw[raw.length - 1] : raw
  return typeof v === 'string' && v ? v : null
}

// Corrección SINCRÓNICA (no onMounted): corre durante el setup, antes de que el padre pinte las
// secciones que dependen de su propio v-model, así F5 con ?tab=combos no parpadea en la pestaña
// por defecto. Un tab en la URL que no existe en `tabs` se ignora (cae al modelValue del padre).
if (props.syncQuery) {
  const fromQuery = readQueryTab()
  if (fromQuery && fromQuery !== props.modelValue && props.tabs.some((t) => t.value === fromQuery)) {
    emit('update:modelValue', fromQuery)
  }
}

const tabRefs = useTemplateRef<HTMLButtonElement[]>('tabButtons')

function select(value: string): void {
  if (value === props.modelValue) return
  emit('update:modelValue', value)
  if (props.syncQuery) router?.replace({ query: { ...route?.query, tab: value } })
}

function onKeydown(e: KeyboardEvent): void {
  const idx = props.tabs.findIndex((t) => t.value === props.modelValue)
  if (idx === -1) return
  let next = -1
  if (e.key === 'ArrowRight') next = (idx + 1) % props.tabs.length
  else if (e.key === 'ArrowLeft') next = (idx - 1 + props.tabs.length) % props.tabs.length
  else if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = props.tabs.length - 1
  else return
  e.preventDefault()
  select(props.tabs[next].value)
  tabRefs.value?.[next]?.focus()
}

const activeIndex = computed(() => props.tabs.findIndex((t) => t.value === props.modelValue))
</script>

<template>
  <div role="tablist" :aria-label="ariaLabel" @keydown="onKeydown"
    class="flex gap-1.5 w-fit max-w-full overflow-x-auto rounded-full bg-surface p-1 border border-border">
    <button
      v-for="(t, i) in tabs"
      :key="t.value"
      ref="tabButtons"
      type="button"
      role="tab"
      :aria-selected="t.value === modelValue"
      :tabindex="i === activeIndex ? 0 : -1"
      @click="select(t.value)"
      class="shrink-0 rounded-full px-4 py-2 text-xs font-extrabold transition-colors cursor-pointer whitespace-nowrap"
      :class="t.value === modelValue ? 'bg-navy text-white' : 'text-text-secondary hover:text-navy'"
    >
      {{ t.label }}<span v-if="t.count !== undefined"> ({{ t.count }})</span>
    </button>
  </div>
</template>
