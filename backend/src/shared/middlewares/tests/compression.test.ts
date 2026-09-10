// #96: un Buffer (backup, PDF, CSV) no se puede pasar por JSON.stringify + gzip — llega corrupto.
import { describe, it, expect } from 'bun:test'
import { gunzipSync } from 'node:zlib'
import type { HttpRequest, HttpResponse } from 'arckode-framework'
import { jsonOnlyCompression } from '../compression'

function req(headers: Record<string, string> = {}): HttpRequest {
  return { id: 'r1', method: 'GET', path: '/x', params: {}, query: {}, headers, body: undefined } as HttpRequest
}
const gzip = { 'accept-encoding': 'gzip, deflate, br' }

describe('jsonOnlyCompression', () => {
  it('un Buffer ≥ umbral con Accept-Encoding: gzip sale byte a byte igual y sin Content-Encoding', async () => {
    const mw = jsonOnlyCompression({ threshold: 1024 })
    const bytes = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 256))
    const res = await mw(req(gzip), async () => ({ status: 200, body: bytes, headers: { 'Content-Type': 'application/octet-stream' } }))
    expect(res.body).toBe(bytes)
    expect(res.headers?.['Content-Encoding']).toBeUndefined()
    expect(res.headers?.['Content-Type']).toBe('application/octet-stream')
  })

  it('un JSON ≥ umbral se sigue comprimiendo como antes (gunzip → el mismo JSON)', async () => {
    const mw = jsonOnlyCompression({ threshold: 1024 })
    const body = { items: Array.from({ length: 200 }, (_, i) => ({ id: i, nombre: `fila-${i}` })) }
    const res = await mw(req(gzip), async () => ({ status: 200, body }))
    expect(res.headers?.['Content-Encoding']).toBe('gzip')
    expect(JSON.parse(gunzipSync(res.body as Buffer).toString())).toEqual(body)
  })

  it('sin Accept-Encoding: gzip nada cambia (JSON o Buffer)', async () => {
    const mw = jsonOnlyCompression({ threshold: 16 })
    const body = { a: 'x'.repeat(100) }
    const json = await mw(req(), async () => ({ status: 200, body }))
    expect(json.body).toBe(body)
    const bytes = Buffer.alloc(100, 1)
    const raw = await mw(req(), async () => ({ status: 200, body: bytes }))
    expect(raw.body).toBe(bytes)
  })

  it('204 / body null pasa intacto', async () => {
    const mw = jsonOnlyCompression()
    const res: HttpResponse = { status: 204, body: null }
    expect(await mw(req(gzip), async () => res)).toBe(res)
  })
})
