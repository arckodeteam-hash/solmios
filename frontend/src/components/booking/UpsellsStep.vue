<template>
  <!--
    UpsellsStep.vue — Step 2 del widget (F2 2.9, solmi-direct-booking).
    Lista upsells activos del hotel (desayuno, transfer, late checkout…). Cada uno con checkbox
    + Stepper de cantidad (qty). El `kind` determina cómo se cobra:
      - per_room: 1 cargo por habitación (qty fijo = rooms)
      - per_person: qty = guests (default)
      - per_stay: 1 cargo por la estadía entera (qty fijo = 1)
    La selección viaja al store via setSelectedUpsells → POST /public/booking.upsells.

    Vacío-friendly: si el hotel no configuró upsells, mostramos empty state y el botón
    "Continuar" pasa directo al siguiente step (no forzar extras).
    Todos los textos via i18n (es/en/pt, task 2.14).
  -->
  <section class="space-y-4">
    <header class="space-y-1">
      <h2 class="text-xl font-black text-navy">{{ t('upsells.title') }}</h2>
      <p class="text-sm text-text-muted">{{ t('upsells.subtitle') }}</p>
    </header>

    <div v-if="store.upsellsLoading" class="text-center py-8">
      <div class="h-8 w-8 mx-auto rounded-full border-4 border-cyan/30 border-t-cyan animate-spin" />
      <p class="text-sm text-text-muted mt-2">{{ t('upsells.loading') }}</p>
    </div>

    <div v-else-if="store.upsells.length === 0" class="text-center py-8 px-4">
      <div class="text-4xl mb-2">✨</div>
      <p class="font-bold text-navy">{{ t('upsells.empty') }}</p>
      <p class="text-sm text-text-muted mt-1">{{ t('upsells.emptyHint') }}</p>
    </div>

    <ul v-else class="space-y-3">
      <li
        v-for="up in store.upsells"
        :key="up.id"
        :class="[
          'rounded-2xl border-2 bg-white p-4 transition',
          isSelected(up.id) ? 'border-cyan ring-2 ring-cyan/20' : 'border-slate-200',
        ]"
      >
        <div class="flex items-start justify-between gap-3">
          <label class="flex items-start gap-3 min-w-0 flex-1 cursor-pointer">
            <input
              type="checkbox"
              class="mt-1 h-5 w-5 rounded border-slate-300 text-cyan focus:ring-cyan/30"
              :checked="isSelected(up.id)"
              @change="toggle(up.id, $event)"
            />
            <div class="min-w-0">
              <p class="font-bold text-navy">{{ up.name }}</p>
              <p v-if="up.description" class="text-xs text-text-muted mt-0.5">{{ up.description }}</p>
              <p class="text-[11px] text-text-muted mt-1 uppercase tracking-wide">{{ kindLabel(up.kind) }}</p>
            </div>
          </label>
          <div class="text-right shrink-0">
            <p class="font-black text-navy">{{ formatPrice(up.price, store.chargeCurrency) }}</p>
          </div>
        </div>

        <div v-if="isSelected(up.id) && up.kind !== 'per_stay'" class="mt-3 flex items-center gap-3">
          <span class="text-xs font-bold text-text-muted uppercase tracking-wide">{{ t('upsells.quantity') }}</span>
          <div class="w-32">
            <Stepper
              :model-value="qtyFor(up.id)"
              :min="1"
              :max="up.kind === 'per_room' ? store.cartTotalRooms : 20"
              @update:model-value="(v) => setQty(up.id, v)"
            />
          </div>
        </div>
      </li>
    </ul>

    <div v-if="store.upsellsTotal > 0" class="rounded-xl bg-slate-50 px-4 py-3 text-sm">
      <div class="flex justify-between">
        <span class="text-text-muted">{{ t('upsells.subtotal') }}</span>
        <span class="font-bold text-navy">{{ formatPrice(store.upsellsTotal, store.chargeCurrency) }}</span>
      </div>
    </div>

    <!-- Continuar al siguiente step (F2 fix BLOCKER): los upsells son opcionales — el huésped
         puede avanzar sin seleccionar ninguno. `store.next()` desde 'upselling' pasa a
         'checkingout' (GuestCheckoutStep). Disabled solo mientras cargan los upsells. -->
    <button
      type="button"
      :disabled="store.upsellsLoading"
      class="w-full rounded-xl bg-cyan px-6 py-4 text-base font-black text-white shadow-card transition hover:bg-cyan-light disabled:cursor-not-allowed disabled:opacity-50"
      @click="store.next()"
    >
      {{ t('upsells.continue') }}
    </button>
  </section>
</template>

<script setup lang="ts">
import { useBookingStore } from '@/composables/useBooking'
import { useBookingI18nStore } from '@/composables/useBookingI18n'
import Stepper from './Stepper.vue'
import type { UpsellKind } from '@/types/booking'

const store = useBookingStore()
const { t, formatPrice } = useBookingI18nStore()

function isSelected(id: string): boolean {
  return store.selectedUpsells.some((u) => u.id === id)
}

function qtyFor(id: string): number {
  return store.selectedUpsells.find((u) => u.id === id)?.quantity ?? 1
}

/**
 * Toggle por checkbox. Default qty por kind: per_room=habitaciones del carrito, per_person=
 * ocupación REAL de la reserva, per_stay=1.
 *
 * FIX (auditoría Requerimiento 7, 2026-09-03) — usaba `store.rooms`/`store.guests`: los campos de
 * BÚSQUEDA (default 1 desde la decisión 2026-08-20 de no pedir ocupación por adelantado), NO lo
 * que el huésped realmente agregó al carrito. Con 2 habitaciones y 4 huéspedes en el carrito, el
 * desayuno "por persona" arrancaba en cantidad 1 — el huésped tenía que darse cuenta y corregirlo
 * a mano. Mismo criterio que ya usa BookingModal.vue (`cartTotalGuests`/`cartTotalRooms`):
 * `cartTotalGuests` ya excluye a los niños libres (no consumen plaza) e incluye a los que sí
 * pagan; `cartTotalFreeChildren` suma SOLO a los libres — sumar `cartTotalChildren` (TODOS los
 * niños) los contaría dos veces, porque los que pagan ya están dentro de `cartTotalGuests`.
 */
function toggle(id: string, e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  const current = store.selectedUpsells.filter((u) => u.id !== id)
  if (checked) {
    const up = store.upsells.find((u) => u.id === id)
    const defaultQty = up?.kind === 'per_room'
      ? store.cartTotalRooms
      : up?.kind === 'per_person' ? store.cartTotalGuests + store.cartTotalFreeChildren : 1
    store.setSelectedUpsells([...current, { id, quantity: Math.max(1, defaultQty) }])
  } else {
    store.setSelectedUpsells(current)
  }
}

function setQty(id: string, v: number) {
  const current = store.selectedUpsells.filter((u) => u.id !== id)
  store.setSelectedUpsells([...current, { id, quantity: Math.max(1, v) }])
}

function kindLabel(kind: UpsellKind): string {
  switch (kind) {
    case 'per_room': return t('upsells.kindPerRoom')
    case 'per_person': return t('upsells.kindPerPerson')
    case 'per_stay': return t('upsells.kindPerStay')
  }
}
</script>
