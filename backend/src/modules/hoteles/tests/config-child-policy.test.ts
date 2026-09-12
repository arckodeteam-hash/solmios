// hoteles/tests/config-child-policy.test.ts — POST /api/configuracion (clave child_policy):
// el backend rechaza `childrenRatePercent` fuera de [1,100] cuando la regla de cobro por %
// está prendida (#95, "Cobro % niños").
//
// Se prueba `HotelesQueries.setConfig` directo, que es el write path real de este endpoint
// (controller/service son adaptadores que sólo pasan clave/valor; `config-kv.ts` no es la ruta
// de POST /api/configuracion). Con `childrenDiscountEnabled` apagado el % NO se valida: queda
// inerte (el motor público lo ignora) y los forms guardan un % a medias sin bloquearse.

import { describe, it, expect } from 'bun:test'
import { ValidationError } from 'arckode-framework'
import type { RepositoryAdapter } from 'arckode-framework'
import { HotelesQueries } from '../usecases/hoteles-queries'

const USER = { id: 'u1', hotelId: 'h1', role: 'merchant' }

/** Fake del orm con findMany/update/create capturados — mismo contrato que el resto del módulo. */
function fakeRepo(rows: any[] = []) {
  const creates: any[] = []
  const updates: { id: string; patch: any }[] = []
  const orm = {
    findMany: async (model: string, filter: any = {}) =>
      model === 'Configuration'
        ? rows.filter((r) => Object.entries(filter).every(([k, v]) => r[k] === v))
        : [],
    update: async (_model: string, id: string, patch: any) => {
      updates.push({ id, patch })
      const row = rows.find((r) => r.id === id)
      if (row) Object.assign(row, patch)
    },
    create: async (_model: string, data: any) => { creates.push(data); rows.push(data) },
  } as unknown as RepositoryAdapter<any>
  return { orm, creates, updates, rows }
}

function policy(over: Record<string, any> = {}) {
  return {
    acceptChildren: true, maxChildAge: 12, maxFreeAge: 3, maxBabyAge: 0,
    childrenDiscountEnabled: true, childrenRatePercent: 50, cribAvailable: false,
    ...over,
  }
}

async function guardar(valor: any, clave = 'child_policy') {
  const repo = fakeRepo()
  const queries = new HotelesQueries(repo.orm)
  const result = await queries.setConfig({ clave, valor }, USER)
  return { repo, result }
}

describe('HotelesQueries.setConfig — childrenRatePercent (#95)', () => {
  it('regla prendida + 0%: rechaza con ValidationError antes de escribir', async () => {
    const repo = fakeRepo()
    const queries = new HotelesQueries(repo.orm)
    expect(queries.setConfig({ clave: 'child_policy', valor: policy({ childrenRatePercent: 0 }) }, USER))
      .rejects.toBeInstanceOf(ValidationError)
    try {
      await queries.setConfig({ clave: 'child_policy', valor: policy({ childrenRatePercent: 0 }) }, USER)
      throw new Error('debía rechazar')
    } catch (e) {
      expect((e as Error).message).toContain('entre 1% y 100%')
    }
    // El rechazo es ANTES del write: no queda fila creada ni actualizada.
    expect(repo.creates.length).toBe(0)
    expect(repo.updates.length).toBe(0)
  })

  it('regla prendida + 101%: rechaza', async () => {
    const repo = fakeRepo()
    const queries = new HotelesQueries(repo.orm)
    expect(queries.setConfig({ clave: 'child_policy', valor: policy({ childrenRatePercent: 101 }) }, USER))
      .rejects.toBeInstanceOf(ValidationError)
    expect(repo.creates.length).toBe(0)
  })

  it('regla prendida + % no numérico ("abc", undefined, NaN): rechaza', async () => {
    const repo = fakeRepo()
    const queries = new HotelesQueries(repo.orm)
    for (const pct of ['abc', undefined, NaN]) {
      let thrown: any
      try { await queries.setConfig({ clave: 'child_policy', valor: policy({ childrenRatePercent: pct }) }, USER) }
      catch (e) { thrown = e }
      expect(thrown).toBeInstanceOf(ValidationError)
    }
    expect(repo.creates.length).toBe(0)
  })

  it('regla prendida + 1, 50 y 100 (límites incluidos): persiste cada valor', async () => {
    for (const pct of [1, 50, 100]) {
      const { repo, result } = await guardar(policy({ childrenRatePercent: pct }))
      expect(result.success).toBe(true)
      expect(repo.creates.length).toBe(1)
      expect(repo.creates[0].key).toBe('child_policy')
      expect(repo.creates[0].hotelId).toBe('h1')
      expect(JSON.parse(repo.creates[0].value).childrenRatePercent).toBe(pct)
    }
  })

  it('valor como string JSON (cliente crudo): se valida igual', async () => {
    const repo = fakeRepo()
    const queries = new HotelesQueries(repo.orm)
    expect(queries.setConfig({ clave: 'child_policy', valor: JSON.stringify(policy({ childrenRatePercent: 150 })) }, USER))
      .rejects.toBeInstanceOf(ValidationError)
    expect(repo.creates.length).toBe(0)
  })

  it('regla APAGADA + 150%: persiste (el % queda inerte, no bloquea el guardado)', async () => {
    const { repo, result } = await guardar(policy({ childrenDiscountEnabled: false, childrenRatePercent: 150 }))
    expect(result.success).toBe(true)
    expect(repo.creates.length).toBe(1)
    expect(JSON.parse(repo.creates[0].value).childrenRatePercent).toBe(150)
  })

  it('otra clave cualquiera: persiste sin validar (comportamiento intacto)', async () => {
    const { repo, result } = await guardar({ secondaryCurrency: 'DOP' }, 'currency_config')
    expect(result.success).toBe(true)
    expect(repo.creates[0].key).toBe('currency_config')
    expect(repo.creates[0].value).toBe(JSON.stringify({ secondaryCurrency: 'DOP' }))
  })

  it('child_policy con fila existente: actualiza en vez de crear', async () => {
    const existing = { id: 'cfg-1', hotelId: 'h1', key: 'child_policy', value: '{}' }
    const repo = fakeRepo([existing])
    const queries = new HotelesQueries(repo.orm)
    const result = await queries.setConfig({ clave: 'child_policy', valor: policy({ childrenRatePercent: 75 }) }, USER)
    expect(result.success).toBe(true)
    expect(repo.creates.length).toBe(0)
    expect(repo.updates.length).toBe(1)
    expect(repo.updates[0].id).toBe('cfg-1')
    expect(JSON.parse(repo.updates[0].patch.value).childrenRatePercent).toBe(75)
  })
})

// ─── REQ-03 (#235) — maxFreeChildrenPerRoom ───────────────────────────────────────────────────
// Ausente/null = sin límite (válido). Si viene, entero ≥ 0. Se valida siempre, sin depender de
// `childrenDiscountEnabled` — es otra regla.
describe('HotelesQueries.setConfig — maxFreeChildrenPerRoom (REQ-03 #235)', () => {
  it('-1, 1.5 y "x": rechaza con ValidationError antes de escribir', async () => {
    for (const max of [-1, 1.5, 'x']) {
      const repo = fakeRepo()
      const queries = new HotelesQueries(repo.orm)
      let thrown: any
      try { await queries.setConfig({ clave: 'child_policy', valor: policy({ maxFreeChildrenPerRoom: max }) }, USER) }
      catch (e) { thrown = e }
      expect(thrown).toBeInstanceOf(ValidationError)
      expect(thrown.message).toContain('entero mayor o igual a 0')
      expect(repo.creates.length).toBe(0)
      expect(repo.updates.length).toBe(0)
    }
  })

  it('se valida aunque la regla de cobro % esté apagada (es otra regla)', async () => {
    const repo = fakeRepo()
    const queries = new HotelesQueries(repo.orm)
    expect(queries.setConfig({ clave: 'child_policy', valor: policy({ childrenDiscountEnabled: false, maxFreeChildrenPerRoom: -1 }) }, USER))
      .rejects.toBeInstanceOf(ValidationError)
    expect(repo.creates.length).toBe(0)
  })

  it('valor como string JSON (cliente crudo): se valida igual', async () => {
    const repo = fakeRepo()
    const queries = new HotelesQueries(repo.orm)
    expect(queries.setConfig({ clave: 'child_policy', valor: JSON.stringify(policy({ maxFreeChildrenPerRoom: 1.5 })) }, USER))
      .rejects.toBeInstanceOf(ValidationError)
    expect(repo.creates.length).toBe(0)
  })

  it('null, 0 y 2: persiste cada valor tal cual (null = sin límite, 0 es un tope válido)', async () => {
    for (const max of [null, 0, 2]) {
      const { repo, result } = await guardar(policy({ maxFreeChildrenPerRoom: max }))
      expect(result.success).toBe(true)
      expect(repo.creates.length).toBe(1)
      expect(JSON.parse(repo.creates[0].value).maxFreeChildrenPerRoom).toBe(max)
    }
  })

  it('ausente: persiste sin el campo (sin límite, nunca se inyecta un default numérico)', async () => {
    const { repo, result } = await guardar(policy())
    expect(result.success).toBe(true)
    expect(repo.creates.length).toBe(1)
    expect('maxFreeChildrenPerRoom' in JSON.parse(repo.creates[0].value)).toBe(false)
  })
})
