<script setup lang="ts">
// pages/restaurante/cobrar.vue — Liquidación de la comanda (RES-7). Dos vías EXCLUYENTES: cargo a la
// habitación (folio, sin propina) o cobro directo (payment, con propina). La propina se persiste con
// billOrder antes del cobro directo; el backend recalcula y cobra el total bruto. Ver settlement.ts.
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  RestaurantService,
  type OrderWithLines,
  ORDER_STATUS_LABELS, ORDER_TYPE_LABELS,
} from '@/services/Restaurant.service'
import { SettingsService } from '@/services/Settings.service'
import { currencySymbol } from '@/composables/useCurrency'
import { CurrencyCode } from '@/types/currency'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppModal from '@/components/ui/AppModal.vue'
import { useToast } from '@/composables/useToast'
import { usePermissions } from '@/composables/usePermissions'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { can } = usePermissions()
const orderId = computed(() => String(route.params.id))
const canPay = computed(() => can('restaurant', 'edit'))
// Reembolso: solo órdenes pagadas con tarjeta (settlement='payment') y con permiso billing:create.
const canRefund = computed(() => can('billing', 'create'))

const refundOpen = ref(false)
const refundBusy = ref(false)

const loading = ref(true)
const busy = ref(false)
// Si tras un cobro no podemos confirmar el estado (falló el reload), bloqueamos reintentos: el backend
// pudo haber registrado el pago. El usuario recarga para ver el estado real. Evita re-cobrar a ciegas.
const unknownState = ref(false)
const order = ref<OrderWithLines | null>(null)
const currency = ref<string>(CurrencyCode.USD)
const tip = ref(0)
const method = ref('cash')
const reservationId = ref('')

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Efectivo' },
  { value: 'card', label: 'Tarjeta' },
  { value: 'transfer', label: 'Transferencia' },
]
const TIP_PRESETS = [0, 0.1, 0.15, 0.2]

const SETTLED = ['charged', 'paid']
const settled = computed(() => !!order.value && SETTLED.includes(order.value.status))
const cancelled = computed(() => order.value?.status === 'cancelled')
const refunded = computed(() => order.value?.status === 'refunded')
// fix-refund-pos-card: cobro con tarjeta esperando el webhook de Stripe (Checkout Session abierta).
const processingPayment = computed(() => order.value?.status === 'processing_payment')

// ─── Poll tras volver de Stripe Checkout (fix-refund-pos-card) ───
const POLL_INTERVAL_MS = 1500
const POLL_TIMEOUT_MS = 60_000
const polling = ref(false)
async function pollUntilPaid() {
  if (polling.value) return
  polling.value = true
  const deadline = Date.now() + POLL_TIMEOUT_MS
  try {
    while (Date.now() < deadline) {
      try {
        const fresh = await RestaurantService.getOrder(orderId.value)
        order.value = fresh
        if (fresh.status === 'paid') { toast.success('Cobro confirmado'); return }
        // El webhook de expiración ya la devolvió a 'billed' (mesa liberada) — dejar de esperar.
        if (fresh.status !== 'processing_payment') return
      } catch { /* red intermitente: seguir intentando hasta el timeout */ }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }
    toast.error('No pudimos confirmar el cobro', 'Revisá el Dashboard de Stripe o reintentá el cobro.')
  } finally {
    polling.value = false
  }
}
// Botón visible solo si la orden está pagada con tarjeta y el user tiene permiso.
const refundable = computed(() =>
  canRefund.value && order.value?.status === 'paid' && order.value?.settlement === 'payment'
)
const money = (n: number): string => `${currencySymbol(currency.value)}${Number(n || 0).toFixed(2)}`

// Subtotal/impuesto vienen del backend; la propina es editable y NO se grava. Total = subtotal + tax + tip.
const previewTotal = computed(() => {
  const o = order.value
  if (!o) return 0
  return Math.round((Number(o.subtotal || 0) + Number(o.tax || 0) + Number(tip.value || 0)) * 100) / 100
})
const canChargeRoom = computed(() => !!order.value && (!!reservationId.value.trim() || !!order.value.reservationId))

function applyTipPreset(pct: number) {
  const base = Number(order.value?.subtotal || 0)
  tip.value = Math.round(base * pct * 100) / 100
}

async function load() {
  loading.value = true
  try {
    const [ord, settings] = await Promise.all([
      RestaurantService.getOrder(orderId.value),
      SettingsService.get().catch(() => null),
    ])
    order.value = ord
    tip.value = Number(ord.tip || 0)
    reservationId.value = ord.reservationId || ''
    currency.value = (settings as any)?.hotel?.currency || 'USD'
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'No se pudo cargar la comanda')
  } finally {
    loading.value = false
  }
}
onMounted(async () => {
  await load()
  // fix-refund-pos-card: vuelta del Checkout de Stripe (successUrl/cancelUrl de payDirect).
  const paidParam = route.query.paid
  if (paidParam === 'cancelled') {
    toast.warning('Cobro cancelado', 'No se completó el pago con tarjeta. Podés reintentar.')
  } else if (paidParam === 'pending' || processingPayment.value) {
    // paidParam==='pending': volvió de successUrl. Sin query pero processing_payment: recargó la
    // página mientras esperaba — en ambos casos hay que retomar el poll.
    pollUntilPaid()
  }
})

/**
 * Recarga la comanda y avisa si el subtotal/impuesto cambió respecto a lo que se está mostrando (otra
 * tablet pudo agregar líneas). Devuelve true si cambió → hay que re-confirmar antes de cobrar, así el
 * cajero no cobra un monto y el backend registra otro (caja corta).
 */
async function refetchAndDetectChange(): Promise<boolean> {
  const prev = order.value!
  const fresh = await RestaurantService.getOrder(orderId.value)
  const changed = Number(fresh.subtotal || 0) !== Number(prev.subtotal || 0) || Number(fresh.tax || 0) !== Number(prev.tax || 0)
  order.value = fresh
  return changed
}

async function payDirect() {
  if (!canPay.value || busy.value || unknownState.value || !order.value) return
  if (previewTotal.value <= 0) { toast.warning('La comanda no tiene monto para cobrar'); return }
  busy.value = true
  try {
    // Anti-caja-corta: revalidar el monto contra el backend justo antes de cobrar.
    if (await refetchAndDetectChange()) {
      toast.warning('El total de la comanda cambió. Revisá el monto y volvé a cobrar.')
      return
    }
    // Persistir la propina (billOrder la fija y deja la comanda en `billed`), luego cobrar el total bruto.
    await RestaurantService.billOrder(orderId.value, { tip: Number(tip.value) || 0 })

    // fix-refund-pos-card: tarjeta abre una Stripe Checkout Session — successUrl/cancelUrl vuelven a
    // ESTA misma comanda con un query param que dispara el poll/aviso al volver (ver onMounted).
    const payload: { method: string; successUrl?: string; cancelUrl?: string } = { method: method.value }
    if (method.value === 'card') {
      const base = `${window.location.origin}/panel/restaurante/cobrar/${orderId.value}`
      payload.successUrl = `${base}?paid=pending`
      payload.cancelUrl = `${base}?paid=cancelled`
    }

    const result = await RestaurantService.payOrder(orderId.value, payload)
    if (result.checkoutUrl) {
      window.location.href = result.checkoutUrl
      return // navegando afuera del SPA — no hay nada más que hacer acá
    }
    toast.success('Comanda cobrada')
    router.push('/panel/restaurante/salon')
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'No se pudo cobrar')
    // Reflejar el estado real; si NO podemos, bloqueamos reintentos (el pago pudo haberse registrado).
    try { await load() } catch { unknownState.value = true }
  } finally {
    busy.value = false
  }
}

async function chargeRoom() {
  if (!canPay.value || busy.value || unknownState.value || !order.value) return
  if (Number(tip.value) > 0) { toast.warning('El cargo a habitación no incluye propina. Quitala o cobrá directo.'); return }
  busy.value = true
  try {
    if (await refetchAndDetectChange()) {
      toast.warning('El total de la comanda cambió. Revisá el monto y volvé a cargar.')
      return
    }
    const rid = reservationId.value.trim() || order.value.reservationId
    await RestaurantService.chargeToRoom(orderId.value, { reservationId: rid || undefined })
    toast.success('Cargado a la habitación')
    router.push('/panel/restaurante/salon')
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'No se pudo cargar a la habitación')
    try { await load() } catch { unknownState.value = true }
  } finally {
    busy.value = false
  }
}

async function confirmRefund() {
  if (!refundable.value || refundBusy.value || !order.value) return
  refundBusy.value = true
  try {
    await RestaurantService.refundOrder(orderId.value)
    toast.success('Orden reembolsada', 'Se devolvió el dinero al cliente y se repuso el inventario.')
    await load()
  } catch (e: unknown) {
    toast.error('No se pudo reembolsar', e instanceof Error ? e.message : 'Intentá de nuevo.')
  } finally {
    refundBusy.value = false
    refundOpen.value = false
  }
}
</script>

<template>
  <div>
    <div v-if="loading" class="py-20 text-center text-text-muted">Cargando…</div>

    <template v-else-if="order">
      <header class="mb-4">
        <router-link :to="`/panel/restaurante/comanda/${orderId}`" class="text-xs font-bold text-navy hover:underline">← Comanda</router-link>
        <h1 class="text-xl sm:text-2xl font-black text-navy mt-1">Cobrar {{ order.number || '' }}</h1>
        <p class="text-sm text-text-muted">{{ ORDER_TYPE_LABELS[order.type] }} · <span class="font-bold">{{ ORDER_STATUS_LABELS[order.status] }}</span></p>
      </header>

      <div v-if="cancelled">
        <EmptyState title="Comanda cancelada" message="Una comanda cancelada no se puede cobrar." />
      </div>
      <div v-else-if="refunded">
        <SectionCard title="Comanda reembolsada">
          <div class="py-6 text-center">
            <p class="text-coral font-bold">Reembolsada. El dinero fue devuelto al cliente.</p>
            <p class="text-2xl font-black text-navy mt-2 tabular-nums">{{ money(order.total) }}</p>
            <router-link to="/panel/restaurante/salon" class="inline-block mt-4 px-4 py-2 rounded-lg bg-navy text-white text-sm font-bold">Volver al salón</router-link>
          </div>
        </SectionCard>
      </div>
      <!-- fix-refund-pos-card: Checkout de Stripe abierto/vuelto — esperando el webhook. -->
      <div v-else-if="processingPayment">
        <SectionCard title="Esperando confirmación de pago">
          <div class="py-6 text-center">
            <p class="text-navy font-bold">{{ polling ? 'Confirmando el cobro con Stripe…' : 'El cobro con tarjeta está pendiente de confirmación.' }}</p>
            <p class="text-2xl font-black text-navy mt-2 tabular-nums">{{ money(order.total) }}</p>
            <p class="text-xs text-text-muted mt-2">Si el cajero canceló el Checkout, la comanda vuelve sola a "Con cuenta" en unos minutos.</p>
            <button @click="pollUntilPaid" :disabled="polling"
              class="inline-block mt-4 px-4 py-2 rounded-lg bg-navy text-white text-sm font-bold disabled:opacity-50">
              {{ polling ? 'Verificando…' : 'Verificar estado' }}
            </button>
          </div>
        </SectionCard>
      </div>

      <div v-else-if="settled">
        <SectionCard title="Comanda liquidada">
          <div class="py-6 text-center">
            <p class="text-navy font-bold">
              {{ order.status === 'paid' ? 'Cobrada directamente.' : 'Cargada a la habitación.' }}
            </p>
            <p class="text-2xl font-black text-navy mt-2 tabular-nums">{{ money(order.total) }}</p>
            <div class="mt-4 flex flex-wrap items-center justify-center gap-2">
              <router-link to="/panel/restaurante/salon" class="px-4 py-2 rounded-lg bg-navy text-white text-sm font-bold">Volver al salón</router-link>
              <button v-if="refundable" @click="refundOpen = true"
                class="px-4 py-2 rounded-lg bg-coral text-white text-sm font-bold hover:bg-coral/80 disabled:opacity-50">
                Reembolsar
              </button>
            </div>
          </div>
        </SectionCard>
      </div>

      <template v-else>
        <div v-if="unknownState" class="mb-4 p-3 rounded-xl border-2 border-coral/40 bg-coral/5 text-sm text-coral font-bold">
          No se pudo confirmar el estado de la comanda tras el último intento. Recargá la página para ver si el cobro quedó registrado antes de reintentar.
        </div>
        <!-- Desglose -->
        <SectionCard title="Cuenta" class="mb-4">
          <div class="divide-y divide-border mb-3">
            <div v-for="l in order.lines" :key="l.id" class="py-2 flex justify-between text-sm">
              <span class="text-navy">{{ l.quantity }}× {{ l.name }}</span>
              <span class="tabular-nums text-text-muted">{{ money(l.lineTotal) }}</span>
            </div>
          </div>
          <div class="space-y-1.5 text-sm">
            <div class="flex justify-between text-text-muted"><span>Subtotal</span><span class="tabular-nums">{{ money(order.subtotal) }}</span></div>
            <div class="flex justify-between text-text-muted"><span>Impuesto</span><span class="tabular-nums">{{ money(order.tax) }}</span></div>
            <div class="flex justify-between text-text-muted"><span>Propina</span><span class="tabular-nums">{{ money(tip) }}</span></div>
            <div class="flex justify-between text-navy font-black text-lg pt-1 border-t-2 border-navy/10"><span>Total</span><span class="tabular-nums">{{ money(previewTotal) }}</span></div>
          </div>
        </SectionCard>

        <!-- Propina (solo cobro directo) -->
        <SectionCard title="Propina" subtitle="Aplica al cobro directo. El cargo a habitación no la incluye." class="mb-4">
          <div class="flex flex-wrap items-center gap-2">
            <button v-for="p in TIP_PRESETS" :key="p" @click="applyTipPreset(p)"
              class="px-3 py-1.5 rounded-lg border-2 border-border text-navy text-xs font-bold hover:bg-surface">
              {{ p === 0 ? 'Sin propina' : `${p * 100}%` }}
            </button>
            <div class="flex items-center gap-1.5">
              <span class="text-xs text-text-muted">Monto</span>
              <input id="restaurante-cobrar-propina" name="tip" aria-label="Monto de la propina" v-model.number="tip" type="number" min="0" step="0.01"
                class="w-24 px-2 py-1.5 rounded-lg border-2 border-border text-sm text-navy focus:border-navy focus:outline-none tabular-nums" />
            </div>
          </div>
        </SectionCard>

        <!-- Cobro directo -->
        <SectionCard title="Cobro directo" class="mb-4">
          <div class="flex flex-wrap gap-2 mb-3">
            <button v-for="m in PAYMENT_METHODS" :key="m.value" @click="method = m.value"
              :class="['px-3 py-1.5 rounded-lg text-sm font-bold border-2', method === m.value ? 'bg-navy text-white border-navy' : 'border-border text-navy hover:bg-surface']">
              {{ m.label }}
            </button>
          </div>
          <button @click="payDirect" :disabled="!canPay || busy || unknownState"
            class="w-full py-3 rounded-xl bg-teal text-white font-black hover:bg-teal/80 disabled:opacity-50">
            Cobrar {{ money(previewTotal) }}
          </button>
        </SectionCard>

        <!-- Cargo a habitación -->
        <SectionCard title="Cargar a habitación" subtitle="Suma el consumo neto al folio de una reserva. Sin propina; el impuesto lo aplica el folio.">
          <label for="restaurante-cobrar-id-de-reserva" class="block text-xs font-bold text-text-muted mb-1">ID de reserva</label>
          <input id="restaurante-cobrar-id-de-reserva" name="reservationId" v-model="reservationId" type="text" placeholder="Reserva asociada (si la comanda ya la tiene, se usa esa)"
            class="w-full px-3 py-2 rounded-lg border-2 border-border text-sm text-navy focus:border-navy focus:outline-none mb-3" />
          <button @click="chargeRoom" :disabled="!canPay || busy || unknownState || !canChargeRoom"
            class="w-full py-3 rounded-xl bg-navy text-white font-black hover:bg-navy-light disabled:opacity-50">
            Cargar {{ money(order.subtotal) }} neto al folio
          </button>
          <p class="text-[11px] text-text-muted mt-2">El folio le aplica el impuesto al facturar (no se dobla el ITBIS).</p>
          <p v-if="!canChargeRoom" class="text-[11px] text-text-muted mt-2">La comanda no tiene reserva asociada. Ingresá un ID de reserva o cobrá directo.</p>
        </SectionCard>
      </template>
    </template>

    <EmptyState v-else title="Comanda no encontrada" message="La comanda no existe o no tenés acceso." />

    <!-- Confirmación de reembolso -->
    <AppModal :open="refundOpen" title="Reembolsar orden" size="sm" @close="refundOpen = false">
      <div class="space-y-3 text-sm text-navy">
        <p>Se <strong>devolverá el dinero al cliente</strong> y se <strong>repondrá el inventario vendido</strong>.</p>
        <p class="text-coral font-bold">Esta acción no se puede deshacer.</p>
        <p class="text-text-muted">Total: <span class="font-black text-navy tabular-nums">{{ money(order?.total ?? 0) }}</span></p>
      </div>
      <template #footer>
        <button @click="refundOpen = false" :disabled="refundBusy"
          class="px-4 py-2 rounded-lg border-2 border-border text-navy text-sm font-bold hover:bg-surface disabled:opacity-50">Cancelar</button>
        <button @click="confirmRefund" :disabled="refundBusy"
          class="px-4 py-2 rounded-lg bg-coral text-white text-sm font-bold hover:bg-coral/80 disabled:opacity-50">
          {{ refundBusy ? 'Procesando…' : 'Reembolsar' }}
        </button>
      </template>
    </AppModal>
  </div>
</template>
