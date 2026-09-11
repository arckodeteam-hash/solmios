// restaurant/tests/split-concurrency-1.test.ts — #214 COR-1: cobro ENTERO vs una PARTE, a la vez.
//
// Reproducciones de la re-auditoría (rep.test.ts R1 + rep2.test.ts R1b). `payOrder`/`chargeToRoom` eran
// read-check-write y competían con `addOrderPayment`: efectivo entero + Checkout de una parte entraban
// los dos; efectivo entero + parte de 40 → 140 cobrados sobre 100. Ahora el cobro entero reserva el
// saldo completo con el MISMO UPDATE condicional (`amountReserved`) que usa una parte: gana uno solo,
// cualquiera sea el orden y aunque payments tarde más para uno que para el otro.
import { describe, it, expect } from 'bun:test'
import { ConflictError } from 'arckode-framework'
import { addOrderPayment, settleOrderPayment } from '../usecases/split-payments'
import { payOrder, chargeToRoom } from '../usecases/settlement'
import { withOrm, seedOrder, nullifyAmounts, user, sys, card, outcome, sumAmounts } from './split-concurrency-harness'

describe('#214 COR-1 — parte card pending vs cobro entero (secuencial)', () => {
  it('con una parte pending: payOrder/chargeToRoom → 409; el webhook confirma UNA vez, un solo payment', async () => {
    await withOrm(async (h) => {
      const o = await seedOrder(h, [[100, 0]], { reservationId: 'r1' })
      const r = await addOrderPayment(h.deps, o.id, card(100), user)
      await expect(payOrder(h.deps, o.id, { method: 'cash' }, user)).rejects.toThrow(ConflictError)
      await expect(chargeToRoom(h.deps, o.id, {}, user)).rejects.toThrow(ConflictError)
      await settleOrderPayment(h.deps, r.part.id, 'pay-1', sys)
      await settleOrderPayment(h.deps, r.part.id, 'pay-1', sys)
      expect(h.events).toEqual(['paid'])
      expect(h.money.payments).toHaveLength(1)
      expect(h.money.charges).toHaveLength(0)
    })
  })
})

describe('#214 COR-1 — Promise.all(cobro entero, parte): entra UNO', () => {
  it('payOrder(cash) + addOrderPayment(card): un solo payment; si ganó la parte, el webhook la cierra', async () => {
    await withOrm(async (h) => {
      const o = await seedOrder(h, [[100, 0]])
      const rs = await Promise.allSettled([payOrder(h.deps, o.id, { method: 'cash' }, user), addOrderPayment(h.deps, o.id, card(100), user)])
      expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect(h.money.payments).toHaveLength(1)
      const pending = (await h.parts.findMany({ orderId: o.id } as any)).filter((p) => p.status === 'pending')
      for (const p of pending) await settleOrderPayment(h.deps, p.id, p.paymentId ?? 'pay-1', sys)
      const final = await h.orders.findById(o.id)
      expect(final?.status).toBe('paid')
      expect(Number(final?.amountReserved)).toBe(0)
      expect(h.events).toEqual(['paid'])
    })
  })

  it('chargeToRoom + addOrderPayment(card): un solo cargo/sesión', async () => {
    await withOrm(async (h) => {
      const o = await seedOrder(h, [[100, 0]], { reservationId: 'r1' })
      const rs = await Promise.allSettled([chargeToRoom(h.deps, o.id, {}, user), addOrderPayment(h.deps, o.id, card(100), user)])
      expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect(h.money.charges.length + h.money.cards.length).toBe(1)
    })
  })

  it('payOrder(cash) LENTO en payments + parte card: un solo cobro (la parte ve saldo 0 o el entero ve la parte)', async () => {
    await withOrm(async (h) => {
      const o = await seedOrder(h, [[100, 0]])
      const rs = await Promise.allSettled([payOrder(h.deps, o.id, { method: 'cash' }, user), addOrderPayment(h.deps, o.id, card(100), user)])
      expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect(h.money.payments).toHaveLength(1)
      const mid = await h.orders.findById(o.id)
      expect(Number(mid?.amountReserved)).toBe(mid?.status === 'paid' ? 0 : 100)
      for (const p of (await h.parts.findMany({ orderId: o.id } as any)).filter((x) => x.status === 'pending')) await settleOrderPayment(h.deps, p.id, p.paymentId ?? 'pay-1', sys)
      expect((await h.orders.findById(o.id))?.status).toBe('paid')
      expect(h.events).toEqual(['paid'])
    }, { wholeLatencyMs: 30 })
  })

  it('chargeToRoom LENTO en folios + parte card: un solo cargo/sesión', async () => {
    await withOrm(async (h) => {
      const o = await seedOrder(h, [[100, 0]], { reservationId: 'r1' })
      const rs = await Promise.allSettled([chargeToRoom(h.deps, o.id, {}, user), addOrderPayment(h.deps, o.id, card(100), user)])
      expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect(h.money.charges.length + h.money.cards.length).toBe(1)
    }, { wholeLatencyMs: 30 })
  })

  it('payOrder(cash) LENTO + parte cash 40: la suma de lo cobrado es EXACTAMENTE 100 (no 140)', async () => {
    await withOrm(async (h) => {
      const o = await seedOrder(h, [[100, 0]])
      const rs = await Promise.allSettled([payOrder(h.deps, o.id, { method: 'cash' }, user), addOrderPayment(h.deps, o.id, { method: 'cash', amount: 40 }, user)])
      const ok = rs.filter((r) => r.status === 'fulfilled')
      // Entra el entero (100) o entra la parte (40, y la comanda sigue abierta con saldo 60): nunca los dos.
      expect(ok).toHaveLength(1)
      const total = sumAmounts(h.money.payments)
      expect([40, 100]).toContain(total)
      const final = await h.orders.findById(o.id)
      if (total === 100) { expect(final?.status).toBe('paid'); expect(h.events).toEqual(['paid']) }
      else { expect(final?.status).not.toBe('paid'); expect(Number(final?.amountPaid)).toBe(40); expect(h.events).toEqual([]) }
      expect(Number(final?.amountReserved)).toBe(0)
      expect(rs.map(outcome).some((x) => x.includes('supera el saldo') || x.includes('ConflictError'))).toBe(true)
    }, { wholeLatencyMs: 30 })
  })

  it('el puerto del cobro entero FALLA: la reserva se suelta y una parte vuelve a poder entrar', async () => {
    let h!: Parameters<Parameters<typeof withOrm>[0]>[0]
    await withOrm(async (hh) => {
      h = hh
      const o = await seedOrder(h, [[100, 0]])
      await expect(payOrder(h.deps, o.id, { method: 'cash' }, user)).rejects.toThrow('payments caído')
      expect(Number((await h.orders.findById(o.id))?.amountReserved)).toBe(0)
      const r = await addOrderPayment(h.deps, o.id, { method: 'transfer', amount: 100 }, user)
      expect(r.order.status).toBe('paid')
    }, { ports: { recordPayment: async (input) => {
      if (!input.reference) throw new Error('payments caído')   // solo el cobro ENTERO (sin referencia por parte) falla
      const row = { id: 'pay-part', method: input.method, status: 'completed', reference: input.reference, amount: input.amount }
      h.money.payments.push(row)
      return { paymentId: row.id }
    } } })
  })

  it('comanda con amountPaid/amountReserved en NULL (pre-backfill): payOrder + parte concurrentes → entra UNO', async () => {
    await withOrm(async (h) => {
      const o = await seedOrder(h, [[100, 0]])
      await nullifyAmounts(h, o.id)
      const rs = await Promise.allSettled([payOrder(h.deps, o.id, { method: 'cash' }, user), addOrderPayment(h.deps, o.id, { method: 'cash', amount: 40 }, user)])
      expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect([40, 100]).toContain(sumAmounts(h.money.payments))
      expect(Number((await h.orders.findById(o.id))?.amountReserved)).toBe(0)
    }, { wholeLatencyMs: 10 })
  })
})
