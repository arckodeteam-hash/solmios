<script setup lang="ts">
// pages/restaurante/cobrar.vue — Liquidación de la comanda (RES-7). Dos vías EXCLUYENTES: cargo a la
// habitación (folio, sin propina) o cobro directo (payment, con propina). La propina se persiste con
// billOrder antes del cobro directo; el backend recalcula y cobra el total bruto. Ver settlement.ts.
// #209 — el cargo a habitación se elige con `ReservationPicker` (habitación/apellido), nunca tipeando un
// id. Si la comanda ya nació con reserva (room service), viene preseleccionada y se confirma en un toque.
// #215 — "Descuento" por línea y de la comanda (permiso `restaurant:discount`): abre DiscountModal (tipo,
// valor, motivo obligatorio); el server recalcula y aplica el tope del rol. El ticket muestra
// "Descuento (motivo) −X" y las cortesías (100 %) como tales. Sobre una comanda liquidada no se ofrece.
// #214 — dividir cuenta: pestaña "Dividir cuenta" (`SplitBillPanel`) con el saldo restante, las partes
// ya cobradas (persistidas: recargar a mitad del proceso las muestra), partes iguales, por líneas y
// "Agregar pago" con cualquier método. El flujo de un solo pago queda como atajo "Cobrar todo" y
// desaparece en cuanto hay una parte cobrada o en curso. Cada parte con tarjeta se devuelve por
// separado (`partially_refunded`). Acá quedan: cargar partes/saldo, esperar el webhook de una parte
// con tarjeta al volver de Stripe, y la vista de una comanda ya liquidada con sus partes.
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import {
  RestaurantService, roomServiceLabel, inHouseStatusLabel, isLineActive, isCourtesy,
  type OrderWithLines, type InHouseReservation, type OrderLine, type DiscountPolicy, type DiscountPayload, type OrderPayment, type OrderBalance,
  ORDER_STATUS_LABELS, ORDER_TYPE_LABELS, ORDER_PAYMENT_METHOD_LABELS, ORDER_PAYMENT_STATUS_LABELS, isDeadOrderPayment,
} from '@/services/Restaurant.service'
import { SettingsService } from '@/services/Settings.service'
import { POS_PAYMENT_METHODS, type PosPaymentMethod } from '@/services/Caja.service'
import { currencySymbol } from '@/composables/useCurrency'
import { CurrencyCode } from '@/types/currency'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppModal from '@/components/ui/AppModal.vue'
import PillTabs, { type PillTab } from '@/components/ui/PillTabs.vue'
import ReservationPicker from '@/components/features/restaurante/ReservationPicker.vue'
import DiscountModal from '@/components/features/restaurante/DiscountModal.vue'
import SplitBillPanel from '@/components/features/restaurante/SplitBillPanel.vue'
import { useToast } from '@/composables/useToast'
import { usePermissions } from '@/composables/usePermissions'
import { openPrintTab } from './imprimir'

const route = useRoute()
const toast = useToast()
const { can } = usePermissions()
const orderId = computed(() => String(route.params.id))
// #205: cobrar/cargar a habitación es `restaurant:pay` (no `edit`: cocina tiene `edit` para el KDS).
const canPay = computed(() => can('restaurant', 'pay'))
// Reembolso: solo órdenes pagadas con tarjeta (settlement='payment') y con permiso billing:create.
const canRefund = computed(() => can('billing', 'create'))
// #215: descontar es un permiso propio (hotel_admin y recepción por defecto; el mozo no).
const canDiscount = computed(() => can('restaurant', 'discount'))

const refundOpen = ref(false)
const refundBusy = ref(false)
// #214: el motivo del reembolso es obligatorio (el backend lo exige, como anular o descontar): efectivo y
// transferencia se devuelven de verdad y una devolución en mano sin motivo es un faltante de caja sin dueño.
const refundReason = ref('')
const partRefundReason = ref('')
const canConfirmRefund = computed(() => refundReason.value.trim().length > 0 && !refundBusy.value)
const canConfirmPartRefund = computed(() => partRefundReason.value.trim().length > 0 && !refundBusy.value)

const loading = ref(true)
const busy = ref(false)
// Si tras un cobro no podemos confirmar el estado (falló el reload), bloqueamos reintentos: el backend
// pudo haber registrado el pago. El usuario recarga para ver el estado real. Evita re-cobrar a ciegas.
const unknownState = ref(false)
const order = ref<OrderWithLines | null>(null)
const currency = ref<string>(CurrencyCode.USD)
const tip = ref(0)
const method = ref<PosPaymentMethod>('cash')
// #209 — reserva elegida en el buscador. `null` con `order.reservationId` = se usa la de la comanda.
const selectedReservation = ref<InHouseReservation | null>(null)

const PAYMENT_METHODS = POS_PAYMENT_METHODS
const TIP_PRESETS = [0, 0.1, 0.15, 0.2]

const SETTLED = ['charged', 'paid']
const settled = computed(() => !!order.value && SETTLED.includes(order.value.status))
const cancelled = computed(() => order.value?.status === 'cancelled')
const refunded = computed(() => order.value?.status === 'refunded')
// #214: se devolvió una parte; el resto sigue cobrado. Se muestra como liquidada, con cada parte y su estado.
const partiallyRefunded = computed(() => order.value?.status === 'partially_refunded')
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
  canRefund.value && order.value?.status === 'paid' && order.value?.settlement === 'payment' && !hasParts.value
)
const money = (n: number): string => `${currencySymbol(currency.value)}${Number(n || 0).toFixed(2)}`

// ─── Dividir cuenta / pagos parciales (#214) ───
const parts = ref<OrderPayment[]>([])
const balance = ref<OrderBalance>({ due: 0, paid: 0, pending: 0, outstanding: 0, tips: 0 })
// Una parte cobrada (o un Checkout de tarjeta abierto) = la cuenta ya se está saldando por partes: el
// atajo "Cobrar todo" cobraría de nuevo lo que ya entró (el backend lo rechaza con 409 igual).
const hasParts = computed(() => parts.value.some((p) => !isDeadOrderPayment(p)))
const partsShown = computed(() => parts.value.filter((p) => !isDeadOrderPayment(p)))
const tab = ref<'todo' | 'dividir'>('todo')
const cobrarTabs = computed<PillTab[]>(() => {
  const list: PillTab[] = []
  if (!hasParts.value) list.push({ value: 'todo', label: 'Cobrar todo' })
  list.push({ value: 'dividir', label: 'Dividir cuenta', count: partsShown.value.length || undefined })
  return list
})
watch(hasParts, (v) => { if (v) tab.value = 'dividir' })
// #214 (COR-5): efectivo y transferencia también se devuelven (asiento `refund` en payments); la habitación, desde el folio.
const partIsRefundable = (p: OrderPayment): boolean => canRefund.value && p.status === 'completed' && p.method !== 'room' && !!p.paymentId

// Si las partes no se pueden leer (403 sin `restaurant:pay`, red), la página de la comanda sigue
// funcionando con el cobro entero: se avisa y no se rompe el resto de la carga.
const partsUnavailable = ref(false)
async function loadParts() {
  try {
    const res = await RestaurantService.listOrderPayments(orderId.value)
    parts.value = res.data ?? []
    balance.value = res.balance
    partsUnavailable.value = false
  } catch (e: unknown) {
    partsUnavailable.value = true
    toast.warning('No se pudieron cargar los pagos parciales', e instanceof Error ? e.message : 'El cobro entero sigue disponible.')
  }
}
async function onPartsChanged() {
  // Reflejar el estado real; si NO podemos, bloqueamos reintentos (el pago pudo haberse registrado).
  try { await load() } catch { unknownState.value = true }
}
// #216 — la última parte también se queda en la pantalla liquidada (ticket con TODAS las partes) en vez de saltar al salón.
async function onSettledByParts() {
  try { await load() } catch { unknownState.value = true }
}

// Vuelta del Checkout de una parte con tarjeta: esperar a que el webhook la confirme (o la venza).
async function pollPendingParts() {
  if (polling.value) return
  polling.value = true
  const deadline = Date.now() + POLL_TIMEOUT_MS
  try {
    while (Date.now() < deadline) {
      try {
        const res = await RestaurantService.listOrderPayments(orderId.value)
        parts.value = res.data ?? []
        balance.value = res.balance
        if (!parts.value.some((p) => p.status === 'pending')) {
          const fresh = await RestaurantService.getOrder(orderId.value)
          order.value = fresh
          if (fresh.status === 'paid' || fresh.status === 'charged') toast.success('Cobro confirmado')   // #216: se queda acá, con "Imprimir ticket"
          return
        }
      } catch { /* red intermitente: seguir intentando hasta el timeout */ }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }
    toast.error('No pudimos confirmar el cobro con tarjeta', 'Revisá el Dashboard de Stripe o reintentá la parte.')
  } finally {
    polling.value = false
  }
}

const partRefundTarget = ref<OrderPayment | null>(null)
watch(partRefundTarget, () => { partRefundReason.value = '' })
async function confirmPartRefund() {
  const p = partRefundTarget.value
  if (!p || !canConfirmPartRefund.value) return
  refundBusy.value = true
  try {
    const result = await RestaurantService.refundOrderPayment(orderId.value, p.id, partRefundReason.value.trim())
    // COR-C: con la comanda abierta la parte queda `reversed` y el saldo vuelve a estar pendiente.
    if (result.status === 'reversed') toast.success('Parte devuelta', 'Se devolvió ese cobro; el saldo de la comanda volvió a quedar pendiente.')
    else toast.success('Parte reembolsada', 'Se devolvió ese cobro al cliente; el resto sigue cobrado.')
    await load()
  } catch (e: unknown) {
    toast.error('No se pudo reembolsar', e instanceof Error ? e.message : 'Intentá de nuevo.')
  } finally {
    refundBusy.value = false
    partRefundTarget.value = null
  }
}

// Subtotal/impuesto vienen del backend; la propina es editable y NO se grava. Total = subtotal + tax + tip.
const previewTotal = computed(() => {
  const o = order.value
  if (!o) return 0
  return Math.round((Number(o.subtotal || 0) + Number(o.tax || 0) + Number(tip.value || 0)) * 100) / 100
})
const canChargeRoom = computed(() => !!order.value && (!!selectedReservation.value || !!order.value.reservationId))
// Reserva de la comanda que no se pudo preseleccionar (no se pudo pedir, o ya no es del hotel): se sigue
// pudiendo cargar (el backend valida), pero se dice cuál es en vez de no mostrar nada.
const orderReservationLabel = computed(() => (order.value ? roomServiceLabel(order.value) : ''))
// #209 — la reserva de la comanda, pedida por id. Si no se pudo cargar, se avisa (no se traga el error):
// el cajero tiene que saber que la preselección falló y no que "la comanda no tiene reserva".
const reservationLookupFailed = ref(false)
// La reserva de la comanda ya no está alojada (checkout hecho, cancelada): el cargo igual es válido para el
// backend, pero el cajero lo ve antes de confirmar.
const selectedStatusLabel = computed(() => (selectedReservation.value ? inHouseStatusLabel(selectedReservation.value) : ''))
// #209 — la propina nunca es negativa: "-5" queda en 0 y el botón muestra el total sin propina.
watch(tip, (v) => { if (!Number.isFinite(Number(v)) || Number(v) < 0) tip.value = 0 })

// ─── #215: descuentos y cortesías ───
const discountPolicy = ref<DiscountPolicy | null>(null)
const discountTarget = ref<{ kind: 'order' } | { kind: 'line'; line: OrderLine } | null>(null)
const discountBusy = ref(false)
// Líneas que cuentan: las anuladas no se descuentan ni suman. Los componentes de combo se descuentan por el header.
const billableLines = computed<OrderLine[]>(() => (order.value?.lines ?? []).filter((l) => isLineActive(l) && l.kind !== 'combo_component'))
// Base del descuento de comanda = suma de líneas ya descontadas (lo mismo que usa el server).
const orderDiscountBase = computed(() => Math.round(billableLines.value.reduce((s, l) => s + Number(l.lineTotal || 0) - Number(l.discountAmount || 0), 0) * 100) / 100)
const discountTitle = computed(() => (discountTarget.value?.kind === 'line' ? 'Descuento en la línea' : 'Descuento de la comanda'))
const discountSubtitle = computed(() => (discountTarget.value?.kind === 'line' ? `${discountTarget.value.line.quantity}× ${discountTarget.value.line.name}` : 'Sobre el total de la cuenta, después de los descuentos por línea.'))
const discountBase = computed(() => (discountTarget.value?.kind === 'line' ? Number(discountTarget.value.line.lineTotal || 0) : orderDiscountBase.value))
const discountCurrent = computed(() => {
  const t = discountTarget.value
  const src = t?.kind === 'line' ? t.line : order.value
  return src?.discountType ? { type: src.discountType, value: Number(src.discountValue || 0), reason: src.discountReason } : null
})
/** Etiqueta del descuento de una línea para el ticket: "Cortesía · motivo" o "Descuento 10 % · motivo". */
function lineDiscountLabel(l: OrderLine): string {
  if (!l.discountType || !Number(l.discountAmount)) return ''
  const head = isCourtesy(l) ? 'Cortesía' : l.discountType === 'percent' ? `Descuento ${Number(l.discountValue)} %` : 'Descuento'
  return l.discountReason ? `${head} · ${l.discountReason}` : head
}
function openDiscount(target: { kind: 'order' } | { kind: 'line'; line: OrderLine }) {
  if (!canDiscount.value || busy.value || unknownState.value) return
  if (target.kind === 'order' && orderDiscountBase.value <= 0) { toast.warning('La comanda no tiene monto para descontar'); return }
  discountTarget.value = target
}
function closeDiscount() { if (!discountBusy.value) discountTarget.value = null }
async function reloadKeepingTip() {
  // No pasa por load(): eso pisaría la propina que el cajero está tipeando.
  order.value = await RestaurantService.getOrder(orderId.value)
}
async function confirmDiscount(payload: DiscountPayload) {
  const t = discountTarget.value
  if (!t || discountBusy.value) return
  discountBusy.value = true
  try {
    if (t.kind === 'line') await RestaurantService.applyLineDiscount(orderId.value, t.line.id, payload)
    else await RestaurantService.applyOrderDiscount(orderId.value, payload)
    discountTarget.value = null
    await reloadKeepingTip()
    toast.success(payload.type === 'percent' && payload.value === 100 ? 'Cortesía aplicada' : 'Descuento aplicado')
  } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'No se pudo aplicar el descuento') }
  finally { discountBusy.value = false }
}
async function removeDiscount() {
  const t = discountTarget.value
  if (!t || discountBusy.value) return
  discountBusy.value = true
  try {
    if (t.kind === 'line') await RestaurantService.removeLineDiscount(orderId.value, t.line.id)
    else await RestaurantService.removeOrderDiscount(orderId.value)
    discountTarget.value = null
    await reloadKeepingTip()
    toast.success('Descuento quitado')
  } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'No se pudo quitar el descuento') }
  finally { discountBusy.value = false }
}

function applyTipPreset(pct: number) {
  const base = Number(order.value?.subtotal || 0)
  tip.value = Math.round(base * pct * 100) / 100
}

async function load() {
  loading.value = true
  try {
    const [ord, settings, policy] = await Promise.all([
      RestaurantService.getOrder(orderId.value),
      SettingsService.get().catch(() => null),
      // #215: tope y motivos, solo si puede descontar. Sin política el modal igual abre (el server decide).
      canDiscount.value ? RestaurantService.discountPolicy().catch(() => null) : Promise.resolve(null),
    ])
    order.value = ord
    discountPolicy.value = policy
    tip.value = Number(ord.tip || 0)
    currency.value = settings?.hotel?.currency || CurrencyCode.USD
    // #214: las partes cobradas viven en el server (no en memoria): recargar a mitad del proceso las trae.
    if (ord.status !== 'cancelled') await loadParts()
    if (hasParts.value) tab.value = 'dividir'
    // #209 — comanda con reserva (room service): preseleccionar la ficha del alojado para confirmar en un
    // toque. Se pide ESA reserva por id (no la lista de alojados) y un fallo se dice, no se esconde.
    reservationLookupFailed.value = false
    if (ord.reservationId && !SETTLED.includes(ord.status) && ord.status !== 'cancelled') {
      try {
        selectedReservation.value = await RestaurantService.getInHouseById(ord.reservationId)
      } catch (e: unknown) {
        reservationLookupFailed.value = true
        toast.warning('No se pudo cargar la reserva de la comanda', e instanceof Error ? e.message : 'Elegí el huésped en el buscador o reintentá.')
      }
    }
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
  } else if (route.query.part || parts.value.some((p) => p.status === 'pending')) {
    // #214: volvió del Checkout de UNA parte (o recargó con una parte pendiente) → esperar al webhook de esa parte.
    pollPendingParts()
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
    const payload: { method: PosPaymentMethod; successUrl?: string; cancelUrl?: string } = { method: method.value }
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
    // #216 — se queda en la pantalla liquidada (con "Imprimir ticket" y "Volver al salón") en vez de
    // saltar al salón: el cliente que paga en efectivo se lleva el ticket ahora, no después.
    toast.success('Comanda cobrada')
    await load()
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
    const rid = selectedReservation.value?.id || order.value.reservationId
    await RestaurantService.chargeToRoom(orderId.value, { reservationId: rid || undefined })
    toast.success('Cargado a la habitación')
    await load()   // #216 — misma pantalla liquidada que el cobro directo (ticket imprimible)
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'No se pudo cargar a la habitación')
    try { await load() } catch { unknownState.value = true }
  } finally {
    busy.value = false
  }
}

// ─── #216: imprimir (80 mm) — precuenta antes de cobrar, ticket después (paid/charged) ───
const printing = ref<'precuenta' | 'ticket' | null>(null)
async function print(doc: 'precuenta' | 'ticket') {
  if (printing.value) return
  printing.value = doc
  try {
    const r = await openPrintTab(orderId.value, doc)
    if (!r.ok) toast.error(r.error)
  } finally { printing.value = null }
}

watch(refundOpen, (open) => { if (open) refundReason.value = '' })
async function confirmRefund() {
  if (!refundable.value || !canConfirmRefund.value || !order.value) return
  refundBusy.value = true
  try {
    await RestaurantService.refundOrder(orderId.value, refundReason.value.trim())
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

      <div v-else-if="settled || partiallyRefunded">
        <SectionCard :title="partiallyRefunded ? 'Comanda reembolsada en parte' : 'Comanda liquidada'">
          <div class="py-6 text-center">
            <p class="text-navy font-bold">
              {{ partiallyRefunded ? 'Se devolvió una parte del cobro; el resto sigue cobrado.' : hasParts ? 'Cobrada por partes.' : order.status === 'paid' ? 'Cobrada directamente.' : 'Cargada a la habitación.' }}
            </p>
            <p class="text-2xl font-black text-navy mt-2 tabular-nums">{{ money(order.total) }}</p>
            <!-- #214: cada parte con su método y estado; la de tarjeta se devuelve por separado. -->
            <ul v-if="partsShown.length" data-testid="settled-parts" class="mt-4 mx-auto max-w-md divide-y divide-border text-left text-sm">
              <li v-for="p in partsShown" :key="p.id" class="py-2 flex items-center justify-between gap-3">
                <span class="text-navy">
                  <span class="font-bold">Parte {{ p.seq }}</span> · {{ ORDER_PAYMENT_METHOD_LABELS[p.method] }}
                  <span :class="['ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold', p.status === 'refunded' ? 'bg-coral/10 text-coral' : 'bg-teal/10 text-teal']">{{ ORDER_PAYMENT_STATUS_LABELS[p.status] }}</span>
                </span>
                <span class="flex items-center gap-2">
                  <span class="tabular-nums font-bold text-navy">{{ money(p.amount + (p.tip || 0)) }}</span>
                  <button v-if="partIsRefundable(p)" @click="partRefundTarget = p" :data-testid="`refund-part-${p.seq}`"
                    class="px-2 py-1 rounded-lg bg-coral text-white text-xs font-bold hover:bg-coral/80">Reembolsar</button>
                </span>
              </li>
            </ul>
            <!-- #209 — un cargo al folio no se reembolsa desde acá: se explica en vez de no mostrar el botón sin más. -->
            <p v-if="order.settlement === 'folio'" data-testid="folio-note" class="text-xs text-text-muted mt-2">
              Cobrado a la habitación: se devuelve desde el folio{{ orderReservationLabel ? ` (${orderReservationLabel})` : '' }}, en Facturación.
            </p>
            <div class="mt-4 flex flex-wrap items-center justify-center gap-2">
              <router-link to="/panel/restaurante/salon" class="px-4 py-2 rounded-lg bg-navy text-white text-sm font-bold">Volver al salón</router-link>
              <!-- #216 — comprobante de pago / cargo a la habitación, 80 mm, en pestaña nueva. -->
              <button v-if="canPay" type="button" @click="print('ticket')" :disabled="printing !== null" data-testid="print-ticket"
                class="px-4 py-2 rounded-lg border-2 border-navy/30 text-navy text-sm font-bold hover:bg-surface disabled:opacity-50">
                🖨 {{ printing === 'ticket' ? 'Generando…' : 'Imprimir ticket' }}
              </button>
              <button v-if="refundable" @click="refundOpen = true" data-testid="refund-order"
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
          <template v-if="canDiscount" #actions>
            <button type="button" data-testid="order-discount" @click="openDiscount({ kind: 'order' })" :disabled="busy || unknownState"
              class="px-3 py-1.5 rounded-full border border-white/30 bg-white/10 text-xs font-bold text-white hover:bg-white/20 disabled:opacity-50">
              {{ order.discountType ? 'Editar descuento' : 'Descuento' }}
            </button>
          </template>
          <div class="divide-y divide-border mb-3">
            <!-- #215: las anuladas no van en la cuenta (no suman); cada línea muestra su descuento/cortesía debajo. -->
            <div v-for="l in billableLines" :key="l.id" class="py-2 flex items-start justify-between gap-3 text-sm">
              <div class="min-w-0">
                <span class="text-navy">{{ l.quantity }}× {{ l.name }}</span>
                <div v-if="lineDiscountLabel(l)" :data-testid="`line-discount-${l.id}`" class="text-[11px] font-bold text-coral">
                  {{ lineDiscountLabel(l) }} <span class="tabular-nums">−{{ money(l.discountAmount ?? 0) }}</span>
                </div>
                <button v-if="canDiscount" type="button" :data-testid="`line-discount-btn-${l.id}`" @click="openDiscount({ kind: 'line', line: l })" :disabled="busy || unknownState"
                  class="text-[11px] font-bold text-navy hover:underline disabled:opacity-50">{{ l.discountType ? 'Editar descuento' : 'Descuento' }}</button>
              </div>
              <span class="tabular-nums text-text-muted shrink-0" :class="l.discountAmount ? 'line-through' : ''">{{ money(l.lineTotal) }}</span>
            </div>
          </div>
          <div class="space-y-1.5 text-sm">
            <!-- #215: el descuento de comanda va con su motivo; subtotal/impuesto ya vienen descontados del server. -->
            <div v-if="order.discountType && order.discountAmount" data-testid="order-discount-row" class="flex justify-between text-coral font-bold">
              <span>Descuento{{ order.discountType === 'percent' ? ` ${Number(order.discountValue)} %` : '' }}<template v-if="order.discountReason"> ({{ order.discountReason }})</template></span>
              <span class="tabular-nums">−{{ money(order.discountAmount) }}</span>
            </div>
            <div class="flex justify-between text-text-muted"><span>Subtotal</span><span class="tabular-nums">{{ money(order.subtotal) }}</span></div>
            <div class="flex justify-between text-text-muted"><span>Impuesto</span><span class="tabular-nums">{{ money(order.tax) }}</span></div>
            <div class="flex justify-between text-text-muted"><span>Propina</span><span class="tabular-nums">{{ money(tip) }}</span></div>
            <div class="flex justify-between text-navy font-black text-lg pt-1 border-t-2 border-navy/10"><span>Total</span><span class="tabular-nums">{{ money(previewTotal) }}</span></div>
          </div>
          <!-- #216 — precuenta para la mesa (lo consumido, sin cobrar), 80 mm, en pestaña nueva. -->
          <button type="button" @click="print('precuenta')" :disabled="printing !== null" data-testid="print-precuenta"
            class="mt-3 w-full py-2 rounded-xl border-2 border-navy/30 text-navy text-sm font-bold hover:bg-surface disabled:opacity-50">
            🖨 {{ printing === 'precuenta' ? 'Generando…' : 'Imprimir precuenta' }}
          </button>
        </SectionCard>

        <!-- #214: un solo pago (atajo) o dividir la cuenta. Con una parte ya cobrada solo queda dividir. -->
        <PillTabs v-model="tab" :tabs="cobrarTabs" aria-label="Forma de cobro" class="mb-4" />

        <template v-if="tab === 'todo'">
        <!-- Propina (solo cobro directo) -->
        <SectionCard title="Propina" subtitle="Aplica al cobro directo. El cargo a habitación no la incluye." class="mb-4">
          <div class="flex flex-wrap items-center gap-2">
            <button v-for="p in TIP_PRESETS" :key="p" @click="applyTipPreset(p)"
              class="px-3 py-1.5 rounded-lg border-2 border-border text-navy text-xs font-bold hover:bg-surface">
              {{ p === 0 ? 'Sin propina' : `${p * 100}%` }}
            </button>
            <div class="flex items-center gap-1.5">
              <span class="text-xs text-text-muted">Monto</span>
              <input id="restaurante-cobrar-propina" name="tip" aria-label="Monto de la propina" v-model.number="tip" type="number" min="0" step="0.01" inputmode="decimal"
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
          <!-- #209 — buscador por habitación/apellido; con la reserva de la comanda ya elegida se confirma en un toque. -->
          <ReservationPicker v-model="selectedReservation" :disabled="busy || unknownState" class="mb-3" />
          <p v-if="reservationLookupFailed" role="alert" data-testid="reservation-lookup-failed" class="text-[11px] font-bold text-coral mb-3">
            No se pudo cargar la reserva de la comanda{{ orderReservationLabel ? ` (${orderReservationLabel})` : '' }}. Elegí el huésped arriba o recargá la página.
          </p>
          <p v-else-if="!selectedReservation && order.reservationId" data-testid="order-reservation-note" class="text-[11px] text-text-muted mb-3">
            Se cargará a la reserva de la comanda{{ orderReservationLabel ? ` (${orderReservationLabel})` : '' }}; elegí otro alojado arriba para cambiarla.
          </p>
          <p v-else-if="selectedStatusLabel" data-testid="reservation-status-note" class="text-[11px] text-gold font-bold mb-3">
            {{ selectedStatusLabel === 'Sin check-in' ? 'El huésped todavía no hizo check-in: el cargo va al folio de su reserva igual.' : `La reserva ya no está alojada (${selectedStatusLabel.toLowerCase()}). Revisá antes de cargar.` }}
          </p>
          <button @click="chargeRoom" :disabled="!canPay || busy || unknownState || !canChargeRoom" data-testid="charge-room"
            class="w-full py-3 rounded-xl bg-navy text-white font-black hover:bg-navy-light disabled:opacity-50">
            Cargar {{ money(order.subtotal) }} neto al folio
          </button>
          <p class="text-[11px] text-text-muted mt-2">El folio le aplica el impuesto al facturar (no se dobla el ITBIS).</p>
          <p v-if="!canChargeRoom" class="text-[11px] text-text-muted mt-2">Elegí al huésped alojado arriba o cobrá directo.</p>
        </SectionCard>
        </template>

        <!-- #214: dividir cuenta / pagos parciales -->
        <template v-else>
          <p v-if="partsUnavailable" role="alert" data-testid="parts-unavailable" class="mb-4 p-3 rounded-xl border-2 border-gold/40 bg-gold/5 text-sm text-gold font-bold">
            No se pudieron cargar los pagos parciales. Recargá la página o cobrá todo desde la otra pestaña.
          </p>
          <SplitBillPanel v-else :order="order" :parts="parts" :balance="balance" :currency="currency" :can-pay="canPay"
            :disabled="busy || unknownState" :polling="polling" :preset-reservation="selectedReservation" :order-reservation-label="orderReservationLabel"
            :can-refund="canRefund" @paid="onSettledByParts" @changed="onPartsChanged" @refund="partRefundTarget = $event" />
        </template>
      </template>
    </template>

    <EmptyState v-else title="Comanda no encontrada" message="La comanda no existe o no tenés acceso." />

    <!-- #215: descuento o cortesía (línea o comanda). Cerrar sin confirmar no cambia nada. -->
    <DiscountModal v-if="discountTarget" :title="discountTitle" :subtitle="discountSubtitle" :base="discountBase"
      :currency="currencySymbol(currency)" :policy="discountPolicy" :current="discountCurrent" :loading="discountBusy"
      @confirm="confirmDiscount" @remove="removeDiscount" @close="closeDiscount" />

    <!-- #214: reembolso de UNA parte -->
    <AppModal :open="!!partRefundTarget" title="Reembolsar una parte" size="sm" @close="partRefundTarget = null">
      <div class="space-y-3 text-sm text-navy">
        <p v-if="settled || partiallyRefunded">Se <strong>devolverá solo este cobro</strong> al cliente. Las demás partes siguen cobradas y el inventario no se repone.</p>
        <p v-else>Se <strong>devolverá solo este cobro</strong> al cliente y ese monto <strong>vuelve a quedar pendiente</strong> en la comanda (sus líneas se pueden cobrar de nuevo).</p>
        <p class="text-coral font-bold">Esta acción no se puede deshacer.</p>
        <p class="text-text-muted">Parte {{ partRefundTarget?.seq }} · {{ ORDER_PAYMENT_METHOD_LABELS[partRefundTarget?.method ?? ''] }}: <span class="font-black text-navy tabular-nums">{{ money((partRefundTarget?.amount ?? 0) + (partRefundTarget?.tip ?? 0)) }}</span></p>
        <div>
          <label for="part-refund-reason" class="block text-[10px] font-bold uppercase tracking-wide text-text-muted mb-1">Motivo <span class="text-coral">*</span></label>
          <textarea id="part-refund-reason" v-model="partRefundReason" rows="2" maxlength="500" :disabled="refundBusy" data-testid="part-refund-reason"
            class="w-full rounded-xl border-2 border-border px-3 py-2 text-sm text-navy focus:border-navy focus:outline-none disabled:opacity-50"
            placeholder="Por qué se devuelve este cobro"></textarea>
          <p class="mt-1 text-xs text-text-muted">Queda registrado con tu usuario, la hora y el motivo.</p>
        </div>
      </div>
      <template #footer>
        <button @click="partRefundTarget = null" :disabled="refundBusy"
          class="px-4 py-2 rounded-lg border-2 border-border text-navy text-sm font-bold hover:bg-surface disabled:opacity-50">Cancelar</button>
        <button @click="confirmPartRefund" :disabled="!canConfirmPartRefund" data-testid="confirm-part-refund"
          class="px-4 py-2 rounded-lg bg-coral text-white text-sm font-bold hover:bg-coral/80 disabled:opacity-50">
          {{ refundBusy ? 'Procesando…' : 'Reembolsar' }}
        </button>
      </template>
    </AppModal>

    <!-- Confirmación de reembolso -->
    <AppModal :open="refundOpen" title="Reembolsar orden" size="sm" @close="refundOpen = false">
      <div class="space-y-3 text-sm text-navy">
        <p>Se <strong>devolverá el dinero al cliente</strong> y se <strong>repondrá el inventario vendido</strong>.</p>
        <p class="text-coral font-bold">Esta acción no se puede deshacer.</p>
        <p class="text-text-muted">Total: <span class="font-black text-navy tabular-nums">{{ money(order?.total ?? 0) }}</span></p>
        <div>
          <label for="refund-reason" class="block text-[10px] font-bold uppercase tracking-wide text-text-muted mb-1">Motivo <span class="text-coral">*</span></label>
          <textarea id="refund-reason" v-model="refundReason" rows="2" maxlength="500" :disabled="refundBusy" data-testid="refund-reason"
            class="w-full rounded-xl border-2 border-border px-3 py-2 text-sm text-navy focus:border-navy focus:outline-none disabled:opacity-50"
            placeholder="Por qué se devuelve el cobro"></textarea>
          <p class="mt-1 text-xs text-text-muted">Queda registrado con tu usuario, la hora y el motivo.</p>
        </div>
      </div>
      <template #footer>
        <button @click="refundOpen = false" :disabled="refundBusy"
          class="px-4 py-2 rounded-lg border-2 border-border text-navy text-sm font-bold hover:bg-surface disabled:opacity-50">Cancelar</button>
        <button @click="confirmRefund" :disabled="!canConfirmRefund" data-testid="confirm-refund"
          class="px-4 py-2 rounded-lg bg-coral text-white text-sm font-bold hover:bg-coral/80 disabled:opacity-50">
          {{ refundBusy ? 'Procesando…' : 'Reembolsar' }}
        </button>
      </template>
    </AppModal>
  </div>
</template>
