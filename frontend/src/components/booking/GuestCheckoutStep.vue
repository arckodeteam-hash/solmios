<template>
  <!--
    GuestCheckoutStep.vue — Step 3 del widget (F2 2.9, solmi-direct-booking).
    Form de datos del huésped SIN requerir cuenta (spec: guest checkout anónimo REQUIRED).
    Nombre + email + teléfono + hora estimada de llegada + pedidos especiales (opcionales).
    La cuenta es una fricción que el spec explicitamente prohíbe forzar.

    Tarea 3.1 (solmi-direct-booking-qa-fixes) — el textarea de "notas" genérico original NO
    llegaba al backend: `notes` no estaba declarado en el schema, `validateSchema` lo
    descartaba en el controller antes de llegar al usecase, así que cualquier pedido que el
    huésped escribiera ahí se perdía en silencio. Corrección 2026-08-22 (feedback directo del
    dueño del producto: recibir pedidos del huésped es un requisito duro, no un nice-to-have):
    el textarea de pedidos especiales vuelve a existir, pero ahora como `specialRequests`,
    declarado en el schema — SÍ llega a `Reservations.notes`, etiquetado "Pedido especial",
    donde el recepcionista lo ve. `estimatedArrival` (agregado en la misma tarea, campo
    estructurado corto) se mantiene aparte porque no es lo mismo que un pedido en texto libre.

    Validación (acceptance 2.9):
      - name: ≥ 2 chars (trim)
      - email: regex estándar EMAIL_RE
      - phone: ≥ 5 chars (trim) — formatos internacionales (+1 809…)
      - estimatedArrival / specialRequests: opcionales
    `store.guestValid` habilita el botón "Continuar al pago". El store mapea estos campos al
    body del POST /public/booking (guestName/guestEmail/guestPhone/estimatedArrival/specialRequests).
    Todos los textos via i18n (es/en/pt, task 2.14).
  -->
  <section class="space-y-4">
    <header class="space-y-1">
      <h2 class="text-xl font-black text-navy">{{ t('guest.title') }}</h2>
      <p class="text-sm text-text-muted">{{ t('guest.subtitle') }}</p>
    </header>

    <form class="space-y-3" @submit.prevent="onSubmit">
      <label class="block">
        <span class="block text-xs font-bold text-text-muted uppercase tracking-wide mb-1">{{ t('guest.name') }}</span>
        <input
          v-model="store.guest.name"
          type="text"
          autocomplete="name"
          required
          class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-base text-navy focus:border-cyan focus:ring-2 focus:ring-cyan/30 focus:outline-none"
          :class="{ 'border-red-400': touched && nameError }"
          @blur="touched = true"
        />
        <span v-if="touched && nameError" class="block text-xs text-red-600 mt-1">{{ nameError }}</span>
      </label>

      <label class="block">
        <span class="block text-xs font-bold text-text-muted uppercase tracking-wide mb-1">{{ t('guest.email') }}</span>
        <input
          v-model="store.guest.email"
          type="email"
          autocomplete="email"
          inputmode="email"
          required
          class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-base text-navy focus:border-cyan focus:ring-2 focus:ring-cyan/30 focus:outline-none"
          :class="{ 'border-red-400': touched && emailError }"
          @blur="touched = true"
        />
        <span v-if="touched && emailError" class="block text-xs text-red-600 mt-1">{{ emailError }}</span>
      </label>

      <label class="block">
        <span class="block text-xs font-bold text-text-muted uppercase tracking-wide mb-1">{{ t('guest.phone') }}</span>
        <input
          v-model="store.guest.phone"
          type="tel"
          autocomplete="tel"
          inputmode="tel"
          required
          class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-base text-navy focus:border-cyan focus:ring-2 focus:ring-cyan/30 focus:outline-none"
          :class="{ 'border-red-400': touched && phoneError }"
          @blur="touched = true"
        />
        <span v-if="touched && phoneError" class="block text-xs text-red-600 mt-1">{{ phoneError }}</span>
      </label>

      <label class="block">
        <span class="block text-xs font-bold text-text-muted uppercase tracking-wide mb-1">{{ t('guest.arrivalTime') }}</span>
        <input
          v-model="store.guest.estimatedArrival"
          type="text"
          autocomplete="off"
          maxlength="100"
          class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-base text-navy focus:border-cyan focus:ring-2 focus:ring-cyan/30 focus:outline-none"
          :placeholder="t('guest.arrivalTimePlaceholder')"
        />
      </label>

      <label class="block">
        <span class="block text-xs font-bold text-text-muted uppercase tracking-wide mb-1">{{ t('guest.specialRequests') }}</span>
        <textarea
          v-model="store.guest.specialRequests"
          rows="2"
          maxlength="500"
          class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-base text-navy focus:border-cyan focus:ring-2 focus:ring-cyan/30 focus:outline-none"
          :placeholder="t('guest.specialRequestsPlaceholder')"
        />
      </label>

      <button
        type="submit"
        :disabled="!store.guestValid"
        class="w-full rounded-xl bg-cyan px-6 py-4 text-base font-black text-white shadow-card transition hover:bg-cyan-light disabled:cursor-not-allowed disabled:opacity-50"
      >
        {{ t('guest.cta') }}
      </button>
    </form>
  </section>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useBookingStore } from '@/composables/useBooking'
import { useBookingI18nStore } from '@/composables/useBookingI18n'

const store = useBookingStore()
const { t } = useBookingI18nStore()

// `touched` se setea al primer blur. Evita gritar "error" antes de que el usuario escriba.
const touched = ref(false)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const nameError = computed(() =>
  store.guest.name.trim().length < 2 ? t('guest.nameError') : '',
)
const emailError = computed(() =>
  !EMAIL_RE.test(store.guest.email.trim()) ? t('guest.emailError') : '',
)
const phoneError = computed(() =>
  store.guest.phone.trim().length < 5 ? t('guest.phoneError') : '',
)

function onSubmit() {
  touched.value = true
  if (!store.guestValid) return
  store.next()
}
</script>
