// connectors/tests/reservas-facturas.test.ts — #253 (REQ-FDR-02)
//
// El connector `reservas-facturas` cablea `ReservationInvoicingPort` en `reservas`. Acá se prueba
// el CABLEADO sobre módulos dobles: que el puerto llega por `setOrchestrationDeps`, que cada método
// delega en el módulo dueño con los mismos argumentos y devuelve su resultado, y que los errores
// del módulo (el 409 idempotente con `invoiceId`) se propagan tal cual — el borde HTTP de reservas
// depende de ese `invoiceId` para responder "ya tiene factura".
import { describe, it, expect } from 'bun:test'
import { ConflictError } from 'arckode-framework'
import { reservasFacturasConnector } from '../reservas-facturas'

const user = { id: 'u1', role: 'admin', hotelId: 'h1' }

function makeHarness(overrides: { facturas?: any; folios?: any } = {}) {
  const facturasCalls: any[] = []
  const foliosCalls: any[] = []
  let deps: any = null
  const reservas = { setOrchestrationDeps: (d: any) => { deps = d } }
  const facturas = overrides.facturas ?? {
    invoiceFromReservation: async (hotelId: string, input: any, u: any) => {
      facturasCalls.push({ hotelId, input, user: u })
      return { invoice: { id: 'inv-1', invoiceNumber: 'F-0001', amount: 300, status: 'paid' }, invoiceNumber: 'F-0001', linkedPayments: 2, amountPaid: 300 }
    },
  }
  const folios = overrides.folios ?? {
    closeAndCreateInvoice: async (folioId: string, u: any) => {
      foliosCalls.push({ folioId, user: u })
      return { folio: { id: folioId, status: 'closed', invoiceId: 'inv-2' }, invoice: { id: 'inv-2', invoiceNumber: 'F-0002', amount: 450 } }
    },
  }
  const ctx = {
    resolveModule: (name: string) => {
      if (name === 'reservas') return reservas
      if (name === 'facturas') return facturas
      if (name === 'folios') return folios
      throw new Error(`módulo inesperado: ${name}`)
    },
  } as any
  reservasFacturasConnector(ctx)
  return { deps: () => deps, facturasCalls, foliosCalls }
}

describe('reservas-facturas — cableado del puerto ReservationInvoicingPort', () => {
  it('registra `invoicing` en reservas con los dos métodos del puerto', () => {
    const h = makeHarness()
    const deps = h.deps()
    expect(deps).not.toBeNull()
    expect(Object.keys(deps)).toEqual(['invoicing'])
    expect(typeof deps.invoicing.issueFromReservation).toBe('function')
    expect(typeof deps.invoicing.closeFolioAndInvoice).toBe('function')
  })

  it('issueFromReservation delega en facturas.invoiceFromReservation con los mismos argumentos y devuelve su resultado', async () => {
    const h = makeHarness()
    const out = await h.deps().invoicing.issueFromReservation('h1', { reservationId: 'r1', notes: 'x' }, user)

    expect(h.facturasCalls).toEqual([{ hotelId: 'h1', input: { reservationId: 'r1', notes: 'x' }, user }])
    expect(h.foliosCalls).toEqual([])
    expect(out).toEqual({ invoice: { id: 'inv-1', invoiceNumber: 'F-0001', amount: 300, status: 'paid' }, invoiceNumber: 'F-0001', linkedPayments: 2, amountPaid: 300 })
  })

  it('closeFolioAndInvoice delega en folios.closeAndCreateInvoice (mismo camino que POST /api/folios/:id/invoice)', async () => {
    const h = makeHarness()
    const out = await h.deps().invoicing.closeFolioAndInvoice('f1', user)

    expect(h.foliosCalls).toEqual([{ folioId: 'f1', user }])
    expect(h.facturasCalls).toEqual([])
    expect(out.folio).toMatchObject({ id: 'f1', status: 'closed', invoiceId: 'inv-2' })
    expect(out.invoice).toMatchObject({ id: 'inv-2', invoiceNumber: 'F-0002' })
  })

  it('un ConflictError de facturas (409 idempotente con invoiceId) se propaga tal cual', async () => {
    const err: any = new ConflictError('La reserva ya tiene factura')
    err.invoiceId = 'inv-existente'
    const h = makeHarness({ facturas: { invoiceFromReservation: async () => { throw err } } })

    const p = h.deps().invoicing.issueFromReservation('h1', { reservationId: 'r1' }, user)
    await expect(p).rejects.toBe(err)
    await expect(p).rejects.toMatchObject({ invoiceId: 'inv-existente' })
  })

  it('un error de folios al cerrar se propaga sin envolver', async () => {
    const err = new ConflictError('El folio ya está cerrado')
    const h = makeHarness({ folios: { closeAndCreateInvoice: async () => { throw err } } })

    await expect(h.deps().invoicing.closeFolioAndInvoice('f1', user)).rejects.toBe(err)
  })
})
