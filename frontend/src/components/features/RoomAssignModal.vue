<template>
  <AppModal :open="open" title="Asignar habitación" :subtitle="subtitleText" size="lg" body-class="p-0" @close="emit('close')">
    <!-- Toggle "Ver todos los tipos": por defecto sólo las del tipo vendido; con el flag el backend
         suma las de otros tipos (typeMismatch) y asignar una exige confirmar el cambio de tipo. -->
    <div class="px-5 pt-4 pb-3 border-b border-border flex flex-wrap items-center justify-between gap-3">
      <label class="flex items-center gap-2 text-sm text-navy cursor-pointer select-none">
        <input v-model="allTypes" type="checkbox" data-testid="room-assign-all-types"
          class="w-4 h-4 accent-navy cursor-pointer" :disabled="loading || assigningId !== null" />
        Ver todos los tipos
      </label>
      <span v-if="!loading && !error" class="text-xs text-text-muted" data-testid="room-assign-count">
        {{ rooms.length }} {{ rooms.length === 1 ? 'habitación libre' : 'habitaciones libres' }}
      </span>
    </div>

    <div v-if="loading" data-testid="room-assign-loading" class="flex items-center justify-center gap-2 text-sm text-text-muted py-10">
      <span class="inline-block w-3 h-3 border-2 border-text-muted border-t-transparent rounded-full animate-spin"></span>
      Buscando habitaciones libres…
    </div>

    <div v-else-if="error" data-testid="room-assign-error" class="px-5 py-8 text-center space-y-2">
      <div class="flex justify-center text-coral"><Icon name="alert" :size="28" /></div>
      <div class="text-sm font-bold text-navy">No se pudieron cargar las habitaciones</div>
      <p class="text-xs text-text-muted leading-snug">{{ error }}</p>
      <button type="button" @click="load"
        class="mt-1 px-4 py-2 text-sm font-bold rounded-full border border-border text-navy hover:bg-surface transition-colors cursor-pointer">
        Reintentar
      </button>
    </div>

    <div v-else-if="!rooms.length" data-testid="room-assign-empty" class="px-5 py-10 text-center space-y-2">
      <div class="text-sm font-bold text-navy">No hay habitaciones libres{{ allTypes ? '' : ' de este tipo' }} para esas noches</div>
      <p v-if="!allTypes" class="text-xs text-text-muted leading-snug">Probá con "Ver todos los tipos" para ofrecer un cambio de categoría.</p>
    </div>

    <ul v-else data-testid="room-assign-list" class="divide-y divide-border">
      <li v-for="room in rooms" :key="room.id" :data-testid="`room-assign-row-${room.id}`"
        class="px-5 py-3 flex items-center gap-3"
        :class="room.id === currentRoomId ? 'bg-teal/5' : room.suggested ? 'bg-gold/5' : ''">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-sm font-black text-navy">Hab. {{ room.number }}</span>
            <span v-if="room.id === currentRoomId" class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-teal/10 text-teal">Actual</span>
            <span v-else-if="room.suggested" class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-gold/10 text-gold">Sugerida</span>
            <span v-if="room.typeMismatch" class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-coral/10 text-coral">Otro tipo</span>
          </div>
          <div class="text-xs text-text-muted mt-0.5 flex flex-wrap items-center gap-x-2">
            <span v-if="room.floor !== null && room.floor !== undefined && room.floor !== ''">Piso {{ room.floor }}</span>
            <span>{{ statusLabel(room.status) }}</span>
            <span class="font-bold" :class="room.cleaningStatus === 'clean' ? 'text-teal' : 'text-coral'">
              {{ room.cleaningStatus === 'clean' ? 'Limpia' : 'Sucia' }}
            </span>
          </div>
        </div>
        <button type="button" @click="assign(room)" :disabled="room.id === currentRoomId || assigningId !== null"
          :data-testid="`room-assign-btn-${room.id}`"
          class="shrink-0 px-4 py-2 text-sm font-bold rounded-full bg-navy text-white hover:bg-navy-light transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
          {{ assigningId === room.id ? 'Asignando…' : 'Asignar' }}
        </button>
      </li>
    </ul>

    <template #footer>
      <button type="button" @click="emit('close')"
        class="px-4 py-2 text-sm font-bold rounded-full border border-border text-navy hover:bg-white transition-colors cursor-pointer">
        Cerrar
      </button>
    </template>
  </AppModal>
</template>

<script setup lang="ts">
// RoomAssignModal — elegir la unidad concreta para una reserva que vendió un TIPO (REQ-HAC-06, #261).
// Lo abren el listado (menú ⋯ → Asignar), el modal de reserva (Asignar habitación / Cambiar) y el
// planning. Carga `GET /reservas/:id/assignable-rooms` y llama `POST /reservas/:id/assign-room`; el
// 409 se traduce con `assignErrorMessage` y se recarga la lista (la habitación que chocó ya no está).
import { ref, computed, watch } from 'vue'
import AppModal from '@/components/ui/AppModal.vue'
import Icon from '@/components/ui/Icon.vue'
import { ReservationService } from '@/services/Reservation.service'
import { useToast } from '@/composables/useToast'
import { assignErrorMessage } from '@/utils/room-assign'
import type { AssignableRoom, Reservation } from '@/types'

const props = defineProps<{
  open: boolean
  reservationId: string
  /** Tipo vendido, sólo para el subtítulo. */
  roomType?: string | null
  /** Unidad ya asignada (reasignación): se resalta y no se ofrece "Asignar" sobre ella. */
  currentRoomId?: string | null
}>()

const emit = defineEmits<{
  close: []
  /** Asignación ya persistida: el host recarga su vista con la reserva devuelta. */
  assigned: [reservation: Reservation]
}>()

const toast = useToast()

const rooms = ref<AssignableRoom[]>([])
const loading = ref(false)
const error = ref('')
const allTypes = ref(false)
const assigningId = ref<string | null>(null)

const subtitleText = computed(() => props.roomType
  ? `Tipo vendido: ${props.roomType}`
  : 'La reserva no tiene tipo vendido: se listan todas las habitaciones libres')

const STATUS_LABEL: Record<string, string> = {
  available: 'Disponible',
  occupied: 'Ocupada',
  cleaning: 'En limpieza',
  maintenance: 'Mantenimiento',
  blocked: 'Bloqueada',
  out_of_order: 'Fuera de servicio',
}
function statusLabel(status: string): string {
  return STATUS_LABEL[String(status || '').toLowerCase()] ?? String(status || '—')
}

// Reset + carga al abrir (o al cambiar de reserva sin cerrar); recarga al tocar el toggle.
watch(() => [props.open, props.reservationId] as const, ([isOpen]) => {
  if (!isOpen) return
  rooms.value = []
  error.value = ''
  assigningId.value = null
  allTypes.value = false
  void load()
}, { immediate: true })

watch(allTypes, () => { if (props.open) void load() })

let loadSeq = 0
async function load() {
  if (!props.reservationId) return
  const seq = ++loadSeq
  loading.value = true
  error.value = ''
  try {
    const data = await ReservationService.assignableRooms(props.reservationId, allTypes.value)
    if (seq !== loadSeq) return   // llegó una carga más nueva (toggle rápido): ésta ya no vale
    rooms.value = data
  } catch (e: unknown) {
    if (seq !== loadSeq) return
    rooms.value = []
    error.value = e instanceof Error && e.message ? e.message : 'No se pudieron cargar las habitaciones'
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

async function assign(room: AssignableRoom) {
  if (assigningId.value || room.id === props.currentRoomId) return
  // Un upgrade/downgrade es una decisión de negocio, no un efecto de elegir mal: se confirma.
  let allowTypeChange = false
  if (room.typeMismatch) {
    if (!window.confirm('La habitación es de otro tipo. ¿Asignar igual?')) return
    allowTypeChange = true
  }
  assigningId.value = room.id
  try {
    const res = await ReservationService.assignRoom(props.reservationId, room.id, allowTypeChange)
    toast.success(`Habitación ${room.number} asignada`)
    emit('assigned', res)
    emit('close')
  } catch (e: unknown) {
    toast.error(assignErrorMessage(e))
    // La lista que se veía ya no es cierta (alguien la ocupó / la bloquearon): se vuelve a pedir.
    void load()
  } finally {
    assigningId.value = null
  }
}
</script>
