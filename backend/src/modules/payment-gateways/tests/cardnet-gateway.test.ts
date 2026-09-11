// modules/payment-gateways/tests/cardnet-gateway.test.ts
//
// Cubre el adapter de CardNet Payment Page (services/payment-gateway/cardnet-gateway.ts) con un
// store de sesiones en memoria y `fetch` inyectado. Los mocks reproducen las formas REALES que
// devolvió el sandbox labservicios.cardnet.com.do el 2026-09-11 (POST /sessions, GET /sessions/{id}?sk=).
// El e2e contra el sandbox vive en cardnet-sandbox.e2e.test.ts (se corre a mano).

import { describe, it, expect } from 'bun:test'
import {
  CardnetGateway, CARDNET_DEFAULT_ACQUIRER, CARDNET_HOST, cardnetCurrencyCode, formatCardnetAmount, toCardnetCredentials,
  type CardnetSessionRow, type CardnetSessionStore,
} from '../../../services/payment-gateway/cardnet-gateway'
import { hasHostedForm } from '../../../services/payment-gateway/types'

const creds = { merchantNumber: '349011300', merchantTerminal: '00567856', currency: 'dop' }
const SESSION = 'sess-add2934c24a7e0cb39e9e200a51931ab'
const SK = '1a23b5b3'.repeat(8) // 64 hex

function memStore(seed: CardnetSessionRow[] = []): CardnetSessionStore & { rows: Map<string, CardnetSessionRow> } {
  const rows = new Map(seed.map(r => [r.id, r]))
  return {
    rows,
    async save(row) { rows.set(row.id, row) },
    async load(id) { return rows.get(id) || null },
  }
}

/** fetch falso que registra las llamadas y responde lo que le digan. */
function fakeFetch(respond: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fn = (async (url: any, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return respond(String(url), init)
  }) as unknown as typeof fetch
  return { fn, calls }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const sessionOk = () => json({ SESSION, 'session-key': SK })

const chargeReq = {
  hotelId: 'h1', amountMinor: 250000, currency: 'dop', description: 'Pago de folio',
  reference: 'FOLIO-42-una-referencia-larga', successUrl: 'https://hotel.test/api/pay/return/cardnet/h1?next=%2Fok',
  cancelUrl: 'https://hotel.test/cancel',
}

const knownRow: CardnetSessionRow = {
  id: SESSION, hotelId: 'h1', provider: 'cardnet', reference: 'FOLIO-42', secret: SK,
  amountMinor: 250000, currency: 'dop', mode: 'test',
}

describe('CardnetGateway — capacidades y credenciales', () => {
  it('declara confirmation "pull" y NO soporta refund/void (Payment Page no los tiene)', () => {
    const g = new CardnetGateway(creds, 'test', memStore(), fakeFetch(sessionOk).fn)
    expect(g.capabilities.confirmation).toBe('pull')
    expect(g.capabilities.refund).toBe(false)
    expect(g.capabilities.void).toBe(false)
    expect(g.capabilities.paymentLinks).toBe(false)
    expect(hasHostedForm(g)).toBe(true)
  })

  it('exige comercio y terminal al construir', () => {
    expect(() => new CardnetGateway({ merchantNumber: '', merchantTerminal: 'T' }, 'test', memStore())).toThrow(/MerchantNumber/)
    expect(() => new CardnetGateway({ merchantNumber: 'C', merchantTerminal: '' }, 'test', memStore())).toThrow(/MerchantTerminal/)
  })

  it('toCardnetCredentials mapea merchantId/terminalId y los opcionales', () => {
    expect(toCardnetCredentials({ merchantId: '349011300', terminalId: '00567856' })).toEqual({
      merchantNumber: '349011300', merchantTerminal: '00567856',
      merchantName: undefined, merchantType: undefined, acquiringInstitutionCode: undefined, currency: undefined,
    })
    expect(toCardnetCredentials({ merchantId: 'M', terminalId: 'T', merchantName: 'HOTEL SOL', merchantType: '7011', currency: 'usd' }))
      .toEqual({ merchantNumber: 'M', merchantTerminal: 'T', merchantName: 'HOTEL SOL', merchantType: '7011', acquiringInstitutionCode: undefined, currency: 'usd' })
  })

  it('toCardnetCredentials mapea acquiringInstitutionCode cuando el ejecutivo entregó otro', () => {
    expect(toCardnetCredentials({ merchantId: 'M', terminalId: 'T', acquiringInstitutionCode: '123' }).acquiringInstitutionCode).toBe('123')
  })

  it('helpers puros: monto de 12 dígitos y código ISO numérico de moneda', () => {
    expect(formatCardnetAmount(10000)).toBe('000000010000')
    expect(cardnetCurrencyCode('dop')).toBe('214')
    expect(cardnetCurrencyCode('usd')).toBe('840')
    expect(cardnetCurrencyCode('eur')).toBeNull()
    expect(CARDNET_HOST.test).toBe('https://labservicios.cardnet.com.do')
    expect(CARDNET_HOST.live).toBe('https://ecommerce.cardnet.com.do')
  })
})

describe('CardnetGateway — createCharge (POST /sessions + fila persistida)', () => {
  it('crea la sesión en labservicios con el body de la guía, guarda la fila y redirige a la página go', async () => {
    const store = memStore()
    const f = fakeFetch(sessionOk)
    const g = new CardnetGateway(creds, 'test', store, f.fn)
    const res = await g.createCharge(chargeReq)

    expect(res.status).toBe('redirect')
    if (res.status !== 'redirect') throw new Error('unreachable')
    expect(res.providerRef).toBe(SESSION)
    expect(res.redirectUrl).toBe(`https://hotel.test/api/pay/go/cardnet/h1?session=${SESSION}`)

    expect(f.calls).toHaveLength(1)
    expect(f.calls[0].url).toBe('https://labservicios.cardnet.com.do/sessions')
    expect(f.calls[0].init?.method).toBe('POST')
    const body = JSON.parse(String(f.calls[0].init?.body))
    expect(body).toMatchObject({
      TransactionType: '0200', CurrencyCode: '214', AcquiringInstitutionCode: '349',
      MerchantNumber: '349011300', MerchantTerminal: '00567856',
      ReturnUrl: chargeReq.successUrl, CancelUrl: chargeReq.cancelUrl,
      PageLanguaje: 'ESP', Tax: '000000000000', Amount: '000000250000',
    })
    expect(body.OrdenId).toBe('FOLIO-42-una-referen') // truncado a 20
    expect(body.OrdenId).toHaveLength(20)
    expect(body.TransactionId).toMatch(/^\d{6}$/)
    expect(body.MerchantName).toBeUndefined() // opcionales sólo si están

    expect(store.rows.get(SESSION)).toEqual({
      id: SESSION, hotelId: 'h1', provider: 'cardnet', reference: chargeReq.reference, secret: SK,
      amountMinor: 250000, currency: 'dop', mode: 'test',
    })
  })

  it('manda MerchantName/MerchantType cuando están en las credenciales', async () => {
    const f = fakeFetch(sessionOk)
    const g = new CardnetGateway({ ...creds, merchantName: 'HOTEL SOL', merchantType: '7011' }, 'test', memStore(), f.fn)
    await g.createCharge(chargeReq)
    expect(JSON.parse(String(f.calls[0].init?.body))).toMatchObject({ MerchantName: 'HOTEL SOL', MerchantType: '7011' })
  })

  it('AcquiringInstitutionCode: 349 por defecto (guía oficial) y pisable desde las credenciales', async () => {
    expect(CARDNET_DEFAULT_ACQUIRER).toBe('349')
    const porDefecto = fakeFetch(sessionOk)
    await new CardnetGateway(creds, 'test', memStore(), porDefecto.fn).createCharge(chargeReq)
    expect(JSON.parse(String(porDefecto.calls[0].init?.body)).AcquiringInstitutionCode).toBe('349')

    const propio = fakeFetch(sessionOk)
    await new CardnetGateway({ ...creds, acquiringInstitutionCode: '123' }, 'test', memStore(), propio.fn).createCharge(chargeReq)
    expect(JSON.parse(String(propio.calls[0].init?.body)).AcquiringInstitutionCode).toBe('123')
  })

  it('en modo live usa ecommerce.cardnet.com.do', async () => {
    const f = fakeFetch(sessionOk)
    const g = new CardnetGateway(creds, 'live', memStore(), f.fn)
    const res = await g.createCharge({ ...chargeReq, currency: 'usd' })
    expect(res.status).toBe('redirect')
    expect(f.calls[0].url).toBe('https://ecommerce.cardnet.com.do/sessions')
    expect(JSON.parse(String(f.calls[0].init?.body)).CurrencyCode).toBe('840')
  })

  it('moneda que CardNet no procesa (EUR) → failed sin llamar al proveedor', async () => {
    const f = fakeFetch(sessionOk)
    const g = new CardnetGateway(creds, 'test', memStore(), f.fn)
    const res = await g.createCharge({ ...chargeReq, currency: 'eur' })
    expect(res).toEqual({ status: 'failed', reason: 'CardNet sólo cobra en DOP o USD' })
    expect(f.calls).toHaveLength(0)
  })

  it('monto no entero → failed', async () => {
    const g = new CardnetGateway(creds, 'test', memStore(), fakeFetch(sessionOk).fn)
    const res = await g.createCharge({ ...chargeReq, amountMinor: 12.5 })
    expect(res.status).toBe('failed')
  })

  it('respuesta sin SESSION → failed y no guarda nada', async () => {
    const store = memStore()
    const g = new CardnetGateway(creds, 'test', store, fakeFetch(() => json({ message: 'bad_request' }, 400)).fn)
    const res = await g.createCharge(chargeReq)
    expect(res.status).toBe('failed')
    if (res.status !== 'failed') throw new Error('unreachable')
    expect(res.reason).toContain('bad_request')
    expect(store.rows.size).toBe(0)

    const g2 = new CardnetGateway(creds, 'test', store, fakeFetch(() => json({ SESSION })).fn) // sin session-key
    expect((await g2.createCharge(chargeReq)).status).toBe('failed')
  })

  it('fetch tira (red caída) → failed', async () => {
    const g = new CardnetGateway(creds, 'test', memStore(), fakeFetch(() => { throw new Error('ECONNREFUSED') }).fn)
    const res = await g.createCharge(chargeReq)
    expect(res.status).toBe('failed')
    if (res.status !== 'failed') throw new Error('unreachable')
    expect(res.reason).toContain('ECONNREFUSED')
  })
})

describe('CardnetGateway — hostedForm', () => {
  it('apunta a {host}/authorize con el campo SESSION', () => {
    const g = new CardnetGateway(creds, 'test', memStore(), fakeFetch(sessionOk).fn)
    expect(g.hostedForm(SESSION)).toEqual({
      action: 'https://labservicios.cardnet.com.do/authorize', fields: { SESSION },
    })
    const live = new CardnetGateway(creds, 'live', memStore(), fakeFetch(sessionOk).fn)
    expect(live.hostedForm(SESSION).action).toBe('https://ecommerce.cardnet.com.do/authorize')
  })
})

describe('CardnetGateway — confirm() vía GET /sessions/{SESSION}?sk= (modo pull)', () => {
  const statusOf = (ResponseCode: string) => json({
    ResponseCode, TransactionId: '160091', TransactionID: '160091', OrdenID: 'FOLIO-42',
    RemoteResponseCode: 'N/A', AuthorizationCode: 'N/A', RetrivalReferenceNumber: '000000000013',
    CreditCardNumber: '411111______1111', TxToken: 'txn-3JBwK', SESSION: '2D1FD308-0000',
  })

  it('fila conocida + ResponseCode 00 → paid con monto/moneda/referencia de la fila', async () => {
    const f = fakeFetch(() => statusOf('00'))
    const g = new CardnetGateway(creds, 'test', memStore([knownRow]), f.fn)
    const outcome = await g.confirm({ hotelId: 'h1', providerRef: SESSION })
    expect(outcome).toMatchObject({
      eventId: SESSION, providerRef: SESSION, status: 'paid',
      amountMinor: 250000, currency: 'dop', reference: 'FOLIO-42',
    })
    expect((outcome?.raw as any).ResponseCode).toBe('00')
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0].url).toBe(`https://labservicios.cardnet.com.do/sessions/${SESSION}?sk=${SK}`)
  })

  it('ResponseCode 03 (rechazada) → failed', async () => {
    const g = new CardnetGateway(creds, 'test', memStore([knownRow]), fakeFetch(() => statusOf('03')).fn)
    const outcome = await g.confirm({ hotelId: 'h1', providerRef: SESSION })
    expect(outcome?.status).toBe('failed')
    expect(outcome?.amountMinor).toBe(250000)
  })

  it('404 rspdata_not_found (el tarjetahabiente no terminó) → null, no es fallo', async () => {
    const g = new CardnetGateway(creds, 'test', memStore([knownRow]), fakeFetch(() => json({ message: 'rspdata_not_found' }, 404)).fn)
    expect(await g.confirm({ hotelId: 'h1', providerRef: SESSION })).toBeNull()
  })

  it('400 invalid_sk → null', async () => {
    const g = new CardnetGateway(creds, 'test', memStore([knownRow]), fakeFetch(() => json({ message: 'invalid_sk' }, 400)).fn)
    expect(await g.confirm({ hotelId: 'h1', providerRef: SESSION })).toBeNull()
  })

  it('SESSION desconocida → null y NO consulta a CardNet', async () => {
    const f = fakeFetch(() => statusOf('00'))
    const g = new CardnetGateway(creds, 'test', memStore(), f.fn)
    expect(await g.confirm({ hotelId: 'h1', providerRef: 'sess-inventada' })).toBeNull()
    expect(f.calls).toHaveLength(0)
  })

  it('fila de OTRO hotel → null y NO consulta a CardNet', async () => {
    const f = fakeFetch(() => statusOf('00'))
    const g = new CardnetGateway(creds, 'test', memStore([knownRow]), f.fn)
    expect(await g.confirm({ hotelId: 'h2', providerRef: SESSION })).toBeNull()
    expect(f.calls).toHaveLength(0)
  })

  it('sin providerRef ni query.SESSION → null', async () => {
    const f = fakeFetch(() => statusOf('00'))
    const g = new CardnetGateway(creds, 'test', memStore([knownRow]), f.fn)
    expect(await g.confirm({ hotelId: 'h1' })).toBeNull()
    expect(f.calls).toHaveLength(0)
  })

  it('toma la SESSION de ctx.query cuando no hay providerRef (POST de retorno parseado)', async () => {
    const g = new CardnetGateway(creds, 'test', memStore([knownRow]), fakeFetch(() => statusOf('00')).fn)
    const outcome = await g.confirm({ hotelId: 'h1', query: { SESSION, Description: 'Transaction Received' } })
    expect(outcome?.status).toBe('paid')
  })

  it('respuesta sin ResponseCode → null', async () => {
    const g = new CardnetGateway(creds, 'test', memStore([knownRow]), fakeFetch(() => json({ SESSION })).fn)
    expect(await g.confirm({ hotelId: 'h1', providerRef: SESSION })).toBeNull()
  })

  it('CardNet caído → null, NUNCA se asume pagado', async () => {
    const g = new CardnetGateway(creds, 'test', memStore([knownRow]), fakeFetch(() => { throw new Error('ECONNREFUSED') }).fn)
    expect(await g.confirm({ hotelId: 'h1', providerRef: SESSION })).toBeNull()
  })
})

describe('CardnetGateway — probe() ("Probar conexión")', () => {
  it('sesión válida → ok:true, sin guardar la sesión', async () => {
    const store = memStore()
    const f = fakeFetch(sessionOk)
    const g = new CardnetGateway(creds, 'test', store, f.fn)
    const r = await g.probe()
    expect(r.ok).toBe(true)
    expect(r.message).toContain('labservicios.cardnet.com.do')
    expect(r.message).toContain('no valida el afiliado')
    expect(store.rows.size).toBe(0)
    const body = JSON.parse(String(f.calls[0].init?.body))
    expect(body).toMatchObject({ Amount: '000000000001', OrdenId: 'probe', ReturnUrl: 'https://localhost/probe', CancelUrl: 'https://localhost/probe' })
  })

  it('sin sesión / error HTTP / red caída → ok:false con el host y el detalle', async () => {
    const g = new CardnetGateway(creds, 'test', memStore(), fakeFetch(() => json({ message: 'bad_merchant' }, 400)).fn)
    const r = await g.probe()
    expect(r.ok).toBe(false)
    expect(r.message).toContain('labservicios.cardnet.com.do')
    expect(r.message).toContain('bad_merchant')

    const g2 = new CardnetGateway(creds, 'test', memStore(), fakeFetch(() => { throw new Error('ENOTFOUND') }).fn)
    expect((await g2.probe()).ok).toBe(false)
  })
})
