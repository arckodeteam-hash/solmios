// platform-identity.test.ts — Identidad de la plataforma leída de configuration('plataforma').
//
// Ancla CFG-1: los correos salían con 'SolmiOS' fijo aunque el super-admin hubiera cambiado el
// nombre en /admin/settings. Lo que importa acá es que la lectura NUNCA tire (un email no puede
// fallar por una config rota) y que los defaults apliquen campo a campo.
import { describe, it, expect } from 'bun:test'
import {
  DEFAULT_PLATFORM_IDENTITY,
  PLATFORM_IDENTITY_QUERY,
  readPlatformIdentity,
  platformVariables,
} from './platform-identity'

const rowWith = (value: unknown) => async () => ({ id: 'cfg-1', hotelId: 'platform', key: 'plataforma', value })

describe('readPlatformIdentity', () => {
  it('consulta la fila de la plataforma con el where canónico', async () => {
    const seen: Record<string, unknown>[] = []
    await readPlatformIdentity(async (query) => { seen.push(query); return null })
    expect(seen).toEqual([{ hotelId: 'platform', key: 'plataforma' }])
    expect(seen[0]).toEqual({ ...PLATFORM_IDENTITY_QUERY })
  })

  it('sin fila → defaults', async () => {
    expect(await readPlatformIdentity(async () => null)).toEqual(DEFAULT_PLATFORM_IDENTITY)
    expect(await readPlatformIdentity(async () => undefined)).toEqual(DEFAULT_PLATFORM_IDENTITY)
  })

  it('value como string JSON (SQLite) → parseado', async () => {
    const findOne = rowWith(JSON.stringify({
      platformName: 'HotelPro', supportEmail: 'ayuda@hotelpro.com', supportPhone: '+54 11 5555-0000',
      currency: 'ARS', timezone: 'America/Argentina/Buenos_Aires', customDomain: '',
    }))
    expect(await readPlatformIdentity(findOne)).toEqual({
      platformName: 'HotelPro', supportEmail: 'ayuda@hotelpro.com', supportPhone: '+54 11 5555-0000',
    })
  })

  it('value ya como objeto → usado tal cual', async () => {
    const findOne = rowWith({ platformName: 'HotelPro', supportEmail: 'ayuda@hotelpro.com', supportPhone: '123' })
    expect(await readPlatformIdentity(findOne)).toEqual({
      platformName: 'HotelPro', supportEmail: 'ayuda@hotelpro.com', supportPhone: '123',
    })
  })

  it('trimea los strings', async () => {
    const findOne = rowWith({ platformName: '  HotelPro  ', supportEmail: ' a@b.com ', supportPhone: ' 123 ' })
    expect(await readPlatformIdentity(findOne)).toEqual({
      platformName: 'HotelPro', supportEmail: 'a@b.com', supportPhone: '123',
    })
  })

  it('platformName vacío → default SÓLO en ese campo', async () => {
    const findOne = rowWith({ platformName: '   ', supportEmail: 'ayuda@hotelpro.com', supportPhone: '123' })
    expect(await readPlatformIdentity(findOne)).toEqual({
      platformName: DEFAULT_PLATFORM_IDENTITY.platformName,
      supportEmail: 'ayuda@hotelpro.com',
      supportPhone: '123',
    })
  })

  it('valores no-string → default del campo', async () => {
    const findOne = rowWith({ platformName: 42, supportEmail: null, supportPhone: { x: 1 } })
    expect(await readPlatformIdentity(findOne)).toEqual(DEFAULT_PLATFORM_IDENTITY)
  })

  it('JSON roto o value con forma rara → defaults', async () => {
    expect(await readPlatformIdentity(rowWith('{no es json'))).toEqual(DEFAULT_PLATFORM_IDENTITY)
    expect(await readPlatformIdentity(rowWith(['HotelPro']))).toEqual(DEFAULT_PLATFORM_IDENTITY)
    expect(await readPlatformIdentity(rowWith(null))).toEqual(DEFAULT_PLATFORM_IDENTITY)
  })

  it('findOne que rechaza → defaults, sin tirar', async () => {
    const findOne = async () => { throw new Error('db caída') }
    expect(await readPlatformIdentity(findOne)).toEqual(DEFAULT_PLATFORM_IDENTITY)
  })

  it('devuelve una copia: mutar el resultado no toca el default compartido', async () => {
    const result = await readPlatformIdentity(async () => null)
    result.platformName = 'Otro'
    expect(DEFAULT_PLATFORM_IDENTITY.platformName).toBe('SolmiOS')
  })
})

describe('platformVariables', () => {
  it('mapea las 3 claves que usan las plantillas', () => {
    expect(platformVariables({ platformName: 'HotelPro', supportEmail: 'a@b.com', supportPhone: '123' })).toEqual({
      platform_name: 'HotelPro',
      support_email: 'a@b.com',
      support_phone: '123',
    })
  })

  it('con los defaults deja support_phone vacío (la plantilla decide si lo muestra)', () => {
    expect(platformVariables(DEFAULT_PLATFORM_IDENTITY)).toEqual({
      platform_name: 'SolmiOS',
      support_email: 'soporte@solmios.com',
      support_phone: '',
    })
  })
})
