<template>
  <Teleport to="body">
    <Transition name="app-popover">
      <div v-if="open" class="fixed inset-0 z-[60]">
        <!-- Capa que bloquea el resto: un clic afuera cierra, y mientras está abierto no se puede
             arrastrar la grilla sin querer. Tenue a propósito — el menú se ancla a lo que acabás
             de marcar, y oscurecer la pantalla sería taparlo justo a él. -->
        <div class="absolute inset-0 bg-navy/20" @mousedown.stop.prevent="closeOnBackdrop && emit('close')"></div>
        <div ref="panel" role="dialog" :aria-label="ariaLabel"
          class="app-popover-panel absolute rounded-2xl border-2 border-navy bg-white shadow-2xl overflow-hidden"
          :style="panelStyle" @mousedown.stop>
          <div class="max-h-full overflow-y-auto"><slot /></div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * Menú anclado a algo que el usuario acaba de señalar (una celda de la grilla, una fila).
 *
 * Existe como componente y no como un `<Teleport>` suelto en la vista porque el menú del planning
 * ya se escribió así una vez y salió mal: sin acotar a la pantalla se salía por abajo en las
 * últimas filas, y posicionado en las coordenadas del click tapaba justo el tramo elegido. Acá
 * viven, una sola vez, el anclaje, el volteo contra los bordes, el ESC, la pila de modales y el
 * bloqueo del fondo. La cuenta de posición vive aparte, en `utils/popover-position.ts`, probada.
 *
 * Mientras está abierto la página NO scrollea (`pushModal` bloquea el body): el menú se posiciona
 * una vez contra las coordenadas de pantalla del ancla, así que si el fondo se corre, el menú
 * queda señalando otra cosa. Y si algo igual se mueve (un contenedor con scroll propio), el menú
 * se vuelve a acomodar en vez de quedar colgado.
 *
 * Para un formulario o un detalle largo el componente correcto sigue siendo `AppModal`: esto es
 * para menús cortos, que entran sin scrollear.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { pushModal, popModal } from '@/composables/useModalStack'
import { placePopover, type Rect } from '@/utils/popover-position'

const props = withDefaults(defineProps<{
  open?: boolean
  /** Rectángulo de lo señalado, en coordenadas de viewport. `null` → el menú va al centro. */
  anchor?: Rect | null
  /** Ancho fijo en px: un menú que cambia de ancho según el texto se lee como un error. */
  width?: number
  closeOnBackdrop?: boolean
  ariaLabel?: string
}>(), { open: false, anchor: null, width: 268, closeOnBackdrop: true, ariaLabel: 'Acciones' })

const emit = defineEmits<{ close: [] }>()

const panel = ref<HTMLElement | null>(null)
const pos = ref<{ left: number; top: number } | null>(null)

const panelStyle = computed(() => ({
  width: `${props.width}px`,
  maxHeight: `calc(100vh - 16px)`,
  left: `${pos.value?.left ?? 0}px`,
  top: `${pos.value?.top ?? 0}px`,
  // Hasta medir el panel no sabemos dónde va; mostrarlo antes lo haría aparecer en 0,0 y saltar.
  visibility: pos.value ? 'visible' : 'hidden',
}) as Record<string, string>)

async function reposition(): Promise<void> {
  if (!props.open) { pos.value = null; return }
  await nextTick()
  const el = panel.value
  if (!el) return
  pos.value = placePopover({
    anchor: props.anchor,
    size: { width: el.offsetWidth, height: el.offsetHeight },
    viewport: { width: window.innerWidth, height: window.innerHeight },
  })
}

/** El contenido cambia de alto sin cerrar el menú (una sección que se despliega): hay que volver
 *  a acotarlo o crece hacia afuera de la pantalla. */
let ro: ResizeObserver | null = null
function observe(): void {
  if (typeof ResizeObserver === 'undefined' || !panel.value) return
  ro = new ResizeObserver(() => { void reposition() })
  ro.observe(panel.value)
}
function unobserve(): void { ro?.disconnect(); ro = null }

function onKeydown(e: KeyboardEvent): void { if (e.key === 'Escape') emit('close') }
function onViewportChange(): void { void reposition() }

function teardown(): void {
  if (typeof document === 'undefined') return
  unobserve()
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', onViewportChange)
  window.removeEventListener('scroll', onViewportChange, true)
}

watch(() => props.open, async (isOpen, wasOpen) => {
  if (typeof document === 'undefined') return
  if (isOpen) {
    if (!wasOpen) pushModal()
    document.addEventListener('keydown', onKeydown)
    window.addEventListener('resize', onViewportChange)
    // Captura: alcanza cualquier contenedor con scroll propio, no solo la ventana.
    window.addEventListener('scroll', onViewportChange, true)
    await reposition()
    observe()
  } else {
    if (wasOpen) popModal()
    teardown()
    pos.value = null
  }
}, { immediate: true })

// Cambiar de celda con el menú abierto lo mueve al ancla nueva.
watch(() => props.anchor, () => { void reposition() })

onBeforeUnmount(() => { if (props.open) popModal(); teardown() })
</script>

<style scoped>
.app-popover-enter-active, .app-popover-leave-active { transition: opacity 0.12s ease; }
.app-popover-enter-from, .app-popover-leave-to { opacity: 0; }
.app-popover-enter-active .app-popover-panel { transition: transform 0.14s cubic-bezier(0.16, 1, 0.3, 1); }
.app-popover-enter-from .app-popover-panel { transform: scale(0.97); }
</style>
