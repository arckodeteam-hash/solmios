<template>
    <footer class="bg-navy-deep pt-16 pb-8 px-6 border-t border-white/5">
      <div class="max-w-7xl mx-auto">
        <div class="grid md:grid-cols-12 gap-10 mb-12">
          <!-- Brand -->
          <div class="md:col-span-4">
            <img :src="logoWhite" alt="SolmiOS" class="h-8 w-auto mb-4">

            <p class="text-sm text-white/40 max-w-xs mb-5">Hospitality OS para hoteles LATAM. Gestión completa sin complejidad.</p>
            <!-- Social icons -->
            <div class="flex items-center gap-3">
              <a href="https://www.facebook.com/solmios/" target="_blank" rel="noopener" aria-label="Facebook" class="w-9 h-9 rounded-lg bg-white/5 hover:bg-blue-600 flex items-center justify-center transition-colors">
                <svg class="w-4 h-4 text-white/70" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
              </a>
              <a href="https://www.instagram.com/solmios/" target="_blank" rel="noopener" aria-label="Instagram" class="w-9 h-9 rounded-lg bg-white/5 hover:bg-blue-600 flex items-center justify-center transition-colors">
                <svg class="w-4 h-4 text-white/70" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
              </a>
              <!-- LinkedIn: sin página oficial todavía (auditoría 2026-08-26) — ícono oculto hasta crearla. -->
              <a href="https://x.com/SolmiOSpms" target="_blank" rel="noopener" aria-label="X" class="w-9 h-9 rounded-lg bg-white/5 hover:bg-blue-600 flex items-center justify-center transition-colors">
                <svg class="w-3.5 h-3.5 text-white/70" fill="currentColor" viewBox="0 0 24 24"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg>
              </a>
            </div>
          </div>
          <!-- Link columns -->
          <div v-for="col in footerCols" :key="col.title" class="md:col-span-2">
            <h4 class="text-sm font-bold text-white mb-4">{{ col.title }}</h4>
            <div class="space-y-2.5">
              <template v-for="link in col.links" :key="link.label">
                <router-link v-if="link.to" :to="link.to"
                  class="block text-sm text-white/40 hover:text-blue-400 hover:translate-x-1 transition-all duration-200">{{ link.label }}</router-link>
                <a v-else :href="link.href"
                  class="block text-sm text-white/40 hover:text-blue-400 hover:translate-x-1 transition-all duration-200">{{ link.label }}</a>
              </template>
            </div>
          </div>
          <!-- Newsletter / CTA mini -->
          <div class="md:col-span-2">
            <h4 class="text-sm font-bold text-white mb-4">Mantente al día</h4>
            <p class="text-sm text-white/40 mb-4">Tips y novedades para tu hotel.</p>
            <div class="flex gap-2">
              <input type="email" placeholder="tu@email.com"
                class="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/30 focus:outline-none focus:border-blue-400 transition-colors">
              <button class="bg-blue-600 hover:bg-blue-500 text-white rounded-lg px-3 py-2 transition-colors shrink-0" aria-label="Suscribirse">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3"/></svg>
              </button>
            </div>
          </div>
        </div>
        <div class="border-t border-white/8 pt-8 text-center">
          <div class="text-sm text-white/30">© 2026 SolmiOS. Todos los derechos reservados.</div>
        </div>
      </div>
    </footer>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import logoWhite from '@/assets/logo/logo-horizontal-white.png'
import { PublicSitePages } from '@/services/SitePages.service'
import type { PublicSitePageSummary } from '@/types/site-pages'

// Footer compartido por todo el sitio público. Anclas de la propia landing + páginas del
// CMS del sitio (módulo site-pages, gestionadas desde Panel › Sitio público). El fetch es
// best-effort: sin CMS o sin red el footer queda con las anclas estáticas — nunca se rompe.
const sitePages = ref<PublicSitePageSummary[]>([])
onMounted(async () => {
  try { sitePages.value = await PublicSitePages.index() } catch { /* footer estático */ }
})

/** Un link del footer: ancla de la landing (`href`) o página del CMS (`to` → /p/:slug). */
type FooterLink = { label: string; href?: string; to?: string }

/** Enlaces de UNA categoría: primero las anclas propias de la landing, después las páginas
 *  del CMS (en su sortOrder). La ancla con título igual a una página se deduplica: gana la real. */
function linksFor(category: string, anchors: FooterLink[]): FooterLink[] {
  const pages = sitePages.value.filter((p) => p.category === category)
  const dynamic: FooterLink[] = pages.map((p) => ({ label: p.title, to: `/p/${p.slug}` }))
  const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const pageTitles = new Set(dynamic.map((d) => norm(d.label)))
  const anchorsKept: FooterLink[] = anchors.filter((a) => !pageTitles.has(norm(a.label)))
  return [...anchorsKept, ...dynamic]
}

// Columnas sin links no se muestran: sin CMS solo queda "Producto" (con sus anclas reales).
// Legal (Términos, Privacidad, Eliminación de datos) es una columna más, como Blog — antes
// vivían aparte en la barra inferior, apretadas junto al copyright y perdidas más abajo del
// scroll. Pedido del cliente: que se vean igual que el resto de las secciones del footer.
const footerCols = computed(() => ([
  { title: 'Producto', links: linksFor('producto', [
    { label: 'Funciones', href: '#features' }, { label: 'Precios', href: '#pricing' }, { label: 'Integraciones', href: '#integrations' },
  ]) },
  { title: 'Empresa', links: linksFor('empresa', []) },
  { title: 'Soporte', links: linksFor('soporte', []) },
  { title: 'Blog', links: linksFor('blog', []) },
  { title: 'Legal', links: linksFor('legal', []) },
]).filter((c) => c.links.length > 0))
</script>
