// connectors/tests/marketing-whatsapp-meta.test.ts — Cableado marketing ← ai-recepcionista (Meta).
//
// El connector es el ÚNICO punto donde marketing alcanza las credenciales de WhatsApp del hotel.
// Lo que se verifica acá es la frontera: que traduzca "el hotel no conectó" a `null` (que es lo que
// dispara el 409 con mensaje claro) y que no invente credenciales a medias.

import { describe, it, expect } from 'bun:test'
import type { ConnectorContext } from 'arckode-framework'
import { marketingWhatsappMetaConnector } from '../marketing-whatsapp-meta'

/** Monta el conector y captura lo que le inyectó a marketing. */
function mount(credentials: any) {
  let deps: any = null
  const ctx = {
    resolveModule: (name: string) => {
      if (name === 'marketing') return { setMetaCredsDeps: (d: any) => { deps = d } }
      if (name === 'ai-recepcionista') return { getWhatsappCredentials: async () => credentials }
      throw new Error(`módulo desconocido: ${name}`)
    },
  } as unknown as ConnectorContext

  marketingWhatsappMetaConnector(ctx)
  return deps
}

describe('marketingWhatsappMetaConnector', () => {
  it('pasa las credenciales del hotel conectado', async () => {
    const deps = mount({ wabaId: 'waba1', accessToken: 'tok1', phoneNumberId: 'phone1' })
    expect(await deps.credentials.getMetaCredentials('h1')).toEqual({
      wabaId: 'waba1', accessToken: 'tok1', phoneNumberId: 'phone1',
    })
  })

  it('un hotel sin conexión devuelve null, no un objeto vacío', async () => {
    const deps = mount(null)
    expect(await deps.credentials.getMetaCredentials('h1')).toBeNull()
  })

  it('inyecta las dos operaciones del cliente de Meta', () => {
    const deps = mount(null)
    expect(typeof deps.client.create).toBe('function')
    expect(typeof deps.client.getStatus).toBe('function')
  })
})
