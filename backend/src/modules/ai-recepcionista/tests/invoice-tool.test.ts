// Tests de la tarea 1.1 de `finanzas-consolidacion`: la IA ya no escribe `invoices` a mano.
//
// Antes, `generate_invoice` hacía `invoiceRepo.create(...)` con `type:'stay'`, `status:'issued'`
// (ninguno existe en los enums), impuesto clavado en 0,16 y número por `Date.now()`. Y era
// alcanzable desde el WebChat público (`/api/ai/chat/:slug`, sin auth).

import { describe, it, expect } from 'bun:test'
import { executeTool } from '../usecases/llm-pipeline'

const reservation = {
  id: 'r1', hotelId: 'h1', roomId: 'room1', guestId: 'g1', guestName: 'Ana',
  checkIn: '2026-09-01', checkOut: '2026-09-04',
}

function repos(overrides: Record<string, unknown> = {}) {
  return {
    reservationRepo: { findById: async () => reservation, findOne: async () => reservation },
    roomRepo: { findById: async () => ({ id: 'room1', type: 'suite', basePrice: 100 }) },
    hotelRepo: { findById: async () => ({ id: 'h1', name: 'Hotel' }) },
    logger: { error: () => {} },
    ...overrides,
  } as any
}

describe('generate_invoice — la IA factura por el módulo facturas', () => {
  it('desde el WebChat público NO emite factura ni llama al puerto', async () => {
    let called = 0
    const r: any = await executeTool('generate_invoice', { reservationId: 'r1' }, 'h1', repos({
      channel: 'webchat',
      issueInvoice: async () => { called++; return { id: 'x' } },
    }))

    expect(called).toBe(0)
    expect(r.error).toBeDefined()
    expect(r.message).toContain('recepción')
  })

  it('sin canal conocido tampoco emite (fail-closed)', async () => {
    let called = 0
    const r: any = await executeTool('generate_invoice', { reservationId: 'r1' }, 'h1', repos({
      issueInvoice: async () => { called++; return { id: 'x' } },
    }))

    expect(called).toBe(0)
    expect(r.error).toBeDefined()
  })

  it('por WhatsApp delega en el puerto con la BASE imponible y devuelve el total del hotel', async () => {
    const calls: any[] = []
    const r: any = await executeTool('generate_invoice', { reservationId: 'r1' }, 'h1', repos({
      channel: 'whatsapp',
      issueInvoice: async (input: any) => {
        calls.push(input)
        // Espeja lo que hace `facturas.create` con la tasa del hotel al 18 %.
        return { id: 'inv1', invoiceNumber: 'INV-2026-0008', amount: 354, taxes: 54, currency: 'USD' }
      },
    }))

    // 3 noches × 100 = 300 de BASE. La tool NO calcula impuestos: los pone el hotel.
    expect(calls).toHaveLength(1)
    expect(calls[0].amount).toBe(300)
    expect(calls[0].hotelId).toBe('h1')
    expect(calls[0].reservationId).toBe('r1')

    expect(r.invoiceNumber).toBe('INV-2026-0008')
    expect(r.taxes).toBe(54)
    expect(r.total).toBe(354)
    // Los estados inventados del código viejo no vuelven por la respuesta.
    expect(r.status).toBeUndefined()
  })

  it('sin el connector cableado no inventa un comprobante', async () => {
    const r: any = await executeTool('generate_invoice', { reservationId: 'r1' }, 'h1', repos({
      channel: 'whatsapp',
    }))

    expect(r.error).toBe('No se pudo emitir la factura')
    expect(r.invoiceNumber).toBeUndefined()
  })
})

describe('generate_payment_link — desactivada hasta cablear payment-requests', () => {
  it('no devuelve una URL de un dominio que no existe', async () => {
    const r: any = await executeTool(
      'generate_payment_link',
      { reservationId: 'r1', amount: 300 },
      'h1',
      repos({ channel: 'whatsapp' }),
    )

    expect(r.paymentUrl).toBeUndefined()
    expect(JSON.stringify(r)).not.toContain('pay.hotel.com')
    expect(r.error).toBeDefined()
  })
})
