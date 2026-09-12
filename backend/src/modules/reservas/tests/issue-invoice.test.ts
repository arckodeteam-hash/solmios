// reservas/tests/issue-invoice.test.ts — #253 (REQ-FDR-02): emitir factura desde la reserva.
//
// Cubre el usecase issueInvoiceForReservation (no el HTTP controller): que con folio ABIERTO se va
// por `closeFolioAndInvoice` y NUNCA por la factura directa (los cargos del folio no pueden quedar
// afuera), que sin folio —o con folio ya cerrado— se factura directo con el `hotelId` de la reserva
// y las `notes`, ownership con Auth REAL (mismo criterio que mark-paid.test.ts), que una reserva
// cancelada no factura, que sin puerto se rompe fuerte y que el 409 idempotente de facturas (con
// `invoiceId`) llega al borde como el MISMO objeto.
import { describe, it, expect } from 'bun:test'
import { Auth, ConflictError, NotFoundError, ValidationError } from 'arckode-framework'
import { issueInvoiceForReservation, type IssueInvoiceDeps, type ReservationInvoicingPort } from '../usecases/issue-invoice'

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} } as any
const fakeJwt = { sign: () => '', verify: () => ({}) } as any
// Auth REAL: si assertOwnership se rompe, este test falla.
const realAuth = new Auth(fakeJwt, 'test-secret', noopLogger)

const HOTEL = 'hotel-a'
const OTRO_HOTEL = 'hotel-b'
const user = { id: 'u1', role: 'hotel_admin', hotelId: HOTEL }

const baseItem = { id: 'r1', hotelId: HOTEL, guestId: 'g1', status: 'checked_in', folioId: null as string | null }

interface PortCalls { direct: any[]; folio: any[] }

function makePort(calls: PortCalls, opts: { directError?: Error } = {}): ReservationInvoicingPort {
  return {
    issueFromReservation: async (hotelId, input, u) => {
      calls.direct.push({ hotelId, input, u })
      if (opts.directError) throw opts.directError
      return { invoice: { id: 'inv-direct', invoiceNumber: 'F-0002', amount: 354, status: 'paid' }, invoiceNumber: 'F-0002', linkedPayments: 2, amountPaid: 354 }
    },
    closeFolioAndInvoice: async (folioId, u) => {
      calls.folio.push({ folioId, u })
      return { folio: { id: folioId, status: 'closed', invoiceId: 'inv-folio' }, invoice: { id: 'inv-folio', invoiceNumber: 'F-0001', amount: 500 } }
    },
  }
}

interface HarnessOpts { folios?: any[]; folioDetail?: any; port?: ReservationInvoicingPort | undefined; folioReader?: boolean }

function harness(item: any | null = baseItem, opts: HarnessOpts = {}) {
  const calls: PortCalls = { direct: [], folio: [] }
  const listed: any[] = []
  const deps: IssueInvoiceDeps = {
    repo: { findById: async () => item } as any,
    auth: realAuth,
    invoicing: 'port' in opts ? opts.port : makePort(calls),
    folioReader: opts.folioReader === false ? undefined : {
      list: async (q: any) => { listed.push(q); return { data: opts.folios ?? [], total: (opts.folios ?? []).length } },
      getById: async (id: string) => opts.folioDetail ?? { id, status: 'closed' },
    },
    logger: noopLogger,
  }
  return { deps, calls, listed }
}

describe('issueInvoiceForReservation — con folio abierto', () => {
  it('folio open de la reserva → closeFolioAndInvoice(f1), NO factura directa, source folio', async () => {
    const h = harness(baseItem, { folios: [{ id: 'f1', reservationId: 'r1', status: 'open' }] })
    const result = await issueInvoiceForReservation(h.deps, 'r1', { notes: 'ignoradas' }, user)

    expect(result).toEqual({ invoiceId: 'inv-folio', invoiceNumber: 'F-0001', source: 'folio', folioId: 'f1' })
    expect(h.calls.folio).toHaveLength(1)
    expect(h.calls.folio[0].folioId).toBe('f1')
    expect(h.calls.folio[0].u).toEqual(user)
    expect(h.calls.direct).toHaveLength(0)
    // Se piden sólo los abiertos, como la guarda de deuda del checkout.
    expect(h.listed[0]).toEqual({ status: 'open' })
  })

  it('el folio abierto de OTRA reserva no cuenta → camino directo', async () => {
    const h = harness(baseItem, { folios: [{ id: 'f9', reservationId: 'r9', status: 'open' }] })
    const result = await issueInvoiceForReservation(h.deps, 'r1', {}, user)
    expect(result.source).toBe('reservation')
    expect(h.calls.folio).toHaveLength(0)
  })

  it('sin lector pero con reservation.folioId apuntando a un folio open → lo cierra (fallback por getById)', async () => {
    const h = harness({ ...baseItem, folioId: 'f2' }, { folios: [], folioDetail: { id: 'f2', status: 'open', reservationId: 'r1' } })
    const result = await issueInvoiceForReservation(h.deps, 'r1', {}, user)
    expect(result.source).toBe('folio')
    expect(result.folioId).toBe('f2')
  })
})

describe('issueInvoiceForReservation — sin folio', () => {
  it('list devuelve [] → issueFromReservation con hotelId de la reserva y notes, source reservation + linkedPayments', async () => {
    const h = harness(baseItem, { folios: [] })
    const result = await issueInvoiceForReservation(h.deps, 'r1', { notes: 'pago anticipado' }, user)

    expect(result).toEqual({ invoiceId: 'inv-direct', invoiceNumber: 'F-0002', source: 'reservation', linkedPayments: 2, amountPaid: 354 })
    expect(h.calls.direct).toHaveLength(1)
    expect(h.calls.direct[0].hotelId).toBe(HOTEL)
    expect(h.calls.direct[0].input).toEqual({ reservationId: 'r1', notes: 'pago anticipado' })
    expect(h.calls.direct[0].u).toEqual(user)
    expect(h.calls.folio).toHaveLength(0)
  })

  it('folio de la reserva ya CERRADO (folioId apunta a status closed) → camino directo', async () => {
    const h = harness({ ...baseItem, folioId: 'f1' }, { folios: [], folioDetail: { id: 'f1', status: 'closed', reservationId: 'r1' } })
    const result = await issueInvoiceForReservation(h.deps, 'r1', {}, user)
    expect(result.source).toBe('reservation')
    expect(h.calls.folio).toHaveLength(0)
    expect(h.calls.direct).toHaveLength(1)
  })

  it('sin folioReader cableado y sin folioId → camino directo sin consultar folios', async () => {
    const h = harness(baseItem, { folioReader: false })
    const result = await issueInvoiceForReservation(h.deps, 'r1', {}, user)
    expect(result.source).toBe('reservation')
    expect(h.listed).toHaveLength(0)
  })

  it('notes vacías/espacios → undefined hacia el puerto', async () => {
    const h = harness(baseItem, { folios: [] })
    await issueInvoiceForReservation(h.deps, 'r1', { notes: '   ' }, user)
    expect(h.calls.direct[0].input.notes).toBeUndefined()
  })
})

describe('issueInvoiceForReservation — rechazos', () => {
  it('reserva cancelled → ConflictError, sin tocar ningún puerto', async () => {
    const h = harness({ ...baseItem, status: 'cancelled' })
    await expect(issueInvoiceForReservation(h.deps, 'r1', {}, user)).rejects.toBeInstanceOf(ConflictError)
    expect(h.calls.direct).toHaveLength(0)
    expect(h.calls.folio).toHaveLength(0)
  })

  it('sin puerto (connector no registrado) → ValidationError fail-closed', async () => {
    const h = harness(baseItem, { port: undefined })
    await expect(issueInvoiceForReservation(h.deps, 'r1', {}, user)).rejects.toBeInstanceOf(ValidationError)
  })

  it('reserva inexistente → NotFoundError', async () => {
    const h = harness(null)
    await expect(issueInvoiceForReservation(h.deps, 'nope', {}, user)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('reserva de otro hotel → ForbiddenError (ownership con Auth real); super_admin sí puede', async () => {
    const h = harness({ ...baseItem, hotelId: OTRO_HOTEL })
    await expect(issueInvoiceForReservation(h.deps, 'r1', {}, user)).rejects.toMatchObject({ name: 'ForbiddenError' })
    expect(h.calls.direct).toHaveLength(0)

    const sa = harness({ ...baseItem, hotelId: OTRO_HOTEL })
    const result = await issueInvoiceForReservation(sa.deps, 'r1', {}, { id: 'root', role: 'super_admin' })
    expect(result.source).toBe('reservation')
    expect(sa.calls.direct[0].hotelId).toBe(OTRO_HOTEL)
  })

  it('el 409 idempotente del puerto (ConflictError con invoiceId) se propaga tal cual — el MISMO objeto', async () => {
    const calls: PortCalls = { direct: [], folio: [] }
    const already = Object.assign(new ConflictError('La reserva ya tiene factura F-0001', { invoiceId: 'inv-old' }), { invoiceId: 'inv-old' })
    const h = harness(baseItem, { port: makePort(calls, { directError: already }) })
    let caught: any
    try { await issueInvoiceForReservation(h.deps, 'r1', {}, user) } catch (e) { caught = e }
    expect(caught).toBe(already)
    expect(caught.invoiceId).toBe('inv-old')
  })
})
