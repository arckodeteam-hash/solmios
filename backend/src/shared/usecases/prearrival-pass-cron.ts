// shared/usecases/prearrival-pass-cron.ts — Manda el pase + código de acceso 24 h antes.
//
// Por qué (pedido del cliente, 2026-08-29): antes el correo con el NÚMERO DE HABITACIÓN y el
// código de la puerta salía al confirmarse el pago. Pero la habitación puede reasignarse hasta
// el día antes de la llegada, así que ese número llegaba sin estar firme. Ahora al pagar va la
// confirmación de pago (`booking-paid-email.ts`, sin habitación ni código) y este cron manda el
// pase cuando la llegada ya está a menos de 24 h.
//
// #262 (REQ-HAC-07): con HAC-01 la reserva puede llegar a la víspera SIN habitación, y sin
// habitación no hay fila en `wallet_passes` — la pasada sobre pases no la veía. Ahora hay una
// pasada B sobre reservas confirmadas sin `roomId`: si el hotel configuró
// `booking_config.autoAssignBeforeArrivalHours` (> 0) y ya se entró en ese plazo, se auto-asigna
// la sugerida (`reservas.autoAssignRoom`) y va el pase COMPLETO; si no, el PARCIAL ("Por asignar").
//
// Molde: trial-reminder-cron.ts. Dedup con `wallet_passes.emailSentAt` — sin esa marca el cron
// reenviaría el mismo correo en cada tick. El parcial dedupea solo (persiste fila con lockCode '').
//
// `now` inyectable para poder fijar la fecha en los tests sin tocar el reloj global.

import { reservationAccessWindow } from '../utils/hotel-schedule'

const MS_PER_HOUR = 60 * 60 * 1000
const MS_PER_DAY = 24 * MS_PER_HOUR

/** Ventana de disparo: la llegada está a <= 24 h. */
export const PREARRIVAL_WINDOW_HOURS = 24

/**
 * Estados a los que SÍ se les manda el código. Lista blanca a propósito: cualquier estado
 * nuevo queda fuera por default, en vez de colarse por no estar en una lista negra.
 * `pending` (sin pagar) está excluida — el código de la puerta no se entrega sin cobro.
 */
const DELIVERABLE_STATUS: ReadonlySet<string> = new Set(['confirmed', 'checked_in'])

export interface PrearrivalCronResult {
  sent: number
  skipped: number
  /** Reservas a las que este tick les asignó habitación automáticamente (#262). */
  assigned: number
}

export function createPrearrivalPassCron(
  orm: any,
  resolveModule: (name: string) => any,
  logger: any,
): (now?: Date) => Promise<PrearrivalCronResult> {
  return async (now: Date = new Date()): Promise<PrearrivalCronResult> => {
    const result: PrearrivalCronResult = { sent: 0, skipped: 0, assigned: 0 }
    try {
      const wallet = resolveModule('wallet-pass')
      if (!wallet || typeof wallet.sendPassEmailNow !== 'function') {
        logger.warn('prearrival-pass-cron: módulo wallet-pass no disponible')
        return result
      }

      // ── Pasada A: pases ya generados (reserva CON habitación y código) ──────────────────
      // Solo las que todavía no recibieron el aviso. Un pase obsoleto (habitación reasignada)
      // se saltea: el flujo de reasignación genera uno nuevo, y mandar el viejo daría un código
      // que ya no abre.
      const passes = (await orm.findMany('WalletPasses', {})) as any[]
      for (const pass of passes) {
        if (pass.emailSentAt || pass.obsoleteAt) { result.skipped++; continue }
        // lockCode '' = pase PARCIAL ya mandado (#262): no hay código que entregar. Cuando se
        // asigne la habitación, generatePass lo completa y limpia emailSentAt; recién ahí entra.
        if (!pass.lockCode) { result.skipped++; continue }

        // @ignore IDOR_RISK — el reservationId sale de la propia fila del pase (dato del
        // sistema, no de un request): el cron recorre TODOS los pases pendientes de aviso.
        const reservation = await orm.findById('Reservations', pass.reservationId)
        if (!reservation || !reservation.checkIn) { result.skipped++; continue }

        // Solo reservas VIGENTES y ya comprometidas. Lista blanca, no negra: una `pending`
        // (reservada pero sin pagar) NO puede recibir el código de la puerta — sería dar acceso
        // a la habitación a alguien que todavía no pagó. Cancelada o ya salida tampoco.
        if (!DELIVERABLE_STATUS.has(String(reservation.status ?? ''))) {
          result.skipped++
          continue
        }

        // Todavía falta: se manda en un tick posterior. Ya pasó la llegada: igual se manda —
        // el huésped que llega necesita su código, y sin esto una caída del cron lo dejaría
        // sin nada. Por eso el corte es solo por arriba.
        const hoursLeft = await hoursToArrival(orm, reservation, now)
        if (!(hoursLeft <= PREARRIVAL_WINDOW_HOURS)) { result.skipped++; continue }

        const ok = await wallet.sendPassEmailNow(pass.reservationId)
        if (ok) {
          await orm.update('WalletPasses', pass.id, { emailSentAt: now.toISOString() })
          result.sent++
        } else {
          result.skipped++
        }
      }

      // ── Pasada B (#262): reservas confirmadas SIN habitación ──────────────────────────
      // checkIn se guarda 'YYYY-MM-DD' y findMany filtra por igualdad: una consulta por día.
      // La ventana ancha absorbe la diferencia UTC/zona del hotel; el corte real es por hoursLeft.
      const autoAssignCache = new Map<string, number>()
      for (const checkIn of dayWindow(now)) {
        const reservations = ((await orm.findMany('Reservations', { status: 'confirmed', checkIn })) ?? []) as any[]
        for (const reservation of reservations) {
          if (reservation.roomId) continue
          const hoursLeft = await hoursToArrival(orm, reservation, now)
          if (!(hoursLeft <= PREARRIVAL_WINDOW_HOURS)) { result.skipped++; continue }
          await deliverUnassigned({ orm, resolveModule, logger, wallet, now, autoAssignCache }, reservation, hoursLeft, result)
        }
      }

      if (result.sent > 0 || result.assigned > 0) logger.info('prearrival-pass-cron', result)
      return result
    } catch (e) {
      logger.error('prearrival-pass-cron falló', { error: (e as Error).message })
      return result
    }
  }
}

interface UnassignedCtx {
  orm: any
  resolveModule: (name: string) => any
  logger: any
  wallet: any
  now: Date
  autoAssignCache: Map<string, number>
}

/**
 * Reserva sin habitación dentro de la ventana: intenta auto-asignar (si el hotel lo configuró y
 * ya toca) y mandar el pase completo; si no, manda el parcial. Nunca tira: un fallo de la
 * auto-asignación se loguea y se cae al parcial, para que el huésped reciba algo igual.
 */
async function deliverUnassigned(ctx: UnassignedCtx, reservation: any, hoursLeft: number, result: PrearrivalCronResult): Promise<void> {
  const { orm, logger, wallet, now } = ctx
  const reservationId = String(reservation.id)
  const hotelId = String(reservation.hotelId ?? '')

  const autoAssignHours = await autoAssignHoursFor(ctx, hotelId)
  if (autoAssignHours > 0 && hoursLeft <= autoAssignHours) {
    try {
      const reservas = ctx.resolveModule('reservas')
      const outcome = typeof reservas?.autoAssignRoom === 'function'
        ? await reservas.autoAssignRoom(reservationId, hotelId)
        : { assigned: false, reason: 'module_unavailable' }
      if (outcome?.assigned) {
        result.assigned++
        logger.info('prearrival-pass-cron: habitación asignada automáticamente', { reservationId, roomId: outcome.roomId })
        // El connector reservas-ttlock generó el código y reservas-wallet dejó la fila con
        // lockCode. Si no hay lockCode (ttlock apagado) no hay pase completo: va el parcial.
        const rows = ((await orm.findMany('WalletPasses', { reservationId })) ?? []) as any[]
        const pass = rows.find((p) => !p.obsoleteAt)
        if (pass?.lockCode && await wallet.sendPassEmailNow(reservationId)) {
          await orm.update('WalletPasses', pass.id, { emailSentAt: now.toISOString() })
          result.sent++
          return
        }
      } else {
        logger.warn('prearrival-pass-cron: sin habitaciones libres para asignar', { reservationId, hotelId, reason: outcome?.reason })
      }
    } catch (e) {
      logger.warn('prearrival-pass-cron: autoAssignRoom falló', { reservationId, hotelId, error: (e as Error).message })
    }
  }

  // Pase parcial ("Por asignar", sin código). false = ya se mandó antes o sin email.
  const sentPartial = typeof wallet.sendPartialPassEmailNow === 'function'
    ? await wallet.sendPartialPassEmailNow(reservationId)
    : false
  if (sentPartial) result.sent++
  else result.skipped++
}

/** `booking_config.autoAssignBeforeArrivalHours` del hotel (entero > 0; 0 = apagado). Cache por corrida. */
async function autoAssignHoursFor(ctx: UnassignedCtx, hotelId: string): Promise<number> {
  const cached = ctx.autoAssignCache.get(hotelId)
  if (cached !== undefined) return cached
  const rows = ((await ctx.orm.findMany('BookingConfig', { hotelId })) ?? []) as any[]
  const raw = Number(rows[0]?.autoAssignBeforeArrivalHours)
  const hours = Number.isInteger(raw) && raw > 0 ? raw : 0
  ctx.autoAssignCache.set(hotelId, hours)
  return hours
}

/** Días UTC (YYYY-MM-DD) [hoy-1 .. hoy+2] cuyas llegadas pueden estar a <= 24 h en la zona del hotel. */
export function dayWindow(now: Date): string[] {
  const days: string[] = []
  for (let offset = -1; offset <= 2; offset++) {
    days.push(new Date(now.getTime() + offset * MS_PER_DAY).toISOString().slice(0, 10))
  }
  return days
}

/** Horas hasta la llegada real en la zona del hotel (NaN si no se puede calcular) — el MISMO
 *  criterio con el que se abre el código de la cerradura, así aviso y acceso no se calculan
 *  de dos maneras. */
async function hoursToArrival(orm: any, reservation: any, now: Date): Promise<number> {
  if (!reservation?.checkIn) return NaN
  const hotel = await orm.findById('Hotels', reservation.hotelId)
  const arrivalMs = reservationAccessWindow(reservation, hotel).startMs
  return Number.isFinite(arrivalMs) ? (arrivalMs - now.getTime()) / MS_PER_HOUR : NaN
}
