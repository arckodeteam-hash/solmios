<template>
  <!--
    SearchStep.vue — Step 0 del widget de reserva (F2 2.9 + 2.17, solmi-direct-booking).
    Captura fechas (checkIn/checkOut) via CalendarView estilo Airbnb (task 2.17 reemplazó los
    `<input type="date">` nativos por el calendar con selección inclusiva de noches) + huéspedes
    + habitaciones y dispara la búsqueda de disponibilidad. Es la puerta de entrada al funnel —
    el CTA NO dice "Reservar" sino "Ver disponibilidad" (spec: reduce fricción al no comprometer
    al usuario antes de ver precios).

    Mobile-first: calendar de 1 mes visible con nav entre meses en mobile, 2 meses en sm+.
    Stepper de huéspedes/habitaciones touch-friendly (target ≥44px).

    Emite la búsqueda al store vía `store.search()` (Pinia). El estado (loading, error,
    validación) se lee del store reactivo. Todos los textos via i18n (es/en/pt, task 2.14).
  -->
  <section class="space-y-5">
    <header class="space-y-1">
      <h2 class="text-xl font-black text-navy">{{ t('search.title') }}</h2>
      <p class="text-sm text-text-muted">{{ t('search.subtitle') }}</p>
    </header>

    <!-- Calendar estilo Airbnb (reemplaza inputs date nativos). Selecciona noches inclusivas
         y escribe directo al store.checkIn/checkOut. -->
    <CalendarView />

    <!--
      Huéspedes — QUITADO del buscador (2026-08-20, decisión de producto, ver
      `HeroSearchBar.vue`/`BookingModal.vue` de la landing, mismo cambio ahí). Cada tipo de
      habitación tiene su propio límite de capacidad, y la ocupación exacta se elige recién al
      ver los tipos disponibles (matriz de ocupaciones en `RoomsStep.vue`), no de antemano acá.
      `store.guests`/`children`/`rooms` quedan en su default (1/0/1, `useBooking.ts`) para no
      excluir ningún tipo por capacidad en la búsqueda inicial.
    -->

    <p v-if="dateError" class="text-sm font-semibold text-red-600">{{ dateError }}</p>
    <p v-if="store.ratesError" class="text-sm font-semibold text-red-600">{{ store.ratesError }}</p>

    <button
      type="button"
      :disabled="!store.searchValid || store.ratesLoading"
      class="w-full rounded-xl bg-cyan px-6 py-4 text-base font-black text-white shadow-card transition hover:bg-cyan-light disabled:cursor-not-allowed disabled:opacity-50"
      @click="store.search()"
    >
      <span v-if="store.ratesLoading" class="inline-flex items-center justify-center gap-2">
        <span class="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
        {{ t('search.searching') }}
      </span>
      <span v-else>{{ t('search.cta') }}</span>
    </button>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useBookingStore } from '@/composables/useBooking'
import { useBookingI18nStore } from '@/composables/useBookingI18n'
import CalendarView from './CalendarView.vue'

const store = useBookingStore()
const { t } = useBookingI18nStore()

// Error de fechas: más específico que el flag `searchValid` para guiar al usuario. Se deriva
// del estado del store (no de un ref local) — si el usuario cambia el calendar, esto recalcula.
const dateError = computed(() => {
  if (!store.checkIn || !store.checkOut) return ''
  if (store.checkOut <= store.checkIn) return t('search.dateError')
  return ''
})
</script>
