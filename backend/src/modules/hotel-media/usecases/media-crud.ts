// hotelmedia/usecases/media-crud.ts — CRUD de hotel_media (F0, spec hotel-media).
//
// Reglas de negocio:
//  - Ownership IDOR: toda operación valida que la media pertenezca al hotel del JWT.
//    Post-find `findOne({id})` + `auth.assertOwnership(record.hotelId, user.hotelId, ...)`.
//    (Mismo patrón textual que restaurant/usecases/items-crud.ts.)
//  - `type='room'` REQUIERE `roomId` válido del MISMO hotel (FK lógica a `rooms.id`).
//  - `url` puede venir como data-URL base64 (la sube al S3StorageAdapter con dir
//    `hotel-media`) o como URL http(s) ya resuelta (se persiste directo).
//  - `reorder` reescribe `sortOrder` 0..N-1 sin gaps, atómico en secuencia.
//
// Anti-patrón ORM (mem 1805): TODO campo persistido está declarado en model.ts. Si lo
// agregás acá, declaralo allá también (case-sensitive) o se descarta silenciosamente.
import type { RepositoryAdapter, Auth } from 'arckode-framework'
import { NotFoundError, ValidationError } from 'arckode-framework'
import type { StorageService } from 'arckode-framework/modules/storage'
import type { HotelMediaDTO, CreateHotelMediaDTO, UpdateHotelMediaDTO, MediaType, CurrentUser } from '../types'
import { parseDataUrl, isImage } from '../../../shared/utils/data-url'

/**
 * Abstracción mínima del ORM para atomicidad: solo expone `transaction`. La define el módulo
 * (NO es el tipo `ORM` del framework) para que el service dependa de esta interface y no del
 * ORM concreto — el analyzer lo exige (regla "service no inyecta ORM directo"). El index.ts
 * construye el adapter desde el `orm` real del sistema.
 *
 * M2 fix (audit solmi-direct-booking) — `reorder` ahora envuelve su loop de updates en una
 * tx (patrón de `landing/usecases/blocks-crud.ts`). Si un update falla a mitad, rollback.
 */
export interface MediaTransactor {
  transaction<T>(fn: (tx: any) => Promise<T>): Promise<T>
}

export interface MediaCrudDeps {
  media: RepositoryAdapter<HotelMediaDTO>
  /** Repo ORM `Rooms` para validar que `roomId` pertenece al hotel (FK lógica). */
  rooms: RepositoryAdapter<any>
  userRepo: RepositoryAdapter<any>
  auth: Auth
  /** Storage para subir binarios cuando `url` viene como data-URL base64. Opcional:
   *  si no se inyecta, el `upload` con data-URL falla con ValidationError claro. */
  storage?: StorageService
  /** M2 — Transactor para `transaction(fn)` en reorder atómico. Opcional para no romper
   *  tests legacy que no lo pasan: si falta, `reorder` cae al loop sin tx (comportamiento
   *  pre-fix, no atómico pero funcional para DBs pequeñas). */
  transactor?: MediaTransactor
}

const MEDIA_TYPES: MediaType[] = ['gallery', 'hero', 'room']
const STORAGE_DIR = 'hotel-media'
/** Máximo de fotos por hotel+type. Antes no había ningún tope (feedback: "hay que poner un
 *  máximo de imágenes") — 30 alcanza para cualquier galería/hero/room real sin sentirse
 *  restrictivo, y evita que un hotel suba cientos de fotos sin control (costo de storage +
 *  landing pesada). Mismo tope para los 3 types por simplicidad — ninguno lo necesita mayor. */
const MAX_MEDIA_PER_TYPE = 30

/** Hotel efectivo del JWT; rechaza si el usuario no tiene hotel asignado. */
function hotelFor(user: CurrentUser): string {
  const h = user.hotelId || ''
  if (!h) throw new ValidationError('Sin hotel asignado')
  return h
}

/** Valida que `t` esté en el enum cerrado de MediaType. */
function assertType(t: unknown): MediaType {
  if (!MEDIA_TYPES.includes(t as MediaType)) {
    throw new ValidationError('type debe ser gallery|hero|room')
  }
  return t as MediaType
}

/** Resuelve el hotelId efectivo del usuario (vía userRepo, no del JWT directo) y lo
 *  compara contra `resourceHotelId` con `auth.assertOwnership`. Evita falsos positivos
 *  del analyzer (regla de "no nombrar findById en comentarios"). */
async function assertOwnershipOf(deps: MediaCrudDeps, resourceHotelId: string, user: CurrentUser): Promise<void> {
  const me = await deps.userRepo.findOne({ id: user.id })
  deps.auth.assertOwnership(resourceHotelId, (me as any)?.hotelId ?? '', user.role, 'super_admin')
}

/** `roomId` (si viene) debe existir y ser del MISMO hotel. `findOne` evita IDOR. */
async function assertRoomOfHotel(deps: MediaCrudDeps, roomId: string | null | undefined, hotelId: string): Promise<void> {
  if (!roomId) return
  const room = await deps.rooms.findOne({ id: roomId })
  if (!room || room.hotelId !== hotelId) {
    throw new ValidationError('La habitación no existe o es de otro hotel')
  }
}

// ─── listByHotel ───────────────────────────────────────────────────────────
export async function listByHotel(
  deps: MediaCrudDeps,
  hotelId: string,
  type: MediaType | undefined,
  user: CurrentUser,
): Promise<{ data: HotelMediaDTO[]; total: number }> {
  await assertOwnershipOf(deps, hotelId, user)
  const filters: Record<string, unknown> = { hotelId }
  if (type) filters.type = assertType(type)
  const data = await deps.media.findMany(filters)
  data.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  return { data, total: data.length }
}

// ─── upload ────────────────────────────────────────────────────────────────
export async function upload(
  deps: MediaCrudDeps,
  hotelId: string,
  dto: CreateHotelMediaDTO,
  user: CurrentUser,
): Promise<HotelMediaDTO> {
  await assertOwnershipOf(deps, hotelId, user)
  const type = assertType(dto.type)
  if (!dto.url?.trim()) throw new ValidationError('La url es obligatoria')

  // Tope por type — fail-fast ANTES de tocar storage (no gastar una subida a S3 para
  // terminar rechazándola).
  const currentCount = (await deps.media.findMany({ hotelId, type })).length
  if (currentCount >= MAX_MEDIA_PER_TYPE) {
    throw new ValidationError(`Llegaste al máximo de ${MAX_MEDIA_PER_TYPE} fotos para esta categoría. Borrá alguna para subir una nueva.`)
  }

  // type='room' exige roomId del mismo hotel (spec, scenario "Subir foto de habitación").
  if (type === 'room') {
    if (!dto.roomId) throw new ValidationError('roomId es obligatorio para type=room')
    await assertRoomOfHotel(deps, dto.roomId, hotelId)
  }

  // Resolver URL final: data-URL → subirla al storage; http(s) → persistir directa.
  let finalUrl = dto.url
  if (dto.url.startsWith('data:')) {
    if (!deps.storage) throw new ValidationError('Storage no configurado para subir archivos')
    const parsed = parseDataUrl(dto.url)
    if (!parsed) throw new ValidationError('Formato inválido (se espera data URL base64)')
    if (!isImage(parsed.mimeType)) throw new ValidationError('Solo se permiten imágenes')
    const stored = await deps.storage.upload(
      {
        fieldName: 'file',
        originalName: dto.fileName || `media-${hotelId}-${Date.now()}.${parsed.ext}`,
        buffer: parsed.buffer,
        mimeType: parsed.mimeType,
        size: parsed.buffer.length,
      },
      STORAGE_DIR,
    )
    finalUrl = stored.url
  }

  return deps.media.create({
    hotelId,
    type,
    url: finalUrl,
    alt: dto.alt ?? undefined,
    sortOrder: dto.sortOrder ?? 0,
    roomId: dto.roomId || undefined,
    active: true,
  } as Omit<HotelMediaDTO, 'id'>)
}

// ─── update ────────────────────────────────────────────────────────────────
export async function update(
  deps: MediaCrudDeps,
  id: string,
  dto: UpdateHotelMediaDTO,
  user: CurrentUser,
): Promise<HotelMediaDTO> {
  const existing = await deps.media.findOne({ id })
  if (!existing) throw new NotFoundError('Media no encontrado')
  await assertOwnershipOf(deps, existing.hotelId, user)

  const patch: Record<string, unknown> = {}
  if (dto.type !== undefined) patch.type = assertType(dto.type)
  if (dto.url !== undefined) {
    if (!dto.url.trim()) throw new ValidationError('La url no puede ser vacía')
    patch.url = dto.url
  }
  if (dto.alt !== undefined) patch.alt = dto.alt
  if (dto.sortOrder !== undefined) patch.sortOrder = dto.sortOrder
  if (dto.roomId !== undefined) {
    if (dto.roomId) await assertRoomOfHotel(deps, dto.roomId, existing.hotelId)
    patch.roomId = dto.roomId || undefined
  }
  if (dto.active !== undefined) patch.active = dto.active

  // Si el type final (nuevo o heredado) es 'room', `roomId` debe quedar presente.
  const finalType = (patch.type as MediaType | undefined) ?? existing.type
  const finalRoomId = patch.roomId !== undefined ? patch.roomId : existing.roomId
  if (finalType === 'room' && !finalRoomId) {
    throw new ValidationError('roomId es obligatorio para type=room')
  }

  const item = await deps.media.update(id, patch as Partial<Omit<HotelMediaDTO, 'id'>>)
  if (!item) throw new NotFoundError('Media no encontrado')
  return item
}

// ─── remove (delete) ───────────────────────────────────────────────────────
export async function remove(deps: MediaCrudDeps, id: string, user: CurrentUser): Promise<void> {
  const existing = await deps.media.findOne({ id })
  if (!existing) throw new NotFoundError('Media no encontrado')
  await assertOwnershipOf(deps, existing.hotelId, user)
  const deleted = await deps.media.delete(id)
  if (!deleted) throw new NotFoundError('Media no encontrado')
  // Limpieza del objeto en S3: NO se hace hoy. El modelo no guarda `storagePath`
  // (spec no lo lista, mismo criterio que `hotels.logo`). Best-effort futuro: agregar
  // `storagePath` nullable al modelo y `deps.storage.delete(path)` acá.
}

// ─── reorder ───────────────────────────────────────────────────────────────
/**
 * Reescribe `sortOrder` 0..N-1 sin gaps. Antes de tocar, valida que cada id sea del hotel.
 *
 * M2 fix (audit solmi-direct-booking) — El loop de updates va dentro de `transactor.transaction`:
 * si un update falla a mitad del loop, rollback total (no quedan sortOrders parcialmente
 * reescritos). Patrón de `landing/usecases/blocks-crud.ts:177-180`. Validación de ownership
 * e ids va ANTES de abrir la tx (no toca la tabla si algo ya está mal).
 * Si `transactor` no está cableado (tests legacy / callers viejos), cae al loop sin tx.
 */
export async function reorder(
  deps: MediaCrudDeps,
  hotelId: string,
  ids: string[],
  user: CurrentUser,
): Promise<void> {
  await assertOwnershipOf(deps, hotelId, user)
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new ValidationError('ids debe ser un array no vacío')
  }
  // Validar todos los ids ANTES de abrir la tx (fail-fast, sin tocar la tabla).
  for (const id of ids) {
    const row = await deps.media.findOne({ id })
    if (!row || row.hotelId !== hotelId) {
      throw new ValidationError(`La media ${id} no existe o es de otro hotel`)
    }
  }

  const runUpdates = async (txOrMedia: RepositoryAdapter<HotelMediaDTO>) => {
    for (let i = 0; i < ids.length; i++) {
      await txOrMedia.update(ids[i], { sortOrder: i } as Partial<Omit<HotelMediaDTO, 'id'>>)
    }
  }

  // Con transactor: atómico. Sin transactor: loop simple (compat retro).
  if (deps.transactor) {
    await deps.transactor.transaction(async (tx: any) => {
      // Bug encontrado por QA (media-explicit-save-alt) — el `tx` que entrega
      // `orm.transaction(fn)` (kernel/db/orm.ts) es SIEMPRE el ORM crudo, cuyo `update` toma
      // `(modelName, id, data)` — 3 args, modelo primero (mismo contrato que
      // `landing/usecases/blocks-crud.ts:184-185` con `tx.deleteMany('LandingBlocks', ...)` /
      // `tx.createMany('LandingBlocks', ...)`). NUNCA expone `.for(model)` en este framework —
      // esa rama era código muerto que nunca corrió (0 tests con transactor cableado la
      // ejercitaban), y el fallback `: tx` llamaba `tx.update(id, patch)` con 2 args: el UUID
      // caía en el parámetro `modelName` → "Modelo '<uuid>' no definido" en TODO reorder real.
      const txMedia: RepositoryAdapter<HotelMediaDTO> = {
        update: async (id, patch) => { await tx.update('HotelMedia', id, patch as any); return null as any },
      } as RepositoryAdapter<HotelMediaDTO>
      await runUpdates(txMedia)
    })
  } else {
    await runUpdates(deps.media)
  }
}
