// admin/tests/plans.test.ts — CRUD de planes SaaS (usecases/plans.ts) — SIN cobertura previa
// hasta esta tarea (QA 2026-08-30, reporte real: plan nuevo con solo el módulo "planning"
// salía mudo en la landing pública). Cubre `suggestPlanCopy` (usecases/modules.ts) y su
// wireado en createPlan/updatePlan: completa Descripción/Features desde el catálogo SOLO
// cuando el admin las dejó vacías, nunca pisa texto ya escrito a mano.
import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import { createPlan, updatePlan, type PlansDeps } from '../usecases/plans'
import { suggestPlanCopy } from '../usecases/modules'

const log = silentLogger()

function plansRepo(store: any[] = []) {
  let n = 0
  return {
    create: async (d: any) => { const row = { id: `gen${++n}`, ...d }; store.push(row); return row },
    findById: async (id: string) => store.find((r) => r.id === id) ?? null,
    update: async (id: string, patch: any) => {
      const r = store.find((x) => x.id === id)
      if (!r) return null
      Object.assign(r, patch)
      return r
    },
  } as any
}

function deps(store: any[] = []): PlansDeps {
  return {
    plansRepo: plansRepo(store),
    logger: log,
    platformResource: 'platform',
    auditPort: () => null,
  }
}

// ─── suggestPlanCopy ─────────────────────────────────────────────────────────
describe('modules — suggestPlanCopy (default de Descripción/Features desde el catálogo)', () => {
  it('sin módulos → vacío (nada que sugerir)', () => {
    expect(suggestPlanCopy([])).toEqual({ description: '', features: [] })
  })

  it('un solo módulo → descripción singular + 1 feature con el texto real del catálogo', () => {
    const out = suggestPlanCopy(['planning'])
    expect(out.description).toBe('Incluye Planning.')
    expect(out.features).toEqual(['Calendario de reservas, tarifas y temporadas'])
  })

  it('varios módulos → descripción con "y" antes del último, 1 feature por módulo', () => {
    const out = suggestPlanCopy(['planning', 'finance', 'crm'])
    expect(out.description).toBe('Incluye Planning, Finanzas y CRM.')
    expect(out.features).toHaveLength(3)
  })

  it('clave de submódulo suelta cuenta al módulo PADRE una sola vez (resumen a nivel producto)', () => {
    const out = suggestPlanCopy(['finance.billing', 'finance.caja'])
    expect(out.description).toBe('Incluye Finanzas.')
    expect(out.features).toHaveLength(1)
  })

  it('clave inválida/desconocida se ignora en silencio (no revienta, no aporta nada)', () => {
    const out = suggestPlanCopy(['no-existe'])
    expect(out).toEqual({ description: '', features: [] })
  })
})

// ─── createPlan ────────────────────────────────────────────────────────────
describe('admin/usecases/plans — createPlan', () => {
  it('módulos elegidos + Descripción/Features vacías → se autocompletan desde el catálogo', async () => {
    const item = await createPlan(deps(), { name: 'Solo Planning', price: 10, modules: ['planning'] })
    expect(item.description).toBe('Incluye Planning.')
    expect(item.features).toEqual(['Calendario de reservas, tarifas y temporadas'])
  })

  it('el admin SÍ escribió Descripción/Features → se respetan tal cual, sin tocar', async () => {
    const item = await createPlan(deps(), {
      name: 'Con copy propia', price: 10, modules: ['planning'],
      description: 'Mi copy de marketing', features: ['Beneficio a medida'],
    })
    expect(item.description).toBe('Mi copy de marketing')
    expect(item.features).toEqual(['Beneficio a medida'])
  })

  it('sin módulos → Descripción/Features quedan vacías (nada para sugerir), sin romper', async () => {
    const item = await createPlan(deps(), { name: 'Sin módulos', price: 10 })
    expect(item.description).toBe('')
    expect(item.features).toEqual([])
  })

  it('descripción vacía pero features SÍ escritas → solo se completa la descripción, features intactas', async () => {
    const item = await createPlan(deps(), {
      name: 'Mixto', price: 10, modules: ['planning'], features: ['Feature manual'],
    })
    expect(item.description).toBe('Incluye Planning.')
    expect(item.features).toEqual(['Feature manual'])
  })
})

// ─── updatePlan ────────────────────────────────────────────────────────────
describe('admin/usecases/plans — updatePlan', () => {
  it('se le agregan módulos a un plan que tenía Descripción/Features vacías → se completan', async () => {
    const store = [{ id: 'p1', name: 'Mudo', description: '', features: [], modules: [] }]
    const item = await updatePlan(deps(store), 'p1', { modules: ['planning'], description: '', features: [] })
    expect(item.description).toBe('Incluye Planning.')
    expect(item.features).toEqual(['Calendario de reservas, tarifas y temporadas'])
  })

  it('plan con copy manual ya guardada, el form reenvía el mismo texto al togglear módulos → NO se pisa', async () => {
    // Mismo patrón que plans.vue: el form manda SIEMPRE el estado completo (openEdit precarga
    // `plan.description`), así que un admin que ya escribió copy y solo agrega un módulo sigue
    // mandando su texto en el body — el fix NO debe reemplazarlo por la sugerencia.
    const store = [{ id: 'p1', name: 'Con copy', description: 'Texto que el admin ya escribió', features: ['Ya tenía esto'], modules: ['finance'] }]
    const item = await updatePlan(deps(store), 'p1', {
      modules: ['finance', 'planning'], description: 'Texto que el admin ya escribió', features: ['Ya tenía esto'],
    })
    expect(item.description).toBe('Texto que el admin ya escribió')
    expect(item.features).toEqual(['Ya tenía esto'])
  })

  it('regresión del reporte real: plan "KLk" (solo planning, description="") se autocompleta al guardar de nuevo', async () => {
    const store = [{ id: 'klk', name: 'KLk', description: '', features: [], modules: ['planning'] }]
    const item = await updatePlan(deps(store), 'klk', { modules: ['planning'], description: '', features: [] })
    expect(item.description).not.toBe('')
    expect(item.features.length).toBeGreaterThan(0)
  })

  it('404 si el plan no existe', async () => {
    await expect(updatePlan(deps(), 'nope', { modules: ['planning'] })).rejects.toThrow('no encontrado')
  })
})
