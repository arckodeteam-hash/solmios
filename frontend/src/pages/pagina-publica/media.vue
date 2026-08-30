<template>
  <!--
    Media general — gestor de imágenes del hotel (panel-pagina-publica-gaps, solmi-direct-booking).
    Resumen:
      • Tabs por `type`: hero | gallery | room (los 3 que soporta el backend).
      • Por tab: grid de thumbnails, upload (input file → base64 → HotelMediaService.upload),
        delete (remove), reorder por flechas ↑↓ (reorder), edit alt inline (update).
      • EmptyState cubre vacío Y error (regla empty-state-vs-load-error-blank-screen).
      • NO toca el backend directamente (regla "no fetch en componentes"): solo HotelMediaService.
    El orden de cada tab se persiste on-the-fly al mover (reorder es barato y atómico en el server).
  -->
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div class="min-w-0">
        <h2 class="text-xl font-black text-navy">Galería de imágenes</h2>
        <p class="text-sm text-text-muted mt-0.5">
          Subí y organizá las fotos que se ven en tu landing pública y en el motor de reservas.
        </p>
      </div>
      <div class="text-right">
        <label
          class="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-cyan px-5 py-2.5 text-sm font-extrabold text-navy transition-all hover:shadow-lg"
          :class="uploading || atMediaLimit || !canUpload ? 'opacity-60 pointer-events-none' : ''"
        >
          <span v-if="uploading" aria-hidden="true" class="h-3.5 w-3.5 rounded-full border-2 border-navy/30 border-t-navy animate-spin" />
          <span v-else aria-hidden="true">↑</span>
          {{ uploadLabel }}
          <input
            ref="fileInputRef"
            type="file"
            accept="image/*"
            multiple
            class="hidden"
            :disabled="uploading || atMediaLimit || !canUpload"
            @change="onFileChange"
          />
        </label>
        <p v-if="atMediaLimit" class="mt-1 text-[10px] font-bold text-text-muted">
          Llegaste al máximo de {{ MAX_MEDIA_PER_TYPE }} fotos en {{ activeTabMeta.labelLower }}. Borrá alguna para subir otra.
        </p>
        <p v-else-if="!canUpload" class="mt-1 text-[10px] font-bold text-text-muted">
          Elegí una habitación abajo antes de subir.
        </p>
      </div>
    </div>

    <!-- Tabs por tipo -->
    <div class="flex flex-wrap gap-2">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        @click="activeTab = tab.id"
        class="rounded-full px-4 py-2 text-xs font-bold transition-all cursor-pointer"
        :class="activeTab === tab.id
          ? 'bg-navy text-white'
          : 'bg-surface text-text-secondary hover:bg-navy/5'"
      >
        {{ tab.label }}
        <span
          class="ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-black tabular-nums"
          :class="activeTab === tab.id ? 'bg-white/20 text-white' : 'bg-white text-text-muted'"
        >{{ countFor(tab.id) }}</span>
      </button>
    </div>

    <!-- Contenido -->
    <SectionCard
      :key="activeTab"
      :title="activeTabMeta.title"
      :subtitle="activeTabMeta.subtitle"
      body-class="p-4 sm:p-5"
    >
      <!-- Selector de habitación (solo tab 'room') — el backend exige un roomId real por
           foto (se agrupan por habitación física en la landing, no por tipo). Sin esto
           NINGUNA subida en este tab podía funcionar (bug reportado por usuario). -->
      <div v-if="activeTab === 'room'" class="mb-4">
        <label class="mb-1 block text-[10px] font-bold uppercase text-text-muted">
          Habitación de esta foto
        </label>
        <select
          v-model="selectedRoomId"
          class="w-full max-w-sm rounded-lg border border-border bg-white px-3 py-2 text-sm text-navy focus:border-cyan focus:outline-none sm:w-auto"
        >
          <option value="" disabled>Elegí una habitación…</option>
          <option v-for="r in rooms" :key="r.id" :value="r.id">{{ r.number }} — {{ r.name || r.type }}</option>
        </select>
        <p v-if="roomsLoadError" class="mt-1 text-[10px] font-bold text-danger">{{ roomsLoadError }}</p>
        <p v-else-if="rooms.length === 0" class="mt-1 text-[10px] text-text-muted">
          Este hotel todavía no tiene habitaciones cargadas — creálas primero en Operaciones → Habitaciones.
        </p>
      </div>

      <!-- Loading skeleton -->
      <div v-if="loading" class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <div
          v-for="i in 8"
          :key="i"
          class="aspect-4/3 animate-pulse rounded-xl border border-border bg-surface"
        />
      </div>

      <!-- Error -->
      <EmptyState
        v-else-if="loadError"
        :icon="ICON_WARNING"
        title="No pudimos cargar las imágenes"
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

      <!-- Vacío -->
      <EmptyState
        v-else-if="items.length === 0"
        :icon="activeTabMeta.icon"
        :title="`Subí tu primera foto de ${activeTabMeta.labelLower}`"
        :message="activeTabMeta.emptyMessage"
      />

      <!-- Grid de thumbnails -->
      <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <div
          v-for="(item, idx) in items"
          :key="item.id"
          class="group relative overflow-hidden rounded-xl border border-border bg-surface"
        >
          <!-- Bug encontrado por QA (media-explicit-save-alt): el overlay de acciones era
               `absolute inset-0` del CONTENEDOR COMPLETO (imagen + footer del nombre), así
               que tapaba el input/botón "Guardar" de abajo con un `pointer-events` real
               (no solo visualmente) cada vez que el mouse pasaba por la tarjeta — un click
               en "Guardar" nunca llegaba a destino. Fix: el overlay ahora es `relative` al
               wrapper `aspect-4/3` de la IMAGEN únicamente, no a la tarjeta entera. -->
          <div class="relative aspect-4/3 w-full overflow-hidden">
            <img
              :src="item.url"
              :alt="item.alt ?? ''"
              class="h-full w-full object-cover transition-opacity"
              :class="item.active === false ? 'opacity-40 grayscale' : ''"
              loading="lazy"
              draggable="false"
            />

            <!-- Badge fijo (sin hover) — oculta no debe depender de pasar el mouse para notarse. -->
            <span
              v-if="item.active === false"
              class="absolute bottom-1.5 left-1.5 rounded-full bg-navy/80 px-2 py-0.5 text-[10px] font-black text-white"
            >Oculta</span>

            <!-- Overlay de acciones (hover) -->
            <div
              class="absolute inset-0 flex flex-col justify-between bg-navy/0 opacity-0 transition-all group-hover:bg-navy/40 group-hover:opacity-100"
            >
              <!-- Top bar: contador + estrella (marcar principal) + ocultar + delete -->
              <div class="flex items-start justify-between p-1.5">
                <span class="rounded-full bg-navy/80 px-2 py-0.5 text-[10px] font-black text-white tabular-nums">
                  #{{ idx + 1 }}
                </span>
                <div class="flex items-center gap-1.5">
                  <!-- La #1 es la que la landing muestra grande (variant classic) / primera del
                       carrusel. Antes solo se podía llegar ahí a fuerza de ▲: esto la manda al
                       frente en un click. -->
                  <button
                    type="button"
                    @click="setAsPrimary(item)"
                    :disabled="idx === 0 || reordering"
                    :aria-label="idx === 0 ? 'Ya es la foto principal' : 'Marcar como principal'"
                    :title="idx === 0 ? 'Foto principal' : 'Marcar como principal'"
                    class="grid h-7 w-7 place-items-center rounded-full shadow cursor-pointer disabled:cursor-not-allowed"
                    :class="idx === 0 ? 'bg-gold text-white' : 'bg-white/90 text-navy hover:bg-white disabled:opacity-60'"
                  ><span class="w-3.5 h-3.5" v-html="idx === 0 ? ICON_STAR : ICON_STAR_OUTLINE"></span></button>
                  <!-- Ocultar sin borrar: sale de la landing/motor pero se puede reactivar acá mismo. -->
                  <button
                    type="button"
                    @click="toggleActive(item)"
                    :disabled="togglingActiveId === item.id"
                    :aria-label="item.active === false ? `Mostrar ${activeTabMeta.labelLower}` : `Ocultar ${activeTabMeta.labelLower}`"
                    :title="item.active === false ? 'Mostrar en la landing' : 'Ocultar de la landing'"
                    class="grid h-7 w-7 place-items-center rounded-full bg-white/90 text-navy shadow hover:bg-white cursor-pointer disabled:opacity-50"
                  ><span class="w-3.5 h-3.5" v-html="item.active === false ? ICON_EYE_OFF : ICON_EYE"></span></button>
                  <button
                    type="button"
                    @click="confirmRemove(item)"
                    :disabled="removingId === item.id"
                    :aria-label="`Borrar ${activeTabMeta.labelLower}`"
                    class="grid h-7 w-7 place-items-center rounded-full bg-danger text-white shadow hover:bg-rose cursor-pointer disabled:opacity-50"
                  ><span class="w-3.5 h-3.5" v-html="ICON_X"></span></button>
                </div>
              </div>
              <!-- Bottom bar: reorder -->
              <div class="flex items-center justify-center gap-1.5 p-1.5">
                <button
                  type="button"
                  @click="move(idx, -1)"
                  :disabled="idx === 0 || reordering"
                  aria-label="Mover antes"
                  class="grid h-7 w-7 place-items-center rounded-md bg-white/90 text-navy hover:bg-white cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                >▲</button>
                <button
                  type="button"
                  @click="move(idx, 1)"
                  :disabled="idx === items.length - 1 || reordering"
                  aria-label="Mover después"
                  class="grid h-7 w-7 place-items-center rounded-md bg-white/90 text-navy hover:bg-white cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                >▼</button>
              </div>
            </div>
          </div>

          <!-- Con varias habitaciones mezcladas en un mismo listado, sin esto no hay forma
               de saber a cuál pertenece cada foto. -->
          <div v-if="activeTab === 'room' && item.roomId" class="flex items-center gap-1 border-t border-border bg-surface px-1.5 py-1 text-[10px] font-bold text-text-secondary truncate">
            <span class="w-3 h-3 shrink-0" v-html="ICON_BED"></span>
            {{ roomLabelById[item.roomId] || 'Habitación eliminada' }}
          </div>

          <!-- Edit alt inline (siempre visible abajo). Antes: `bg-transparent border-0` se
               veía IGUAL que texto plano — nada indicaba que era editable (feedback real de
               usuario: "las personas no van a entender eso"). Ahora: ícono de lápiz + fondo/
               borde propios de un campo, para que se lea como control, no como texto fijo.
               Autosave al perder foco/Enter + botón "Guardar" explícito cuando hay cambios. -->
          <div class="border-t border-border bg-white p-1.5">
            <div class="flex items-center gap-1 rounded-lg border border-border bg-surface px-1.5 focus-within:border-cyan focus-within:bg-white">
              <span aria-hidden="true" class="flex-shrink-0 w-3 h-3 text-text-muted" v-html="ICON_PENCIL"></span>
              <input
                v-model="altDrafts[item.id]"
                type="text"
                spellcheck="false"
                placeholder="Ponele nombre: baño, sala..."
                class="min-w-0 flex-1 bg-transparent border-0 px-1 py-1.5 text-[11px] text-navy placeholder-text-muted focus:outline-none"
                @blur="commitAlt(item)"
                @keydown.enter.prevent="commitAlt(item)"
              />
              <button
                v-if="altDrafts[item.id] !== (item.alt ?? '')"
                type="button"
                :disabled="savingAlt[item.id]"
                @mousedown.prevent="commitAlt(item)"
                class="flex-shrink-0 rounded-md bg-teal px-2 py-1 text-[10px] font-black text-white hover:shadow cursor-pointer disabled:opacity-50"
              >{{ savingAlt[item.id] ? '...' : 'Guardar' }}</button>
            </div>
          </div>
        </div>

        <!-- Tile grande "+" al final de la grilla — segunda entrada al mismo input de
             arriba, más visual/descubrible que el botón de texto solo. -->
        <button
          type="button"
          :disabled="uploading || atMediaLimit || !canUpload"
          @click="openFilePicker"
          class="group grid aspect-4/3 w-full cursor-pointer place-items-center rounded-xl border-2 border-dashed border-border bg-surface transition-all hover:border-cyan hover:bg-cyan/5 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <div v-if="uploading" class="flex flex-col items-center gap-1.5">
            <span class="h-6 w-6 rounded-full border-2 border-navy/25 border-t-cyan animate-spin" />
            <span class="text-[11px] font-bold text-text-muted">{{ uploadLabel }}</span>
          </div>
          <div v-else-if="atMediaLimit" class="flex flex-col items-center gap-1 px-2 text-center">
            <span class="w-6 h-6 text-text-muted" v-html="TRUST_ICONS.secure"></span>
            <span class="text-[11px] font-bold text-text-muted">Máximo de {{ MAX_MEDIA_PER_TYPE }} alcanzado</span>
          </div>
          <div v-else-if="!canUpload" class="flex flex-col items-center gap-1 px-2 text-center">
            <span class="w-6 h-6 text-text-muted" v-html="ICON_BED"></span>
            <span class="text-[11px] font-bold text-text-muted">Elegí una habitación arriba</span>
          </div>
          <div v-else class="flex flex-col items-center gap-1">
            <span class="text-4xl font-light leading-none text-text-muted transition-colors group-hover:text-cyan">+</span>
            <span class="text-[11px] font-bold text-text-muted transition-colors group-hover:text-navy">Agregar foto</span>
          </div>
        </button>
      </div>
    </SectionCard>

    <!-- Banner de error de upload/alt/reorder (no bloquea la UI, abajo) -->
    <div
      v-if="actionError"
      class="fixed bottom-4 right-4 z-50 max-w-sm rounded-xl bg-white border border-danger px-4 py-3 shadow-lg"
    >
      <p class="text-xs font-bold text-danger">{{ actionError }}</p>
      <button
        type="button"
        @click="actionError = ''"
        class="mt-1 text-[10px] font-bold text-text-muted hover:text-navy cursor-pointer"
      >Cerrar</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { HotelMediaService, type HotelMediaItem, type HotelMediaType } from '@/services/HotelMedia.service'
import { RoomService } from '@/services/Room.service'
import type { Room } from '@/types'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth.store'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { ICON_CAMERA, ICON_IMAGE, ICON_BED, ICON_STAR, ICON_STAR_OUTLINE, ICON_X, ICON_PENCIL, ICON_WARNING, ICON_EYE, ICON_EYE_OFF, TRUST_ICONS } from '@/components/landing/landing-icons'

const toast = useToast()
const auth = useAuthStore()

// ─── Tabs ──────────────────────────────────────────────────────────────────
type TabId = HotelMediaType
interface TabDef {
  id: TabId
  label: string
  title: string
  subtitle: string
  icon: string
  labelLower: string
  emptyMessage: string
}

const tabs: TabDef[] = [
  {
    id: 'hero',
    label: 'Portada (Hero)',
    title: 'Fotos de portada',
    subtitle: 'Aparecen en el slider principal de tu landing pública',
    icon: ICON_CAMERA,
    labelLower: 'portada',
    emptyMessage: 'Las fotos de portada van en el carrusel principal de tu landing. Subí al menos una para que la página no se vea vacía.',
  },
  {
    id: 'gallery',
    label: 'Galería',
    title: 'Galería general',
    subtitle: 'Imágenes que muestran los espacios comunes del hotel',
    icon: ICON_IMAGE,
    labelLower: 'galería',
    emptyMessage: 'Mostrá los espacios comunes: recepción, piscina, restaurante, jardines. Los huéspedes las ven en la galería de la landing.',
  },
  {
    id: 'room',
    label: 'Habitaciones',
    title: 'Fotos de habitaciones',
    subtitle: 'Asociadas a cada tipo de habitación (se agrupan en la landing)',
    icon: ICON_BED,
    labelLower: 'habitación',
    emptyMessage: 'Subí fotos de cada tipo de habitación. Se mostrarán junto al detalle de cada habitación en la landing.',
  },
]

const activeTab = ref<TabId>('hero')
const activeTabMeta = computed<TabDef>(() => tabs.find((t) => t.id === activeTab.value) ?? tabs[0])

// Espejo del tope real (backend/src/modules/hotel-media/usecases/media-crud.ts) — acá es
// SOLO para UX (avisar antes de intentar, deshabilitar el botón). El backend es la fuente
// de verdad: si este número se desincroniza, el peor caso es un 400 con mensaje claro, no
// un hueco de seguridad.
const MAX_MEDIA_PER_TYPE = 30
const atMediaLimit = computed(() => (counts.value[activeTab.value] ?? 0) >= MAX_MEDIA_PER_TYPE)

// ─── Estado del listado ────────────────────────────────────────────────────
const loading = ref(true)
const loadError = ref('')
const items = ref<HotelMediaItem[]>([])

// Conteo real por tab (antes: hardcodeado a 0 en los tabs no-activos — mostraba
// "Portada 0" aunque hubiera fotos, porque nunca se cargaban). Se pobla al montar
// (3 requests en paralelo, uno por type) y se mantiene en sync local en upload/delete
// para no tener que refetchear los 3 tabs en cada acción.
const counts = ref<Record<TabId, number>>({ hero: 0, gallery: 0, room: 0 })

function countFor(tabId: TabId): number {
  return counts.value[tabId] ?? 0
}

async function loadCounts() {
  const results = await Promise.allSettled(tabs.map((t) => HotelMediaService.list({ type: t.id })))
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') counts.value[tabs[i].id] = (r.value?.data ?? []).length
  })
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const result = await HotelMediaService.list({ type: activeTab.value })
    items.value = (result?.data ?? [])
      .slice()
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    counts.value[activeTab.value] = items.value.length
    // Inicializar drafts de alt con el valor actual.
    syncAltDrafts()
  } catch (e) {
    loadError.value = (e as Error)?.message || 'No pudimos cargar las imágenes.'
  } finally {
    loading.value = false
  }
}

// Recarga al cambiar de tab.
watch(activeTab, () => { load() })
onMounted(() => {
  load()
  loadCounts()
  loadRooms()
})

// ─── Habitaciones (tab 'room') ──────────────────────────────────────────────
// Bug real reportado por usuario ("HABITACION ta dando error"): el backend exige `roomId`
// para type=room (`ValidationError('roomId es obligatorio para type=room')`) pero el upload
// nunca lo mandaba — CUALQUIER subida en este tab fallaba siempre. Fix: selector de qué
// habitación física es la foto (se agrupan por roomId real en la landing pública, no por
// tipo de habitación — `hotel-media/controller.ts:groupRoomPhotos`).
const rooms = ref<Room[]>([])
const roomsLoadError = ref('')
const selectedRoomId = ref('')

async function loadRooms() {
  try {
    const { rooms: list } = await RoomService.list({ hotelId: auth.user?.hotelId, limit: 200 })
    rooms.value = list
  } catch (e) {
    roomsLoadError.value = (e as Error)?.message || 'No pudimos cargar las habitaciones.'
  }
}

const roomLabelById = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {}
  for (const r of rooms.value) map[r.id] = r.name ? `${r.number} · ${r.name}` : r.number
  return map
})

// El upload en 'room' necesita una habitación elegida — en otros tabs no aplica.
const canUpload = computed(() => activeTab.value !== 'room' || !!selectedRoomId.value)

// ─── Alt inline ────────────────────────────────────────────────────────────
// Un draft por item para poder editar sin disparar un request por tecla.
// Solo persiste on blur / Enter si cambió respecto del valor del item.
const altDrafts = ref<Record<string, string>>({})
// Por item: true mientras el PUT de ese nombre está en vuelo (deshabilita el botón "Guardar"
// para no disparar dos requests del mismo campo si el usuario clickea dos veces).
const savingAlt = ref<Record<string, boolean>>({})

function syncAltDrafts() {
  const next: Record<string, string> = {}
  for (const it of items.value) next[it.id] = it.alt ?? ''
  altDrafts.value = next
}

async function commitAlt(item: HotelMediaItem) {
  if (savingAlt.value[item.id]) return
  const draft = (altDrafts.value[item.id] ?? '').trim()
  if (draft === (item.alt ?? '').trim()) return
  savingAlt.value[item.id] = true
  try {
    const updated = await HotelMediaService.update(item.id, { alt: draft || null })
    // Merge local sin refetch.
    const idx = items.value.findIndex((m) => m.id === item.id)
    if (idx >= 0) items.value[idx] = { ...items.value[idx], ...updated }
    altDrafts.value[item.id] = updated.alt ?? ''
    toast.success('Nombre guardado')
  } catch (e) {
    actionError.value = (e as Error)?.message || 'No se pudo guardar el nombre de la imagen.'
    // Revertir draft al valor anterior.
    altDrafts.value[item.id] = item.alt ?? ''
  } finally {
    savingAlt.value[item.id] = false
  }
}

// ─── Reorder (flechas ↑↓) ─────────────────────────────────────────────────
const reordering = ref(false)

async function move(idx: number, delta: number) {
  const target = idx + delta
  if (target < 0 || target >= items.value.length) return
  // Swap local inmediato (UX responsive) y persistir el nuevo orden de ids.
  const next = items.value.slice()
  ;[next[idx], next[target]] = [next[target], next[idx]]
  items.value = next
  reordering.value = true
  try {
    await HotelMediaService.reorder(items.value.map((m) => m.id))
  } catch (e) {
    actionError.value = (e as Error)?.message || 'No se pudo guardar el orden. Recargá para ver el orden real.'
    // Volver al orden previo (revertir swap).
    const revert = items.value.slice()
    ;[revert[idx], revert[target]] = [revert[target], revert[idx]]
    items.value = revert
  } finally {
    reordering.value = false
  }
}

/** La foto #1 es la que la landing pública muestra grande (variant classic) / primera del
 *  carrusel. Antes solo se llegaba ahí a fuerza de ▲ repetidas veces — esto la manda al
 *  frente en un solo click. */
async function setAsPrimary(item: HotelMediaItem) {
  const idx = items.value.findIndex((m) => m.id === item.id)
  if (idx <= 0 || reordering.value) return
  const previous = items.value.slice()
  const next = items.value.slice()
  const [moved] = next.splice(idx, 1)
  next.unshift(moved)
  items.value = next
  reordering.value = true
  try {
    await HotelMediaService.reorder(items.value.map((m) => m.id))
    toast.success('Foto principal actualizada')
  } catch (e) {
    actionError.value = (e as Error)?.message || 'No se pudo marcar como principal. Recargá para ver el orden real.'
    items.value = previous
  } finally {
    reordering.value = false
  }
}

// ─── Ocultar/mostrar (Tarea 3.5, QA 2026-08-27) ────────────────────────────
// A diferencia de borrar, esto es reversible: la foto sigue en el panel (atenuada) pero
// desaparece de la landing pública/motor de reservas hasta que se vuelva a activar.
const togglingActiveId = ref<string | null>(null)

async function toggleActive(item: HotelMediaItem) {
  if (togglingActiveId.value) return
  const nextActive = item.active === false
  togglingActiveId.value = item.id
  try {
    const updated = await HotelMediaService.update(item.id, { active: nextActive })
    const idx = items.value.findIndex((m) => m.id === item.id)
    if (idx >= 0) items.value[idx] = { ...items.value[idx], ...updated }
    toast.success(nextActive ? 'Imagen visible en la landing' : 'Imagen oculta de la landing')
  } catch (e) {
    actionError.value = (e as Error)?.message || 'No se pudo cambiar la visibilidad de la imagen.'
  } finally {
    togglingActiveId.value = null
  }
}

// ─── Delete ────────────────────────────────────────────────────────────────
const removingId = ref<string | null>(null)

async function confirmRemove(item: HotelMediaItem) {
  // Confirm ligero (sin AppModal para no acoplar más): el admin puede subir de nuevo.
  // El botón es destructivo pero la acción es reversible (re-upload).
  if (!window.confirm('¿Eliminar esta imagen? La podés volver a subir cuando quieras.')) return
  removingId.value = item.id
  try {
    await HotelMediaService.remove(item.id)
    items.value = items.value.filter((m) => m.id !== item.id)
    delete altDrafts.value[item.id]
    counts.value[activeTab.value] = Math.max(0, counts.value[activeTab.value] - 1)
    toast.success('Imagen eliminada')
  } catch (e) {
    actionError.value = (e as Error)?.message || 'No se pudo eliminar la imagen.'
  } finally {
    removingId.value = null
  }
}

// ─── Upload (input file → base64 → POST) ──────────────────────────────────
const uploading = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)
// Progreso del batch actual (null = no hay upload en curso). Subida SECUENCIAL (no paralela):
// más lento con muchos archivos, pero evita pisar sortOrder si dos uploads terminan out-of-order,
// y permite mostrar "Subiendo 2 de 5" real en vez de un spinner ciego.
const uploadProgress = ref<{ current: number; total: number } | null>(null)

const uploadLabel = computed(() => {
  if (!uploading.value) return 'Subir imagen'
  const p = uploadProgress.value
  return p && p.total > 1 ? `Subiendo ${p.current} de ${p.total}…` : 'Subiendo…'
})

// El tile "+" de la grilla dispara el mismo <input type=file> oculto del botón de arriba
// (un solo input, dos entradas visuales).
function openFilePicker() {
  if (uploading.value) return
  fileInputRef.value?.click()
}

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  if (files.length === 0) return
  if (!canUpload.value) {
    actionError.value = 'Elegí una habitación antes de subir la foto.'
    if (fileInputRef.value) fileInputRef.value.value = ''
    return
  }
  uploading.value = true
  actionError.value = ''
  const failed: string[] = []
  try {
    for (let i = 0; i < files.length; i++) {
      uploadProgress.value = { current: i + 1, total: files.length }
      const file = files[i]
      try {
        const dataUrl = await readAsDataUrl(file)
        const created = await HotelMediaService.upload({
          type: activeTab.value,
          url: dataUrl,
          alt: file.name.replace(/\.[^.]+$/, '').slice(0, 80) || null,
          fileName: file.name,
          roomId: activeTab.value === 'room' ? selectedRoomId.value : undefined,
        })
        items.value = [...items.value, created as HotelMediaItem]
          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        altDrafts.value[created.id] = created.alt ?? ''
        counts.value[activeTab.value] = (counts.value[activeTab.value] ?? 0) + 1
      } catch (err) {
        failed.push(`${file.name}: ${(err as Error)?.message || 'error desconocido'}`)
      }
    }
    if (failed.length === 0) {
      toast.success(files.length > 1 ? `${files.length} imágenes subidas` : 'Imagen subida')
    } else if (failed.length < files.length) {
      toast.success(`${files.length - failed.length} de ${files.length} imágenes subidas`)
      actionError.value = `No se pudieron subir: ${failed.join(' · ')}`
    } else {
      actionError.value = `No se pudo subir ninguna imagen: ${failed.join(' · ')}`
    }
  } finally {
    uploading.value = false
    uploadProgress.value = null
    // Reset para permitir subir el MISMO archivo dos veces seguidas.
    if (fileInputRef.value) fileInputRef.value.value = ''
  }
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'))
    reader.readAsDataURL(file)
  })
}

// ─── Errores flotantes de acción (upload/alt/reorder/delete) ───────────────
const actionError = ref('')
</script>

<style scoped>
/* Aspect ratio fallback si `aspect-4/3` no está generada por Tailwind 4. */
.aspect-4\/3 { aspect-ratio: 4 / 3; }
</style>
