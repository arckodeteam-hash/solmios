<template>
  <Teleport to="body">
    <Transition name="app-modal">
      <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-navy/50 backdrop-blur-sm" @click="closeOnBackdrop && emit('close')"></div>
        <div class="app-modal-panel relative flex flex-col w-full max-h-[92vh] overflow-hidden rounded-[20px] border-2 border-navy bg-white shadow-2xl"
          :class="sizeClass">
          <!-- Header oscuro (mismo look en todo el sistema) -->
          <div v-if="title || $slots.header" class="shrink-0 flex items-center justify-between gap-3 bg-navy px-5 py-4">
            <slot name="header">
              <div class="min-w-0">
                <h3 class="text-base sm:text-lg font-black text-white truncate">{{ title }}</h3>
                <p v-if="subtitle" class="text-[11px] text-white/60 mt-0.5 truncate">{{ subtitle }}</p>
              </div>
            </slot>
            <button v-if="closable" @click="emit('close')" aria-label="Cerrar"
              class="shrink-0 w-8 h-8 grid place-items-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-colors cursor-pointer">✕</button>
          </div>

          <!-- Cuerpo -->
          <div class="flex-1 overflow-y-auto" :class="bodyClass">
            <slot />
          </div>

          <!-- Footer (acciones). flex-wrap: footers con contenido extra a la izquierda (ej.
               total + botones en ReservationModal) se recortaban en mobile angosto (390px)
               en vez de bajar de línea. -->
          <div v-if="$slots.footer" class="shrink-0 flex items-center justify-end flex-wrap gap-3 border-t-2 border-navy bg-surface px-5 py-4">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, watch, onBeforeUnmount } from 'vue'
import { pushModal, popModal } from '@/composables/useModalStack'

const props = withDefaults(defineProps<{
  open?: boolean
  title?: string
  subtitle?: string
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl'
  closable?: boolean
  closeOnBackdrop?: boolean
  /** Padding del cuerpo. Pasar 'p-0' cuando el contenido es una tabla full-bleed. */
  bodyClass?: string
}>(), { open: true, size: 'md', closable: true, closeOnBackdrop: true, bodyClass: 'p-5' })

const emit = defineEmits<{ close: [] }>()

// '2xl' agregado para ReservationModal.vue (two-panel, necesita más ancho que xl/max-w-5xl).
// '3xl' (max-w-7xl) agregado para el modal de reserva del planning con códigos de cerradura (#622).
const SIZES: Record<string, string> = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl', xl: 'max-w-5xl', '2xl': 'max-w-6xl', '3xl': 'max-w-7xl' }
const sizeClass = computed(() => SIZES[props.size] || SIZES.md)

// Pila de modales abiertos (módulo, compartida entre instancias): con modales apilados (uno abre otro
// encima, ej. detalle de OC → recibir mercancía), un solo listener global de Escape cerraba AMBOS a la
// vez (QA-MEDIO). Solo el modal en el TOPE de la pila reacciona a Escape. El bloqueo del scroll NO
// vive acá: lo lleva `useModalStack` por contador, compartido con las otras capas (menús anclados),
// porque manejando cada uno el suyo el orden de los watchers decidía si el body quedaba bloqueado.
const modalStack: symbol[] = []
const instanceId = Symbol('app-modal')
const isTop = (): boolean => modalStack[modalStack.length - 1] === instanceId

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.closable && isTop()) emit('close')
}
function popStack() {
  const idx = modalStack.indexOf(instanceId)
  if (idx === -1) return   // ya se sacó (evita popModal() de más si popStack corre dos veces)
  modalStack.splice(idx, 1)
  popModal()
  document.removeEventListener('keydown', onKeydown)
}
watch(() => props.open, (isOpen) => {
  if (typeof document === 'undefined') return
  if (isOpen) {
    if (!modalStack.includes(instanceId)) { modalStack.push(instanceId); pushModal() }
    document.addEventListener('keydown', onKeydown)
  } else {
    popStack()
  }
}, { immediate: true })
onBeforeUnmount(() => {
  if (typeof document === 'undefined') return
  popStack()
})
</script>

<style scoped>
.app-modal-enter-active, .app-modal-leave-active { transition: opacity 0.2s ease; }
.app-modal-enter-from, .app-modal-leave-to { opacity: 0; }
.app-modal-enter-active .app-modal-panel, .app-modal-leave-active .app-modal-panel {
  transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
}
.app-modal-enter-from .app-modal-panel, .app-modal-leave-to .app-modal-panel {
  opacity: 0; transform: scale(0.96) translateY(12px);
}
</style>
