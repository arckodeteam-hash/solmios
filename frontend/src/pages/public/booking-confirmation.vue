<template>
  <!--
    booking-confirmation.vue (F3 3.17, solmi-direct-booking / spec wallet-pass + booking-unification)
    Página pública STANDALONE que muestra el estado de la reserva tras el redirect de Stripe.
    Distingue del ConfirmStep.vue (step interno del widget F2): esa vista vive dentro del
    flujo SPA; esta página es un destino de redirección desde el gateway.

    Ruta: `/h/:slug/confirm?booking=:id&token=:token` (registrada en router/index.ts).

    ── CÓMO LLEGA EL USUARIO ACÁ ─────────────────────────────────────────────────
    Tras `useBooking.pay()` (F2 2.8) el widget hace redirect a Stripe Checkout. La
    successUrl que el widget arma es `/h/<slug>/confirm?booking=:id&token=:token` (placeholders
    LITERALES — el backend `stripe.ts` NO reemplaza `:id`/`:token`). Cuando Stripe vuelve a
    nuestro successUrl, lo hace con los placeholders crudos (ver reporte F2 + mem
    `stripe-success-url-placeholders`).

    Por eso esta página tiene DOS estrategias para reconstruir (id, token):
      1. Query real: `?booking=abc&token=xyz` (cuando el backend logre reemplazar los placeholders
         — deuda conocida del backend, F2 Pieza 2 deja el hack documentado).
      2. SessionStorage: si los placeholders llegan literales (`:id`/`:token`), leemos el backup
         que `useBooking.pay()` dejó en `sessionStorage['booking-widget:<slug>:last-reservation']`
         (TTL 24h) ANTES de hacer el redirect off-site a Stripe.

    ── ESTADOS QUE MANEJA ─────────────────────────────────────────────────────────
      - 'loading'    → poll en curso, no mostrar CTAs.
      - 'success'    → pago confirmado (paymentStatus=paid | reservation.status=confirmed/…).
      - 'pending'    → pago en proceso, no cerrar.
      - 'error'      → pago failed/cancelled o no se encontró la reserva (404 token inválido).

    ── WALLET PASS — DEUDA DOCUMENTADA (NO rompe acceptance literal del task) ─────
    El spec wallet-pass/spec.md pide botones "Agregar a Apple Wallet" / "Agregar a Google Wallet"
    + lockCode visible. El backend (commiteado F3 Pieza 2) define que el pass se entrega por
    EMAIL (3.9) y NO hay endpoint público del pass: `WalletPass/index.ts` declara explícitamente
    "No hay ruta pública del pass". El response del endpoint público `GET /api/public/reservations/:id?token=`
    NO incluye `lockCode` ni `walletPass`. Por lo tanto, esta página no puede mostrarlos hoy.

    El task 3.17 acceptance literal dice: "Si no hay endpoint público del pass, la página confirma
    el estado y muestra lockCode si viene en la response." → lockCode NO viene → solo confirmamos.

    La UI está armada para renderizar los botones CONDICIONALMENTE si alguna vez el backend
    agrega el pass al response (campo `walletPass` opcional). Hoy es null → los botones no aparecen.

    Tracking F3 3.18: en estado success, dispara 'purchase' con event_id=reservationId
    (mismo que el backend CAPI server-side → GA4/Meta deduplican).

    Layout mobile-first, mismo estilo del widget (usa useBookingI18n para textos).
  -->
  <div class="min-h-screen bg-surface flex flex-col">
    <!-- Header mínimo con nombre del hotel (si cargó). -->
    <header class="bg-white border-b border-slate-200 sticky top-0 z-10">
      <div class="max-w-md mx-auto px-4 py-3 flex items-center gap-2">
        <h1 v-if="hotelName" class="font-black text-navy truncate">{{ hotelName }}</h1>
        <h1 v-else class="font-black text-navy">{{ t('wrapper.titleFallback') }}</h1>
      </div>
    </header>

    <main class="flex-1 max-w-md mx-auto w-full px-4 py-6">
      <!-- CANCELLED (F4 #627) — el huésped canceló su reserva desde esta página. -->
      <section v-if="cancelResult" class="text-center py-6">
        <div class="text-5xl mb-3">❌</div>
        <h2 class="text-xl font-black text-navy">Reserva cancelada</h2>
        <p class="text-sm text-text-muted mt-2">
          Tu reserva fue cancelada correctamente.
        </p>

        <!-- Detalle de reembolso/penalty según la política aplicada. -->
        <div v-if="cancelResult.refundAmount > 0" class="mt-4 rounded-2xl border border-slate-200 bg-white p-4 text-left text-sm space-y-1">
          <div class="flex justify-between">
            <span class="text-text-muted">Reembolso</span>
            <span class="font-bold text-success">{{ cancelResult.refundAmount }}</span>
          </div>
          <div v-if="cancelResult.cancellationFee > 0" class="flex justify-between">
            <span class="text-text-muted">Cargo por cancelación</span>
            <span class="font-bold text-danger">{{ cancelResult.cancellationFee }}</span>
          </div>
        </div>
        <p v-else-if="cancelResult.cancellationFee > 0" class="text-sm text-text-muted mt-3">
          No hay reembolso según la política de cancelación aplicada.
        </p>

        <p v-if="cancelResult.idempotent" class="text-xs text-text-muted mt-3">
          Esta reserva ya estaba cancelada.
        </p>

        <router-link
          v-if="slug"
          :to="`/h/${slug}`"
          class="inline-block mt-5 text-sm font-extrabold text-cyan hover:text-cyan-light"
        >
          ← Volver al inicio
        </router-link>
      </section>

      <!-- LOADING -->
      <section v-else-if="pollingState === 'loading'" class="text-center py-10">
        <div class="h-12 w-12 mx-auto rounded-full border-4 border-cyan/30 border-t-cyan animate-spin" />
        <h2 class="text-lg font-black text-navy mt-4">{{ t('confirm.loading') }}</h2>
        <p class="text-sm text-text-muted mt-1">{{ t('confirm.doNotClose') }}</p>
      </section>

      <!-- SUCCESS -->
      <section v-else-if="pollingState === 'success'" class="text-center py-6">
        <div class="text-5xl mb-3">✅</div>
        <h2 class="text-xl font-black text-navy">
          {{ isPendingApproval ? t('confirm.successPendingApproval') : t('confirm.success') }}
        </h2>
        <p class="text-sm text-text-muted mt-2" v-html="successBody" />

        <!--
          Tarea 3.4 (corrección 2026-08-25) — "Confirmación instantánea" apagada: el pago se
          procesó igual (por eso seguimos en la rama SUCCESS, no en un estado de error/espera
          de pago), pero el hotel todavía tiene que revisar la reserva. El título de arriba ya
          evita decir "confirmada" cuando no lo está; este aviso explica el porqué.
        -->
        <div v-if="isPendingApproval" class="mt-4 rounded-2xl border-2 border-gold/40 bg-gold/5 p-4 text-left">
          <p class="text-sm font-bold text-navy">{{ t('confirm.pendingApprovalNotice') }}</p>
        </div>

        <!-- Wallet pass — CONDICIONAL. Hoy `pass` siempre es null (no hay endpoint público).
             Si el backend agrega `walletPass` al response del endpoint público, los botones
             se muestran automáticamente. Deuda documentada arriba. -->
        <div v-if="hasWalletPass" class="mt-5 space-y-2">
          <p class="text-xs font-bold uppercase tracking-wide text-text-muted">Tu pase de acceso</p>
          <a
            v-if="walletPass?.appleUrl"
            :href="walletPass.appleUrl"
            class="block rounded-xl bg-black px-5 py-3 text-sm font-bold text-white hover:opacity-80 transition"
          >
             Apple Wallet
          </a>
          <a
            v-if="walletPass?.googleUrl"
            :href="walletPass.googleUrl"
            class="block rounded-xl bg-white border border-slate-300 px-5 py-3 text-sm font-bold text-navy hover:border-cyan transition"
          >
             Google Wallet
          </a>
        </div>

        <!-- LockCode visible (solo si viniera en la response — hoy no viene). -->
        <div v-if="walletPass?.lockCode" class="mt-5 rounded-2xl border-2 border-cyan bg-cyan/5 p-4">
          <p class="text-[11px] uppercase tracking-wide text-text-muted mb-1">{{ t('confirm.accessCode') }}</p>
          <p class="font-mono font-black text-2xl tracking-[0.3em] text-navy">{{ walletPass.lockCode }}</p>
        </div>

        <!-- Detalles de la reserva. -->
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
            <span class="font-bold text-navy">{{ fmtMoney(reservation.reservation.totalAmount) }}</span>
          </div>
          <!-- Lo que el huésped pagó. Antes solo se mostraba el total y no había forma de saber
               si ya estaba cobrado: el backend mandaba `paymentStatus` leyendo una columna que
               no existe, así que siempre decía 'unpaid' (reporte de cliente 2026-08-30). -->
          <div v-if="amountPaid > 0" class="flex justify-between" data-testid="confirm-paid">
            <span class="text-text-muted">{{ t('confirm.paid') }}</span>
            <span class="font-bold text-teal">{{ fmtMoney(amountPaid) }}</span>
          </div>
          <div v-if="pendingAmount > 0" class="flex justify-between" data-testid="confirm-pending">
            <span class="text-text-muted">{{ t('confirm.pendingAmount') }}</span>
            <span class="font-bold text-gold">{{ fmtMoney(pendingAmount) }}</span>
          </div>
        </div>

        <!-- El estado en palabras, no solo números: es lo primero que busca quien acaba de pagar. -->
        <p v-if="reservation" class="mt-3 text-sm font-bold" data-testid="confirm-payment-state"
          :class="paymentState === 'paid' ? 'text-teal' : paymentState === 'partial' ? 'text-gold' : 'text-text-muted'">
          {{ paymentState === 'paid' ? t('confirm.paidInFull')
             : paymentState === 'partial' ? t('confirm.partiallyPaid')
             : t('confirm.notPaid') }}
        </p>

        <p class="text-[11px] text-text-muted mt-4">
          {{ t('confirm.keepNumber') }}
          <span class="font-mono font-bold">{{ reservation?.reservation.id?.slice(0, 8) }}</span>
        </p>

        <!-- Volver al inicio. -->
        <router-link
          v-if="slug"
          :to="`/h/${slug}`"
          class="inline-block mt-5 text-sm font-extrabold text-cyan hover:text-cyan-light"
        >
          ← {{ t('confirm.backHome') }}
        </router-link>

        <!-- F4 #627 — Cancelar reserva (botón sutil, solo reservas activas). -->
        <button
          v-if="canCancel"
          type="button"
          class="block mx-auto mt-3 text-sm font-bold text-danger hover:opacity-70 transition"
          @click="showCancelModal = true"
        >
          Cancelar reserva
        </button>
      </section>

      <!-- PENDING -->
      <section v-else-if="pollingState === 'pending'" class="text-center py-6">
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
      </section>

      <!-- ERROR -->
      <section v-else class="text-center py-6">
        <div class="text-5xl mb-3">⚠️</div>
        <h2 class="text-xl font-black text-navy">{{ t('confirm.errorTitle') }}</h2>
        <p class="text-sm text-text-muted mt-2">{{ errorMessage }}</p>
        <router-link
          v-if="slug"
          :to="`/book/${slug}`"
          class="inline-block mt-5 rounded-xl bg-cyan px-6 py-3 text-sm font-bold text-white hover:bg-cyan-light"
        >
          {{ t('confirm.retryCta') }}
        </router-link>
      </section>

      <!-- F4 #627 — Modal de confirmación de cancelación. -->
      <AppModal
        :open="showCancelModal"
        title="Cancelar reserva"
        size="sm"
        :closable="!isCancelling"
        :close-on-backdrop="!isCancelling"
        @close="showCancelModal = false"
      >
        <div class="space-y-3">
          <p v-if="cancelError" class="text-sm text-danger font-medium">{{ cancelError }}</p>
          <p v-else class="text-sm text-text-muted">
            ¿Seguro que querés cancelar tu reserva? Esta acción no se puede deshacer. El monto
            del reembolso depende de la política de cancelación del hotel.
          </p>
        </div>
        <template #footer>
          <button
            type="button"
            class="rounded-xl px-5 py-2.5 text-sm font-bold text-text-muted hover:bg-surface transition"
            :disabled="isCancelling"
            @click="showCancelModal = false"
          >
            No, mantener
          </button>
          <button
            type="button"
            class="rounded-xl bg-danger px-5 py-2.5 text-sm font-bold text-white hover:opacity-80 transition disabled:opacity-50"
            :disabled="isCancelling"
            @click="confirmCancellation"
          >
            {{ isCancelling ? 'Cancelando…' : 'Sí, cancelar' }}
          </button>
        </template>
      </AppModal>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { BookingService } from '@/services/Booking.service'
import { PublicHotelService } from '@/services/PublicHotel.service'
import { readStoredReservation, clearStoredReservation, cancelReservation } from '@/composables/useBooking'
import { useBookingI18nStore } from '@/composables/useBookingI18n'
import { useTracking, initTracking } from '@/composables/useTracking'
import AppModal from '@/components/ui/AppModal.vue'
import type { PublicReservationResponse, CancelReservationResponse } from '@/types/booking'
import { CurrencyCode } from '@/types/currency'

const route = useRoute()
const { t } = useBookingI18nStore()

type PollingState = 'loading' | 'success' | 'pending' | 'error'
const pollingState = ref<PollingState>('loading')
const reservation = ref<PublicReservationResponse | null>(null)
const errorMessage = ref(t('confirm.errorDefault'))
const hotelName = ref('')
const slug = ref('')
// F4 4.1 — hotelId resuelto desde el slug. Lo lee firePurchaseTracking para persistir el
// evento 'purchase' (mapeado a 'confirm' server-side) con el hotel correcto en tracking_events.
const hotelIdForTracking = ref('')
// Currency real del hotel (para tracker). Default 'USD' si no carga (mismo fallback que antes).
const hotelCurrency = ref<string>(CurrencyCode.USD)

// ── Pago del huésped ────────────────────────────────────────────────────────
// El backend deriva estos tres de `payments` (fuente de verdad del dinero). Antes mandaba
// `paymentStatus` leyendo una columna inexistente de `reservations` y siempre decía 'unpaid'.
const amountPaid = computed(() => Number(reservation.value?.reservation?.amountPaid ?? 0))
const pendingAmount = computed(() => Number(reservation.value?.reservation?.pendingAmount ?? 0))
const paymentState = computed(() => String(reservation.value?.reservation?.paymentStatus ?? 'pending'))

/** Importe con su moneda: "613.60 USD". Sin esto la pantalla mostraba "613.6" pelado. */
function fmtMoney(amount: unknown): string {
  const n = Number(amount)
  if (!Number.isFinite(n)) return '—'
  const currency = String(reservation.value?.reservation?.currency || hotelCurrency.value || '').toUpperCase()
  return currency ? `${n.toFixed(2)} ${currency}` : n.toFixed(2)
}

const MAX_ATTEMPTS = 10
const POLL_INTERVAL_MS = 3000
let timer: ReturnType<typeof setTimeout> | null = null
let attempts = 0
let trackedPurchase = false // guard anti-doble-fire (StrictMode, onMounted twice, etc.)

// ── F4 #627 — Auto-cancelación del huésped ──────────────────────────────────
// El botón "Cancelar reserva" aparece solo en estado SUCCESS con reserva activa
// (confirmed/pending). El modal confirma la acción; el penalty se revela en el
// resultado (no hay endpoint de preview — la política se computa al cancelar).
const showCancelModal = ref(false)
const isCancelling = ref(false)
const cancelResult = ref<CancelReservationResponse | null>(null)
const cancelError = ref<string | null>(null)

/** Solo se puede cancelar si la reserva está activa (confirmed/pending). */
const canCancel = computed(() => {
  if (cancelResult.value) return false
  const rs = reservation.value?.reservation?.status?.toLowerCase() || ''
  return rs === 'confirmed' || rs === 'pending'
})

/** Tarea 3.4 (corrección 2026-08-25) — el pago se completó (por eso llegamos a SUCCESS) pero
 *  el hotel todavía no aprobó la reserva ("confirmación instantánea" apagada). */
const isPendingApproval = computed(() => reservation.value?.reservation?.approvalStatus === 'pending')

async function confirmCancellation(): Promise<void> {
  const ids = resolveIds()
  if (!ids) {
    cancelError.value = 'No pudimos verificar tu reserva para cancelar.'
    return
  }
  isCancelling.value = true
  cancelError.value = null
  try {
    const result = await cancelReservation(ids.id, ids.token)
    cancelResult.value = result
    showCancelModal.value = false
    clearStoredReservation(slug.value)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'No se pudo cancelar. Intentá de nuevo o contactá al hotel.'
    // 409 (checked_in) o 404 (token inválido) → el mensaje del backend es legible.
    cancelError.value = msg
  } finally {
    isCancelling.value = false
  }
}

/** Wallet pass opcional en el response. Hoy el backend NO lo devuelve (deuda del backend,
 *  ver header comment). Definimos el tipo inline para no acoplarnos a un módulo backend. */
interface WalletPassInfo {
  appleUrl?: string | null
  googleUrl?: string | null
  lockCode?: string | null
}

/** Acceso defensivo al campo `walletPass` que el response podría incluir en el futuro.
 *  Casting via unknown para evitar `any` y mantener typecheck estricto. */
const walletPass = computed<WalletPassInfo | null>(() => {
  const raw = (reservation.value as unknown as { walletPass?: WalletPassInfo } | null)?.walletPass
  return raw ?? null
})

const hasWalletPass = computed(() =>
  !!walletPass.value && (!!walletPass.value.appleUrl || !!walletPass.value.googleUrl || !!walletPass.value.lockCode),
)

/** Body del mensaje de éxito, con el email embebido como <strong>. Sanitizado básico de
 *  <>&"' para no abrir superficie XSS por un email raro. */
const successBody = computed(() => {
  const email = reservation.value?.guest?.email || ''
  const safe = email.replace(/[<>&"']/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c === '"' ? '&quot;' : '&#39;',
  )
  return t('confirm.sentTo', { email: `<strong class="text-navy">${safe}</strong>` })
})

/**
 * Resuelve (reservationId, accessToken) priorizando query params reales, con fallback a
 * sessionStorage si los placeholders llegaron literales. DEUDA del backend stripe.ts
 * (no reemplaza `:id`/`:token`) — F2 dejó el backup en sessionStorage.
 *
 * Casos que cubre:
 *   - Query real: ?booking=abc&token=xyz → directamente válido.
 *   - Placeholders literales: ?booking=:id&token=:token → cae a sessionStorage.
 *   - Sin query params pero con backup en sessionStorage (poco común pero posible si Stripe
 *     recorta la query al redirigir) → cae a sessionStorage.
 *   - Sin nada → no podemos recuperar, mostramos error "no encontramos tu reserva".
 */
function resolveIds(): { id: string; token: string } | null {
  const qId = typeof route.query.booking === 'string' ? route.query.booking : ''
  const qToken = typeof route.query.token === 'string' ? route.query.token : ''
  // Detectar placeholders literales (deuda backend) → forzar fallback.
  if (qId && qToken && qId !== ':id' && qToken !== ':token') {
    return { id: qId, token: qToken }
  }
  // Fallback al backup que useBooking.pay() dejó ANTES del redirect off-site a Stripe.
  const stored = readStoredReservation(slug.value)
  if (stored) return { id: stored.reservationId, token: stored.accessToken }
  return null
}

/** Un tick del poll: valida ids, pide estado, clasifica resultado. */
async function tick(): Promise<void> {
  const ids = resolveIds()
  if (!ids) {
    pollingState.value = 'error'
    errorMessage.value = t('confirm.errorNotFound')
    return
  }
  try {
    const res = await BookingService.getReservation(ids.id, ids.token)
    reservation.value = res
    const ps = String(res.paymentStatus || '').toLowerCase()
    const rs = String(res.reservation.status || '').toLowerCase()
    if (ps === 'paid' || rs === 'confirmed' || rs === 'checked_in' || rs === 'checked_out') {
      pollingState.value = 'success'
      clearStoredReservation(slug.value) // limpieza: reserva confirmada
      firePurchaseTracking(res.reservation.id, res.reservation.totalAmount)
      return
    }
    if (ps === 'failed' || rs === 'cancelled' || rs === 'no_show') {
      pollingState.value = 'error'
      errorMessage.value = t('confirm.errorPayment')
      clearStoredReservation(slug.value)
      return
    }
    // pending / partial / unpaid → seguimos pollando si quedan intentos.
    pollingState.value = 'pending'
    attempts++
    if (attempts >= MAX_ATTEMPTS) return // dejamos "pending" con botón reintentar
    timer = setTimeout(tick, POLL_INTERVAL_MS)
  } catch {
    // 404 (token inválido / sin reserva) o error de red → error genérico.
    pollingState.value = 'error'
    errorMessage.value = t('confirm.errorToken')
  }
}

function startPolling(): void {
  if (timer) clearTimeout(timer)
  attempts = 0
  pollingState.value = 'loading'
  void tick()
}

/** Dispara 'purchase' client-side con event_id=reservationId para dedup con CAPI server-side.
 *  Idempotente (guard `trackedPurchase`): StrictMode o doble onMounted no lo duplica. */
function firePurchaseTracking(reservationId: string, amount?: number): void {
  if (trackedPurchase) return
  trackedPurchase = true
  try {
    useTracking().track('purchase', {
      eventId: reservationId,
      reservationId,
      value: typeof amount === 'number' ? amount : undefined,
      currency: hotelCurrency.value,
      optIn: true,
      hotelId: hotelIdForTracking.value,
    })
  } catch {
    // Tracking NUNCA debe romper la página de confirmación. Silencioso.
  }
}

onMounted(async () => {
  // Slug desde el path param.
  slug.value = typeof route.params.slug === 'string' ? route.params.slug : ''

  // Tracking: init con env vars si están (aceptance 3.18). Sin IDs → no-op silencioso.
  // Cuando exista endpoint público `GET /api/public/hotels/:slug/tracking-config`, el caller
  // lo consume y pasa los IDs al init aquí mismo.
  initTracking({
    metaPixelId: import.meta.env.VITE_META_PIXEL_ID ?? null,
    ga4MeasurementId: import.meta.env.VITE_GA4_MEASUREMENT_ID ?? null,
  })
  // Cargar el hotel (para header + nombre en success message). Best-effort: si falla, no
  // rompemos la confirmación (lo principal es mostrar el estado del pago).
  // F4 4.1 — Resolvemos el hotel ANTES de disparar 'view' para que el POST server-side del
  // funnel lleve el hotelId correcto (mismo cambio que en booking-widget.vue).
  if (slug.value) {
    try {
      const hotel = await PublicHotelService.getBySlug(slug.value)
      hotelName.value = hotel.name
      hotelIdForTracking.value = hotel.id
      // FE fix (audit) — Currency real del hotel (antes era hardcoded 'USD' en el tracker).
      if (hotel.currency) hotelCurrency.value = hotel.currency
    } catch {
      hotelName.value = ''
    }
  }

  // 'view' al montar (complementa page_view GA4 nativo).
  try {
    useTracking().track('view', { hotelId: hotelIdForTracking.value })
  } catch { /* noop */ }

  startPolling()
})

onUnmounted(() => {
  if (timer) clearTimeout(timer)
})
</script>
