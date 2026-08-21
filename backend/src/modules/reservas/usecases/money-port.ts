// reservas/usecases/money-port.ts — Puerto de LECTURA del dinero de una reserva.
//
// Regla del proyecto (CLAUDE.md, "NUNCA import de otro módulo directo → connector en
// src/connectors/"; la misma que `usecases/message-log.ts` escribe textual): un módulo no lee las
// tablas de otro. `usecases/reservas-queries.ts` lo violaba justo en el camino del dinero — su
// getter `paidRepos` hacía `orm.findMany('Folios'|'Invoices'|'Payment')`, tres tablas de tres
// módulos ajenos, con el mismo ORM crudo que el resto del repo saca por conector.
//
// Ahora la lectura la hacen los DUEÑOS (`folios`, `facturas`, `payments`) y el connector
// `reservas-money` inyecta este puerto. `reservas` sigue sin saber cómo se llaman esas tablas.
//
// Fail-closed a propósito (`requireMoneyPort`): sin el puerto no se puede saber cuánto se cobró, y
// devolver 0 en silencio es exactamente el bug GH-0.2 — el saldo sale inflado y el techo de
// `payment-requests` autoriza recobrar plata ya cobrada.

import type { ReservationPaidRepos } from '../../../shared/usecases/reservation-paid'
// Una sola definición de "referencia a una fila de dinero": la del usecase que la consume.
import type { MoneyRowRef } from './sync-pending-after-payment'

export type { MoneyRowRef }

/** Lo que `reservas` necesita de los módulos dueños del dinero. Lo cablea `connectors/reservas-money`. */
export interface ReservationMoneyPort {
  /** Folios de la reserva (módulo `folios`). */
  folios(hotelId: string, reservationId: string): Promise<Record<string, any>[]>
  /** Facturas de la reserva (módulo `facturas`). */
  invoices(hotelId: string, reservationId: string): Promise<Record<string, any>[]>
  /** Filas de `payments` que cuelgan de UNO de los vínculos (módulo `payments`). */
  payments(hotelId: string, ref: MoneyRowRef): Promise<Record<string, any>[]>
  /** Reserva dueña de un movimiento de dinero — camino inverso (COR-1). */
  reservationIdOf(hotelId: string, ref: MoneyRowRef): Promise<string | null>
}

/** Sin puerto no hay número honesto de "lo cobrado": se rompe fuerte en vez de devolver 0. */
export function requireMoneyPort(port: ReservationMoneyPort | undefined | null): ReservationMoneyPort {
  if (!port) throw new Error('reservas: falta el puerto de dinero (connectors/reservas-money no cableado)')
  return port
}

/**
 * Adapta el puerto a la forma `RepositoryAdapter` que espera `shared/usecases/reservation-paid`.
 * El `hotelId` viaja SIEMPRE en el `where` (multi-tenancy) y se exige acá igual que antes: el
 * `reservationId` puede venir de un payload, y sin hotel se leerían filas de todos los hoteles.
 */
export function paidReposFrom(port: ReservationMoneyPort): ReservationPaidRepos {
  const need = (where: any, what: string): string => {
    if (!where?.hotelId) throw new Error(`reservas-money: lectura de ${what} sin hotelId (multi-tenancy)`)
    return String(where.hotelId)
  }
  // `async` a propósito: un `findMany` de repo devuelve promesa SIEMPRE, también cuando el caller
  // se equivocó. Si tirara sincrónico, un `.catch()` del caller no lo vería.
  // `ReservationMoneyWhere` en vez de `any` (MED-12): el WHERE del repo es un diccionario de
  // filtros con ids string; tiparlo cierra el agujero sin pelear con el adaptador del framework.
  type ReservationMoneyWhere = { hotelId?: unknown; reservationId?: unknown; folioId?: unknown; invoiceId?: unknown }
  const where = (w: unknown): ReservationMoneyWhere => (w ?? {}) as ReservationMoneyWhere
  return {
    folioRepo: { findMany: async (w: unknown) => port.folios(need(w, 'folios'), String(where(w).reservationId ?? '')) },
    invoiceRepo: { findMany: async (w: unknown) => port.invoices(need(w, 'facturas'), String(where(w).reservationId ?? '')) },
    paymentRepo: { findMany: async (w: unknown) => port.payments(need(w, 'payments'), where(w) as MoneyRowRef) },
  } as ReservationPaidRepos
}

/** Lo que cada módulo dueño aporta al puerto. Lo resuelve `connectors/reservas-money`. */
export interface MoneyOwners {
  folios: {
    foliosOfReservation(hotelId: string, reservationId: string): Promise<Record<string, any>[]>
    reservationIdOfFolio(hotelId: string, folioId: string): Promise<string | null>
  }
  facturas: {
    invoicesOfReservation(hotelId: string, reservationId: string): Promise<Record<string, any>[]>
    reservationIdOfInvoice(hotelId: string, invoiceId: string): Promise<string | null>
  }
  payments: {
    paymentsLinkedTo(hotelId: string, ref: MoneyRowRef): Promise<Record<string, any>[]>
  }
}

/**
 * Arma el puerto a partir de los tres módulos dueños. Vive en un usecase y no en el connector
 * porque un connector sólo wirea (regla de acoplamiento del analyzer): el orden en que se prueban
 * los vínculos del camino inverso es una decisión, no cableado.
 *
 * Camino inverso (COR-1): gana el vínculo DIRECTO — es el único que tiene la fila del cobro de una
 * reprogramación, que no cuelga de folio ni de factura (BUG-ceiling-bypass).
 */
export function buildReservationMoneyPort(owners: MoneyOwners): ReservationMoneyPort {
  return {
    folios: (hotelId, reservationId) => owners.folios.foliosOfReservation(hotelId, reservationId),
    invoices: (hotelId, reservationId) => owners.facturas.invoicesOfReservation(hotelId, reservationId),
    payments: (hotelId, ref) => owners.payments.paymentsLinkedTo(hotelId, ref),
    reservationIdOf: async (hotelId, ref) => {
      if (!hotelId) return null
      if (ref?.reservationId) return String(ref.reservationId)
      if (ref?.folioId) {
        const rid = await owners.folios.reservationIdOfFolio(hotelId, String(ref.folioId))
        if (rid) return rid
      }
      if (ref?.invoiceId) return owners.facturas.reservationIdOfInvoice(hotelId, String(ref.invoiceId))
      return null
    },
  }
}
