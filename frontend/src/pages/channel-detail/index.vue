<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useToast } from '@/composables/useToast'
import { ChannelService } from '@/services/Channel.service'
import { resolveChannelLogo } from '@/utils/channelLogos'
import ChannelRatesEditor from '@/components/features/ChannelRatesEditor.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const channelId = computed(() => route.params.id as string)
const detail = ref<any>(null)
const loading = ref(true)

// El canal actual, en el formato que espera el editor de tarifas ({ code, name }).
const channelForRates = computed(() =>
  detail.value?.channel ? [{ code: String(detail.value.channel), name: detail.value.title || detail.value.channel }] : [],
)

onMounted(async () => {
  try {
    detail.value = await ChannelService.detail(channelId.value)
    loadMapping()
    await checkReadiness()
  } catch { toast.error('No se pudo cargar el detalle del canal') }
  finally { loading.value = false }
})

// ── Mapeo de rate plans ─────────────────────────────────────────────────────────────────────
// Channex no intercambia NADA con un canal sin rate plans mapeados, y tampoco lo deja activar.
// El mapeo dice, para cada tarifa nuestra, contra qué habitación y qué tarifa DEL CANAL va.
//
// El guardado REEMPLAZA el mapeo completo (así lo define Channex): se manda siempre la lista
// entera, y una fila sin códigos se omite — es la forma de desmapear una tarifa.
const mapping = ref<Record<string, { roomTypeCode: string; ratePlanCode: string }>>({})

/**
 * Los rate plans PROPIOS del hotel. Channex crea copias derivadas al mapear un canal
 * ("double BAR - OpenChannel …", con `parent_rate_plan_id`): son artefactos suyos, mapearlas no
 * tiene sentido y hacían que el contador dijera "5 de 10" con las 8 reales ya mapeadas.
 */
const ownRatePlans = computed<any[]>(() =>
  (detail.value?.allRatePlans ?? []).filter((rp: any) => !rp.parentRatePlanId))
const savingMapping = ref(false)
const readiness = ref<{ ready: boolean; issues: string[] } | null>(null)
const activating = ref(false)

/** Precarga el formulario con lo que ya está mapeado en Channex. */
function loadMapping() {
  const next: Record<string, { roomTypeCode: string; ratePlanCode: string }> = {}
  for (const rp of ownRatePlans.value) {
    const existing = (detail.value?.ratePlans ?? []).find((m: any) => m.rate_plan_id === rp.id)
    next[rp.id] = {
      roomTypeCode: String(existing?.settings?.room_type_code ?? ''),
      ratePlanCode: String(existing?.settings?.rate_plan_code ?? ''),
    }
  }
  mapping.value = next
}

const mappedCount = computed(() =>
  Object.values(mapping.value).filter((m) => m.roomTypeCode.trim() && m.ratePlanCode.trim()).length)

async function saveMapping() {
  if (savingMapping.value) return
  savingMapping.value = true
  try {
    const ratePlans = ownRatePlans.value
      .map((rp: any) => ({ rp, m: mapping.value[rp.id] }))
      .filter((row: { rp: any; m?: { roomTypeCode: string; ratePlanCode: string } }) =>
        !!row.m?.roomTypeCode.trim() && !!row.m?.ratePlanCode.trim())
      .map(({ rp, m }: { rp: any; m?: { roomTypeCode: string; ratePlanCode: string } }) => ({
        ratePlanId: rp.id,
        roomTypeCode: m!.roomTypeCode.trim(),
        ratePlanCode: m!.ratePlanCode.trim(),
        occupancy: rp.occupancy,
        pricingType: rp.sellMode || 'per_person',
        primaryOcc: true,
      }))
    const res = await ChannelService.updateMapping(channelId.value, ratePlans)
    if (!res.success) { toast.error('Channex rechazó el mapeo', res.message); return }
    toast.success(res.message)
    detail.value = await ChannelService.detail(channelId.value)
    loadMapping()
    await checkReadiness()
  } catch {
    toast.error('No se pudo guardar el mapeo')
  } finally {
    savingMapping.value = false
  }
}

/** Qué falta para poder activar. Lo reporta Channex, no lo adivinamos nosotros. */
async function checkReadiness() {
  try { readiness.value = await ChannelService.readiness(channelId.value) } catch { readiness.value = null }
}

async function activate() {
  if (activating.value) return
  activating.value = true
  try {
    const res = await ChannelService.activate(channelId.value)
    if (!res.success) {
      readiness.value = { ready: false, issues: res.issues }
      toast.error(res.message, res.issues.join(' · ') || undefined)
      return
    }
    toast.success('Canal activado')
    detail.value = await ChannelService.detail(channelId.value)
  } catch {
    toast.error('No se pudo activar el canal')
  } finally {
    activating.value = false
  }
}

const statusColor = computed(() => detail.value?.isActive ? 'bg-teal' : 'bg-orange')
const statusText = computed(() => detail.value?.isActive ? 'Activo' : 'Inactivo')
const logo = computed(() => resolveChannelLogo(detail.value?.channel, detail.value?.title))
</script>

<template>
  <div v-if="loading" class="text-center py-8 text-text-muted">Cargando...</div>
  <div v-else-if="!detail" class="text-center py-8 text-text-muted">Canal no encontrado</div>
  <div v-else class="space-y-6">
    <!-- Header -->
    <div class="bg-white rounded-2xl border p-6">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-4">
          <div class="w-14 h-14 rounded-2xl flex items-center justify-center" :class="logo.bgColor">
            <span v-if="logo.matched" class="w-7 h-7" :class="logo.iconColor" v-html="logo.icon"></span>
            <span v-else class="text-xl font-black" :class="logo.iconColor">{{ logo.initial }}</span>
          </div>
          <div>
            <div class="flex items-center gap-3">
              <h1 class="text-xl font-black text-navy">{{ detail.title }}</h1>
              <span :class="['text-[10px] font-bold px-2 py-0.5 rounded-full', statusColor + '/10', 'text-' + (detail.isActive ? 'teal' : 'orange')]">{{ statusText }}</span>
            </div>
            <p class="text-xs text-text-muted">{{ detail.channel }} · ID: {{ detail.id }}</p>
          </div>
        </div>
        <button @click="router.push('/panel/channel-manager')" class="px-4 py-2 bg-surface text-sm font-bold rounded-xl cursor-pointer hover:bg-navy hover:text-white transition-colors">← Volver</button>
      </div>
    </div>

    <!-- Tarifas por temporada de este canal (estilo MisterPlan) -->
    <ChannelRatesEditor v-if="channelForRates.length" :channels="channelForRates" />

    <!-- Mapeo con el canal: sin esto Channex no intercambia nada ni deja activar -->
    <SectionCard title="Mapeo con el canal"
      :subtitle="`${mappedCount} de ${ownRatePlans.length} tarifas mapeadas`">
      <template #actions>
        <button type="button" :disabled="savingMapping"
          class="rounded-full bg-cyan px-4 py-2 text-xs font-bold text-navy disabled:opacity-50"
          @click="saveMapping()">{{ savingMapping ? 'Guardando…' : 'Guardar mapeo' }}</button>
        <button v-if="!detail.isActive" type="button" :disabled="activating || mappedCount === 0"
          class="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-bold text-white hover:bg-white/20 disabled:opacity-50"
          @click="activate()">{{ activating ? 'Activando…' : 'Activar canal' }}</button>
      </template>

      <p class="mb-4 text-xs text-text-secondary">
        Cada tarifa tuya va contra una habitación y una tarifa <strong>del canal</strong>. Los códigos
        los define el canal — en el asistente de Channex aparecen al lado de cada habitación.
        Una fila sin códigos queda sin mapear.
      </p>

      <div v-if="readiness && !readiness.ready && readiness.issues.length"
        class="mb-4 rounded-xl border border-orange/30 bg-orange/10 px-3 py-2.5">
        <p class="text-[10px] font-bold uppercase tracking-wide text-orange">Falta para poder activar</p>
        <ul class="mt-1 space-y-0.5">
          <li v-for="(issue, i) in readiness.issues" :key="i" class="text-xs text-text-secondary">· {{ issue }}</li>
        </ul>
      </div>
      <p v-else-if="readiness?.ready && !detail.isActive" class="mb-4 text-xs font-bold text-teal">
        El canal está listo para activarse.
      </p>

      <EmptyState v-if="!ownRatePlans.length"
        title="Este hotel todavía no tiene tarifas en el channel manager"
        message="Sincronizá el hotel desde Channel para que se creen sus habitaciones y tarifas. Después volvé acá a mapearlas." />

      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[720px] tbl-head">
          <thead>
            <tr>
              <th class="px-4 py-2.5 text-left">Tu tarifa</th>
              <th class="px-4 py-2.5 text-left">Código de habitación del canal</th>
              <th class="px-4 py-2.5 text-left">Código de tarifa del canal</th>
              <th class="px-4 py-2.5 text-center">Estado</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="rp in ownRatePlans" :key="rp.id" class="border-t border-border">
              <td class="px-4 py-2.5">
                <div class="text-xs font-bold text-navy">{{ rp.title }}</div>
                <div class="text-[10px] text-text-muted capitalize">{{ rp.roomTypeTitle }} · {{ rp.occupancy }}p</div>
              </td>
              <td class="px-4 py-2">
                <input v-model="mapping[rp.id].roomTypeCode" type="text" placeholder="—"
                  :aria-label="`Código de habitación del canal para ${rp.title}`"
                  class="w-full rounded-lg border border-border px-2 py-1.5 text-xs focus:outline-none focus:border-navy" />
              </td>
              <td class="px-4 py-2">
                <input v-model="mapping[rp.id].ratePlanCode" type="text" placeholder="—"
                  :aria-label="`Código de tarifa del canal para ${rp.title}`"
                  class="w-full rounded-lg border border-border px-2 py-1.5 text-xs focus:outline-none focus:border-navy" />
              </td>
              <td class="px-4 py-2.5 text-center">
                <span v-if="mapping[rp.id].roomTypeCode.trim() && mapping[rp.id].ratePlanCode.trim()"
                  class="rounded-full bg-teal/10 px-2 py-0.5 text-[10px] font-bold text-teal">Mapeada</span>
                <span v-else class="rounded-full bg-surface px-2 py-0.5 text-[10px] font-bold text-text-muted">Sin mapear</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>
  </div>
</template>
