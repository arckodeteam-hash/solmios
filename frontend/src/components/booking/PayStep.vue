<template>
  <!--
    PayStep.vue — Step 4 del widget (F2 2.9 + D1, solmi-direct-booking).
    Resumen final + input de promo code + botón "Reservar y Pagar" que dispara store.pay()
    (crea la reserva pending + redirect a Stripe Checkout).

    IDEMPOTENCIA (anti-doble-submit, acceptance 2.8):
      - El botón está `:disabled` mientras `store.isSubmitting === true`.
      - `store.pay()` tiene un guard extra (`if (isSubmitting) return`) por si el botón se
        habilita entre el click y el handler (race de eventos).
      - El idempotencyKey client-side viaja en el body; el backend dedupea por reservation.id.
    Tras el click exitoso, el redirect a Stripe descarga la página — el botón queda en "Procesando…".

    PROMO (spec booking-widget R-promo): input + botón "Aplicar" que llama store.applyPromo
    (valida contra promo_codes, NO incrementa uses — eso lo hace el backend al crear). Muestra
    descuento aplicado o razón de rechazo. No stackeable (un promo por reserva).

    DESGLOSE: pre-create mostramos la estimación (subtotal - promo + taxes). Post-create el
    backend devuelve `totalBreakdown` (definitivo); lo mostramos si está disponible. El botón
    siempre confía en `store.estimatedTotal` antes del click, y en `totalBreakdown.total` después.
    Todos los textos via i18n (es/en/pt, task 2.14).
  -->
  <section class="space-y-4">
    <header class="space-y-1">
      <h2 class="text-xl font-black text-navy">{{ t('pay.title') }}</h2>
      <p class="text-sm text-text-muted">{{ t('pay.subtitle') }}</p>
    </header>

    <!--
      Resumen de la reserva (editable: click → goToStep). Tarea 3.2 (solmi-direct-booking-
      qa-fixes) — fecha/habitación/huéspedes/total son los 4 datos que el huésped tiene que
      poder confirmar de un vistazo antes de pagar. Jerarquía de 3 niveles: label chico en
      mayúscula (text-xs) < valor principal (text-base font-black, este bloque) < total
      (text-xl font-black, el desglose de abajo) — así el total sigue siendo el elemento más
      grande de la pantalla, pero fecha/habitación/huéspedes ya no compiten en igualdad de
      peso con la info secundaria (desglose de precio, código promo).
    -->
    <div class="rounded-2xl border border-slate-200 bg-white p-4 space-y-3 text-sm">
      <button type="button" class="w-full flex items-center justify-between text-left" @click="store.goToStep(0)">
        <span class="text-xs font-bold uppercase tracking-wide text-text-muted">{{ t('pay.dates') }}</span>
        <span class="text-base font-black text-navy underline decoration-dotted">
          {{ store.checkIn }} → {{ store.checkOut }} ({{ t('search.nights', { count: store.nights }) }})
        </span>
      </button>
      <button type="button" class="w-full flex items-start justify-between gap-3 text-left" @click="store.goToStep(1)">
        <span class="text-xs font-bold uppercase tracking-wide text-text-muted shrink-0">{{ store.cart.length === 1 ? t('pay.room') : t('rooms.title') }}</span>
        <span class="text-base font-black text-navy underline decoration-dotted text-right">
          <span v-for="line in store.cart" :key="line.key" class="block capitalize">
            {{ prettify(line.roomName) }} · {{ t('rooms.occupancyFor', { count: line.occupancy }) }}{{ line.quantity > 1 ? ` × ${line.quantity}` : '' }}
          </span>
        </span>
      </button>
      <div class="flex items-center justify-between">
        <span class="text-xs font-bold uppercase tracking-wide text-text-muted">{{ t('pay.guestsCount') }}</span>
        <span class="text-base font-black text-navy">{{ store.cartTotalGuests }}</span>
      </div>
      <div v-if="store.selectedUpsells.length > 0" class="flex items-center justify-between">
        <span class="text-text-muted">{{ t('pay.extras') }}</span>
        <button type="button" class="font-bold text-navy underline decoration-dotted" @click="store.goToStep(2)">
          {{ extrasLabel }}
        </button>
      </div>
      <button type="button" class="w-full flex items-center justify-between text-left" @click="store.goToStep(3)">
        <span class="text-text-muted">{{ t('pay.guest') }}</span>
        <span class="font-bold text-navy underline decoration-dotted truncate max-w-[60%]">
          {{ store.guest.name || '—' }}
        </span>
      </button>
    </div>

    <!-- Promo code input -->
    <div class="space-y-2">
      <label class="block">
        <span class="block text-xs font-bold text-text-muted uppercase tracking-wide mb-1">{{ t('pay.promoPrompt') }}</span>
        <div class="flex gap-2">
          <input
            v-model="store.promoCode"
            type="text"
            autocomplete="off"
            :placeholder="t('pay.promoPlaceholder')"
            class="flex-1 min-w-0 rounded-xl border border-slate-200 bg-white px-4 py-3 text-base uppercase text-navy focus:border-cyan focus:ring-2 focus:ring-cyan/30 focus:outline-none"
            :disabled="store.promoLoading"
            @keyup.enter="onApplyPromo"
          />
          <button
            type="button"
            :disabled="!store.promoCode.trim() || store.promoLoading"
            class="shrink-0 rounded-xl bg-navy px-4 py-3 text-sm font-bold text-white hover:bg-navy-light disabled:opacity-50"
            @click="onApplyPromo"
          >
            {{ t('pay.promoApply') }}
          </button>
        </div>
      </label>

      <p v-if="store.promoResult?.valid" class="text-sm font-bold text-green-700">
        {{ t('pay.promoApplied', { amount: formatPrice(store.promoDiscount, displayOrCharge) }) }}
      </p>
      <p v-else-if="store.promoResult && !store.promoResult.valid" class="text-sm font-semibold text-red-600">
        {{ promoReasonLabel(store.promoResult.reason) }}
      </p>
    </div>

    <!-- Desglose de totales -->
    <div class="rounded-2xl bg-slate-50 p-4 space-y-2 text-sm">
      <div class="flex justify-between">
        <span class="text-text-muted">{{ t('pay.roomLine', { count: store.nights }) }}</span>
        <span class="font-semibold text-navy">{{ formatPrice(store.roomsSubtotal, displayOrCharge) }}</span>
      </div>
      <div v-if="store.upsellsTotal > 0" class="flex justify-between">
        <span class="text-text-muted">{{ t('pay.extras') }}</span>
        <span class="font-semibold text-navy">{{ formatPrice(store.upsellsTotal, displayOrCharge) }}</span>
      </div>
      <div v-if="store.promoDiscount > 0" class="flex justify-between text-green-700">
        <span>{{ t('pay.discount') }}</span>
        <span class="font-semibold">−{{ formatPrice(store.promoDiscount, displayOrCharge) }}</span>
      </div>
      <div v-if="store.estimatedTaxes > 0" class="flex justify-between">
        <span class="text-text-muted">{{ t('pay.taxes') }}</span>
        <span class="font-semibold text-navy">{{ formatPrice(store.estimatedTaxes, displayOrCharge) }}</span>
      </div>
      <div class="border-t border-slate-200 pt-2 flex justify-between items-baseline">
        <span class="font-black text-navy">{{ t('pay.total') }}</span>
        <span class="text-xl font-black text-navy">{{ formatPrice(currentTotal, displayOrCharge) }}</span>
      </div>
    </div>

    <!--
      F5 #627 + FIX 2026-08-21 (paridad con BookingModal.vue, "Condiciones de la reserva") —
      Política de cancelación con tono de riesgo: SOLO se deriva de `cancellationSummary` (lo
      que el backend calcula desde los tiers reales del hotel). Ya NO cae al texto libre
      `cancellationPolicy` que el admin escribe a mano en /panel/booking-engine — ese texto
      llegó a decir "flexible" en producción mientras la política real que el backend aplica
      al cancelar era estricta, y anunciarlo prometía un reembolso que no existía. Mismo
      criterio (y mismo bug ya cerrado una vez) que la landing: ver el comentario de
      `bookingTerms` en BookingModal.vue.
    -->
    <div
      v-if="cancellationTerms"
      class="rounded-xl border p-3 space-y-1 text-xs"
      :class="cancellationTerms.tone === 'danger' ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white'"
    >
      <p class="font-bold" :class="cancellationTerms.tone === 'danger' ? 'text-red-600' : 'text-navy'">{{ t('pay.cancellationPolicy') }}</p>
      <p class="leading-relaxed" :class="cancellationTerms.tone === 'danger' ? 'text-red-700' : 'text-text-muted'">
        {{ cancellationTerms.headline }}
        <span v-if="cancellationTerms.detail" class="block">{{ cancellationTerms.detail }}</span>
      </p>
    </div>

    <!--
      FIX 2026-08-22 — paridad con BookingModal.vue (landing): ahí el pago exige un tilde
      explícito de "acepto las condiciones" (`termsAccepted`, con guard en el handler además
      del `:disabled`, ver BookingModal.terms.test.ts). El widget embebible dejaba pagar sin
      esa aceptación explícita — mismo compromiso legal/de confianza, misma exigencia acá.
      Sin `watch` de reset: `booking-widget.vue` monta este componente con `<component :is>`
      SIN KeepAlive, así que `termsAccepted` ya vuelve a `false` solo con volver a este step.
    -->
    <label class="flex cursor-pointer items-start gap-3 rounded-xl bg-slate-50 p-3">
      <input
        v-model="termsAccepted"
        data-testid="accept-terms"
        type="checkbox"
        class="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 text-cyan focus:ring-cyan/30"
      />
      <span class="text-sm font-bold text-navy">{{ t('pay.acceptTerms') }}</span>
    </label>

    <p v-if="store.error" class="text-sm font-semibold text-red-600">{{ store.error }}</p>

    <button
      type="button"
      :disabled="store.isSubmitting || !termsAccepted"
      class="w-full rounded-xl bg-cyan px-6 py-4 text-base font-black text-white shadow-card transition hover:bg-cyan-light disabled:cursor-not-allowed disabled:opacity-60"
      @click="onPay"
    >
      <span v-if="store.isSubmitting" class="inline-flex items-center justify-center gap-2">
        <span class="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
        {{ t('pay.processing') }}
      </span>
      <span v-else>{{ t('pay.cta', { amount: formatPrice(currentTotal, displayOrCharge) }) }}</span>
    </button>

    <p v-if="!termsAccepted" class="text-xs font-bold text-text-muted text-center">{{ t('pay.termsRequired') }}</p>

    <p v-if="hasDifferentChargeCurrency" class="text-[11px] text-center text-text-muted">
      {{ t('pay.chargeNote', { charge: store.chargeCurrency, display: store.displayCurrency }) }}
    </p>
    <p v-else class="text-[11px] text-center text-text-muted">
      {{ t('pay.secureNote') }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useBookingStore } from '@/composables/useBooking'
import { useBookingI18nStore } from '@/composables/useBookingI18n'
import type { PromoValidationReason } from '@/types/booking'

const store = useBookingStore()
const { t, formatPrice } = useBookingI18nStore()

// FIX 2026-08-22 — paridad con BookingModal.vue (`termsAccepted`): arranca en `false` siempre.
// Sin `watch` de reset acá: a diferencia del modal (que queda montado con TODOS los steps
// vivos), `booking-widget.vue` renderiza cada step con `<component :is>` sin KeepAlive — este
// componente se destruye y recrea al navegar, así que un nuevo mount ya arranca en `false`.
const termsAccepted = ref(false)

// Si el backend ya devolvió `totalBreakdown` (post-create), confiamos en ese total. Pre-create
// usamos la estimación (que coincide porque aplica la misma promo y taxRate).
const currentTotal = computed(() => store.totalBreakdown?.total ?? store.estimatedTotal)

const displayOrCharge = computed(() => store.displayCurrency || store.chargeCurrency)

const hasDifferentChargeCurrency = computed(
  () => !!store.displayCurrency && !!store.chargeCurrency && store.displayCurrency !== store.chargeCurrency,
)

const extrasLabel = computed(() => {
  const c = store.selectedUpsells.length
  return c === 1 ? t('pay.extrasCountOne') : t('pay.extrasCountMany', { count: c })
})

// F5 #627 — Formatea la ventana gratuita para display.
// El preset flexible del backend usa deadlineHours=99_999 (ver cancellation-math.ts).
// Cualquier valor >= FLEXIBLE_ANYTIME_THRESHOLD significa "cancelación gratis siempre".
const FLEXIBLE_ANYTIME_THRESHOLD = 99_000
const HOURS_PER_DAY = 24

/** "7 días" / "6 horas" — el fragmento de tiempo puro, sin la oración alrededor (se embebe
 *  dentro de headlines distintos según el tono: neutral vs. estricto). */
function deadlineFragment(hours: number): string {
  if (hours >= HOURS_PER_DAY) return t('pay.cancelDays', { count: Math.round(hours / HOURS_PER_DAY) })
  return t('pay.cancelHours', { count: Math.max(0, Math.round(hours)) })
}

interface CancellationTerms {
  /** 'danger' = la plata se pierde (no reembolsable / estricta / política desconocida) —
   *  mismo criterio y mismos 5 casos que `bookingTerms` en BookingModal.vue (landing). */
  tone: 'danger' | 'neutral'
  headline: string
  detail: string
}

/**
 * Condiciones de cancelación con tono de riesgo — paridad con `bookingTerms` de
 * BookingModal.vue (ver el comentario ahí para el detalle de CADA caso). Se deriva SOLO de
 * `store.cancellationSummary`; nunca cae al texto libre `store.cancellationPolicy`.
 */
const cancellationTerms = computed<CancellationTerms | null>(() => {
  const summary = store.cancellationSummary
  if (!summary) {
    // Todavía no llegó /rates (nada que mostrar) vs. llegó y no hay política: solo en el
    // segundo caso corresponde el aviso — evita un rojo fantasma en el primer render.
    if (!store.ratesResponse) return null
    return { tone: 'danger', headline: t('pay.cancelNoPolicyHeadline'), detail: t('pay.cancelNoPolicyDetail') }
  }

  const penalty = (summary.penaltyDescription || '').trim()

  if (summary.freeUntilHours === null) {
    return { tone: 'danger', headline: t('pay.cancelNonRefundableHeadline'), detail: penalty }
  }

  // `source: 'default'` es el fallback defensivo del backend cuando el hotel NO configuró
  // nada (para no bloquear una cancelación legítima) — no es una política que el hotel eligió.
  // Anunciarla como "gratis" prometería en su nombre algo que nunca configuró.
  if (summary.source === 'default') {
    return { tone: 'danger', headline: t('pay.cancelNoPolicyHeadline'), detail: t('pay.cancelNoPolicyDetail') }
  }

  if (!summary.tiers.some((tier) => tier.penaltyPercent > 0)) {
    return { tone: 'neutral', headline: t('pay.cancelFreeAnytime'), detail: '' }
  }

  // Estricta = pasada la ventana se pierde el importe entero. Se detecta SOLO por el
  // porcentaje: el preset `strict` manda `{penaltyPercent: 100, refundable: true}` (ver
  // cancellation-math.ts) — exigir `!refundable` dejaría afuera justo al caso más común.
  const strict = summary.tiers.some((tier) => tier.penaltyPercent >= 100)
  const deadline = deadlineFragment(summary.freeUntilHours)

  if (strict) {
    return { tone: 'danger', headline: t('pay.cancelStrictHeadline', { deadline }), detail: t('pay.cancelStrictDetail') }
  }

  return { tone: 'neutral', headline: t('pay.cancelFreeUntil', { deadline }), detail: penalty }
})

async function onApplyPromo() {
  if (!store.promoCode.trim()) return
  await store.applyPromo()
}

// El botón ya está `:disabled` sin el tilde, pero el guard va IGUAL: un doble evento, un atajo
// de teclado o un refactor que pierda el `:disabled` no pueden cobrarle a alguien que nunca
// aceptó las condiciones. Mismo criterio que `BookingModal.vue` `onPrimary()`.
async function onPay() {
  if (!termsAccepted.value) return
  await store.pay()
}

// Expuesto para que el guard se pueda ejercer sin el botón (el test lo llama directo, que es
// lo que haría un doble evento o un atajo que se saltee el `:disabled`) — mismo patrón que
// `BookingModal.vue` `defineExpose({ onPrimary })`.
defineExpose({ onPay })

function promoReasonLabel(reason?: PromoValidationReason): string {
  switch (reason) {
    case 'not_found': return t('pay.promoReasonNotFound')
    case 'expired': return t('pay.promoReasonExpired')
    case 'max_uses_reached': return t('pay.promoReasonMaxUses')
    case 'min_amount_not_met': return t('pay.promoReasonMinAmount')
    case 'inactive': return t('pay.promoReasonInactive')
    default: return t('pay.promoReasonDefault')
  }
}

function prettify(name: string): string {
  if (!name) return '—'
  return name.charAt(0).toUpperCase() + name.slice(1)
}
</script>
