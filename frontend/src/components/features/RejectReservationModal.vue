<script setup lang="ts">
// components/features/RejectReservationModal.vue — #271 MR-06: motivo para RECHAZAR una reserva
// pendiente de aprobación (hotel con "confirmación instantánea" apagada). Rechazar reembolsa el
// 100% de lo cobrado por Stripe y le manda el motivo al huésped por email, así que acá el texto es
// LIBRE y con un mínimo (10 caracteres): no sirve el molde de `restaurante/VoidReasonModal.vue`
// (motivos predefinidos por botón, para la tablet de cocina). Cerrar sin confirmar no cambia nada:
// el que llama actúa solo en `confirm` (POST /reservas/:id/reject).
import { ref, computed } from 'vue'
import AppModal from '@/components/ui/AppModal.vue'
import { formatMoney } from '@/utils/rate-calendar'

/** Mismo mínimo que valida el backend (`reservas/validators/schema.ts`, 400 si no llega). */
const REJECT_REASON_MIN = 10
const REJECT_REASON_MAX = 500

const props = withDefaults(defineProps<{
  guestName: string
  /** Lo cobrado por Stripe que se va a devolver. 0 = no hay nada que reembolsar por Stripe. */
  refundAmount: number
  currency?: string
  loading?: boolean
  /** La reserva es una habitación de una reserva de varias: cae (y se reembolsa) el grupo entero. */
  isGroup?: boolean
}>(), { currency: 'USD', loading: false, isGroup: false })

const emit = defineEmits<{ confirm: [reason: string]; close: [] }>()

const reasonText = ref('')
const reason = computed(() => reasonText.value.trim())
const canConfirm = computed(() => reason.value.length >= REJECT_REASON_MIN && !props.loading)

const refundLabel = computed(() => formatMoney(Number(props.refundAmount || 0), props.currency || 'USD', 'es', true))

function confirm() {
  if (!canConfirm.value) return
  emit('confirm', reason.value)
}
</script>

<template>
  <AppModal size="md" title="Rechazar reserva" :subtitle="guestName" :closable="!loading" :close-on-backdrop="!loading" @close="emit('close')">
    <label class="block text-[10px] font-bold uppercase tracking-wide text-text-muted mb-1" for="reject-reason">Motivo</label>
    <textarea id="reject-reason" v-model="reasonText" rows="4" :maxlength="REJECT_REASON_MAX" :disabled="loading" autofocus
      data-testid="reject-reason"
      class="w-full rounded-xl border-2 border-border px-3 py-2 text-sm text-navy focus:border-navy focus:outline-none disabled:opacity-50"
      placeholder="Contale al huésped por qué no podés confirmar"></textarea>
    <p class="mt-1 text-[11px]" :class="reason.length >= REJECT_REASON_MIN ? 'text-text-muted' : 'text-coral'" data-testid="reject-reason-count">
      {{ reason.length }}/{{ REJECT_REASON_MIN }} mín.
    </p>
    <p class="mt-1 text-xs text-text-muted">El huésped recibe este motivo por email junto con la confirmación del reembolso.</p>

    <div class="mt-4 rounded-xl border-2 border-coral/40 bg-coral/10 px-4 py-3 text-sm font-bold text-coral" data-testid="reject-refund-notice">
      <p v-if="refundAmount > 0">Se reembolsarán {{ refundLabel }} al huésped</p>
      <p v-else>No hay cobros por Stripe para reembolsar: si el huésped pagó por otro medio, devolvelo a mano</p>
      <p v-if="isGroup" class="mt-1 text-xs font-semibold" data-testid="reject-group-notice">Se rechaza y reembolsa el grupo entero</p>
    </div>

    <template #footer>
      <button type="button" @click="emit('close')" :disabled="loading"
        class="flex-1 py-2.5 rounded-xl border-2 border-navy/30 text-sm font-bold text-text-secondary hover:bg-surface disabled:opacity-50">Volver</button>
      <button type="button" @click="confirm" :disabled="!canConfirm" data-testid="reject-confirm"
        class="flex-1 py-2.5 rounded-xl bg-coral border-2 border-coral text-sm font-bold text-white hover:bg-coral/80 disabled:opacity-50">
        {{ loading ? 'Rechazando…' : 'Rechazar y reembolsar' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped></style>
