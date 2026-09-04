<template>
  <AppModal :open="open" :title="titulo" :subtitle="subtitulo" size="md" body-class="p-0" @close="emit('close')">
    <!-- Modo "Extender" desde el menú: lo único que se elige acá es hasta cuándo se queda. La
         entrada y la habitación no se tocan — para eso están arrastrar y "Ver reserva". -->
    <div v-if="editable && target" class="px-5 pt-4">
      <label class="block text-[10px] font-bold text-text-muted uppercase mb-1.5">Se va el</label>
      <input type="date" :value="target.checkOut" :min="minCheckOut"
        @change="onExtendDateChange(($event.target as HTMLInputElement).value)"
        class="w-full px-3 py-2 rounded-xl border border-border text-sm" />
      <p class="mt-1.5 text-[11px] text-text-muted">
        Entra el {{ String(reservation?.checkIn ?? '').slice(0, 10) }} en la hab.
        {{ roomNumberOf(String(reservation?.roomId ?? '')) }} — eso no cambia acá.
      </p>
    </div>

    <div v-if="loading" class="px-5 py-10 text-center text-sm text-text-muted">Calculando cambio…</div>

    <div v-else-if="quote" class="px-5 py-4 space-y-4">
      <!-- Resumen del cambio -->
      <div class="text-sm text-navy font-bold">{{ reservation?.name || 'Reserva' }}</div>
      <div class="flex items-center gap-2 text-xs bg-surface rounded-xl px-3 py-2.5">
        <div class="flex-1">
          <div class="text-[10px] text-text-muted uppercase font-bold">Antes</div>
          <div class="font-bold text-navy">Hab. {{ roomNumberOf(String(reservation?.roomId ?? '')) }}</div>
          <div class="text-text-muted">{{ String(reservation?.checkIn ?? '').slice(0, 10) }} → {{ String(reservation?.checkOut ?? '').slice(0, 10) }} · {{ quote.oldNights }}n</div>
        </div>
        <span class="text-teal text-lg">→</span>
        <div class="flex-1 text-right">
          <div class="text-[10px] text-text-muted uppercase font-bold">Después</div>
          <div class="font-bold text-navy">Hab. {{ roomNumberOf(quote.roomId) }}</div>
          <div class="text-text-muted">{{ quote.checkIn }} → {{ quote.checkOut }} · {{ quote.newNights }}n</div>
        </div>
      </div>

      <!-- No disponible -->
      <div v-if="!quote.available" class="bg-coral/10 border border-coral/30 rounded-xl px-3 py-2.5 text-xs text-coral font-bold">
        <span class="inline-flex items-center gap-1"><Icon name="ban" :size="13" /> {{ quote.reason || 'La habitación no está disponible en esas fechas.' }}</span>
      </div>

      <template v-else>
        <!-- Elección de precio — SIEMPRE visible, aunque las dos opciones den el mismo número
             (ahí `refreshQuote` ya preseleccionó 'keep': se ve marcada, no hay nada oculto). Con
             números distintos arranca sin marcar — mover una reserva no decide el precio solo. -->
        <div class="space-y-2">
          <div class="flex items-baseline justify-between">
            <label class="block text-[10px] font-bold text-text-muted uppercase">Qué pasa con el precio</label>
            <span class="text-xs text-text-muted tabular-nums">Total anterior <span class="font-bold text-navy">{{ money(quote.previousTotal) }}</span></span>
          </div>

          <button v-for="opt in pricingOptions" :key="opt.key" type="button"
            :data-testid="`pricing-${opt.key}`" :aria-pressed="pricingMode === opt.key"
            @click="pricingMode = opt.key"
            class="w-full text-left rounded-xl border-2 px-3 py-2.5 transition cursor-pointer"
            :class="pricingMode === opt.key ? 'border-navy bg-navy/5' : 'border-border bg-white hover:border-navy/40'">
            <div class="flex items-start gap-2.5">
              <span class="mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 grid place-items-center"
                :class="pricingMode === opt.key ? 'border-navy' : 'border-border'">
                <span v-if="pricingMode === opt.key" class="h-2 w-2 rounded-full bg-navy"></span>
              </span>
              <span class="min-w-0 flex-1">
                <span class="block text-sm font-bold text-navy">{{ opt.label }}</span>
                <span class="block text-[11px] text-text-muted leading-snug">{{ opt.hint }}</span>
              </span>
              <span class="shrink-0 text-right">
                <span class="block text-sm font-black text-navy tabular-nums">{{ money(opt.total) }}</span>
                <span class="block text-[11px] font-bold tabular-nums"
                  :class="opt.difference > 0 ? 'text-coral' : opt.difference < 0 ? 'text-teal' : 'text-text-muted'">
                  {{ differenceLabel(opt.difference) }}
                </span>
              </span>
            </div>
          </button>

          <!-- Sin tarifas cargadas el recálculo degrada a rooms.basePrice: sin este aviso, los dos
               totales salen iguales y el usuario no entiende por qué "recalcular" no hace nada. -->
          <p v-if="!quote.repricedFromRates" data-testid="no-rates-warning"
            class="flex items-start gap-1.5 rounded-xl bg-gold/10 px-3 py-2 text-[11px] text-gold font-bold">
            <Icon name="alert" :size="13" class="mt-px shrink-0" />
            <span>El hotel no tiene tarifas cargadas para esas fechas: el recálculo usó el precio base de la habitación.</span>
          </p>
        </div>

        <!-- Resultado del modo elegido. Mientras no haya elección NO se muestra un total: un
             "Nuevo total USD 0.00" es un número inventado, y el "Sin diferencia a cobrar" de más
             abajo afirmaría que no hay nada que cobrar cuando todavía no se decidió nada. -->
        <div class="space-y-1 text-sm pt-1 border-t border-border/50">
          <div v-if="pricingMode" class="flex justify-between text-navy font-bold"><span>Nuevo total</span><span class="tabular-nums">{{ money(selectedTotal) }}</span></div>
          <div v-else data-testid="total-pending" class="text-xs text-text-muted italic">Elegí una opción para ver el total.</div>
        </div>

        <!-- Cobro: SOLO cuando hay diferencia a favor del hotel -->
        <div v-if="selectedDifference > 0" data-testid="charge-block" class="space-y-3 pt-1 border-t border-border">
          <div>
            <label class="block text-[10px] font-bold text-text-muted uppercase mb-1.5">Cómo se cobra</label>
            <div class="grid grid-cols-3 gap-2">
              <button v-for="m in CHARGE_METHODS" :key="m.k" type="button"
                @click="method = m.k"
                class="px-2 py-2 rounded-xl text-xs font-bold border cursor-pointer transition"
                :class="method === m.k ? 'bg-navy text-white border-navy' : 'bg-white text-navy border-border hover:border-navy/40'">
                {{ m.l }}
              </button>
            </div>
            <p v-if="method === 'folio'" class="text-[10px] text-text-muted mt-1">Se agrega a la cuenta abierta; se salda en el checkout.</p>
            <p v-else-if="method === 'cash'" class="text-[10px] text-text-muted mt-1">Se registra un pago en efectivo (entra a caja).</p>
            <p v-else class="text-[10px] text-text-muted mt-1">Genera un link de pago Stripe (el huésped paga con su tarjeta).</p>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block text-[10px] font-bold text-text-muted uppercase mb-1">Monto a cobrar</label>
              <input v-model="amount" type="number" min="0" class="w-full px-3 py-2 rounded-xl border border-border text-sm" />
            </div>
            <div>
              <label class="block text-[10px] font-bold text-text-muted uppercase mb-1">Motivo (opcional)</label>
              <input v-model="reason" type="text" maxlength="300" placeholder="ej. descuento" class="w-full px-3 py-2 rounded-xl border border-border text-sm" />
            </div>
          </div>
        </div>

        <!-- El total baja. Dos situaciones que se veían idénticas y NO lo son: que el huésped
             ahora deba menos (no hay plata de nadie) y que haya pagado de más (sí la hay). El
             servidor manda `paidAmount`, así que acá ya no se adivina. -->
        <div v-else-if="selectedDifference < 0" data-testid="credit-block"
          class="rounded-xl border border-teal/30 bg-teal/10 px-3 py-2.5 space-y-2">
          <div class="flex items-center justify-between text-sm font-black text-teal">
            <span>{{ overpaid > 0 ? 'Pagó de más' : 'El total baja' }}</span>
            <span class="tabular-nums">{{ money(overpaid > 0 ? overpaid : Math.abs(selectedDifference)) }}</span>
          </div>

          <!-- No pagó de más: no hay nada que decidir. -->
          <p v-if="overpaid <= 0" data-testid="credit-none" class="text-[11px] text-teal/90 leading-snug">
            Ahora debe {{ money(Math.abs(selectedDifference)) }} menos. No hay nada que devolver:
            todavía no había pagado esa plata.
          </p>

          <!-- Pagó de más: se resuelve acá mismo, sin ir a Finanzas. -->
          <template v-else>
            <p class="text-[11px] text-teal/90 leading-snug">Ya pagó esa plata. ¿Qué hacés con ella?</p>
            <div class="grid grid-cols-2 gap-2">
              <button v-for="opt in creditOptions" :key="opt.key" type="button"
                :data-testid="`credit-${opt.key}`" @click="creditAction = opt.key"
                class="rounded-lg border-2 px-2.5 py-2 text-left transition-colors cursor-pointer"
                :class="creditAction === opt.key ? 'border-teal bg-white' : 'border-transparent bg-white/60 hover:bg-white'">
                <span class="block text-xs font-black text-navy">{{ opt.label }}</span>
                <span class="block text-[10px] text-text-muted leading-snug">{{ opt.hint }}</span>
              </button>
            </div>
          </template>
        </div>

        <div v-else-if="pricingMode" data-testid="no-difference" class="text-xs text-text-muted italic">Sin diferencia a cobrar.</div>
      </template>
    </div>

    <template #footer>
      <!-- Mientras no se haya elegido qué pasa con el precio, no hay nada que confirmar. -->
      <span v-if="quote?.available && !pricingMode" data-testid="pricing-required"
        class="mr-auto text-xs font-bold text-text-muted">Elegí qué pasa con el precio para continuar.</span>
      <button type="button" @click="emit('close')" class="px-4 py-2 rounded-xl text-sm font-bold text-navy hover:bg-surface cursor-pointer">Cancelar</button>
      <button type="button" @click="confirm" :disabled="loading || submitting || !quote?.available || !pricingMode"
        class="px-5 py-2 rounded-xl text-sm font-black text-white bg-teal hover:brightness-95 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
        {{ submitting ? 'Aplicando…' : 'Confirmar' }}
      </button>
    </template>
  </AppModal>
</template>

<script setup lang="ts">
// RescheduleModal.vue — Mover / extender una reserva desde el planning (#204/#207).
//
// Regla de negocio que motiva este modal: al mover una reserva a otra habitación o a otras fechas
// el precio NUNCA se decide solo SI HAY UNA DECISIÓN REAL que tomar. El backend cotiza los dos
// caminos posibles y acá el usuario elige cuál se aplica (`pricingMode`):
//   · keep    → se respeta el precio pactado; solo se cobran las noches AGREGADAS a tarifa base.
//   · reprice → se reprecia toda la estadía nueva a tarifa vigente del destino (temporadas incl.).
// Sin default MIENTRAS los dos caminos den números distintos: el modal abre sin opción marcada y
// "Confirmar" queda bloqueado hasta elegir. Cuando `keepTotal === repricedTotal` no hay nada que
// decidir (mover una reserva un par de días sin cambiar de temporada/tarifa es el caso típico) —
// forzar una elección entre dos números idénticos es fricción sin propósito, así que `refreshQuote`
// preselecciona 'keep' y el usuario solo confirma el movimiento.
//
// Una sola cotización alcanza: el quote trae SIEMPRE `keepTotal` y `repricedTotal`, así que
// cambiar de opción no dispara otra llamada.
import { ref, computed, watch } from 'vue'
import AppModal from '@/components/ui/AppModal.vue'
import Icon from '@/components/ui/Icon.vue'
import { ReservationService } from '@/services/Reservation.service'
import { useToast } from '@/composables/useToast'
import type {
  RescheduleQuote, RescheduleCommitInput, RescheduleResult, RescheduleTarget,
  ReschedulePricingMode, RescheduleChargeMethod, ReschedulableReservation, RescheduleRoomRef,
  RescheduleCreditAction,
} from '@/types'

const props = withDefaults(defineProps<{
  open: boolean
  reservation: ReschedulableReservation | null
  target: RescheduleTarget | null
  /** `true` = modo "Extender" del menú: la fecha de salida se edita dentro del modal. */
  editable?: boolean
  rooms?: RescheduleRoomRef[]
}>(), { editable: false, rooms: () => [] })

const emit = defineEmits<{
  close: []
  /** Cambio aplicado en el servidor: el host actualiza el planning y refresca sus KPIs. */
  applied: [result: RescheduleResult, target: RescheduleTarget]
}>()

const toast = useToast()

const quote = ref<RescheduleQuote | null>(null)
const loading = ref(false)
const submitting = ref(false)
/**
 * Arranca en `null` A PROPÓSITO cuando hay una decisión real: hay que ELEGIR, no confirmar algo
 * ya elegido. Con una opción premarcada el recepcionista aprieta "Aplicar" en automático y el
 * precio nunca se actualiza — que es exactamente el problema del que salió esta pantalla
 * ("siempre se queda con el mismo precio"). Sin selección, el botón de aplicar queda bloqueado.
 * Excepción: `refreshQuote` la precarga en 'keep' cuando `keepTotal === repricedTotal` — ahí no
 * hay nada que elegir, las dos rutas dan el mismo número.
 */
const pricingMode = ref<ReschedulePricingMode | null>(null)
/**
 * Qué se hace con lo que pagó de más. Arranca en 'keep' (dejarlo a favor) a propósito: es lo
 * único que no mueve plata, y por lo tanto lo único que no hay que deshacer si el recepcionista
 * apretó sin leer. Devolver es explícito.
 */
const creditAction = ref<RescheduleCreditAction>('keep')
const method = ref<RescheduleChargeMethod>('folio')
const amount = ref('')
const reason = ref('')
/** Copia local del destino: en modo "Extender" la fecha de salida se edita acá dentro. */
const target = ref<RescheduleTarget | null>(null)

/** Una estadía tiene al menos una noche: salir el mismo día que se entra no es una estadía. */
const minCheckOut = computed(() => {
  const ci = String(props.reservation?.checkIn ?? '').slice(0, 10)
  if (!ci) return ''
  const d = new Date(`${ci}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
})

/**
 * El título dice lo que realmente va a pasar. Decía siempre "Mover / Extender reserva", incluso
 * abierto desde "Extender estadía" —donde lo único editable es la fecha de salida—: prometía dos
 * cosas y ofrecía un solo campo. Ahora nombra el cambio que se está por aplicar.
 */
const titulo = computed(() => {
  if (props.editable) return 'Extender estadía'
  const r = props.reservation; const t = target.value
  if (!r || !t) return 'Mover reserva'
  const otraHab = String(t.roomId) !== String(r.roomId)
  const entrada = String(r.checkIn ?? '').slice(0, 10)
  const salida = String(r.checkOut ?? '').slice(0, 10)
  const otraEntrada = t.checkIn.slice(0, 10) !== entrada
  const otraSalida = t.checkOut.slice(0, 10) !== salida
  if (otraHab && (otraEntrada || otraSalida)) return 'Mover reserva'
  if (otraHab) return 'Cambiar de habitación'
  if (otraEntrada) return 'Mover reserva'
  if (otraSalida) return t.checkOut.slice(0, 10) > salida ? 'Extender estadía' : 'Acortar estadía'
  return 'Mover reserva'
})

/** De quién y de qué habitación se está hablando, sin repetirlo en el cuerpo. */
const subtitulo = computed(() => {
  const r = props.reservation
  if (!r) return ''
  const hab = roomNumberOf(String(r.roomId ?? ''))
  return [r.name, hab ? `Hab. ${hab}` : ''].filter(Boolean).join(' · ')
})

const CHARGE_METHODS: { k: RescheduleChargeMethod; l: string }[] = [
  { k: 'folio', l: 'Folio' }, { k: 'cash', l: 'Efectivo' }, { k: 'card', l: 'Tarjeta' },
]

/** Sin opción elegida todavía no hay total que aplicar (ni bloque de cobro que mostrar). */
const selectedTotal = computed(() => {
  const q = quote.value
  if (!q || !pricingMode.value) return 0
  return pricingMode.value === 'reprice' ? q.repricedTotal : q.keepTotal
})
const selectedDifference = computed(() => {
  const q = quote.value
  if (!q || !pricingMode.value) return 0
  return pricingMode.value === 'reprice' ? q.repricedDifference : q.keepDifference
})

/**
 * Lo que el huésped pagó DE MÁS con la opción elegida: contra lo COBRADO, no contra el total
 * anterior. Antes el modal decía "a favor" en cuanto el total bajaba, y eso podía ser mentira —
 * si todavía no había pagado nada, no hay nada a su favor: simplemente ahora debe menos. Con esa
 * afirmación de por medio, el recepcionista devolvía plata que nunca había entrado.
 */
const overpaid = computed(() => {
  const q = quote.value
  if (!q || !pricingMode.value) return 0
  return Math.max(0, Math.round((Number(q.paidAmount ?? 0) - selectedTotal.value) * 100) / 100)
})

const creditOptions: { key: RescheduleCreditAction; label: string; hint: string }[] = [
  { key: 'keep', label: 'Dejar a favor', hint: 'Se le descuenta al cerrar la cuenta' },
  { key: 'refund', label: 'Devolver', hint: 'Vuelve por donde pagó' },
]

const pricingOptions = computed<{ key: ReschedulePricingMode; label: string; hint: string; total: number; difference: number }[]>(() => {
  const q = quote.value
  if (!q) return []
  return [
    {
      key: 'keep',
      label: 'Mantener el precio pactado',
      hint: 'Se respeta lo acordado; solo se cobran las noches agregadas.',
      total: q.keepTotal,
      difference: q.keepDifference,
    },
    {
      key: 'reprice',
      label: 'Recalcular al precio actual',
      hint: 'Reprecia toda la estadía con las tarifas vigentes del destino.',
      total: q.repricedTotal,
      difference: q.repricedDifference,
    },
  ]
})

function money(value: number): string {
  const currency = quote.value?.currency || 'USD'
  return `${currency} ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function differenceLabel(difference: number): string {
  if (difference > 0) return `+${money(difference)} a cobrar`
  if (difference < 0) return `${money(Math.abs(difference))} a favor`
  return 'Sin diferencia'
}

function roomNumberOf(id: string): string {
  const room = props.rooms.find(r => String(r.id) === String(id))
  return room?.number !== undefined && room.number !== null ? String(room.number) : id
}

// Reset + cotización al abrir (o al cambiar de reserva sin cerrar el modal).
watch(() => [props.open, props.reservation?.id] as const, ([isOpen]) => {
  if (!isOpen) return
  quote.value = null
  submitting.value = false
  pricingMode.value = null   // cada apertura obliga a elegir de nuevo
  method.value = 'folio'
  reason.value = ''
  amount.value = ''
  target.value = props.target ? { ...props.target } : null
  void refreshQuote()
}, { immediate: true })

// El monto a cobrar sigue SIEMPRE al modo elegido: cambiar de opción cambia lo que se cobra, así
// que un monto tipeado a mano antes de cambiar de opción se descarta a propósito (si no, el
// recepcionista cobraría el importe de la opción que ya no está seleccionada).
watch([selectedDifference, quote], () => {
  amount.value = selectedDifference.value > 0 ? String(selectedDifference.value) : ''
})

async function refreshQuote() {
  const reservation = props.reservation
  if (!reservation || !target.value) return
  loading.value = true
  try {
    // El quote NO lleva `pricingMode`: devuelve los dos totales siempre, así cambiar de opción
    // no re-cotiza ni puede desincronizarlos. El modo solo importa en el commit.
    quote.value = await ReservationService.rescheduleQuote(reservation.id, { ...target.value })
    // Las dos opciones dan EXACTAMENTE el mismo total → no hay ninguna decisión de precio que
    // tomar, solo confirmar el movimiento. Forzar una elección acá era pedirle al recepcionista
    // que "eligiera" entre dos números idénticos — fricción sin ningún propósito. Con diferencia
    // real entre ambas SIGUE sin haber default (ver comentario de `pricingMode` más abajo).
    if (quote.value.available && quote.value.keepTotal === quote.value.repricedTotal) {
      pricingMode.value = 'keep'
    }
  } catch (e: unknown) {
    toast.error(errorMessage(e, 'No se pudo calcular el cambio'))
  } finally {
    loading.value = false
  }
}

/** Cambio de la fecha de salida desde el modal (modo "Extender" del menú). */
function onExtendDateChange(newCheckOut: string) {
  const current = target.value
  if (!current || !newCheckOut) return
  if (newCheckOut <= current.checkIn) { toast.error('La salida debe ser posterior a la entrada'); return }
  target.value = { ...current, checkOut: newCheckOut }
  // Otra estadía = otros dos totales: la elección hecha para el rango anterior ya no aplica.
  pricingMode.value = null
  void refreshQuote()
}

async function confirm() {
  const reservation = props.reservation
  const q = quote.value
  // `pricingMode` null = nadie eligió todavía; el botón está bloqueado, pero el guard va igual
  // (nunca mandamos un modo inventado al backend por un atajo de teclado o un doble evento).
  if (!reservation || !target.value || !q || !q.available || !pricingMode.value) return
  submitting.value = true
  try {
    const body: RescheduleCommitInput = { ...target.value, pricingMode: pricingMode.value }
    const amountNum = amount.value === '' ? null : Number(amount.value)
    const difference = selectedDifference.value
    // Diferencia negativa = saldo a favor: NO se cobra nada (y tampoco se devuelve solo).
    const wantsCharge = (amountNum ?? difference) > 0
    if (wantsCharge) {
      body.charge = { method: method.value, reason: reason.value || undefined }
      if (amountNum !== null && amountNum !== difference) body.charge.amount = amountNum
      if (method.value === 'card') { body.successUrl = window.location.href; body.cancelUrl = window.location.href }
    }
    // El monto NO viaja: lo calcula el servidor contra lo realmente cobrado. Acá solo va la
    // decisión de la persona.
    if (overpaid.value > 0) body.credit = { action: creditAction.value }
    const result = await ReservationService.reschedule(reservation.id, body)
    if (result.charge?.method === 'card') {
      if (result.charge.applied && result.charge.checkoutUrl) { window.open(result.charge.checkoutUrl, '_blank'); toast.success('Cambio aplicado — link de pago abierto') }
      else { toast.error(result.charge.message || 'No se pudo generar el cobro con tarjeta; cobrá en efectivo/POS') }
    } else if (result.charge?.applied) {
      toast.success(result.charge.target === 'folio' ? 'Cambio aplicado — cargado al folio' : 'Cambio aplicado — cobrado en efectivo')
    } else if (result.credit) {
      // El mensaje lo arma el servidor porque depende de por dónde salió la plata (tarjeta o caja)
      // y de si además hace falta una nota de crédito.
      const monto = money(result.quote.overpaidAmount)
      const texto = `${result.credit.action === 'refund' ? 'Devuelto' : 'A favor del huésped'}: ${monto}. ${result.credit.message ?? ''}`.trim()
      if (result.credit.needsCreditNote) toast.info('Cambio aplicado', texto)
      else toast.success('Cambio aplicado', texto)
    } else {
      toast.success('Reserva actualizada')
    }
    emit('applied', result, { ...target.value })
    emit('close')
  } catch (e: unknown) {
    toast.error(errorMessage(e, 'Error al aplicar el cambio'))
  } finally {
    submitting.value = false
  }
}

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback
}
</script>

<style scoped>
/* Sin estilos propios: todo el look sale de los tokens del design system (main.css). */
</style>
