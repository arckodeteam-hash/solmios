// canales/tests/channex-admin.test.ts — Config Channex a nivel plataforma (white-label).
// Invariantes: la API key NUNCA sale cruda (se enmascara); guardar con apiKey vacío NO borra la
// existente (solo cambia el entorno); el entorno se normaliza a staging|production; el
// channexUserId se guarda con la misma disciplina que la key pero sale tal cual (no es un secreto).

import { describe, it, expect } from 'bun:test'
import { ChannexAdminService, planDaysLeft } from '../service-channex-admin'

/** ConfigUseCase falso con estado en memoria para getPlatformChannex/setPlatformChannex. */
function fakeConfig(initial: { apiKey?: string; environment?: string; channexUserId?: string } | null = null) {
  let store = initial ? { ...initial } : null
  return {
    getPlatformChannex: async () => store,
    setPlatformChannex: async (patch: any) => { store = { ...(store || {}), ...patch } },
    _dump: () => store,
  } as any
}

const fakeChannex = {
  testApiKey: async () => ({ success: true, message: 'ok', environment: 'staging' }),
  listWebhooks: async () => [],
  listProperties: async () => [],
} as any

/** CanalesQueries falso: solo lo que la tarjeta de cuenta lee (properties de hoteles + plan). */
function fakeQueries(configs: Array<{ channexPropertyId?: string }> = [], account: { planExpiresAt?: string } = {}) {
  let cuenta = { ...account }
  return {
    findMany: async (model: string) => (model === 'Canales' ? configs : []),
    getChannexAccount: async () => cuenta,
    setChannexAccount: async (patch: any) => { cuenta = { ...cuenta, ...patch } },
    _account: () => cuenta,
  } as any
}

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
    expect(st).toMatchObject({ environment: 'staging', hasKey: false, keyMasked: '', channexUserId: '' })
    // Sin credencial no se consulta Channex: la tarjeta tiene que abrir para poder CARGAR la key.
    expect(st.properties).toEqual({ inAccount: 0, hotelsWithProperty: 0, orphans: [] })
    expect(st.dashboardUrl).toBe('https://staging.channex.io')
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


// ── REQ-CAN-09: la tarjeta tiene que decir lo que hace falta para operar ─────────────────────
describe('ChannexAdminService — salud de la cuenta (REQ-CAN-09)', () => {
  const conKey = () => fakeConfig({ apiKey: 'abcd1234efgh5678', environment: 'production' })

  it('cruza las properties de la cuenta contra los hoteles y marca las huérfanas', async () => {
    const channex = {
      ...fakeChannex,
      listProperties: async () => [
        { id: 'p1', title: 'Hotel Uno' },
        { id: 'p2', title: 'Hotel Dos' },
        { id: 'p3', title: 'Prueba vieja' },
      ],
    } as any
    const svc = new ChannexAdminService(conKey(), channex, fakeQueries([{ channexPropertyId: 'p1' }, { channexPropertyId: 'p2' }]))
    const st = await svc.getStatus()
    expect(st.properties.inAccount).toBe(3)
    expect(st.properties.hotelsWithProperty).toBe(2)
    expect(st.properties.orphans).toEqual([{ id: 'p3', title: 'Prueba vieja' }])
  })

  it('el dashboard depende del entorno (staging y producción son cuentas distintas)', async () => {
    const svc = new ChannexAdminService(conKey(), fakeChannex, fakeQueries())
    expect((await svc.getStatus()).dashboardUrl).toBe('https://app.channex.io')
  })

  it('reconoce el webhook cuando la cuenta tiene registrado NUESTRO callback', async () => {
    const callback = 'https://hotel.example/api/channels/channex/webhook?api_key=xyz'
    const channex = {
      ...fakeChannex,
      listWebhooks: async () => [{ id: 'w1', callbackUrl: 'https://hotel.example/api/channels/channex/webhook?api_key=xyz', eventMask: '*', propertyId: null }],
    } as any
    const svc = new ChannexAdminService(conKey(), channex, fakeQueries())
    expect((await svc.getStatus(callback)).webhook.registered).toBe(true)
  })

  it('webhook sin registrar cuando el callback de la cuenta apunta a otro lado', async () => {
    const channex = {
      ...fakeChannex,
      listWebhooks: async () => [{ id: 'w1', callbackUrl: 'https://otro-pms.com/hook', eventMask: '*', propertyId: null }],
    } as any
    const svc = new ChannexAdminService(conKey(), channex, fakeQueries())
    const st = await svc.getStatus('https://hotel.example/api/channels/channex/webhook')
    expect(st.webhook.registered).toBe(false)
  })

  it('un error de Channex no tumba la tarjeta: viaja en el body', async () => {
    const channex = {
      ...fakeChannex,
      listProperties: async () => { throw new Error('401 Unauthorized') },
      listWebhooks: async () => { throw new Error('401 Unauthorized') },
    } as any
    const svc = new ChannexAdminService(conKey(), channex, fakeQueries())
    const st = await svc.getStatus()
    expect(st.properties.error).toContain('401')
    expect(st.webhook.error).toContain('401')
    expect(st.hasKey).toBe(true)
  })

  it('planExpiresAt se guarda y vuelve, con los días que faltan', async () => {
    const q = fakeQueries([], {})
    const svc = new ChannexAdminService(conKey(), fakeChannex, q)
    await svc.save({ planExpiresAt: '2026-09-09' })
    expect(q._account().planExpiresAt).toBe('2026-09-09')
    expect((await svc.getStatus()).planExpiresAt).toBe('2026-09-09')
  })

  it('un plan vencido queda marcado (el caso real: venció el 2026-09-09 y nadie se enteró)', async () => {
    const svc = new ChannexAdminService(conKey(), fakeChannex, fakeQueries([], { planExpiresAt: '2026-09-09' }))
    const st = await svc.getStatus('', new Date('2026-09-10T12:00:00Z'))
    expect(st.planExpired).toBe(true)
    expect(st.planDaysLeft).toBe(-1)
  })

  it('planDaysLeft cuenta por día calendario: el día del vencimiento da 0, no -1', () => {
    expect(planDaysLeft('2026-09-09', new Date('2026-09-09T23:00:00'))).toBe(0)
    expect(planDaysLeft('2026-09-24', new Date('2026-09-09T00:00:00'))).toBe(15)
    expect(planDaysLeft('', new Date())).toBeNull()
    expect(planDaysLeft('no-es-fecha', new Date())).toBeNull()
  })
})
