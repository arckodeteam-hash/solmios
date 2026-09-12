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

    <ul v-else data-testid="room-assign-list" class="divide-y divide-border" :role="isCheckin ? 'radiogroup' : undefined">
      <li v-for="room in rooms" :key="room.id" :data-testid="`room-assign-row-${room.id}`"
        class="px-5 py-3 flex items-center gap-3"
        :class="[
          room.id === currentRoomId ? 'bg-teal/5' : room.suggested ? 'bg-gold/5' : '',
          isCheckin && isSelectable(room) ? 'cursor-pointer hover:bg-surface' : '',
          isCheckin && selectedId === room.id ? 'ring-2 ring-inset ring-teal bg-teal/5' : '',
          isCheckin && !isSelectable(room) ? 'opacity-60 cursor-not-allowed' : '',
        ]"
        :aria-disabled="isCheckin && !isSelectable(room) ? 'true' : undefined"
        @click="isCheckin && select(room)">
        <!-- Modo check-in: la fila se elige (radio) y se confirma una sola vez en el footer. -->
        <span v-if="isCheckin" class="shrink-0 flex items-center">
          <input type="radio" name="room-assign-select" :value="room.id" :checked="selectedId === room.id"
            :disabled="!isSelectable(room) || assigningId !== null" :aria-checked="selectedId === room.id ? 'true' : 'false'"
            :data-testid="`room-assign-select-${room.id}`" class="w-4 h-4 accent-teal cursor-pointer disabled:cursor-not-allowed"
            @click.stop="select(room)" />
        </span>
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
          <div v-if="isCheckin && isOccupied(room)" data-testid="room-assign-disabled-reason" class="text-[11px] font-bold text-coral mt-0.5">
            Ocupada: todavía no hizo check-out
          </div>
        </div>
        <button v-if="!isCheckin" type="button" @click="assign(room)" :disabled="room.id === currentRoomId || assigningId !== null"
          :data-testid="`room-assign-btn-${room.id}`"
          class="shrink-0 px-4 py-2 text-sm font-bold rounded-full bg-navy text-white hover:bg-navy-light transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
          {{ assigningId === room.id ? 'Asignando…' : 'Asignar' }}
        </button>
      </li>
    </ul>

    <template #footer>
      <template v-if="isCheckin">
        <button type="button" @click="emit('close')" :disabled="assigningId !== null"
          class="px-4 py-2 text-sm font-bold rounded-full border border-border text-navy hover:bg-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
          Cancelar
        </button>
        <button type="button" @click="checkinWithSelected" :disabled="!selectedRoom || assigningId !== null"
          data-testid="room-assign-checkin-btn"
          class="px-4 py-2 text-sm font-bold rounded-full bg-teal text-white hover:bg-teal-light transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
          {{ assigningId !== null ? 'Procesando…' : 'Asignar y hacer check-in' }}
        </button>
      </template>
      <button v-else type="button" @click="emit('close')"
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
//
// Modo `checkin` (REQ-HAC-04, #259): la reserva llegó sin unidad y el check-in la exige. Las filas
// se ELIGEN (sugerida preseleccionada) y un solo `POST /reservas/:id/checkin { roomId }` asigna y
// hace el check-in en el mismo request. Una habitación `occupied` puede aparecer en la lista (su
// estadía sale hoy y no solapa) pero no se puede entrar hasta su check-out: va deshabilitada.
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
  /** `assign` (default): un botón "Asignar" por fila. `checkin`: elegir + "Asignar y hacer check-in". */
  mode?: 'assign' | 'checkin'
}>()

const emit = defineEmits<{
  close: []
  /** Asignación ya persistida: el host recarga su vista con la reserva devuelta. */
  assigned: [reservation: Reservation]
  /** Modo `checkin`: habitación asignada Y check-in hecho en el mismo request. */
  'checked-in': [payload: { roomId: string; roomNumber: string; folioId: string; guestId: string }]
}>()

const toast = useToast()

const rooms = ref<AssignableRoom[]>([])
const loading = ref(false)
const error = ref('')
const allTypes = ref(false)
const assigningId = ref<string | null>(null)
const selectedId = ref<string | null>(null)

const isCheckin = computed(() => props.mode === 'checkin')

const subtitleText = computed(() => {
  const sold = props.roomType
    ? `Tipo vendido: ${props.roomType}`
    : 'La reserva no tiene tipo vendido: se listan todas las habitaciones libres'
  return isCheckin.value ? `Check-in: elegí dónde duerme · ${sold}` : sold
})

function isOccupied(room: AssignableRoom): boolean {
  return String(room.status || '').toLowerCase() === 'occupied'
}
/** En check-in no se entra a una ocupada (sale hoy pero todavía no hizo check-out). */
function isSelectable(room: AssignableRoom): boolean {
  return !isOccupied(room)
}
const selectedRoom = computed(() => rooms.value.find(r => r.id === selectedId.value && isSelectable(r)) ?? null)

function select(room: AssignableRoom) {
  if (!isCheckin.value || !isSelectable(room) || assigningId.value) return
  selectedId.value = room.id
}

/** Tras cada carga en modo check-in: si no hay selección válida, la sugerida (o la primera habilitada). */
function ensureSelection() {
  if (!isCheckin.value) return
  if (selectedId.value && rooms.value.some(r => r.id === selectedId.value && isSelectable(r))) return
  const candidates = rooms.value.filter(isSelectable)
  selectedId.value = (candidates.find(r => r.suggested) ?? candidates[0])?.id ?? null
}

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
  selectedId.value = null
  allTypes.value = false
  void load()
}, { immediate: true })

watch(allTypes, () => { if (props.open) void load() })

let loadSeq = 0
let assignSeq = 0
async function load() {
  if (!props.reservationId) return
  const seq = ++loadSeq
  loading.value = true
  error.value = ''
  try {
    const data = await ReservationService.assignableRooms(props.reservationId, allTypes.value)
    if (seq !== loadSeq) return   // llegó una carga más nueva (toggle rápido): ésta ya no vale
    rooms.value = data
    ensureSelection()
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
  // El host reutiliza la misma instancia cambiando `reservationId` entre filas: una respuesta que
  // llega cuando el modal ya muestra OTRA reserva no puede emitir ni tocar el estado de ésta.
  const seq = ++assignSeq
  const reservationId = props.reservationId
  assigningId.value = room.id
  try {
    const res = await ReservationService.assignRoom(reservationId, room.id, allowTypeChange)
    if (seq !== assignSeq || reservationId !== props.reservationId) return
    toast.success(`Habitación ${room.number} asignada`)
    emit('assigned', res)
    emit('close')
  } catch (e: unknown) {
    if (seq !== assignSeq || reservationId !== props.reservationId) return
    toast.error(assignErrorMessage(e))
    // La lista que se veía ya no es cierta (alguien la ocupó / la bloquearon): se vuelve a pedir.
    void load()
  } finally {
    if (seq === assignSeq) assigningId.value = null
  }
}

/** Modo check-in: UN request asigna la elegida y hace el check-in (REQ-HAC-04). */
async function checkinWithSelected() {
  const room = selectedRoom.value
  if (!room || assigningId.value) return
  // "Ver todos los tipos" ya fue una decisión explícita, pero el cambio de categoría se confirma
  // igual que en assign(): es negocio, no un efecto de elegir mal.
  let allowTypeChange = false
  if (room.typeMismatch) {
    if (!window.confirm('La habitación es de otro tipo. ¿Asignar y hacer check-in igual?')) return
    allowTypeChange = true
  }
  const seq = ++assignSeq
  const reservationId = props.reservationId
  assigningId.value = room.id
  try {
    const res = await ReservationService.checkin(reservationId, { roomId: room.id, allowTypeChange })
    if (seq !== assignSeq || reservationId !== props.reservationId) return
    toast.success('Check-in confirmado', `Hab ${room.number}`)
    emit('checked-in', { roomId: room.id, roomNumber: room.number, folioId: res.folioId, guestId: res.guestId })
    emit('close')
  } catch (e: unknown) {
    if (seq !== assignSeq || reservationId !== props.reservationId) return
    toast.error(assignErrorMessage(e))
    void load()
  } finally {
    if (seq === assignSeq) assigningId.value = null
  }
}
</script>
