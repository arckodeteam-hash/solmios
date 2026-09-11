// admin/tests/announcement-templates.test.ts — key global `announcement_templates` (#111, ANN-7).
//
// Mismo molde que trial-days.test.ts: el usecase contra un repo en memoria que registra las
// escrituras, y el happy path + 400/403 por RUTA REAL montando `admin` de verdad. Lo que se
// afirma: setAnnouncementTemplates deja UNA fila {hotelId:'platform', key:'announcement_templates',
// value:[...]} (upsert si ya existía); get sin fila, con JSON corrupto o con value no-array → []
// (fallback silencioso); la lectura tolera el array serializado como string (así lo guardaba el
// frontend vía /configuracion); inválidos → ValidationError, que por ruta es 400; merchant → 403.
import { describe, it, expect } from 'bun:test'
import { Router, ValidationError } from 'arckode-framework'
import { getAnnouncementTemplates, setAnnouncementTemplates, ANNOUNCEMENT_TEMPLATES_MAX } from '../usecases/announcement-templates'
import { AdminModule } from '../index'
import { makeAuth, fakeLogger } from '../../../infrastructure/auth/tests/route-permission-helpers'

/** Repo en memoria con registro de escrituras (mold: trial-days.test.ts). */
function makeRepo(filas: any[] = []) {
  const escrituras: any[] = []
  return {
    escrituras,
    filas,
    repo: {
      findMany: async (f: any) => filas.filter((x) => Object.entries(f).every(([k, v]) => x[k] === v)),
      create: async (d: any) => { filas.push(d); escrituras.push({ tipo: 'create', d }); return d },
      update: async (id: string, d: any) => {
        const i = filas.findIndex((x) => x.id === id)
        filas[i] = { ...filas[i], ...d }
        escrituras.push({ tipo: 'update', d })
        return filas[i]
      },
    } as any,
  }
}

const fila = (value: unknown, id = 'cfg-tpl') => ({ id, hotelId: 'platform', key: 'announcement_templates', value })

const mantenimiento = { name: 'Mantenimiento', icon: '🔧', description: 'Aviso de mantenimiento', type: 'maintenance', message: 'Habrá mantenimiento el sábado' }
const novedad = { name: 'Novedad', icon: '✨', description: 'Nueva funcionalidad', type: 'info', message: 'Lanzamos algo nuevo' }

describe('getAnnouncementTemplates — lectura con fallback silencioso', () => {
  it('sin fila → []', async () => {
    expect(await getAnnouncementTemplates(makeRepo().repo)).toEqual({ templates: [] })
  })

  it('fila con el array como objeto o serializado (JSON.stringify del frontend) → la lista', async () => {
    const lista = [mantenimiento, novedad]
    expect((await getAnnouncementTemplates(makeRepo([fila(lista)]).repo)).templates).toEqual(lista)
    expect((await getAnnouncementTemplates(makeRepo([fila(JSON.stringify(lista))]).repo)).templates).toEqual(lista)
    // El driver puede devolver el string serializado una vez más (columna json con un string adentro).
    expect((await getAnnouncementTemplates(makeRepo([fila(JSON.stringify(JSON.stringify(lista)))]).repo)).templates).toEqual(lista)
  })

  it('value corrupto o no-array → [], sin tirar: JSON roto, objeto, escalar, null', async () => {
    for (const value of ['{corrupto', '[corrupto', { name: 'x' }, 42, null, 'texto']) {
      expect(await getAnnouncementTemplates(makeRepo([fila(value)]).repo)).toEqual({ templates: [] })
    }
  })

  it('ítems malformados dentro del array se descartan; icon/description faltantes toman default', async () => {
    const { repo } = makeRepo([fila([mantenimiento, { name: 'Sin type' }, null, { name: 'Corta', type: 'info', message: 'hola' }])])
    expect((await getAnnouncementTemplates(repo)).templates).toEqual([
      mantenimiento,
      { name: 'Corta', icon: '📌', description: '', type: 'info', message: 'hola' },
    ])
  })
})

describe('setAnnouncementTemplates — upsert de UNA fila platform/announcement_templates', () => {
  it('sin fila previa → crea {hotelId:platform, key:announcement_templates, value:[...]}', async () => {
    const { repo, filas } = makeRepo()
    expect(await setAnnouncementTemplates(repo, [mantenimiento])).toEqual({ templates: [mantenimiento] })
    expect(filas).toHaveLength(1)
    expect(filas[0]).toMatchObject({ hotelId: 'platform', key: 'announcement_templates', value: [mantenimiento] })
    expect(filas[0].id).toBeTruthy()
  })

  it('con fila previa → UPDATE sobre la misma id, sin duplicar', async () => {
    const { repo, filas, escrituras } = makeRepo([fila(JSON.stringify([mantenimiento]))])
    expect(await setAnnouncementTemplates(repo, [mantenimiento, novedad])).toEqual({ templates: [mantenimiento, novedad] })
    expect(filas).toHaveLength(1)
    expect(filas[0]).toMatchObject({ id: 'cfg-tpl', value: [mantenimiento, novedad] })
    expect(escrituras).toHaveLength(1)
    expect(escrituras[0].tipo).toBe('update')
  })

  it('icon/description opcionales → default 📌 / ""; name y type se recortan; lista vacía se acepta', async () => {
    const { repo } = makeRepo()
    const r = await setAnnouncementTemplates(repo, [{ name: '  Corta ', type: ' info ', message: 'hola' }])
    expect(r.templates).toEqual([{ name: 'Corta', icon: '📌', description: '', type: 'info', message: 'hola' }])
    expect(await setAnnouncementTemplates(makeRepo().repo, [])).toEqual({ templates: [] })
  })

  it('inválidos (no array, ítem no objeto, name vacío, type vacío, message no string, nombre duplicado, >50) → ValidationError y no escribe', async () => {
    const casos: unknown[] = [
      undefined,
      'no-array',
      { name: 'x' },
      ['texto'],
      [{ name: '', type: 'info', message: 'm' }],
      [{ name: '  ', type: 'info', message: 'm' }],
      [{ type: 'info', message: 'm' }],
      [{ name: 'A', type: '', message: 'm' }],
      [{ name: 'A', type: 'info', message: 7 }],
      [{ name: 'A', type: 'info', message: 'm', icon: 3 }],
      [{ name: 'Repetida', type: 'info', message: 'a' }, { name: 'repetida', type: 'urgent', message: 'b' }],
      Array.from({ length: ANNOUNCEMENT_TEMPLATES_MAX + 1 }, (_, i) => ({ name: `T${i}`, type: 'info', message: 'm' })),
    ]
    for (const templates of casos) {
      const { repo, escrituras } = makeRepo()
      await expect(setAnnouncementTemplates(repo, templates)).rejects.toThrow(ValidationError)
      expect(escrituras).toHaveLength(0)
    }
  })
})

// ── RUTA REAL: el módulo `admin` montado de verdad (Router + HotelAuth reales) ──────────────

/** ORM en memoria con estado por modelo (mismo que trial-days.test.ts). */
function memOrm(seed: Record<string, any[]> = {}) {
  const tables = new Map<string, any[]>()
  const rows = (m: string) => { if (!tables.has(m)) tables.set(m, []); return tables.get(m)! }
  for (const [m, list] of Object.entries(seed)) tables.set(m, list.map((r) => ({ ...r })))
  const match = (r: any, f: Record<string, unknown> = {}) => Object.entries(f).every(([k, v]) => r[k] === v)
  const orm: any = {
    define() { return orm },
    async findMany(m: string, f: any = {}) { return rows(m).filter((r) => match(r, f)) },
    async findOne(m: string, f: any) { return rows(m).find((r) => match(r, f)) ?? null },
    async findById(m: string, id: string) { return rows(m).find((r) => r.id === id) ?? null },
    async create(m: string, data: any) {
      const row = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...data }
      rows(m).push(row)
      return row
    },
    async update(m: string, id: string, data: any) {
      const list = rows(m)
      const i = list.findIndex((r) => r.id === id)
      if (i < 0) return null
      list[i] = { ...list[i], ...data, updatedAt: new Date().toISOString() }
      return list[i]
    },
    async delete(m: string, id: string) { const list = rows(m); const i = list.findIndex((r) => r.id === id); if (i >= 0) list.splice(i, 1); return i >= 0 },
    async count(m: string, f: any = {}) { return rows(m).filter((r) => match(r, f)).length },
    async paginate(m: string) { return { data: rows(m), total: rows(m).length, limit: 20, offset: 0 } },
    transaction: async (fn: any) => fn(orm),
  }
  return { orm, rows }
}

function mount() {
  const router = new Router()
  const auth = makeAuth()
  const { orm, rows } = memOrm()
  const cache = { get: async () => null, set: async () => {}, delete: async () => {} }
  ;(AdminModule() as any).create({ logger: fakeLogger(), orm, cache, router, auth })
  const superAdmin = { authorization: `Bearer ${auth.createToken({ id: 'sa-1', role: 'super_admin', hotelId: 'platform', userType: 'admin' })}` }
  const merchant = { authorization: `Bearer ${auth.createToken({ id: 'u-1', role: 'hotel_admin', hotelId: 'h1', userType: 'merchant' })}` }
  return { router, rows, superAdmin, merchant }
}

const URL = '/api/admin/announcement-templates'
const filasTpl = (rows: (m: string) => any[]) => rows('Configuration').filter((r) => r.key === 'announcement_templates')

describe('GET/PUT /api/admin/announcement-templates — happy path por ruta', () => {
  it('GET sin fila → 200 {templates:[]}', async () => {
    const { router, superAdmin } = mount()
    const res = await router.resolve('GET', URL, { headers: superAdmin })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ templates: [] })
  })

  it('PUT {templates:[...]} → 200, UNA fila platform/announcement_templates; el GET posterior (F5) devuelve la misma lista; re-PUT → update', async () => {
    const { router, rows, superAdmin } = mount()
    const res = await router.resolve('PUT', URL, { body: { templates: [mantenimiento, novedad] }, headers: superAdmin })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ templates: [mantenimiento, novedad] })
    expect(filasTpl(rows)).toHaveLength(1)
    expect(filasTpl(rows)[0]).toMatchObject({ hotelId: 'platform', key: 'announcement_templates', value: [mantenimiento, novedad] })

    const get = await router.resolve('GET', URL, { headers: superAdmin })
    expect(get.status).toBe(200)
    expect(get.body).toEqual({ templates: [mantenimiento, novedad] })

    const res2 = await router.resolve('PUT', URL, { body: { templates: [novedad] }, headers: superAdmin })
    expect(res2.status).toBe(200)
    expect(filasTpl(rows)).toHaveLength(1)
    expect((await router.resolve('GET', URL, { headers: superAdmin })).body).toEqual({ templates: [novedad] })
  })

  it('PUT inválido (sin templates, no array, name vacío, duplicado) → 400 y no crea la fila', async () => {
    for (const body of [{}, { templates: 'x' }, { templates: [{ name: '', type: 'info', message: 'm' }] }, { templates: [mantenimiento, { ...novedad, name: 'mantenimiento' }] }]) {
      const { router, rows, superAdmin } = mount()
      const res = await router.resolve('PUT', URL, { body, headers: superAdmin })
      expect(res.status).toBe(400)
      expect(filasTpl(rows)).toHaveLength(0)
    }
  })

  it('merchant (hotel_admin, userType merchant) → 403 en GET y PUT, sin escribir', async () => {
    const { router, rows, merchant } = mount()
    expect((await router.resolve('GET', URL, { headers: merchant })).status).toBe(403)
    const put = await router.resolve('PUT', URL, { body: { templates: [mantenimiento] }, headers: merchant })
    expect(put.status).toBe(403)
    expect(rows('Configuration')).toHaveLength(0)
  })
})
