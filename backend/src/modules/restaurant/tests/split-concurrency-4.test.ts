// restaurant/tests/split-concurrency-4.test.ts — #214 COR-A (ronda 4) / COR-C: los totales y el cierre.
//
// Reproducciones del carril `correccion` (qa-cor-a2 / qa-cor-c) sobre el ORM real (SqliteAdapter in-memory,
// UPDATE condicional real), ver split-concurrency-harness.ts.
//
//   - COR-A (ronda 4): una parte POR MONTO y el cobro ENTERO llamaban `recomputeTotals` FUERA del lock de
//     líneas. Con latencia en el `orders.update` (la red hacia PG), la escritura pisaba con el total viejo
//     (100) el que `voidLine` acababa de escribir (40), y el CAS del dinero "matcheaba" contra ese valor:
//     comanda `paid` con 100 sobre líneas por 40. Regla nueva: el dinero LEE los totales y los condiciona;
//     solo una edición bajo el lock (líneas o descuentos) los escribe.
//   - COR-C (carrera nueva): devolver una parte (comanda abierta) y cobrar la parte que cierra la cuenta
//     competían por `amountPaid`. El cierre sumaba las partes (la `refunding` contaba como cobrada) y cerraba
//     con `amountPaid` 40 sobre 100 + `onOrderPaid`, y la parte quedaba devuelta. Regla nueva: la devolución
//     mueve su monto a `amountReserved` con el CAS ANTES de tocar el puerto; el cierre decide sobre
//     `amountPaid` de la fila. Invariante: una comanda `paid` tiene `amountPaid == due`.
import { describe, it, expect } from 'bun:test'
import { addOrderPayment, refundOrderPayment } from '../usecases/split-payments'
import { voidLine, updateLine } from '../usecases/order-lines'
import { payOrder, billOrder } from '../usecases/settlement'
import { cancelOrder } from '../usecases/orders'
import { applyOrderDiscount, type DiscountsDeps } from '../usecases/discounts'
import type { OrderItemDTO } from '../types'
import { withOrm, seedOrder, linesDeps, ordersDeps, userRepo, strictAuth, user, outcome, sumAmounts, sleep, type Harness } from './split-concurrency-harness'

const REASON = { reason: 'cobrado por error' }
const editor = { ...user, permissions: ['restaurant:delete'] }
const lineNamed = async (h: Harness, orderId: string, name: string): Promise<OrderItemDTO> => (await h.lines.findMany({ orderId })).find((l) => l.name === name)!
/** Latencia SOLO en `orders.update` (la escritura de un recomputeTotals fuera del lock), como una red hacia PG. */
const slowWrite = (h: Harness, ms: number) => ({
  ...h.deps,
  orders: { findById: (i: string) => h.orders.findById(i), findOne: (w: any) => h.orders.findOne(w), findMany: (w: any) => h.orders.findMany(w), update: async (i: string, d: any) => { await sleep(ms); return h.orders.update(i, d) } } as any,
})
/** Saldo real de la comanda según sus líneas vivas (neto + impuesto). */
const activeDue = async (h: Harness, orderId: string): Promise<number> =>
  (await h.lines.findMany({ orderId })).filter((l) => l.status !== 'voided').reduce((s, l) => s + Number(l.lineTotal) * (1 + Number(l.taxRate || 0) / 100), 0)

describe('#214 COR-A (ronda 4) — el dinero no recalcula totales: voidLine vs parte por MONTO / cobro ENTERO', () => {
  for (const lat of [0, 10, 30]) {
    it(`voidLine(A=60) || parte cash POR MONTO 100 (update de totales tarda ${lat} ms): nunca amountPaid > saldo real`, async () => {
      await withOrm(async (h) => {
        const o = await seedOrder(h, [[60, 0, 'A'], [40, 0, 'B']])
        const a = await lineNamed(h, o.id, 'A')
        const rs = await Promise.allSettled([
          addOrderPayment(slowWrite(h, lat), o.id, { method: 'cash', amount: 100 }, user),
          (async () => { await sleep(1); return voidLine(linesDeps(h), o.id, a.id, 'se cayó', editor) })(),
        ])
        const f = (await h.orders.findById(o.id))!
        const due = await activeDue(h, o.id)
        // Cada uno pudo entrar o rebotar (409/400), pero lo cobrado nunca supera lo que hay en la mesa.
        expect(rs.map(outcome).every((x) => x === 'ok' || /Conflict|Validation/.test(x)), rs.map(outcome).join(' | ')).toBe(true)
        expect(Number(f.amountPaid)).toBeLessThanOrEqual(due + 0.01)
        expect(sumAmounts(h.money.payments)).toBeLessThanOrEqual(due + 0.01)
        expect(Number(f.subtotal), 'el subtotal de la fila es el de las líneas vivas').toBeCloseTo(due, 2)
        if (f.status === 'paid') expect(Number(f.amountPaid)).toBeCloseTo(due, 2)
      })
    })
    it(`voidLine(A=60) || payOrder ENTERO cash (update de totales tarda ${lat} ms): lo cobrado nunca supera el saldo real`, async () => {
      await withOrm(async (h) => {
        const o = await seedOrder(h, [[60, 0, 'A'], [40, 0, 'B']])
        const a = await lineNamed(h, o.id, 'A')
        const rs = await Promise.allSettled([
          payOrder(slowWrite(h, lat), o.id, { method: 'cash' }, user),
          (async () => { await sleep(1); return voidLine(linesDeps(h), o.id, a.id, 'se cayó', editor) })(),
        ])
        const f = (await h.orders.findById(o.id))!
        const due = await activeDue(h, o.id)
        expect(rs.map(outcome).every((x) => x === 'ok' || /Conflict|Validation/.test(x)), rs.map(outcome).join(' | ')).toBe(true)
        expect(sumAmounts(h.money.payments)).toBeLessThanOrEqual(due + 0.01)
        expect(Number(f.subtotal)).toBeCloseTo(due, 2)
        if (f.status === 'paid') expect(sumAmounts(h.money.payments)).toBeCloseTo(due, 2)
      })
    })
  }

  it('updateLine(A 1→3) || parte por monto 100 (update de totales tarda 10 ms): si queda paid, amountPaid == saldo (220 no se cierra con 100)', async () => {
    await withOrm(async (h) => {
      const o = await seedOrder(h, [[60, 0, 'A'], [40, 0, 'B']])
      const a = await lineNamed(h, o.id, 'A')
      const rs = await Promise.allSettled([
        addOrderPayment(slowWrite(h, 10), o.id, { method: 'cash', amount: 100 }, user),
        (async () => { await sleep(1); return updateLine(linesDeps(h), o.id, a.id, { quantity: 3 }, editor) })(),
      ])
      const f = (await h.orders.findById(o.id))!
      const due = await activeDue(h, o.id)
      expect(rs.map(outcome).every((x) => x === 'ok' || /Conflict|Validation/.test(x)), rs.map(outcome).join(' | ')).toBe(true)
      expect(Number(f.subtotal)).toBeCloseTo(due, 2)
      if (f.status === 'paid') expect(Number(f.amountPaid)).toBeCloseTo(due, 2)
    })
  })

  it('billOrder (propina) || voidLine: el total de la fila es saldo real + propina, nunca el total viejo', async () => {
    await withOrm(async (h) => {
      const o = await seedOrder(h, [[60, 0, 'A'], [40, 0, 'B']])
      const a = await lineNamed(h, o.id, 'A')
      const rs = await Promise.allSettled([
        billOrder(slowWrite(h, 10), o.id, { tip: 10 }, user),
        (async () => { await sleep(1); return voidLine(linesDeps(h), o.id, a.id, 'se cayó', editor) })(),
      ])
      const f = (await h.orders.findById(o.id))!
      const due = await activeDue(h, o.id)
      expect(rs.map(outcome).every((x) => x === 'ok' || /Conflict/.test(x)), rs.map(outcome).join(' | ')).toBe(true)
      expect(Number(f.subtotal)).toBeCloseTo(due, 2)
      expect(Number(f.total)).toBeCloseTo(due + Number(f.tip || 0), 2)
    })
  })
})

describe('#215 × #214 — un descuento mueve el total como una línea: pasa por el lock de líneas', () => {
  /** Deps de descuentos con el MISMO cas (el orm), como en producción (deps.ts). hotel_admin: sin tope. */
  const discountsDeps = (h: Harness): DiscountsDeps => ({ orders: h.orders, lines: h.lines, config: { findOne: async () => null } as any, userRepo, auth: strictAuth, cas: h.deps.cas, audit: h.deps.audit })
  for (const lat of [0, 10]) {
    it(`applyOrderDiscount(50 %) || parte cash 100 (update tarda ${lat} ms): paid ⇒ amountPaid == saldo real, y nunca se cobra más que el saldo`, async () => {
      await withOrm(async (h) => {
        const o = await seedOrder(h, [[100, 0]])
        const rs = await Promise.allSettled([
          addOrderPayment(slowWrite(h, lat), o.id, { method: 'cash', amount: 100 }, user),
          (async () => { await sleep(1); return applyOrderDiscount(discountsDeps(h), o.id, { type: 'percent', value: 50, reason: 'huésped' }, user) })(),
        ])
        const f = (await h.orders.findById(o.id))!
        const due = Number(f.subtotal) + Number(f.tax)
        expect(rs.map(outcome).every((x) => x === 'ok' || /Conflict|Validation/.test(x)), rs.map(outcome).join(' | ')).toBe(true)
        // O entró el descuento (saldo 50, la parte de 100 rebotó) o entró la parte (paid 100, el descuento rebotó por pagos parciales).
        expect(Number(f.amountPaid)).toBeLessThanOrEqual(due + 0.01)
        if (f.status === 'paid') { expect(Number(f.amountPaid)).toBeCloseTo(due, 2); expect(f.discountType ?? null).toBeNull() }
        else expect(due).toBe(50)
        expect(Number(f.amountReserved)).toBe(0)
      })
    })
  }
  it('con una parte cobrada, el descuento da 409 (pagos parciales) y no toca la fila', async () => {
    await withOrm(async (h) => {
      const o = await seedOrder(h, [[100, 0]])
      await addOrderPayment(h.deps, o.id, { method: 'cash', amount: 40 }, user)
      await expect(applyOrderDiscount(discountsDeps(h), o.id, { type: 'percent', value: 10, reason: 'x' }, user)).rejects.toThrow(/pagos parciales/)
      const f = (await h.orders.findById(o.id))!
      expect(Number(f.subtotal)).toBe(100)
      expect(f.discountType ?? null).toBeNull()
    })
  })
})

describe('#214 COR-C — refund de una parte (comanda abierta) vs la parte que cierra la cuenta', () => {
  for (const lat of [0, 5, 20]) {
    it(`refund(parte1=60, comanda sent) || parte2=40 que cierra (puerto de refund tarda ${lat} ms): paid ⇒ amountPaid == 100`, async () => {
      await withOrm(async (h) => {
        const o = await seedOrder(h, [[100, 0]])
        const p1 = await addOrderPayment(h.deps, o.id, { method: 'cash', amount: 60 }, user)
        h.deps.ports.refundPayment = async ({ paymentId }) => { if (lat) await sleep(lat); h.money.refunds.push(paymentId) }
        const rs = await Promise.allSettled([
          refundOrderPayment(h.deps, o.id, p1.part.id, REASON, user),
          (async () => { await sleep(1); return addOrderPayment(h.deps, o.id, { method: 'cash', amount: 40 }, user) })(),
        ])
        const f = (await h.orders.findById(o.id))!
        const parts = await h.parts.findMany({ orderId: o.id })
        const paidParts = parts.filter((p) => p.status === 'completed' || p.status === 'refunded')
        expect(rs.map(outcome).every((x) => x === 'ok' || /Conflict|Validation/.test(x)), rs.map(outcome).join(' | ')).toBe(true)
        expect(Number(f.amountReserved), 'la reserva de la devolución se libera').toBe(0)
        // Invariante: la fila y las partes cuentan lo mismo.
        expect(Number(f.amountPaid)).toBeCloseTo(sumAmounts(paidParts), 2)
        if (f.status === 'paid') {
          expect(Number(f.amountPaid)).toBe(100)
          expect(h.events).toEqual(['paid'])
          expect(f.businessDate, '#213: el cierre por partes lleva el día contable').toMatch(/^\d{4}-\d{2}-\d{2}$/)
        } else {
          expect(h.events).toEqual([])
        }
      })
    })
  }

  it('refund(parte1 por líneas [A]) || voidLine(B): la parte reversed libera y amountPaid ≤ saldo real', async () => {
    await withOrm(async (h) => {
      const o = await seedOrder(h, [[60, 0, 'A'], [40, 0, 'B']])
      const a = await lineNamed(h, o.id, 'A'); const b = await lineNamed(h, o.id, 'B')
      const p1 = await addOrderPayment(h.deps, o.id, { method: 'cash', lineIds: [a.id] }, user)
      const rs = await Promise.allSettled([
        refundOrderPayment(h.deps, o.id, p1.part.id, REASON, user),
        (async () => { await sleep(1); return voidLine(linesDeps(h), o.id, b.id, 'no', editor) })(),
      ])
      const f = (await h.orders.findById(o.id))!
      expect(rs.map(outcome).every((x) => x === 'ok' || /Conflict/.test(x)), rs.map(outcome).join(' | ')).toBe(true)
      expect(Number(f.amountPaid)).toBeLessThanOrEqual(Number(f.subtotal) + Number(f.tax) + 0.01)
      expect(Number(f.amountReserved)).toBe(0)
    })
  })

  it('el puerto de refund FALLA: la parte vuelve a completed y el saldo vuelve de la reserva a cobrado (y cierra si con eso llega al saldo)', async () => {
    await withOrm(async (h) => {
      const o = await seedOrder(h, [[100, 0]])
      const p1 = await addOrderPayment(h.deps, o.id, { method: 'cash', amount: 60 }, user)
      let calls = 0
      h.deps.ports.refundPayment = async () => { calls++; await sleep(5); throw new Error('Stripe caído') }
      const rs = await Promise.allSettled([
        refundOrderPayment(h.deps, o.id, p1.part.id, REASON, user),
        (async () => { await sleep(1); return addOrderPayment(h.deps, o.id, { method: 'cash', amount: 40 }, user) })(),
      ])
      expect(outcome(rs[0])).toContain('Stripe caído')
      expect(calls).toBe(1)
      const f = (await h.orders.findById(o.id))!
      const p1Now = (await h.parts.findById(p1.part.id))!
      expect(p1Now.status).toBe('completed')
      expect(Number(f.amountReserved)).toBe(0)
      expect(Number(f.amountPaid)).toBe(100)
      expect(f.status).toBe('paid')
      expect(h.events).toEqual(['paid'])
    })
  })

  it('3 actores: refund(parte1) || payOrder entero || cancelOrder — la caja termina en 0 o en 100, nunca en el medio, y sin reserva colgada', async () => {
    for (const lat of [0, 5]) {
      await withOrm(async (h) => {
        const o = await seedOrder(h, [[100, 0]])
        const p1 = await addOrderPayment(h.deps, o.id, { method: 'cash', amount: 60 }, user)
        h.deps.ports.refundPayment = async ({ paymentId }) => { if (lat) await sleep(lat); h.money.refunds.push(paymentId) }
        const rs = await Promise.allSettled([
          refundOrderPayment(h.deps, o.id, p1.part.id, REASON, user),
          (async () => { await sleep(1); return payOrder(h.deps, o.id, { method: 'cash' }, user) })(),
          (async () => { await sleep(2); return cancelOrder(ordersDeps(h), o.id, 'se fue', user) })(),
        ])
        const f = (await h.orders.findById(o.id))!
        const net = sumAmounts(h.money.payments.filter((p) => !h.money.refunds.includes(p.id)))
        expect(rs.map(outcome).every((x) => x === 'ok' || /Conflict|Validation/.test(x)), rs.map(outcome).join(' | ')).toBe(true)
        if (f.status === 'cancelled') expect(net).toBe(0)
        if (f.status === 'paid') expect(net).toBe(100)
        expect(Number(f.amountReserved)).toBe(0)
      })
    }
  })
})
