// restaurant/tests/split-concurrency-2.test.ts — #214 COR-3: cancelar vs una PARTE, a la vez.
//
// Reproducciones de la re-auditoría (rep.test.ts R2 + rep3.test.ts R2b). `cancelOrder` era
// read-check-write: una parte en efectivo concurrente dejaba la comanda `cancelled` con `amountPaid=100`,
// el payment hecho y sin devolución. Ahora cancelar es una transición condicional (status → cancelled
// SOLO con amountPaid=0 y amountReserved=0, mismo UPDATE que reserva una parte): gana uno solo. Y si
// igual entra dinero sobre una cancelada (fila tocada a mano, reintento de una parte a medias), se
// devuelve solo — efectivo/transferencia incluidos, no solo tarjeta.
import { describe, it, expect } from 'bun:test'
import { ConflictError } from 'arckode-framework'
import { addOrderPayment, settleOrderPayment } from '../usecases/split-payments'
import { cancelOrder } from '../usecases/orders'
import { withOrm, seedOrder, nullifyAmounts, ordersDeps, user, sys, card, outcome } from './split-concurrency-harness'

describe('#214 COR-3 — cancelar con una parte pending (secuencial)', () => {
  it('cancelar → 409; si la comanda igual quedó cancelada y el webhook confirma, la parte se devuelve', async () => {
    await withOrm(async (h) => {
      const o = await seedOrder(h, [[100, 0]])
      const r = await addOrderPayment(h.deps, o.id, card(100), user)
      await expect(cancelOrder(ordersDeps(h), o.id, 'x', user)).rejects.toThrow(ConflictError)
      await h.orders.update(o.id, { status: 'cancelled' } as any)
      const p = await settleOrderPayment(h.deps, r.part.id, 'pay-1', sys)
      expect(p.status).toBe('refunded')
      expect(h.money.refunds).toEqual(['pay-1'])
      expect(h.events).toEqual([])
    })
  })
})

describe('#214 COR-3 — Promise.all(cancelOrder, parte): entra UNO', () => {
  it('cancelar + parte card: o queda cancelada sin partes, o queda la parte y cancelar da 409', async () => {
    await withOrm(async (h) => {
      const o = await seedOrder(h, [[100, 0]])
      const rs = await Promise.allSettled([cancelOrder(ordersDeps(h), o.id, 'x', user), addOrderPayment(h.deps, o.id, card(100), user)])
      expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      const mid = await h.orders.findById(o.id)
      const parts = await h.parts.findMany({ orderId: o.id } as any)
      if (mid?.status === 'cancelled') {
        expect(parts.filter((p) => p.status === 'pending')).toHaveLength(0)
        expect(rs[1].status).toBe('rejected')
      } else {
        expect(parts.filter((p) => p.status === 'pending')).toHaveLength(1)
        expect(outcome(rs[0])).toContain('ConflictError')
        const done = await settleOrderPayment(h.deps, parts[0].id, 'pay-1', sys)
        expect(done.status).toBe('completed')
        expect((await h.orders.findById(o.id))?.status).toBe('paid')
        expect(h.events).toEqual(['paid'])
      }
      expect(h.money.refunds).toEqual([])
    })
  })

  it('cancelar (líneas lentas) + parte cash 100: NUNCA queda cancelled con amountPaid=100', async () => {
    await withOrm(async (h) => {
      const o = await seedOrder(h, [[100, 0]])
      const rs = await Promise.allSettled([cancelOrder(ordersDeps(h, 30), o.id, 'se fue', user), addOrderPayment(h.deps, o.id, { method: 'cash', amount: 100 }, user)])
      expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      const f = await h.orders.findById(o.id)
      if (f?.status === 'cancelled') {
        expect(Number(f.amountPaid)).toBe(0)
        expect(h.money.payments).toHaveLength(0)
        expect(outcome(rs[1])).toContain('cancelada')
        expect(h.audits).toContain('restaurant.order.cancelled')
      } else {
        expect(f?.status).toBe('paid')
        expect(Number(f?.amountPaid)).toBe(100)
        expect(outcome(rs[0])).toContain('ConflictError')
        expect(h.events).toEqual(['paid'])
      }
    })
  })

  it('comanda con amountPaid/amountReserved en NULL (pre-backfill): cancelar + parte cash → entra UNO', async () => {
    await withOrm(async (h) => {
      const o = await seedOrder(h, [[100, 0]])
      await nullifyAmounts(h, o.id)
      const rs = await Promise.allSettled([cancelOrder(ordersDeps(h, 10), o.id, 'se fue', user), addOrderPayment(h.deps, o.id, { method: 'cash', amount: 100 }, user)])
      expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      const f = await h.orders.findById(o.id)
      expect(f?.status === 'cancelled' ? h.money.payments.length : Number(f?.amountPaid)).toBe(f?.status === 'cancelled' ? 0 : 100)
    })
  })
})

describe('#214 COR-3 — dinero que igual entra sobre una cancelada se devuelve, sea el método que sea', () => {
  it('parte cash a medias (payment hecho, fila sin marcar) + comanda cancelada a mano: el reintento la devuelve (refund del payment cash)', async () => {
    await withOrm(async (h) => {
      const o = await seedOrder(h, [[100, 0]])
      const original = h.parts.update.bind(h.parts)
      let boom = true
      h.parts.update = (async (id: string, d: any) => { if (boom && d.status === 'completed') throw new Error('db down'); return original(id, d) }) as any
      await expect(addOrderPayment(h.deps, o.id, { method: 'cash', amount: 100 }, user)).rejects.toThrow('db down')
      boom = false
      expect(h.money.payments).toHaveLength(1)
      // La comanda queda cancelada por fuera de los guards (dato viejo / a mano) con la parte `pending`.
      await h.orders.update(o.id, { status: 'cancelled' } as any)
      const r = await addOrderPayment(h.deps, o.id, { method: 'cash', amount: 100 }, user)
      expect(r.part.status).toBe('refunded')
      expect(h.money.payments).toHaveLength(1)          // la misma referencia: no hubo segundo cobro
      expect(h.money.refunds).toEqual(['pay-1'])        // y se devolvió el efectivo
      expect(h.audits).toContain('restaurant.order.part_refunded_after_cancel')
      expect(h.events).toEqual([])
      expect((await h.orders.findById(o.id))?.status).toBe('cancelled')
      expect(Number((await h.orders.findById(o.id))?.amountReserved)).toBe(0)
    })
  })
})
