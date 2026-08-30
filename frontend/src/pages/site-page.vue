<template>
  <!-- pages/site-page.vue — Página pública del sitio (footer): /p/:slug.
       MISMA envolvente que la landing: SiteHeader + SiteFooter. El contenido vive en una
       CARD igual a las de la landing (bg-white, border-slate, rounded-2xl, shadow suave),
       con badge de categoría estilo hero, tipografía editorial y CTA de cierre — la landing
       siempre termina empujando el trial. El HTML lo escribe el super_admin desde
       Panel › Sitio público; draft e inexistente se ven IGUAL (404 genérico). -->
  <div class="bg-white min-h-screen">
    <SiteHeader />

    <main class="relative w-full pt-32 md:pt-40 pb-24 px-6 bg-gradient-to-b from-blue-50/60 via-white to-white overflow-hidden">
      <!-- Glows decorativos — mismos que el hero de la landing -->
      <div class="absolute top-[-10%] right-[-10%] w-[640px] h-[640px] rounded-full bg-blue-100/70 blur-3xl pointer-events-none"></div>
      <div class="absolute bottom-[-15%] left-[-10%] w-[480px] h-[480px] rounded-full bg-teal-50 blur-3xl pointer-events-none"></div>

      <div class="relative z-10 max-w-7xl mx-auto">
        <!-- Cargando -->
        <div v-if="loading" class="bg-white border border-slate-100 rounded-2xl shadow-xl shadow-slate-200/60 p-8 md:p-12 space-y-4" aria-busy="true">
          <div class="h-6 w-32 bg-slate-100 rounded-full animate-pulse" />
          <div class="h-10 w-2/3 bg-slate-200 rounded animate-pulse" />
          <div class="h-4 w-full bg-slate-100 rounded animate-pulse" />
          <div class="h-4 w-5/6 bg-slate-100 rounded animate-pulse" />
          <div class="h-4 w-4/6 bg-slate-100 rounded animate-pulse" />
        </div>

        <!-- No encontrada (draft incluido — mismo estado) -->
        <div v-else-if="error" class="bg-white border border-slate-100 rounded-2xl shadow-xl shadow-slate-200/60 p-14 text-center">
          <p class="text-5xl mb-4">📄</p>
          <h1 class="text-2xl font-black text-navy mb-2">Página no encontrada</h1>
          <p class="text-sm text-slate-500 mb-7">La página que buscas no existe o no está disponible.</p>
          <router-link to="/" class="inline-flex items-center gap-2 bg-blue text-white font-bold text-sm px-6 py-3 rounded-xl hover:bg-navy transition-all hover:-translate-y-0.5 shadow-lg shadow-blue-200">
            Ir al inicio
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3"/></svg>
          </router-link>
        </div>

        <!-- Contenido del CMS en card estilo landing — mismo ancho que el navbar (max-w-7xl). El TEXTO conserva su medida de lectura (70ch en el style): la card abraza, el párrafo respira. -->
        <template v-else-if="page">
          <article class="bg-white border border-slate-100 rounded-2xl shadow-xl shadow-slate-200/60 p-8 md:p-12" data-testid="site-page-card">
            <!-- Encabezado: badge de categoría (mismo patrón del eyebrow del hero) -->
            <div class="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-blue-50 border border-blue-100 mb-5">
              <span class="w-1.5 h-1.5 rounded-full bg-blue"></span>
              <span class="text-[11px] font-extrabold tracking-wide text-blue uppercase">{{ categoryLabel }}</span>
            </div>
            <h1 class="text-3xl md:text-4xl font-black text-navy leading-tight mb-3" data-testid="site-page-title">{{ page.title }}</h1>
            <!-- Las páginas legales ya declaran su propia fecha de vigencia en el contentHtml
                 (auditoría Meta 2026-08-26: mostrar ACÁ el updatedAt técnico —que se mueve con
                 cualquier reseed, no solo con un cambio real del texto legal— hacía que la página
                 mostrara dos fechas de "última actualización" distintas al mismo tiempo). -->
            <p v-if="page.category !== 'legal'" class="text-xs text-slate-400 mb-8 pb-7 border-b border-slate-100 flex items-center gap-1.5">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              Última actualización {{ formatDate(page.updatedAt) }}
            </p>
            <div v-else class="mb-8 pb-7 border-b border-slate-100" />


            <!-- v-html: contenido autorizado exclusivamente por el super_admin de la plataforma
                 (endpoint /api/public/site-pages/:slug solo sirve published). -->
            <div class="site-page-content" data-testid="site-page-content" v-html="page.contentHtml" />

            <!-- El texto de esta página promete el formulario "al final de esta misma página" —
                 vive acá, dentro de la misma card, en vez de en una página CMS aparte. -->
            <DataDeletionRequestForm v-if="page.slug === 'eliminacion-datos'" />
          </article>

          <!-- CTA de cierre: la landing siempre empuja el trial — la página también. -->
          <div class="mt-8 rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 to-teal-50/60 p-8 md:p-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
            <div>
              <p class="font-black text-navy text-lg mb-1">Gestiona tu hotel con SolmiOS</p>
              <p class="text-sm text-slate-500">Reservas, limpieza, canales y facturación en un solo panel. Pruébalo gratis.</p>
            </div>
            <router-link to="/registro" class="group inline-flex items-center gap-2 bg-blue text-white font-bold text-sm px-6 py-3 rounded-xl hover:bg-navy transition-all duration-300 hover:-translate-y-0.5 shadow-lg shadow-blue-200 shrink-0">
              Comenzar Gratis
              <svg class="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3"/></svg>
            </router-link>
          </div>
        </template>
      </div>
    </main>

    <SiteFooter />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import SiteHeader from '@/components/site/SiteHeader.vue'
import SiteFooter from '@/components/site/SiteFooter.vue'
import DataDeletionRequestForm from '@/components/site/DataDeletionRequestForm.vue'
import { PublicSitePages } from '@/services/SitePages.service'
import type { PublicSitePage } from '@/types/site-pages'
import { CATEGORY_LABELS } from '@/types/site-pages'

const route = useRoute()
const page = ref<PublicSitePage | null>(null)
const loading = ref(true)
const error = ref('')

const categoryLabel = computed(() => CATEGORY_LABELS[page.value?.category ?? 'soporte'] ?? 'SolmiOS')

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' }) } catch { return '' }
}

async function load(slug: string) {
  loading.value = true
  error.value = ''
  page.value = null
  document.title = 'SolmiOS'
  try {
    page.value = await PublicSitePages.bySlug(slug)
    document.title = `${page.value.title} — SolmiOS`
  } catch {
    error.value = 'not-found' // draft y inexistente: mismo estado (no filtrar existencia)
  } finally {
    loading.value = false
  }
}

watch(() => route.params.slug as string, (slug) => { if (slug) load(slug) }, { immediate: true })
</script>

<style scoped>
/* Contenido editorial dentro de la card — jerarquía con la paleta del sitio
   (navy títulos, blue acentos, slate cuerpo). El HTML viene semántico (h2/p/ul/strong):
   acá se viste; el contenido no lleva clases (portable entre entornos). */
.site-page-content :deep(h2) {
  font-size: 1.3rem;
  font-weight: 900;
  color: #0D2B4E;
  margin: 2.25rem 0 0.75rem;
  line-height: 1.3;
  padding-left: 0.9rem;
  border-left: 4px solid #1D67E3;
}
.site-page-content :deep(h2:first-child) { margin-top: 0; }
.site-page-content :deep(h3) {
  font-size: 1.05rem;
  font-weight: 800;
  color: #0D2B4E;
  margin: 1.75rem 0 0.5rem;
}
.site-page-content :deep(p) {
  color: #475569;
  line-height: 1.75;
  margin-bottom: 1rem;
  /* Card a pantalla del menú, lectura de párrafo: líneas de ~70 caracteres —
     a 1280px de card, un párrafo sin tope queda ilegible (180+ caracteres). */
  max-width: 70ch;
}
/* Listas con check circular azul (iconografía de las features de la landing) */
.site-page-content :deep(ul) {
  margin: 0 0 1.5rem;
  padding: 0;
  list-style: none;
  max-width: 70ch; /* misma medida de lectura que el párrafo */
}
.site-page-content :deep(ul li) {
  position: relative;
  color: #475569;
  line-height: 1.65;
  padding-left: 1.9rem;
  margin-bottom: 0.65rem;
}
.site-page-content :deep(ul li)::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0.15rem;
  width: 1.15rem;
  height: 1.15rem;
  border-radius: 9999px;
  background: #EFF6FF;
  border: 1px solid #BFDBFE;
}
.site-page-content :deep(ul li)::after {
  content: '';
  position: absolute;
  left: 0.34rem;
  top: 0.47rem;
  width: 0.5rem;
  height: 0.28rem;
  border-left: 2px solid #1D67E3;
  border-bottom: 2px solid #1D67E3;
  transform: rotate(-45deg);
}
.site-page-content :deep(strong) { color: #0D2B4E; font-weight: 700; }

/* Listas numeradas (pasos secuenciales, ej. eliminación de datos) — mismo círculo
   que las <ul>, con el número adentro en vez del check. */
.site-page-content :deep(ol) {
  margin: 0 0 1.5rem;
  padding: 0;
  list-style: none;
  counter-reset: step;
  max-width: 70ch;
}
.site-page-content :deep(ol li) {
  counter-increment: step;
  position: relative;
  color: #475569;
  line-height: 1.65;
  padding-left: 1.9rem;
  margin-bottom: 0.65rem;
}
.site-page-content :deep(ol li)::before {
  content: counter(step);
  position: absolute;
  left: 0;
  top: 0.075rem;
  width: 1.15rem;
  height: 1.15rem;
  border-radius: 9999px;
  background: #EFF6FF;
  border: 1px solid #BFDBFE;
  color: #1D67E3;
  font-size: 0.65rem;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}
</style>
