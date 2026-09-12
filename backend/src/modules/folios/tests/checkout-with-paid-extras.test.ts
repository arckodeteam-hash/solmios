// checkout-with-paid-extras.test.ts — #269 (MR-04), criterio de aceptación del issue:
// "reserva con extras pagados, 1 noche → factura con 3 líneas y amountPaid = total,
//  pendiente 0, sin saldo a favor".
//
// Fixture: el folio tal como lo deja `reservas/usecases/checkin.ts` con dos addons del motor —
// noche 100+18, extras 30+5.40 y 10+1.80 (`category:'extra'`, `reference:'addon:<id>'`) y el
// prepago 165.20 como línea `category:'payment'` source 'prepaid'. Se lo pasa por el cierre REAL:
// `settleFolioAtCheckout` (shared) → `FoliosService.closeAndCreateInvoice` → `close-and-invoice`
// → `facturas/usecases/create-invoice`, con repos en memoria. Nada de mocks que calculen dinero.
import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, CacheAdapter, Auth } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { FoliosService } from '../service'
import { computeTotals } from '../usecases/folio-math'
import type { FolioDTO, FolioChargeDTO, CurrentUser } from '../types'
import { createInvoice } from '../../facturas/usecases/create-invoice'
import { settleFolioAtCheckout } from '../../../shared/usecases/settle-folio-at-checkout'
import { creditBalance, pendingBalance } from '../../../shared/utils/reservation-balance'
import { BALANCE_EPSILON } from '../../../shared/utils/money'

const log = silentLogger()
const silentCache: CacheAdapter = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} }
const mockAuth = {
  assertOwnership: (rid: string, uid: string, role?: string, admin = 'admin') => {
    if (rid === uid) return; if (role === admin) return; throw new Error('Forbidden')
  },
} as unknown as Auth

const user: CurrentUser = { id: 'u1', hotelId: 'h1', role: 'hotel_admin' }
const TAX_RATE = 18
const PREPAID = 165.2 // 118 + 35.40 + 11.80
const NOW = new Date().toISOString()

const matches = (row: any, filter: any) => Object.entries(filter ?? {}).every(([k, v]) => row[k] === v)

function memRepo(rows: any[], prefix: string): RepositoryAdapter<any> {
  return {
    findMany: async (f?: any) => rows.filter((r) => matches(r, f)),
    findOne: async (f?: any) => rows.find((r) => matches(r, f)) ?? null,
    findById: async (id: string) => rows.find((r) => r.id === id) ?? null,
    create: async (d: any) => { const c = { id: d.id ?? `${prefix}-${rows.length + 1}`, ...d }; rows.push(c); return c },
    update: async (id: string, d: any) => { const i = rows.findIndex((r) => r.id === id); rows[i] = { ...rows[i], ...d }; return rows[i] },
    delete: async () => true, count: async () => rows.length,
    paginate: async () => ({ data: rows, total: rows.length, limit: 20, offset: 0, pages: 1 }),
  } as unknown as RepositoryAdapter<any>
}

/** Los addons del motor, como los materializa public-booking (unitario × cantidad, fuera del total cobrable). */
const ADDONS = [
  { id: 'ad-1', hotelId: 'h1', reservationId: 'r1', description: 'Late checkout', amount: 30, quantity: 1, kind: 'service', source: 'booking_engine' },
  { id: 'ad-2', hotelId: 'h1', reservationId: 'r1', description: 'Cuna', amount: 10, quantity: 1, kind: 'service', source: 'booking_engine' },
]

/** `reservations` tras el motor: totalAmount = noche + extras (con impuesto), todo pagado online. */
const RESERVATION = { id: 'r1', hotelId: 'h1', guestId: 'g1', roomId: 'rm1', totalAmount: PREPAID, otherCharges: 0, deposit: PREPAID, status: 'checked_in' }

function line(over: Record<string, any>) {
  return { folioId: 'f1', hotelId: 'h1', kind: 'charge', quantity: 1, postedAt: NOW, ...over }
}

function makeWorld() {
  const folios: any[] = [{ id: 'f1', hotelId: 'h1', reservationId: 'r1', guestId: 'g1', roomId: 'rm1', status: 'open', currency: 'USD', invoiceId: null }]
  // Exactamente lo que deja checkin.ts: noche + 2 extras + crédito del prepago.
  const charges: any[] = [
    line({ id: 'c-room', description: 'Habitación 101 — 2026-09-12', category: 'room', amount: 100, taxes: 18, total: 118, source: 'checkin' }),
    line({ id: 'c-ad-1', description: 'Late checkout', category: 'extra', amount: 30, taxes: 5.4, total: 35.4, source: 'checkin', reference: 'addon:ad-1' }),
    line({ id: 'c-ad-2', description: 'Cuna', category: 'extra', amount: 10, taxes: 1.8, total: 11.8, source: 'checkin', reference: 'addon:ad-2' }),
    line({ id: 'c-prepaid', description: 'Pago anticipado (card)', category: 'payment', kind: 'payment', amount: -PREPAID, taxes: 0, total: -PREPAID, source: 'prepaid', reference: 'pay-1' }),
  ]
  const configuration: any[] = [{ id: 'cfg-taxes', hotelId: 'h1', key: 'taxes', value: [{ tasa: TAX_RATE, activo: true }] }]
  const invoices: any[] = []
  const invoiceItems: any[] = []

  const svc = new FoliosService(
    memRepo(folios, 'folio') as RepositoryAdapter<FolioDTO>,
    memRepo(charges, 'c') as RepositoryAdapter<FolioChargeDTO>,
    memRepo(configuration, 'cfg'),
    {
      guest: memRepo([{ id: 'g1', name: 'Ana' }], 'g'),
      reservation: memRepo([RESERVATION], 'res'),
      room: memRepo([{ id: 'rm1', number: '101' }], 'room'),
      user: memRepo([{ id: 'u1', hotelId: 'h1', role: 'hotel_admin' }], 'u'),
    },
    log, silentCache, mockAuth,
  )
  // Mismo mapeo que connectors/folios-facturas.ts, contra el `createInvoice` real de facturas.
  svc.setInvoicingDeps({
    createInvoice: async (invoiceData, u) => {
      const { item, invoiceNumber, amount } = await createInvoice(
        { repo: memRepo(invoices, 'inv'), configRepo: memRepo(configuration, 'cfg'), itemRepo: memRepo(invoiceItems, 'it'), logger: log },
        {
          hotelId: invoiceData.hotelId, guestId: invoiceData.guestId || undefined,
          reservationId: invoiceData.reservationId || undefined, folioId: invoiceData.folioId,
          type: invoiceData.type, amount: invoiceData.amount, status: invoiceData.status,
          notes: invoiceData.notes, items: invoiceData.items, amountPaid: invoiceData.amountPaid,
        } as any,
        (u as CurrentUser).hotelId ?? invoiceData.hotelId,
      )
      return { id: item.id, invoiceNumber, amount }
    },
  })

  return { svc, folios, charges, invoices, invoiceItems }
}

describe('check-out con extras pagados online (#269)', () => {
  it('1 noche + 2 extras prepagos → factura de 3 líneas, amountPaid = total, pendiente 0, sin saldo a favor', async () => {
    const w = makeWorld()

    // El folio cuadra ANTES de cerrar: 165.20 cargado contra 165.20 acreditado.
    const before = computeTotals(w.charges as FolioChargeDTO[])
    expect(before.chargesTotal).toBe(PREPAID)
    expect(before.paymentsTotal).toBe(PREPAID)
    expect(before.balance).toBe(0)

    const result = await settleFolioAtCheckout(
      w.svc,
      { reservationId: 'r1', hotelId: 'h1', guestId: 'g1', roomId: 'rm1', settle: null },
      user,
      { paidOf: async () => PREPAID }, // lo cobrado de verdad (payments): ya está reflejado en el folio
    )

    // Factura emitida y vinculada al folio.
    expect(result.invoiceId).not.toBeNull()
    expect(w.invoices).toHaveLength(1)
    const invoice = w.invoices[0]
    expect(w.folios[0].status).toBe('closed')
    expect(w.folios[0].invoiceId).toBe(invoice.id)

    // 3 líneas: noche + 2 extras, con la base neta de cada cargo.
    const items = w.invoiceItems.filter((it) => it.invoiceId === invoice.id)
    expect(items).toHaveLength(3)
    expect(items.map((it) => it.description)).toEqual(['Habitación 101 — 2026-09-12', 'Late checkout', 'Cuna'])
    expect(items.map((it) => it.amount)).toEqual([100, 30, 10])

    // Total = 140 + 18 % = 165.20, y nace pagada por el prepago heredado del folio.
    expect(invoice.amount).toBe(PREPAID)
    expect(invoice.taxes).toBe(25.2)
    expect(invoice.amountPaid).toBe(invoice.amount)
    expect(invoice.status).toBe('paid')

    // Lo que informa el check-out: pagado = total, nada pendiente.
    expect(result.amountPaid).toBe(PREPAID)
    expect(result.balance).toBe(0)

    // Sin saldo a favor: el folio cerró en 0 y no se acreditó nada de más.
    const after = computeTotals(w.charges as FolioChargeDTO[])
    expect(after.balance).toBe(0)
    expect(w.charges.filter((c) => c.kind === 'payment')).toHaveLength(1) // el prepago, una sola vez
    expect(Math.abs(Number(invoice.amount) - Number(invoice.amountPaid))).toBeLessThanOrEqual(BALANCE_EPSILON)
  })

  it('a nivel reserva: totalAmount 165.20 + addons booking_engine + pagado 165.20 → pendiente 0 y saldo a favor 0', () => {
    // Los addons del motor NO suman al total cobrable (ya viven en totalAmount): sin esta regla
    // el "Pendiente" del detalle pedía 40 de más, o el crédito mostraba 40 a favor.
    expect(pendingBalance(RESERVATION, ADDONS, PREPAID)).toBe(0)
    expect(creditBalance(RESERVATION, ADDONS, PREPAID)).toBe(0)
  })

  it('el crédito no se acredita dos veces al cerrar: `postPrepaidCredit` ve el folio saldado', async () => {
    const w = makeWorld()
    // paidOf devuelve lo mismo que el folio ya refleja → `falta` = 0 → ninguna línea nueva.
    await settleFolioAtCheckout(
      w.svc,
      { reservationId: 'r1', hotelId: 'h1', guestId: 'g1', roomId: 'rm1', settle: null },
      user,
      { paidOf: async () => PREPAID },
    )
    const payments = w.charges.filter((c) => c.kind === 'payment')
    expect(payments).toHaveLength(1)
    expect(payments[0].reference).toBe('pay-1')
  })
})
