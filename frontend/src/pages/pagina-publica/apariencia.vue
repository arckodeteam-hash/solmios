<template>
  <!--
    Apariencia — editor visual del theme de la landing pública (solmi-direct-booking / Pieza C).
    El merchant elige una de 3 plantillas (classic/modern/boutique) y customiza los 10 tokens
    de color con pickers hex. El cambio viaja a la landing pública vía PUT /api/landing/theme
    → el backend invalida la caché `landing:public:${hotelId}` y el próximo render aplica el
    theme vía CSS vars (hotel-landing.vue).

    Una sola responsabilidad: APARIENCIA. El contenido de los bloques se edita en
    `landing.vue` (hermana de ruta); acá no se tocan bloques.

    Flujo:
      1. GET theme → popula templateId + colors (overrides custom) + fonts (passthrough).
      2. Seleccionar plantilla → settea templateId y LIMPIA colors (arrancás desde el preset
         puro del nuevo template, sin arrastrar overrides del anterior).
      3. Editar un picker → lo mueve a `colors` (override puntual sobre el preset).
      4. "Restaurar paleta" → limpia colors (vuelve al preset puro del template actual).
      5. Guardar → PUT /api/landing/theme {templateId, colors, fonts} → toast + reload.
  -->
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div class="min-w-0">
        <h2 class="text-xl font-black text-navy">Apariencia</h2>
        <p class="text-sm text-text-muted mt-0.5">
          Elegí la plantilla de tu landing pública y personalizá la paleta de colores.
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span v-if="isDirty" class="text-[11px] font-bold text-warning">Cambios sin guardar</span>
        <button
          @click="save"
          :disabled="saving || !isDirty"
          class="rounded-full bg-cyan px-5 py-2 text-sm font-extrabold text-navy transition-all hover:shadow-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {{ saving ? 'Guardando…' : 'Guardar' }}
        </button>
      </div>
    </div>

    <!-- Loading skeleton -->
    <div v-if="loading" class="space-y-6">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div v-for="i in 3" :key="i" class="rounded-2xl border border-border bg-white shadow-(--shadow-card) overflow-hidden">
          <div class="h-24 bg-surface animate-pulse" />
          <div class="p-4 space-y-2">
            <div class="h-4 bg-surface rounded animate-pulse" />
            <div class="h-3 bg-surface rounded animate-pulse w-2/3" />
          </div>
        </div>
      </div>
      <div class="rounded-2xl border border-border bg-white shadow-(--shadow-card) overflow-hidden">
        <div class="h-14 bg-navy animate-pulse" />
        <div class="p-5 grid grid-cols-2 sm:grid-cols-5 gap-4">
          <div v-for="i in 10" :key="i" class="h-16 bg-surface rounded-xl animate-pulse" />
        </div>
      </div>
    </div>

    <!-- Error -->
    <EmptyState
      v-else-if="loadError"
      title="No pudimos cargar la apariencia"
      :message="loadError"
    >
      <template #action>
        <button
          type="button"
          @click="load"
          class="rounded-full bg-navy px-5 py-2 text-sm font-bold text-white hover:shadow-lg cursor-pointer"
        >
          Reintentar
        </button>
      </template>
    </EmptyState>

    <template v-else>
      <!-- ─── Selector de plantilla ───────────────────────────────────────── -->
      <SectionCard
        title="Plantilla"
        subtitle="Cada plantilla cambia la paleta base y la estructura del hero y la galería"
      >
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button
            v-for="tpl in TEMPLATES"
            :key="tpl.id"
            type="button"
            @click="selectTemplate(tpl.id)"
            :aria-pressed="templateId === tpl.id"
            class="group text-left rounded-2xl border-2 bg-white overflow-hidden transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-cyan"
            :class="templateId === tpl.id
              ? 'border-cyan shadow-(--shadow-card) ring-2 ring-cyan/20'
              : 'border-border hover:border-navy/30'"
          >
            <!-- Mini-preview del hero (silueta del layout) -->
            <div class="h-28 relative overflow-hidden" :style="previewBackdropStyle(tpl.id)">
              <!-- Silueta:estructura por template -->
              <div class="absolute inset-0 p-3">
                <!-- classic: full-bleed overlay con texto a la izq -->
                <div v-if="tpl.id === 'classic'" class="h-full flex items-end">
                  <div class="space-y-1.5">
                    <div class="h-2 w-20 rounded-full bg-white/90" />
                    <div class="h-1.5 w-14 rounded-full bg-white/60" />
                    <div class="h-3 w-12 mt-1 rounded-full" :style="{ background: tpl.swatch.gold }" />
                  </div>
                </div>
                <!-- modern: split 2-col (texto izq + imagen der) -->
                <div v-else-if="tpl.id === 'modern'" class="h-full grid grid-cols-2 gap-2">
                  <div class="flex flex-col justify-center space-y-1.5">
                    <div class="h-2 w-12 rounded-full" :style="{ background: tpl.swatch.navy, opacity: 0.85 }" />
                    <div class="h-1.5 w-10 rounded-full" :style="{ background: tpl.swatch.navy, opacity: 0.45 }" />
                    <div class="h-2.5 w-10 mt-1 rounded-full" :style="{ background: tpl.swatch.cyan }" />
                  </div>
                  <div class="rounded-md" :style="{ background: tpl.swatch.cyanLight, opacity: 0.55 }" />
                </div>
                <!-- boutique: centrado minimalista -->
                <div v-else class="h-full flex flex-col items-center justify-center space-y-1.5">
                  <div class="h-2 w-16 rounded-full" :style="{ background: tpl.swatch.navy, opacity: 0.85 }" />
                  <div class="h-1.5 w-12 rounded-full" :style="{ background: tpl.swatch.navy, opacity: 0.4 }" />
                  <div class="h-3 w-14 mt-1 rounded-full" :style="{ background: tpl.swatch.gold }" />
                </div>
              </div>
              <!-- Badge "Seleccionada" -->
              <div
                v-if="templateId === tpl.id"
                class="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-cyan px-2 py-0.5 text-[10px] font-extrabold text-navy shadow"
              >
                <span class="w-2.5 h-2.5" v-html="ICON_CHECK"></span>
                Seleccionada
              </div>
            </div>

            <!-- Info + swatches -->
            <div class="p-3.5">
              <div class="flex items-center justify-between gap-2">
                <h3 class="text-sm font-black text-navy">{{ tpl.label }}</h3>
                <div class="flex items-center gap-1">
                  <span
                    v-for="token in tpl.swatchOrder"
                    :key="token"
                    class="h-3.5 w-3.5 rounded-full ring-1 ring-black/5"
                    :style="{ background: presetHex(tpl.id, token) }"
                    :title="`${token}: ${presetHex(tpl.id, token)}`"
                  />
                </div>
              </div>
              <p class="mt-1 text-[11px] text-text-muted leading-snug">{{ tpl.description }}</p>
            </div>
          </button>
        </div>

        <p class="mt-4 rounded-xl bg-surface p-3 text-[11px] text-text-muted leading-relaxed">
          Cambiar de plantilla reinicia los colores al preset de esa plantilla. Después podés
          personalizar cada color por separado con los pickers de abajo.
        </p>
      </SectionCard>

      <!-- ─── Color pickers ──────────────────────────────────────────────── -->
      <SectionCard
        title="Paleta de colores"
        :subtitle="`Personalizá los 10 tokens de la plantilla «${templateLabel}»`"
      >
        <template #actions>
          <button
            type="button"
            @click="resetColors"
            :disabled="saving || !hasOverrides"
            class="rounded-full bg-white/10 border border-white/15 px-3.5 py-1.5 text-xs font-bold text-white transition-colors hover:bg-white/20 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Restaurar paleta de la plantilla
          </button>
        </template>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <label
            v-for="token in TOKEN_DEFS"
            :key="token.key"
            class="rounded-xl border bg-white p-3 transition-colors cursor-pointer hover:border-navy/30"
            :class="isOverride(token.key) ? 'border-cyan/60' : 'border-border'"
          >
            <div class="flex items-center gap-3">
              <!-- Color picker nativo (hex #rrggbb) -->
              <input
                type="color"
                :value="effectiveColor(token.key)"
                @input="setColor(token.key, ($event.target as HTMLInputElement).value)"
                :disabled="saving"
                class="h-10 w-10 shrink-0 cursor-pointer rounded-lg border border-border bg-white p-0.5 disabled:cursor-not-allowed"
                :aria-label="`Color ${token.label}`"
              />
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                  <span class="text-xs font-black text-navy truncate">{{ token.label }}</span>
                  <span
                    v-if="isOverride(token.key)"
                    title="Color personalizado (override del preset)"
                    class="rounded-full bg-cyan/15 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-cyan"
                  >
                    Custom
                  </span>
                </div>
                <input
                  type="text"
                  :value="effectiveColor(token.key).toUpperCase()"
                  @input="onHexInput(token.key, ($event.target as HTMLInputElement).value)"
                  :disabled="saving"
                  spellcheck="false"
                  maxlength="7"
                  class="mt-0.5 w-full bg-transparent border-0 px-0 py-0 text-[11px] font-mono tabular-nums text-text-muted focus:outline-none focus:text-navy"
                />
              </div>
            </div>
          </label>
        </div>

        <div class="mt-4 rounded-xl bg-surface p-3 text-[11px] text-text-muted leading-relaxed">
          Los colores se aplican como variables CSS sobre la landing completa. El preset viene
          fijo por plantilla; al editar un token se convierte en <strong>override</strong> (badge
          «Custom»). <strong>Restaurar paleta</strong> borra los overrides y vuelve al preset puro.
        </div>
      </SectionCard>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useToast } from '@/composables/useToast'
import { LandingThemeService } from '@/services/LandingTheme.service'
import { ICON_CHECK } from '@/components/landing/landing-icons'
import {
  PRESET_MAP,
  type LandingTemplateId,
  type LandingTheme,
  type ThemeTokens,
} from '@/types/landing'

const toast = useToast()

// ─── Catálogo de tokens: nombre legible + key técnica ─────────────────────────────────
// Orden = como aparecen en los pickers. Los labels combinan nombre humano + token técnico
// para que el merchant sepa qué está tocando (ej: "Acento (cyan)").
type TokenKey = keyof ThemeTokens
interface TokenDef { key: TokenKey; label: string }
const TOKEN_DEFS: TokenDef[] = [
  { key: 'navy',         label: 'Primario (navy)' },
  { key: 'navyLight',    label: 'Primario claro' },
  { key: 'blue',         label: 'Azul' },
  { key: 'cyan',         label: 'Acento (cyan)' },
  { key: 'cyanLight',    label: 'Acento claro' },
  { key: 'teal',         label: 'Verde (teal)' },
  { key: 'gold',         label: 'Dorado' },
  { key: 'goldLight',    label: 'Dorado claro' },
  { key: 'surface',      label: 'Fondo claro' },
  { key: 'surfaceDark',  label: 'Fondo suave' },
]

// ─── Catálogo de plantillas (metadata + paleta representativa para el preview) ────────
// `swatch` es solo para el mini-preview del selector (no todas las 10 — elegimos las que
// definen la identidad visual de cada template). La paleta completa vive en PRESET_MAP.
interface TemplateMeta {
  id: LandingTemplateId
  label: string
  description: string
  /** Tokens que aparecen como swatches bajo el preview (chips de identidad). */
  swatchOrder: TokenKey[]
  /** Atajos de color para el mini-preview del hero (silueta). */
  swatch: { navy: string; cyan: string; cyanLight: string; gold: string }
}
const TEMPLATES: TemplateMeta[] = [
  {
    id: 'classic',
    label: 'Classic',
    description: 'Azul navy + cyan. Hero a sangre con overlay; galería en grilla de 4.',
    swatchOrder: ['navy', 'cyan', 'teal', 'gold', 'surface'],
    swatch: {
      navy: PRESET_MAP.classic.navy,
      cyan: PRESET_MAP.classic.cyan,
      cyanLight: PRESET_MAP.classic.cyanLight,
      gold: PRESET_MAP.classic.gold,
    },
  },
  {
    id: 'modern',
    label: 'Modern',
    description: 'Teal + naranja. Hero dividido (texto + imagen); galería masonry.',
    swatchOrder: ['navy', 'cyan', 'teal', 'gold', 'surface'],
    swatch: {
      navy: PRESET_MAP.modern.navy,
      cyan: PRESET_MAP.modern.cyan,
      cyanLight: PRESET_MAP.modern.cyanLight,
      gold: PRESET_MAP.modern.gold,
    },
  },
  {
    id: 'boutique',
    label: 'Boutique',
    description: 'Bordó + gold, tipografía serif. Hero centrado; galería editorial.',
    swatchOrder: ['navy', 'cyan', 'teal', 'gold', 'surface'],
    swatch: {
      navy: PRESET_MAP.boutique.navy,
      cyan: PRESET_MAP.boutique.cyan,
      cyanLight: PRESET_MAP.boutique.cyanLight,
      gold: PRESET_MAP.boutique.gold,
    },
  },
]
const TEMPLATE_LABELS: Record<LandingTemplateId, string> = {
  classic: 'Classic',
  modern: 'Modern',
  boutique: 'Boutique',
}

// ─── Estado ────────────────────────────────────────────────────────────────────────────
const loading = ref(true)
const saving = ref(false)
const loadError = ref('')

const templateId = ref<LandingTemplateId>('classic')
/** Overrides custom del merchant. Vacío = puro preset del template. */
const colors = ref<Partial<ThemeTokens>>({})
/** Fonts no se edita en este MVP — se conserva del load y se manda de vuelta en save. */
const fonts = ref<LandingTheme['fonts']>(undefined)


const templateLabel = computed(() => TEMPLATE_LABELS[templateId.value])
const hasOverrides = computed(() => Object.keys(colors.value).length > 0)

// ─── Carga inicial ─────────────────────────────────────────────────────────────────────
async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const theme = await LandingThemeService.getTheme()
    templateId.value = theme.templateId ?? 'classic'
    colors.value = { ...(theme.colors ?? {}) }
    fonts.value = theme.fonts
    markClean()
  } catch (e) {
    loadError.value = (e as Error)?.message || 'Error desconocido al cargar la apariencia.'
  } finally {
    loading.value = false
  }
}
onMounted(load)

// ─── Helpers de color ──────────────────────────────────────────────────────────────────
/** Valor efectivo del token = override si existe, si no preset del template actual. */
function effectiveColor(token: TokenKey): string {
  return colors.value[token] ?? PRESET_MAP[templateId.value][token]
}
/** Hex del preset (sin override) — para los swatches del selector de plantilla. */
function presetHex(tpl: LandingTemplateId, token: TokenKey): string {
  return PRESET_MAP[tpl][token]
}
/** True si el merchant personalizó este token (override custom). */
function isOverride(token: TokenKey): boolean {
  return Object.prototype.hasOwnProperty.call(colors.value, token)
}
/** Setter desde el picker nativo (siempre hex #rrggbb válido). */
function setColor(token: TokenKey, value: string) {
  colors.value = { ...colors.value, [token]: value }
}
/** Setter desde el input de texto — solo acepta hex #rrggbb (formato del picker nativo). */
function onHexInput(token: TokenKey, value: string) {
  const v = value.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(v)) {
    setColor(token, v)
  } else if (v === '' ) {
    // Borrar el override → vuelve al preset.
    const next = { ...colors.value }
    delete next[token]
    colors.value = next
  }
  // Cualquier otro valor intermedio (#ab o #abc) se ignora: el picker nativo es source of truth.
}

// ─── Selección de plantilla ────────────────────────────────────────────────────────────
function selectTemplate(id: LandingTemplateId) {
  if (saving.value || id === templateId.value) return
  templateId.value = id
  // Cambiar de plantilla reinicia los overrides: empezás desde el preset puro del nuevo
  // template (no tiene sentido arrastrar overrides del classic al modern, por ejemplo).
  // Si el merchant quiere mantener un color específico, lo vuelve a settear con el picker.
  colors.value = {}
}

function resetColors() {
  if (saving.value || !hasOverrides.value) return
  colors.value = {}
  toast.info('Paleta restaurada al preset de la plantilla.')
}

// ─── Fondo del mini-preview (gradiente que evoca la paleta del template) ──────────────
function previewBackdropStyle(id: LandingTemplateId): Record<string, string> {
  const p = PRESET_MAP[id]
  return {
    background: `linear-gradient(135deg, ${p.navy} 0%, ${p.navyLight} 45%, ${p.cyan} 100%)`,
  }
}

// ─── Dirty tracking ────────────────────────────────────────────────────────────────────
// Compara {templateId, colors, fonts} contra la foto tomada tras el último load/save.
interface Snapshot {
  templateId: LandingTemplateId
  colors: string
  fonts: string
}
const saved = reactive<Snapshot>({ templateId: 'classic', colors: '', fonts: '' })
function takeSnapshot(): Snapshot {
  return {
    templateId: templateId.value,
    colors: JSON.stringify(sortKeys(colors.value)),
    fonts: JSON.stringify(fonts.value ?? null),
  }
}
function sortKeys<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  return Object.keys(obj).sort().reduce<Record<string, unknown>>((acc, k) => {
    acc[k] = obj[k]
    return acc
  }, {})
}
function markClean() {
  const s = takeSnapshot()
  saved.templateId = s.templateId
  saved.colors = s.colors
  saved.fonts = s.fonts
}
const isDirty = computed(() => {
  const s = takeSnapshot()
  return s.templateId !== saved.templateId
    || s.colors !== saved.colors
    || s.fonts !== saved.fonts
})

// ─── Save ──────────────────────────────────────────────────────────────────────────────
async function save() {
  if (saving.value || !isDirty.value) return
  saving.value = true
  try {
    const payload: LandingTheme = {
      templateId: templateId.value,
      ...(Object.keys(colors.value).length > 0 ? { colors: colors.value } : {}),
      ...(fonts.value ? { fonts: fonts.value } : {}),
    }
    const saved_theme = await LandingThemeService.saveTheme(payload)
    // Refrescar state local con la respuesta (canónico: el backend puede normalizar
    // el shape — ej: descartar colors vacíos). Recarga el theme efectivamente persistido.
    templateId.value = saved_theme.templateId ?? 'classic'
    colors.value = { ...(saved_theme.colors ?? {}) }
    fonts.value = saved_theme.fonts
    markClean()
    toast.success('Apariencia guardada.', 'La landing pública se actualizó.')
  } catch (e) {
    toast.error('No se pudo guardar la apariencia.', (e as Error)?.message)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
/* El `<input type="color">` nativo tiene padding/border propios según navegador. Lo normalizamos
   para que se vea como un chip cuadrado que combina con el design system. */
input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
input[type="color"]::-webkit-color-swatch { border: none; border-radius: 0.375rem; }
input[type="color"]::-moz-color-swatch { border: none; border-radius: 0.375rem; }
</style>
