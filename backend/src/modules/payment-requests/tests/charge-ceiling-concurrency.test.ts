// payment-requests/tests/charge-ceiling-concurrency.test.ts — COR-3: el techo agregado no se puede
// burlar disparando dos altas a la vez.
//
// Antes: `assertChargeableAmount` leía `committedPending`, validaba, y recién después `service.ts`
// hacía el `create`, sin transacción ni constraint. Dos clicks concurrentes del botón "Requerir
// pago" leían el mismo `committedPending = 0` y dejaban DOS links de $300 vivos sobre un saldo de
// $300 — el mismo escenario que el comentario de SEC-2 dice haber cerrado.

import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, Auth } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { PaymentRequestsService } from '../service'
import { assertChargeableAmount, assertCeilingAfterCommit } from '../usecases/charge-ceiling'
import type { PaymentRequestDTO, CurrentUser } from '../types'

const log = silentLogger()
const currentUser: CurrentUser = { id: 'u1', hotelId: 'h1', role: 'hotel_admin' }
const permissiveAuth = { assertOwnership: () => {}, authenticate: (() => []) as any } as unknown as Auth

function makeRepo<T extends object>(ov: Partial<RepositoryAdapter<T>> = {}): RepositoryAdapter<T> {
  return {
    findMany: async () => [], findById: async () => null, findOne: async () => null,
    create: async (d: any) => ({ id: 'x1', ...d } as T),
    update: async (id: any, d: any) => ({ id, ...d } as T),
    delete: async () => true, count: async () => 0,
    paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0 }),
    ...ov,
  } as RepositoryAdapter<T>
}

/** Tabla `payment_requests` en memoria: `findMany` ve lo que ya se creó, como el WHERE real. */
function makeStore() {
  const rows: PaymentRequestDTO[] = []
  let seq = 0
  const repo = makeRepo<PaymentRequestDTO>({
    findMany: async (f: any) => rows.filter((r) => r.hotelId === f?.hotelId && r.reservationId === f?.reservationId) as any,
    findById: async (id: string) => rows.find((r) => r.id === id) ?? null,
    create: async (d: any) => {
      // Latencia real de la base: sin esto las dos altas se serializan solas por el microtask queue
      // y el test pasaría aun con el bug.
      await new Promise((r) => setTimeout(r, 5))
      const row = { id: `pr${++seq}`, ...d } as PaymentRequestDTO
      rows.push(row)
      return row
    },
    delete: async (id: string) => {
      const i = rows.findIndex((r) => r.id === id)
      if (i >= 0) rows.splice(i, 1)
      return i >= 0
    },
  })
  return { repo, rows }
}

function makeService(repo: RepositoryAdapter<PaymentRequestDTO>) {
  const s = new PaymentRequestsService(
    repo,
    // Reserva de 500 con 200 de anticipo → saldo cobrable 300.
    makeRepo<any>({ findById: async () => ({ id: 'r1', hotelId: 'h1', totalAmount: 500, deposit: 200, otherCharges: 0 }) }),
    makeRepo<any>(), makeRepo<any>(),
    makeRepo<any>({ findById: async () => ({ id: 'u1', hotelId: 'h1' }) }),
    log, permissiveAuth, makeRepo<any>(),
  )
  // STR-A: puerto de dinero del connector payment-requests-money (sin folios/facturas/pagos: paid=deposit).
  s.setMoneyDeps({ paidRepos: { folioRepo: makeRepo<any>(), invoiceRepo: makeRepo<any>(), paymentRepo: makeRepo<any>() }, settledNet: async () => 0 })
  return s
}

describe('techo agregado bajo concurrencia (COR-3)', () => {
  it('dos altas simultáneas por el saldo completo dejan UN solo link vivo', async () => {
    const { repo, rows } = makeStore()
    const s = makeService(repo)

    const results = await Promise.allSettled([
      s.create({ reservationId: 'r1', amount: 300 } as any, currentUser),
      s.create({ reservationId: 'r1', amount: 300 } as any, currentUser),
    ])

    const ok = results.filter((r) => r.status === 'fulfilled')
    expect(ok).toHaveLength(1)
    // Y la tabla queda con un único link: el segundo ni se creó, o se revirtió.
    expect(rows).toHaveLength(1)
    expect(rows[0].amount).toBe(300)
    // El rechazo explica el motivo, no revienta con un 500.
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(String(failed.reason?.message ?? failed.reason)).toMatch(/links de pago pendientes|supera el saldo cobrable|al mismo tiempo/)
  })

  it('dos altas que JUNTAS entran en el saldo pasan las dos', async () => {
    const { repo, rows } = makeStore()
    const s = makeService(repo)

    const results = await Promise.allSettled([
      s.create({ reservationId: 'r1', amount: 150 } as any, currentUser),
      s.create({ reservationId: 'r1', amount: 150 } as any, currentUser),
    ])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2)
    expect(rows).toHaveLength(2)
  })

  it('altas de reservas distintas no se estorban entre sí', async () => {
    const { repo, rows } = makeStore()
    const s = new PaymentRequestsService(
      repo,
      makeRepo<any>({ findById: async (id: string) => ({ id, hotelId: 'h1', totalAmount: 500, deposit: 200, otherCharges: 0 }) }),
      makeRepo<any>(), makeRepo<any>(),
      makeRepo<any>({ findById: async () => ({ id: 'u1', hotelId: 'h1' }) }),
      log, permissiveAuth, makeRepo<any>(),
    )
    // STR-A: idem makeService — puerto de dinero cableado.
    s.setMoneyDeps({ paidRepos: { folioRepo: makeRepo<any>(), invoiceRepo: makeRepo<any>(), paymentRepo: makeRepo<any>() }, settledNet: async () => 0 })

    const results = await Promise.allSettled([
      s.create({ reservationId: 'r1', amount: 300 } as any, currentUser),
      s.create({ reservationId: 'r2', amount: 300 } as any, currentUser),
    ])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2)
    expect(rows).toHaveLength(2)
  })
})

// ── STR-B: el lock in-process es un atajo; la GARANTÍA es la compensación post-commit ──────────
// El `Map` de módulo de `withLock` (shared/utils/async-lock) no sobrevive a un reinicio ni a un
// segundo proceso, así que el invariante no puede depender de él. Este bloque simula eso: dos
// altas que NO comparten lock (dos "procesos") sobre la misma reserva. Es la capa 2 documentada en
// el encabezado de `usecases/charge-ceiling.ts`, y hasta acá no tenía cobertura propia.
describe('techo agregado SIN lock compartido (dos procesos)', () => {
  it('la re-verificación post-commit revierte los links que sobran', async () => {
    const { repo, rows } = makeStore()
    // Barrera de 2: los dos "procesos" insertan ANTES de que cualquiera re-verifique. Es el peor
    // interleaving posible y el único que prueba de verdad la capa 2 — con la latencia suelta el
    // scheduler puede ordenarlos y uno pasa legítimamente.
    let llegaron = 0
    let abrir: () => void
    const barrera = new Promise<void>((r) => { abrir = r })
    const enBarrera = async () => { if (++llegaron === 2) abrir!(); await barrera }

    const deps = {
      reservationRepo: makeRepo<any>({ findById: async () => ({ id: 'r1', hotelId: 'h1', totalAmount: 500, deposit: 200, otherCharges: 0 }) }),
      addonRepo: makeRepo<any>(), requestRepo: repo,
      // STR-A: mismo puerto que cablea el connector payment-requests-money.
      paidRepos: { folioRepo: makeRepo<any>(), invoiceRepo: makeRepo<any>(), paymentRepo: makeRepo<any>() },
    }
    const proceso = async () => {
      await assertChargeableAmount(deps, { hotelId: 'h1', reservationId: 'r1', amount: 300 })
      const item = await repo.create({ hotelId: 'h1', reservationId: 'r1', amount: 300, status: 'pending' } as any)
      await enBarrera()
      await assertCeilingAfterCommit(deps, item as any, async () => { await repo.delete(item.id) })
      return item
    }

    const results = await Promise.allSettled([proceso(), proceso()])

    // Sin la capa 2 quedarían $600 cobrables sobre un saldo de $300. Cada uno ve al otro ya
    // insertado y se echa atrás: falla de más (los dos), nunca de menos.
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(0)
    expect(rows).toHaveLength(0)
    const motivos = results.map((r) => String((r as PromiseRejectedResult).reason?.message ?? ''))
    expect(motivos.every((m) => /al mismo tiempo/.test(m))).toBe(true)
  })
})
