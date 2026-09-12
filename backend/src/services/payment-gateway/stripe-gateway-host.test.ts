// services/payment-gateway/stripe-gateway-host.test.ts — Knob test-only STRIPE_API_HOST (epic #265).
//
// Lo que se prueba: que con `STRIPE_API_HOST` seteado el cliente interno de stripe-node apunte al
// doble local (host/port/protocol), y que SIN la var quede exactamente como hoy (api.stripe.com,
// 443, https). stripe-node guarda esa config en `stripe._api` (ver node_modules/stripe/esm/stripe.core.js).
// Sin red: sólo se construye el cliente, no se hace ninguna llamada.

import { describe, it, expect, beforeEach, afterAll } from 'bun:test'
import { StripeGateway } from './stripe-gateway'

const VARS = ['STRIPE_API_HOST', 'STRIPE_API_PORT', 'STRIPE_API_PROTOCOL'] as const
const ORIGINAL: Record<string, string | undefined> = Object.fromEntries(VARS.map(v => [v, process.env[v]]))

function clearVars() {
  for (const v of VARS) delete process.env[v]
}

function apiOf(gw: StripeGateway): { host: string; port: string | number; protocol: string } {
  return (gw as any).stripe._api
}

function build() {
  return new StripeGateway({ secretKey: 'sk_test_dummy' }, 'test')
}

describe('StripeGateway — STRIPE_API_HOST (test-only)', () => {
  beforeEach(clearVars)

  afterAll(() => {
    clearVars()
    for (const v of VARS) if (ORIGINAL[v] !== undefined) process.env[v] = ORIGINAL[v]
  })

  it('sin la var apunta a api.stripe.com:443 por https (como hoy)', () => {
    const api = apiOf(build())
    expect(api.host).toBe('api.stripe.com')
    expect(String(api.port)).toBe('443')
    expect(api.protocol).toBe('https')
  })

  it('con STRIPE_API_HOST + PORT apunta al doble local por http (default de protocol)', () => {
    process.env.STRIPE_API_HOST = '127.0.0.1'
    process.env.STRIPE_API_PORT = '4242'
    const api = apiOf(build())
    expect(api.host).toBe('127.0.0.1')
    expect(String(api.port)).toBe('4242')
    expect(api.protocol).toBe('http')
  })

  it('respeta STRIPE_API_PROTOCOL cuando se setea', () => {
    process.env.STRIPE_API_HOST = 'stripe-stub.local'
    process.env.STRIPE_API_PROTOCOL = 'https'
    const api = apiOf(build())
    expect(api.host).toBe('stripe-stub.local')
    expect(api.protocol).toBe('https')
    // Sin STRIPE_API_PORT el SDK usa su default.
    expect(String(api.port)).toBe('443')
  })

  it('STRIPE_API_PORT/PROTOCOL solos (sin HOST) no cambian nada', () => {
    process.env.STRIPE_API_PORT = '4242'
    process.env.STRIPE_API_PROTOCOL = 'http'
    const api = apiOf(build())
    expect(api.host).toBe('api.stripe.com')
    expect(String(api.port)).toBe('443')
    expect(api.protocol).toBe('https')
  })
})
