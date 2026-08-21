// admin/tests/modules.test.ts — Activar/desactivar módulos del producto (global, platform).
// Invariantes: default ON (módulo sin entrada = activo); el patch solo toca claves del catálogo;
// persiste como upsert en configuration(platform,'modules').

import { describe, it, expect } from 'bun:test'
import { MODULE_CATALOG, getModuleState, setModuleState, getModuleStateForPlan } from '../usecases/modules'

function configRepo(initial: Record<string, boolean> | null = null) {
  const rows: any[] = initial ? [{ id: 'c1', hotelId: 'platform', key: 'modules', value: { ...initial } }] : []
  return {
    rows,
    findMany: async (f: any) => rows.filter(r => Object.entries(f).every(([k, v]) => r[k] === v)),
    update: async (id: string, data: any) => { const r = rows.find(x => x.id === id); if (r) Object.assign(r, data); return r },
    create: async (data: any) => { rows.push({ ...data }); return data },
  } as any
}

/** Fila de configuration con el value TAL CUAL llega del motor (string JSON o corrupto). */
function configRepoRaw(value: unknown) {
  const row = { id: 'c1', hotelId: 'platform', key: 'modules', value }
  return {
    findMany: async (f: any) => [row].filter((r: any) => Object.entries(f).every(([k, v]) => r[k] === v)),
  } as any
}

describe('modules — estado', () => {
  it('sin config, todos los módulos vienen activados por default', async () => {
    const state = await getModuleState(configRepo(null))
    for (const m of MODULE_CATALOG) expect(state[m.key]).toBe(true)
  })

  it('un módulo seteado en false queda desactivado; el resto ON', async () => {
    const state = await getModuleState(configRepo({ crm: false }))
    expect(state.crm).toBe(false)
    expect(state.finance).toBe(true)
  })

  it('setModuleState aplica el patch y crea la fila si no existe', async () => {
    const repo = configRepo(null)
    const next = await setModuleState(repo, { hr: false, ai: false })
    expect(next.hr).toBe(false)
    expect(next.ai).toBe(false)
    expect(next.reservations).toBe(true)
    expect(repo.rows).toHaveLength(1)
    expect(repo.rows[0].value.hr).toBe(false)
  })

  it('setModuleState actualiza la fila existente sin duplicar', async () => {
    const repo = configRepo({ crm: false })
    await setModuleState(repo, { crm: true })
    expect(repo.rows).toHaveLength(1)
    expect((await getModuleState(repo)).crm).toBe(true)
  })

  it('ignora claves fuera del catálogo', async () => {
    const repo = configRepo(null)
    const next = await setModuleState(repo, { hackerModule: false } as any)
    expect((next as any).hackerModule).toBeUndefined()
  })

  // R3-3: `JSON.parse` del configuration(platform,'modules') sin guard → un valor corrupto
  // (escritura a mano, migración trunca) reventaba con 500 en CADA ruta gateada. Ahora:
  // defaults ON (la clave corrupta se ignora) + ERROR logueado, nunca silencioso.
  it('configuration(platform,modules) con JSON corrupto: defaults ON + ERROR, sin throw (R3-3)', async () => {
    const errors: string[] = []
    const logger = { warn: () => {}, error: (msg: string) => { errors.push(msg) } }
    const state = await getModuleState(configRepoRaw('{"crm": no-cierra'), logger as any)
    for (const m of MODULE_CATALOG) expect(state[m.key]).toBe(true) // default ON: la toggle global se pierde, no el hotel
    expect(errors.length).toBeGreaterThan(0)
  })
})

describe('modules — estado efectivo por plan (global ∩ plan)', () => {
  const plansRepo = (modules: string[] | undefined) => ({
    findMany: async (_f: any) => (modules === undefined ? [] : [{ id: 'p1', slug: 'basico', modules }]),
  }) as any

  it('plan con módulos: solo esos quedan ON (más el ∩ global)', async () => {
    const state = await getModuleStateForPlan(configRepo(null), plansRepo(['reservations', 'finance']), 'basico')
    expect(state.reservations).toBe(true)
    expect(state.finance).toBe(true)
    expect(state.crm).toBe(false)   // no está en el plan
    expect(state.ai).toBe(false)
  })

  it('plan SIN módulos definidos = todos (retrocompat)', async () => {
    const state = await getModuleStateForPlan(configRepo(null), plansRepo([]), 'basico')
    for (const m of MODULE_CATALOG) expect(state[m.key]).toBe(true)
  })

  it('un módulo apagado GLOBAL manda aunque el plan lo incluya', async () => {
    const state = await getModuleStateForPlan(configRepo({ finance: false }), plansRepo(['finance', 'reservations']), 'basico')
    expect(state.finance).toBe(false)   // global OFF gana
    expect(state.reservations).toBe(true)
  })

  it('sin planSlug (super_admin) = solo el global', async () => {
    const state = await getModuleStateForPlan(configRepo({ crm: false }), plansRepo(['reservations']), undefined)
    expect(state.crm).toBe(false)
    expect(state.ai).toBe(true)   // no se filtra por plan
  })
})
