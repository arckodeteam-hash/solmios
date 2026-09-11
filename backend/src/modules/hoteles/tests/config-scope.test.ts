// hoteles/tests/config-scope.test.ts — POST /api/configuracion: el scope de ESCRITURA de
// `HotelesQueries.setConfig` coincide con el de LECTURA de `getConfig` (#80).
//
// Bug: un super_admin con hotel en el token guardaba la fila 'platform' (recibía 200 y toast
// de éxito), pero getConfig lee primero la fila del hotel → el valor "desaparecía" al recargar
// y además pisaba el default de plataforma de todos los hoteles. Ahora: super_admin →
// body.hotelId explícito (el panel de plataforma manda 'platform' a propósito), si no el
// hotelId del token, si no 'platform'. Merchant: siempre su hotel, ignorando body.hotelId.

import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter } from 'arckode-framework'
import { HotelesQueries } from '../usecases/hoteles-queries'

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

const SUPER_CON_HOTEL = { id: 'u-super', hotelId: 'h1', role: 'super_admin' }
const SUPER_SIN_HOTEL = { id: 'u-super', role: 'super_admin' }
const MERCHANT = { id: 'u-adm', hotelId: 'h1', role: 'hotel_admin' }

const AUTOMATION = { enabled: true, retries: 3 }

describe('HotelesQueries.setConfig — scope de escritura = scope de lectura (#80)', () => {
  it('super_admin con hotel en el token y sin body.hotelId: escribe la fila del hotel y getConfig la devuelve', async () => {
    const repo = fakeRepo()
    const queries = new HotelesQueries(repo.orm)
    const result = await queries.setConfig({ clave: 'automation_config', valor: AUTOMATION }, SUPER_CON_HOTEL)
    expect(result.success).toBe(true)
    expect(repo.creates.length).toBe(1)
    expect(repo.creates[0].hotelId).toBe('h1')
    expect(repo.creates[0].key).toBe('automation_config')
    // No contamina el default de plataforma.
    expect(repo.rows.some((r) => r.hotelId === 'platform')).toBe(false)
    // Round-trip: lo que se guardó es lo que se lee al recargar.
    const leido = await queries.getConfig('h1', 'automation_config')
    expect(leido.valor).toEqual(AUTOMATION)
  })

  it('super_admin con hotel en el token y body.hotelId "platform" explícito: escribe la fila platform (panel de plataforma)', async () => {
    const repo = fakeRepo()
    const queries = new HotelesQueries(repo.orm)
    await queries.setConfig({ clave: 'contactos_emergencia', valor: { police: '911' }, hotelId: 'platform' }, SUPER_CON_HOTEL)
    expect(repo.creates.length).toBe(1)
    expect(repo.creates[0].hotelId).toBe('platform')
  })

  it('super_admin sin hotel en el token y sin body.hotelId: escribe la fila platform', async () => {
    const repo = fakeRepo()
    const queries = new HotelesQueries(repo.orm)
    await queries.setConfig({ clave: 'currency_config', valor: { secondaryCurrency: 'DOP' } }, SUPER_SIN_HOTEL)
    expect(repo.creates.length).toBe(1)
    expect(repo.creates[0].hotelId).toBe('platform')
  })

  it('super_admin con hotelId "platform" en el token y sin body.hotelId: escribe la fila platform', async () => {
    const repo = fakeRepo()
    const queries = new HotelesQueries(repo.orm)
    await queries.setConfig({ clave: 'currency_config', valor: { secondaryCurrency: 'DOP' } }, { ...SUPER_SIN_HOTEL, hotelId: 'platform' })
    expect(repo.creates[0].hotelId).toBe('platform')
  })

  it('merchant con body.hotelId "platform": ignora el body y escribe la fila de su hotel', async () => {
    const repo = fakeRepo()
    const queries = new HotelesQueries(repo.orm)
    await queries.setConfig({ clave: 'invoice_policy_text', valor: 'texto', hotelId: 'platform' }, MERCHANT)
    expect(repo.creates.length).toBe(1)
    expect(repo.creates[0].hotelId).toBe('h1')
    expect(repo.creates[0].value).toBe('texto')
    expect(repo.rows.some((r) => r.hotelId === 'platform')).toBe(false)
    const leido = await queries.getConfig('h1', 'invoice_policy_text')
    expect(leido.valor).toBe('texto')
  })

  it('fila existente del hotel: super_admin con hotel actualiza en vez de crear y el round-trip devuelve el valor nuevo', async () => {
    const existing = { id: 'cfg-1', hotelId: 'h1', key: 'automation_config', value: JSON.stringify({ enabled: false }) }
    const platformDefault = { id: 'cfg-p', hotelId: 'platform', key: 'automation_config', value: JSON.stringify({ enabled: false, retries: 0 }) }
    const repo = fakeRepo([existing, platformDefault])
    const queries = new HotelesQueries(repo.orm)
    const result = await queries.setConfig({ clave: 'automation_config', valor: AUTOMATION }, SUPER_CON_HOTEL)
    expect(result.success).toBe(true)
    expect(repo.creates.length).toBe(0)
    expect(repo.updates.length).toBe(1)
    expect(repo.updates[0].id).toBe('cfg-1')
    const leido = await queries.getConfig('h1', 'automation_config')
    expect(leido.valor).toEqual(AUTOMATION)
    // El default de plataforma queda intacto.
    expect(JSON.parse(platformDefault.value)).toEqual({ enabled: false, retries: 0 })
  })
})
