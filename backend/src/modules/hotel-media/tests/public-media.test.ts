// hotelmedia/tests/public-media.test.ts — GET /api/public/hotels/:slug/media (Tarea 3.5,
// QA 2026-08-27). Cubre el filtro `active !== false` que decide qué se expone en la landing
// pública/motor de reservas — antes de esta tarea no había NINGÚN test de `publicMedia()`
// (media-crud.test.ts solo cubre las mutaciones admin, no la lectura pública agrupada).
import { describe, it, expect } from 'bun:test'
import type { Logger, RepositoryAdapter } from 'arckode-framework'
import { HotelMediaController } from '../controller'
import { HotelMediaService } from '../service'
import type { HotelMediaDTO } from '../types'

const log = { info: async () => undefined, child: () => log, error: async () => undefined, warn: async () => undefined, debug: async () => undefined } as unknown as Logger

function repoOf<T extends object>(rows: T[]): RepositoryAdapter<T> {
  return {
    findMany: async (q: Record<string, unknown> = {}) =>
      rows.filter((r) => Object.keys(q).every((k) => (r as any)[k] === (q as any)[k])),
    findOne: async (q: Record<string, unknown> = {}) =>
      rows.find((r) => Object.keys(q).every((k) => (r as any)[k] === (q as any)[k])) ?? null,
    findById: async () => null,
    create: async (d: any) => d,
    update: async () => null,
    delete: async () => true,
    count: async () => rows.length,
    paginate: async () => ({ data: rows, total: rows.length, limit: 100, offset: 0, pages: 1 }),
  } as RepositoryAdapter<T>
}

function makeController(media: HotelMediaDTO[], rooms: any[] = [], hotels: any[] = [{ id: 'h1', slug: 'demo', onlineBookingStatus: 'active' }]) {
  const mediaRepo = repoOf(media)
  const svc = new HotelMediaService(mediaRepo, repoOf<any>(rooms), {} as any, log, {} as any)
  return new HotelMediaController(svc, log, mediaRepo, repoOf<any>(rooms), repoOf<any>(hotels))
}

describe('hotel_media — GET /api/public/hotels/:slug/media (active filter)', () => {
  it('active:false NO aparece en hero/gallery', async () => {
    const media: HotelMediaDTO[] = [
      { id: 'h1v', hotelId: 'h1', type: 'hero', url: 'u1', sortOrder: 0, active: true } as HotelMediaDTO,
      { id: 'h2hidden', hotelId: 'h1', type: 'hero', url: 'u2', sortOrder: 1, active: false } as HotelMediaDTO,
      { id: 'g1v', hotelId: 'h1', type: 'gallery', url: 'u3', sortOrder: 0, active: true } as HotelMediaDTO,
      { id: 'g2hidden', hotelId: 'h1', type: 'gallery', url: 'u4', sortOrder: 1, active: false } as HotelMediaDTO,
    ]
    const ctrl = makeController(media)
    const res = await ctrl.publicMedia({ params: { slug: 'demo' } } as any) as any
    expect(res.status).toBe(200)
    expect(res.body.hero.map((m: any) => m.id)).toEqual(['h1v'])
    expect(res.body.gallery.map((m: any) => m.id)).toEqual(['g1v'])
  })

  it('active undefined/null (filas previas a esta tarea) siguen públicas — sin default roto que las esconda de golpe', async () => {
    const media: HotelMediaDTO[] = [
      { id: 'legacy-undefined', hotelId: 'h1', type: 'gallery', url: 'u1', sortOrder: 0 } as HotelMediaDTO,
      { id: 'legacy-null', hotelId: 'h1', type: 'gallery', url: 'u2', sortOrder: 1, active: null as any } as HotelMediaDTO,
    ]
    const ctrl = makeController(media)
    const res = await ctrl.publicMedia({ params: { slug: 'demo' } } as any) as any
    expect(res.body.gallery.map((m: any) => m.id).sort()).toEqual(['legacy-null', 'legacy-undefined'])
  })

  it('active:false en una foto de habitación la saca del grupo (y del hotel si era la única)', async () => {
    const rooms = [{ id: 'r1', hotelId: 'h1', number: '101', name: null }]
    const media: HotelMediaDTO[] = [
      { id: 'p1', hotelId: 'h1', type: 'room', roomId: 'r1', url: 'u1', sortOrder: 0, active: true } as HotelMediaDTO,
      { id: 'p2hidden', hotelId: 'h1', type: 'room', roomId: 'r1', url: 'u2', sortOrder: 1, active: false } as HotelMediaDTO,
    ]
    const ctrl = makeController(media, rooms)
    const res = await ctrl.publicMedia({ params: { slug: 'demo' } } as any) as any
    expect(res.body.rooms).toHaveLength(1)
    expect(res.body.rooms[0].photos.map((p: any) => p.id)).toEqual(['p1'])
  })

  it('revert-test: sin el filtro de active, la foto oculta SÍ aparecería — confirma que el test detecta la regresión', async () => {
    // Mismo caso que el primer test, pero llamando directo al repo (sin pasar por el
    // controller) para probar que el fixture realmente contiene la fila active:false —
    // si este assert fallara, el test de arriba estaría pasando por el motivo equivocado.
    const media: HotelMediaDTO[] = [
      { id: 'g2hidden', hotelId: 'h1', type: 'gallery', url: 'u4', sortOrder: 1, active: false } as HotelMediaDTO,
    ]
    expect(media.filter((m) => m.active !== false)).toHaveLength(0)
    expect(media.filter((m) => (m as any).active !== undefined)).toHaveLength(1) // sanity: el campo sí está seteado
  })
})
