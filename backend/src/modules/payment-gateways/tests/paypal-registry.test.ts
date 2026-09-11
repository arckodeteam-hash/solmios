// modules/payment-gateways/tests/paypal-registry.test.ts
//
// El cableado de PayPal: que `registry.resolve` devuelva el adapter de PayPal y NO el de otro
// proveedor. El bug que esto cuida es el mismo que documenta usecases/test-connection.ts: armar
// el adapter equivocado con las credenciales de un proveedor distinto llama a la API ajena con
// la llave que no es — y en un flujo de dinero eso se descubre cobrando mal.
//
// Repo en memoria (mismo doble que service.test.ts) y `fetch` global mockeado (misma técnica que
// cardnet-gateway.test.ts): sin BD, sin red y sin credenciales reales de PayPal.

import { describe, it, expect, beforeAll, afterEach } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import { PaymentGatewayRegistry, PaymentGatewaySessionStore } from '../../../services/payment-gateway/registry'
import { encryptCredentials } from '../../../services/payment-gateway/crypto'
import { IMPLEMENTED_PROVIDERS, type PaymentProvider } from '../../../services/payment-gateway/types'
import { StripeGateway } from '../../../services/payment-gateway/stripe-gateway'
import { AzulGateway } from '../../../services/payment-gateway/azul-gateway'
import { CardnetGateway } from '../../../services/payment-gateway/cardnet-gateway'
import { PayPalGateway } from '../../../services/payment-gateway/paypal-gateway'
import { testGatewayConnection } from '../usecases/test-connection'
import type { PaymentGatewayRow } from '../types'

const log = silentLogger()

beforeAll(() => {
  // Igual que service.test.ts: sin master key, encryptCredentials tira (crypto.ts falla fuerte
  // a propósito para no guardar llaves en claro).
  process.env.PAYMENTS_ENCRYPTION_KEY = 'test-master-key-de-al-menos-32-caracteres!!'
})

/** Credenciales genéricas tal como las guarda `usecases/build-credentials.ts` por proveedor. */
const CREDS: Record<PaymentProvider, Record<string, unknown>> = {
  stripe: { secretKey: 'sk_test_abc123', publishableKey: 'pk_test_abc123', currency: 'usd' },
  paypal: {
    publishableKey: 'AXcId-clientid',        // → clientId
    secretKey: 'ELsecreto-clientsecret',     // → clientSecret
    webhookSecret: 'WH-77D19822CH2334701',   // → webhookId
    currency: 'usd',
  },
  azul: { merchantId: 'MERCH123', secretKey: 'authkey-de-azul', currency: 'dop' },
  cardnet: { merchantId: 'COMERCIO1', terminalId: 'TERM1', secretKey: 'llave-de-cardnet', currency: 'dop' },
}

let seq = 0
function row(provider: PaymentProvider, overrides: Partial<PaymentGatewayRow> = {}, creds = CREDS[provider]): PaymentGatewayRow {
  return {
    id: `gw${++seq}`,
    hotelId: 'h1',
    provider,
    mode: 'test',
    credentials: encryptCredentials(creds),
    enabled: true,
    isDefault: false,
    ...overrides,
  }
}

function registryWith(rows: PaymentGatewayRow[], sessionsRepo?: ReturnType<typeof sessionsRepoInMemory>) {
  const repo = { findMany: async (f: any = {}) => rows.filter(r => Object.entries(f).every(([k, v]) => (r as any)[k] === v)) }
  return new PaymentGatewayRegistry(repo as any, log, sessionsRepo)
}

/** Doble de `payment_gateway_sessions`: guarda lo que le dan tal cual (para mirar qué se persistió). */
function sessionsRepoInMemory() {
  const rows: any[] = []
  return {
    rows,
    findOne: async (f: Record<string, unknown>) => rows.find(r => Object.entries(f).every(([k, v]) => r[k] === v)) ?? null,
    create: async (data: any) => { rows.push({ ...data }); return data },
  }
}

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

/** Doble de `fetch` que cuenta llamadas: sin el contador no se puede afirmar "no tocó la red". */
function mockFetch(respond: (url: string) => Response) {
  const calls: string[] = []
  globalThis.fetch = (async (input: any) => {
    const url = String(input)
    calls.push(url)
    return respond(url)
  }) as any
  return calls
}

describe('IMPLEMENTED_PROVIDERS', () => {
  it('declara los cuatro proveedores con adapter escrito', () => {
    expect(IMPLEMENTED_PROVIDERS).toContain('stripe')
    expect(IMPLEMENTED_PROVIDERS).toContain('paypal')
    expect(IMPLEMENTED_PROVIDERS).toContain('azul')
    expect(IMPLEMENTED_PROVIDERS).toContain('cardnet')
    expect(IMPLEMENTED_PROVIDERS).toHaveLength(4)
  })
})

describe('PaymentGatewayRegistry — resolve por proveedor', () => {
  it("resolve(hotel, 'paypal') devuelve un PayPalGateway del hotel", async () => {
    const registry = registryWith([row('paypal')])
    const gw = await registry.resolve('h1', 'paypal')
    expect(gw).toBeInstanceOf(PayPalGateway)
    expect(gw!.provider).toBe('paypal')
    expect(gw!.mode).toBe('test')
    expect(gw!.capabilities.confirmation).toBe('push')
  })

  it('no hay regresión: cada proveedor sigue devolviendo SU adapter', async () => {
    const registry = registryWith([row('stripe'), row('paypal'), row('azul'), row('cardnet')], sessionsRepoInMemory())
    expect(await registry.resolve('h1', 'stripe')).toBeInstanceOf(StripeGateway)
    expect(await registry.resolve('h1', 'azul')).toBeInstanceOf(AzulGateway)
    expect(await registry.resolve('h1', 'cardnet')).toBeInstanceOf(CardnetGateway)
    expect(await registry.resolve('h1', 'paypal')).toBeInstanceOf(PayPalGateway)
  })

  it('la pasarela de PayPal deshabilitada no se usa (y sin fallback global, no se cobra)', async () => {
    const previo = process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_SECRET_KEY
    const registry = registryWith([row('paypal', { enabled: false })])
    expect(await registry.resolve('h1', 'paypal')).toBeNull()
    if (previo !== undefined) process.env.STRIPE_SECRET_KEY = previo
  })

  it('PayPal marcada como default se resuelve sin pedir proveedor', async () => {
    const registry = registryWith([row('stripe'), row('paypal', { isDefault: true })])
    expect(await registry.resolve('h1')).toBeInstanceOf(PayPalGateway)
  })
})

describe('PaymentGatewayRegistry — CardNet necesita el store de sesiones', () => {
  const CARDNET_REAL = { merchantId: '349011300', terminalId: '00567856', currency: 'dop' }

  it('cardnet: sin repo de sesiones el registry devuelve null y loguea error', async () => {
    const errores: string[] = []
    const logger = { ...log, error: (m: string) => { errores.push(m) } }
    const rows = [row('cardnet', {}, CARDNET_REAL)]
    const repo = { findMany: async () => rows }
    const registry = new PaymentGatewayRegistry(repo as any, logger as any) // 2 args: sigue compilando
    expect(await registry.resolve('h1', 'cardnet')).toBeNull()
    expect(errores).toHaveLength(1)
    expect(errores[0]).toContain('sin repo de sesiones')
  })

  it("cardnet: con repo de sesiones construye el adapter con provider 'cardnet'", async () => {
    const registry = registryWith([row('cardnet', {}, CARDNET_REAL)], sessionsRepoInMemory())
    const gw = await registry.resolve('h1', 'cardnet')
    expect(gw).toBeInstanceOf(CardnetGateway)
    expect(gw!.provider).toBe('cardnet')
    expect(gw!.mode).toBe('test')
    expect(gw!.capabilities.confirmation).toBe('pull')
  })
})

describe('PaymentGatewaySessionStore — la session-key se persiste cifrada', () => {
  const fila = {
    id: 'sess-abc123', hotelId: 'h1', provider: 'cardnet' as const, reference: 'RES-77',
    sessionKey: 'session-key-en-claro-XYZ', amountMinor: 150000, currency: 'dop', mode: 'test' as const,
  }

  it('save cifra: la fila creada en el repo NO contiene la session-key en claro', async () => {
    const repo = sessionsRepoInMemory()
    await new PaymentGatewaySessionStore(repo).save(fila)
    expect(repo.rows).toHaveLength(1)
    const guardada = repo.rows[0]
    expect(guardada.id).toBe('sess-abc123')
    expect(guardada.sessionKey).not.toBe(fila.sessionKey)
    expect(JSON.stringify(guardada)).not.toContain(fila.sessionKey)
  })

  it('load devuelve la fila con la session-key descifrada y el monto como número', async () => {
    const repo = sessionsRepoInMemory()
    const store = new PaymentGatewaySessionStore(repo)
    await store.save(fila)
    repo.rows[0].amountMinor = '150000' // como puede volver de la base según el driver
    const leida = await store.load('sess-abc123')
    expect(leida).toEqual(fila)
    expect(typeof leida!.amountMinor).toBe('number')
  })

  it('load de una SESSION desconocida devuelve null', async () => {
    const store = new PaymentGatewaySessionStore(sessionsRepoInMemory())
    expect(await store.load('sess-inexistente')).toBeNull()
  })

  it('load() de una fila con otro provider devuelve null (no es una sesión de CardNet)', async () => {
    const repo = sessionsRepoInMemory()
    const store = new PaymentGatewaySessionStore(repo)
    await store.save(fila)
    repo.rows[0].provider = 'azul'
    expect(await store.load('sess-abc123')).toBeNull()
  })
})

describe('testGatewayConnection — PayPal', () => {
  it('con credenciales válidas pide el token OAuth2 y responde ok', async () => {
    const calls = mockFetch(() => Response.json({ access_token: 'A', expires_in: 32400 }))
    const res = await testGatewayConnection(row('paypal'))
    expect(res.ok).toBe(true)
    expect(res.message).toContain('PayPal')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toBe('https://api-m.sandbox.paypal.com/v1/oauth2/token') // modo test = sandbox
  })

  it('si PayPal rechaza las credenciales (401) responde ok:false con el motivo', async () => {
    mockFetch(() => Response.json({ error_description: 'Client Authentication failed' }, { status: 401 }))
    const res = await testGatewayConnection(row('paypal'))
    expect(res.ok).toBe(false)
    expect(res.message).toContain('Client Authentication failed')
  })

  it('sin clientId falla ANTES de tocar la red (no gasta una llamada a PayPal)', async () => {
    const calls = mockFetch(() => Response.json({ access_token: 'A', expires_in: 32400 }))
    const incompleta = row('paypal', {}, { ...CREDS.paypal, publishableKey: '' })
    const res = await testGatewayConnection(incompleta)
    expect(res.ok).toBe(false)
    expect(res.message).toContain('clientId')
    expect(calls).toHaveLength(0)
  })
})
