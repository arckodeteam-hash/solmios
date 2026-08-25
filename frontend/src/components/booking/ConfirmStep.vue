<template>
  <!--
    ConfirmStep.vue — Step 5 del widget (F2 2.9, solmi-direct-booking).
    Estado post-redirect desde Stripe. Lee `reservationId` + `accessToken` de query params
    (`?booking=:id&token=:token`) o, si los placeholders no llegaron reemplazados, del
    sessionStorage (backup que dejó `store.pay()` antes del redirect).

    Hace polling de `GET /api/public/reservations/:id?token=` hasta 10 intentos (3s c/u)
    esperando `paymentStatus: 'paid'`. Estados:
      - paid/confirmed → confirmación con datos
      - pending → "aún procesando, no cierres"
      - failed/cancelled → error + CTA reintentar

    NOTA: la página de confirmación DEFINITIVA (con wallet pass, código TTLock, email
    recovery) es F3 3.17. Este step es el mínimo viable del widget — muestra el estado
    del pago tras volver de Stripe y desambigua los 3 outcomes.
    Todos los textos via i18n (es/en/pt, task 2.14).
  -->
  <section class="space-y-4 text-center">
    <div v-if="pollingState === 'loading'" class="py-8">
      <div class="h-12 w-12 mx-auto rounded-full border-4 border-cyan/30 border-t-cyan animate-spin" />
      <h2 class="text-lg font-black text-navy mt-4">{{ t('confirm.loading') }}</h2>
      <p class="text-sm text-text-muted mt-1">{{ t('confirm.doNotClose') }}</p>
    </div>

    <div v-else-if="pollingState === 'success'" class="py-6">
      <div class="text-5xl mb-3">✅</div>
      <h2 class="text-xl font-black text-navy">
        {{ isPendingApproval ? t('confirm.successPendingApproval') : t('confirm.success') }}
      </h2>
      <p class="text-sm text-text-muted mt-2"
         v-html="successBody">
      </p>

      <!-- Tarea 3.4 (corrección 2026-08-25) — mismo aviso que booking-confirmation.vue
           (página standalone): "confirmación instantánea" apagada, el pago se procesó pero
           el hotel todavía tiene que revisar la reserva. -->
      <div v-if="isPendingApproval" class="mt-4 rounded-2xl border-2 border-gold/40 bg-gold/5 p-4 text-left">
        <p class="text-sm font-bold text-navy">{{ t('confirm.pendingApprovalNotice') }}</p>
      </div>

      <div v-if="reservation" class="mt-5 rounded-2xl border border-slate-200 bg-white p-4 text-left text-sm space-y-1">
        <div class="flex justify-between">
          <span class="text-text-muted">{{ t('confirm.checkIn') }}</span>
          <span class="font-bold text-navy">{{ reservation.reservation.checkIn }}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-text-muted">{{ t('confirm.checkOut') }}</span>
          <span class="font-bold text-navy">{{ reservation.reservation.checkOut }}</span>
        </div>
        <div v-if="reservation.guest?.name" class="flex justify-between">
          <span class="text-text-muted">{{ t('confirm.guest') }}</span>
          <span class="font-bold text-navy">{{ reservation.guest.name }}</span>
        </div>
        <div v-if="reservation.reservation.totalAmount" class="flex justify-between border-t border-slate-200 pt-1 mt-1">
          <span class="text-text-muted">{{ t('confirm.total') }}</span>
          <span class="font-bold text-navy">{{ reservation.reservation.totalAmount }}</span>
        </div>
      </div>

      <p class="text-[11px] text-text-muted mt-4">
        {{ t('confirm.keepNumber') }}
        <span class="font-mono font-bold">{{ reservation?.reservation.id?.slice(0, 8) }}</span>
      </p>
    </div>

    <div v-else-if="pollingState === 'pending'" class="py-6">
      <div class="text-5xl mb-3">⏳</div>
      <h2 class="text-xl font-black text-navy">{{ t('confirm.pending') }}</h2>
      <p class="text-sm text-text-muted mt-2">{{ t('confirm.pendingBody') }}</p>
      <button
        type="button"
        class="mt-5 rounded-xl border-2 border-cyan px-6 py-3 text-sm font-bold text-cyan hover:bg-cyan hover:text-white"
        @click="startPolling"
      >
        {{ t('confirm.retry') }}
      </button>
    </div>

    <div v-else class="py-6">
      <div class="text-5xl mb-3">⚠️</div>
      <h2 class="text-xl font-black text-navy">{{ t('confirm.errorTitle') }}</h2>
      <p class="text-sm text-text-muted mt-2">{{ errorMessage }}</p>
      <router-link
        :to="`/book/${store.slug}`"
        class="inline-block mt-5 rounded-xl bg-cyan px-6 py-3 text-sm font-bold text-white hover:bg-cyan-light"
      >
        {{ t('confirm.retryCta') }}
      </router-link>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useBookingStore, readStoredReservation, clearStoredReservation } from '@/composables/useBooking'
import { useBookingI18nStore } from '@/composables/useBookingI18n'
import type { PublicReservationResponse } from '@/types/booking'

const store = useBookingStore()
const route = useRoute()
const { t } = useBookingI18nStore()

type PollingState = 'loading' | 'success' | 'pending' | 'error'
const pollingState = ref<PollingState>('loading')
const reservation = ref<PublicReservationResponse | null>(null)
const errorMessage = ref(t('confirm.errorDefault'))

const MAX_ATTEMPTS = 10
const POLL_INTERVAL_MS = 3000
let timer: ReturnType<typeof setTimeout> | null = null
let attempts = 0

/** Tarea 3.4 (corrección 2026-08-25) — mismo criterio que booking-confirmation.vue. */
const isPendingApproval = computed(() => reservation.value?.reservation?.approvalStatus === 'pending')

/** Cuerpo del mensaje de éxito con el email embebido. Como el email viene del backend y
 *  ya pasó validación de formato ahí, no sanitizamos más acá (es textotrusted dentro de un
 *  <p> vía v-html porque queremos preservar el <strong>). */
const successBody = computed(() => {
  const email = reservation.value?.guest?.email || store.guest.email || ''
  // Escape básico de <>& para evitar XSS si el email tuviera chars raros.
  const safe = email.replace(/[<>&"']/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c === '"' ? '&quot;' : '&#39;',
  )
  return t('confirm.sentTo', { email: `<strong class="text-navy">${safe}</strong>` })
})

/** Resuelve (reservationId, accessToken) desde query params o sessionStorage.
 *  Query params llegan si el backend reemplazó `:id`/`:token` en successUrl. Si no, caemos
 *  al backup que dejó store.pay() en sessionStorage antes del redirect. */
function resolveIds(): { id: string; token: string } | null {
  const qId = typeof route.query.booking === 'string' ? route.query.booking : ''
  const qToken = typeof route.query.token === 'string' ? route.query.token : ''
  if (qId && qToken && qId !== ':id' && qToken !== ':token') {
    return { id: qId, token: qToken }
  }
  // Placeholders sin reemplazar o sin params → backup de sessionStorage.
  const stored = readStoredReservation(store.slug)
  if (stored) return { id: stored.reservationId, token: stored.accessToken }
  return null
}

async function tick() {
  const ids = resolveIds()
  if (!ids) {
    pollingState.value = 'error'
    errorMessage.value = t('confirm.errorNotFound')
    return
  }
  const res = await store.pollConfirmation(ids.id, ids.token)
  if (!res) {
    pollingState.value = 'error'
    errorMessage.value = t('confirm.errorToken')
    return
  }
  reservation.value = res
  const ps = String(res.paymentStatus || '').toLowerCase()
  const rs = String(res.reservation.status || '').toLowerCase()
  if (ps === 'paid' || rs === 'confirmed' || rs === 'checked_in' || rs === 'checked_out') {
    pollingState.value = 'success'
    clearStoredReservation(store.slug) // limpieza: ya confirmada
    return
  }
  if (ps === 'failed' || rs === 'cancelled' || rs === 'no_show') {
    pollingState.value = 'error'
    errorMessage.value = t('confirm.errorPayment')
    clearStoredReservation(store.slug)
    return
  }
  // pending / partial / unpaid → seguir pollando si quedan intentos.
  pollingState.value = 'pending'
  attempts++
  if (attempts >= MAX_ATTEMPTS) return // dejamos "pending" visible con botón reintentar
  timer = setTimeout(tick, POLL_INTERVAL_MS)
}

function startPolling() {
  if (timer) clearTimeout(timer)
  attempts = 0
  pollingState.value = 'loading'
  void tick()
}

onMounted(startPolling)
onUnmounted(() => {
  if (timer) clearTimeout(timer)
})
</script>
