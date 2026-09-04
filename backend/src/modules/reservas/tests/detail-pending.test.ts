// reservas/tests/detail-pending.test.ts — El pendiente de una reserva incluye los extras.
//
// Regresión (bug 2026-08-19): `getExtendedDetail` devolvía
// `pendingAmount = totalAmount - deposit`, ignorando `reservation_addons` y `otherCharges`.
// El modal usaba ese número para "Pendiente de cobro" Y para el monto de la Checkout Session
// de Stripe (`requirePayment()`), así que con extras cargados se cobraba de menos.
// Este test falla contra la versión vieja del usecase.

import { describe, it, expect } from 'bun:test'
import { getExtendedDetail } from '../usecases/detail'
import { chargeableTotal, pendingBalance, creditBalance, addonsTotal, paymentState } from '../../../shared/utils/reservation-balance'

const HOTEL = 'h1'
const USER = { id: 'u1', role: 'hotel_admin', hotelId: HOTEL }

const nullRepo = { findById: async () => null } as any

// El doble implementa TODO el contrato de ReservasQueries que usa el detalle: si le falta un
// método, el que se rompe es el test, no producción (el usecase no lleva guardas defensivas para
// acomodar mocks incompletos).
function queriesWith(
  addons: any[],
  money: { folios?: any[]; invoices?: any[]; payments?: any[] } = {},
  // Requerimiento 13 — fila cruda de `configuration(hotelId, key:'child_policy')`, para los tests
  // de `childrenAgesDetail` que necesitan una política DISTINTA al default.
  childPolicyRow: any = null,
) {
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
      // Requerimiento 14 — el mock respeta los TRES vínculos reales de `collectReservationPayments`
      // (folioId / invoiceId / reservationId directo, `reservation-paid.ts:168-188`), no solo los
      // dos primeros: antes, una consulta por `reservationId` directo (sin folioId/invoiceId en el
      // filtro) caía a comparar `p.invoiceId === undefined`, que matchea CUALQUIER pago sin
      // invoiceId — inventando plata ajena entre reservas hermanas de un mismo hotel (encontrado
      // por el test de aislamiento multi-habitación de abajo).
      paymentRepo: {
        findMany: async (f: any) => (money.payments ?? []).filter((p: any) => {
          if (p.hotelId !== f?.hotelId) return false
          if (f?.folioId !== undefined) return p.folioId === f.folioId
          if (f?.invoiceId !== undefined) return p.invoiceId === f.invoiceId
          if (f?.reservationId !== undefined) return p.reservationId === f.reservationId
          return false
        }),
      },
    },
    findConfiguration: async (_hotelId: string, key: string) => (key === 'child_policy' ? childPolicyRow : null),
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

// Requerimiento 14 (Administración | Pago realizado, 2026-09-04) — `getExtendedDetail` expone
// `paymentState`, calculado con los MISMOS `chargeableTotal`/`paidAmount` de arriba (nunca de
// `deposit` a secas) — para que Administración pueda determinar pendiente/parcial/pagada con los
// estados reales del dominio, sin inventar nada en el frontend.
describe('getExtendedDetail — paymentState (Requerimiento 14)', () => {
  it('reserva normal sin ningún cobro: pending', async () => {
    const repo = { findById: async () => reservation({ deposit: 0 }) } as any
    const d = await getExtendedDetail(repo, nullRepo, nullRepo, queriesWith([]), 'r1', USER, messageLogsPort())
    expect(d.paymentState).toBe('pending')
  })

  it('reserva con anticipo parcial (vía deposit, sin payments): partial', async () => {
    const repo = { findById: async () => reservation({ deposit: 200 }) } as any // total 1000
    const d = await getExtendedDetail(repo, nullRepo, nullRepo, queriesWith([]), 'r1', USER, messageLogsPort())
    expect(d.paymentState).toBe('partial')
  })

  it('reserva cobrada en efectivo por folio (deposit=0, payments cubre el total): paid, NO pending', async () => {
    const repo = { findById: async () => reservation({ deposit: 0, totalAmount: 300 }) } as any
    const d = await getExtendedDetail(
      repo, nullRepo, nullRepo,
      queriesWith([], {
        folios: [{ id: 'f1', hotelId: HOTEL, reservationId: 'r1', status: 'open' }],
        payments: [{ id: 'pay1', hotelId: HOTEL, folioId: 'f1', type: 'charge', status: 'completed', amount: 300 }],
      }),
      'r1', USER, messageLogsPort(),
    )
    expect(d.paymentState).toBe('paid')
    expect(d.pendingAmount).toBe(0)
  })

  // El caso que motiva el requerimiento: un intento de pago FALLIDO no debe leerse como dinero
  // pagado. `paidForReservation` ya lo excluye (COUNTED_STATUSES no incluye 'failed') — este test
  // prueba el contrato de punta a punta hasta `paymentState`, no solo la función pura.
  it('un intento de pago FALLIDO no cuenta como pagado: sigue pending, no partial/paid', async () => {
    const repo = { findById: async () => reservation({ deposit: 0, totalAmount: 300 }) } as any
    const d = await getExtendedDetail(
      repo, nullRepo, nullRepo,
      queriesWith([], {
        folios: [{ id: 'f1', hotelId: HOTEL, reservationId: 'r1', status: 'open' }],
        payments: [{ id: 'pay1', hotelId: HOTEL, folioId: 'f1', type: 'charge', status: 'failed', amount: 300 }],
      }),
      'r1', USER, messageLogsPort(),
    )
    expect(d.paidAmount).toBe(0)
    expect(d.paymentState).toBe('pending')
    // Pero el intento SIGUE visible en el historial, con su estado real — no se esconde.
    expect(d.paymentHistory).toHaveLength(1)
    expect(d.paymentHistory[0].status).toBe('failed')
  })

  // Requerimiento 13/14 — reserva de varias habitaciones: cada habitación tiene SU PROPIO folio
  // (mismo `reservationId` exacto, ver `folios/usecases/reservation-money.ts`), así que el cobro
  // de una habitación nunca se filtra al `paymentState` de otra, aunque compartan `groupId`.
  it('reserva de varias habitaciones: el cobro de UNA habitación no se filtra al paymentState de la hermana', async () => {
    const repoA = { findById: async () => reservation({ id: 'r-a', groupId: 'g1', deposit: 0, totalAmount: 300 }) } as any
    const repoB = { findById: async () => reservation({ id: 'r-b', groupId: 'g1', deposit: 0, totalAmount: 300 }) } as any
    // Folio de r-a cobrado completo; r-b NO tiene folio ni pagos propios.
    const queries = queriesWith([], {
      folios: [{ id: 'f-a', hotelId: HOTEL, reservationId: 'r-a', status: 'open' }],
      payments: [{ id: 'pay-a', hotelId: HOTEL, folioId: 'f-a', type: 'charge', status: 'completed', amount: 300 }],
    })
    const dA = await getExtendedDetail(repoA, nullRepo, nullRepo, queries, 'r-a', USER, messageLogsPort())
    const dB = await getExtendedDetail(repoB, nullRepo, nullRepo, queries, 'r-b', USER, messageLogsPort())
    expect(dA.paymentState).toBe('paid')
    expect(dB.paymentState).toBe('pending') // NO hereda el cobro de su hermana
    expect(dB.paidAmount).toBe(0)
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

// Requerimiento 11 (Persistencia de la composición, 2026-09-03) — la edad de cada niño tiene que
// sobrevivir hasta la Administración: `getExtendedDetail` es lo que arma `ReservationModal.vue`.
// El usecase hace `...safeReservation` (spread de la fila cruda menos los campos de tarjeta), así
// que `childrenAges` viaja gratis — este test lo prueba explícitamente para que un allow-list que
// se agregue después no lo descarte en silencio (mismo bug que ya se encontró y arregló en el
// endpoint PÚBLICO equivalente, `getPublicReservation`).
describe('getExtendedDetail — childrenAges sobrevive hasta Administración (Requerimiento 11)', () => {
  it('reserva con edades: el detalle las expone tal cual se persistieron', async () => {
    const repo = { findById: async () => reservation({ adults: 2, children: 2, childrenAges: [4, 9] }) } as any
    const d = await getExtendedDetail(repo, nullRepo, nullRepo, queriesWith([]), 'r1', USER, messageLogsPort())
    expect(d.childrenAges).toEqual([4, 9])
    expect(d.adults).toBe(2)
    expect(d.children).toBe(2)
  })

  it('reserva legacy sin childrenAges: no revienta, el detalle sale igual', async () => {
    const repo = { findById: async () => reservation({ adults: 2, children: 1 }) } as any // sin childrenAges
    const d = await getExtendedDetail(repo, nullRepo, nullRepo, queriesWith([]), 'r1', USER, messageLogsPort())
    expect(d.childrenAges).toBeUndefined() // la fila cruda nunca tuvo el campo — no se inventa
    expect(d.adults).toBe(2)
  })

  it('childrenAgesAsOf también sobrevive el spread (no es un campo de tarjeta, no se filtra)', async () => {
    const repo = { findById: async () => reservation({ adults: 2, children: 1, childrenAges: [8], childrenAgesAsOf: '2030-01-10' }) } as any
    const d = await getExtendedDetail(repo, nullRepo, nullRepo, queriesWith([]), 'r1', USER, messageLogsPort())
    expect(d.childrenAgesAsOf).toBe('2030-01-10')
  })
})

// Requerimiento 13 (Administración | Composición de huéspedes, 2026-09-03) — el panel necesita
// saber CUÁLES edades declaradas se reclasificaron como adulto, no solo que "alguna" lo hizo
// (eso ya lo mostraba `ReservationModal.vue` desde el Requerimiento 11). `childrenAgesDetail` es
// el desglose por niño que arma esa distinción, calculado con la política VIGENTE del hotel
// (nunca congelada al momento de la reserva — mismo criterio que `reprice.ts`).
describe('getExtendedDetail — childrenAgesDetail (Requerimiento 13)', () => {
  const POLICY = { hotelId: HOTEL, key: 'child_policy', value: { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3 } }

  it('reserva solo con adultos: childrenAgesDetail vacío, no se lee la política (sin childrenAges)', async () => {
    let policyRead = false
    const repo = { findById: async () => reservation({ adults: 3, children: 0 }) } as any
    const queries = queriesWith([], {}, POLICY)
    queries.findConfiguration = async (...args: any[]) => { policyRead = true; return POLICY }
    const d = await getExtendedDetail(repo, nullRepo, nullRepo, queries, 'r1', USER, messageLogsPort())
    expect(d.childrenAgesDetail).toEqual([])
    expect(policyRead).toBe(false)
  })

  it('niño libre (≤ maxFreeAge): classification "free"', async () => {
    const repo = { findById: async () => reservation({ adults: 2, children: 1, childrenAges: [2] }) } as any
    const d = await getExtendedDetail(repo, nullRepo, nullRepo, queriesWith([], {}, POLICY), 'r1', USER, messageLogsPort())
    expect(d.childrenAgesDetail).toEqual([{ declaredAge: 2, effectiveAge: 2, classification: 'free' }])
  })

  it('niño con plaza (maxFreeAge < edad ≤ maxChildAge): classification "paying"', async () => {
    const repo = { findById: async () => reservation({ adults: 2, children: 1, childrenAges: [8] }) } as any
    const d = await getExtendedDetail(repo, nullRepo, nullRepo, queriesWith([], {}, POLICY), 'r1', USER, messageLogsPort())
    expect(d.childrenAgesDetail).toEqual([{ declaredAge: 8, effectiveAge: 8, classification: 'paying' }])
  })

  it('edad > maxChildAge: classification "adult" — identifica CUÁL edad se reclasificó', async () => {
    const repo = { findById: async () => reservation({ adults: 2, children: 0, childrenAges: [15] }) } as any
    const d = await getExtendedDetail(repo, nullRepo, nullRepo, queriesWith([], {}, POLICY), 'r1', USER, messageLogsPort())
    expect(d.childrenAgesDetail).toEqual([{ declaredAge: 15, effectiveAge: 15, classification: 'adult' }])
  })

  it('varios niños con edades distintas: cada uno con SU propia clasificación', async () => {
    const repo = { findById: async () => reservation({ adults: 2, children: 2, childrenAges: [1, 8, 16] }) } as any
    const d = await getExtendedDetail(repo, nullRepo, nullRepo, queriesWith([], {}, POLICY), 'r1', USER, messageLogsPort())
    expect(d.childrenAgesDetail).toEqual([
      { declaredAge: 1, effectiveAge: 1, classification: 'free' },
      { declaredAge: 8, effectiveAge: 8, classification: 'paying' },
      { declaredAge: 16, effectiveAge: 16, classification: 'adult' },
    ])
  })

  it('reserva legacy sin child_policy configurada: cae a DEFAULT_CHILD_POLICY, no revienta', async () => {
    const repo = { findById: async () => reservation({ adults: 2, children: 1, childrenAges: [5] }) } as any
    const d = await getExtendedDetail(repo, nullRepo, nullRepo, queriesWith([]), 'r1', USER, messageLogsPort()) // sin childPolicyRow
    // DEFAULT_CHILD_POLICY: maxChildAge=17, maxFreeAge=0 → 5 años consume plaza.
    expect(d.childrenAgesDetail).toEqual([{ declaredAge: 5, effectiveAge: 5, classification: 'paying' }])
  })

  it('reserva reagendada con childrenAgesAsOf: la clasificación usa la edad EFECTIVA (proyectada al checkIn actual), no la declarada', async () => {
    // Niño libre de 3 declarado en 2030-01-10; la reserva quedó con checkIn 2031-06-01 tras un
    // reagendado (>1 año) — proyecta a 4, cruza maxFreeAge=3 → ahora consume plaza.
    const repo = { findById: async () => reservation({ adults: 2, children: 1, childrenAges: [3], childrenAgesAsOf: '2030-01-10', checkIn: '2031-06-01' }) } as any
    const d = await getExtendedDetail(repo, nullRepo, nullRepo, queriesWith([], {}, POLICY), 'r1', USER, messageLogsPort())
    expect(d.childrenAgesDetail).toEqual([{ declaredAge: 3, effectiveAge: 4, classification: 'paying' }])
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

// Requerimiento 14 (Administración | Pago realizado, 2026-09-04) — `paymentState` es una
// ETIQUETA sobre `chargeableTotal`/`paidAmount`, ninguno de los dos re-derivado: mismos números
// que "Pendiente de cobro" ya muestra, para que el badge nunca contradiga al resto de la tarjeta.
describe('reservation-balance — paymentState (Requerimiento 14)', () => {
  it('nada cobrado (paidAmount ausente, sin deposit): pending', () => {
    const r = { totalAmount: 500 }
    expect(paymentState(r, [])).toBe('pending')
  })

  it('paidAmount = 0 explícito: pending (no cae al fallback de deposit)', () => {
    const r = { totalAmount: 500, deposit: 100 } // deposit>0 pero paidAmount manda
    expect(paymentState(r, [], 0)).toBe('pending')
  })

  it('paidAmount cubre parte del total: partial', () => {
    const r = { totalAmount: 500 }
    expect(paymentState(r, [], 200)).toBe('partial')
  })

  it('paidAmount cubre el total exacto: paid', () => {
    const r = { totalAmount: 500 }
    expect(paymentState(r, [], 500)).toBe('paid')
  })

  it('paidAmount cubre el total dentro de la tolerancia de centavos: paid (no partial por drift binario)', () => {
    const r = { totalAmount: 500 }
    expect(paymentState(r, [], 499.995)).toBe('paid')
  })

  it('paidAmount supera el total (sobrepago): paid, no revienta', () => {
    const r = { totalAmount: 500 }
    expect(paymentState(r, [], 600)).toBe('paid')
  })

  // GH-0.2 — el bug real que motiva este requerimiento: un cobro en efectivo por folio/factura
  // mueve `payments` (y por lo tanto `paidAmount`) pero NUNCA `reservations.deposit`. Sin
  // `paidAmount`, el estado caería al fallback de `deposit` y diría "pending" sobre una reserva
  // ya cobrada — exactamente la divergencia que este requerimiento pide eliminar.
  it('cobrado por folio en efectivo (deposit=0, paidAmount=total vía payments): paid, no pending', () => {
    const r = { totalAmount: 500, deposit: 0 }
    expect(paymentState(r, [], 500)).toBe('paid')
  })

  it('un pago FALLIDO no cuenta como pagado: paidAmount ya lo excluye (paidForReservation), paymentState hereda ese 0', () => {
    // paidForReservation ya filtra `failed` antes de llegar acá (ver reservation-paid.test.ts) —
    // este test fija el contrato del LADO de paymentState: paidAmount=0 (como si el único intento
    // hubiera fallado) nunca debe leerse como "paid" ni "partial".
    const r = { totalAmount: 500 }
    expect(paymentState(r, [], 0)).toBe('pending')
  })

  it('total cobrable ≤ 0 (descuento supera el alojamiento): pending, no "paid" engañoso', () => {
    const r = { totalAmount: 100, deposit: 0 }
    const addons = [{ amount: 500, quantity: 1, kind: 'discount' }] // chargeableTotal = -400
    expect(chargeableTotal(r, addons)).toBe(-400)
    expect(paymentState(r, addons, 0)).toBe('pending')
  })

  it('addons y otherCharges entran al total que decide el estado (no solo totalAmount)', () => {
    const r = { totalAmount: 500, otherCharges: 20 }
    const addons = [{ amount: 30, quantity: 1, kind: 'service' }] // chargeableTotal = 550
    expect(paymentState(r, addons, 500)).toBe('partial') // cubre el alojamiento, no los extras
    expect(paymentState(r, addons, 550)).toBe('paid')
  })
})
