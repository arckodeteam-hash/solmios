// services/whatsapp-cloud-client.test.ts — Cliente de plantillas de Meta, con `fetch` simulado.
import { describe, it, expect, afterEach } from 'bun:test'
import { createMetaTemplate, getMetaTemplateStatus, deleteMetaTemplate, WhatsappCloudError } from './whatsapp-cloud-client'

const CREDS = { wabaId: 'waba1', accessToken: 'tok1' }
const realFetch = globalThis.fetch

/** Reemplaza `fetch` y guarda con qué lo llamaron, para poder afirmar sobre la request. */
function mockFetch(impl: (url: string, init: any) => Promise<Response> | Response) {
  const calls: Array<{ url: string; init: any }> = []
  globalThis.fetch = ((url: any, init: any) => {
    calls.push({ url: String(url), init })
    return Promise.resolve(impl(String(url), init))
  }) as any
  return calls
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
const fail = (status: number, error: unknown) => new Response(JSON.stringify({ error }), { status })

afterEach(() => { globalThis.fetch = realFetch })

describe('createMetaTemplate', () => {
  it('crea la plantilla y devuelve el id con el estado', async () => {
    const calls = mockFetch(() => ok({ id: 'meta123', status: 'PENDING', category: 'UTILITY' }))
    const r = await createMetaTemplate(CREDS, {
      name: 'bienvenida', language: 'es', category: 'UTILITY',
      components: [{ type: 'BODY', text: 'Hola {{1}}, gracias' }],
    })
    expect(r).toEqual({ id: 'meta123', status: 'PENDING', category: 'UTILITY' })
    expect(calls[0].url).toContain('/waba1/message_templates')
    expect(calls[0].init.method).toBe('POST')
  })

  // El token en la URL queda escrito en los logs de nginx y en el historial del proxy; en el header no.
  it('manda el token en el header, nunca en la URL', async () => {
    const calls = mockFetch(() => ok({ id: 'meta123', status: 'PENDING' }))
    await createMetaTemplate(CREDS, { name: 'x', language: 'es', category: 'UTILITY', components: [] })
    expect(calls[0].url).not.toContain('tok1')
    expect(calls[0].init.headers.Authorization).toBe('Bearer tok1')
  })

  it('sin token no sale a la red', async () => {
    const calls = mockFetch(() => ok({}))
    expect(createMetaTemplate({ wabaId: 'w', accessToken: '' }, { name: 'x', language: 'es', category: 'UTILITY', components: [] }))
      .rejects.toThrow(/token de acceso/)
    await Promise.resolve()
    expect(calls.length).toBe(0)
  })

  it('sin WABA ID no sale a la red', async () => {
    const calls = mockFetch(() => ok({}))
    expect(createMetaTemplate({ wabaId: '', accessToken: 't' }, { name: 'x', language: 'es', category: 'UTILITY', components: [] }))
      .rejects.toThrow(/WABA ID/)
    await Promise.resolve()
    expect(calls.length).toBe(0)
  })

  // Meta manda dos mensajes: `message` (técnico) y `error_user_msg` (redactado para humanos).
  // Cuando existe el segundo es el que sirve para mostrarle algo útil al hotel.
  it('prefiere el mensaje para humanos que manda Meta', async () => {
    mockFetch(() => fail(400, {
      message: '(#100) Invalid parameter',
      error_user_msg: 'Ya existe una plantilla con ese nombre.',
      code: 100, error_subcode: 2388023, fbtrace_id: 'AbC',
    }))
    try {
      await createMetaTemplate(CREDS, { name: 'repetida', language: 'es', category: 'UTILITY', components: [] })
      throw new Error('debería haber fallado')
    } catch (e) {
      expect(e).toBeInstanceOf(WhatsappCloudError)
      const err = e as WhatsappCloudError
      expect(err.message).toBe('Ya existe una plantilla con ese nombre.')
      expect(err.httpStatus).toBe(400)
      expect(err.metaCode).toBe(100)
      expect(err.fbtraceId).toBe('AbC')
    }
  })

  it('un token inválido llega como error 401 con el mensaje de Meta', async () => {
    mockFetch(() => fail(401, { message: 'Invalid OAuth access token', code: 190 }))
    expect(createMetaTemplate(CREDS, { name: 'x', language: 'es', category: 'UTILITY', components: [] }))
      .rejects.toThrow(/Invalid OAuth access token/)
  })

  // Que se caiga la red NO es un rechazo de Meta: es que no llegamos a preguntarle. La diferencia
  // importa porque un rechazo es definitivo y un corte de red se reintenta.
  it('un corte de red se reporta como 503, no como rechazo', async () => {
    mockFetch(() => { throw new Error('The operation timed out') })
    try {
      await createMetaTemplate(CREDS, { name: 'x', language: 'es', category: 'UTILITY', components: [] })
      throw new Error('debería haber fallado')
    } catch (e) {
      const err = e as WhatsappCloudError
      expect(err.httpStatus).toBe(503)
      expect(err.message).toContain('No se pudo contactar a Meta')
    }
  })
})

describe('getMetaTemplateStatus', () => {
  it('consulta por el id de la plantilla, no por la cuenta', async () => {
    const calls = mockFetch(() => ok({ status: 'APPROVED', rejected_reason: 'NONE' }))
    const r = await getMetaTemplateStatus(CREDS, 'meta123')
    expect(calls[0].url).toContain('/meta123?fields=status,rejected_reason')
    expect(r.status).toBe('APPROVED')
  })

  // Meta manda 'NONE' cuando no hubo rechazo; guardarlo tal cual mostraría "Motivo: NONE" en el panel.
  it('descarta el motivo "NONE" que manda Meta cuando no hubo rechazo', async () => {
    mockFetch(() => ok({ status: 'APPROVED', rejected_reason: 'NONE' }))
    const r = await getMetaTemplateStatus(CREDS, 'meta123')
    expect(r.rejectedReason).toBeUndefined()
  })

  it('conserva el motivo real del rechazo', async () => {
    mockFetch(() => ok({ status: 'REJECTED', rejected_reason: 'INVALID_FORMAT' }))
    const r = await getMetaTemplateStatus(CREDS, 'meta123')
    expect(r.rejectedReason).toBe('INVALID_FORMAT')
  })
})

describe('deleteMetaTemplate', () => {
  it('borra por nombre, como define la API de Meta', async () => {
    const calls = mockFetch(() => ok({ success: true }))
    await deleteMetaTemplate(CREDS, 'bienvenida')
    expect(calls[0].init.method).toBe('DELETE')
    expect(calls[0].url).toContain('name=bienvenida')
  })
})
