// restaurant/tests/split-concurrency-3.test.ts — #214 COR-2 / COR-4 / sobrepago / NULL: partes entre sí.
//
// Reproducciones de la re-auditoría (rep.test.ts R3–R7) + el HIGH del CAS con `amountPaid`/`amountReserved`
// en NULL (filas anteriores a la columna: `freshForCas` las inicializaba con un update INCONDICIONAL y
// pisaba la reserva de la otra parte).
//   - COR-2: `seq` monótono — una parte cuyo puerto falló queda `failed` y NO libera su n: charge-card.ts
//     reclama `pos:<orderId>:<n>` en payments ANTES de Stripe, y la siguiente parte cash con el mismo n
//     heredaba ese payment `pending` de tarjeta (comanda `paid` sin efectivo real).
//   - COR-4: refund de la misma parte dos veces a la vez → UN solo reembolso (CAS completed → refunding).
//   - settle y expire del mismo Checkout a la vez → uno gana (CAS pending → …).
import { describe, it, expect } from 'bun:test'
import { ConflictError } from 'arckode-framework'
import { addOrderPayment, settleOrderPayment, expireOrderPayment, refundOrderPayment } from '../usecases/split-payments'
import { removeLine, voidLine, addLine } from '../usecases/order-lines'
import { payOrder } from '../usecases/settlement'
import type { CurrentUser } from '../types'
import { withOrm, seedOrder, nullifyAmounts, linesDeps, user, sys, card, outcome, sumAmounts, sleep, type Harness } from './split-concurrency-harness'
const REASON = { reason: 'cobrado por error' }

describe('#214 — sobrepago concurrente entre partes', () => {
  it('2×100 cash sobre 100: entra una, la otra 400, un solo payment, un solo onOrderPaid', async () => {
    await withOrm(async (h) => {
      const o = await seedOrder(h, [[100, 0]])
      const rs = await Promise.allSettled([addOrderPayment(h.deps, o.id, { method: 'cash', amount: 100 }, user), addOrderPayment(h.deps, o.id, { method: 'cash', amount: 100 }, user)])
      expect(rs.map(outcome).filter((x) => x === 'ok')).toHaveLength(1)
      expect(rs.map(outcome).some((x) => x.includes('supera el saldo'))).toBe(true)
      expect(h.money.payments).toHaveLength(1)
      const f = await h.orders.findById(o.id)
      expect(Number(f?.amountPaid)).toBe(100); expect(Number(f?.amountReserved)).toBe(0); expect(h.events).toEqual(['paid'])
    })
  })
  it('2×100 card sobre 100: una sola sesión de Checkout', async () => {
    await withOrm(async (h) => {
      const o = await seedOrder(h, [[100, 0]])
      await Promise.allSettled([addOrderPayment(h.deps, o.id, card(100), user), addOrderPayment(h.deps, o.id, card(100), user)])
      expect(h.money.cards).toHaveLength(1)
    })
  })
  it('3×50 (cash, transfer, card) sobre 100: entran dos, lo cobrado suma 100 exacto', async () => {
    await withOrm(async (h) => {
      const o = await seedOrder(h, [[100, 0]])
      const rs = await Promise.allSettled([addOrderPayment(h.deps, o.id, { method: 'cash', amount: 50 }, user), addOrderPayment(h.deps, o.id, { method: 'transfer', amount: 50 }, user), addOrderPayment(h.deps, o.id, card(50), user)])
      expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(2)
      expect(sumAmounts(h.money.payments)).toBe(100)
      const f = await h.orders.findById(o.id)
      expect(Number(f?.amountPaid) + Number(f?.amountReserved)).toBe(100)
    })
  })
  it('centavos: 33.33 / 33.33 / 33.34 concurrentes sobre 100 → paid, reserva 0', async () => {
    await withOrm(async (h) => {
      const o = await seedOrder(h, [[100, 0]])
      const rs = await Promise.allSettled([33.33, 33.33, 33.34].map((a) => addOrderPayment(h.deps, o.id, { method: 'cash', amount: a }, user)))
      expect(rs.every((r) => r.status === 'fulfilled')).toBe(true)
      const f = await h.orders.findById(o.id)
      expect(f?.status).toBe('paid'); expect(Number(f?.amountReserved)).toBe(0); expect(Number(f?.amountPaid)).toBe(100)
      expect(h.events).toEqual(['paid'])
    })
  })
})

describe('#214 — HIGH: comanda con amountPaid/amountReserved en NULL (pre-backfill)', () => {
  it('dos primeras partes concurrentes de 100 sobre 100 con NULL: entra UNA (la inicialización no pisa la reserva ajena)', async () => {
    await withOrm(async (h) => {
      const o = await seedOrder(h, [[100, 0]])
      await nullifyAmounts(h, o.id)
      const rs = await Promise.allSettled([addOrderPayment(h.deps, o.id, { method: 'cash', amount: 100 }, user), addOrderPayment(h.deps, o.id, { method: 'cash', amount: 100 }, user)])
      expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect(h.money.payments).toHaveLength(1)
      const f = await h.orders.findById(o.id)
      expect(Number(f?.amountPaid)).toBe(100); expect(Number(f?.amountReserved)).toBe(0); expect(f?.status).toBe('paid')
      expect(h.events).toEqual(['paid'])
    })
  })
  it('con NULL: 60 + 40 concurrentes caben las dos; 3×50 entran dos y suman 100', async () => {
    await withOrm(async (h) => {
      const o = await seedOrder(h, [[100, 0]])
      await nullifyAmounts(h, o.id)
      const rs = await Promise.allSettled([addOrderPayment(h.deps, o.id, { method: 'cash', amount: 60 }, user), addOrderPayment(h.deps, o.id, { method: 'transfer', amount: 40 }, user)])
      expect(rs.every((r) => r.status === 'fulfilled')).toBe(true)
      expect((await h.orders.findById(o.id))?.status).toBe('paid')
      expect(h.events).toEqual(['paid'])
    })
    await withOrm(async (h) => {
      const o = await seedOrder(h, [[100, 0]])
      await nullifyAmounts(h, o.id)
      const rs = await Promise.allSettled([50, 50, 50].map((a) => addOrderPayment(h.deps, o.id, { method: 'cash', amount: a }, user)))
      expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(2)
      expect(sumAmounts(h.money.payments)).toBe(100)
    })
  })
})

describe('#214 COR-2 — el `seq` de una parte fallida no se reutiliza', () => {
  it('Stripe no configurado (el payment `pending` ya quedó reclamado con pos:<id>:1): la parte queda failed y el cash siguiente usa pos:<id>:2', async () => {
    await withOrm(async (h) => {
      const o = await seedOrder(h, [[100, 0]])
      await expect(addOrderPayment(h.deps, o.id, card(100), user)).rejects.toThrow('pasarela')
      const after = await h.parts.findMany({ orderId: o.id } as any)
      expect(after).toHaveLength(1)
      expect(after[0].status).toBe('failed')
      expect(after[0].failReason).toContain('pasarela')
      expect(Number((await h.orders.findById(o.id))?.amountReserved)).toBe(0)
      const r = await addOrderPayment(h.deps, o.id, { method: 'cash', amount: 100 }, user)
      expect(r.part.seq).toBe(2)
      expect(r.part.paymentId).toBe('pay-2')
      const cashRow = h.money.payments.find((p) => p.method === 'cash' && p.status === 'completed')
      expect(cashRow?.reference).toBe(`pos:${o.id}:2`)
      expect(r.order.status).toBe('paid')
      // El payment de tarjeta huérfano sigue `pending` en payments con su referencia: no se lo apropió nadie.
      expect(h.money.payments.find((p) => p.reference === `pos:${o.id}:1`)?.method).toBe('card')
    }, { stripeFails: true })
  })

  it('el puerto cash falla DESPUÉS de cobrar (payments ya tiene la referencia): se concilia con ese payment, sin segundo cobro', async () => {
    await withOrm(async (h) => {
      const o = await seedOrder(h, [[100, 0]])
      const real = h.deps.ports.recordPayment!
      h.deps.ports.recordPayment = async (input, u) => { await real(input, u); throw new Error('socket de caja explotó') }
      const r = await addOrderPayment(h.deps, o.id, { method: 'cash', amount: 100 }, user)
      expect(r.part.status).toBe('completed')
      expect(r.part.paymentId).toBe('pay-1')
      expect(h.money.payments).toHaveLength(1)
      expect(r.order.status).toBe('paid')
    }, { withLookup: true })
  })

  it('el puerto cash falla SIN cobrar y payments lo confirma (no existe la referencia): la parte queda failed y el saldo vuelve', async () => {
    await withOrm(async (h) => {
      const o = await seedOrder(h, [[100, 0]])
      await expect(addOrderPayment(h.deps, o.id, { method: 'cash', amount: 100 }, user)).rejects.toThrow('payments caído')
      const parts = await h.parts.findMany({ orderId: o.id } as any)
      expect(parts.map((p) => p.status)).toEqual(['failed'])
      expect(Number((await h.orders.findById(o.id))?.amountReserved)).toBe(0)
      h.deps.ports.recordPayment = async (input) => { const row = { id: 'pay-ok', method: input.method, status: 'completed', reference: input.reference, amount: input.amount }; h.money.payments.push(row); return { paymentId: row.id } }
      const r = await addOrderPayment(h.deps, o.id, { method: 'cash', amount: 100 }, user)
      expect(r.part.seq).toBe(2)
      expect(r.order.status).toBe('paid')
    }, { withLookup: true, ports: { recordPayment: async () => { throw new Error('payments caído') } } })
  })

  it('sin `findPaymentByReference` cableado, un fallo del puerto cash deja la parte pending (retomable con el mismo pedido), nunca borrada', async () => {
    await withOrm(async (h) => {
      const o = await seedOrder(h, [[100, 0]])
      let boom = true
      const real = h.deps.ports.recordPayment!
      h.deps.ports.recordPayment = async (input, u) => { if (boom) throw new Error('payments caído'); return real(input, u) }
      await expect(addOrderPayment(h.deps, o.id, { method: 'cash', amount: 100 }, user)).rejects.toThrow('payments caído')
      expect((await h.parts.findMany({ orderId: o.id } as any)).map((p) => p.status)).toEqual(['pending'])
      // Otro pedido no entra: la parte a medias tiene el saldo reservado (400) y, si cupiera, se frena por la parte sin confirmar (409).
      await expect(addOrderPayment(h.deps, o.id, { method: 'cash', amount: 50 }, user)).rejects.toThrow(/supera el saldo|sin confirmar/)
      boom = false
      const r = await addOrderPayment(h.deps, o.id, { method: 'cash', amount: 100 }, user)
      expect(r.part.seq).toBe(1)
      expect(r.order.status).toBe('paid')
    })
  })
})

describe('#214 — settle y expire del mismo Checkout a la vez', () => {
  it('Promise.all(settle, expire): gana uno; la comanda queda paid (reserva 0) o sigue abierta con la parte expired (reserva 0)', async () => {
    await withOrm(async (h) => {
      const o = await seedOrder(h, [[100, 0]])
      const r = await addOrderPayment(h.deps, o.id, card(100), user)
      await Promise.allSettled([settleOrderPayment(h.deps, r.part.id, 'pay-1', sys), expireOrderPayment(h.deps, r.part.id, sys)])
      const f = await h.orders.findById(o.id)
      const p = await h.parts.findById(r.part.id)
      expect(Number(f?.amountReserved)).toBe(0)
      if (p?.status === 'completed') { expect(f?.status).toBe('paid'); expect(Number(f?.amountPaid)).toBe(100); expect(h.events).toEqual(['paid']) }
      else { expect(p?.status).toBe('expired'); expect(f?.status).not.toBe('paid'); expect(Number(f?.amountPaid)).toBe(0); expect(h.events).toEqual([]) }
    })
  })
})

describe('#214 COR-4 — refund de la misma parte dos veces a la vez', () => {
  it('Promise.all(refund, refund): UN solo reembolso al puerto, un solo onOrderRefunded, la otra 409', async () => {
    await withOrm(async (h) => {
      const o = await seedOrder(h, [[100, 0]])
      const r = await addOrderPayment(h.deps, o.id, { method: 'cash', amount: 100 }, user)
      const rs = await Promise.allSettled([refundOrderPayment(h.deps, o.id, r.part.id, REASON, user), refundOrderPayment(h.deps, o.id, r.part.id, REASON, user)])
      expect(rs.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
      expect(rs.map(outcome).some((x) => x.includes('ConflictError'))).toBe(true)
      expect(h.money.refunds).toEqual(['pay-1'])
      expect(h.events).toEqual(['paid', 'refunded'])
      expect((await h.parts.findById(r.part.id))?.status).toBe('refunded')
    })
  })
  it('si el puerto de refund falla, la parte vuelve a `completed` (no queda `refunding` colgada) y se puede reintentar', async () => {
    await withOrm(async (h) => {
      const o = await seedOrder(h, [[100, 0]])
      const r = await addOrderPayment(h.deps, o.id, { method: 'transfer', amount: 100 }, user)
      let boom = true
      h.deps.ports.refundPayment = async ({ paymentId }) => { if (boom) throw new Error('stripe caído'); h.money.refunds.push(paymentId) }
      await expect(refundOrderPayment(h.deps, o.id, r.part.id, REASON, user)).rejects.toThrow('stripe caído')
      expect((await h.parts.findById(r.part.id))?.status).toBe('completed')
      boom = false
      expect((await refundOrderPayment(h.deps, o.id, r.part.id, REASON, user)).status).toBe('refunded')
      expect(h.money.refunds).toEqual(['pay-1'])
    })
  })
})

// COR-A: el guard `hasPartialPayments` de las líneas era read-check-write y NO estaba en el CAS: anular
// una línea y cobrar una parte por ESA línea a la vez entraban las dos → comanda `sent` con due 40 y
// amountPaid 60 (plata cobrada por un plato anulado, sin salida por API). Ahora toda mutación de líneas
// toma el lock de líneas (`linesLockedUntil`, UPDATE condicional) y una parte verifica sus líneas DENTRO
// del hold. El actor tiene `restaurant:delete` (quitar/anular): sin permiso `removeLine` rebotaba antes de
// tocar nada y el test anterior no ejercitaba la carrera.
describe('#214 COR-A — anular/quitar una línea vs parte por esa línea, a la vez', () => {
  const editor: CurrentUser = { ...user, permissions: ['restaurant:delete'] }
  const lineNamed = async (h: Harness, orderId: string, name: string) => (await h.lines.findMany({ orderId } as any)).find((l) => l.name === name)!
  const oneWins = async (h: Harness, orderId: string, lineId: string, rs: PromiseSettledResult<unknown>[], due: { before: number; afterVoid: number }, partAmount: number) => {
    const out = rs.map(outcome)
    const f = (await h.orders.findById(orderId))!
    const line = (await h.lines.findById(lineId))!
    expect(out.filter((x) => x === 'ok')).toHaveLength(1)
    if (out[0] === 'ok') {
      // Ganó la línea: no entró plata, la parte rebotó con 409.
      expect(line.status).toBe('voided')
      expect(h.money.payments).toHaveLength(0)
      expect(Number(f.amountPaid)).toBe(0)
      expect(Number(f.subtotal) + Number(f.tax)).toBe(due.afterVoid)
      expect(out[1]).toContain('ConflictError')
    } else {
      // Ganó la parte: la línea sigue viva y cobrada; la anulación rebotó con 409 (pagos parciales).
      expect(line.status).not.toBe('voided')
      expect(sumAmounts(h.money.payments)).toBe(partAmount)
      expect(Number(f.amountPaid)).toBe(partAmount)
      expect(Number(f.subtotal) + Number(f.tax)).toBe(due.before)
      expect(out[0]).toContain('ConflictError')
    }
    expect(Number(f.amountReserved)).toBe(0)
    expect(f.linesLockedUntil ?? '').toBe('')   // el lock nunca queda tomado
  }

  for (const lat of [0, 5, 30]) {
    it(`voidLine(A=60) || parte cash por [A] (parte con ${lat} ms de retraso): entra UNA, nunca se cobra un plato anulado`, async () => {
      await withOrm(async (h) => {
        const o = await seedOrder(h, [[60, 0, 'A'], [40, 0, 'B']])
        const a = await lineNamed(h, o.id, 'A')
        const rs = await Promise.allSettled([
          voidLine(linesDeps(h), o.id, a.id, 'se cayó el plato', editor),
          (async () => { if (lat) await sleep(lat); return addOrderPayment(h.deps, o.id, { method: 'cash', lineIds: [a.id] }, user) })(),
        ])
        await oneWins(h, o.id, a.id, rs, { before: 100, afterVoid: 40 }, 60)
      })
    })
  }

  it('removeLine(A) || parte por [A]: lo mismo con quitar (la comanda `sent` con la línea sin enviar)', async () => {
    await withOrm(async (h) => {
      const o = await seedOrder(h, [[60, 0, 'A'], [40, 0, 'B']])
      const a = await lineNamed(h, o.id, 'A')
      const rs = await Promise.allSettled([removeLine(linesDeps(h), o.id, a.id, editor), addOrderPayment(h.deps, o.id, { method: 'cash', lineIds: [a.id] }, user)])
      const out = rs.map(outcome)
      const f = (await h.orders.findById(o.id))!
      expect(out.filter((x) => x === 'ok')).toHaveLength(1)
      if (out[0] === 'ok') { expect(await h.lines.findById(a.id)).toBeNull(); expect(h.money.payments).toHaveLength(0); expect(Number(f.amountPaid)).toBe(0) }
      else { expect(await h.lines.findById(a.id)).not.toBeNull(); expect(Number(f.amountPaid)).toBe(60); expect(out[0]).toContain('ConflictError') }
      expect(Number(f.amountReserved)).toBe(0)
      expect(sumAmounts(h.money.payments)).toBeLessThanOrEqual(Number(f.subtotal) + Number(f.tax))
    })
  })

  // Una anulación que NO mueve el total (línea de $0) no cambia subtotal/tax: la única barrera es la
  // verificación de las líneas dentro del hold.
  it('voidLine(línea de $0) || parte por líneas que la incluye: nunca queda una parte con una línea anulada', async () => {
    await withOrm(async (h) => {
      const o = await seedOrder(h, [[0, 0, 'Z'], [40, 0, 'B']])
      const z = await lineNamed(h, o.id, 'Z'); const b = await lineNamed(h, o.id, 'B')
      const rs = await Promise.allSettled([voidLine(linesDeps(h), o.id, z.id, 'no va', editor), addOrderPayment(h.deps, o.id, { method: 'cash', lineIds: [z.id, b.id] }, user)])
      await oneWins(h, o.id, z.id, rs, { before: 40, afterVoid: 40 }, 40)
      const parts = (await h.parts.findMany({ orderId: o.id } as any)).filter((p) => p.status === 'completed')
      const zStatus = (await h.lines.findById(z.id))!.status
      if (parts.length) expect(zStatus).not.toBe('voided')
    })
  })

  it('una parte por una línea ya anulada rebota con 409 (no 400) antes de mover plata', async () => {
    await withOrm(async (h) => {
      const o = await seedOrder(h, [[60, 0, 'A'], [40, 0, 'B']])
      const a = await lineNamed(h, o.id, 'A')
      await voidLine(linesDeps(h), o.id, a.id, 'se cayó', editor)
      await expect(addOrderPayment(h.deps, o.id, { method: 'cash', lineIds: [a.id] }, user)).rejects.toBeInstanceOf(ConflictError)
      expect(h.money.payments).toHaveLength(0)
      expect(Number((await h.orders.findById(o.id))!.amountReserved)).toBe(0)
    })
  })

  it('dos mozos agregan líneas a la vez: entran las dos (el lock de líneas espera, no rebota entre líneas)', async () => {
    await withOrm(async (h) => {
      const o = await seedOrder(h, [[60, 0, 'A']])
      const rs = await Promise.allSettled([addLine(linesDeps(h), o.id, { menuItemId: 'i1' }, user), addLine(linesDeps(h), o.id, { menuItemId: 'i1' }, user)])
      expect(rs.map(outcome)).toEqual(['ok', 'ok'])
      const f = (await h.orders.findById(o.id))!
      expect(Number(f.subtotal)).toBe(62)
      expect(f.linesLockedUntil ?? '').toBe('')
    })
  })

  it('el lock se suelta aunque la edición falle; un lock vencido (proceso caído) no bloquea; uno vivo da 409 a la parte y al cobro entero', async () => {
    await withOrm(async (h) => {
      const o = await seedOrder(h, [[100, 0, 'A']])
      await expect(addLine(linesDeps(h), o.id, { menuItemId: 'i1', quantity: 0 }, user)).rejects.toThrow('cantidad')
      expect((await h.orders.findById(o.id))!.linesLockedUntil ?? '').toBe('')
      await h.db.run('UPDATE restaurant_orders SET linesLockedUntil = ? WHERE id = ?', [new Date(Date.now() - 1).toISOString(), o.id])
      await expect(addOrderPayment(h.deps, o.id, { method: 'cash', amount: 30 }, user)).resolves.toMatchObject({ part: { status: 'completed' } })
      const o2 = await seedOrder(h, [[100, 0, 'A']])
      await h.db.run('UPDATE restaurant_orders SET linesLockedUntil = ? WHERE id = ?', [new Date(Date.now() + 60_000).toISOString(), o2.id])
      await expect(addOrderPayment(h.deps, o2.id, { method: 'cash', amount: 30 }, user)).rejects.toThrow(/editando/)
      await expect(payOrder(h.deps, o2.id, { method: 'cash' }, user)).rejects.toThrow(/editando/)
      expect(h.money.payments).toHaveLength(1)
    })
  })
})

// COR-E: `allBack` se calculaba de un partsOf no atómico y el update de estado era incondicional: devolver
// dos partes distintas a la vez emitía `onOrderRefunded` DOS veces (y el orden inverso dejaba
// `partially_refunded` con todas las partes devueltas).
describe('#214 COR-E — devolver dos partes distintas a la vez', () => {
  it('Promise.all(refund 60, refund 40): dos reembolsos al puerto, UN solo onOrderRefunded, comanda `refunded`', async () => {
    await withOrm(async (h) => {
      const o = await seedOrder(h, [[100, 0]])
      const p1 = await addOrderPayment(h.deps, o.id, { method: 'cash', amount: 60 }, user)
      const p2 = await addOrderPayment(h.deps, o.id, { method: 'transfer', amount: 40 }, user)
      expect(p2.order.status).toBe('paid')
      const rs = await Promise.allSettled([refundOrderPayment(h.deps, o.id, p1.part.id, REASON, user), refundOrderPayment(h.deps, o.id, p2.part.id, REASON, user)])
      expect(rs.map(outcome)).toEqual(['ok', 'ok'])
      expect(h.money.refunds.sort()).toEqual(['pay-1', 'pay-2'])
      expect(h.events).toEqual(['paid', 'refunded'])
      expect((await h.orders.findById(o.id))?.status).toBe('refunded')
    })
  })
  it('con retraso en el puerto de una de las dos: el resultado es el mismo', async () => {
    await withOrm(async (h) => {
      const o = await seedOrder(h, [[100, 0]])
      const p1 = await addOrderPayment(h.deps, o.id, { method: 'cash', amount: 60 }, user)
      const p2 = await addOrderPayment(h.deps, o.id, { method: 'transfer', amount: 40 }, user)
      h.deps.ports.refundPayment = async ({ paymentId }) => { if (paymentId === 'pay-1') await sleep(15); h.money.refunds.push(paymentId) }
      await Promise.all([refundOrderPayment(h.deps, o.id, p1.part.id, REASON, user), refundOrderPayment(h.deps, o.id, p2.part.id, REASON, user)])
      expect(h.events).toEqual(['paid', 'refunded'])
      expect((await h.orders.findById(o.id))?.status).toBe('refunded')
    })
  })
})
