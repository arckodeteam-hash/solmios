<script setup lang="ts">
// components/ui/PillTabs.vue — Pestañas "pill" compartidas (#203). Patrón extraído de Caja
// (CashRegisterView): tablist redondeado sobre `surface`, activa `bg-navy text-white`. Toda vista con
// 3+ secciones independientes del mismo nivel las muestra con esto, no apiladas.
//
// - `v-model` con el `value` de la pestaña activa; `count` opcional se pinta como "(n)".
// - a11y: role=tablist/tab, aria-selected, foco circular (roving tabindex) y teclado ← → Home End con
//   activación automática (la pestaña enfocada pasa a ser la activa).
// - `queryParam` (opcional): sincroniza con `?<param>=` de la URL — un enlace directo abre esa pestaña,
//   cambiar de pestaña actualiza la URL sin recargar (replace, no push) y F5/back la conservan. Tolera
//   `query.tab` repetido (array) igual que integraciones/index.vue. Sin `queryParam` no toca el router,
//   así el componente se monta en tests sin router instalado.
// - En 375 px el tablist scrollea horizontal dentro de su propio contenedor; la página nunca desborda.
import { ref, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'

export interface PillTab {
  value: string
  label: string
  count?: number
}

const props = withDefaults(defineProps<{
  tabs: PillTab[]
  modelValue: string
  ariaLabel?: string
  queryParam?: string
}>(), { ariaLabel: 'Secciones', queryParam: undefined })

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

// Router solo si se pidió sincronía por URL (prop estática: la decisión se toma una vez, en setup).
const route = props.queryParam ? useRoute() : null
const router = props.queryParam ? useRouter() : null

const buttons = ref<HTMLButtonElement[]>([])
const has = (v: string): boolean => props.tabs.some((t) => t.value === v)

/** Valor pedido en la URL; el último si el param viene repetido. Vacío si no hay o no es una pestaña. */
function queryValue(): string {
  if (!route || !props.queryParam) return ''
  const raw = route.query[props.queryParam]
  const v = Array.isArray(raw) ? String(raw[raw.length - 1] ?? '') : String(raw ?? '')
  return has(v) ? v : ''
}

function select(value: string) {
  if (!has(value) || value === props.modelValue) return
  emit('update:modelValue', value)
  if (router && route && props.queryParam && queryValue() !== value) {
    router.replace({ query: { ...route.query, [props.queryParam]: value } })
  }
}

function focusAndSelect(index: number) {
  const n = props.tabs.length
  if (!n) return
  const i = ((index % n) + n) % n
  buttons.value[i]?.focus()
  select(props.tabs[i].value)
}

function onKeydown(e: KeyboardEvent, index: number) {
  const keys: Record<string, () => void> = {
    ArrowRight: () => focusAndSelect(index + 1),
    ArrowLeft: () => focusAndSelect(index - 1),
    Home: () => focusAndSelect(0),
    End: () => focusAndSelect(props.tabs.length - 1),
  }
  const action = keys[e.key]
  if (!action) return
  e.preventDefault()
  action()
}

onMounted(() => {
  const fromUrl = queryValue()
  if (fromUrl && fromUrl !== props.modelValue) emit('update:modelValue', fromUrl)
})
// Back/forward del navegador o un enlace interno con otro ?tab= → seguir a la URL.
if (route && props.queryParam) {
  watch(() => route.query[props.queryParam!], () => {
    const v = queryValue()
    if (v && v !== props.modelValue) emit('update:modelValue', v)
  })
}
</script>

<template>
  <div class="max-w-full overflow-x-auto">
    <div class="flex gap-1.5 w-fit rounded-full bg-surface p-1 border border-border" role="tablist" :aria-label="ariaLabel">
      <button v-for="(t, i) in tabs" :key="t.value" ref="buttons" type="button" role="tab"
        :aria-selected="t.value === modelValue" :tabindex="t.value === modelValue ? 0 : -1"
        :data-tab="t.value" @click="select(t.value)" @keydown="onKeydown($event, i)"
        class="whitespace-nowrap rounded-full px-4 py-2 text-xs font-extrabold transition-colors cursor-pointer"
        :class="t.value === modelValue ? 'bg-navy text-white' : 'text-text-secondary hover:text-navy'">
        {{ t.label }}<span v-if="t.count !== undefined" class="ml-1 font-bold opacity-80">({{ t.count }})</span>
      </button>
    </div>
  </div>
</template>

<style scoped></style>
