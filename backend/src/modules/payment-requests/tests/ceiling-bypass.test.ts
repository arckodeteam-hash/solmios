// payment-requests/tests/ceiling-bypass.test.ts — BUG-ceiling-bypass (gate CHK-20260819, 4ª ronda).
//
// CAUSA RAÍZ. `charge-ceiling.ts` cuenta FILAS `pending` y declara (líneas 18-24) que eso equivale a
// contar SESIONES DE STRIPE VIVAS porque "una fila `pending` tiene a lo sumo una sesión abierta".
// Ese invariante lo sostenían dos cosas, y ninguna de las dos existía:
//
//   1. El PUNTERO a la sesión (`stripeSessionId` / `stripePaymentUrl`) tenía que ser propiedad del
//      SERVIDOR. Estaba en `UpdatePaymentRequestSchema` y en la whitelist `PATCHABLE`, así que
//      cualquiera con `billing:edit` mandaba `PUT {"stripeSessionId": ""}` — sin `status`, con lo
//      cual `releasesCeiling` daba `false` y NO se expiraba nada — y la fila perdía el puntero con
//      la sesión todavía `open` en Stripe. El `PUT {"status":"cancelled"}` siguiente salía por la
//      primera línea de `releaseSession` (`if (!pr.stripeSessionId) return 'none'`): techo liberado,
//      link vivo y pagable.
//
//   2. TODA baja del saldo comprometido por la fila tenía que matar la sesión primero. La condición
//      miraba SÓLO `dto.status`, así que un `PUT {"amount": 50}` sobre un `pending` de $300 con
//      sesión viva bajaba `committedPending` a 50 sin expirar nada: el link de $300 seguía pagable
//      y el hueco liberado lo llenaba un segundo cobro.
//
// Los dos agujeros son la MISMA causa: el techo es un agregado sobre `pending`, y se dejaba mover
// lo que ese agregado mide (el estado, el importe, el puntero a la sesión) sin pasar por la baja de
// la sesión. El fix: `stripeSessionId`/`stripePaymentUrl`/`paidAt` salen del contrato de entrada
// (son estado interno del servidor, los escriben `create-checkout` y el webhook), y la baja de la
// sesión se dispara por CUALQUIER patch que reduzca lo comprometido, no sólo por el estado.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import type { RepositoryAdapter, Auth } from 'arckode-framework'
import { validateSchema } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { PaymentRequestsService } from '../service'
import { UpdatePaymentRequestSchema } from '../validators/schema'
import { StripeService } from '../../../services/stripe-service'
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

// ── Doble de Stripe ────────────────────────────────────────────────────────────────────────────
let expired: string[] = []
const realStripe = {
  isConfigured: StripeService.isConfigured,
  createCheckoutSession: StripeService.createCheckoutSession,
  getSession: StripeService.getSession,
  expireCheckoutSession: StripeService.expireCheckoutSession,
}
beforeEach(() => {
  expired = []
  StripeService.expireCheckoutSession = (async (sessionId: string) => {
    expired.push(sessionId); return 'expired'
  }) as typeof StripeService.expireCheckoutSession
})
afterEach(() => { Object.assign(StripeService, realStripe) })

/**
 * Tabla `payment_requests` en memoria — como la real: `findMany` ve lo persistido, `update` PISA la
 * fila. Sin esto el test no puede encadenar dos requests sobre la misma fila.
 */
function makeStore(seed: PaymentRequestDTO[] = []) {
  const rows: PaymentRequestDTO[] = [...seed]
  let seq = 0
  const repo = makeRepo<PaymentRequestDTO>({
    findMany: async (f: any) => rows.filter((r) => r.hotelId === f?.hotelId && r.reservationId === f?.reservationId) as any,
    // COPIA, como un repo real: `previous` no puede ser la MISMA referencia que muta el update.
    findById: async (id: string) => { const r = rows.find((x) => x.id === id); return r ? { ...r } : null },
    create: async (d: any) => { const row = { id: `new${++seq}`, ...d } as PaymentRequestDTO; rows.push(row); return row },
    update: async (id: string, d: any) => {
      const row = rows.find((r) => r.id === id)
      if (!row) return null
      Object.assign(row, d)
      return { ...row }
    },
    delete: async (id: string) => { const i = rows.findIndex((r) => r.id === id); if (i >= 0) rows.splice(i, 1); return i >= 0 },
  })
  return { repo, rows }
}

/** Reserva de $500 con $200 de anticipo → saldo cobrable $300. */
function makeService(repo: RepositoryAdapter<PaymentRequestDTO>) {
  const s = new PaymentRequestsService(
    repo,
    makeRepo<any>({ findById: async (id: string) => ({ id, hotelId: 'h1', totalAmount: 500, deposit: 200, otherCharges: 0 }) }),
    makeRepo<any>(), makeRepo<any>(),
    makeRepo<any>({ findById: async () => ({ id: 'u1', hotelId: 'h1' }) }),
    log, permissiveAuth, makeRepo<any>(),
  )
  // STR-A: puerto de dinero del connector payment-requests-money (sin folios/facturas/pagos: paid=deposit).
  s.setMoneyDeps({ paidRepos: { folioRepo: makeRepo<any>(), invoiceRepo: makeRepo<any>(), paymentRepo: makeRepo<any>() } })
  return s
}

const linkVivo = (over: Partial<PaymentRequestDTO> = {}): PaymentRequestDTO => ({
  id: 'pr1', hotelId: 'h1', reservationId: 'r1', amount: 300, currency: 'USD',
  status: 'pending', sentTo: '', sentVia: 'email',
  stripeSessionId: 'sess_viva', stripePaymentUrl: 'https://pay/viva', ...over,
})

// ── PUERTA 1: el puntero a la sesión es estado del servidor ─────────────────────────────────────
describe('BUG-ceiling-bypass · el cliente no escribe el puntero de la sesión', () => {
  it('el schema del PUT descarta stripeSessionId, stripePaymentUrl y paidAt', () => {
    const out = validateSchema(UpdatePaymentRequestSchema, {
      amount: 50, status: 'cancelled', sentTo: 'g@x.com', sentVia: 'email',
      stripeSessionId: '', stripePaymentUrl: 'https://evil', paidAt: '2020-01-01T00:00:00.000Z',
    })
    expect(out).toEqual({ amount: 50, status: 'cancelled', sentTo: 'g@x.com', sentVia: 'email' })
  })

  it('blanquear la sesión y después cancelar NO libera el techo con el link vivo', async () => {
    const { repo, rows } = makeStore([linkVivo()])
    const s = makeService(repo)

    // Paso 1 del exploit: el PUT que borraba el puntero sin tocar `status`.
    await s.update('pr1', { stripeSessionId: '', stripePaymentUrl: '' } as any, currentUser)
    expect(rows[0].stripeSessionId).toBe('sess_viva') // el servidor ignora el intento

    // Paso 2: ahora sí cancelar. La sesión TIENE que morir en Stripe antes de liberar el techo.
    await s.update('pr1', { status: 'cancelled' }, currentUser)
    expect(expired).toEqual(['sess_viva'])

    // Y recién con la sesión muerta el saldo vuelve a estar disponible.
    const nuevo = await s.create({ reservationId: 'r1', amount: 300 } as any, currentUser)
    expect(nuevo.amount).toBe(300)
    expect(rows.filter((r) => r.status === 'pending')).toHaveLength(1)
  })

  it('el service ignora el puntero aunque el DTO llegue por fuera del controller', async () => {
    const { repo, rows } = makeStore([linkVivo()])
    const s = makeService(repo)
    await s.update('pr1', { sentTo: 'otro@x.com', stripePaymentUrl: 'https://evil', paidAt: 'ayer' } as any, currentUser)
    expect(rows[0].stripePaymentUrl).toBe('https://pay/viva')
    expect(rows[0].paidAt).toBeUndefined()
    expect(rows[0].sentTo).toBe('otro@x.com')
  })
})

// ── PUERTA 2: bajar el importe también libera techo ─────────────────────────────────────────────
describe('BUG-ceiling-bypass · bajar el importe mata la sesión emitida', () => {
  it('PUT {amount:50} sobre un pending de 300 con sesión viva la expira', async () => {
    const { repo, rows } = makeStore([linkVivo()])
    const s = makeService(repo)
    await s.update('pr1', { amount: 50 }, currentUser)
    expect(expired).toEqual(['sess_viva'])
    expect(rows[0].amount).toBe(50)
    expect(rows[0].stripePaymentUrl).toBe('') // la URL muerta no se sigue mostrando
  })

  it('no quedan dos sesiones vivas por encima del saldo tras bajar el importe', async () => {
    const { repo, rows } = makeStore([linkVivo()])
    const s = makeService(repo)
    await s.update('pr1', { amount: 50 }, currentUser)
    // El hueco liberado se puede volver a pedir, pero el link viejo YA no es pagable.
    await s.create({ reservationId: 'r1', amount: 250 } as any, currentUser)
    expect(expired).toEqual(['sess_viva'])
    const vivos = rows.filter((r) => r.status === 'pending' && r.stripePaymentUrl)
    expect(vivos).toHaveLength(0)
  })

  it('si Stripe no puede expirar, el importe NO cambia (bajar el techo con el link vivo es el bug)', async () => {
    StripeService.expireCheckoutSession = (async () => { throw new Error('stripe caido') }) as typeof StripeService.expireCheckoutSession
    const { repo, rows } = makeStore([linkVivo()])
    const s = makeService(repo)
    await expect(s.update('pr1', { amount: 50 }, currentUser)).rejects.toThrow('stripe caido')
    expect(rows[0].amount).toBe(300)
  })

  it('si el link ya fue abonado, re-precificarlo corta con 409', async () => {
    StripeService.expireCheckoutSession = (async () => 'paid') as typeof StripeService.expireCheckoutSession
    const { repo, rows } = makeStore([linkVivo()])
    const s = makeService(repo)
    await expect(s.update('pr1', { amount: 50 }, currentUser)).rejects.toThrow('ya fue abonado')
    expect(rows[0].amount).toBe(300)
  })

  it('un update que deja el importe igual no expira nada', async () => {
    const { repo } = makeStore([linkVivo()])
    const s = makeService(repo)
    await s.update('pr1', { amount: 300 }, currentUser)
    expect(expired).toHaveLength(0)
  })

  it('sobre un cobro que ya NO está pending no hay sesión que matar', async () => {
    const { repo } = makeStore([linkVivo({ status: 'cancelled' })])
    const s = makeService(repo)
    await s.update('pr1', { sentTo: 'x@y.com' }, currentUser)
    expect(expired).toHaveLength(0)
  })
})

// ── El cableado de LA GARANTÍA multi-proceso ────────────────────────────────────────────────────
// `charge-ceiling.ts:123` llama a `assertCeilingAfterCommit` "LA GARANTÍA" del caso multi-proceso, y
// borrar su llamada de `service.ts` dejaba 74/74 tests en verde: el test de concurrencia llama al
// helper a mano y reimplementa el alta, así que cubría la función y NO el cableado. Estos dos casos
// mueren si alguien descablea la llamada — sin concurrencia, forzando el interleaving con un
// `findMany` que devuelve el competidor recién en la RE-lectura post-commit.
describe('BUG-ceiling-bypass · el service cablea la re-verificación post-commit', () => {
  /** `findMany` limpio en la pre-validación y con un competidor `pending` en la re-lectura. */
  function repoConCompetidorTardio(seed: PaymentRequestDTO[] = []) {
    const rows: PaymentRequestDTO[] = [...seed]
    const competidor: PaymentRequestDTO = {
      id: 'otro', hotelId: 'h1', reservationId: 'r1', amount: 300,
      currency: 'USD', status: 'pending', sentTo: '', sentVia: 'email',
    }
    let lecturas = 0
    let seq = 0
    const repo = makeRepo<PaymentRequestDTO>({
      findMany: async () => (++lecturas === 1 ? [...rows] : [...rows, competidor]) as any,
      findById: async (id: string) => { const r = rows.find((x) => x.id === id); return r ? { ...r } : null },
      create: async (d: any) => { const row = { id: `new${++seq}`, ...d } as PaymentRequestDTO; rows.push(row); return row },
      update: async (id: string, d: any) => {
        const row = rows.find((r) => r.id === id); if (!row) return null
        Object.assign(row, d); return { ...row }
      },
      delete: async (id: string) => { const i = rows.findIndex((r) => r.id === id); if (i >= 0) rows.splice(i, 1); return i >= 0 },
    })
    return { repo, rows }
  }

  it('create revierte el link si otro cobro entró entre la validación y el commit', async () => {
    const { repo, rows } = repoConCompetidorTardio()
    const s = makeService(repo)
    await expect(s.create({ reservationId: 'r1', amount: 300 } as any, currentUser)).rejects.toThrow('al mismo tiempo')
    expect(rows).toHaveLength(0) // el link recién creado se borró
  })

  it('update revierte el importe si otro cobro entró entre la validación y el commit', async () => {
    const { repo, rows } = repoConCompetidorTardio([linkVivo({ amount: 10, stripeSessionId: '', stripePaymentUrl: '' })])
    const s = makeService(repo)
    await expect(s.update('pr1', { amount: 300 }, currentUser)).rejects.toThrow('al mismo tiempo')
    expect(rows[0].amount).toBe(10) // revertido al anterior
  })
})
