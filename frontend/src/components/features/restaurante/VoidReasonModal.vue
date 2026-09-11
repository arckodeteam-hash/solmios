<script setup lang="ts">
// components/features/restaurante/VoidReasonModal.vue — #207: modal de MOTIVO para anular un plato o
// cancelar una comanda. Botones grandes (tablet de cocina): un toque elige el motivo; "Otro" pide el
// texto. Cerrar sin confirmar no cambia nada: el que llama solo actúa en `confirm`.
import { ref, computed, watch } from 'vue'
import AppModal from '@/components/ui/AppModal.vue'

const props = withDefaults(defineProps<{
  title: string
  subtitle?: string
  /** Motivos predefinidos del hotel (GET /restaurant/void-reasons). Uno llamado "Otro" abre el texto libre. */
  reasons: string[]
  confirmLabel?: string
  loading?: boolean
}>(), { confirmLabel: 'Anular', loading: false })

const emit = defineEmits<{ confirm: [reason: string]; close: [] }>()

const OTHER = 'otro'
const isOther = (r: string): boolean => r.trim().toLocaleLowerCase() === OTHER

const selected = ref<string | null>(null)
const otherText = ref('')
const selectedIsOther = computed(() => selected.value !== null && isOther(selected.value))

/** Motivo final que viaja al backend: el botón elegido, o el texto libre si eligió "Otro". */
const reason = computed<string>(() => {
  if (selected.value === null) return ''
  return selectedIsOther.value ? otherText.value.trim() : selected.value
})
const canConfirm = computed(() => reason.value.length > 0 && !props.loading)

watch(() => props.reasons, () => { selected.value = null; otherText.value = '' })

function pick(r: string) {
  if (props.loading) return
  selected.value = r
}
function confirm() {
  if (!canConfirm.value) return
  emit('confirm', reason.value)
}
</script>

<template>
  <AppModal size="md" :title="title" :subtitle="subtitle" :closable="!loading" :close-on-backdrop="!loading" @close="emit('close')">
    <p class="text-[10px] font-bold uppercase tracking-wide text-text-muted mb-2">Motivo</p>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2" data-testid="void-reasons">
      <button v-for="r in reasons" :key="r" type="button" @click="pick(r)" :disabled="loading"
        :class="['min-h-[56px] px-4 py-3 rounded-2xl border-2 text-left text-base font-bold transition-colors disabled:opacity-50',
          selected === r ? 'border-coral bg-coral/10 text-coral' : 'border-border text-navy hover:border-navy hover:bg-surface']"
        :aria-pressed="selected === r">{{ r }}</button>
    </div>
    <div v-if="selectedIsOther" class="mt-3">
      <label class="block text-[10px] font-bold uppercase tracking-wide text-text-muted mb-1" for="void-other-reason">¿Cuál?</label>
      <textarea id="void-other-reason" v-model="otherText" rows="2" maxlength="500" :disabled="loading" autofocus
        class="w-full rounded-xl border-2 border-border px-3 py-2 text-sm text-navy focus:border-navy focus:outline-none disabled:opacity-50"
        placeholder="Escribí el motivo"></textarea>
    </div>
    <p class="mt-3 text-xs text-text-muted">Queda registrado con tu usuario, la hora y el motivo.</p>
    <template #footer>
      <button type="button" @click="emit('close')" :disabled="loading"
        class="flex-1 py-2.5 rounded-xl border-2 border-navy/30 text-sm font-bold text-text-secondary hover:bg-surface disabled:opacity-50">Volver</button>
      <button type="button" @click="confirm" :disabled="!canConfirm" data-testid="void-confirm"
        class="flex-1 py-2.5 rounded-xl bg-coral border-2 border-coral text-sm font-bold text-white hover:bg-coral/80 disabled:opacity-50">
        {{ loading ? 'Procesando…' : confirmLabel }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped></style>
