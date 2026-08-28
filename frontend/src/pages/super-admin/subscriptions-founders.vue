<template>
  <div>
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-black text-navy">Cupos Fundador / Pionero</h1>
        <p class="text-sm text-text-muted">Cupos, % de descuento y secuencia de apertura — 100% configurable, sin deploy</p>
      </div>
      <router-link to="/admin/subscriptions" class="text-xs font-bold text-navy hover:underline">← Volver a Suscripciones</router-link>
    </div>

    <SkeletonLoader v-if="loading" variant="card" :rows="3" class="mb-8" />
    <div v-else class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
      <div v-for="c in categories" :key="c.key" class="bg-white rounded-2xl border border-border card-shadow p-6">
        <div class="flex items-start justify-between mb-2">
          <h3 class="text-lg font-black text-navy">{{ categoryLabel(c.key) }}</h3>
          <span class="text-[10px] font-bold px-2 py-0.5 rounded-full" :class="statusClass(c.status)">{{ STATUS_LABELS[c.status] }}</span>
        </div>
        <div class="text-3xl font-black text-teal mb-1">{{ c.occupiedCount }}<span class="text-lg text-text-muted">/{{ c.totalSlots }}</span></div>
        <div class="text-[11px] text-text-muted mb-4">cupos ocupados</div>
        <div class="w-full h-2 bg-surface rounded-full overflow-hidden mb-4">
          <div class="h-full bg-teal" :style="{ width: `${Math.min(100, (c.occupiedCount / Math.max(1, c.totalSlots)) * 100)}%` }"></div>
        </div>
        <div class="space-y-2 text-xs text-text-secondary mb-4">
          <div class="flex justify-between"><span>Descuento</span><strong class="text-navy">{{ c.discountPct }}%</strong></div>
          <div class="flex justify-between"><span>Plan mínimo</span><strong class="text-navy">{{ c.minPlanSortOrder != null ? `sortOrder ≥ ${c.minPlanSortOrder}` : 'Cualquiera' }}</strong></div>
          <div v-if="c.opensAfter" class="flex justify-between"><span>Abre después de</span><strong class="text-navy">{{ categoryLabel(c.opensAfter) }}</strong></div>
        </div>
        <div class="flex gap-2">
          <button v-if="c.status !== 'open'" type="button" :disabled="saving === c.key" @click="setStatus(c, 'open')"
            class="flex-1 px-3 py-2 bg-teal text-white rounded-lg text-xs font-bold hover:shadow-lg transition-all cursor-pointer disabled:opacity-50">Abrir</button>
          <button v-if="c.status !== 'closed'" type="button" :disabled="saving === c.key" @click="setStatus(c, 'closed')"
            class="flex-1 px-3 py-2 bg-surface border border-border text-navy rounded-lg text-xs font-bold hover:bg-surface-dark transition-colors cursor-pointer disabled:opacity-50">Cerrar</button>
        </div>
      </div>
    </div>

    <SectionCard title="Reglas del ciclo de cobro" subtitle="Recordatorio, gracia y tope de descuento manual — Grupo B/C de PLAN-SUSCRIPCIONES.md">
      <SkeletonLoader v-if="loading" variant="card" :rows="1" />
      <form v-else @submit.prevent="saveSettings" class="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <label class="block text-[10px] font-bold text-text-muted uppercase mb-1">Recordatorio (días antes)</label>
          <input v-model.number="settingsForm.reminderDaysBefore" type="number" min="0" max="60" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm" />
        </div>
        <div>
          <label class="block text-[10px] font-bold text-text-muted uppercase mb-1">Días de gracia</label>
          <input v-model.number="settingsForm.gracePeriodDays" type="number" min="0" max="60" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm" />
        </div>
        <div>
          <label class="block text-[10px] font-bold text-text-muted uppercase mb-1">Tope descuento manual %</label>
          <input v-model.number="settingsForm.maxManualDiscountPct" type="number" min="0" max="100" class="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm" />
        </div>
        <div class="flex items-end">
          <label class="flex items-center gap-2 text-sm font-bold text-text-secondary cursor-pointer">
            <input v-model="settingsForm.founderChurnBlocksReturn" type="checkbox" class="accent-cyan" />
            Un Fundador que se va no puede volver
          </label>
        </div>
        <!-- #28: define qué promete el registro. El copy de la landing y del alta se deriva de
             este switch, así que prenderlo/apagarlo cambia las dos pantallas sin tocar código. -->
        <div class="md:col-span-4 rounded-xl border border-border bg-surface p-4">
          <label class="flex items-start gap-3 cursor-pointer">
            <input v-model="settingsForm.requireCardOnTrial" type="checkbox" class="accent-cyan mt-0.5" />
            <span>
              <span class="block text-sm font-bold text-text-secondary">Pedir tarjeta para empezar la prueba</span>
              <span class="block text-xs text-text-muted mt-1">
                <template v-if="settingsForm.requireCardOnTrial">
                  El alta manda al checkout de Stripe: la tarjeta queda guardada sin cobrar, y al vencer
                  la prueba se cobra el plan automáticamente. Quien no la cargue no entra al panel.
                </template>
                <template v-else>
                  La prueba arranca sin tarjeta. Al vencer se corta el acceso y el hotel tiene que
                  contratar un plan a mano — no hay cobro automático.
                </template>
              </span>
            </span>
          </label>
        </div>
        <div class="md:col-span-4">
          <button type="submit" :disabled="savingSettings" class="px-5 py-2.5 bg-navy text-white rounded-xl text-sm font-bold cursor-pointer disabled:opacity-50">
            {{ savingSettings ? 'Guardando...' : 'Guardar reglas' }}
          </button>
        </div>
      </form>
    </SectionCard>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import SkeletonLoader from '@/components/ui/SkeletonLoader.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import { useToast } from '@/composables/useToast'
import {
  SubscriptionsAdminService, type SpecialCategoryConfig, type SubscriptionSettings,
} from '@/services/SubscriptionsAdmin.service'

const toast = useToast()
const loading = ref(true)
const saving = ref<string | null>(null)
const savingSettings = ref(false)
const categories = ref<SpecialCategoryConfig[]>([])
const settingsForm = ref<SubscriptionSettings>({
  reminderDaysBefore: 5, gracePeriodDays: 5, founderChurnBlocksReturn: true, maxManualDiscountPct: 100,
  requireCardOnTrial: true,
})

const CATEGORY_LABELS: Record<string, string> = { founder_one: 'Fundador Uno', founder_two: 'Fundador Dos', pioneer: 'Pionero' }
const STATUS_LABELS: Record<string, string> = { closed: 'Cerrada', open: 'Abierta', full: 'Llena' }
const categoryLabel = (key?: string | null) => (key ? CATEGORY_LABELS[key] ?? key : '')
const statusClass = (s: string) => ({
  open: 'bg-teal/10 text-teal', full: 'bg-warning/10 text-warning', closed: 'bg-surface text-text-muted',
}[s] ?? 'bg-surface text-text-muted')

async function load() {
  loading.value = true
  try {
    const [cats, settings] = await Promise.all([
      SubscriptionsAdminService.listCategories(),
      SubscriptionsAdminService.getSettings(),
    ])
    categories.value = cats.data ?? []
    settingsForm.value = settings
  } catch (e: any) {
    toast.error(e.message || 'No se pudieron cargar los cupos')
  } finally {
    loading.value = false
  }
}

async function setStatus(c: SpecialCategoryConfig, status: 'open' | 'closed') {
  saving.value = c.key
  try {
    await SubscriptionsAdminService.updateCategory(c.key, { status })
    toast.success(`${categoryLabel(c.key)} ${status === 'open' ? 'abierta' : 'cerrada'}`)
    await load()
  } catch (e: any) {
    toast.error(e.message || 'No se pudo actualizar la categoría')
  } finally {
    saving.value = null
  }
}

async function saveSettings() {
  savingSettings.value = true
  try {
    settingsForm.value = await SubscriptionsAdminService.updateSettings(settingsForm.value)
    toast.success('Reglas actualizadas')
  } catch (e: any) {
    toast.error(e.message || 'No se pudieron guardar las reglas')
  } finally {
    savingSettings.value = false
  }
}

onMounted(load)
</script>
