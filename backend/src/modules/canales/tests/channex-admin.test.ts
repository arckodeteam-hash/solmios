// canales/tests/channex-admin.test.ts — Config Channex a nivel plataforma (white-label).
// Invariantes: la API key NUNCA sale cruda (se enmascara); guardar con apiKey vacío NO borra la
// existente (solo cambia el entorno); el entorno se normaliza a staging|production; el
// channexUserId se guarda con la misma disciplina que la key pero sale tal cual (no es un secreto).

import { describe, it, expect } from 'bun:test'
import { ChannexAdminService } from '../service-channex-admin'

/** ConfigUseCase falso con estado en memoria para getPlatformChannex/setPlatformChannex. */
function fakeConfig(initial: { apiKey?: string; environment?: string; channexUserId?: string } | null = null) {
  let store = initial ? { ...initial } : null
  return {
    getPlatformChannex: async () => store,
    setPlatformChannex: async (patch: any) => { store = { ...(store || {}), ...patch } },
    _dump: () => store,
  } as any
}

const fakeChannex = { testApiKey: async () => ({ success: true, message: 'ok', environment: 'staging' }) } as any

describe('ChannexAdminService', () => {
  it('getStatus enmascara la key y nunca la devuelve cruda', async () => {
    const svc = new ChannexAdminService(fakeConfig({ apiKey: 'abcd1234efgh5678', environment: 'staging' }), fakeChannex)
    const st = await svc.getStatus()
    expect(st.hasKey).toBe(true)
    expect(st.keyMasked).toBe('abcd••••5678')
    expect(JSON.stringify(st)).not.toContain('abcd1234efgh5678')
  })

  it('sin config: hasKey=false y entorno por defecto staging', async () => {
    const svc = new ChannexAdminService(fakeConfig(null), fakeChannex)
    const st = await svc.getStatus()
    expect(st).toEqual({ environment: 'staging', hasKey: false, keyMasked: '', channexUserId: '' })
  })

  it('save con apiKey vacío NO borra la key existente (solo cambia entorno)', async () => {
    const cfg = fakeConfig({ apiKey: 'secretkey123456', environment: 'staging' })
    const svc = new ChannexAdminService(cfg, fakeChannex)
    const st = await svc.save({ apiKey: '', environment: 'production' })
    expect(st.hasKey).toBe(true)
    expect(st.environment).toBe('production')
    expect(cfg._dump().apiKey).toBe('secretkey123456') // intacta
  })

  it('save con apiKey nueva la reemplaza y la recorta', async () => {
    const cfg = fakeConfig(null)
    const svc = new ChannexAdminService(cfg, fakeChannex)
    await svc.save({ apiKey: '  newkeyABCDEFGH  ', environment: 'staging' })
    expect(cfg._dump().apiKey).toBe('newkeyABCDEFGH')
  })

  it('save ignora un entorno inválido', async () => {
    const cfg = fakeConfig({ apiKey: 'k12345678', environment: 'staging' })
    const svc = new ChannexAdminService(cfg, fakeChannex)
    await svc.save({ environment: 'hackerman' as any })
    expect(cfg._dump().environment).toBe('staging')
  })

  it('save persiste el channexUserId y getStatus lo devuelve', async () => {
    const cfg = fakeConfig(null)
    const svc = new ChannexAdminService(cfg, fakeChannex)
    const st = await svc.save({ channexUserId: 'user-nuestro' })
    expect(st.channexUserId).toBe('user-nuestro')
    expect(cfg._dump().channexUserId).toBe('user-nuestro')
    expect((await svc.getStatus()).channexUserId).toBe('user-nuestro')
  })

  it('save sin channexUserId NO borra el ya guardado', async () => {
    const cfg = fakeConfig({ channexUserId: 'user-nuestro', environment: 'staging' })
    const svc = new ChannexAdminService(cfg, fakeChannex)
    const st = await svc.save({ apiKey: 'x' })
    expect(cfg._dump().channexUserId).toBe('user-nuestro')
    expect(st.channexUserId).toBe('user-nuestro')
  })

  it('save con channexUserId en blanco tampoco borra el ya guardado', async () => {
    const cfg = fakeConfig({ channexUserId: 'user-nuestro' })
    const svc = new ChannexAdminService(cfg, fakeChannex)
    const st = await svc.save({ channexUserId: '   ' })
    expect(cfg._dump().channexUserId).toBe('user-nuestro')
    expect(st.channexUserId).toBe('user-nuestro')
  })

  it('el channexUserId sale sin enmascarar (no es un secreto, a diferencia de la key)', async () => {
    const svc = new ChannexAdminService(fakeConfig({ apiKey: 'abcd1234efgh5678', channexUserId: 'usr-0123456789abcdef' }), fakeChannex)
    const st = await svc.getStatus()
    expect(st.channexUserId).toBe('usr-0123456789abcdef')
    expect(st.channexUserId).not.toContain('•')
    expect(st.keyMasked).toBe('abcd••••5678')
  })

  it('test delega en el cliente Channex', async () => {
    const svc = new ChannexAdminService(fakeConfig(null), fakeChannex)
    const r = await svc.test()
    expect(r.success).toBe(true)
  })
})
