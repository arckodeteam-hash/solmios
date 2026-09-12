<template>
  <AppModal :open="open" title="Registrar pago" size="md" @close="emit('close')">
    <div class="space-y-4">
      <p class="text-xs text-text-muted leading-snug bg-surface rounded-xl px-3 py-2.5">
        Para plata que <span class="font-bold text-navy">ya recibiste</span> fuera de Stripe (efectivo,
        transferencia, tarjeta en el mostrador). Queda en el historial de cobros con tu nombre y
        descuenta del saldo pendiente. Si todavía no cobraste, usá el link de pago.
      </p>

      <div>
        <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Método de pago</label>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="m in METHODS"
            :key="m.value"
            type="button"
            :data-testid="'mark-paid-method-' + m.value"
            @click="method = m.value"
            class="rounded-full border px-3.5 py-2 text-[11px] font-bold transition-all cursor-pointer"
            :class="method === m.value ? 'border-navy bg-navy text-white' : 'border-border text-text-secondary hover:border-navy/30'"
          >
            {{ m.label }}
          </button>
        </div>
      </div>

      <div>
        <label for="mark-paid-amount" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Monto <span class="text-coral">*</span></label>
        <input id="mark-paid-amount" name="markPaidAmount" required aria-required="true" v-model.number="amount" data-testid="mark-paid-amount"
          type="number" min="0.01" step="0.01" :max="pending"
          class="w-full rounded-xl border border-border px-4 py-2.5 text-lg font-black text-navy tabular-nums focus:border-navy focus:outline-none" />
        <p class="mt-1 text-[11px] text-text-muted">Saldo pendiente: <span class="font-bold text-navy tabular-nums">{{ money(pending) }}</span></p>
        <p v-if="amountError" data-testid="mark-paid-amount-error" class="mt-1 text-[11px] font-bold text-coral">{{ amountError }}</p>
      </div>

      <div>
        <label for="mark-paid-reference" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">
          Referencia <span v-if="referenceRequired" class="text-coral">*</span>
        </label>
        <input id="mark-paid-reference" name="markPaidReference" v-model="reference" data-testid="mark-paid-reference" type="text"
          :required="referenceRequired" :aria-required="referenceRequired ? 'true' : undefined"
          placeholder="N° de transferencia, comprobante, últimos 4…"
          class="w-full rounded-xl border border-border px-4 py-2.5 text-sm focus:border-navy focus:outline-none" />
        <p v-if="referenceRequired && !reference.trim()" data-testid="mark-paid-reference-hint" class="mt-1 text-[11px] text-text-muted">
          Obligatoria para transferencia y tarjeta: es la evidencia del cobro.
        </p>
      </div>

      <div>
        <label for="mark-paid-note" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Nota</label>
        <textarea id="mark-paid-note" name="markPaidNote" v-model="note" data-testid="mark-paid-note" rows="2" placeholder="Opcional..."
          class="w-full resize-none rounded-xl border border-border px-4 py-2.5 text-sm focus:border-navy focus:outline-none"></textarea>
      </div>
    </div>

    <template #footer>
      <button type="button" @click="emit('close')" :disabled="saving"
        class="px-4 py-2.5 text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer disabled:opacity-50">Cancelar</button>
      <button type="button" @click="confirm" data-testid="mark-paid-confirm" :disabled="saving || !valid"
        class="inline-flex items-center gap-2 rounded-full bg-teal px-5 py-2.5 text-sm font-extrabold text-white hover:bg-teal-light transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
        {{ saving ? 'Guardando…' : 'Registrar pago' }}
      </button>
    </template>
  </AppModal>
</template>

<script setup lang="ts">
// MarkPaidModal.vue — Registrar un cobro manual (fuera de Stripe) sobre una reserva.
//
// Por qué existe (REQ-RWP-06, #249): cuando el huésped pagaba por transferencia o en efectivo,
// la recepción "confirmaba" la reserva cambiando el status a mano. La plata no quedaba en
// `payments`: no había rastro de cuánto entró, por dónde, con qué comprobante ni quién lo
// cargó, y el badge de pago seguía diciendo "Pendiente". Este modal manda todo eso a
// `POST /reservas/:id/mark-paid`, que inserta el pago con el usuario que lo registró y
// recalcula el saldo. El anticipo (`deposit`) NO se toca: es un dato de la reserva, no un cobro.
//
// Reglas del formulario (espejo de las del backend, que es quien manda):
//   · Monto > 0 y ≤ saldo pendiente. Se prellena con el pendiente cada vez que se abre.
//   · Referencia obligatoria para transferencia y tarjeta (es la evidencia); libre en efectivo/otro.
//   · El error del backend ya viene legible ("El cobro ($200) excede el saldo pendiente ($130)"),
//     se muestra tal cual.
import { ref, computed, watch } from 'vue'
import AppModal from '@/components/ui/AppModal.vue'
import { ReservationService, type MarkPaidMethod } from '@/services/Reservation.service'
import { useToast } from '@/composables/useToast'
import type { Reservation } from '@/types'

const props = withDefaults(defineProps<{
  open: boolean
  reservationId: string
  /** Saldo pendiente según el backend: tope del monto y valor inicial. */
  pending: number
  currency?: string
}>(), { currency: 'USD' })

const emit = defineEmits<{
  close: []
  /** Cobro ya persistido en el servidor: el host refresca detalle y listado. */
  paid: [result: Reservation]
}>()

const toast = useToast()

const METHODS: { value: MarkPaidMethod; label: string }[] = [
  { value: 'cash', label: 'Efectivo' },
  { value: 'transfer', label: 'Transferencia' },
  { value: 'card', label: 'Tarjeta' },
  { value: 'other', label: 'Otro' },
]

const method = ref<MarkPaidMethod>('cash')
const amount = ref<number | ''>(0)
const reference = ref('')
const note = ref('')
const saving = ref(false)

/** Cada apertura arranca limpia: el monto se prellena con el pendiente actual. */
watch(() => props.open, (open) => {
  if (!open) return
  method.value = 'cash'
  amount.value = round2(props.pending)
  reference.value = ''
  note.value = ''
  saving.value = false
}, { immediate: true })

const referenceRequired = computed(() => method.value === 'transfer' || method.value === 'card')

const amountNumber = computed(() => (typeof amount.value === 'number' && Number.isFinite(amount.value) ? amount.value : NaN))

const amountError = computed(() => {
  const n = amountNumber.value
  if (!(n > 0)) return 'Ingresá un monto mayor a cero.'
  if (n > round2(props.pending) + 0.005) return `El monto supera el saldo pendiente (${money(props.pending)}).`
  return ''
})

const valid = computed(() => !amountError.value && (!referenceRequired.value || !!reference.value.trim()))

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100
}

function money(n: number): string {
  const cur = props.currency || 'USD'
  const sym = cur === 'USD' ? 'US$' : cur === 'DOP' ? 'RD$' : cur + ' '
  return `${sym}${(Number(n) || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

async function confirm() {
  if (!valid.value || saving.value || !props.reservationId) return
  saving.value = true
  try {
    const result = await ReservationService.markPaid(props.reservationId, {
      method: method.value,
      amount: round2(amountNumber.value),
      reference: reference.value.trim() || undefined,
      note: note.value.trim() || undefined,
    })
    toast.success('Pago registrado')
    emit('paid', result)
    emit('close')
  } catch (e) {
    toast.error((e as Error).message || 'No se pudo registrar el pago')
  } finally {
    saving.value = false
  }
}
</script>
