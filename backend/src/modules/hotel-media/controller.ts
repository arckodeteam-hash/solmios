// hotelmedia/controller.ts — Adaptador HTTP del módulo hotel_media (F0 task 0.8).
// Responsabilidad ÚNICA: traducir request → service → response. SIN lógica de negocio,
// SIN llamadas directas al ORM para mutaciones. Las rutas (index.ts) cablean auth +
// permisos + rate-limit; acá llega el request ya autorizado.
//
// `validateSchema` del shared (superconjunto del framework): el schema `reorder` usa
// `array`, que el del framework no entiende y descarta en silencio (mem anti-patrón ORM).
import type { HttpRequest, Logger, RepositoryAdapter } from 'arckode-framework'
import { validateSchema } from '../../shared/validators/validate-body'
import type { HotelMediaService } from './service'
import type { HotelMediaDTO, MediaType } from './types'
import { CreateHotelMediaSchema, UpdateHotelMediaSchema, ReorderHotelMediaSchema } from './validators/schema'

/** Row del repo Hotels — solo lo necesario para resolver slug → hotelId en la ruta pública. */
interface HotelPublicRow {
  id: string
  slug?: string | null
  onlineBookingStatus?: string
}

/** Row del repo Rooms — solo `id` + label para agrupar photos por habitación. */
interface RoomPublicRow {
  id: string
  number?: string
  name?: string | null
}

/** Item plano del DTO público (allow-list estricta: sin hotelId, sin createdAt/updatedAt). */
interface PublicMediaItem {
  id: string
  url: string
  alt: string | null
}

interface PublicRoomGroup {
  roomId: string
  roomName: string
  photos: PublicMediaItem[]
}

export class HotelMediaController {
  constructor(
    private readonly service: HotelMediaService,
    private readonly logger: Logger,
    /** Repo `HotelMedia` para leer sin auth en el endpoint público (spec: allow-list estricta). */
    private readonly mediaRepo: RepositoryAdapter<HotelMediaDTO>,
    /** Repo `Rooms` para resolver `roomName` al agrupar photos por habitación. */
    private readonly roomsRepo: RepositoryAdapter<RoomPublicRow>,
    /** Repo `Hotels` para resolver slug → hotelId + onlineBookingStatus en el endpoint público. */
    private readonly hotelRepo: RepositoryAdapter<HotelPublicRow>,
  ) {}

  // ─── Admin (auth + permiso media:action) ────────────────────────────────────

  /** GET /api/hotel-media?type=hero|gallery|room — lista media del hotel del JWT. */
  async index(req: HttpRequest) {
    const user = req.user as any
    const hotelId = user?.hotelId
    if (!hotelId) throw new Error('Sin hotel asignado')
    const q = (req.query as Record<string, unknown> | undefined) ?? {}
    const type = typeof q.type === 'string' ? (q.type as MediaType) : undefined
    const result = await this.service.listByHotel(hotelId, type, user)
    return { status: 200, body: result }
  }

  /** POST /api/hotel-media — crear/upload (url puede ser data-URL base64 o http(s)). */
  async store(req: HttpRequest) {
    const user = req.user as any
    const hotelId = user?.hotelId
    if (!hotelId) throw new Error('Sin hotel asignado')
    this.logger.info('hotel_media: store', { hotelId, type: (req.body as any)?.type })
    const data = validateSchema(CreateHotelMediaSchema, req.body)
    const item = await this.service.upload(hotelId, data as any, user)
    return { status: 201, body: item }
  }

  /** PUT /api/hotel-media/:id — update de campos editables (ownership en el service). */
  async update(req: HttpRequest) {
    const user = req.user as any
    const data = validateSchema(UpdateHotelMediaSchema, req.body)
    const item = await this.service.update(req.params.id, data as any, user)
    return { status: 200, body: item }
  }

  /** DELETE /api/hotel-media/:id — remove (ownership en el service). */
  async destroy(req: HttpRequest) {
    const user = req.user as any
    await this.service.remove(req.params.id, user)
    return { status: 204, body: null }
  }

  /** POST /api/hotel-media/reorder — body `{ids:[...]}` reescribe sortOrder 0..N-1 sin gaps. */
  async reorder(req: HttpRequest) {
    const user = req.user as any
    const hotelId = user?.hotelId
    if (!hotelId) throw new Error('Sin hotel asignado')
    const data = validateSchema(ReorderHotelMediaSchema, req.body)
    const ids = (data.ids as unknown[]) ?? []
    if (!Array.isArray(ids) || ids.length === 0) {
      // El service también lo valida, pero el validateSchema no garantiza ``no vacío``.
      return { status: 400, body: { error: 'ids debe ser un array no vacío' } }
    }
    await this.service.reorder(hotelId, ids as string[], user)
    return { status: 200, body: { ok: true } }
  }

  // ─── Público (sin auth, rate-limited en la ruta) ────────────────────────────

  /** GET /api/public/hotels/:slug/media — allow-list agrupado por type (spec hotel-media). */
  async publicMedia(req: HttpRequest) {
    const slug = (req.params as { slug?: string } | undefined)?.slug
    if (!slug) return { status: 404, body: { error: 'Hotel no encontrado' } }

    // `findOne` (NO findById) para evitar falsos positivos del analyzer sobre ownership.
    const hotel = await this.hotelRepo.findOne({ slug } as Record<string, unknown>).catch(() => null)
    if (!hotel || !hotel.id) {
      return { status: 404, body: { error: 'Hotel no encontrado' } }
    }
    // Motor inactivo → misma respuesta que no existir (no filtrar el set público).
    if (hotel.onlineBookingStatus && hotel.onlineBookingStatus !== 'active') {
      return { status: 404, body: { error: 'Hotel no encontrado' } }
    }

    const [rawMedia, allRooms] = await Promise.all([
      this.mediaRepo.findMany({ hotelId: hotel.id }),
      this.roomsRepo.findMany({ hotelId: hotel.id }),
    ])
    // Tarea 3.5 — "ocultar" sin borrar: `active === false` explícito la saca de acá. Filas
    // viejas sin el campo (`undefined`, previas a esta tarea) siguen públicas — nunca hubo
    // un default `false` que las hiciera desaparecer de golpe.
    const allMedia = rawMedia.filter((m) => m.active !== false)

    const hero = this.collectPlain(allMedia, 'hero')
    const gallery = this.collectPlain(allMedia, 'gallery')
    const rooms = this.groupRoomPhotos(allMedia, allRooms)

    return { status: 200, body: { hero, gallery, rooms } }
  }

  // ─── Helpers privados (solo lectura + agrupación, sin mutar) ────────────────

  /** Extrae items públicos ({id,url,alt}) de un type, ordenados por sortOrder asc. */
  private collectPlain(rows: HotelMediaDTO[], type: MediaType): PublicMediaItem[] {
    return rows
      .filter((m) => m.type === type)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((m) => ({ id: m.id, url: m.url, alt: m.alt ?? null }))
  }

  /** Agrupa photos por `roomId` con su `roomName`, ordenadas por sortOrder asc.
   *  Solo rooms que existen en el hotel (si la room se borró, su FK lógica queda huérfana
   *  y no se expone: evita photos fantasma en la landing pública). */
  private groupRoomPhotos(media: HotelMediaDTO[], rooms: RoomPublicRow[]): PublicRoomGroup[] {
    const roomNameById = new Map<string, string>()
    for (const r of rooms) roomNameById.set(r.id, (r.name && r.name.trim()) || r.number || 'Habitación')

    // Llevar sortOrder junto al item hasta el final; descartarlo al mapear a `PublicRoomGroup`.
    type Item = { id: string; url: string; alt: string | null; sortOrder: number }
    const photosByRoom = new Map<string, Item[]>()
    for (const m of media) {
      if (m.type !== 'room' || !m.roomId) continue
      if (!roomNameById.has(m.roomId)) continue
      const arr = photosByRoom.get(m.roomId) ?? []
      arr.push({ id: m.id, url: m.url, alt: m.alt ?? null, sortOrder: m.sortOrder ?? 0 })
      photosByRoom.set(m.roomId, arr)
    }

    // Orden estable: rooms por label asc (number/name); photos por sortOrder asc.
    const sortedRoomIds = Array.from(photosByRoom.keys()).sort((a, b) => {
      const na = roomNameById.get(a) ?? ''
      const nb = roomNameById.get(b) ?? ''
      return na.localeCompare(nb, 'es', { numeric: true })
    })

    return sortedRoomIds.map((roomId) => {
      const photos = (photosByRoom.get(roomId) ?? [])
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(({ id, url, alt }) => ({ id, url, alt }))
      return { roomId, roomName: roomNameById.get(roomId) ?? 'Habitación', photos }
    })
  }
}
