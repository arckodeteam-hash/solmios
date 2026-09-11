// modules/payment-gateways/tests/cardnet-sandbox.e2e.test.ts
//
// E2E contra el sandbox REAL de CardNet (labservicios.cardnet.com.do) con el comercio de pruebas
// público que publica la guía oficial:
//   https://developers.cardnet.com.do/guias/boton-de-pago/web-con-pantalla-post-3ds.html
// Se corre A MANO, no en CI (pega a internet):
//   CARDNET_SANDBOX=1 bun test --env-file .env.test src/modules/payment-gateways/tests/cardnet-sandbox.e2e.test.ts
// Sin la variable, la suite entera se salta. Nadie paga la sesión que se crea acá: la consulta
// tiene que devolver 404 rspdata_not_found (= todavía sin resultado) y el adapter, null.

import { describe, it, expect } from 'bun:test'
import { CardnetGateway, type CardnetSessionRow, type CardnetSessionStore } from '../../../services/payment-gateway/cardnet-gateway'

const TIMEOUT = 30_000

const rows = new Map<string, CardnetSessionRow>()
const store: CardnetSessionStore = {
  async save(row) { rows.set(row.id, row) },
  async load(id) { return rows.get(id) || null },
}

describe.skipIf(!process.env.CARDNET_SANDBOX)('CardNet sandbox real', () => {
  const gw = new CardnetGateway({ merchantNumber: '349011300', merchantTerminal: '00567856' }, 'test', store)
  let session = ''

  it('createCharge de 10000 DOP crea una sesión real y persiste SESSION + session-key', async () => {
    const res = await gw.createCharge({
      hotelId: 'h-sandbox', amountMinor: 10000, currency: 'dop', description: 'Prueba sandbox',
      reference: `SBX-${Date.now()}`, successUrl: 'https://localhost/api/pay/return/cardnet/h-sandbox',
      cancelUrl: 'https://localhost/cancel',
    })
    expect(res.status).toBe('redirect')
    if (res.status !== 'redirect') throw new Error(`createCharge falló: ${JSON.stringify(res)}`)
    session = res.providerRef
    expect(session.startsWith('sess-')).toBe(true)
    expect(res.redirectUrl).toBe(`https://localhost/api/pay/go/cardnet/h-sandbox?session=${session}`)

    const row = rows.get(session)
    expect(row?.id).toBe(session)
    expect(row?.sessionKey).toMatch(/^[0-9a-f]{64}$/)
    expect(row?.amountMinor).toBe(10000)
  }, TIMEOUT)

  it('confirm sobre la sesión sin pagar devuelve null (404 rspdata_not_found) y no tira', async () => {
    expect(session).not.toBe('')
    const outcome = await gw.confirm({ hotelId: 'h-sandbox', providerRef: session })
    expect(outcome).toBeNull()
  }, TIMEOUT)

  it('probe() responde ok:true contra labservicios', async () => {
    const r = await gw.probe()
    expect(r.ok).toBe(true)
    expect(r.message).toContain('labservicios.cardnet.com.do')
  }, TIMEOUT)
})
