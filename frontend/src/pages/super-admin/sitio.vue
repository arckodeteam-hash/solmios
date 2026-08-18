<template>
  <div>
    <!-- Header -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-black text-navy">Sitio público</h1>
        <p class="text-sm text-text-secondary mt-1">
          Páginas de solmios.com (footer): contenido, publicación y orden. Los cambios publicados
          los lee el sitio vía API.
        </p>
      </div>
      <button
        class="bg-cyan text-white font-bold text-sm px-4 py-2.5 rounded-lg hover:shadow-lg transition-all cursor-pointer flex items-center gap-2"
        @click="openCreate"
      >
        <span class="text-lg leading-none">+</span> Nueva página
      </button>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      <div v-for="i in 4" :key="i" class="h-36 bg-white rounded-2xl border border-border card-shadow animate-pulse" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="bg-white rounded-2xl border border-border card-shadow p-8 text-center">
      <p class="text-danger font-bold mb-2">No se pudieron cargar las páginas</p>
      <p class="text-sm text-text-secondary mb-4">{{ error }}</p>
      <button class="text-sm font-bold text-cyan cursor-pointer hover:underline" @click="load">Reintentar</button>
    </div>

    <!-- Vacío -->
    <div v-else-if="pages.length === 0" class="bg-white rounded-2xl border border-border card-shadow p-10 text-center">
      <div class="text-4xl mb-3">📄</div>
      <p class="font-bold text-navy mb-1">Sin páginas todavía</p>
      <p class="text-sm text-text-secondary mb-4">Creá la primera página del sitio (ej: privacidad, sobre-nosotros).</p>
      <button class="bg-cyan text-white font-bold text-sm px-4 py-2 rounded-lg cursor-pointer" @click="openCreate">Crear página</button>
    </div>

    <!-- Grid de páginas -->
    <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      <div
        v-for="page in pages"
        :key="page.id"
        class="bg-white rounded-2xl border border-border card-shadow p-5 flex flex-col hover:border-cyan/40 transition-colors"
      >
        <div class="flex items-start justify-between gap-2 mb-2">
          <h3 class="font-black text-navy leading-tight">{{ page.title }}</h3>
          <span
            class="flex-shrink-0 text-[10px] font-black uppercase px-2 py-1 rounded-full"
            :class="page.status === 'published' ? 'bg-teal/10 text-teal' : 'bg-amber/10 text-amber'"
          >
            {{ page.status === 'published' ? 'Publicada' : 'Borrador' }}
          </span>
        </div>
        <p class="text-xs text-text-muted font-mono mb-1">/{{ page.slug }}</p>
        <p class="text-xs text-text-muted mb-3">{{ categoryLabel(page.category) }} · orden {{ page.sortOrder }}</p>
        <p class="text-xs text-text-muted mb-4">Actualizada {{ formatDate(page.updatedAt) }}</p>

        <div class="mt-auto flex items-center gap-2 pt-3 border-t border-border">
          <button
            class="flex-1 text-xs font-bold px-3 py-2 rounded-lg bg-navy text-white hover:opacity-90 transition-opacity cursor-pointer"
            @click="openEdit(page)"
          >
            Editar
          </button>
          <button
            v-if="page.status === 'published'"
            class="text-xs font-bold px-3 py-2 rounded-lg bg-amber/10 text-amber hover:bg-amber/20 transition-colors cursor-pointer"
            title="Pasar a borrador (deja de verse en el sitio)"
            @click="toggleStatus(page)"
          >
            Despublicar
          </button>
          <button
            v-else
            class="text-xs font-bold px-3 py-2 rounded-lg bg-teal/10 text-teal hover:bg-teal/20 transition-colors cursor-pointer"
            title="Publicar en el sitio"
            @click="toggleStatus(page)"
          >
            Publicar
          </button>
          <button
            class="text-xs font-bold px-3 py-2 rounded-lg bg-coral/10 text-coral hover:bg-coral/20 transition-colors cursor-pointer"
            title="Eliminar página"
            @click="removePage(page)"
          >
            ✕
          </button>
        </div>
      </div>
    </div>

    <!-- Editor modal -->
    <div
      v-if="editorOpen"
      class="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-y-auto p-4"
      @click.self="closeEditor"
    >
      <div class="bg-white rounded-2xl w-full max-w-3xl my-8 shadow-2xl">
        <div class="flex items-center justify-between px-6 py-4 bg-navy rounded-t-2xl">
          <h2 class="text-sm font-black text-white">{{ editingId ? 'Editar página' : 'Nueva página' }}</h2>
          <button class="text-white/70 hover:text-white text-xl leading-none cursor-pointer" @click="closeEditor">✕</button>
        </div>

        <div class="p-6 space-y-4">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-bold text-text-secondary mb-1">Título *</label>
              <input
                v-model="form.title"
                type="text"
                class="w-full h-10 px-3 rounded-lg border border-border text-sm focus:outline-none focus:border-cyan focus:ring-2 focus:ring-cyan/20 bg-surface"
                placeholder="Política de Privacidad"
                maxlength="160"
              />
            </div>
            <div>
              <label class="block text-xs font-bold text-text-secondary mb-1">Slug (URL) *</label>
              <div class="flex items-center gap-2">
                <span class="text-text-muted text-sm font-mono">/</span>
                <input
                  v-model="form.slug"
                  type="text"
                  class="flex-1 h-10 px-3 rounded-lg border border-border text-sm font-mono focus:outline-none focus:border-cyan focus:ring-2 focus:ring-cyan/20 bg-surface"
                  placeholder="privacidad"
                  maxlength="80"
                />
              </div>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label class="block text-xs font-bold text-text-secondary mb-1">Categoría</label>
              <select
                v-model="form.category"
                class="w-full h-10 px-3 rounded-lg border border-border text-sm bg-surface focus:outline-none focus:border-cyan cursor-pointer"
              >
                <option v-for="c in SITE_PAGE_CATEGORIES" :key="c" :value="c">{{ categoryLabel(c) }}</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-bold text-text-secondary mb-1">Estado</label>
              <select
                v-model="form.status"
                class="w-full h-10 px-3 rounded-lg border border-border text-sm bg-surface focus:outline-none focus:border-cyan cursor-pointer"
              >
                <option value="draft">Borrador</option>
                <option value="published">Publicada</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-bold text-text-secondary mb-1">Orden</label>
              <input
                v-model.number="form.sortOrder"
                type="number"
                min="0"
                class="w-full h-10 px-3 rounded-lg border border-border text-sm bg-surface focus:outline-none focus:border-cyan"
              />
            </div>
          </div>

          <div>
            <label class="block text-xs font-bold text-text-secondary mb-1">Meta descripción (SEO, máx. 320)</label>
            <input
              v-model="form.metaDescription"
              type="text"
              class="w-full h-10 px-3 rounded-lg border border-border text-sm bg-surface focus:outline-none focus:border-cyan"
              placeholder="Qué datos recoge la app y cómo ejercer tus derechos"
              maxlength="320"
            />
          </div>

          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="block text-xs font-bold text-text-secondary">Contenido</label>
              <div class="flex items-center gap-3">
                <button
                  class="text-xs font-bold cursor-pointer hover:underline"
                  :class="rawMode ? 'text-navy font-black' : 'text-text-muted'"
                  :title="rawMode ? 'Estás en el editor de HTML crudo' : 'Cambiar al editor de HTML (avanzado)'"
                  @click="rawMode = !rawMode; previewMode = false"
                >
                  &lt;/&gt; HTML
                </button>
                <button
                  class="text-xs font-bold cursor-pointer hover:underline"
                  :class="previewMode ? 'text-coral' : 'text-cyan'"
                  @click="previewMode = !previewMode; if (previewMode) rawMode = false"
                >
                  {{ previewMode ? '✕ Volver al editor' : '👁 Previsualizar' }}
                </button>
              </div>
            </div>

            <!-- Editor visual: para quien no sabe (ni quiere saber) HTML. Quill produce el
                 h2/h3/p/ul/strong que el CSS del sitio ya estila — no depende de <section>,
                 así que las páginas legadas se pueden editar sin romper el estilo. -->
            <QuillEditor
              v-if="!previewMode && !rawMode"
              v-model:content="form.contentHtml"
              content-type="html"
              :toolbar="QUILL_TOOLBAR"
              placeholder="Escribí el contenido de la página…"
              class="site-editor bg-white rounded-lg border border-border overflow-hidden"
            />
            <!-- HTML crudo: camino avanzado para tocar el markup a mano. -->
            <textarea
              v-else-if="!previewMode && rawMode"
              v-model="form.contentHtml"
              rows="12"
              class="w-full px-3 py-2 rounded-lg border border-border text-xs font-mono bg-surface focus:outline-none focus:border-cyan leading-relaxed"
              placeholder="<h2>Sección</h2><p>Contenido…</p>"
            />
            <div
              v-else
              class="w-full min-h-[16rem] px-4 py-3 rounded-lg border border-border bg-surface prose prose-sm max-w-none overflow-auto"
              v-html="form.contentHtml"
            />
            <p class="text-[11px] text-text-muted mt-1">
              Editá visualmente; el botón &lt;/&gt; HTML queda para el marcado a mano (avanzado).
              Encabezados y listas toman el estilo del sitio solos.
            </p>
          </div>

          <p v-if="editorError" class="text-sm text-danger font-bold">{{ editorError }}</p>
        </div>

        <div class="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          <button
            class="text-sm font-bold text-text-secondary px-4 py-2 rounded-lg hover:bg-surface transition-colors cursor-pointer"
            @click="closeEditor"
          >
            Cancelar
          </button>
          <button
            class="bg-cyan text-white font-bold text-sm px-5 py-2 rounded-lg hover:shadow-lg transition-all cursor-pointer disabled:opacity-50"
            :disabled="saving"
            @click="save"
          >
            {{ saving ? 'Guardando…' : 'Guardar' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const QUILL_TOOLBAR = [
  [{ header: [2, 3, false] }],
  ['bold', 'italic'],
  [{ list: 'ordered' }, { list: 'bullet' }],
  ['link'],
  ['clean'],
]
import { onMounted, reactive, ref } from 'vue'
import { QuillEditor } from '@vueup/vue-quill'
import '@vueup/vue-quill/dist/vue-quill.snow.css'
import { SitePagesService } from '@/services/SitePages.service'
import { ApiError } from '@/services/http'
import {
  SITE_PAGE_CATEGORIES,
  CATEGORY_LABELS,
  type SitePage,
  type SitePageCategory,
  type SitePageStatus,
} from '@/types/site-pages'

const pages = ref<SitePage[]>([])
const loading = ref(true)
const error = ref('')

const editorOpen = ref(false)
// Editor visual por defecto; el HTML crudo es el camino avanzado.
const rawMode = ref(false)
const previewMode = ref(false)
const saving = ref(false)
const editorError = ref('')
const editingId = ref<string | null>(null)

const form = reactive({
  title: '',
  slug: '',
  category: 'soporte' as SitePageCategory,
  status: 'draft' as SitePageStatus,
  sortOrder: 0,
  metaDescription: '',
  contentHtml: '',
})

function categoryLabel(c: SitePageCategory): string {
  return CATEGORY_LABELS[c] ?? c
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await SitePagesService.list()
    pages.value = res.data
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Error desconocido'
  } finally {
    loading.value = false
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function openCreate() {
  editingId.value = null
  editorError.value = ''
  previewMode.value = false
  Object.assign(form, {
    title: '',
    slug: '',
    category: 'soporte',
    status: 'draft',
    sortOrder: (pages.value.length + 1) * 10,
    metaDescription: '',
    contentHtml: '',
  })
  editorOpen.value = true
}

function openEdit(page: SitePage) {
  editingId.value = page.id
  editorError.value = ''
  previewMode.value = false
  Object.assign(form, {
    title: page.title,
    slug: page.slug,
    category: page.category,
    status: page.status,
    sortOrder: page.sortOrder,
    metaDescription: page.metaDescription ?? '',
    contentHtml: page.contentHtml ?? '',
  })
  editorOpen.value = true
}

function closeEditor() {
  editorOpen.value = false
}

async function save() {
  editorError.value = ''
  if (form.title.trim().length < 2) {
    editorError.value = 'El título necesita al menos 2 caracteres'
    return
  }
  // Al crear, si no tocaron el slug lo derivamos del título (editable igual).
  const slug = form.slug.trim() || slugify(form.title)
  if (!slug) {
    editorError.value = 'Definí un slug (solo minúsculas, números y guiones)'
    return
  }
  saving.value = true
  try {
    const payload = {
      slug,
      title: form.title.trim(),
      category: form.category,
      status: form.status,
      sortOrder: form.sortOrder || 0,
      metaDescription: form.metaDescription.trim() || undefined,
      contentHtml: form.contentHtml,
    }
    if (editingId.value) {
      await SitePagesService.update(editingId.value, payload)
    } else {
      await SitePagesService.create(payload)
    }
    editorOpen.value = false
    await load()
  } catch (e) {
    editorError.value = e instanceof ApiError ? e.message : 'No se pudo guardar. Verificá los campos.'
  } finally {
    saving.value = false
  }
}

async function toggleStatus(page: SitePage) {
  const next = page.status === 'published' ? 'draft' : 'published'
  try {
    await SitePagesService.update(page.id, { status: next })
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo cambiar el estado'
  }
}

async function removePage(page: SitePage) {
  // Confirm nativo: acción destructiva sin undo en el panel.
  const ok = window.confirm(`¿Eliminar "${page.title}" (/${page.slug})? Esta acción no se puede deshacer.`)
  if (!ok) return
  try {
    await SitePagesService.remove(page.id)
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo eliminar'
  }
}

onMounted(load)
</script>

<style scoped>
.prose h2 {
  font-size: 1.05rem;
  font-weight: 800;
  color: var(--color-navy, #0d2b4e);
  margin: 1rem 0 0.5rem;
}
.prose h3 {
  font-weight: 700;
  margin: 0.75rem 0 0.25rem;
}
.prose p {
  margin: 0.5rem 0;
}

/* Cuerpo del editor visual: la altura default de Quill es de UNA línea — quedaba chato
   contra la preview (16rem). Mismo mínimo que la preview, tope con scroll para que una
   página larga no haga el modal infinito. La toolbar es hermana del editor en el DOM de
   Quill, así que queda fija arriba mientras el cuerpo scrollea. */
.site-editor :deep(.ql-editor) {
  min-height: 16rem;
  max-height: 28rem;
  overflow-y: auto;
  font-size: 0.9rem;
}
.site-editor :deep(.ql-toolbar) {
  border-bottom: 1px solid var(--color-border, #E2E8F0);
}
</style>
