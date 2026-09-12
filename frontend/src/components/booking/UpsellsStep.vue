<template>
  <!--
    UpsellsStep.vue — Step 2 del widget (F2 2.9, solmi-direct-booking).
    Lista upsells activos del hotel (desayuno, transfer, late checkout…). Cada uno con checkbox
    + Stepper de cantidad (qty). El `kind` determina cómo se cobra (MR-10 #275):
      - per_room: 1 cargo por habitación (default y tope = habitaciones del carrito)
      - per_person: default y tope = personas del carrito sin bebés (`store.upsellPersons`)
      - per_stay: 1 cargo por la estadía entera (qty fijo = 1, sin stepper)
      - per_night: price × noches (qty fijo = 1, sin stepper)
      - per_person_per_night: price × personas × noches (qty fijo = 1, sin stepper)
    El tope por kind es `store.upsellMaxQty(kind)`, espejo del backend: lo que el stepper deja
    pedir es exactamente lo que el POST acepta (si no, 400 upsell_quantity_out_of_range).
    La tarjeta muestra el precio calculado PARA ESTA ESTADÍA (`store.upsellStayPrice`): en los
    kinds por noche el catálogo dice "10 por persona y noche", el huésped ve lo que va a pagar.
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
            <!-- MR-10: en los kinds por noche el número grande es el precio de la estadía
                 (price × noches [× personas]) y el unitario de catálogo queda chico debajo. -->
            <p class="font-black text-navy" data-testid="upsell-stay-price">{{ formatPrice(store.upsellStayPrice(up), store.chargeCurrency) }}</p>
            <p v-if="isPerNightKind(up.kind)" class="text-[11px] text-text-muted" data-testid="upsell-unit-price">
              {{ formatPrice(up.price, store.chargeCurrency) }} · {{ kindLabel(up.kind) }}
            </p>
          </div>
        </div>

        <div v-if="isSelected(up.id) && hasStepper(up.kind)" class="mt-3 flex items-center gap-3">
          <span class="text-xs font-bold text-text-muted uppercase tracking-wide">{{ t('upsells.quantity') }}</span>
          <div class="w-32">
            <Stepper
              :model-value="qtyFor(up.id)"
              :min="1"
              :max="store.upsellMaxQty(up.kind)"
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

    <!-- #220: el desglose (subtotal · extras · impuestos · total estimado) acompaña al huésped
         hasta el pago; misma moneda que los precios de los extras de arriba. -->
    <div class="rounded-xl bg-slate-50 px-4 py-3">
      <EstimatedTotals :format="formatEstimatedPrice" />
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
import EstimatedTotals from './EstimatedTotals.vue'
import type { UpsellKind } from '@/types/booking'

const store = useBookingStore()
const { t, formatPrice } = useBookingI18nStore()

/** #220: formateador para <EstimatedTotals>. Los importes del store (roomsSubtotal, impuestos,
 *  total estimado) viajan en la moneda de visualización elegida por el huésped, así que se
 *  formatean como en RoomsStep/GuestCheckoutStep/PayStep (display si hay, si no la de cobro):
 *  el mismo número no puede cambiar de símbolo entre un paso y el siguiente. */
function formatEstimatedPrice(amount: unknown): string {
  return formatPrice(Number(amount), store.displayCurrency || store.chargeCurrency)
}

function isSelected(id: string): boolean {
  return store.selectedUpsells.some((u) => u.id === id)
}

function qtyFor(id: string): number {
  return store.selectedUpsells.find((u) => u.id === id)?.quantity ?? 1
}

/** Kinds con cantidad elegible por el huésped; el resto va fijo en 1 (MR-10 #275). */
function hasStepper(kind: UpsellKind): boolean {
  return kind === 'per_room' || kind === 'per_person'
}

/** Kinds cuyo precio de catálogo se multiplica por las noches de la estadía. */
function isPerNightKind(kind: UpsellKind): boolean {
  return kind === 'per_night' || kind === 'per_person_per_night'
}

/**
 * Toggle por checkbox. Default qty por kind: per_room=habitaciones del carrito, per_person=
 * ocupación REAL de la reserva, per_stay/per_night/ppn=1 — es decir, el tope del kind
 * (`store.upsellMaxQty`): arranca en el máximo permitido y el huésped sólo puede bajar.
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
    const defaultQty = up ? store.upsellMaxQty(up.kind) : 1
    store.setSelectedUpsells([...current, { id, quantity: Math.max(1, defaultQty) }])
  } else {
    store.setSelectedUpsells(current)
  }
}

/** Cantidad acotada a [1, tope del kind]: el Stepper ya lo respeta, pero el clamp acá evita
 *  mandar al POST algo que el backend rechaza si el carrito cambió con el extra ya tildado. */
function setQty(id: string, v: number) {
  const current = store.selectedUpsells.filter((u) => u.id !== id)
  const up = store.upsells.find((u) => u.id === id)
  const max = up ? store.upsellMaxQty(up.kind) : Infinity
  store.setSelectedUpsells([...current, { id, quantity: Math.min(Math.max(1, v), max) }])
}

function kindLabel(kind: UpsellKind): string {
  switch (kind) {
    case 'per_room': return t('upsells.kindPerRoom')
    case 'per_person': return t('upsells.kindPerPerson')
    case 'per_stay': return t('upsells.kindPerStay')
    case 'per_night': return t('upsells.kindPerNight')
    case 'per_person_per_night': return t('upsells.kindPerPersonPerNight')
  }
}
</script>
