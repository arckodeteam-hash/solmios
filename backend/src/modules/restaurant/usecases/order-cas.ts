// restaurant/usecases/order-cas.ts — #214: UPDATE condicional sobre la comanda (el "lock" del dinero).
//
// TODA mutación de dinero de una comanda pasa por acá: reservar saldo (una parte, o el cobro ENTERO),
// soltarlo, asentar un cobro, cancelar. La condición es siempre la misma pareja `amountPaid` /
// `amountReserved` leída un instante antes: si otra vía la movió en el medio, el UPDATE afecta 0 filas y
// el que llama relee y decide de nuevo. Sin esto `payOrder`/`chargeToRoom` (cobro entero) y
// `addOrderPayment` (una parte) eran read-check-write cada uno por su lado y competían: efectivo entero
// + parte de 40 concurrentes cobraban 140 sobre 100; cancelar + parte cobraban una venta anulada.
//
// `amountPaid`/`amountReserved`/`linesLockedUntil` pueden venir en NULL (filas anteriores a la columna, sin
// el backfill de migrate-db.ts): `= NULL` no matchea nunca, así que se inicializan a 0 ANTES del primer CAS
// — pero con condición (`updatedAt` sin cambios desde la lectura), nunca a ciegas: un `update({0,0})`
// incondicional pisaba la reserva que otra parte acababa de escribir. Todo `openOrder` nuevo ya nace en 0.
//
// COR-A: las LÍNEAS también mueven el dinero (cambian el saldo). Editar una línea toma el lock de líneas
// (`linesLockedUntil`, un lease corto con UPDATE condicional) y lo suelta al terminar; mientras está tomado,
// reservar saldo (una parte, el cobro entero) y cancelar dan 409. Y todo CAS de dinero condiciona ADEMÁS
// sobre `subtotal`/`tax` (el saldo) y el propio lock: una edición que terminó entre la lectura y la
// escritura deja el UPDATE en 0 filas y el que llama relee. Sin esto `voidLine(A)` y una parte por la
// línea A concurrentes entraban las dos: comanda `sent` con due 40 y amountPaid 60, sin salida por API.
import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { NotFoundError, ConflictError } from 'arckode-framework'
import type { OrderDTO } from '../types'
import { round2 } from '../../../shared/utils/money'
import type { CounterCas } from './order-number'

export const ORDERS_MODEL = 'RestaurantOrders'
export const ORDER_PAYMENTS_MODEL = 'RestaurantOrderPayments'
/** Vueltas del UPDATE condicional antes de rendirse: cada vuelta perdida = otra vía que se movió en el medio. */
export const CAS_ATTEMPTS = 10

export interface OrderCasDeps {
  orders: RepositoryAdapter<OrderDTO>
  /** UPDATE condicional (el `orm` real en producción, ver index.ts). Sin él (tests viejos con repos en
   *  memoria) degrada a read-modify-write, igual que `counterCas` en order-number.ts. */
  cas?: CounterCas
  logger?: Logger
}

/** Lease del lock de líneas: una edición son unas pocas consultas; si el proceso muere en el medio, la comanda vuelve a estar libre sola. */
export const LINES_LOCK_LEASE_MS = 15_000
/** Cuánto espera una edición de líneas a que otra suelte el lock (dos mozos cargando a la vez) antes de rendirse. */
const LINES_LOCK_WAIT_MS = 25
const LINES_LOCK_WAIT_ATTEMPTS = 80

// El lease es un ISO (TEXT), no epoch ms en `number`: el ORM mapea `number` a REAL, que en Postgres es float4
// (24 bits de mantisa) y a 1.7e12 ms redondea de a ~131 s — un lease de 15 s podía nacer ya vencido.
export type OrderForCas = OrderDTO & { amountPaid: number; amountReserved: number; linesLockedUntil: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** ¿Hay una edición de líneas en curso? Un lease vencido (proceso caído a mitad de la edición) cuenta como libre. */
export const linesLocked = (order: Pick<OrderDTO, 'linesLockedUntil'>, now = Date.now()): boolean => !!order.linesLockedUntil && Date.parse(order.linesLockedUntil) > now
export function assertLinesUnlocked(order: Pick<OrderDTO, 'linesLockedUntil'>): void {
  if (linesLocked(order)) throw new ConflictError('Se están editando las líneas de la comanda; reintentá en un momento')
}

/**
 * Comanda releída para el CAS, con `amountPaid`/`amountReserved` garantizados numéricos. Si vienen en
 * NULL se inicializan a 0 con un UPDATE condicionado a que la fila no haya cambiado desde la lectura
 * (`updatedAt`); 0 filas = alguien la tocó → se relee. `updatedAt` tiene resolución de milisegundo: se
 * espera a estar fuera del ms de la última escritura para que ninguna escritura posterior pueda
 * compartir el sello con la que se leyó.
 */
export async function freshForCas(deps: OrderCasDeps, orderId: string): Promise<OrderForCas> {
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    const order = await deps.orders.findById(orderId)
    if (!order) throw new NotFoundError('Comanda no encontrada')
    if (order.amountPaid != null && order.amountReserved != null && order.linesLockedUntil != null) {
      return { ...order, amountPaid: Number(order.amountPaid), amountReserved: Number(order.amountReserved), linesLockedUntil: String(order.linesLockedUntil) }
    }
    const init = { amountPaid: Number(order.amountPaid ?? 0), amountReserved: Number(order.amountReserved ?? 0), linesLockedUntil: String(order.linesLockedUntil ?? '') }
    if (!deps.cas) { await deps.orders.update(orderId, init as Partial<Omit<OrderDTO, 'id'>>); continue }
    const stamp = (order as { updatedAt?: string }).updatedAt
    if (!stamp) throw new ConflictError('La comanda es anterior a la migración de pagos parciales: correr `bun run migrate` (backfill de amountPaid/amountReserved)')
    const lastWrite = Date.parse(stamp)
    if (Number.isFinite(lastWrite)) while (Date.now() <= lastWrite) await sleep(1)
    await deps.cas.updateMany(ORDERS_MODEL, { id: orderId, updatedAt: stamp }, init)
    // Haya entrado o no (otra vía inicializó/reservó en el medio), se relee: lo que vale es la fila.
  }
  throw new ConflictError('No se pudo inicializar el saldo de la comanda (otra operación en curso); reintentá')
}

/**
 * Aplica `changes` SOLO si la comanda sigue con el `amountPaid`/`amountReserved` que se leyó, el mismo
 * saldo (`subtotal`/`tax`: una edición de líneas que terminó en el medio lo cambió), el mismo lock de
 * líneas y, si se pasa, el mismo `status`. 0 filas = otra vía se movió en el medio → el que llama relee
 * y decide de nuevo.
 */
export async function casOrder(
  deps: OrderCasDeps,
  seen: OrderForCas,
  changes: Record<string, unknown>,
  alsoStatus = false,
): Promise<boolean> {
  if (!deps.cas) { await deps.orders.update(seen.id, changes as Partial<Omit<OrderDTO, 'id'>>); return true }
  const where: Record<string, unknown> = {
    id: seen.id, amountPaid: seen.amountPaid, amountReserved: seen.amountReserved, linesLockedUntil: seen.linesLockedUntil,
    subtotal: Number(seen.subtotal || 0), tax: Number(seen.tax || 0),
  }
  if (alsoStatus) where.status = seen.status
  const affected = await deps.cas.updateMany(ORDERS_MODEL, where, changes)
  return Number(affected) > 0
}

/**
 * Escribe `changesOf(fresh)` con el CAS del dinero, releyendo hasta que entre. `guard` corre sobre la fila
 * fresca en cada vuelta (409 si el estado ya no lo permite). Devuelve la fila como quedó. Lo usan las
 * escrituras que NO reservan saldo pero sí dependen de él (fijar la propina/total de la cuenta, mover una
 * parte devuelta): sin CAS, una edición de líneas o una parte en el medio quedaba pisada.
 */
export async function casUpdate(
  deps: OrderCasDeps,
  orderId: string,
  guard: (fresh: OrderForCas) => void,
  changesOf: (fresh: OrderForCas) => Record<string, unknown>,
  alsoStatus = false,
): Promise<OrderForCas> {
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    const fresh = await freshForCas(deps, orderId)
    guard(fresh)
    const changes = changesOf(fresh)
    if (await casOrder(deps, fresh, changes, alsoStatus)) return { ...fresh, ...changes } as OrderForCas
  }
  throw new ConflictError('No se pudo actualizar la comanda (otra operación en curso); reintentá')
}

/**
 * COR-A — Toma el lock de líneas: un lease de `LINES_LOCK_LEASE_MS` escrito con el mismo UPDATE condicional
 * que reserva saldo. `guard` corre sobre la fila fresca en cada vuelta (cancelada, liquidada, con pagos
 * parciales… → 409). Si otra edición lo tiene, se ESPERA (dos mozos cargando la misma mesa es lo normal,
 * no un conflicto); si no se suelta en ~2 s, 409. Devuelve la fila sobre la que se tomó y el token con el
 * que se suelta (`unlockLines`). Sin `cas` (tests viejos con repos en memoria) no hay lock: read-modify-write.
 */
export async function lockLines(deps: OrderCasDeps, orderId: string, guard: (fresh: OrderForCas) => void): Promise<{ fresh: OrderForCas; token: string }> {
  let waited = 0
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    const fresh = await freshForCas(deps, orderId)
    guard(fresh)
    if (!deps.cas) return { fresh, token: '' }
    if (linesLocked(fresh)) {
      if (waited++ >= LINES_LOCK_WAIT_ATTEMPTS) assertLinesUnlocked(fresh)
      await sleep(LINES_LOCK_WAIT_MS)
      attempt--
      continue
    }
    // Token único por toma: dos ediciones seguidas en el mismo ms no comparten lease (la segunda no podría
    // soltar el de la primera ni al revés).
    const previous = fresh.linesLockedUntil ? Date.parse(fresh.linesLockedUntil) : 0
    const token = new Date(Math.max(Date.now() + LINES_LOCK_LEASE_MS, previous + 1)).toISOString()
    if (await casOrder(deps, fresh, { linesLockedUntil: token })) return { fresh: { ...fresh, linesLockedUntil: token }, token }
  }
  throw new ConflictError('No se pudo tomar la comanda para editar sus líneas (hay un cobro en curso); reintentá')
}

/** Suelta el lock de líneas SOLO si sigue siendo el nuestro (`token`): un lease vencido que otro ya tomó no se pisa. */
export async function unlockLines(deps: OrderCasDeps, orderId: string, token: string): Promise<void> {
  if (!deps.cas || !token) return
  try {
    await deps.cas.updateMany(ORDERS_MODEL, { id: orderId, linesLockedUntil: token }, { linesLockedUntil: '' })
  } catch (e) {
    // El lease vence solo (LINES_LOCK_LEASE_MS); hasta entonces la comanda no se cobra ni se cancela. Se loguea, no se tumba la edición.
    deps.logger?.error('restaurant: no se pudo soltar el lock de líneas de la comanda; vence solo', { orderId, token, error: e instanceof Error ? e.message : String(e) })
  }
}

/**
 * Reserva `amount` del saldo de la comanda. Es LA barrera contra el sobrepago concurrente, para una
 * parte Y para el cobro entero: el saldo disponible se calcula sobre la comanda recién leída
 * (`due − cobrado − reservado`) y se escribe con un UPDATE condicional sobre esos mismos valores.
 * `guard` corre sobre la fila fresca en cada vuelta (cancelada, liquidada, parte en curso… → 409); una
 * edición de líneas en curso (lock) también da 409. `available` lo decide el que llama con la fila fresca (una parte tolera saldo parcial; el cobro
 * entero exige el saldo completo). Devuelve la fila sobre la que se reservó.
 */
export async function reserveBalance(
  deps: OrderCasDeps,
  orderId: string,
  amountOf: (fresh: OrderForCas) => number,
  guard: (fresh: OrderForCas) => void,
): Promise<{ fresh: OrderForCas; amount: number }> {
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    const fresh = await freshForCas(deps, orderId)
    // COR-A: con una edición de líneas en curso el saldo está cambiando: no se reserva nada encima.
    assertLinesUnlocked(fresh)
    guard(fresh)
    const amount = amountOf(fresh)
    if (await casOrder(deps, fresh, { amountReserved: round2(fresh.amountReserved + amount) })) return { fresh, amount }
  }
  throw new ConflictError('No se pudo reservar el saldo de la comanda (hay un cobro en curso); reintentá')
}

/** Suelta una reserva (el cobro no prosperó o venció). Si el CAS no entra en N vueltas, se loguea: el saldo queda reservado de más (nunca de menos). */
export async function releaseBalance(deps: OrderCasDeps, orderId: string, amount: number): Promise<void> {
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    const fresh = await freshForCas(deps, orderId)
    if (await casOrder(deps, fresh, { amountReserved: round2(Math.max(0, fresh.amountReserved - amount)) })) return
  }
  deps.logger?.error('restaurant: no se pudo liberar la reserva de saldo de la comanda', { orderId, amount })
}

/** Saldo de la comanda (lo consumido: neto + impuesto). La propina no forma parte del saldo. */
export const dueOf = (order: Pick<OrderDTO, 'subtotal' | 'tax'>): number => round2(Number(order.subtotal || 0) + Number(order.tax || 0))
