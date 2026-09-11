// modules/payment-gateways/tests/azul-gateway.test.ts
//
// Cubre el adapter de Azul Payment Page (services/payment-gateway/azul-gateway.ts).
//
// Los vectores fijos (hash de ida y de retorno) se calcularon FUERA del código bajo prueba, con
// openssl, siguiendo el orden de concatenación del manual oficial (pág. 65) — HMAC-SHA512 con la
// AuthKey como clave, cadena en UTF-16LE con la AuthKey concatenada al final, hex en minúscula:
//
//   printf '%s' "<concat>" | iconv -f UTF-8 -t UTF-16LE | openssl dgst -sha512 -hmac "<key>"
//
// Sigue sin haber sandbox de Azul contra el que probar (no hay credenciales de comercio), así que
// estos vectores son la referencia independiente de que la fórmula implementada es la del manual.

import { describe, it, expect } from 'bun:test'
import { createHmac } from 'node:crypto'
import {
  AzulGateway,
  buildAuthHash,
  verifyReturnHash,
  type AzulPaymentPageFields,
  type AzulReturnFields,
} from '../../../services/payment-gateway/azul-gateway'

const creds = { merchantId: 'MERCH123', authKey: 'super-secreta', currency: 'usd' }

// Vectores calculados con openssl (ver cabecera). Cambian si cambia el orden o la codificación.
const REQUEST_VECTOR =
  '1bf422ac380c7d22e51c433ada4a4bc7bf9313e4e19ef1dec48eeba7937b22efab64c14457dee00b650901701df0fb39fd0b7946e0086c1494f8585b733c5036'
const RETURN_VECTOR =
  'aedd3f5049fa06fbda4419d03987e4590c8eaed33804875e608fb9b3960791217a05d87322a025eba1143494aff3c0243f893a91bc017c5f9c643a5d68d74fde'

function gw() {
  return new AzulGateway(creds, 'test')
}

describe('AzulGateway — capacidades', () => {
  it('declara confirmation "return" y NO refund/void (Payment Page no los soporta)', () => {
    const g = gw()
    expect(g.capabilities.confirmation).toBe('return')
    expect(g.capabilities.refund).toBe(false)
    expect(g.capabilities.void).toBe(false)
  })

  it('exige merchantId y authKey al construir', () => {
    expect(() => new AzulGateway({ merchantId: '', authKey: 'x' } as any, 'test')).toThrow(/merchantId/)
    expect(() => new AzulGateway({ merchantId: 'x', authKey: '' } as any, 'test')).toThrow(/authKey/)
  })
})

describe('AzulGateway — createCharge (charge "exitoso" = arma el redirect)', () => {
  it('arma la URL de Payment Page con AuthHash y providerRef = la referencia nuestra', async () => {
    const g = gw()
    const res = await g.createCharge({
      hotelId: 'h1', amountMinor: 150000, currency: 'usd', description: 'Depósito reserva',
      reference: 'RES-001', successUrl: 'https://hotel.test/ok', cancelUrl: 'https://hotel.test/cancel',
    })
    expect(res.status).toBe('redirect')
    if (res.status !== 'redirect') throw new Error('unreachable')
    expect(res.providerRef).toBe('RES-001')
    expect(res.redirectUrl).toContain('pruebas.azul.com.do') // host de test, no de producción
    expect(res.redirectUrl.startsWith('https://pruebas.azul.com.do/PaymentPage/?')).toBe(true)
    expect(res.redirectUrl).toContain('AuthHash=')
    expect(res.redirectUrl).toContain('OrderNumber=RES-001')
    expect(res.redirectUrl).toContain('UseCustomField1=0') // los custom fields viajan aunque no se usen
  })
})

describe('AzulGateway — hash de ida/vuelta (funciones puras)', () => {
  const fields: AzulPaymentPageFields = {
    MerchantId: 'MERCH123', MerchantName: 'SolmiOS', MerchantType: 'ECommerce',
    CurrencyCode: 'USD', OrderNumber: 'RES-001', Amount: '150000', ITBIS: '0',
    ApprovedUrl: 'https://hotel.test/ok', DeclinedUrl: 'https://hotel.test/cancel', CancelUrl: 'https://hotel.test/cancel',
    UseCustomField1: '0', CustomField1Label: '', CustomField1Value: '',
    UseCustomField2: '0', CustomField2Label: '', CustomField2Value: '',
  }

  it('buildAuthHash es determinístico (misma entrada → mismo hash)', () => {
    const h1 = buildAuthHash(fields, 'llave')
    const h2 = buildAuthHash(fields, 'llave')
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]{128}$/) // HMAC-SHA512 hex en minúscula (como el {0:x2} del manual)
  })

  it('buildAuthHash coincide con el vector calculado con openssl (orden y HMAC del manual)', () => {
    expect(buildAuthHash(fields, 'super-secreta')).toBe(REQUEST_VECTOR)
  })

  it('cambia con la llave (dos comercios distintos jamás producen el mismo hash)', () => {
    expect(buildAuthHash(fields, 'llaveA')).not.toBe(buildAuthHash(fields, 'llaveB'))
  })

  it('verifyReturnHash acepta el vector de retorno calculado con openssl', () => {
    const ret: AzulReturnFields = {
      OrderNumber: 'RES-001', Amount: '150000', AuthorizationCode: 'AUTH1', DateTime: '20240101120000',
      ResponseCode: 'ISO8583', IsoCode: '00', ResponseMessage: 'APROBADA', ErrorDescription: '', RRN: 'RRN1',
      AuthHash: RETURN_VECTOR,
    }
    expect(verifyReturnHash(ret, 'super-secreta')).toBe(true)
    // Azul puede mandar el hex en mayúscula: la comparación es case-insensitive.
    expect(verifyReturnHash({ ...ret, AuthHash: RETURN_VECTOR.toUpperCase() }, 'super-secreta')).toBe(true)
    // Cualquier campo del hash alterado invalida el retorno.
    expect(verifyReturnHash({ ...ret, AuthorizationCode: 'AUTH2' }, 'super-secreta')).toBe(false)
  })
})

describe('AzulGateway — confirm() (hash válido / inválido en el retorno)', () => {
  function returnFields(overrides: Partial<AzulReturnFields> = {}): AzulReturnFields {
    const base: Omit<AzulReturnFields, 'AuthHash'> = {
      OrderNumber: 'RES-001', Amount: '150000', AuthorizationCode: 'AUTH1', DateTime: '20240101120000',
      ResponseCode: 'ISO8583', IsoCode: '00', ResponseMessage: 'APROBADA', ErrorDescription: '',
      RRN: 'RRN1', AzulOrderId: 'AZUL-999',
    }
    const merged = { ...base, ...overrides } as AzulReturnFields
    if (!('AuthHash' in overrides)) merged.AuthHash = verifyHashFor(merged, creds.authKey)
    return merged
  }
  function returnConcat(f: AzulReturnFields, authKey: string): string {
    // Orden oficial del retorno (manual pág. 65), con la AuthKey concatenada al final.
    return [
      f.OrderNumber, f.Amount, f.AuthorizationCode ?? '', f.DateTime ?? '', f.ResponseCode ?? '',
      f.IsoCode ?? '', f.ResponseMessage ?? '', f.ErrorDescription ?? '', f.RRN ?? '', authKey,
    ].join('')
  }
  function verifyHashFor(f: AzulReturnFields, authKey: string): string {
    // Fórmula oficial: HMAC-SHA512 con la AuthKey como clave, cadena en UTF-16LE, hex minúscula.
    return createHmac('sha512', authKey).update(Buffer.from(returnConcat(f, authKey), 'utf16le')).digest('hex')
  }

  it('hash VÁLIDO + IsoCode 00 → paid', async () => {
    const g = gw()
    const f = returnFields()
    const outcome = await g.confirm({ hotelId: 'h1', query: f as unknown as Record<string, string> })
    expect(outcome).not.toBeNull()
    expect(outcome?.status).toBe('paid')
    expect(outcome?.reference).toBe('RES-001')
    expect(outcome?.amountMinor).toBe(150000)
  })

  it('hash VÁLIDO + IsoCode distinto de 00 → failed', async () => {
    const g = gw()
    const f = returnFields({ IsoCode: '51', ResponseMessage: 'DECLINADA', ErrorDescription: 'Fondos insuficientes' })
    const outcome = await g.confirm({ hotelId: 'h1', query: f as unknown as Record<string, string> })
    expect(outcome?.status).toBe('failed')
  })

  it('hash VÁLIDO pero sin IsoCode → null (no se puede decidir aprobado/rechazado)', async () => {
    const g = gw()
    const f = returnFields({ IsoCode: undefined })
    const outcome = await g.confirm({ hotelId: 'h1', query: f as unknown as Record<string, string> })
    expect(outcome).toBeNull()
  })

  it('un retorno firmado con UTF-8 también se acepta (fallback documentado)', () => {
    const f = returnFields()
    const utf8Hash = createHmac('sha512', creds.authKey)
      .update(Buffer.from(returnConcat(f, creds.authKey), 'utf8'))
      .digest('hex')
    expect(utf8Hash).not.toBe(f.AuthHash) // UTF-8 y UTF-16LE producen hashes distintos
    expect(verifyReturnHash({ ...f, AuthHash: utf8Hash }, creds.authKey)).toBe(true)
  })

  it('hash INVÁLIDO (manipulado) → null, NUNCA se confía en el retorno', async () => {
    const g = gw()
    const f = returnFields({ AuthHash: 'HASH-FALSO-INVENTADO' })
    const outcome = await g.confirm({ hotelId: 'h1', query: f as unknown as Record<string, string> })
    expect(outcome).toBeNull()
  })

  it('sin AuthHash en la query → null', async () => {
    const g = gw()
    const outcome = await g.confirm({ hotelId: 'h1', query: { OrderNumber: 'RES-001' } })
    expect(outcome).toBeNull()
  })

  it('verifyReturnHash rechaza un monto alterado (mismo truco que cambiar el precio en la URL)', () => {
    const f = returnFields()
    const tampered = { ...f, Amount: '1' } // el atacante bajó el monto pero no puede recalcular el hash real
    expect(verifyReturnHash(tampered, creds.authKey)).toBe(false)
    expect(verifyReturnHash(f, creds.authKey)).toBe(true)
  })
})
