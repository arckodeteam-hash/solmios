<template>
  <!--
    LandingBuilder — pestaña del admin (F1 1.9, solmi-direct-booking / Pieza C).
    Lista los 9 bloques fijos de la landing pública del hotel, con:
      • drag-and-drop nativo (HTML5 DnD — sin dependencia nueva; ver nota en <script>),
      • toggle active por bloque,
      • editor de `config` específico por `type` (en un AppModal),
      • bulk save (PUT /api/landing) atómico con re-fetch (el backend regenera IDs).
    El link "Ver en la web pública" NO vive acá: está en el contenedor de tabs
    (pagina-publica/index.vue), para que esté disponible desde las 8 vistas del grupo.
  -->
  <div class="space-y-5">
    <!-- Header del builder (propio: el "Guardar" del header general no aplica acá) -->
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div class="min-w-0">
        <h2 class="text-xl font-black text-navy">Landing pública</h2>
        <p class="text-sm text-text-muted mt-0.5">
          Armá la página pública del hotel: ordená los bloques, elegí cuáles se ven y editá su contenido.
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
    <div v-if="loading" class="space-y-3">
      <div v-for="i in 9" :key="i" class="h-20 rounded-2xl border border-border bg-white shadow-(--shadow-card) animate-pulse" />
    </div>

    <!-- Error / sin slug -->
    <EmptyState
      v-else-if="loadError"
      title="No pudimos cargar los bloques"
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
    <EmptyState
      v-else-if="!slug"
      title="Falta configurar la URL pública"
      message="Antes de armar la landing, definí el slug del hotel en la pestaña «Página pública» (arriba)."
    />

    <!-- Lista de bloques (drag-and-drop) -->
    <div v-else>
      <p class="mb-3 text-[11px] font-bold uppercase tracking-wide text-text-muted">
        Arrastrá los bloques para reorderarlos · {{ blocks.length }} bloques
      </p>
      <div class="space-y-2.5">
        <div
          v-for="(block, idx) in blocks"
          :key="block.id"
          :draggable="!saving"
          @dragstart="onDragStart($event, idx)"
          @dragenter.prevent="onDragEnter(idx)"
          @dragover.prevent
          @dragend="onDragEnd"
          :class="rowClass(idx)"
          class="group flex items-center gap-3 rounded-2xl border bg-white px-3 py-3 shadow-(--shadow-card) transition-colors"
        >
          <!-- Drag handle -->
          <div
            class="flex h-9 w-6 shrink-0 cursor-grab items-center justify-center text-text-muted/60 hover:text-navy active:cursor-grabbing"
            :class="{ 'opacity-40': saving }"
            title="Arrastrá para reorderar"
            aria-label="Arrastrar bloque"
            v-html="ICON_DRAG"
          />

          <!-- Ícono + título + subtítulo -->
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="w-4 h-4" aria-hidden="true" v-html="BLOCK_TYPE_ICONS[block.type]"></span>
              <span class="text-sm font-black text-navy">{{ BLOCK_META[block.type].label }}</span>
              <span
                v-if="!block.active"
                class="rounded-full bg-surface px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-text-muted"
              >
                Oculto
              </span>
              <span
                v-else-if="isBlockDirty(block)"
                class="rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning"
              >
                Editado
              </span>
            </div>
            <p class="mt-0.5 truncate text-[11px] text-text-muted">{{ BLOCK_META[block.type].description }}</p>
          </div>

          <!-- Toggle active -->
          <button
            type="button"
            :aria-pressed="block.active"
            :aria-label="(block.active ? 'Ocultar' : 'Mostrar') + ' bloque ' + BLOCK_META[block.type].label"
            @click="block.active = !block.active"
            :disabled="saving"
            class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:cursor-not-allowed"
            :class="block.active ? 'bg-teal' : 'bg-gray-200'"
          >
            <span
              class="inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform"
              :class="block.active ? 'translate-x-5' : 'translate-x-0.5'"
            />
          </button>

          <!-- Editar config -->
          <button
            type="button"
            @click="openEditor(block)"
            :disabled="saving"
            class="shrink-0 rounded-full bg-navy/5 px-3.5 py-1.5 text-xs font-bold text-navy transition-colors hover:bg-navy/10 cursor-pointer disabled:opacity-50"
          >
            Editar contenido
          </button>
        </div>
      </div>

      <!-- Help -->
      <p class="mt-4 rounded-xl bg-surface p-3 text-[11px] text-text-muted leading-relaxed">
        La landing se arma con los datos reales del hotel (galería de fotos, servicios, tarifas y
        reseñas). Acá editás títulos y textos específicos de cada bloque, y elegís el orden.
        Los cambios se guardan todos juntos con el botón <strong>Guardar</strong>.
      </p>
    </div>

    <!-- ─── Editor modal por type ─────────────────────────────────────────── -->
    <AppModal
      v-if="editing"
      :open="true"
      size="lg"
      :title="`Editar bloque: ${BLOCK_META[editing.type].label}`"
      :subtitle="BLOCK_META[editing.type].description"
      @close="cancelEditor"
    >
      <div class="space-y-5">
        <!-- Render por tipo de field -->
        <template v-for="field in fieldsFor(editing.type)" :key="field.key">
          <!-- FAQ items (lista editable Q/A) -->
          <div v-if="field.kind === 'faq-items'">
            <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">
              {{ field.label }}
            </label>
            <div class="space-y-2.5">
              <div
                v-for="(item, i) in faqDraft"
                :key="i"
                class="rounded-xl border border-border bg-surface p-3"
              >
                <div class="flex items-start gap-2">
                  <input
                    v-model="item.question"
                    type="text"
                    placeholder="Pregunta"
                    class="flex-1 rounded-lg border border-border bg-white px-3 py-2 text-sm font-bold text-navy focus:border-navy focus:outline-none"
                  />
                  <button
                    type="button"
                    @click="faqDraft.splice(i, 1)"
                    class="shrink-0 rounded-lg bg-danger/10 px-2.5 py-2 text-xs font-bold text-danger hover:bg-danger/20 cursor-pointer"
                    aria-label="Eliminar pregunta"
                  >
                    Quitar
                  </button>
                </div>
                <textarea
                  v-model="item.answer"
                  rows="2"
                  placeholder="Respuesta"
                  class="mt-2 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-navy focus:border-navy focus:outline-none resize-y"
                />
              </div>
            </div>
            <button
              type="button"
              @click="faqDraft.push({ question: '', answer: '' })"
              class="mt-2 rounded-full bg-navy/10 px-3.5 py-1.5 text-xs font-bold text-navy hover:bg-navy/20 cursor-pointer"
            >
              + Agregar pregunta
            </button>
          </div>

          <!-- Footer links (lista editable {label, url}) -->
          <div v-else-if="field.kind === 'footer-links'">
            <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">
              {{ field.label }}
            </label>
            <div class="space-y-2">
              <div
                v-for="(link, i) in linksDraft"
                :key="i"
                class="flex items-center gap-2"
              >
                <input
                  v-model="link.label"
                  type="text"
                  placeholder="Texto del enlace"
                  class="w-1/2 rounded-lg border border-border bg-white px-3 py-2 text-sm font-bold text-navy focus:border-navy focus:outline-none"
                />
                <input
                  v-model="link.url"
                  type="url"
                  placeholder="https://…"
                  class="flex-1 rounded-lg border border-border bg-white px-3 py-2 text-sm text-navy focus:border-navy focus:outline-none"
                />
                <button
                  type="button"
                  @click="linksDraft.splice(i, 1)"
                  class="shrink-0 rounded-lg bg-danger/10 px-2.5 py-2 text-xs font-bold text-danger hover:bg-danger/20 cursor-pointer"
                  aria-label="Eliminar enlace"
                >
                  Quitar
                </button>
              </div>
            </div>
            <button
              type="button"
              @click="linksDraft.push({ label: '', url: '' })"
              class="mt-2 rounded-full bg-navy/10 px-3.5 py-1.5 text-xs font-bold text-navy hover:bg-navy/20 cursor-pointer"
            >
              + Agregar enlace
            </button>
          </div>

          <!-- Media picker (multi-select + upload + reorder) -->
          <div v-else-if="field.kind === 'media-picker'">
            <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">
              {{ field.label }}
            </label>
            <MediaPicker v-model="mediaIdsDraft" :type="field.mediaType ?? 'hero'" />
            <p v-if="field.help" class="mt-1.5 text-[10px] text-text-muted leading-relaxed">{{ field.help }}</p>
          </div>

          <!-- Checkbox simple (booleano) -->
          <div v-else-if="field.kind === 'checkbox'">
            <label class="flex items-center gap-2.5 cursor-pointer">
              <input
                v-model="checkboxDraft[field.key]"
                type="checkbox"
                class="h-4 w-4 rounded border-border text-navy focus:ring-navy"
              />
              <span class="text-sm font-bold text-navy">{{ field.label }}</span>
            </label>
          </div>

          <!-- Badge items (lista editable {icon, text} — trust-badges) -->
          <div v-else-if="field.kind === 'badge-items'">
            <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">
              {{ field.label }}
            </label>
            <div class="space-y-2">
              <div
                v-for="(item, i) in badgeItemsDraft"
                :key="i"
                class="flex items-center gap-2"
              >
                <input
                  v-model="item.icon"
                  type="text"
                  placeholder="icon (ej: rate, refund, secure)"
                  class="w-1/3 rounded-lg border border-border bg-white px-3 py-2 text-sm text-navy focus:border-navy focus:outline-none"
                />
                <input
                  v-model="item.text"
                  type="text"
                  placeholder="Texto del sello"
                  class="flex-1 rounded-lg border border-border bg-white px-3 py-2 text-sm font-bold text-navy focus:border-navy focus:outline-none"
                />
                <button
                  type="button"
                  @click="badgeItemsDraft.splice(i, 1)"
                  class="shrink-0 rounded-lg bg-danger/10 px-2.5 py-2 text-xs font-bold text-danger hover:bg-danger/20 cursor-pointer"
                  aria-label="Eliminar sello"
                >
                  Quitar
                </button>
              </div>
            </div>
            <button
              type="button"
              @click="badgeItemsDraft.push({ icon: 'rate', text: '' })"
              class="mt-2 rounded-full bg-navy/10 px-3.5 py-1.5 text-xs font-bold text-navy hover:bg-navy/20 cursor-pointer"
            >
              + Agregar sello
            </button>
          </div>

          <!-- Room type picker (tipos reales del hotel, dedupeados) -->
          <div v-else-if="field.kind === 'room-type-picker'">
            <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">
              {{ field.label }}
            </label>
            <select
              v-model="textDraft[field.key]"
              class="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm focus:border-navy focus:outline-none"
            >
              <option value="">Ninguna</option>
              <option v-for="t in roomTypeOptionsDraft" :key="t" :value="t">{{ t }}</option>
            </select>
            <p class="mt-1 text-[10px] text-text-muted leading-relaxed">
              Tipos de habitación del hotel (no una unidad física puntual).
            </p>
          </div>

          <!-- Hero: buscador de disponibilidad (toggle + texto del botón) -->
          <div v-else-if="field.kind === 'hero-search-toggle'">
            <label class="mb-2 flex items-center gap-2.5 cursor-pointer">
              <input
                v-model="heroSearchDraft.enabled"
                type="checkbox"
                class="h-4 w-4 rounded border-border text-navy focus:ring-navy"
              />
              <span class="text-sm font-bold text-navy">{{ field.label }}</span>
            </label>
            <p class="mb-2 text-[10px] text-text-muted leading-relaxed">
              Viene activo por defecto. Si lo destildás, el hero muestra el botón de reservar
              (“Texto del botón”) en lugar del buscador.
            </p>
            <input
              v-if="heroSearchDraft.enabled"
              v-model.trim="heroSearchDraft.ctaText"
              type="text"
              placeholder="Buscar disponibilidad"
              class="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm focus:border-navy focus:outline-none"
            />
          </div>

          <!-- Text / textarea / number -->
          <div v-else>
            <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">
              {{ field.label }}
              <span v-if="field.optional" class="ml-1 font-normal lowercase text-text-muted">(opcional)</span>
            </label>
            <textarea
              v-if="field.kind === 'textarea'"
              v-model="textDraft[field.key]"
              rows="3"
              :placeholder="field.placeholder || ''"
              class="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm focus:border-navy focus:outline-none resize-y"
            />
            <input
              v-else-if="field.kind === 'number'"
              v-model.number="textDraft[field.key]"
              type="number"
              min="1"
              step="1"
              :placeholder="field.placeholder || ''"
              class="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm focus:border-navy focus:outline-none"
            />
            <input
              v-else
              v-model.trim="textDraft[field.key]"
              type="text"
              :placeholder="field.placeholder || ''"
              class="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm focus:border-navy focus:outline-none"
            />
            <p v-if="field.help" class="mt-1 text-[10px] text-text-muted leading-relaxed">{{ field.help }}</p>
          </div>
        </template>
      </div>

      <template #footer>
        <button
          type="button"
          @click="cancelEditor"
          class="rounded-full px-4 py-2 text-sm font-bold text-text-secondary hover:bg-surface cursor-pointer"
        >
          Cancelar
        </button>
        <button
          type="button"
          @click="applyEditor"
          class="rounded-full bg-navy px-5 py-2 text-sm font-bold text-white hover:shadow-lg cursor-pointer"
        >
          Aplicar
        </button>
      </template>
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onMounted } from 'vue'
import AppModal from '@/components/ui/AppModal.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import MediaPicker from '@/components/landing/MediaPicker.vue'
import { BLOCK_TYPE_ICONS } from '@/components/landing/landing-icons'
import { useToast } from '@/composables/useToast'
import { AdminLandingService } from '@/services/AdminLanding.service'
import { SettingsService } from '@/services/Settings.service'
import { RoomService } from '@/services/Room.service'
import { useAuthStore } from '@/stores/auth.store'
import type {
  AdminLandingBlock,
  LandingBlockType,
  FaqItem,
  FooterLink,
  TrustBadgeItem,
} from '@/types/landing'

/**
 * Slug del hotel. Antes lo pasaba el contenedor (settings/index.vue); ahora la
 * landing vive en su propia ruta (/panel/pagina-publica/landing), así que la prop
 * es opcional y se auto-carga vía SettingsService si el contenedor no la provee.
 * Si está vacío, pedimos al admin que lo configure primero en «General».
 */
const props = defineProps<{ slug?: string }>()
const selfSlug = ref('')
const slug = computed(() => props.slug || selfSlug.value)

const toast = useToast()
const auth = useAuthStore()

// ─── Metadatos por type (catálogo FIJO, espeja backend/types.ts) ─────────────────────────
const BLOCK_META: Record<LandingBlockType, { label: string; description: string }> = {
  hero:       { label: 'Portada (Hero)',     description: 'Banda superior con título, subtítulo y botón de reserva sobre la imagen.' },
  'trust-badges': { label: 'Sellos de confianza', description: 'Fila de garantías debajo del hero (mejor tarifa, cancelación, pago seguro, etc.).' },
  storytelling: { label: 'Experiencia (storytelling)', description: 'Texto + fotos contando la propuesta del hotel ("Vive una experiencia única").' },
  gallery:    { label: 'Galería',            description: 'Grilla de fotos del hotel. Las fotos se suben desde Media.' },
  amenities:  { label: 'Servicios',          description: 'Íconos de los servicios del hotel (piscina, wifi, parking, …).' },
  location:   { label: 'Ubicación',          description: 'Mapa con la ubicación del hotel + descripción opcional.' },
  reviews:    { label: 'Reseñas',            description: 'Últimas reseñas visibles + score agregado.' },
  rooms:      { label: 'Habitaciones',       description: 'Tarjetas de tipos de habitación con tarifa «Desde $X».' },
  faq:        { label: 'Preguntas frecuentes', description: 'Acordeón de preguntas y respuestas.' },
  policies:   { label: 'Políticas y condiciones', description: 'Cancelación real, horarios de check-in/out y estadía mínima. El contenido se toma de tu configuración: acá solo cambiás el título.' },
  cta:        { label: 'Llamado a la acción', description: 'Bloque con título + subtítulo + botón principal.' },
  footer:     { label: 'Pie de página',      description: 'Copyright + enlaces opcionales.' },
}

// ─── Form por type (spec landing-builder/spec.md "Config JSON por bloque") ───────────────
// El shape de `config` está fijo en el spec (hero: title/subtitle/ctaText/backgroundMediaId,
// faq: title/items, …). Acá solo declaramos qué fields editar por type. El backend valida el
// enum de types pero NO el shape del config (lo persiste tal cual) — el contract es el spec.
type FieldKind =
  | 'text' | 'textarea' | 'number' | 'faq-items' | 'footer-links' | 'media-picker'
  | 'checkbox' | 'badge-items' | 'room-type-picker' | 'hero-search-toggle'
interface FieldDef {
  key: string
  label: string
  kind: FieldKind
  placeholder?: string
  help?: string
  optional?: boolean
  /** Solo para kind:'media-picker' — qué bucket de hotel_media lista (default 'hero'). */
  mediaType?: 'hero' | 'gallery'
}
const FIELDS_BY_TYPE: Record<LandingBlockType, FieldDef[]> = {
  hero: [
    { key: 'title', label: 'Título', kind: 'text', placeholder: 'Tu próximo destino' },
    { key: 'subtitle', label: 'Subtítulo', kind: 'text', placeholder: 'Reservá directo y aprovechá el mejor precio.' },
    { key: 'ctaText', label: 'Texto del botón', kind: 'text', placeholder: 'Reservar' },
    { key: 'backgroundMediaIds', label: 'Imágenes del fondo', kind: 'media-picker',
      help: 'Elegí una o varias imágenes hero. Con 2+ se arma un carrusel que rota solo.' },
    { key: 'searchBar', label: 'Mostrar el buscador de disponibilidad en el hero', kind: 'hero-search-toggle' },
  ],
  'trust-badges': [
    { key: 'title', label: 'Título', kind: 'text', placeholder: '', optional: true },
    { key: 'items', label: 'Sellos', kind: 'badge-items' },
  ],
  storytelling: [
    { key: 'title', label: 'Título', kind: 'text', placeholder: 'Vive una experiencia única' },
    { key: 'description', label: 'Descripción', kind: 'textarea',
      placeholder: 'Contá qué hace único a tu hotel — la experiencia, no solo las habitaciones.',
      help: 'Vacío = el bloque no se muestra (salvo que elijas fotos abajo).' },
    { key: 'linkText', label: 'Texto del link', kind: 'text', placeholder: 'Ver habitaciones', optional: true,
      help: 'Vacío = sin link. El link scrollea a la sección de habitaciones.' },
    { key: 'mediaIds', label: 'Fotos de la sección', kind: 'media-picker', mediaType: 'gallery',
      help: 'Hasta 3 fotos (de tu galería). La primera se muestra más grande.' },
  ],
  gallery:   [{ key: 'title', label: 'Título', kind: 'text', placeholder: 'Galería' }],
  amenities: [{ key: 'title', label: 'Título', kind: 'text', placeholder: 'Servicios' }],
  location: [
    { key: 'title', label: 'Título', kind: 'text', placeholder: 'Ubicación' },
    { key: 'description', label: 'Descripción', kind: 'textarea',
      placeholder: 'Cómo llegar, referencia a tener en cuenta, …' },
  ],
  reviews: [
    { key: 'title', label: 'Título', kind: 'text', placeholder: 'Opiniones de huéspedes' },
    { key: 'maxItems', label: 'Cantidad a mostrar', kind: 'number', placeholder: '6',
      help: 'Máximo de reseñas que se muestran en la landing.' },
  ],
  rooms: [
    { key: 'title', label: 'Título', kind: 'text', placeholder: 'Habitaciones' },
    { key: 'ctaText', label: 'Texto del botón', kind: 'text', placeholder: 'Ver tarifas' },
    { key: 'showSpecs', label: 'Mostrar specs (adultos/m²)', kind: 'checkbox' },
    { key: 'featuredRoomId', label: 'Tipo de habitación destacado', kind: 'room-type-picker' },
    { key: 'featuredBadgeText', label: 'Texto del badge', kind: 'text', placeholder: 'Más reservada', optional: true },
  ],
  faq: [
    { key: 'title', label: 'Título', kind: 'text', placeholder: 'Preguntas frecuentes' },
    { key: 'items', label: 'Preguntas y respuestas', kind: 'faq-items' },
  ],
  // `policies` NO tiene campos de contenido a propósito: la política de cancelación se deriva en
  // el render de la que el motor aplica de verdad (`cancellationSummary` de GET /rates) y los
  // horarios/estadía mínima salen de la configuración del hotel. Editarlos a mano acá crearía una
  // segunda versión de las condiciones que puede contradecir a la vigente — que es exactamente el
  // problema que este bloque vino a resolver. Para cambiar lo que dice: Configuración → política
  // de cancelación y Motor de reservas → estadía mínima.
  policies: [
    { key: 'title', label: 'Título', kind: 'text', placeholder: 'Políticas y condiciones' },
  ],
  cta: [
    { key: 'title', label: 'Título', kind: 'text', placeholder: 'Reservá directo' },
    { key: 'subtitle', label: 'Subtítulo', kind: 'text',
      placeholder: 'Mejor precio garantizado cuando reservás con nosotros.' },
    { key: 'buttonText', label: 'Texto del botón', kind: 'text', placeholder: 'Reservar ahora' },
  ],
  footer: [
    { key: 'copyright', label: 'Copyright', kind: 'text', placeholder: '© 2026 Tu Hotel' },
    { key: 'links', label: 'Enlaces', kind: 'footer-links' },
  ],
}

function fieldsFor(type: LandingBlockType): FieldDef[] {
  return FIELDS_BY_TYPE[type] ?? []
}

// ─── Estado ──────────────────────────────────────────────────────────────────────────────
const loading = ref(true)
const saving = ref(false)
const loadError = ref('')
const blocks = ref<AdminLandingBlock[]>([])


// ─── Carga inicial ───────────────────────────────────────────────────────────────────────
async function load() {
  loading.value = true
  loadError.value = ''
  try {
    // Si el contenedor no pasó slug, lo cargamos acá (la landing es una ruta propia).
    if (!props.slug) {
      try {
        const s = await SettingsService.get()
        selfSlug.value = (s.hotel?.slug as string) || ''
      } catch { /* sin slug: la UI pide configurarlo primero */ }
    }
    const result = await AdminLandingService.list()
    blocks.value = (result?.data ?? []).slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    markClean()
  } catch (e) {
    loadError.value = (e as Error)?.message || 'Error desconocido al cargar los bloques.'
  } finally {
    loading.value = false
  }
}
onMounted(load)

// ─── Dirty tracking ──────────────────────────────────────────────────────────────────────
// Compara {type, config, sortOrder, active} contra la foto tomada tras el último load/save.
// Ignora id/hotelId/timestamps (el upsert los regenera).
function blockSignature(b: AdminLandingBlock): string {
  return JSON.stringify({
    t: b.type,
    c: b.config ?? null,
    s: b.sortOrder ?? 0,
    a: b.active === true,
  })
}
const savedSnapshot = ref('')
function snapshot(): string {
  return JSON.stringify(blocks.value.map(blockSignature))
}
function markClean() { savedSnapshot.value = snapshot() }
const isDirty = computed(() => blocks.value.length > 0 && snapshot() !== savedSnapshot.value)

function isBlockDirty(b: AdminLandingBlock): boolean {
  if (!savedSnapshot.value) return false
  const saved = JSON.parse(savedSnapshot.value) as string[]
  const idx = blocks.value.indexOf(b)
  return idx >= 0 && idx < saved.length ? blockSignature(b) !== saved[idx] : true
}

// ─── Drag-and-drop (HTML5 nativo — ver nota al final del archivo) ────────────────────────
const dragIndex = ref<number | null>(null)

function onDragStart(e: DragEvent, idx: number) {
  if (saving.value) { e.preventDefault(); return }
  dragIndex.value = idx
  // Firefox/Chrome necesitan algo en dataTransfer para iniciar el drag.
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(idx))
  }
}
function onDragEnter(idx: number) {
  if (dragIndex.value === null || dragIndex.value === idx) return
  const next = blocks.value.slice()
  const [moved] = next.splice(dragIndex.value, 1)
  next.splice(idx, 0, moved)
  blocks.value = next
  dragIndex.value = idx
}
function onDragEnd() { dragIndex.value = null }

function rowClass(idx: number): string {
  if (dragIndex.value === null) return 'border-border'
  if (dragIndex.value === idx) return 'border-cyan bg-cyan/5 opacity-60'
  return 'border-border'
}

// ─── Editor modal ────────────────────────────────────────────────────────────────────────
// El modal trabaja sobre drafts (textDraft / faqDraft / linksDraft). Al "Aplicar" se vuelcan
// al `config` del bloque en edición. NO persiste: el "Guardar" del header hace el PUT con todo.
const editing = ref<AdminLandingBlock | null>(null)
const textDraft = reactive<Record<string, string | number | null>>({})
const faqDraft = ref<FaqItem[]>([])
const linksDraft = ref<FooterLink[]>([])
const mediaIdsDraft = ref<string[]>([])
const checkboxDraft = reactive<Record<string, boolean>>({})
const badgeItemsDraft = ref<TrustBadgeItem[]>([])
const roomTypeOptionsDraft = ref<string[]>([])
// enabled arranca en true — el buscador del hero viene ACTIVO por default (ver HeroBlock.vue).
const heroSearchDraft = reactive<{ enabled: boolean; ctaText: string }>({ enabled: true, ctaText: 'Buscar disponibilidad' })

function openEditor(block: AdminLandingBlock) {
  editing.value = block
  const cfg = block.config ?? {}
  // Reset drafts
  for (const k of Object.keys(textDraft)) delete textDraft[k]
  faqDraft.value = []
  linksDraft.value = []
  mediaIdsDraft.value = []
  for (const k of Object.keys(checkboxDraft)) delete checkboxDraft[k]
  badgeItemsDraft.value = []
  roomTypeOptionsDraft.value = []
  heroSearchDraft.enabled = true
  heroSearchDraft.ctaText = 'Buscar disponibilidad'
  // room-type-picker: fetch tipos reales del hotel (dedupe por .type) solo si el bloque es 'rooms'.
  if (block.type === 'rooms') {
    RoomService.list({ hotelId: auth.user?.hotelId, limit: 200 })
      .then((res) => {
        const types = Array.from(new Set(res.rooms.map((r) => r.type))).sort()
        roomTypeOptionsDraft.value = types
      })
      .catch(() => { roomTypeOptionsDraft.value = [] })
  }
  // Popular según fields del type
  for (const field of fieldsFor(block.type)) {
    const raw = (cfg as Record<string, unknown>)[field.key]
    if (field.kind === 'faq-items') {
      faqDraft.value = Array.isArray(raw)
        ? raw.filter((it): it is FaqItem =>
            typeof it === 'object' && it !== null &&
            typeof (it as FaqItem).question === 'string' &&
            typeof (it as FaqItem).answer === 'string')
          .map((it) => ({ question: (it as FaqItem).question, answer: (it as FaqItem).answer }))
        : []
    } else if (field.kind === 'footer-links') {
      linksDraft.value = Array.isArray(raw)
        ? raw.filter((it): it is FooterLink =>
            typeof it === 'object' && it !== null &&
            typeof (it as FooterLink).label === 'string' &&
            typeof (it as FooterLink).url === 'string')
          .map((it) => ({ label: (it as FooterLink).label, url: (it as FooterLink).url }))
        : []
    } else if (field.kind === 'media-picker') {
      // backgroundMediaIds (array) → si no, migrar del backgroundMediaId single legacy.
      if (Array.isArray(raw)) {
        mediaIdsDraft.value = raw.filter((id): id is string => typeof id === 'string' && id.length > 0)
      } else if (typeof raw === 'string' && raw.length > 0) {
        mediaIdsDraft.value = [raw]
      } else {
        // Intentar migrar del hermano `backgroundMediaId` (campo que este picker reemplaza).
        const legacy = (cfg as Record<string, unknown>).backgroundMediaId
        mediaIdsDraft.value = typeof legacy === 'string' && legacy.length > 0 ? [legacy] : []
      }
    } else if (field.kind === 'number') {
      const n = Number(raw)
      textDraft[field.key] = Number.isFinite(n) && n > 0 ? n : null
    } else if (field.kind === 'checkbox') {
      // Default true si el config no trae la key todavía (mismo criterio que rooms.showSpecs
      // sembrado por el backend en defaults.ts).
      checkboxDraft[field.key] = raw === false ? false : true
    } else if (field.kind === 'badge-items') {
      badgeItemsDraft.value = Array.isArray(raw)
        ? raw.filter((it): it is TrustBadgeItem =>
            typeof it === 'object' && it !== null &&
            typeof (it as TrustBadgeItem).icon === 'string' &&
            typeof (it as TrustBadgeItem).text === 'string')
          .map((it) => ({ icon: (it as TrustBadgeItem).icon, text: (it as TrustBadgeItem).text }))
        : []
    } else if (field.kind === 'room-type-picker') {
      textDraft[field.key] = typeof raw === 'string' && raw.length > 0 ? raw : ''
    } else if (field.kind === 'hero-search-toggle') {
      const sb = raw as { enabled?: unknown; ctaText?: unknown } | undefined
      // Default ACTIVO (espeja HeroBlock.vue:searchBarEnabled → `!== false`): si el hotel nunca
      // configuró `searchBar`, el checkbox arranca tildado porque el hero ya muestra el buscador.
      heroSearchDraft.enabled = sb?.enabled !== false
      heroSearchDraft.ctaText = typeof sb?.ctaText === 'string' && sb.ctaText.trim()
        ? sb.ctaText.trim()
        : 'Buscar disponibilidad'
    } else {
      textDraft[field.key] = typeof raw === 'string' ? raw : ''
    }
  }
}

function cancelEditor() { editing.value = null }

function applyEditor() {
  const block = editing.value
  if (!block) return
  const cfg: Record<string, unknown> = { ...(block.config ?? {}) }
  for (const field of fieldsFor(block.type)) {
    if (field.kind === 'faq-items') {
      const items = faqDraft.value
        .map((it) => ({ question: it.question.trim(), answer: it.answer.trim() }))
        .filter((it) => it.question || it.answer)
      cfg.items = items
    } else if (field.kind === 'footer-links') {
      const links = linksDraft.value
        .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
        .filter((l) => l.label || l.url)
      cfg.links = links
    } else if (field.kind === 'media-picker') {
      // Array de ids ordenado. Si queda vacío, persistimos null (el hero cae a media.hero).
      const ids = mediaIdsDraft.value.slice()
      cfg[field.key] = ids.length > 0 ? ids : null
      // Limpiar el campo legacy `backgroundMediaId` para que no ressuelva single cuando el
      // array está vacío intencionalmente. El HeroBlock prioriza el array; el single queda
      // solo como migración de configs viejas editadas desde acá.
      cfg.backgroundMediaId = null
    } else if (field.kind === 'number') {
      const n = Number(textDraft[field.key])
      cfg[field.key] = Number.isFinite(n) && n > 0 ? Math.floor(n) : null
    } else if (field.kind === 'checkbox') {
      cfg[field.key] = checkboxDraft[field.key] === true
    } else if (field.kind === 'badge-items') {
      const items = badgeItemsDraft.value
        .map((it) => ({ icon: it.icon.trim(), text: it.text.trim() }))
        .filter((it) => it.text)
      cfg[field.key] = items
    } else if (field.kind === 'room-type-picker') {
      const v = typeof textDraft[field.key] === 'string' ? (textDraft[field.key] as string).trim() : ''
      cfg[field.key] = v || null
    } else if (field.kind === 'hero-search-toggle') {
      // Objeto completo (no aplanar keys) — HeroBlock.vue lee cfg.searchBar?.enabled/ctaText.
      cfg[field.key] = {
        enabled: heroSearchDraft.enabled,
        ctaText: heroSearchDraft.ctaText.trim() || 'Buscar disponibilidad',
      }
    } else {
      const v = textDraft[field.key]
      cfg[field.key] = typeof v === 'string' ? v : (v ?? null)
    }
  }
  // Reasignar referencia para que la mutación dispare reactividad + isBlockDirty
  const idx = blocks.value.indexOf(block)
  if (idx >= 0) {
    blocks.value[idx] = { ...block, config: cfg }
  }
  editing.value = null
  toast.success(`Bloque «${BLOCK_META[block.type].label}» actualizado.`)
}

// ─── Save (PUT /api/landing bulk upsert atómico) ────────────────────────────────────────
async function save() {
  if (saving.value || !isDirty.value) return
  saving.value = true
  try {
    const payload = blocks.value.map((b, idx) => ({
      id: b.id,
      type: b.type,
      config: b.config ?? null,
      sortOrder: idx, // el nuevo orden = posición en el array
      active: b.active === true,
    }))
    const result = await AdminLandingService.upsert(payload)
    // El backend regenera IDs (delete-all + create-many): refrescar state local con la
    // respuesta para que un toggle/edit posterior no use IDs ya inexistentes.
    const fresh = (result?.data ?? []).slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    blocks.value = fresh
    markClean()
    toast.success('Landing guardada.')
  } catch (e) {
    toast.error((e as Error)?.message || 'No se pudo guardar la landing.')
  } finally {
    saving.value = false
  }
}

// ─── Iconos (SVG inline) ─────────────────────────────────────────────────────────────────
const ICON_DRAG = '<svg viewBox="0 0 24 24" class="h-4 w-4" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>'
</script>

<style scoped>
/*
  NOTA DE DISEÑO — Drag-and-drop SIN dependencia nueva:
  El task 1.9 sugería `vuedraggable@next` si no estaba. Elegí HTML5 DnD nativo porque:
    1. La lista es FIJA de 9 items (catálogo cerrado en backend) — no crece, no se filtra,
       no se pagina. Una librería de reorder para 9 items fijos es sobreingeniería.
    2. vuedraggable@next para Vue 3 todavía tiene known issues; el DnD nativo es más
       predecible y no agrega peso al bundle ni entradas al lockfile.
    3. El "handle" + el `draggable="true"` en la fila + dragenter/dragstart/dragend cubren
       la interacción completa (mover + feedback visual + reset al soltar).
  Si más adelante la lista dejara de ser fija, conviene migrar a vuedraggable o sortablejs.
*/
</style>
