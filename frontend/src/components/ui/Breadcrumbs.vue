<script setup lang="ts">
// Breadcrumbs.vue — Migas de pan DERIVADAS de la ruta actual (sin meta por-ruta).
// Parsea route.path en segmentos y los traduce con un diccionario es.
// Reglas:
//  - Se oculta si la profundidad es <= 1 (una sola sección).
//  - Cada miga menos la última es <router-link> (si resuelve a una ruta real).
//  - Un segmento que es un :param (id) → se muestra como 'Detalle' (no rompe).
//  - Segmento desconocido → se capitaliza.
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ROUTE_LABELS as LABELS, capitalizeSegment } from '@/composables/usePageTitle'

const route = useRoute()
const router = useRouter()

// Home por raíz: la primera miga apunta a un destino navegable real.
const HOME_PATH: Record<string, string> = {
  panel: '/panel/dashboard',
  admin: '/admin',
}

// Valores de los :params de la ruta → detectar segmentos que son ids.
const paramValues = computed(() => new Set(Object.values(route.params).flat().filter(Boolean) as string[]))

function labelFor(segment: string, index: number): string {
  if (index === 0 && LABELS[segment]) return LABELS[segment]
  if (paramValues.value.has(segment)) return 'Detalle'
  return LABELS[segment] ?? capitalizeSegment(segment)
}

interface Crumb {
  label: string
  to: string
  clickable: boolean
}

const crumbs = computed<Crumb[]>(() => {
  const segments = route.path.split('/').filter(Boolean)
  let acc = ''
  return segments.map((seg, i) => {
    acc += '/' + seg
    const isLast = i === segments.length - 1
    const to = i === 0 ? (HOME_PATH[seg] ?? acc) : acc
    // Clickable solo si no es la última Y resuelve a una ruta real (no al catch-all).
    let clickable = false
    if (!isLast) {
      try {
        const resolved = router.resolve(to)
        clickable = resolved.name !== 'not-found' && resolved.matched.length > 0
      } catch {
        clickable = false
      }
    }
    return { label: labelFor(seg, i), to, clickable }
  })
})

// Ocultar si hay una sola sección (profundidad <= 1).
const visible = computed(() => crumbs.value.length > 1)
</script>

<template>
  <nav v-if="visible" aria-label="Migas de pan" class="mb-4 flex items-center gap-1.5 text-[13px] font-semibold">
    <template v-for="(crumb, i) in crumbs" :key="crumb.to + i">
      <router-link
        v-if="crumb.clickable"
        :to="crumb.to"
        class="text-text-muted transition-colors hover:text-navy"
      >{{ crumb.label }}</router-link>
      <span
        v-else
        :class="i === crumbs.length - 1 ? 'text-navy font-black' : 'text-text-muted'"
        :aria-current="i === crumbs.length - 1 ? 'page' : undefined"
      >{{ crumb.label }}</span>
      <span v-if="i < crumbs.length - 1" class="text-text-muted/60 select-none" aria-hidden="true">/</span>
    </template>
  </nav>
</template>

<style scoped></style>
