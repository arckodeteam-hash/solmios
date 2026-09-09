// ai-recepcionista/tests/whatsapp-delivery-status.test.ts — Acuses de entrega que informa Meta.
import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import { aplicarEstadosDeEntrega, debeAvanzar } from '../usecases/whatsapp-delivery-status'

const log = silentLogger()

function makePort(filas: Array<{ id: string; wamid: string; status?: string }>) {
  const escrituras: Array<{ id: string; patch: any }> = []
  return {
    escrituras,
    port: {
      findByProviderMessageId: async (wamid: string) => filas.find(f => f.wamid === wamid) ?? null,
      updateStatus: async (id: string, patch: any) => { escrituras.push({ id, patch }) },
    },
  }
}

describe('aplicarEstadosDeEntrega', () => {
  it('marca entregado el mensaje que Meta confirma', async () => {
    const { port, escrituras } = makePort([{ id: 'log1', wamid: 'wamid.A', status: 'sent' }])
    const out = await aplicarEstadosDeEntrega({ port, logger: log }, [{ id: 'wamid.A', status: 'delivered' }])
    expect(out.actualizados).toBe(1)
    expect(escrituras[0]).toEqual({ id: 'log1', patch: { status: 'delivered' } })
  })

  it('guarda el motivo cuando el mensaje falla', async () => {
    const { port, escrituras } = makePort([{ id: 'log1', wamid: 'wamid.A', status: 'sent' }])
    await aplicarEstadosDeEntrega({ port, logger: log }, [
      { id: 'wamid.A', status: 'failed', errors: [{ code: 131026, title: 'Message undeliverable' }] },
    ])
    expect(escrituras[0].patch.status).toBe('failed')
    expect(escrituras[0].patch.errorMessage).toBe('Message undeliverable')
  })

  // Un `wamid` de otro sistema conectado a la misma cuenta no es un error: devolver 4xx haría que
  // Meta reintente ese webhook para siempre.
  it('ignora en silencio un mensaje que no es nuestro', async () => {
    const { port, escrituras } = makePort([])
    const out = await aplicarEstadosDeEntrega({ port, logger: log }, [{ id: 'wamid.DESCONOCIDO', status: 'read' }])
    expect(out.ignorados).toBe(1)
    expect(escrituras.length).toBe(0)
  })

  it('procesa varios acuses en un mismo webhook', async () => {
    const { port, escrituras } = makePort([
      { id: 'log1', wamid: 'wamid.A', status: 'sent' },
      { id: 'log2', wamid: 'wamid.B', status: 'sent' },
    ])
    const out = await aplicarEstadosDeEntrega({ port, logger: log }, [
      { id: 'wamid.A', status: 'delivered' }, { id: 'wamid.B', status: 'read' },
    ])
    expect(out.actualizados).toBe(2)
    expect(escrituras.length).toBe(2)
  })

  it('descarta un acuse sin id o sin estado', async () => {
    const { port, escrituras } = makePort([{ id: 'log1', wamid: 'wamid.A', status: 'sent' }])
    const out = await aplicarEstadosDeEntrega({ port, logger: log }, [{ status: 'read' }, { id: 'wamid.A' }])
    expect(out.ignorados).toBe(2)
    expect(escrituras.length).toBe(0)
  })
})

describe('debeAvanzar', () => {
  it('avanza en el orden normal', () => {
    expect(debeAvanzar('queued', 'sent')).toBe(true)
    expect(debeAvanzar('sent', 'delivered')).toBe(true)
    expect(debeAvanzar('delivered', 'read')).toBe(true)
  })

  // Meta no garantiza el orden de sus propias notificaciones. Ver "entregado" después de "leído"
  // haría dudar de todo el historial.
  it('nunca retrocede con un acuse tardío', () => {
    expect(debeAvanzar('read', 'delivered')).toBe(false)
    expect(debeAvanzar('delivered', 'sent')).toBe(false)
    expect(debeAvanzar('read', 'read')).toBe(false)
  })

  it('un fallo siempre se anota, aunque llegue después', () => {
    expect(debeAvanzar('read', 'failed')).toBe(true)
  })

  it('un fallo ya anotado no se pisa con un estado viejo', () => {
    expect(debeAvanzar('failed', 'delivered')).toBe(false)
  })
})
