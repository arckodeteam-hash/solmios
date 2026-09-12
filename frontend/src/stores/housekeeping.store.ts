// stores/housekeeping.store.ts — Estado y acciones del panel de housekeeping.
// Carga tasks + rooms + staff, mapea a ViewTask (join + duration en runtime, D1),
// y expone acciones de administración (start/complete/photos/stats).
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { HousekeepingService, MAX_PAGE_SIZE, type HousekeepingTask, type StaffStats, type PhotoEvidence, type VideoEvidence, type ChecklistItem, type SetupItem } from '@/services/Housekeeping.service'
import { RoomService } from '@/services/Room.service'
import { TeamService, type TeamMember } from '@/services/Team.service'

const TYPE_LABELS: Record<string, string> = {
  full_cleaning: 'Limpieza completa', quick_cleaning: 'Limpieza rápida', deep_cleaning: 'Limpieza profunda',
  inspection: 'Inspección', maintenance: 'Mantenimiento', arrival_setup: 'Preparación llegada',
}
// Régimen de la reserva tal como lo ve la camarera. No hay un mapa exportado en el
// frontend (ReservationModal y el wizard tienen el suyo local), así que va acá.
const REGIME_LABELS: Record<string, string> = {
  room_only: 'Solo alojamiento', breakfast: 'Desayuno', half_board: 'Media pensión',
  full_board: 'Pensión completa', all_inclusive: 'Todo incluido',
}
const PRI_LABELS: Record<string, string> = { high: 'Alta', medium: 'Normal', low: 'Baja', urgent: 'Urgente' }

export interface HousekeepingViewTask {
  id: string
  rawType?: string
  roomNumber: string
  type: string
  floor: string
  status: string
  priority: string
  priorityRaw: string
  assignedTo: string
  staffId: string
  startTime?: string
  endTime?: string
  durationMs?: number
  time: string
  notes: string
  /** Checklist de la limpieza con su estado real (hecho / sin hacer). */
  items: ChecklistItem[]
  photos: PhotoEvidence[]
  /** Calificación 1–10 del supervisor, o null si aprobó sin calificar. */
  rating: number | null
  /** Video de evidencia de fin, si el hotel usa el modo `video`. */
  video: VideoEvidence | null
  /** Nombre del supervisor que aprobó/revisó, o '' si nadie la revisó aún. */
  supervisorName: string
  /** Nota que dejó el supervisor al aprobar. */
  supervisorNote: string
  /** Hora en que el supervisor estuvo en la habitación. */
  supOnSiteTime: string
  /** Qué preparar antes de la llegada (#274): cuna, amenidades, régimen, pedido. */
  setupItems: SetupItem[]
}

const MS_PER_MINUTE = 60 * 1000

export function humanizeMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ''
  const min = Math.round(ms / MS_PER_MINUTE)
  if (min < 1) return '<1 min'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

/**
 * Checklist tal como lo dejó la camarera. Conserva el `done`: antes se aplanaba
 * a `string[]` y se perdía justamente el dato que el supervisor necesita —
 * "TV: sin hacer" se veía igual que "TV: hecho".
 *
 * Tolera las dos formas que llegan de la BD: array ya parseado o el JSON crudo,
 * y los items viejos guardados como string suelto (se asumen hechos: son de
 * tareas cerradas antes de que existiera el `done`).
 */
function parseItems(cleaningItems: unknown): ChecklistItem[] {
  if (!cleaningItems) return []
  const arr = Array.isArray(cleaningItems)
    ? cleaningItems
    : typeof cleaningItems === 'string'
      ? (() => { try { return JSON.parse(cleaningItems) } catch { return [] } })()
      : []
  if (!Array.isArray(arr)) return []
  return arr
    .map((i: any) => (typeof i === 'string'
      ? { name: i, done: true }
      : { name: i?.name, done: i?.done === true }))
    .filter((i) => Boolean(i.name))
}

const SETUP_TYPES = new Set<SetupItem['type']>(['crib', 'amenity', 'regime', 'request'])

/**
 * `setupItems` de una tarea `arrival_setup` (#274). Tolera array ya parseado o el
 * JSON crudo; null/undefined/inválido → []. Descarta entradas sin `type` conocido.
 */
export function parseSetupItems(raw: unknown): SetupItem[] {
  if (!raw) return []
  const arr = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? (() => { try { return JSON.parse(raw) } catch { return [] } })()
      : []
  if (!Array.isArray(arr)) return []
  return arr.filter((i: any): i is SetupItem => Boolean(i) && typeof i === 'object' && SETUP_TYPES.has(i.type))
}

/** Texto del chip que ve la camarera: "Cuna ×1", "Bañera ×1", "Desayuno", el pedido. */
export function setupItemLabel(item: SetupItem): string {
  switch (item.type) {
    case 'crib': return `Cuna ×${item.qty}`
    case 'amenity': return `${item.name} ×${item.qty}`
    case 'regime': return REGIME_LABELS[item.name] || item.name
    case 'request': return item.text
    default: return ''
  }
}

function mapTask(t: HousekeepingTask, roomMap: Map<string, any>, staffMap: Map<string, string>): HousekeepingViewTask {
  const room = roomMap.get(t.roomId)
  const durationMs = t.startTime && t.endTime
    ? new Date(t.endTime).getTime() - new Date(t.startTime).getTime()
    : undefined
  const supervisorName = t.supervisorId ? (staffMap.get(t.supervisorId) || '') : ''
  return {
    id: t.id,
    rawType: t.type,
    roomNumber: room?.number || '—',
    type: TYPE_LABELS[t.type ?? ''] || t.type || 'Limpieza',
    floor: room?.floor || '',
    status: t.status || 'pending',
    priorityRaw: t.priority || 'medium',
    priority: PRI_LABELS[t.priority ?? ''] || t.priority || 'Normal',
    assignedTo: staffMap.get(t.staffId || '') || 'Sin asignar',
    staffId: t.staffId || '',
    startTime: t.startTime,
    endTime: t.endTime,
    durationMs,
    time: durationMs !== undefined ? humanizeMs(durationMs) : '',
    notes: t.notes || '',
    items: parseItems(t.cleaningItems),
    setupItems: parseSetupItems(t.setupItems),
    photos: t.photos ?? [],
    rating: typeof t.rating === 'number' ? t.rating : null,
    video: t.video ?? null,
    supervisorName,
    supervisorNote: t.supervisorNote || '',
    supOnSiteTime: t.supOnSiteTime || '',
  }
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/**
 * Cómo se llena cada columna del tablero.
 *
 * Lo que está en curso se trae completo: es la operación del turno y el
 * supervisor tiene que verlo todo. Lo terminado se trae solo lo último —el
 * histórico crece sin parar y nadie revisa la limpieza de hace tres semanas
 * desde el tablero—, y el encabezado igual muestra el total real.
 */
const ACTIVE_COLUMN_LIMIT = MAX_PAGE_SIZE
const FINISHED_COLUMN_LIMIT = 10

// Se ordena por `updatedAt` y no por `completedDate`, que sería lo semántico:
// hay tareas terminadas sin fecha de fin (2 de 19 en producción), y Postgres
// ordena DESC con NULLS FIRST — esas quedarían ENCABEZANDO "las últimas 10",
// tapando justo las recientes. SQLite hace lo contrario, así que el bug solo
// aparecería en producción. `updatedAt` está siempre y se toca al terminar.
const BOARD_COLUMNS = [
  { status: 'pending', limit: ACTIVE_COLUMN_LIMIT, sort: '-createdAt' },
  { status: 'in_progress', limit: ACTIVE_COLUMN_LIMIT, sort: '-updatedAt' },
  { status: 'completed', limit: FINISHED_COLUMN_LIMIT, sort: '-updatedAt' },
  { status: 'inspected', limit: FINISHED_COLUMN_LIMIT, sort: '-updatedAt' },
] as const

export const useHousekeepingStore = defineStore('housekeeping', () => {
  const tasks = ref<HousekeepingViewTask[]>([])
  /** Total REAL por estado, tal como lo informa el backend (no `tasks.length`). */
  const totals = ref<Record<string, number>>({})
  /** Página actual de la vista de tabla y su total en el servidor. */
  const pageTasks = ref<HousekeepingViewTask[]>([])
  const pageTotal = ref(0)
  const stats = ref<StaffStats[]>([])
  // El personal son USUARIOS del hotel (tabla users), no perfiles de RRHH: los
  // tasks guardan staffId = users.id, así que hay que resolver contra /usuarios.
  const staff = ref<TeamMember[]>([])
  const rooms = ref<any[]>([])
  const loading = ref(false)
  const currentHotelId = ref<string | undefined>()

  /**
   * Carga el TABLERO, pidiendo una consulta por columna.
   *
   * Antes se pedía el listado sin `page`/`limit`: el backend devolvía sus 20 por
   * defecto y el tablero mostraba una parte del hotel como si fuera todo (26
   * tareas en producción, 6 invisibles). Además los contadores se calculaban
   * sobre esos 20, así que los KPIs mentían sin que se notara.
   *
   * Pedir por estado resuelve las dos cosas: cada respuesta trae su `total` real
   * —que es el número que se muestra— y permite traer completo lo que está en
   * curso y solo las últimas de lo terminado, que es lo que se mira de un histórico.
   */
  async function load(hotelId?: string) {
    currentHotelId.value = hotelId
    loading.value = true
    try {
      const [roomsRes, usersResult, ...pages] = await Promise.all([
        hotelId ? RoomService.list({ hotelId }) : Promise.resolve({ rooms: [] as any[] }),
        TeamService.list(),
        ...BOARD_COLUMNS.map(c =>
          HousekeepingService.list({ hotelId, status: c.status, limit: c.limit, sort: c.sort }),
        ),
      ])
      rooms.value = roomsRes.rooms ?? []
      staff.value = Array.isArray(usersResult) ? usersResult : (usersResult?.data ?? [])
      const roomMap = new Map(rooms.value.map(r => [r.id, r]))
      // Indexar por users.id: los tasks guardan staffId/supervisorId = users.id.
      const staffMap = new Map(staff.value.map(s => [s.id, s.name || s.id]))

      const counts: Record<string, number> = {}
      const all: HousekeepingViewTask[] = []
      BOARD_COLUMNS.forEach((c, i) => {
        const page = pages[i]
        counts[c.status] = page?.total ?? 0
        all.push(...(page?.data ?? []).map(t => mapTask(t, roomMap, staffMap)))
      })
      totals.value = counts
      tasks.value = all
    } finally {
      loading.value = false
    }
  }

  /**
   * Una página del listado completo, para la vista de tabla. Server-side de
   * verdad: `total` sale del backend, no de contar lo que ya se tenía.
   */
  async function loadPage(opts: { page: number; limit: number; status?: string }) {
    loading.value = true
    try {
      const res = await HousekeepingService.list({
        hotelId: currentHotelId.value,
        status: opts.status,
        page: opts.page,
        limit: opts.limit,
        sort: '-createdAt',
      })
      const roomMap = new Map(rooms.value.map(r => [r.id, r]))
      const staffMap = new Map(staff.value.map(s => [s.id, s.name || s.id]))
      pageTasks.value = (res?.data ?? []).map(t => mapTask(t, roomMap, staffMap))
      pageTotal.value = res?.total ?? 0
      return res
    } finally {
      loading.value = false
    }
  }

  /**
   * Todas las tareas del hotel, recorriendo las páginas del servidor. Es para el
   * export: ahí sí hace falta el conjunto completo, y el tope por request
   * (`MAX_PAGE_SIZE`) obliga a varias vueltas.
   */
  async function fetchAllForExport(status?: string): Promise<HousekeepingViewTask[]> {
    const roomMap = new Map(rooms.value.map(r => [r.id, r]))
    const staffMap = new Map(staff.value.map(s => [s.id, s.name || s.id]))
    const out: HousekeepingViewTask[] = []
    let page = 1
    let pages = 1
    do {
      const res = await HousekeepingService.list({
        hotelId: currentHotelId.value, status, page, limit: MAX_PAGE_SIZE, sort: '-createdAt',
      })
      out.push(...(res?.data ?? []).map(t => mapTask(t, roomMap, staffMap)))
      pages = res?.pages ?? 1
      page++
    } while (page <= pages)
    return out
  }

  async function createTask(payload: Partial<HousekeepingTask>) {
    await HousekeepingService.create(payload)
    await load(currentHotelId.value)
  }

  async function updateTask(id: string, patch: Partial<HousekeepingTask>) {
    await HousekeepingService.update(id, patch)
    await load(currentHotelId.value)
  }

  async function startTask(id: string) {
    await HousekeepingService.start(id)
    await load(currentHotelId.value)
  }

  async function completeTask(id: string) {
    await HousekeepingService.complete(id)
    await load(currentHotelId.value)
  }

  async function uploadPhoto(id: string, file: File) {
    const photo = await fileToDataUrl(file)
    await HousekeepingService.uploadPhoto(id, photo, file.name)
    await load(currentHotelId.value)
  }

  async function removePhoto(id: string, url: string) {
    await HousekeepingService.removePhoto(id, url)
    await load(currentHotelId.value)
  }

  async function loadStats(from?: string, to?: string) {
    stats.value = await HousekeepingService.stats(currentHotelId.value, from, to)
  }

  /// Aprueba y califica una limpieza (1–10). El backend exige presencia marcada
  /// antes de aprobar, así que el admin que revisa desde el panel la sella en el
  /// mismo paso, y después aprueba con la calificación.
  async function approveTask(id: string, rating: number, note?: string) {
    await HousekeepingService.markPresence(id)
    await HousekeepingService.approve(id, rating, note)
    await load(currentHotelId.value)
  }

  return {
    tasks, totals, pageTasks, pageTotal, stats, staff, rooms, loading,
    load, loadPage, fetchAllForExport, createTask, updateTask, startTask, completeTask, uploadPhoto, removePhoto, loadStats, approveTask,
  }
})
