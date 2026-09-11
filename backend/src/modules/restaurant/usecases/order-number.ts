// restaurant/usecases/order-number.ts — Número correlativo de comanda por hotel (RES-3).
//
// Contador en configuration(key='restaurant_order_counter_{hotelId}_{year}'). #206: antes era un
// read-modify-write (findOne → update) que el comentario llamaba "atómico" y no lo era: dos tablets
// abriendo comanda a la vez leían el mismo valor y salían dos `CMD-2026-0007`.
//
// Cómo se arbitra ahora (mismo esquema que promo-codes/usecases/promo-atomic.ts, PC-1):
//  1. CAS — `UPDATE configuration SET value = next WHERE id = ? AND value = leído` vía `orm.updateMany`
//     (OrmRepository no expone UPDATE condicional). Si `affected = 0`, otro ganó la vuelta y se relee.
//     Esto sirve en ambos motores: Postgres READ COMMITTED toma el lock de fila y re-evalúa el WHERE,
//     SQLite serializa las escrituras. Una `orm.transaction` alrededor de un read-modify-write NO
//     alcanza (dos sesiones PG leen el mismo valor igual) y en SqliteAdapter dos transacciones
//     concurrentes se pisan el BEGIN — por eso se eligió el UPDATE condicional y no la transacción.
//  2. UNIQUE (hotelId, number) en restaurant_orders (`idx_restaurant_orders_hotel_number`,
//     migrate-db.ts) como garantía dura: si igual chocan, el `create` del perdedor falla y `openOrder`
//     reintenta pidiendo un número mayor (`minSeq`), igual que facturas/usecases/create-invoice.ts.
//
// Se eliminó el fallback `CMD-{year}-{Date.now()}` ante cualquier excepción: rompía el formato de 4
// dígitos, dejaba un agujero en la secuencia sin avisar y escondía la base rota. Sin contador, no
// hay comanda (misma decisión que invoice-number.ts).
import type { RepositoryAdapter } from 'arckode-framework'
import { ConflictError } from 'arckode-framework'
import { isUniqueViolation } from '../../../shared/utils/db-errors'

/**
 * UPDATE condicional del framework (`ORM.updateMany`). Lo define el módulo (no es el tipo `ORM`)
 * para que el service dependa de esta interface mínima y no del ORM concreto; `index.ts` pasa el
 * `orm` real, que la satisface estructuralmente.
 */
export interface CounterCas {
  updateMany(model: string, filters: Record<string, unknown>, changes: Record<string, unknown>): Promise<number>
}

export interface OrderNumberDeps {
  config: RepositoryAdapter<any>
  /** Opcional: sin CAS (tests viejos) el contador degrada a read-modify-write y la unicidad la
   *  garantiza solo el índice + reintento de `openOrder`. En producción SIEMPRE está cableado. */
  counterCas?: CounterCas
}

/** Vueltas del CAS antes de rendirse: cada vuelta perdida = otra comanda que se abrió en el medio. */
const CAS_ATTEMPTS = 50

export function orderCounterKey(hotelId: string, year: number): string {
  return `restaurant_order_counter_${hotelId}_${year}`
}

export function formatOrderNumber(year: number, seq: number): string {
  return `CMD-${year}-${seq.toString().padStart(4, '0')}`
}

/**
 * Reserva el próximo correlativo del hotel y devuelve número + secuencia.
 *
 * @param minSeq Piso para el reintento tras una violación de UNIQUE: fuerza una secuencia
 *               estrictamente mayor a la que colisionó.
 * @throws ConflictError si el CAS pierde CAS_ATTEMPTS vueltas seguidas; errores del repo se propagan.
 */
export async function nextOrderNumber(deps: OrderNumberDeps, hotelId: string, minSeq = 0): Promise<{ number: string; seq: number }> {
  const year = new Date().getFullYear()
  const key = orderCounterKey(hotelId, year)
  const now = () => new Date().toISOString()

  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    const counter = await deps.config.findOne({ key, hotelId })

    if (!counter) {
      const seq = Math.max(0, minSeq) + 1
      try {
        await deps.config.create({
          key, hotelId, value: seq,
          description: `Restaurant order counter ${year}`,
          createdAt: now(), updatedAt: now(),
        } as any)
        return { number: formatOrderNumber(year, seq), seq }
      } catch (e) {
        // Otra apertura creó la fila primero (UNIQUE idx_configuration_hotel_key): releer y competir.
        if (!isUniqueViolation(e)) throw e
        continue
      }
    }

    const current = Number(counter.value) || 0
    const seq = Math.max(current, minSeq) + 1

    if (deps.counterCas && counter.value !== null && counter.value !== undefined) {
      const affected = await deps.counterCas.updateMany('Configuration', { id: counter.id, value: counter.value }, { value: seq })
      if (Number(affected) === 0) continue   // alguien avanzó el contador en el medio: releer
    } else {
      await deps.config.update(counter.id, { value: seq } as any)
    }
    return { number: formatOrderNumber(year, seq), seq }
  }

  throw new ConflictError('No se pudo reservar un número de comanda; volvé a intentar')
}
