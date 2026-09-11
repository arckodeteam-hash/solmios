<script setup lang="ts">
// components/features/restaurante/SplitBillPanel.vue — #214 (REST-12): dividir la cuenta / pagos parciales.
// La pestaña "Dividir cuenta" de /cobrar: saldo restante, partes ya cobradas (vienen del server: el
// padre las carga y las pasa), partes iguales (los montos los calcula el server; el centavo va a la
// última), por líneas (cada línea en una sola parte) y el modal "Agregar pago" con cualquier método.
// Con tarjeta el server devuelve `checkoutUrl` y se navega al Checkout de Stripe (la parte queda
// `pending` hasta el webhook; el padre la espera al volver). Con habitación va al folio de la reserva.
// El panel NO navega dentro del SPA ni recarga por su cuenta: emite `paid` (se saldó la cuenta) o
// `changed` (hay que recargar comanda + partes) y el padre decide.
import { ref, computed } from 'vue'
import {
  RestaurantService,
  type OrderWithLines, type InHouseReservation, type OrderPayment, type OrderBalance, type OrderPaymentMethod, type AddOrderPaymentPayload,
  ORDER_PAYMENT_METHOD_LABELS, ORDER_PAYMENT_STATUS_LABELS, isDeadOrderPayment,
} from '@/services/Restaurant.service'
import { POS_PAYMENT_METHODS } from '@/services/Caja.service'
import { currencySymbol } from '@/composables/useCurrency'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppModal from '@/components/ui/AppModal.vue'
import ReservationPicker from '@/components/features/restaurante/ReservationPicker.vue'
import { useToast } from '@/composables/useToast'

const props = withDefaults(defineProps<{
  order: OrderWithLines
  parts: OrderPayment[]
  balance: OrderBalance
  currency: string
  canPay: boolean
  /** El padre está ocupado o no pudo confirmar el estado: no se agregan partes. */
  disabled?: boolean
  /** Esperando el webhook de una parte con tarjeta: el saldo se muestra "en confirmación". */
  polling?: boolean
  /** Reserva preseleccionada para una parte a habitación (la de la comanda, si es room service). */
  presetReservation?: InHouseReservation | null
  /** "Hab. 204 · Pérez" de la comanda, para decir a qué reserva va una parte sin elegir otra. */
  orderReservationLabel?: string
  /** COR-C: puede devolver una parte cobrada por error (permiso `billing:create`); el padre confirma y llama al refund. */
  canRefund?: boolean
}>(), { disabled: false, polling: false, presetReservation: null, orderReservationLabel: '', canRefund: false })

const emit = defineEmits<{
  /** Se cobró la última parte: la cuenta quedó saldada. */
  paid: []
  /** Se registró una parte, el total cambió o falló el cobro: el padre recarga comanda + partes (y si
   *  tampoco puede, bloquea reintentos: el pago pudo haberse registrado). */
  changed: []
  /** COR-C: devolver ESA parte (cobrada por error) con la comanda abierta. El padre confirma. */
  refund: [part: OrderPayment]
}>()

const toast = useToast()
const money = (n: number): string => `${currencySymbol(props.currency)}${Number(n || 0).toFixed(2)}`
const round2 = (n: number): number => Math.round(n * 100) / 100

const partsShown = computed(() => props.parts.filter((p) => !isDeadOrderPayment(p)))
// Una parte directa cobrada se puede deshacer (la habitación se ajusta en el folio).
const partIsRefundable = (p: OrderPayment): boolean => props.canRefund && !locked.value && p.status === 'completed' && p.method !== 'room' && !!p.paymentId
// Saldo disponible para la próxima parte: lo que falta menos lo que reservan las partes en curso.
const available = computed(() => Math.max(0, round2(props.balance.outstanding - props.balance.pending)))
const locked = computed(() => !props.canPay || props.disabled)

// ─── Partes iguales: N montos que suman exacto el saldo (los calcula el server). ───
const equalParts = ref(2)
const equalAmounts = ref<number[]>([])
async function previewEqual() {
  const n = Math.max(1, Math.min(50, Math.floor(Number(equalParts.value) || 1)))
  equalParts.value = n
  try {
    equalAmounts.value = (await RestaurantService.splitPreview(props.order.id, n)).parts
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'No se pudo dividir la cuenta')
  }
}

// ─── Por líneas: cada comensal marca lo suyo. Una línea ya cobrada en otra parte no se vuelve a elegir. ───
const selectedLineIds = ref<string[]>([])
const takenLineIds = computed(() => new Set(props.parts.filter((p) => !isDeadOrderPayment(p)).flatMap((p) => p.lineIds ?? [])))
const assignableLines = computed(() => props.order.lines.filter((l) => l.status !== 'voided' && l.status !== 'cancelled' && l.kind !== 'combo_component'))
const lineGross = (l: { lineTotal: number; taxRate?: number }): number => Number(l.lineTotal || 0) * (1 + Number(l.taxRate || 0) / 100)
// Vista previa de la selección: si con ella quedan cubiertas todas las líneas, vale el saldo exacto (misma regla del server).
const selectionAmount = computed(() => {
  const chosen = assignableLines.value.filter((l) => selectedLineIds.value.includes(l.id))
  if (!chosen.length) return 0
  const coversAll = assignableLines.value.every((l) => takenLineIds.value.has(l.id) || selectedLineIds.value.includes(l.id))
  if (coversAll) return props.balance.outstanding
  return round2(chosen.reduce((s, l) => s + lineGross(l), 0))
})
function toggleLine(id: string) {
  if (takenLineIds.value.has(id)) return
  selectedLineIds.value = selectedLineIds.value.includes(id) ? selectedLineIds.value.filter((x) => x !== id) : [...selectedLineIds.value, id]
}

// ─── Modal "Agregar pago": método, monto (o las líneas elegidas), propina y, si va a la habitación, la reserva. ───
const partOpen = ref(false)
const partBusy = ref(false)
const partMethod = ref<OrderPaymentMethod>('cash')
const partAmount = ref(0)
const partTip = ref(0)
const partLineIds = ref<string[] | undefined>(undefined)
const partReservation = ref<InHouseReservation | null>(null)
const PART_METHODS: Array<{ value: OrderPaymentMethod; label: string }> = [
  ...POS_PAYMENT_METHODS.map((m) => ({ value: m.value as OrderPaymentMethod, label: m.label })),
  { value: 'room', label: 'Habitación' },
]
function openPart(preset: { amount?: number; lineIds?: string[] } = {}) {
  if (locked.value) return
  partMethod.value = 'cash'
  partTip.value = 0
  partLineIds.value = preset.lineIds?.length ? [...preset.lineIds] : undefined
  partAmount.value = preset.lineIds?.length ? selectionAmount.value : (preset.amount ?? available.value)
  partReservation.value = props.presetReservation
  partOpen.value = true
}
const partTotal = computed(() => round2(Number(partAmount.value || 0) + Number(partTip.value || 0)))
const partReservationId = computed(() => partReservation.value?.id || props.order.reservationId)
const partValid = computed(() => {
  if (partBusy.value) return false
  if (Number(partAmount.value) <= 0 || Number(partAmount.value) > available.value + 0.01) return false
  if (Number(partTip.value) < 0) return false
  if (partMethod.value === 'room' && (Number(partTip.value) > 0 || !partReservationId.value)) return false
  return true
})

/** Anti-caja-corta (igual que el cobro entero): el total pudo cambiar desde otra tablet. */
async function totalChanged(): Promise<boolean> {
  const fresh = await RestaurantService.getOrder(props.order.id)
  return Number(fresh.subtotal || 0) !== Number(props.order.subtotal || 0) || Number(fresh.tax || 0) !== Number(props.order.tax || 0)
}

async function confirmPart() {
  if (!partValid.value) return
  partBusy.value = true
  try {
    if (await totalChanged()) {
      toast.warning('El total de la comanda cambió. Revisá el saldo y volvé a cobrar.')
      partOpen.value = false
      emit('changed')
      return
    }
    const payload: AddOrderPaymentPayload = { method: partMethod.value, amount: Number(partAmount.value), tip: Number(partTip.value) || 0 }
    if (partLineIds.value?.length) payload.lineIds = partLineIds.value
    if (partMethod.value === 'room') payload.reservationId = partReservationId.value
    if (partMethod.value === 'card') {
      const base = `${window.location.origin}/panel/restaurante/cobrar/${props.order.id}`
      payload.successUrl = `${base}?paid=pending&part=pending`
      payload.cancelUrl = `${base}?paid=cancelled`
    }
    const result = await RestaurantService.addOrderPayment(props.order.id, payload)
    if (result.checkoutUrl) {
      // Navegando afuera del SPA (Checkout de Stripe): al volver, el padre espera el webhook de esta parte.
      window.location.assign(result.checkoutUrl)
      return
    }
    partOpen.value = false
    selectedLineIds.value = []
    equalAmounts.value = []
    if (result.order.status === 'paid' || result.order.status === 'charged') {
      toast.success('Comanda cobrada', 'Se cobró la última parte; la cuenta quedó saldada.')
      emit('paid')
      return
    }
    toast.success('Pago registrado', `Faltan ${money(result.balance.outstanding)}`)
    emit('changed')
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'No se pudo registrar el pago')
    emit('changed')
  } finally {
    partBusy.value = false
  }
}
</script>

<template>
  <div>
    <SectionCard title="Pagos" :subtitle="`Cuenta ${money(balance.due)} · la propina se agrega en cada pago`" class="mb-4">
      <template #actions>
        <button @click="openPart()" :disabled="locked || polling || available <= 0" data-testid="add-part"
          class="px-3 py-1.5 rounded-lg bg-white text-navy text-xs font-black hover:bg-white/90 disabled:opacity-50">+ Agregar pago</button>
      </template>
      <div class="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div>
          <p class="text-[11px] uppercase tracking-wide text-text-muted font-bold">Saldo restante</p>
          <p data-testid="outstanding" class="text-3xl font-black text-navy tabular-nums">{{ money(balance.outstanding) }}</p>
          <p v-if="balance.pending > 0" data-testid="pending-note" class="text-[11px] text-gold font-bold">{{ money(balance.pending) }} esperando la confirmación de Stripe{{ polling ? '…' : '' }}</p>
        </div>
        <p class="text-sm text-text-muted tabular-nums">Pagado <span class="font-bold text-teal">{{ money(balance.paid) }}</span><span v-if="balance.tips > 0"> · propinas {{ money(balance.tips) }}</span></p>
      </div>
      <ul v-if="partsShown.length" data-testid="parts-list" class="divide-y divide-border text-sm">
        <li v-for="p in partsShown" :key="p.id" class="py-2 flex items-center justify-between gap-3">
          <span class="text-navy">
            <span class="font-bold">Parte {{ p.seq }}</span> · {{ ORDER_PAYMENT_METHOD_LABELS[p.method] }}
            <span v-if="p.lineIds?.length" class="text-text-muted"> · {{ p.lineIds.length }} línea{{ p.lineIds.length === 1 ? '' : 's' }}</span>
            <span :class="['ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold', p.status === 'completed' ? 'bg-teal/10 text-teal' : p.status === 'pending' ? 'bg-gold/10 text-gold' : 'bg-coral/10 text-coral']">{{ ORDER_PAYMENT_STATUS_LABELS[p.status] }}</span>
          </span>
          <span class="flex items-center gap-2">
            <span class="tabular-nums font-bold text-navy">{{ money(p.amount) }}<span v-if="p.tip > 0" class="text-text-muted font-normal"> + {{ money(p.tip) }}</span></span>
            <button v-if="partIsRefundable(p)" type="button" @click="emit('refund', p)" :data-testid="`undo-part-${p.seq}`"
              class="px-2 py-1 rounded-lg border border-coral text-coral text-xs font-bold hover:bg-coral/10" title="Devolver esta parte: el saldo se reabre">Devolver</button>
          </span>
        </li>
      </ul>
      <EmptyState v-else title="Todavía no hay pagos" message="Dividí la cuenta abajo o agregá un pago con el monto que quieras." />
    </SectionCard>

    <SectionCard title="Dividir" subtitle="Partes iguales (el centavo sobrante va a la última) o por líneas (cada uno paga lo suyo)." class="mb-4">
      <div class="mb-4">
        <p class="text-xs font-bold text-navy mb-2">En partes iguales</p>
        <div class="flex flex-wrap items-center gap-2">
          <input id="restaurante-cobrar-partes" name="parts" aria-label="Cantidad de partes" v-model.number="equalParts" type="number" min="1" max="50" step="1" inputmode="numeric"
            class="w-20 px-2 py-1.5 rounded-lg border-2 border-border text-sm text-navy focus:border-navy focus:outline-none tabular-nums" />
          <button @click="previewEqual" :disabled="available <= 0" data-testid="split-equal"
            class="px-3 py-1.5 rounded-lg border-2 border-navy text-navy text-xs font-bold hover:bg-navy hover:text-white disabled:opacity-50">Dividir {{ money(balance.outstanding) }}</button>
        </div>
        <ul v-if="equalAmounts.length" data-testid="equal-amounts" class="mt-2 flex flex-wrap gap-2">
          <li v-for="(a, i) in equalAmounts" :key="i">
            <button @click="openPart({ amount: a })" :disabled="locked || a > available + 0.01"
              class="px-3 py-1.5 rounded-lg bg-surface border-2 border-border text-navy text-xs font-bold tabular-nums hover:border-navy disabled:opacity-50">
              {{ i + 1 }}/{{ equalAmounts.length }} · {{ money(a) }}
            </button>
          </li>
        </ul>
      </div>
      <div>
        <p class="text-xs font-bold text-navy mb-2">Por líneas</p>
        <ul class="divide-y divide-border text-sm">
          <li v-for="l in assignableLines" :key="l.id">
            <label :class="['py-2 flex items-center justify-between gap-3', takenLineIds.has(l.id) ? 'opacity-50' : 'cursor-pointer']">
              <span class="flex items-center gap-2 text-navy">
                <input type="checkbox" :name="`line-${l.id}`" :aria-label="`Incluir ${l.name}`" :checked="selectedLineIds.includes(l.id)" :disabled="takenLineIds.has(l.id)" @change="toggleLine(l.id)" class="accent-navy" />
                <span>{{ l.quantity }}× {{ l.name }}</span>
                <span v-if="takenLineIds.has(l.id)" class="px-1.5 py-0.5 rounded bg-teal/10 text-teal text-[10px] font-bold">Ya cobrada</span>
              </span>
              <span class="tabular-nums text-text-muted">{{ money(lineGross(l)) }}</span>
            </label>
          </li>
        </ul>
        <button @click="openPart({ lineIds: selectedLineIds })" :disabled="locked || !selectedLineIds.length" data-testid="pay-selection"
          class="mt-2 w-full py-2.5 rounded-xl bg-navy text-white text-sm font-black hover:bg-navy-light disabled:opacity-50">
          Cobrar selección{{ selectedLineIds.length ? ` · ${money(selectionAmount)}` : '' }}
        </button>
      </div>
    </SectionCard>

    <!-- Agregar una parte del cobro -->
    <AppModal :open="partOpen" title="Agregar pago" :subtitle="`Saldo disponible ${money(available)}`" size="sm" @close="partOpen = false">
      <div class="space-y-3 text-sm">
        <div class="flex flex-wrap gap-2">
          <button v-for="m in PART_METHODS" :key="m.value" @click="partMethod = m.value" :data-part-method="m.value"
            :class="['px-3 py-1.5 rounded-lg text-sm font-bold border-2', partMethod === m.value ? 'bg-navy text-white border-navy' : 'border-border text-navy hover:bg-surface']">
            {{ m.label }}
          </button>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <label class="block">
            <span class="text-[11px] font-bold text-text-muted">Monto</span>
            <input id="restaurante-cobrar-parte-monto" name="partAmount" v-model.number="partAmount" type="number" min="0.01" :max="available" step="0.01" inputmode="decimal" :disabled="!!partLineIds?.length"
              class="mt-1 w-full px-2 py-1.5 rounded-lg border-2 border-border text-navy focus:border-navy focus:outline-none tabular-nums disabled:bg-surface" />
          </label>
          <label class="block">
            <span class="text-[11px] font-bold text-text-muted">Propina</span>
            <input id="restaurante-cobrar-parte-propina" name="partTip" v-model.number="partTip" type="number" min="0" step="0.01" inputmode="decimal" :disabled="partMethod === 'room'"
              class="mt-1 w-full px-2 py-1.5 rounded-lg border-2 border-border text-navy focus:border-navy focus:outline-none tabular-nums disabled:bg-surface" />
          </label>
        </div>
        <p v-if="partLineIds?.length" class="text-[11px] text-text-muted">{{ partLineIds.length }} línea{{ partLineIds.length === 1 ? '' : 's' }} elegida{{ partLineIds.length === 1 ? '' : 's' }}: el monto lo fijan las líneas.</p>
        <p v-if="Number(partAmount) > available + 0.01" role="alert" class="text-[11px] font-bold text-coral">El monto supera el saldo disponible ({{ money(available) }}).</p>
        <template v-if="partMethod === 'room'">
          <ReservationPicker v-model="partReservation" :disabled="partBusy" />
          <p v-if="!partReservation && order.reservationId" class="text-[11px] text-text-muted">Se cargará a la reserva de la comanda{{ orderReservationLabel ? ` (${orderReservationLabel})` : '' }}.</p>
          <p class="text-[11px] text-text-muted">Va al folio como consumo neto (el folio aplica el impuesto). Sin propina.</p>
        </template>
        <p v-else-if="partMethod === 'card'" class="text-[11px] text-text-muted">Se abre el Checkout de Stripe por {{ money(partTotal) }}; la parte queda pendiente hasta que confirme.</p>
      </div>
      <template #footer>
        <button @click="partOpen = false" :disabled="partBusy"
          class="px-4 py-2 rounded-lg border-2 border-border text-navy text-sm font-bold hover:bg-surface disabled:opacity-50">Cancelar</button>
        <button @click="confirmPart" :disabled="!partValid" data-testid="confirm-part"
          class="px-4 py-2 rounded-lg bg-teal text-white text-sm font-bold hover:bg-teal/80 disabled:opacity-50">
          {{ partBusy ? 'Procesando…' : `Cobrar ${money(partTotal)}` }}
        </button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
</style>
