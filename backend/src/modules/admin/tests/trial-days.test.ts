// admin/tests/trial-days.test.ts — key global `trial_days` (#103, CFG-6).
//
// Dos niveles: el usecase contra un repo en memoria que registra las escrituras (mismo molde
// que meta-app-config.test.ts) y el happy path + 400/403 por RUTA REAL montando `admin` de
// verdad (mold: extend-trial-route.test.ts). Lo que se afirma: setTrialDays(30) deja UNA fila
// {hotelId:'platform', key:'trial_days', value:{days:30}} (upsert si ya existía); get sin fila
// o con value malformado → 15 (fallback silencioso); fuera de rango (0, 366, negativo,
// no-entero) → ValidationError, que por ruta es 400.
import { describe, it, expect } from 'bun:test'
import { Router, ValidationError } from 'arckode-framework'
import { getTrialDays, setTrialDays, DEFAULT_TRIAL_DAYS } from '../usecases/trial-days'
import { AdminModule } from '../index'
import { makeAuth, fakeLogger } from '../../../infrastructure/auth/tests/route-permission-helpers'

/** Repo en memoria con registro de escrituras (mold: meta-app-config.test.ts). */
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

const fila = (value: unknown, id = 'cfg-trial') => ({ id, hotelId: 'platform', key: 'trial_days', value })

describe('getTrialDays — lectura con fallback silencioso', () => {
  it('sin fila → default 15 (los días históricos de TRIAL_DAYS)', async () => {
    const { repo } = makeRepo()
    expect(await getTrialDays(repo)).toEqual({ days: 15 })
    expect(DEFAULT_TRIAL_DAYS).toBe(15)
  })

  it('fila con {days:30} → 30 (también si el driver devolvió el json serializado)', async () => {
    expect((await getTrialDays(makeRepo([fila({ days: 30 })]).repo)).days).toBe(30)
    expect((await getTrialDays(makeRepo([fila(JSON.stringify({ days: 30 }))]).repo)).days).toBe(30)
  })

  it('value malformado → 15, sin tirar: objeto vacío, days no numérico, JSON corrupto, escalar', async () => {
    for (const value of [{}, { days: '30' }, { days: 7.5 }, '{corrupto', 42, null]) {
      const { repo } = makeRepo([fila(value)])
      expect(await getTrialDays(repo)).toEqual({ days: 15 })
    }
  })
})

describe('setTrialDays — upsert de UNA fila platform/trial_days', () => {
  it('sin fila previa → crea {hotelId:platform, key:trial_days, value:{days:30}}', async () => {
    const { repo, filas } = makeRepo()
    expect(await setTrialDays(repo, 30)).toEqual({ days: 30 })
    expect(filas).toHaveLength(1)
    expect(filas[0]).toMatchObject({ hotelId: 'platform', key: 'trial_days', value: { days: 30 } })
    expect(filas[0].id).toBeTruthy() // el id lo genera el usecase, no viene del caller
  })

  it('con fila previa → UPDATE sobre la misma id, sin duplicar', async () => {
    const { repo, filas, escrituras } = makeRepo([fila({ days: 15 })])
    expect(await setTrialDays(repo, 30)).toEqual({ days: 30 })
    expect(filas).toHaveLength(1)
    expect(filas[0]).toMatchObject({ id: 'cfg-trial', value: { days: 30 } })
    expect(escrituras).toHaveLength(1)
    expect(escrituras[0].tipo).toBe('update')
  })

  it('los límites del rango (1 y 365) se aceptan', async () => {
    expect((await setTrialDays(makeRepo().repo, 1)).days).toBe(1)
    expect((await setTrialDays(makeRepo().repo, 365)).days).toBe(365)
  })

  it('fuera de rango o no entero (0, 366, negativo, 7.5, "30") → ValidationError y no escribe', async () => {
    for (const days of [0, 366, -3, 7.5, '30' as any]) {
      const { repo, escrituras } = makeRepo()
      await expect(setTrialDays(repo, days)).rejects.toThrow(ValidationError)
      expect(escrituras).toHaveLength(0)
    }
  })
})

// ── RUTA REAL: el módulo `admin` montado de verdad (Router + HotelAuth reales) ──────────────

/** ORM en memoria con estado por modelo (mismo que extend-trial-route.test.ts). */
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

const URL = '/api/admin/subscriptions/trial-days'

describe('GET/PUT /api/admin/subscriptions/trial-days — happy path por ruta', () => {
  it('GET sin fila → 200 {days:15}', async () => {
    const { router, superAdmin } = mount()
    const res = await router.resolve('GET', URL, { headers: superAdmin })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ days: 15 })
  })

  it('PUT {days:30} → 200, queda UNA fila {hotelId:platform, key:trial_days, value:{days:30}}; re-PUT 45 → update', async () => {
    const { router, rows, superAdmin } = mount()
    const res = await router.resolve('PUT', URL, { body: { days: 30 }, headers: superAdmin })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ days: 30 })
    const trial = rows('Configuration').filter((r) => r.key === 'trial_days')
    expect(trial).toHaveLength(1)
    expect(trial[0]).toMatchObject({ hotelId: 'platform', key: 'trial_days', value: { days: 30 } })

    const res2 = await router.resolve('PUT', URL, { body: { days: 45 }, headers: superAdmin })
    expect(res2.status).toBe(200)
    expect(rows('Configuration').filter((r) => r.key === 'trial_days')).toHaveLength(1)
    // El GET inmediato ve el valor nuevo — la pestaña recarga del mismo lugar donde escribió.
    const get = await router.resolve('GET', URL, { headers: superAdmin })
    expect(get.body).toEqual({ days: 45 })
  })

  it('PUT fuera de rango (0, 366, -3, 7.5, "30") → 400 y no crea la fila', async () => {
    for (const days of [0, 366, -3, 7.5, '30']) {
      const { router, rows, superAdmin } = mount()
      const res = await router.resolve('PUT', URL, { body: { days }, headers: superAdmin })
      expect(res.status).toBe(400)
      expect(rows('Configuration').filter((r) => r.key === 'trial_days')).toHaveLength(0)
    }
  })

  it('merchant (hotel_admin) → 403, mismo guard que el resto de /subscriptions', async () => {
    const { router, rows, merchant } = mount()
    const res = await router.resolve('PUT', URL, { body: { days: 30 }, headers: merchant })
    expect(res.status).toBe(403)
    expect(rows('Configuration')).toHaveLength(0)
  })
})
