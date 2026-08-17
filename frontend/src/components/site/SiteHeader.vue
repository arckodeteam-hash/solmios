<template>
    <!-- ═══ NAVBAR — claro, fijo, frosted glass sutil ═══
     Compartido por todo el sitio público (landing + páginas /p/:slug): la misma
     barra en todas partes. `linkBase` prefija las anclas: '' en la landing (ancla local),
     '/' desde una página interna (viaja a la landing y scrollea). -->
    <nav
      class="fixed top-0 inset-x-0 z-50 bg-white/90 backdrop-blur-xl border-b border-slate-100 transition-shadow duration-300"
      :class="scrolled ? 'shadow-[0_1px_24px_rgba(13,43,78,0.07)]' : ''"
    >
      <div class="max-w-7xl mx-auto px-6 h-[4.5rem]">
        <div class="flex items-center justify-between h-full">
          <!-- Logo -->
          <router-link to="/" class="flex items-center gap-2.5 group">
            <div class="w-9 h-9 rounded-xl bg-navy text-white flex items-center justify-center font-black text-base shadow-sm group-hover:bg-blue transition-colors">S</div>
            <span class="font-black text-lg tracking-tight text-navy">Solmi<span class="text-blue">OS</span></span>
          </router-link>

          <!-- Links -->
          <div class="hidden xl:flex items-center gap-6">
            <a
              v-for="link in navLinks" :key="link.href" :href="linkBase + link.href"
              class="relative flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-navy transition-colors duration-200 py-1 nav-link whitespace-nowrap"
              :class="activeSection === link.section ? 'is-active' : ''"
            >{{ link.label }}
              <svg v-if="link.hasDropdown" class="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/></svg>
            </a>
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-2.5">
            <router-link
              to="/hotel-fundador"
              class="hidden md:inline-flex items-center gap-1.5 text-xs font-extrabold px-3.5 py-2 rounded-full bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100 transition-colors"
            >
              <span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
              Programa Hotel Fundador
            </router-link>
            <router-link
              to="/login"
              class="text-sm font-semibold text-slate-600 hover:text-navy transition-colors duration-200 hidden sm:inline-block"
            >Iniciar Sesión</router-link>
            <router-link
              to="/login"
              class="inline-flex items-center gap-1.5 font-bold text-sm px-5 py-2.5 rounded-xl bg-blue text-white hover:bg-navy transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg"
            >Prueba Gratis
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3"/></svg>
            </router-link>
          </div>
        </div>
      </div>
    </nav>

</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

/** Sección activa del scroll-spy — la pasa SOLO la landing (en el resto no aplica). */
const props = defineProps<{ activeSection?: string }>()

/** '' en la landing (los # van al propio documento); '/' en páginas internas del sitio. */
const linkBase = (() => {
  // Sin prop explícita: si la URL actual es la raíz, anclas locales; si no, viajan a la raíz.
  return window.location.pathname === '/' ? '' : '/'
})()

const scrolled = ref(false)
let ticking = false
function handleScroll() {
  if (ticking) return
  ticking = true
  requestAnimationFrame(() => {
    scrolled.value = window.scrollY > 12
    ticking = false
  })
}
onMounted(() => {
  window.addEventListener('scroll', handleScroll, { passive: true })
  handleScroll()
})
onUnmounted(() => window.removeEventListener('scroll', handleScroll))

const navLinks = [
  { href: '#features', label: 'Funciones', section: 'features' },
  { href: '#how', label: 'Cómo Funciona', section: 'how' },
  { href: '#integrations', label: 'Integraciones', section: 'integrations' },
  { href: '#pricing', label: 'Precios', section: 'pricing' },
  { href: '#testimonials', label: 'Testimonios', section: 'testimonials' },
  { href: '#', label: 'Recursos', section: 'recursos', hasDropdown: true },
]
</script>

<style scoped>
/* NAV active underline — mismo detalle que en la landing (de acá salió). */
.nav-link::after {
  content: '';
  position: absolute;
  left: 0; bottom: -2px;
  width: 0; height: 2px;
  background: currentColor;
  transition: width 0.3s ease;
}
.nav-link:hover::after { width: 100%; }
.nav-link.is-active::after { width: 100%; }
</style>
