<template>
  <div class="space-y-4">
    <!-- Estado de carga / error -->
    <div v-if="loading" class="text-sm text-text-muted py-4">Cargando políticas…</div>
    <div v-else-if="loadError" class="text-sm text-rose py-4">
      No pudimos cargar las políticas. {{ loadError }}
      <button class="underline font-bold ml-1 cursor-pointer" @click="loadAll">Reintentar</button>
    </div>

    <template v-else>
      <!-- Presets: aplicación rápida de una plantilla conocida -->
      <div>
        <label class="text-xs font-bold text-text-muted uppercase mb-1.5 block">Plantillas rápidas</label>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button
            v-for="opt in PRESET_OPTIONS"
            :key="opt.key"
            type="button"
            class="p-2.5 rounded-xl border-2 text-left transition-all cursor-pointer"
            :class="selectedPreset === opt.key ? 'border-cyan bg-cyan/5' : 'border-border hover:border-gray-300'"
            @click="applyPreset(opt.key)"
          >
            <div class="text-sm font-black text-navy">{{ opt.label }}</div>
            <div class="text-xs text-text-muted mt-0.5 leading-tight">{{ opt.desc }}</div>
          </button>
        </div>
        <p v-if="selectedPreset" class="mt-1.5 text-xs text-text-muted">
          Plantilla aplicada. Podés ajustar los niveles abajo antes de guardar.
        </p>
      </div>

      <!-- Editor de la política BASE -->
      <div class="pt-3 border-t border-border">
        <div class="flex items-center justify-between mb-2">
          <div>
            <div class="text-sm font-black text-navy">Política base</div>
            <div class="text-xs text-text-muted">Se aplica a todos los canales sin excepción propia.</div>
          </div>
          <button type="button" class="text-xs font-bold text-cyan hover:text-navy cursor-pointer" @click="addTier(baseTiers)">
            + Nivel
          </button>
        </div>

        <div v-if="baseTiers.length === 0" class="text-xs text-text-muted italic py-2">
          Sin niveles. Elegí una plantilla o agregá un nivel con “+ Nivel”.
        </div>

        <div v-for="(tier, idx) in baseTiers" :key="idx" class="grid grid-cols-12 gap-2 items-center mb-2">
          <div class="col-span-3">
            <label class="text-[11px] font-bold text-text-muted uppercase block">Horas antes</label>
            <input
              v-model.number="tier.deadlineHours"
              type="number"
              min="0"
              class="w-full h-9 px-2 rounded-lg border border-border text-sm focus:outline-none focus:border-cyan"
            />
          </div>
          <div class="col-span-3">
            <label class="text-[11px] font-bold text-text-muted uppercase block">% Penalidad</label>
            <input
              v-model.number="tier.penaltyPercent"
              type="number"
              min="0"
              max="100"
              class="w-full h-9 px-2 rounded-lg border border-border text-sm focus:outline-none focus:border-cyan"
            />
          </div>
          <div class="col-span-3 flex items-end h-9">
            <label class="flex items-center gap-1.5 text-xs font-bold text-navy cursor-pointer">
              <input v-model="tier.refundable" type="checkbox" class="w-3.5 h-3.5 rounded text-cyan" />
              Reembolsable
            </label>
          </div>
          <div class="col-span-2">
            <label class="text-[11px] font-bold text-text-muted uppercase block">Etiqueta</label>
            <input
              v-model="tier.label"
              type="text"
              maxlength="60"
              placeholder="Ej: Cancelación gratis"
              class="w-full h-9 px-2 rounded-lg border border-border text-sm focus:outline-none focus:border-cyan"
            />
          </div>
          <div class="col-span-1 flex items-end justify-center h-9">
            <button
              type="button"
              class="text-rose/70 hover:text-rose text-sm font-bold cursor-pointer"
              title="Quitar nivel"
              @click="baseTiers.splice(idx, 1)"
            >✕</button>
          </div>
        </div>

        <!-- Texto explicativo de cada tier, en orden humano -->
        <ul v-if="baseTiers.length" class="mt-1 space-y-0.5">
          <li v-for="(t, i) in tierSummary(baseTiers)" :key="i" class="text-xs text-text-muted">• {{ t }}</li>
        </ul>
      </div>

      <!-- OVERRIDES por canal -->
      <div class="pt-3 border-t border-border">
        <div class="flex items-center justify-between mb-2">
          <div>
            <div class="text-sm font-black text-navy">Excepciones por canal</div>
            <div class="text-xs text-text-muted">Anulan la política base para un canal concreto (ej: Booking, Airbnb).</div>
          </div>
          <button
            type="button"
            class="text-xs font-bold text-cyan hover:text-navy cursor-pointer"
            :disabled="!canAddOverride"
            :class="{ 'opacity-40 cursor-not-allowed': !canAddOverride }"
            @click="addOverride"
          >+ Excepción</button>
        </div>

        <div v-if="overrides.length === 0" class="text-xs text-text-muted italic py-1">
          Sin excepciones. La política base aplica a todos los canales.
        </div>

        <div v-for="(ov, idx) in overrides" :key="idx" class="rounded-xl border border-border p-3 mb-3 bg-surface">
          <div class="flex items-center justify-between gap-2 mb-2">
            <div class="flex items-center gap-2 flex-1">
              <select
                v-model="ov.scopeId"
                class="h-8 px-2 rounded-lg border border-border text-sm focus:outline-none focus:border-cyan cursor-pointer"
                :class="{ 'text-text-muted': !ov.scopeId }"
              >
                <option value="" disabled>Elegí un canal…</option>
                <option v-for="ch in channelOptions" :key="ch.value" :value="ch.value">{{ ch.label }}</option>
              </select>
              <span v-if="ov.id" class="text-[11px] font-bold text-teal uppercase">Guardado</span>
            </div>
            <button
              type="button"
              class="text-rose/70 hover:text-rose text-xs font-bold cursor-pointer"
              :disabled="busy"
              @click="removeOverride(idx)"
            >Borrar</button>
          </div>

          <!-- Tiers del override (compacto, mismo patrón que la base) -->
          <div class="flex items-center gap-2 mb-1">
            <span class="text-[11px] font-bold text-text-muted uppercase">Niveles</span>
            <button type="button" class="text-xs font-bold text-cyan hover:text-navy cursor-pointer ml-auto" @click="addTier(ov.tiers)">+ Nivel</button>
          </div>
          <div v-for="(tier, ti) in ov.tiers" :key="ti" class="grid grid-cols-12 gap-2 items-center mb-1.5">
            <div class="col-span-3">
              <input v-model.number="tier.deadlineHours" type="number" min="0" class="w-full h-8 px-2 rounded-lg border border-border text-sm focus:outline-none focus:border-cyan" />
            </div>
            <div class="col-span-3">
              <input v-model.number="tier.penaltyPercent" type="number" min="0" max="100" class="w-full h-8 px-2 rounded-lg border border-border text-sm focus:outline-none focus:border-cyan" />
            </div>
            <div class="col-span-3 flex items-center">
              <label class="flex items-center gap-1 text-xs font-bold text-navy cursor-pointer">
                <input v-model="tier.refundable" type="checkbox" class="w-3 h-3 rounded text-cyan" /> Reembolso
              </label>
            </div>
            <div class="col-span-2">
              <input v-model="tier.label" type="text" maxlength="60" placeholder="Etiqueta" class="w-full h-8 px-2 rounded-lg border border-border text-sm focus:outline-none focus:border-cyan" />
            </div>
            <div class="col-span-1 flex justify-center">
              <button type="button" class="text-rose/70 hover:text-rose text-xs font-bold cursor-pointer" @click="ov.tiers.splice(ti, 1)">✕</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Acciones -->
      <div class="flex items-center justify-between gap-3 pt-3 border-t border-border">
        <p class="text-xs text-text-muted">
          Los cambios acá no afectan el “texto display” opcional de abajo.
        </p>
        <button
          type="button"
          class="px-4 py-2 bg-navy text-white text-xs font-bold rounded-xl cursor-pointer disabled:opacity-50"
          :disabled="!canSave || busy"
          @click="saveAll"
        >{{ busy ? 'Guardando…' : 'Guardar políticas' }}</button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { CancellationPoliciesService } from '@/services/cancellationPolicies.service'
import { ChannelService } from '@/services/Channel.service'
import { useToast } from '@/composables/useToast'
import { PRESET_TIERS, PRESET_OPTIONS, type Tier, type CancellationPolicy } from '@/types/cancellation'

const props = defineProps<{ hotelId?: string }>()
const toast = useToast()

const loading = ref(true)
const loadError = ref('')
const busy = ref(false)

// Política base local (editable). Al cargar se hidrata con la existente o queda vacía.
const baseTiers = reactive<Tier[]>([])
const selectedPreset = ref<string>('')

// Overrides por canal locales. Cada uno puede tener `id` (ya persistido) o no (nuevo).
interface OverrideDraft {
  id?: string
  scopeId: string
  tiers: Tier[]
  name?: string
}
const overrides = reactive<OverrideDraft[]>([])

// Canales conectados del hotel para sugerir en el select de overrides.
const channelOptions = ref<{ value: string; label: string }[]>([])

const canAddOverride = computed(() => baseTiers.length > 0)
const canSave = computed(() => {
  if (baseTiers.length === 0) return false
  if (!tiersValid(baseTiers)) return false
  return overrides.every((o) => o.scopeId && o.tiers.length > 0 && tiersValid(o.tiers))
})

function tiersValid(tiers: Tier[]): boolean {
  return tiers.every((t) =>
    typeof t.deadlineHours === 'number' && t.deadlineHours >= 0 &&
    typeof t.penaltyPercent === 'number' && t.penaltyPercent >= 0 && t.penaltyPercent <= 100,
  )
}

function applyPreset(key: string) {
  selectedPreset.value = key
  const preset = PRESET_TIERS[key]
  if (!preset) return
  baseTiers.splice(0, baseTiers.length, ...preset.map((t) => ({ ...t })))
}

function addTier(arr: Tier[]) {
  arr.push({ deadlineHours: 24, penaltyPercent: 0, refundable: true, label: '' })
}

/** Resumen humano de cada tier para que el merchant entienda qué firma. */
function tierSummary(tiers: Tier[]): string[] {
  const sorted = [...tiers].sort((a, b) => b.deadlineHours - a.deadlineHours)
  return sorted.map((t) => {
    const h = t.deadlineHours
    const when = h >= 99_999 ? 'hasta el check-in' : h >= 168 ? `+${Math.round(h / 24)} días antes` : h >= 24 ? `+${Math.round(h / 24)} día(s) antes` : h > 0 ? `+${h} h antes` : 'pasado el check-in / siempre'
    const money = t.refundable ? (t.penaltyPercent === 0 ? '100% reembolso' : `retiene ${t.penaltyPercent}%`) : 'no reembolsable'
    return `${when}: ${money}`
  })
}

function addOverride() {
  // Precarga con la plantilla flexible para que tenga al menos un tier editable.
  overrides.push({ scopeId: '', tiers: PRESET_TIERS.flexible.map((t) => ({ ...t })) })
}

async function removeOverride(idx: number) {
  const ov = overrides[idx]
  if (!ov) return
  // Si ya estaba persistido, borrar en el backend; si no, solo descartar local.
  if (ov.id) {
    busy.value = true
    try {
      await CancellationPoliciesService.remove(ov.id)
      overrides.splice(idx, 1)
      toast.success('Excepción eliminada')
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo borrar la excepción')
    } finally {
      busy.value = false
    }
  } else {
    overrides.splice(idx, 1)
  }
}

async function loadAll() {
  loading.value = true
  loadError.value = ''
  try {
    const [policies, channels] = await Promise.all([
      CancellationPoliciesService.list(),
      props.hotelId ? ChannelService.status(props.hotelId).catch(() => null) : Promise.resolve(null),
    ])

    // Hidratar base + overrides desde la respuesta.
    const base = policies.find((p) => p.scope === 'base')
    if (base && Array.isArray(base.tiers) && base.tiers.length) {
      baseTiers.splice(0, baseTiers.length, ...base.tiers.map((t) => ({ ...t })))
    }
    overrides.splice(0, overrides.length, ...policies
      .filter((p) => p.scope === 'channel')
      .map((p) => ({ id: p.id, scopeId: p.scopeId, tiers: (p.tiers || []).map((t) => ({ ...t })), name: p.name })))

    // Sugerencias de canal: los conectados. El `channel` que resolvePolicy matchea es
    // un string libre → usamos el otaCode/type como valor y name como etiqueta.
    if (channels?.data) {
      channelOptions.value = channels.data
        .filter((c) => c.conectado || c.activo)
        .map((c) => ({ value: c.otaCode || c.type || c.name, label: c.name }))
        // Dedup por value.
        .filter((v, i, arr) => arr.findIndex((x) => x.value === v.value) === i)
    }
  } catch (e: any) {
    loadError.value = e?.message || 'Error desconocido'
  } finally {
    loading.value = false
  }
}

async function saveAll() {
  if (!canSave.value) return
  busy.value = true
  try {
    // 1. Base (siempre).
    await CancellationPoliciesService.upsertBase(baseTiers.map((t) => ({ ...t })))

    // 2. Overrides: upsert uno por uno. Si alguno falla (ej: falta base recién creada),
    // el mensaje del backend se muestra y se aborta el resto.
    for (const ov of overrides) {
      if (!ov.scopeId || ov.tiers.length === 0) continue
      await CancellationPoliciesService.upsertOverride({
        scope: 'channel',
        scopeId: ov.scopeId,
        tiers: ov.tiers.map((t) => ({ ...t })),
        name: ov.name,
      })
    }

    toast.success('Políticas de cancelación guardadas')
    await loadAll() // reflejar ids/state persistido
  } catch (e: any) {
    toast.error(e?.message || 'Error al guardar las políticas')
  } finally {
    busy.value = false
  }
}

onMounted(loadAll)
</script>

<style scoped>
/* Sin estilos extra: todo viaja por clases utilitarias de Tailwind + design tokens. */
</style>
