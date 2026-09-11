<script setup lang="ts">
// components/features/restaurante/DiscountModal.vue — #215: modal de DESCUENTO o CORTESÍA para una línea
// o para la comanda entera. Tipo (porcentaje/monto), valor con atajos, motivo obligatorio (botones grandes
// del hotel + "Otro" con texto libre, mismo molde que VoidReasonModal) y una vista previa de cuánto queda.
// La vista previa es orientativa: el server recalcula subtotal/impuesto/total y aplica el tope del rol
// (403) — acá solo se deshabilita lo que ya se sabe que va a rebotar (valor sobre el tope, sin motivo).
import { ref, computed, watch } from 'vue'
import AppModal from '@/components/ui/AppModal.vue'
import type { DiscountType, DiscountPayload, DiscountPolicy } from '@/services/Restaurant.service'

const props = withDefaults(defineProps<{
  title: string
  subtitle?: string
  /** Monto sobre el que se aplica (lineTotal bruto de la línea, o suma de líneas de la comanda). */
  base: number
  /** Símbolo de la moneda del hotel para la vista previa. */
  currency?: string
  /** Tope (%) del usuario + motivos predefinidos (GET /restaurant/discount-policy). null = no se pudo cargar. */
  policy: DiscountPolicy | null
  /** Descuento vigente (para editarlo y para ofrecer "Quitar"). */
  current?: { type: DiscountType; value: number; reason?: string | null } | null
  loading?: boolean
}>(), { currency: '$', current: null, loading: false })

const emit = defineEmits<{ confirm: [payload: DiscountPayload]; remove: []; close: [] }>()

const OTHER = 'otro'
const isOther = (r: string): boolean => r.trim().toLocaleLowerCase() === OTHER
const PERCENT_PRESETS = [5, 10, 15, 20]

const type = ref<DiscountType>(props.current?.type ?? 'percent')
const value = ref<number>(props.current?.value ?? 0)
const selected = ref<string | null>(null)
const otherText = ref('')

const reasons = computed<string[]>(() => (props.policy?.reasons?.length ? props.policy.reasons : ['Otro']))
// Sin política cargada no se conoce el tope: se deja en 100 y el server decide (403 con el mensaje).
const cap = computed<number>(() => props.policy?.maxDiscountPercent ?? 100)
const canCourtesy = computed(() => cap.value >= 100)

// Motivo vigente: si coincide con uno de los botones se preselecciona; si no, "Otro" con el texto.
watch(() => [props.current, reasons.value] as const, () => {
  const cur = props.current?.reason?.trim()
  if (!cur) { selected.value = null; otherText.value = ''; return }
  const match = reasons.value.find((r) => r.trim().toLocaleLowerCase() === cur.toLocaleLowerCase())
  if (match) { selected.value = match; otherText.value = '' }
  else { selected.value = reasons.value.find(isOther) ?? null; otherText.value = cur }
}, { immediate: true })

const selectedIsOther = computed(() => selected.value !== null && isOther(selected.value))
const reason = computed<string>(() => {
  if (selected.value === null) return ''
  return selectedIsOther.value ? otherText.value.trim() : selected.value
})

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100
const money = (n: number): string => `${props.currency}${round2(Number(n || 0)).toFixed(2)}`

/** Vista previa (el server es el que manda): monto que se resta y lo que queda. */
const previewAmount = computed<number>(() => {
  const b = Number(props.base || 0)
  const v = Number(value.value || 0)
  if (!(b > 0) || !(v > 0)) return 0
  return round2(Math.min(b, type.value === 'percent' ? (b * v) / 100 : v))
})
const previewRemaining = computed(() => round2(Number(props.base || 0) - previewAmount.value))
/** % efectivo que se pide, para compararlo con el tope (un monto también cuenta contra el tope). */
const effectivePercent = computed<number>(() => {
  const b = Number(props.base || 0)
  if (!(b > 0)) return 0
  return round2((previewAmount.value / b) * 100)
})
const overCap = computed(() => effectivePercent.value > cap.value + 1e-9)
const isCourtesy = computed(() => type.value === 'percent' && Number(value.value) === 100)

const valueError = computed<string>(() => {
  const v = Number(value.value)
  if (!Number.isFinite(v) || v <= 0) return 'Indicá un valor mayor que 0'
  if (type.value === 'percent' && v > 100) return 'Un porcentaje no puede superar 100'
  if (overCap.value) return `Supera tu tope (${cap.value} %)`
  return ''
})
const canConfirm = computed(() => !props.loading && !valueError.value && reason.value.length > 0)

function setType(t: DiscountType) {
  if (props.loading || type.value === t) return
  type.value = t
  value.value = 0
}
function preset(pct: number) {
  if (props.loading) return
  type.value = 'percent'
  value.value = pct
}
function courtesy() {
  if (props.loading || !canCourtesy.value) return
  type.value = 'percent'
  value.value = 100
}
function pick(r: string) {
  if (props.loading) return
  selected.value = r
}
function confirm() {
  if (!canConfirm.value) return
  emit('confirm', { type: type.value, value: Number(value.value), reason: reason.value })
}
</script>

<template>
  <AppModal size="md" :title="title" :subtitle="subtitle" :closable="!loading" :close-on-backdrop="!loading" @close="emit('close')">
    <!-- Tipo -->
    <p class="text-[10px] font-bold uppercase tracking-wide text-text-muted mb-2">Tipo</p>
    <div class="grid grid-cols-2 gap-2 mb-3" role="group" aria-label="Tipo de descuento">
      <button type="button" data-testid="discount-type-percent" @click="setType('percent')" :disabled="loading" :aria-pressed="type === 'percent'"
        :class="['min-h-[44px] rounded-xl border-2 text-sm font-bold', type === 'percent' ? 'border-navy bg-navy text-white' : 'border-border text-navy hover:bg-surface']">Porcentaje</button>
      <button type="button" data-testid="discount-type-amount" @click="setType('amount')" :disabled="loading" :aria-pressed="type === 'amount'"
        :class="['min-h-[44px] rounded-xl border-2 text-sm font-bold', type === 'amount' ? 'border-navy bg-navy text-white' : 'border-border text-navy hover:bg-surface']">Monto</button>
    </div>

    <!-- Valor -->
    <div class="flex flex-wrap items-center gap-2 mb-1">
      <button v-for="p in PERCENT_PRESETS" :key="p" type="button" @click="preset(p)" :disabled="loading || p > cap"
        :class="['px-3 py-1.5 rounded-lg border-2 text-xs font-bold disabled:opacity-40', type === 'percent' && Number(value) === p ? 'border-navy bg-navy text-white' : 'border-border text-navy hover:bg-surface']">{{ p }} %</button>
      <button type="button" data-testid="discount-courtesy" @click="courtesy" :disabled="loading || !canCourtesy"
        :title="canCourtesy ? 'No se cobra: 100 % con motivo' : `Tu tope es ${cap} %`"
        :class="['px-3 py-1.5 rounded-lg border-2 text-xs font-bold disabled:opacity-40', isCourtesy ? 'border-gold bg-gold text-white' : 'border-gold/50 text-gold hover:bg-gold/10']">Cortesía 100 %</button>
      <div class="flex items-center gap-1.5 ml-auto">
        <label for="discount-value" class="text-xs text-text-muted">{{ type === 'percent' ? '%' : currency }}</label>
        <input id="discount-value" data-testid="discount-value" v-model.number="value" type="number" min="0" :max="type === 'percent' ? 100 : undefined" step="0.01" inputmode="decimal" :disabled="loading"
          class="w-24 px-2 py-1.5 rounded-lg border-2 border-border text-sm text-navy focus:border-navy focus:outline-none tabular-nums disabled:opacity-50" />
      </div>
    </div>
    <p v-if="valueError && Number(value) > 0" role="alert" data-testid="discount-value-error" class="text-[11px] font-bold text-coral mb-2">{{ valueError }}</p>
    <p v-else-if="cap < 100" class="text-[11px] text-text-muted mb-2">Tu tope es {{ cap }} % por descuento.</p>

    <!-- Vista previa -->
    <div class="rounded-xl bg-surface px-3 py-2 mb-3 text-sm flex items-center justify-between" data-testid="discount-preview">
      <span class="text-text-muted">Sobre {{ money(base) }} · descuento <span class="font-bold text-coral tabular-nums">−{{ money(previewAmount) }}</span></span>
      <span class="font-black text-navy tabular-nums">Queda {{ money(previewRemaining) }}</span>
    </div>

    <!-- Motivo -->
    <p class="text-[10px] font-bold uppercase tracking-wide text-text-muted mb-2">Motivo</p>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2" data-testid="discount-reasons">
      <button v-for="r in reasons" :key="r" type="button" @click="pick(r)" :disabled="loading"
        :class="['min-h-[48px] px-4 py-2.5 rounded-2xl border-2 text-left text-sm font-bold transition-colors disabled:opacity-50',
          selected === r ? 'border-navy bg-navy/10 text-navy' : 'border-border text-navy hover:border-navy hover:bg-surface']"
        :aria-pressed="selected === r">{{ r }}</button>
    </div>
    <div v-if="selectedIsOther" class="mt-3">
      <label class="block text-[10px] font-bold uppercase tracking-wide text-text-muted mb-1" for="discount-other-reason">¿Cuál?</label>
      <textarea id="discount-other-reason" data-testid="discount-other" v-model="otherText" rows="2" maxlength="500" :disabled="loading"
        class="w-full rounded-xl border-2 border-border px-3 py-2 text-sm text-navy focus:border-navy focus:outline-none disabled:opacity-50"
        placeholder="Escribí el motivo"></textarea>
    </div>
    <p class="mt-3 text-xs text-text-muted">Queda registrado con tu usuario, la hora, el monto y el motivo.</p>

    <template #footer>
      <button v-if="current" type="button" data-testid="discount-remove" @click="emit('remove')" :disabled="loading"
        class="py-2.5 px-4 rounded-xl border-2 border-coral/40 text-sm font-bold text-coral hover:bg-coral/10 disabled:opacity-50">Quitar descuento</button>
      <button type="button" @click="emit('close')" :disabled="loading"
        class="flex-1 py-2.5 rounded-xl border-2 border-navy/30 text-sm font-bold text-text-secondary hover:bg-surface disabled:opacity-50">Volver</button>
      <button type="button" @click="confirm" :disabled="!canConfirm" data-testid="discount-confirm"
        class="flex-1 py-2.5 rounded-xl bg-navy border-2 border-navy text-sm font-bold text-white hover:bg-navy-light disabled:opacity-50">
        {{ loading ? 'Aplicando…' : (isCourtesy ? 'Aplicar cortesía' : 'Aplicar descuento') }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped></style>
