// hotelmedia/tests/media-crud.test.ts — Tests del CRUD de hotel_media (F0, spec hotel-media).
// Cubre: listado por hotel + type, upload (http y data-URL), ownership IDOR en cada mutación,
// validación de roomId para type=room, y reorder sin gaps. Sin DB real — mock de RepositoryAdapter.
import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, Auth } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { HotelMediaService } from '../service'
import type { HotelMediaDTO, CurrentUser } from '../types'
import type { MediaTransactor } from '../usecases/media-crud'
import * as crud from '../usecases/media-crud'

const log = silentLogger()
const passAuth: Auth = { assertOwnership: () => {}, authenticate: (() => []) as any } as unknown as Auth
// Auth estricto: permite super_admin, rechaza cualquier recurso de otro hotel.
const strictAuth: Auth = {
  assertOwnership: (resourceHotel: string, userHotel: string, role?: string, sa?: string) => {
    if (role === sa) return
    if (resourceHotel !== userHotel) throw new Error('IDOR: recurso de otro hotel')
  },
  authenticate: (() => []) as any,
} as unknown as Auth
const user: CurrentUser = { id: 'u1', hotelId: 'h1', role: 'hotel_admin' }

function makeRepo<T extends object>(overrides: Partial<RepositoryAdapter<T>> = {}): RepositoryAdapter<T> {
  return {
    findMany: async () => [],
    findById: async () => null,
    findOne: async () => null,
    create: async (data: any) => ({ id: 'gen-id', ...data }),
    update: async (id: any, data: any) => ({ id, ...data }),
    delete: async () => true,
    count: async () => 0,
    paginate: async () => ({ data: [], total: 0, limit: 100, offset: 0, pages: 0 }),
    ...overrides,
  } as RepositoryAdapter<T>
}
function makeUserRepo(hotelId = 'h1'): RepositoryAdapter<any> {
  return { ...makeRepo<any>(), findOne: async () => ({ id: 'u1', hotelId }) }
}

/** Repo de media respaldado por un array en memoria (create/findMany/update/delete sobre la MISMA tabla). */
function backedMedia(store: any[], seed: any[] = []): RepositoryAdapter<HotelMediaDTO> {
  store.push(...seed)
  const match = (r: any, q: any) => Object.keys(q || {}).every((k) => r[k] === q[k])
  let n = 0
  return {
    ...makeRepo<HotelMediaDTO>(),
    create: async (d: any) => { const row = { createdAt: 't', updatedAt: 't', ...d, id: `gen${++n}` }; store.push(row); return row },
    findOne: async (q: any) => store.find((r) => match(r, q)) ?? null,
    findMany: async (q: any = {}) => store.filter((r) => match(r, q)),
    update: async (id: any, d: any) => { const r = store.find((x) => x.id === id); if (r) Object.assign(r, d, { updatedAt: 't' }); return r ?? null },
    delete: async (id: any) => { const i = store.findIndex((x) => x.id === id); if (i >= 0) { store.splice(i, 1); return true } return false },
  } as RepositoryAdapter<HotelMediaDTO>
}

interface Opts {
  media?: RepositoryAdapter<HotelMediaDTO>
  rooms?: RepositoryAdapter<any>
  storage?: any
  userHotel?: string
  auth?: Auth
  transactor?: MediaTransactor
}
function svc(o: Opts = {}) {
  return new HotelMediaService(
    o.media ?? makeRepo<HotelMediaDTO>(),
    o.rooms ?? makeRepo<any>(),
    makeUserRepo(o.userHotel ?? 'h1'),
    log,
    o.auth ?? passAuth,
    o.storage,
    o.transactor,
  )
}

/**
 * Mock del `tx` que el `orm.transaction(fn)` REAL le pasa al callback (kernel/db/orm.ts):
 * un ORM crudo, `update(modelName, id, data)` con 3 args, modelo PRIMERO — nunca expone
 * `.for(model)`. Bug real (media-explicit-save-alt QA): el código viejo asumía que sin
 * `.for` el `tx` ya era un `RepositoryAdapter` de 2 args y llamaba `tx.update(id, patch)`
 * — el uuid caía en el parámetro `modelName` → "Modelo '&lt;uuid&gt;' no definido" en TODO
 * reorder real (0 tests lo cubrían porque ningún test de este archivo pasaba `transactor`).
 */
function rawOrmTransactor(store: any[]): MediaTransactor {
  return {
    transaction: async (fn) => fn({
      update: async (modelName: string, id: string, patch: any) => {
        if (modelName !== 'HotelMedia') throw new Error(`Modelo '${modelName}' no definido`)
        const row = store.find((r) => r.id === id)
        if (row) Object.assign(row, patch)
        return row ?? null
      },
    }),
  }
}

// ─── listByHotel ───────────────────────────────────────────────────────────
describe('hotel_media — listByHotel', () => {
  it('devuelve solo media del hotel pedido y respeta filtro type', async () => {
    const store: any[] = [
      { id: 'a', hotelId: 'h1', type: 'hero', url: 'u1', sortOrder: 0 },
      { id: 'b', hotelId: 'h1', type: 'gallery', url: 'u2', sortOrder: 0 },
      { id: 'c', hotelId: 'h2', type: 'hero', url: 'u3', sortOrder: 0 },   // otro hotel
    ]
    const res = await svc({ media: backedMedia(store) }).listByHotel('h1', undefined, user)
    expect(res.total).toBe(2)
    expect(res.data.map((m) => m.id).sort()).toEqual(['a', 'b'])

    const heroOnly = await svc({ media: backedMedia(store) }).listByHotel('h1', 'hero' as any, user)
    expect(heroOnly.total).toBe(1)
    expect(heroOnly.data[0].id).toBe('a')
  })

  it('ordena por sortOrder ASC', async () => {
    const store: any[] = [
      { id: 'b', hotelId: 'h1', type: 'gallery', url: 'u', sortOrder: 2 },
      { id: 'c', hotelId: 'h1', type: 'gallery', url: 'u', sortOrder: 0 },
      { id: 'a', hotelId: 'h1', type: 'gallery', url: 'u', sortOrder: 1 },
    ]
    const res = await svc({ media: backedMedia(store) }).listByHotel('h1', undefined, user)
    expect(res.data.map((m) => m.id)).toEqual(['c', 'a', 'b'])
  })

  it('IDOR: listar media de hotel ajeno es rechazado', async () => {
    await expect(
      svc({ media: backedMedia([]), auth: strictAuth }).listByHotel('OTRO', undefined, user),
    ).rejects.toThrow('IDOR')
  })
})

// ─── upload ────────────────────────────────────────────────────────────────
describe('hotel_media — upload', () => {
  it('persiste la URL http directa y fuerza hotelId del JWT', async () => {
    let created: any = null
    const media = makeRepo<HotelMediaDTO>({ create: async (d: any) => { created = d; return { id: 'm1', ...d } } })
    await svc({ media }).upload('h1', { type: 'hero', url: 'https://cdn/x.jpg' }, user)
    expect(created.hotelId).toBe('h1')
    expect(created.url).toBe('https://cdn/x.jpg')
    expect(created.type).toBe('hero')
    expect(created.sortOrder).toBe(0)
  })

  // Tarea 3.5 (QA 2026-08-27) — "ocultar" sin borrar: toda foto nace visible.
  it('nace con active:true, sin necesidad de pasarlo en el DTO', async () => {
    let created: any = null
    const media = makeRepo<HotelMediaDTO>({ create: async (d: any) => { created = d; return { id: 'm1', ...d } } })
    await svc({ media }).upload('h1', { type: 'gallery', url: 'https://cdn/x.jpg' }, user)
    expect(created.active).toBe(true)
  })

  it('data-URL: sube al storage con dir hotel-media y persiste la URL devuelta', async () => {
    let uploadDir = ''
    let uploadFile: any = null
    const storage = {
      upload: async (file: any, dir: string) => {
        uploadDir = dir
        uploadFile = file
        return { url: '/uploads/hotel-media/abc.jpg', path: 'hotel-media/abc.jpg', originalName: file.originalName, mimeType: file.mimeType, size: file.size }
      },
    }
    const media = makeRepo<HotelMediaDTO>({ create: async (d: any) => ({ id: 'm1', ...d }) })
    const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    const m = await svc({ media, storage }).upload(
      'h1',
      { type: 'gallery', url: `data:image/png;base64,${PNG_B64}`, fileName: 'foto.png' },
      user,
    )
    expect(uploadDir).toBe('hotel-media')
    expect(uploadFile.mimeType).toBe('image/png')
    expect(m.url).toBe('/uploads/hotel-media/abc.jpg')   // persiste la URL del storage, NO el data: URL
  })

  it('al llegar al máximo de 30 por hotel+type → ValidationError, no crea ni gasta storage', async () => {
    const store: any[] = Array.from({ length: 30 }, (_, i) => ({
      id: `g${i}`, hotelId: 'h1', type: 'gallery', url: 'u', sortOrder: i,
    }))
    let storageCalled = false
    const storage = { upload: async () => { storageCalled = true; return { url: 'x', path: 'x', originalName: 'x', mimeType: 'image/png', size: 1 } } }
    await expect(
      svc({ media: backedMedia(store), storage }).upload('h1', { type: 'gallery', url: 'https://cdn/new.jpg' }, user),
    ).rejects.toThrow('máximo de 30 fotos')
    expect(storageCalled).toBe(false)
    expect(store.length).toBe(30)
  })

  it('el tope es POR TYPE — 30 en gallery no bloquea subir a hero', async () => {
    const store: any[] = Array.from({ length: 30 }, (_, i) => ({
      id: `g${i}`, hotelId: 'h1', type: 'gallery', url: 'u', sortOrder: i,
    }))
    const created = await svc({ media: backedMedia(store) }).upload('h1', { type: 'hero', url: 'https://cdn/hero.jpg' }, user)
    expect(created.type).toBe('hero')
  })

  it('sin storage configurado + data-URL → ValidationError claro (no crash)', async () => {
    await expect(
      svc({ storage: undefined }).upload('h1', { type: 'hero', url: 'data:image/png;base64,xxx' }, user),
    ).rejects.toThrow('Storage no configurado')
  })

  it('data-URL de no-imagen (PDF) → ValidationError', async () => {
    await expect(
      svc({ storage: {} }).upload('h1', { type: 'hero', url: 'data:application/pdf;base64,JVBERi0xLjQK' }, user),
    ).rejects.toThrow('imágenes')
  })

  it('type=room SIN roomId → ValidationError', async () => {
    await expect(
      svc().upload('h1', { type: 'room', url: 'https://cdn/x.jpg' }, user),
    ).rejects.toThrow('roomId es obligatorio')
  })

  it('type=room con roomId de otro hotel → ValidationError', async () => {
    const rooms = makeRepo<any>({ findOne: async () => ({ id: 'r1', hotelId: 'OTRO' }) })
    await expect(
      svc({ rooms }).upload('h1', { type: 'room', url: 'https://cdn/x.jpg', roomId: 'r1' }, user),
    ).rejects.toThrow('habitación')
  })

  it('type=room con roomId válido del hotel → ok', async () => {
    let created: any = null
    const rooms = makeRepo<any>({ findOne: async () => ({ id: 'r1', hotelId: 'h1' }) })
    const media = makeRepo<HotelMediaDTO>({ create: async (d: any) => { created = d; return { id: 'm1', ...d } } })
    await svc({ rooms, media }).upload('h1', { type: 'room', url: 'https://cdn/x.jpg', roomId: 'r1' }, user)
    expect(created.roomId).toBe('r1')
    expect(created.type).toBe('room')
  })

  it('IDOR: upload para hotel ajeno es rechazado', async () => {
    await expect(
      svc({ auth: strictAuth }).upload('OTRO', { type: 'hero', url: 'https://cdn/x.jpg' }, user),
    ).rejects.toThrow('IDOR')
  })

  it('type inválido → ValidationError', async () => {
    await expect(
      svc().upload('h1', { type: 'invalid' as any, url: 'https://cdn/x.jpg' }, user),
    ).rejects.toThrow('gallery|hero|room')
  })
})

// ─── update ────────────────────────────────────────────────────────────────
describe('hotel_media — update', () => {
  it('campos editables se actualizan con ownership OK', async () => {
    const existing = { id: 'm1', hotelId: 'h1', type: 'gallery', url: 'u', alt: 'old', sortOrder: 0 }
    const media = makeRepo<HotelMediaDTO>({
      findOne: async () => ({ ...existing }) as any,
      update: async (id: any, d: any) => ({ ...existing, ...d, id } as HotelMediaDTO),
    })
    const m = await svc({ media, auth: strictAuth }).update('m1', { alt: 'new', sortOrder: 5 }, user)
    expect(m.alt).toBe('new')
    expect(m.sortOrder).toBe(5)
  })

  // Tarea 3.5 — toggle ocultar/mostrar sin tocar ningún otro campo.
  it('active se puede togglear independientemente del resto de campos', async () => {
    const existing = { id: 'm1', hotelId: 'h1', type: 'gallery', url: 'u', alt: 'x', sortOrder: 3, active: true }
    const media = makeRepo<HotelMediaDTO>({
      findOne: async () => ({ ...existing }) as any,
      update: async (id: any, d: any) => ({ ...existing, ...d, id } as HotelMediaDTO),
    })
    const hidden = await svc({ media, auth: strictAuth }).update('m1', { active: false }, user)
    expect(hidden.active).toBe(false)
    expect(hidden.alt).toBe('x') // resto de campos intacto
    expect(hidden.sortOrder).toBe(3)
  })

  it('cambiar type a room sin roomId → ValidationError', async () => {
    const media = makeRepo<HotelMediaDTO>({
      findOne: async () => ({ id: 'm1', hotelId: 'h1', type: 'gallery', url: 'u' } as any),
    })
    await expect(
      svc({ media, auth: strictAuth }).update('m1', { type: 'room' }, user),
    ).rejects.toThrow('roomId es obligatorio')
  })

  it('IDOR: update de media de otro hotel es rechazado', async () => {
    const media = makeRepo<HotelMediaDTO>({
      findOne: async () => ({ id: 'm1', hotelId: 'OTRO', type: 'hero', url: 'u' } as any),
    })
    await expect(
      svc({ media, auth: strictAuth }).update('m1', { alt: 'hack' }, user),
    ).rejects.toThrow('IDOR')
  })

  it('404 si la media no existe', async () => {
    await expect(
      svc().update('missing', { alt: 'x' }, user),
    ).rejects.toThrow('no encontrado')
  })
})

// ─── remove ────────────────────────────────────────────────────────────────
describe('hotel_media — remove', () => {
  it('borra con ownership OK', async () => {
    const existing = { id: 'm1', hotelId: 'h1', type: 'gallery', url: 'u' }
    let deleted = false
    const media = makeRepo<HotelMediaDTO>({
      findOne: async () => ({ ...existing }) as any,
      delete: async () => { deleted = true; return true },
    })
    await svc({ media, auth: strictAuth }).remove('m1', user)
    expect(deleted).toBe(true)
  })

  it('IDOR: borrar media de otro hotel es rechazado', async () => {
    const media = makeRepo<HotelMediaDTO>({
      findOne: async () => ({ id: 'm1', hotelId: 'OTRO', type: 'gallery', url: 'u' } as any),
    })
    await expect(
      svc({ media, auth: strictAuth }).remove('m1', user),
    ).rejects.toThrow('IDOR')
  })

  it('404 si la media no existe', async () => {
    await expect(svc().remove('missing', user)).rejects.toThrow('no encontrado')
  })
})

// ─── reorder ───────────────────────────────────────────────────────────────
describe('hotel_media — reorder', () => {
  it('reescribe sortOrder 0..N-1 sin gaps según el orden del array', async () => {
    const store: any[] = [
      { id: 'A', hotelId: 'h1', type: 'gallery', url: 'u', sortOrder: 0 },
      { id: 'B', hotelId: 'h1', type: 'gallery', url: 'u', sortOrder: 1 },
      { id: 'C', hotelId: 'h1', type: 'gallery', url: 'u', sortOrder: 2 },
    ]
    await svc({ media: backedMedia(store), auth: strictAuth }).reorder('h1', ['C', 'A', 'B'], user)
    const byId = (id: string) => store.find((r) => r.id === id)
    expect(byId('C')!.sortOrder).toBe(0)
    expect(byId('A')!.sortOrder).toBe(1)
    expect(byId('B')!.sortOrder).toBe(2)
  })

  it('con transactor cableado (shape real del ORM, update(modelName,id,data)) reescribe sortOrder — regresión del bug "Modelo uuid no definido"', async () => {
    const store: any[] = [
      { id: 'A', hotelId: 'h1', type: 'gallery', url: 'u', sortOrder: 0 },
      { id: 'B', hotelId: 'h1', type: 'gallery', url: 'u', sortOrder: 1 },
      { id: 'C', hotelId: 'h1', type: 'gallery', url: 'u', sortOrder: 2 },
    ]
    await svc({
      media: backedMedia(store),
      auth: strictAuth,
      transactor: rawOrmTransactor(store),
    }).reorder('h1', ['C', 'A', 'B'], user)
    const byId = (id: string) => store.find((r) => r.id === id)
    expect(byId('C')!.sortOrder).toBe(0)
    expect(byId('A')!.sortOrder).toBe(1)
    expect(byId('B')!.sortOrder).toBe(2)
  })

  it('con id de otro hotel → ValidationError (no toca nada)', async () => {
    const store: any[] = [
      { id: 'A', hotelId: 'h1', type: 'gallery', url: 'u', sortOrder: 0 },
      { id: 'X', hotelId: 'OTRO', type: 'gallery', url: 'u', sortOrder: 0 },
    ]
    await expect(
      svc({ media: backedMedia(store), auth: strictAuth }).reorder('h1', ['A', 'X'], user),
    ).rejects.toThrow('otro hotel')
  })

  it('array vacío → ValidationError', async () => {
    await expect(
      svc({ auth: strictAuth }).reorder('h1', [], user),
    ).rejects.toThrow('no vacío')
  })

  it('IDOR: reorder para hotel ajeno es rechazado antes de tocar', async () => {
    await expect(
      svc({ media: backedMedia([]), auth: strictAuth }).reorder('OTRO', ['A'], user),
    ).rejects.toThrow('IDOR')
  })
})

// ─── Smoke de los exports del usecase (cobertura explícita de la API pública) ────
describe('hotel_media — usecases exports', () => {
  it('expone las 5 operaciones con la firma esperada', () => {
    expect(typeof crud.listByHotel).toBe('function')
    expect(typeof crud.upload).toBe('function')
    expect(typeof crud.update).toBe('function')
    expect(typeof crud.remove).toBe('function')
    expect(typeof crud.reorder).toBe('function')
  })
})
