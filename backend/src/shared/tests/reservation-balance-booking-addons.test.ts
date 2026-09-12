// shared/tests/reservation-balance-booking-addons.test.ts — #269: los extras pagados online
// (`reservation_addons` con `source:'booking_engine'`) YA están dentro de `reservations.totalAmount`,
// así que NO vuelven a sumarse al total cobrable. Un addon manual (source 'manual' o sin source)
// sigue sumando como siempre.

import { describe, it, expect } from 'bun:test'
import {
  addonsTotal, chargeableTotal, pendingBalance, creditBalance, isBookingEngineAddon, paymentState,
} from '../utils/reservation-balance'

const MANUAL = { description: 'Cena', amount: 20, quantity: 1, kind: 'service', source: 'manual' }
const LEGACY = { description: 'Late checkout', amount: 15, quantity: 2, kind: 'service' } // sin source
const ENGINE = { description: 'Desayuno', amount: 10, quantity: 3, kind: 'service', source: 'booking_engine' }

describe('isBookingEngineAddon', () => {
  it('sólo source booking_engine', () => {
    expect(isBookingEngineAddon(ENGINE)).toBe(true)
    expect(isBookingEngineAddon(MANUAL)).toBe(false)
    expect(isBookingEngineAddon(LEGACY)).toBe(false)
    expect(isBookingEngineAddon(null)).toBe(false)
    expect(isBookingEngineAddon(undefined)).toBe(false)
  })
})

describe('addonsTotal', () => {
  it('suma manuales y legacy (sin source), ignora booking_engine', () => {
    expect(addonsTotal([MANUAL])).toBe(20)
    expect(addonsTotal([LEGACY])).toBe(30)
    expect(addonsTotal([ENGINE])).toBe(0)
    expect(addonsTotal([MANUAL, LEGACY, ENGINE])).toBe(50)
  })

  it('un descuento booking_engine tampoco resta', () => {
    expect(addonsTotal([{ amount: 5, kind: 'discount', source: 'booking_engine' }])).toBe(0)
    expect(addonsTotal([{ amount: 5, kind: 'discount', source: 'manual' }])).toBe(-5)
  })
})

describe('chargeableTotal / pendingBalance con extras del motor', () => {
  // Escenario del issue: noche 125.20 + extras online 40 = totalAmount 165.20; addon booking_engine 30.
  const reservation = { totalAmount: 165.2, otherCharges: 0, deposit: 0 }
  const engineAddon = { description: 'Cuna', amount: 30, quantity: 1, kind: 'service', source: 'booking_engine' }

  it('el total cobrable no cambia por un addon booking_engine', () => {
    expect(chargeableTotal(reservation, [engineAddon])).toBe(165.2)
    expect(chargeableTotal(reservation, [])).toBe(165.2)
  })

  it('pagado 165.20 → pendiente 0 y crédito 0 (no hay doble cobro)', () => {
    expect(pendingBalance(reservation, [engineAddon], 165.2)).toBe(0)
    expect(creditBalance(reservation, [engineAddon], 165.2)).toBe(0)
    expect(paymentState(reservation, [engineAddon], 165.2)).toBe('paid')
  })

  it('un addon manual sí sube el total y el pendiente', () => {
    expect(chargeableTotal(reservation, [engineAddon, MANUAL])).toBe(185.2)
    expect(pendingBalance(reservation, [engineAddon, MANUAL], 165.2)).toBe(20)
    expect(paymentState(reservation, [engineAddon, MANUAL], 165.2)).toBe('partial')
  })
})
