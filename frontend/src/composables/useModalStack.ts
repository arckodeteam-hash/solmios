// composables/useModalStack.ts — cuántas capas modales hay abiertas ahora mismo, compartido entre
// TODAS las instancias (module-level, no por-componente). #643: FeedbackToolbar.vue lo usa para
// esconderse mientras haya un modal abierto — a 375px el widget flotante (fixed bottom-right,
// z-[9999]) tapaba el botón "Guardar" del footer de AppModal (z-50, pero dentro de su propio
// stacking context: el z-index más alto del widget igual gana visualmente en esa esquina).
//
// Acá vive también el BLOQUEO DEL SCROLL de la página, y por eso es uno solo para todas las capas:
// cada componente manejaba el suyo, y con un menú anclado que se cierra en el mismo tick en que se
// abre un modal (Cerradura, en el planning) el orden de los watchers decidía si el `overflow` del
// body quedaba bloqueado o suelto. Con un contador único, el scroll se bloquea mientras haya al
// menos una capa abierta y se libera cuando no queda ninguna — sin importar el orden.
//
// Para un menú anclado el bloqueo no es un detalle estético: el menú se posiciona una vez contra
// las coordenadas de pantalla de la celda; si la página se mueve debajo, el menú queda señalando
// otra cosa.
import { ref } from 'vue'

export const openModalCount = ref(0)

function syncBodyScroll(): void {
  if (typeof document === 'undefined') return
  document.body.style.overflow = openModalCount.value > 0 ? 'hidden' : ''
}

export function pushModal(): void {
  openModalCount.value++
  syncBodyScroll()
}

export function popModal(): void {
  openModalCount.value = Math.max(0, openModalCount.value - 1)
  syncBodyScroll()
}
