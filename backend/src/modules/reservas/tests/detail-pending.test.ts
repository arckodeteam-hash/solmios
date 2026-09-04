// reservas/tests/detail-pending.test.ts — El pendiente de una reserva incluye los extras.
//
// Regresión (bug 2026-08-19): `getExtendedDetail` devolvía
// `pendingAmount = totalAmount - deposit`, ignorando `reservation_addons` y `otherCharges`.
// El modal usaba ese número para "Pendiente de cobro" Y para el monto de la Checkout Session
// de Stripe (`requirePayment()`), así que con extras cargados se cobraba de menos.
// Este test falla contra la versión vieja del usecase.

import { describe, it, expect } from 'bun:test'
import { getExtendedDetail } from '../usecases/detail'
import { chargeableTotal, pendingBalance, creditBalance, addonsTotal } from '../../../shared/utils/reservation-balance'

const HOTEL = 'h1'
const USER = { id: 'u1', role: 'hotel_admin', hotelId: HOTEL }

const nullRepo = { findById: async () => null } as any

// El doble implementa TODO el contrato de ReservasQueries que usa el detalle: si le falta un
// método, el que se rompe es el test, no producción (el usecase no lleva guardas defensivas para
// acomodar mocks incompletos).
function queriesWith(addons: any[], money: { folios?: any[]; invoices?: any[]; payments?: any[] } = {}) {
  return {
    getCompanions: async () => [],
    getLockCodes: async () => [],
    getPaymentRequests: async () => [],
    getReservationAddons: async () => addons,
    // GH-0.2 — camino reserva → `payments`. Los dobles respetan el WHERE real (hotel incluido):
    // A `payments` se llega por folios/invoices/reservationId directo (tercer vínculo, COR-A).
    paidRepos: {
      folioRepo: { findMany: async (f: any) => (money.folios ?? []).filter((x: any) => x.hotelId === f?.hotelId && x.reservationId === f?.reservationId) },
      invoiceRepo: { findMany: async (f: any) => (money.invoices ?? []).filter((x: any) => x.hotelId === f?.hotelId && x.reservationId === f?.reservationId) },
      paymentRepo: {
        findMany: async (f: any) => (money.payments ?? []).filter((p: any) => p.hotelId === f?.hotelId
          && (f?.folioId !== undefined ? p.folioId === f.folioId : p.invoiceId === f?.invoiceId)),
      },
    },
  } as any
}

/** Puerto al módulo marketing (STR-3): el detalle NO lee `message_logs` por su cuenta. */
function messageLogsPort(rows: any[] = []) {
  const calls: [string, string][] = []
  const port = async (hotelId: string, reservationId: string) => {
    calls.push([hotelId, reservationId])
    return rows
  }
  return Object.assign(port, { calls })
}

function reservation(over: Record<string, any> = {}) {
  return { id: 'r1', hotelId: HOTEL, totalAmount: 1000, deposit: 200, otherCharges: 0, ...over }
}

describe('getExtendedDetail — total cobrable y pendiente', () => {
  it('suma los addons y los otros cobros al pendiente', async () => {
    const repo = { findById: async () => reservation({ otherCharges: 50 }) } as any
    const d = await getExtendedDetail(
      repo, nullRepo, nullRepo,
      queriesWith([
        { id: 'a1', description: 'Cena', amount: 100, quantity: 2, kind: 'service' },
        { id: 'a2', description: 'Promo', amount: 30, quantity: 1, kind: 'discount' },
      ]),
      'r1', USER, messageLogsPort(),
    )
    // 1000 (alojamiento) + 50 (otros cobros) + 200 (2×100 servicio) − 30 (descuento) = 1220
    // 1220 − 200 de anticipo = 1020 (antes del fix devolvía 800: se cobraba de menos)
    expect(d.pendingAmount).toBe(1020)
    expect(d.chargeableTotal).toBe(1220)
    expect(d.addonsTotal).toBe(170)
  })

  it('sin extras se comporta igual que antes (total − anticipo)', async () => {
    const repo = { findById: async () => reservation() } as any
    const d = await getExtendedDetail(repo, nullRepo, nullRepo, queriesWith([]), 'r1', USER, messageLogsPort())
    expect(d.chargeableTotal).toBe(1000)
    expect(d.pendingAmount).toBe(800)
  })

  it('nunca devuelve pendiente negativo (anticipo mayor al total cobrable)', async () => {
    const repo = { findById: async () => reservation({ deposit: 5000 }) } as any
    const d = await getExtendedDetail(repo, nullRepo, nullRepo, queriesWith([]), 'r1', USER, messageLogsPort())
    expect(d.pendingAmount).toBe(0)
  })

  it('un descuento que supera el alojamiento no rompe el total', async () => {
    const repo = { findById: async () => reservation({ totalAmount: 100, deposit: 0 }) } as any
    const d = await getExtendedDetail(
      repo, nullRepo, nullRepo,
      queriesWith([{ id: 'a1', amount: 500, quantity: 1, kind: 'discount' }]),
      'r1', USER, messageLogsPort(),
    )
    expect(d.chargeableTotal).toBe(-400)
    expect(d.pendingAmount).toBe(0)
  })
})

// ── GH-0.2: "lo pagado" sale de `payments`, no de la columna `deposit` ────────────────────────
// `folios.applyPayment` y `facturas.pay` asientan en `payments` y no tocan `reservations.deposit`.
// El detalle mostraba "Pendiente $1000" sobre una reserva con $300 ya cobrados en efectivo, y ese
// mismo número es el techo con el que `charge-ceiling` autoriza el cobro por Stripe.
describe('getExtendedDetail — lo pagado sale de `payments`', () => {
  it('descuenta el cobro asentado contra el folio aunque `deposit` sea 0', async () => {
    const repo = { findById: async () => reservation({ deposit: 0 }) } as any
    const d = await getExtendedDetail(
      repo, nullRepo, nullRepo,
      queriesWith([], {
        folios: [{ id: 'f1', hotelId: HOTEL, reservationId: 'r1', status: 'open' }],
        payments: [{ id: 'pay1', hotelId: HOTEL, folioId: 'f1', type: 'charge', status: 'completed', amount: 300 }],
      }),
      'r1', USER, messageLogsPort(),
    )
    expect(d.paidAmount).toBe(300)
    expect(d.pendingAmount).toBe(700) // antes: 1000, con $300 ya cobrados
    expect(d.chargeableTotal).toBe(1000)
  })

  it('cuenta el cobro asentado contra la factura de la reserva', async () => {
    const repo = { findById: async () => reservation({ deposit: 0 }) } as any
    const d = await getExtendedDetail(
      repo, nullRepo, nullRepo,
      queriesWith([], {
        invoices: [{ id: 'inv1', hotelId: HOTEL, reservationId: 'r1' }],
        payments: [{ id: 'pay1', hotelId: HOTEL, invoiceId: 'inv1', type: 'charge', status: 'completed', amount: 1000 }],
      }),
      'r1', USER, messageLogsPort(),
    )
    expect(d.pendingAmount).toBe(0)
  })

  it('sin filas en `payments` cae al anticipo de la reserva (comportamiento previo)', async () => {
    const repo = { findById: async () => reservation() } as any
    const d = await getExtendedDetail(repo, nullRepo, nullRepo, queriesWith([]), 'r1', USER, messageLogsPort())
    expect(d.paidAmount).toBe(200)
    expect(d.pendingAmount).toBe(800)
  })
})

describe('getExtendedDetail — historial de envíos', () => {
  it('pide los message_logs al puerto de marketing, acotados al hotel de la reserva (multi-tenant)', async () => {
    const repo = { findById: async () => reservation() } as any
    const port = messageLogsPort([
      { id: 'ml1', messageType: 'email', status: 'sent', recipient: 'a@b.com', sentAt: '2026-08-19T10:00:00.000Z' },
    ])
    const d = await getExtendedDetail(repo, nullRepo, nullRepo, queriesWith([]), 'r1', USER, port)
    expect(port.calls).toEqual([[HOTEL, 'r1']])
    expect(d.messageLogs).toHaveLength(1)
  })

  // STR-3: `response` guarda el error crudo del transporte de email; el detalle se sirve con
  // `reservations:view` y no puede filtrar un dato que hasta ahora pedía `settings:view`.
  it('proyecta la fila y NO expone `response` ni ordena al azar', async () => {
    const repo = { findById: async () => reservation() } as any
    const port = messageLogsPort([
      { id: 'viejo', messageType: 'email', sentAt: '2026-08-18T10:00:00.000Z', response: 'SMTP 550 mailbox unavailable' },
      { id: 'nuevo', messageType: 'whatsapp', sentAt: '2026-08-19T10:00:00.000Z', response: '{"kind":"manual","reference":"bienvenida","byUserId":"u9"}' },
    ])
    const d = await getExtendedDetail(repo, nullRepo, nullRepo, queriesWith([]), 'r1', USER, port)
    expect(d.messageLogs.map((m: any) => m.id)).toEqual(['nuevo', 'viejo'])
    expect(d.messageLogs[0]).toMatchObject({ manual: true, reference: 'bienvenida', sentByUserId: 'u9' })
    expect(Object.keys(d.messageLogs[1])).not.toContain('response')
  })
})

describe('reservation-balance — helper compartido', () => {
  it('cantidad por defecto = 1 cuando el addon no la trae', () => {
    expect(addonsTotal([{ amount: 25 }])).toBe(25)
  })

  it('redondea a 2 decimales (sin arrastre binario)', () => {
    expect(chargeableTotal({ totalAmount: 0.1, otherCharges: 0.2 })).toBe(0.3)
  })

  it('pendingBalance = chargeableTotal − deposit', () => {
    const r = { totalAmount: 500, otherCharges: 20, deposit: 100 }
    const addons = [{ amount: 10, quantity: 3, kind: 'service' }]
    expect(chargeableTotal(r, addons)).toBe(550)
    expect(pendingBalance(r, addons)).toBe(450)
  })
})

// El excedente estaba desapareciendo: `pendingBalance` recorta en 0, así que un huésped que pagó
// de más se veía igual que uno que pagó justo, y esa plata no aparecía en ninguna pantalla.
describe('creditBalance — lo que el huésped pagó de más', () => {
  it('pagó más de lo que debía: la diferencia queda a su favor', () => {
    const r = { totalAmount: 195 }
    expect(creditBalance(r, [], 210)).toBe(15)
    expect(pendingBalance(r, [], 210)).toBe(0)   // y no debe nada
  })

  it('pagó justo: no hay crédito ni deuda', () => {
    const r = { totalAmount: 195 }
    expect(creditBalance(r, [], 195)).toBe(0)
    expect(pendingBalance(r, [], 195)).toBe(0)
  })

  it('debe plata: el crédito es cero, no un número negativo', () => {
    const r = { totalAmount: 300 }
    expect(creditBalance(r, [], 100)).toBe(0)
    expect(pendingBalance(r, [], 100)).toBe(200)
  })

  it('nunca hay crédito y pendiente al mismo tiempo', () => {
    const r = { totalAmount: 250, otherCharges: 30 }
    const addons = [{ amount: 20, quantity: 2 }]
    for (const paid of [0, 100, 320, 400]) {
      const debe = pendingBalance(r, addons, paid)
      const aFavor = creditBalance(r, addons, paid)
      expect(debe > 0 && aFavor > 0).toBe(false)
    }
  })

  it('los extras cuentan: un crédito contra el total pelado sería falso', () => {
    const r = { totalAmount: 195 }
    const addons = [{ amount: 30 }]              // total cobrable = 225
    expect(creditBalance(r, addons, 210)).toBe(0)      // no pagó de más: debe 15
    expect(pendingBalance(r, addons, 210)).toBe(15)
  })

  it('redondea a centavos, sin arrastre binario', () => {
    expect(creditBalance({ totalAmount: 0.1 }, [], 0.3)).toBe(0.2)
  })
})
