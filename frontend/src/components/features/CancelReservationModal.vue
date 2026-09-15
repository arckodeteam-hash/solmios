<template>
  <AppModal :open="open" title="Cancelar reserva" size="md" body-class="p-0" @close="emit('close')">
    <!-- Cargando el cálculo: nunca se muestra un número antes de tenerlo del servidor. -->
    <div v-if="loading" data-testid="cancel-loading" class="px-5 py-10 text-center text-sm text-text-muted">
      Calculando la cancelación…
    </div>

    <!--
      El preview falló. NO se ofrece cancelar a ciegas: sin el cálculo no se sabe cuánta plata
      pierde el hotel ni cuánto se le devuelve al huésped, y la cancelación es irreversible.
      Tampoco se deja la pantalla pelada (un `v-else-if="preview"` sin este bloque dejaba el
      modal en blanco cuando el fetch fallaba).
    -->
    <div v-else-if="error" data-testid="cancel-error" class="px-5 py-8 text-center space-y-2">
      <div class="flex justify-center text-coral"><Icon name="alert" :size="28" /></div>
      <div class="text-sm font-bold text-navy">No se pudo calcular la cancelación</div>
      <p class="text-xs text-text-muted leading-snug">{{ error }}</p>
      <p class="text-[11px] text-text-muted leading-snug">
        Sin el cálculo de la política no se puede cancelar: se perdería la penalidad y el reembolso.
        Probá de nuevo en un momento.
      </p>
    </div>

    <div v-else-if="preview" data-testid="cancel-preview" class="px-5 py-4 space-y-4">
      <!-- Qué reserva se está por cancelar -->
      <div class="bg-surface rounded-xl px-3 py-2.5">
        <div class="text-sm font-bold text-navy">{{ guestLabel }}</div>
        <div class="text-xs text-text-muted mt-0.5">
          <span v-if="roomLabel">Hab. {{ roomLabel }} · </span>{{ dateLabel(preview.checkIn) }} → {{ dateLabel(preview.checkOut) }}
        </div>
        <div v-if="preview.hoursUntilCheckIn > 0" class="text-[11px] text-text-muted mt-0.5">
          Faltan {{ hoursLabel }} para la entrada.
        </div>
      </div>

      <!-- No se puede cancelar: se dice POR QUÉ y no se ofrece confirmar. -->
      <div v-if="!preview.canCancel" data-testid="cancel-blocked"
        class="bg-coral/10 border border-coral/30 rounded-xl px-3 py-2.5 text-xs text-coral font-bold">
        <span class="inline-flex items-start gap-1.5">
          <Icon name="ban" :size="13" class="mt-px shrink-0" />
          <span>{{ preview.blockedReason || 'Esta reserva no se puede cancelar.' }}</span>
        </span>
      </div>

      <template v-else>
        <!-- La consecuencia económica. Es el motivo entero de este modal: cancelar mueve plata. -->
        <div data-testid="cancel-money" class="space-y-1.5 rounded-xl border border-border px-3 py-2.5">
          <div class="flex items-baseline justify-between text-xs">
            <span class="text-text-muted">Total de la reserva</span>
            <span class="font-bold text-navy tabular-nums">{{ money(preview.totalAmount) }}</span>
          </div>
          <div class="flex items-baseline justify-between text-xs">
            <!-- Todo lo cobrado (anticipo + efectivo/folio/factura − devoluciones), no sólo la columna `deposit`: es la base de la penalidad (backend `usecases/cancel-base.ts`). -->
            <span class="text-text-muted">Cobrado al huésped</span>
            <span class="font-bold text-navy tabular-nums">{{ money(preview.deposit) }}</span>
          </div>
          <div class="flex items-baseline justify-between text-xs pt-1.5 border-t border-border/60">
            <span class="text-text-muted">Penalidad <span class="font-bold text-navy">({{ preview.penaltyPercent }}%)</span></span>
            <span data-testid="cancel-fee" class="font-black text-coral tabular-nums">{{ money(preview.cancellationFee) }}</span>
          </div>
          <div class="flex items-baseline justify-between text-sm">
            <span class="font-bold text-navy">Se le devuelve al huésped</span>
            <span data-testid="cancel-refund" class="font-black tabular-nums" :class="preview.refundAmount > 0 ? 'text-teal' : 'text-text-muted'">
              {{ money(preview.refundAmount) }}
            </span>
          </div>
          <p class="text-[11px] text-text-muted leading-snug pt-1">
            Política aplicada: <span class="font-bold text-navy">{{ policyText }}</span>
          </p>
        </div>

        <!--
          Sin política cargada el sistema reembolsa TODO. Hay que decirlo: si no, el hotel cree
          que está aplicando su política de cancelación y en realidad está devolviendo el 100%.
        -->
        <p v-if="preview.policySource === 'default'" data-testid="cancel-no-policy"
          class="flex items-start gap-1.5 rounded-xl bg-gold/10 px-3 py-2 text-[11px] text-gold font-bold">
          <Icon name="alert" :size="13" class="mt-px shrink-0" />
          <span>El hotel no tiene política de cancelación configurada: se reembolsa el total. Cargá una política en Configuración para cobrar penalidades.</span>
        </p>

        <!--
          Motivo OBLIGATORIO: queda en el historial de la reserva y es lo que explica después
          por qué se perdió esa plata. Hay que ELEGIRLO — sin default premarcado, mismo criterio
          que el modal de mover/extender.
        -->
        <div class="space-y-2">
          <label for="cancel-reason" class="block text-[10px] font-bold text-text-muted uppercase">Motivo de la cancelación</label>
          <select id="cancel-reason" v-model="reasonKey" data-testid="cancel-reason-select"
            class="w-full px-3 py-2 rounded-xl border border-border text-sm cursor-pointer">
            <option value="">Elegí un motivo…</option>
            <option v-for="r in REASONS" :key="r.key" :value="r.key">{{ r.label }}</option>
          </select>
          <input v-if="reasonKey === 'other'" v-model="reasonOther" data-testid="cancel-reason-other"
            type="text" maxlength="300" placeholder="Escribí el motivo…"
            class="w-full px-3 py-2 rounded-xl border border-border text-sm" />
        </div>

        <!-- Aviso al huésped: marcado por defecto, salvo "Error de carga" (la reserva nunca debió
             existir y un correo de "cancelada" confundiría). Sin correo no hay a quién avisar. -->
        <label v-if="preview.guestEmail" data-testid="cancel-notify-guest" class="flex items-start gap-2 text-xs text-navy cursor-pointer">
          <input v-model="notifyGuest" type="checkbox" class="mt-0.5 cursor-pointer" />
          <span>Avisar al huésped por correo <span class="text-text-muted">({{ preview.guestEmail }})</span></span>
        </label>
        <p v-else data-testid="cancel-no-guest-email" class="text-[11px] text-text-muted">El huésped no tiene correo cargado: no se le puede avisar por email.</p>
      </template>
    </div>

    <template #footer>
      <span v-if="canConfirmShape && !reason" data-testid="cancel-reason-required"
        class="mr-auto text-xs font-bold text-text-muted">Elegí el motivo para poder cancelar.</span>
      <!-- "Cancelar" a secas sería ambiguo acá: cancelar la reserva vs. salir del modal. -->
      <button type="button" @click="emit('close')"
        class="px-4 py-2 rounded-xl text-sm font-bold text-navy hover:bg-surface cursor-pointer">
        {{ canConfirmShape ? 'Volver' : 'Cerrar' }}
      </button>
      <button v-if="canConfirmShape" type="button" @click="confirm" data-testid="cancel-confirm-button" :disabled="!reason || submitting"
        class="px-5 py-2 rounded-xl text-sm font-black text-white bg-coral hover:brightness-95 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
        {{ submitting ? 'Cancelando…' : 'Cancelar reserva' }}
      </button>
    </template>
  </AppModal>
</template>

<script setup lang="ts">
// CancelReservationModal.vue — Cancelar una reserva con la política del hotel a la vista.
//
// Problema que resuelve: el planning cancelaba en el acto desde el popover, sin preguntar nada,
// y además por el endpoint equivocado (`update({status:'cancelled'})`). Eso salteaba la política
// de cancelación entera: no calculaba penalidad ni reembolso, no guardaba el motivo y dejaba el
// depósito retenido. Cancelar es irreversible y mueve plata: se confirma, y se confirma VIENDO
// cuánto se pierde.
//
// Reglas:
//   · El preview (`GET /reservas/:id/cancel-preview`) es dry-run: se pide al abrir y NO escribe.
//   · Si el preview falla NO se ofrece cancelar a ciegas (ni se deja la pantalla en blanco).
//   · `canCancel: false` → se muestra el porqué y solo queda cerrar.
//   · El motivo es obligatorio y sin default: hay que ELEGIRLO (mismo criterio que RescheduleModal).
import { ref, computed, watch } from 'vue'
import AppModal from '@/components/ui/AppModal.vue'
import Icon from '@/components/ui/Icon.vue'
import { ReservationService } from '@/services/Reservation.service'
import { useToast } from '@/composables/useToast'
import type { CancelPreview, CancellableReservation, Reservation } from '@/types'

const props = defineProps<{
  open: boolean
  reservation: CancellableReservation | null
}>()

const emit = defineEmits<{
  close: []
  /** Cancelación ya persistida en el servidor: el host refresca su vista. */
  cancelled: [result: Reservation]
}>()

const toast = useToast()

const preview = ref<CancelPreview | null>(null)
const loading = ref(false)
const submitting = ref(false)
const error = ref('')
/**
 * Arranca vacío A PROPÓSITO: el motivo queda en el historial y es lo que después explica por qué
 * se perdió esa plata. Con un motivo premarcado todas las cancelaciones terminarían diciendo lo
 * mismo, que es igual a no tener motivo.
 */
const reasonKey = ref('')
const reasonOther = ref('')
/** Avisar al huésped por correo. Se reajusta al elegir el motivo (ver watch de `reasonKey`). */
const notifyGuest = ref(true)

const REASONS: { key: string; label: string }[] = [
  { key: 'guest_request', label: 'Solicitud del huésped' },
  { key: 'no_show', label: 'El huésped no se presentó' },
  { key: 'overbooking', label: 'Sobreventa' },
  { key: 'data_entry_error', label: 'Error de carga' },
  { key: 'other', label: 'Otro' },
]

// "Error de carga" no se le comunica al huésped; cualquier otro motivo sí. El operador puede cambiarlo.
watch(reasonKey, (key) => { notifyGuest.value = key !== 'data_entry_error' })

/** Texto que viaja al backend como `reason`. Vacío = todavía no se eligió nada. */
const reason = computed(() => {
  if (!reasonKey.value) return ''
  if (reasonKey.value === 'other') return reasonOther.value.trim()
  return REASONS.find(r => r.key === reasonKey.value)?.label ?? ''
})

/** Hay algo que confirmar: preview cargado, sin error y la reserva es cancelable. */
const canConfirmShape = computed(() => !loading.value && !error.value && !!preview.value?.canCancel)

const guestLabel = computed(() => preview.value?.guestName || props.reservation?.guestName || 'Huésped')
const roomLabel = computed(() => {
  const room = props.reservation?.roomNumber
  return room === undefined || room === null || room === '' ? '' : String(room)
})

const policyText = computed(() => {
  const p = preview.value
  if (!p) return ''
  const parts = [p.policyLabel, p.tierLabel].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'Sin política configurada'
})

const hoursLabel = computed(() => {
  const hours = preview.value?.hoursUntilCheckIn ?? 0
  const HOURS_PER_DAY = 24
  if (hours < HOURS_PER_DAY) return `${Math.round(hours)} h`
  const days = Math.floor(hours / HOURS_PER_DAY)
  const rest = Math.round(hours % HOURS_PER_DAY)
  return rest ? `${days} d ${rest} h` : `${days} d`
})

function money(value: number): string {
  const currency = preview.value?.currency || 'USD'
  return `${currency} ${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function dateLabel(value: string): string {
  return String(value || '').slice(0, 10)
}

// Reset + preview al abrir (o al cambiar de reserva sin cerrar el modal).
watch(() => [props.open, props.reservation?.id] as const, ([isOpen]) => {
  if (!isOpen) return
  preview.value = null
  error.value = ''
  submitting.value = false
  reasonKey.value = ''   // cada apertura obliga a elegir de nuevo
  reasonOther.value = ''
  notifyGuest.value = true
  void loadPreview()
}, { immediate: true })

async function loadPreview() {
  const reservation = props.reservation
  if (!reservation) return
  loading.value = true
  error.value = ''
  try {
    preview.value = await ReservationService.cancelPreview(reservation.id)
  } catch (e: unknown) {
    preview.value = null
    error.value = errorMessage(e, 'No se pudo obtener la política de cancelación')
  } finally {
    loading.value = false
  }
}

async function confirm() {
  const reservation = props.reservation
  const p = preview.value
  // El botón ya está bloqueado sin motivo, pero el guard va igual: nunca cancelamos sin motivo
  // ni sin preview por un doble evento, un atajo de teclado o un refactor que pierda el disabled.
  if (!reservation || !p || !p.canCancel || !reason.value || submitting.value) return
  submitting.value = true
  try {
    const result = await ReservationService.cancel(reservation.id, { reason: reason.value, notifyGuest: !!p.guestEmail && notifyGuest.value })
    // El monto que se anuncia es el que el servidor APLICÓ, no el que se cotizó al abrir: entre
    // una cosa y la otra puede cruzarse un borde de tier (p. ej. las 72h de `moderate`) y el
    // reembolso real cambia. Prometer el viejo mandaría a devolver plata de más en el mostrador.
    const refunded = result.refundAmount ?? p.refundAmount
    toast.success(refunded > 0 ? `Reserva cancelada — ${money(refunded)} a devolver` : 'Reserva cancelada')
    emit('cancelled', result)
    emit('close')
  } catch (e: unknown) {
    toast.error(errorMessage(e, 'No se pudo cancelar la reserva'))
  } finally {
    submitting.value = false
  }
}

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback
}

defineExpose({ confirm })
</script>

<style scoped>
/* Sin estilos propios: todo el look sale de los tokens del design system (main.css). */
</style>
