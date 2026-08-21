// payment-requests/tests/ceiling-property.test.ts — RTC-4: la PROPIEDAD, no los casos.
//
// Cuatro rondas de corrección escribieron un test por cada puerta encontrada y las cuatro veces
// apareció la siguiente. El problema no era la calidad de esos tests: era su forma. Un test que
// dice "cancelar un cobro expira su sesión" verifica una IMPLEMENTACIÓN; no puede fallar por una
// puerta que nadie enumeró todavía.
//
// Este test verifica la propiedad de negocio:
//
//     Σ(importes de las Checkout Sessions que Stripe todavía deja pagar para la reserva)
//       ≤ saldo cobrable de la reserva
//
// y la verifica DESPUÉS DE CADA OPERACIÓN de cada secuencia corta que se puede armar con el
// alfabeto de operaciones que mueven cualquiera de los dos lados de esa desigualdad. No enumera
// puertas: enumera SECUENCIAS. Una puerta nueva —un `PUT` que nadie previó, un camino de reservas
// que baja el total sin avisar— cae sola en cuanto su operación entra al alfabeto.
//
// Alfabeto: requerir pago · crear cobro · emitir el link · cancelar · expirar · revivir · marcar
// `paid` a mano · bajar el importe · borrar el cobro · inflar/desinflar `totalAmount` · subir/bajar
// `otherCharges` · borrar el extra · borrar la reserva · que el huésped pague un link vivo · que
// llegue el `checkout.session.completed` · que llegue el `checkout.session.expired` · que el hook
// del alta dispare el cobro automático.
// Longitud 1, 2 y 3 sobre un prefijo fijo (el click de "Requerir pago": crear + emitir), que es el
// estado desde el que se abren TODAS las puertas conocidas: 19 + 361 + 6859 = 7239 secuencias.
// La profundidad es un parámetro, no una constante editada a mano — ver `DEPTHS` más abajo para
// correr la exploración profunda (`CEILING_DEPTH=4 …`) sin colgar la suite del gate.
//
// Una operación que se NIEGA (409/400/ValidationError) no es una violación: negarse es justamente
// lo que tiene que hacer el servidor. Lo que se afirma es el estado que queda después.
//
// El mundo corre contra SQLite in-memory con el ORM y los repos reales — ver `ceiling-world.ts`.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test'
import { BALANCE_EPSILON, round2 } from '../../../shared/utils/money'
import { paidForReservation } from '../../../shared/usecases/reservation-paid'
import { updateReservationWithBalance, deleteReservation } from '../../reservas/usecases/crud'
import { handleReservationCreated } from '../../../shared/usecases/auto-payment-request'
import { deleteAddon } from '../../reservas/usecases/addons'
import type { PaymentRequestDTO } from '../types'
import {
  makeWorld, installStripe, HOTEL, RESERVATION, ADDON, USER, BASE_DEPOSIT,
  type World,
} from './ceiling-world'

/**
 * Longitudes de secuencia que se exploran. Por defecto 1..3 = 18 + 324 + 5.832 = 6.174 secuencias,
 * ~10 s: cabe en la suite del gate. La combinatoria es 18^n, así que cada nivel cuesta 18 veces
 * más — la profundidad 4 son 104.976 secuencias más (varios minutos) y NO entra en la suite.
 *
 * Para la exploración profunda a mano, sin tocar el archivo:
 *
 *     CEILING_DEPTH=4 bun test src/modules/payment-requests/tests/ceiling-property.test.ts
 *
 * `CEILING_DEPTH=n` corre 1..n. Para un solo nivel se lista explícito: `CEILING_DEPTH=4,4` no —
 * se usa `CEILING_DEPTH_ONLY=4`. La profundidad 4 ya se corrió y es la que tumbó la primera
 * versión del guard de borrado (miraba `payment_requests.status` en vez de `payments`): tres
 * secuencias distintas borraban la evidencia con `cancelar-cobro`/`expirar-cobro`/`borrar-cobro`
 * antes del `borrar-reserva`. Vale repetirla al tocar el techo o al sumar operaciones al alfabeto.
 */
const DEPTHS: number[] = (() => {
  const only = Number(process.env.CEILING_DEPTH_ONLY)
  if (Number.isFinite(only) && only > 0) return [only]
  const max = Number(process.env.CEILING_DEPTH)
  return Array.from({ length: Number.isFinite(max) && max > 0 ? max : 3 }, (_, i) => i + 1)
})()

let world: World
let restoreStripe: () => void

/** Ids de los cobros creados en el escenario, en orden. */
let created: string[] = []
/** Sesiones cuyo `checkout.session.completed` ya entregó Stripe. */
let delivered = new Set<string>()

// ── El alfabeto ────────────────────────────────────────────────────────────────────────────────

type Op = { name: string; run: () => Promise<void> }

/** El último cobro creado — sobre el que opera el staff en el panel. */
function lastRequestId(): string {
  return created[created.length - 1] ?? 'inexistente'
}

/**
 * Trae al alcance del staff las filas de `payment_requests` que aparecieron por caminos que este
 * test no llama directamente (hoy: el hook del alta).
 *
 * Sin esto el juez tenía un punto ciego: `created` sólo listaba lo creado por las operaciones del
 * panel, así que una fila que entrara "por la ventana" quedaba fuera de `lastRequestId()` y NINGUNA
 * operación posterior podía tocarla. Una fila creada sin pasar por el techo no rompe la propiedad
 * mientras no tenga sesión — rompe cuando alguien le emite el link desde el panel, que es
 * exactamente lo que el punto ciego impedía probar. Verificado por mutación: con `created` a secas,
 * devolver `auto-payment-request.ts` al `orm.create` directo (la puerta RTC-0.4 abierta) NO hacía
 * fallar el test; con este barrido, sí.
 *
 * El panel lista la tabla, no un array del test: esto acerca el mundo al real, no lo relaja.
 */
async function adoptarFilasNuevas(): Promise<void> {
  const rows = (await world.requestRepo.findMany({ hotelId: HOTEL })) as PaymentRequestDTO[]
  const known = new Set(created)
  rows
    .filter((r) => !known.has(r.id))
    .sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) || a.id.localeCompare(b.id))
    .forEach((r) => created.push(r.id))
}

/** Cablea el clamp del techo igual que `connectors/reservas-payment-requests.ts`. */
function ceilingGuard() {
  return async (item: any): Promise<void> => {
    await world.service.clampRequestsToCeiling(String(item.hotelId), String(item.id), { ...USER, role: 'super_admin' })
  }
}

async function updateReserva(dto: Record<string, unknown>): Promise<void> {
  await updateReservationWithBalance(
    (rid: string, hid: string) => world.addonRepo.findMany({ reservationId: rid, hotelId: hid }) as any,
    world.paidOf,
    world.reservationRepo, world.logger, world.cache, {},
    RESERVATION, dto as any, { ...USER, role: 'super_admin' },
    undefined, undefined, undefined, undefined,
    ceilingGuard(),
  )
}

/**
 * El huésped abre un link vivo y paga. NO dispara el webhook: son dos eventos distintos y entre
 * uno y otro hay una ventana real (segundos, o minutos si Stripe reintenta). Modelarlos juntos
 * escondía justamente el estado en el que se abrió P5 — sesión ya abonada, fila todavía `pending`.
 */
async function guestPays(): Promise<void> {
  const session = world.ledger.liveFor(HOTEL, RESERVATION)[0]
  if (!session) return
  session.status = 'complete'
}

/** Stripe entrega los `checkout.session.completed` que todavía debía. */
async function deliverPaid(): Promise<void> {
  for (const s of world.ledger.sessions.values()) {
    if (s.status !== 'complete' || delivered.has(s.id)) continue
    delivered.add(s.id)
    await deliver('checkout.session.completed', s.id)
  }
}

async function deliver(type: string, sessionId: string): Promise<void> {
  const s = world.ledger.sessions.get(sessionId)
  if (!s) return
  const event = {
    id: `evt_${type}_${sessionId}`,
    type,
    data: { object: { id: s.id, amount_total: s.amountMinor, payment_intent: s.paymentIntent, metadata: s.metadata } },
  }
  await world.service.handleWebhook(HOTEL, JSON.stringify(event), 'sig_test')
}

async function crearCobro(): Promise<void> {
  // Lo que hace el botón "Requerir pago" del modal: pedir el pendiente COMPLETO.
  const amount = await world.balance()
  const item = await world.service.create({ reservationId: RESERVATION, amount } as any, USER)
  created.push(item.id)
}

/**
 * El hook del alta con `automation_config.autoPaymentRequest` encendido — puerta RTC-0.4.
 *
 * `shared/usecases/auto-payment-request.ts` fue el CUARTO escritor de `payment_requests` y creaba
 * la fila con `orm.create` directo: sin techo, sin lock y sin verificación post-commit, y leyendo
 * la tabla sin `hotelId`. Hoy delega en el service dueño, pero eso lo verificaban sólo tests
 * contra dobles: entra al alfabeto para que el juez lo mida contra el techo REAL y, si alguien
 * vuelve a abrir esa ventana, caiga solo dentro de cualquier secuencia. Se dispara sobre la
 * reserva del escenario, que es lo que hace el alta.
 *
 * Es fire-and-forget por diseño (se traga sus errores): lo que se afirma es el estado posterior.
 */
async function autoCobroDelAlta(): Promise<void> {
  const reservation = await world.reservationRepo.findById(RESERVATION)
  if (!reservation) return
  await handleReservationCreated(world.orm, reservation, {
    create: async (dto, user) => {
      const item = await world.service.create(dto as any, user as any)
      created.push(item.id)
      return item
    },
  })
}

async function emitirLink(): Promise<void> {
  await world.service.createCheckout(lastRequestId(), USER, 'https://panel.test')
}

function alphabet(): Op[] {
  return [
    // El click real del modal: crear el cobro Y generar el link, en un solo acto.
    { name: 'requerir-pago', run: async () => { await crearCobro(); await emitirLink() } },
    { name: 'cobro-nuevo', run: crearCobro },
    { name: 'emitir-link', run: emitirLink },
    { name: 'cancelar-cobro', run: async () => { await world.service.update(lastRequestId(), { status: 'cancelled' }, USER) } },
    { name: 'expirar-cobro', run: async () => { await world.service.update(lastRequestId(), { status: 'expired' }, USER) } },
    { name: 'revivir-cobro', run: async () => { await world.service.update(lastRequestId(), { status: 'pending' }, USER) } },
    { name: 'marcar-pagado', run: async () => { await world.service.update(lastRequestId(), { status: 'paid' }, USER) } },
    { name: 'bajar-importe', run: async () => { await world.service.update(lastRequestId(), { amount: 50 }, USER) } },
    { name: 'borrar-cobro', run: async () => { await world.service.delete(lastRequestId(), USER) } },
    { name: 'inflar-total', run: () => updateReserva({ totalAmount: 5000 }) },
    { name: 'desinflar-total', run: () => updateReserva({ totalAmount: 100 }) },
    { name: 'subir-otros-cargos', run: () => updateReserva({ otherCharges: 1000 }) },
    { name: 'bajar-otros-cargos', run: () => updateReserva({ otherCharges: 0 }) },
    {
      name: 'borrar-extra',
      run: () => deleteAddon(
        world.addonRepo, world.reservationRepo, world.userRepo,
        world.auth, ADDON, { ...USER, role: 'super_admin' },
        async () => {}, world.paidOf,
        (rid: string, hid: string) => world.service.clampRequestsToCeiling(hid, rid, { ...USER, role: 'super_admin' }).then(() => undefined),
      ),
    },
    {
      name: 'borrar-reserva',
      run: () => deleteReservation(
        world.reservationRepo, world.logger, world.cache, {}, RESERVATION, { ...USER, role: 'super_admin' },
        (hid: string, rid: string) => world.service.releaseRequestsOfReservation(hid, rid, { ...USER, role: 'super_admin' }).then(() => undefined),
      ),
    },
    { name: 'auto-cobro-alta', run: autoCobroDelAlta },
    { name: 'huesped-paga', run: guestPays },
    { name: 'webhook-cobro', run: deliverPaid },
    {
      name: 'webhook-expiro',
      run: async () => {
        const last = [...world.ledger.sessions.values()].pop()
        // Stripe sólo vence sesiones abiertas: una ya abonada no vuelve atrás.
        if (last?.status === 'open') { last.status = 'expired'; await deliver('checkout.session.expired', last.id) }
      },
    },
  ]
}

// ── Las propiedades ────────────────────────────────────────────────────────────────────────────

interface Violation { propiedad: string; sequence: string[]; step: number; detail: string }

/**
 * PROPIEDAD 1 — TECHO. Nunca hay más plata cobrable viva que saldo.
 *
 *     Σ(sesiones que Stripe todavía deja pagar) ≤ saldo cobrable de la reserva
 */
async function checkCeiling(): Promise<string | null> {
  const exposure = world.ledger.liveExposure(HOTEL, RESERVATION)
  const balance = await world.balance()
  if (exposure <= round2(balance) + BALANCE_EPSILON) return null
  return `$${exposure} cobrables en Stripe sobre un saldo de $${balance}`
}

/**
 * PROPIEDAD 2 — CONSERVACIÓN. La plata que el huésped YA puso nunca queda sin reserva a la que
 * aplicarse, y una vez liquidada aparece reconocida en el saldo de esa reserva.
 *
 * Es la mitad que le falta a la propiedad del techo, y por eso hacen falta las dos: el techo mide
 * que no se cobre de MÁS, y sólo mira las sesiones ABIERTAS. Un cobro que ya entró sale de esa
 * cuenta, así que todo lo que le pase después —que se borre la reserva, que el webhook no encuentre
 * a quién aplicarlo, que se marque `paid` a mano y se descarte la liquidación— es invisible para la
 * propiedad 1 y, sin embargo, es plata del huésped que el hotel no puede rendir.
 *
 * Dos afirmaciones:
 *   (a) si alguna sesión de la reserva fue abonada, la reserva TIENE que seguir existiendo;
 *   (b) todo lo abonado y ya liquidado (con fila en `payments`) está reconocido por
 *       `paidForReservation` — que es el número contra el que el techo autoriza el próximo cobro.
 */
async function checkConservation(): Promise<string | null> {
  const sessions = [...world.ledger.sessions.values()]
    .filter((s) => s.hotelId === HOTEL && s.metadata.reservationId === RESERVATION)
  const paidByGuest = sessions.filter((s) => s.status === 'complete')
  if (paidByGuest.length === 0) return null

  const reservation = await world.reservationRepo.findById(RESERVATION)
  if (!reservation) {
    const total = round2(paidByGuest.reduce((a, s) => a + s.amountMinor / 100, 0))
    return `el huésped abonó $${total} y la reserva ya no existe: el cobro queda huérfano`
  }

  // Lo liquidado: las sesiones abonadas que ya dejaron su asiento en `payments`.
  const rows = await world.paymentRepo.findMany({ hotelId: HOTEL })
  const settledIds = new Set((rows as any[]).map((r) => String(r.stripeSessionId ?? '')))
  const settled = round2(
    paidByGuest.filter((s) => settledIds.has(s.id)).reduce((a, s) => a + s.amountMinor / 100, 0),
  )
  if (settled === 0) return null

  const recognised = await paidForReservation(world.paidRepos, HOTEL, RESERVATION, reservation)
  const expected = round2(BASE_DEPOSIT + settled)
  if (recognised + BALANCE_EPSILON < expected) {
    return `se liquidaron $${settled} (más $${BASE_DEPOSIT} de anticipo) y la reserva sólo reconoce $${recognised} cobrados`
  }
  return null
}

const PROPIEDADES: Array<[string, () => Promise<string | null>]> = [
  ['techo', checkCeiling],
  ['conservación', checkConservation],
]

/** El estado desde el que se abren todas las puertas conocidas: un cobro emitido y vivo. */
const PREFIX = ['requerir-pago']

async function runSequence(names: string[]): Promise<Violation | null> {
  await world.reset()
  created = []
  delivered = new Set()
  const ops = new Map(alphabet().map((o) => [o.name, o]))
  const full = [...PREFIX, ...names]
  for (let i = 0; i < full.length; i++) {
    const op = ops.get(full[i]!)!
    // Negarse es correcto: lo que importa es el estado que queda, no si la operación pasó.
    try { await op.run() } catch { /* refusal */ }
    await adoptarFilasNuevas()
    for (const [propiedad, check] of PROPIEDADES) {
      const detail = await check()
      if (detail) return { propiedad, sequence: full, step: i, detail }
    }
  }
  return null
}

function sequences(names: string[], length: number): string[][] {
  if (length === 0) return [[]]
  const shorter = sequences(names, length - 1)
  return names.flatMap((n) => shorter.map((s) => [n, ...s]))
}

function describeViolations(vs: Violation[]): string {
  const head = vs.slice(0, 20).map((v) =>
    `  [${v.propiedad}] [${v.sequence.join(' → ')}] tras el paso ${v.step + 1} ("${v.sequence[v.step]}"): ${v.detail}`)
  return `${vs.length} secuencia(s) rompen una propiedad del camino del dinero:\n${head.join('\n')}` +
    (vs.length > head.length ? `\n  … y ${vs.length - head.length} más` : '')
}

// ── Corrida ────────────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  world = await makeWorld()
  restoreStripe = installStripe(world.ledger)
})
afterAll(() => { restoreStripe?.() })
beforeEach(() => { created = []; delivered = new Set() })

describe('RTC-4 · propiedad: nunca hay más cobrable vivo que saldo', () => {
  it('el mundo de prueba mide contra la base real (control: sin cobros no hay exposición)', async () => {
    await world.reset()
    expect(await world.balance()).toBe(400) // 500 + 100 de extra − 200 de anticipo
    expect(world.ledger.liveExposure(HOTEL, RESERVATION)).toBe(0)
    // Y `paidForReservation` corre de verdad contra `payments`: un cobro suelto de la reserva baja
    // el saldo. Si el modelo o el nombre de un campo cambiara, esto muere (anti-patrón ORM).
    await world.paymentRepo.create({
      hotelId: HOTEL, reservationId: RESERVATION, type: 'charge', method: 'cash',
      status: 'completed', amount: 150, currency: 'USD',
    } as any)
    expect(await world.balance()).toBe(250)
  })

  it('un cobro emitido y vivo nunca supera el saldo (prefijo)', async () => {
    expect(await runSequence([])).toBeNull()
  })

  // ── Controles negativos ──────────────────────────────────────────────────────────────────────
  // Un guard que cierra una puerta apagando la funcionalidad haría pasar las propiedades de arriba
  // sin arreglar nada. Estos tres casos mueren si eso ocurre.

  it('el camino legítimo sigue abierto: revivir un cobro cancelado vuelve a emitir link', async () => {
    await world.reset()
    const pr = await world.service.create({ reservationId: RESERVATION, amount: 400 } as any, USER)
    await world.service.createCheckout(pr.id, USER, 'https://panel.test')
    await world.service.update(pr.id, { status: 'cancelled' }, USER)
    // 409 mientras está dado de baja …
    const blocked = await world.service.createCheckout(pr.id, USER, 'https://panel.test') as any
    expect(blocked.status).toBe(409)
    // … y link nuevo en cuanto vuelve a `pending`, con el techo revalidado contra el saldo de hoy.
    await world.service.update(pr.id, { status: 'pending' }, USER)
    const ok = await world.service.createCheckout(pr.id, USER, 'https://panel.test') as any
    expect(ok.url).toContain('https://pay.test/')
    expect(world.ledger.liveExposure(HOTEL, RESERVATION)).toBe(400)
  })

  it('el mismo cobro con sesión abierta REUTILIZA la sesión, no emite una segunda', async () => {
    await world.reset()
    const pr = await world.service.create({ reservationId: RESERVATION, amount: 400 } as any, USER)
    const a = await world.service.createCheckout(pr.id, USER, 'https://panel.test') as any
    const b = await world.service.createCheckout(pr.id, USER, 'https://panel.test') as any
    expect(b.sessionId).toBe(a.sessionId)
    expect(world.ledger.sessions.size).toBe(1)
  })

  it('una reserva SIN cobros abonados se sigue pudiendo borrar', async () => {
    await world.reset()
    const pr = await world.service.create({ reservationId: RESERVATION, amount: 400 } as any, USER)
    await world.service.createCheckout(pr.id, USER, 'https://panel.test')
    await deleteReservation(
      world.reservationRepo, world.logger, world.cache, {}, RESERVATION, { ...USER, role: 'super_admin' },
      (hid: string, rid: string) => world.service.releaseRequestsOfReservation(hid, rid, { ...USER, role: 'super_admin' }).then(() => undefined),
    )
    expect(await world.reservationRepo.findById(RESERVATION)).toBeNull()
    expect(world.ledger.liveExposure(HOTEL, RESERVATION)).toBe(0)
  })

  for (const length of DEPTHS) {
    it(`ninguna secuencia de ${length} operación(es) sobre un link vivo rompe el camino del dinero`, async () => {
      const names = alphabet().map((o) => o.name)
      const violations: Violation[] = []
      for (const seq of sequences(names, length)) {
        const v = await runSequence(seq)
        if (v) violations.push(v)
      }
      expect(violations.length === 0 ? '' : describeViolations(violations)).toBe('')
    }, 600_000)
  }
})
