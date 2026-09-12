// facturas/tests/hotel-header.test.ts — Tests de hotelHeaderOf (CA 5 de #298: datos del hotel en la factura).
import { describe, it, expect } from 'bun:test'
import { hotelHeaderOf } from '../usecases/hotel-header'
import { renderInvoiceHtml } from '../usecases/invoice-template'
import type { FacturasDTO } from '../types'

const invoice = { id: 'inv1', invoiceNumber: 'INV-2026-0001', type: 'invoice', hotelId: 'h1', amount: 120 } as FacturasDTO

describe('hotelHeaderOf', () => {
  it('devuelve nombre, dirección, teléfono y email del hotel y el template los renderiza', async () => {
    const hotelRepo = {
      findById: async () => ({ id: 'h1', name: 'Hotel Sol', address: 'Calle 1', phone: '809-555', email: 'sol@x.com' }),
    }
    const header = await hotelHeaderOf(hotelRepo, 'h1')
    expect(header).toEqual({ hotelName: 'Hotel Sol', hotelAddress: 'Calle 1', hotelPhone: '809-555', hotelEmail: 'sol@x.com' })

    const html = renderInvoiceHtml({ invoice, ...header })
    expect(html).toContain('Hotel Sol')
    expect(html).toContain('Calle 1')
    expect(html).toContain('Tel: 809-555')
    expect(html).toContain('sol@x.com')
  })

  it('sin repo devuelve el header por defecto', async () => {
    expect(await hotelHeaderOf(undefined, 'h1')).toEqual({ hotelName: 'Hotel' })
    expect(await hotelHeaderOf(null, 'h1')).toEqual({ hotelName: 'Hotel' })
  })

  it('sin hotelId devuelve el header por defecto sin consultar el repo', async () => {
    let called = false
    const hotelRepo = { findById: async () => { called = true; return { name: 'X' } } }
    expect(await hotelHeaderOf(hotelRepo, undefined)).toEqual({ hotelName: 'Hotel' })
    expect(await hotelHeaderOf(hotelRepo, null)).toEqual({ hotelName: 'Hotel' })
    expect(called).toBe(false)
  })

  it('si findById devuelve null, devuelve el header por defecto', async () => {
    const hotelRepo = { findById: async () => null }
    const header = await hotelHeaderOf(hotelRepo, 'h1')
    expect(header).toEqual({ hotelName: 'Hotel' })
    expect(header.hotelAddress).toBeUndefined()
  })

  it('si findById lanza, devuelve el header por defecto', async () => {
    const hotelRepo = { findById: async () => { throw new Error('db down') } }
    expect(await hotelHeaderOf(hotelRepo, 'h1')).toEqual({ hotelName: 'Hotel' })
  })

  it('no incluye campos vacíos ni de solo espacios y recorta los demás', async () => {
    const hotelRepo = { findById: async () => ({ id: 'h1', name: ' Hotel Luna ', address: '  ', phone: '', email: '  luna@x.com ' }) }
    const header = await hotelHeaderOf(hotelRepo, 'h1')
    expect(header).toEqual({ hotelName: 'Hotel Luna', hotelEmail: 'luna@x.com' })
    expect('hotelAddress' in header).toBe(false)
    expect('hotelPhone' in header).toBe(false)
  })

  it('si el hotel no tiene nombre, usa Hotel', async () => {
    const hotelRepo = { findById: async () => ({ id: 'h1', name: '', address: 'Av. 2' }) }
    expect(await hotelHeaderOf(hotelRepo, 'h1')).toEqual({ hotelName: 'Hotel', hotelAddress: 'Av. 2' })
  })
})
