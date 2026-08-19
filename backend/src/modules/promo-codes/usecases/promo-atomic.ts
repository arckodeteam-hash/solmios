// promo-codes/usecases/promo-atomic.ts — Consumo/liberación ATÓMICA de usos (CAS).
//
// PC-1 (auditoría 2026-08-19): `incrementUsesByCode` era un read-modify-write incondicional —
// dos flujos concurrentes leían uses=0 y ambos persistían (un single-use podía canjearse dos
// veces: staff valida → huésped canjea por el widget → staff crea e incrementa sin re-chequear
// maxUses). El flujo público ya lo resolvía con un UPDATE condicional dentro de su transacción
// (bookingengine/usecases/public-booking.ts, "B2 fix — Optimistic locking"); este usecase
// replica esa mecánica para los flujos STAFF y agrega la liberación por cancelación (PC-5).
//
// ⚠ Excepción documentada a "usecases usan OrmRepository, no el ORM": OrmRepository NO expone
// `updateMany`, y el optimistic lock `WHERE id = ? AND uses = ?` es la única forma portable de
// UPDATE condicional sobre un campo no-id. Misma excepción que reservas/usecases/checkin.ts
// con orm.transaction. El orm lo cablea el index del módulo vía `service.setAtomicOrm(orm)`.
import { ConflictError } from 'arckode-framework'

/** Normaliza igual que promo-validate/promo-crud: trim + UPPERCASE. */
function normalize(code: string): string {
  return String(code ?? '').trim().toUpperCase()
}

/**
 * Consume UN uso del código con optimistic lock. Debe llamarse ANTES de persistir la reserva
 * que lo aplica: si el código se agotó (o alguien más lo consumió en la ventana), lanza
 * ConflictError y la reserva NO se crea — nunca queda una reserva con un descuento que el
 * código ya no respalda.
 *
 * No-op si el código no existe (se borró entre validate y consume — la reserva sigue, mismo
 * criterio histórico del flujo público con `promoRecord` null).
 */
export async function consumeUse(orm: any, hotelId: string, code: string): Promise<void> {
  const normalized = normalize(code)
  if (!normalized || !hotelId) return
  const found = await orm.findOne('PromoCodes', { hotelId, code: normalized })
  if (!found) return
  const freshUses = Number(found.uses ?? 0)
  const maxUses = found.maxUses
  if (typeof maxUses === 'number' && Number.isFinite(maxUses) && freshUses >= maxUses) {
    throw new ConflictError(`Código promocional agotado (${normalized})`)
  }
  // CAS: solo incrementa si `uses` sigue siendo lo que leímos. affected=0 → otra reserva
  // concurrente ganó el uso en la ventana → agotado para esta. En Postgres READ COMMITTED el
  // UPDATE toma el lock de fila y serializa a los dos consumidores; en SQLite WAL las tx son
  // seriales. Misma mecánica que public-booking.ts:490-503.
  const affected = await orm.updateMany('PromoCodes', { id: found.id, uses: freshUses }, { uses: freshUses + 1 })
  if (Number(affected) === 0) {
    throw new ConflictError(`Código promocional agotado (${normalized})`)
  }
}

/**
 * Devuelve UN uso del código (PC-5): cancelación de la reserva que lo consumió, o fallo al
 * persistir esa reserva (compensación). Sin esto, un canje de puntos CRM sobre una reserva
 * que después se cancela dejaba el código quemado y los puntos perdidos.
 *
 * Best-effort: floor 0 y sin throw si pierde la carrera — la cancelación de una reserva NUNCA
 * debe fallar por el contador de un promo (mismo fail-soft que el release de depósitos en
 * connectors/reservas-deposits.ts). Si el admin ajustó `uses` a mano en el medio, el CAS
 * respeta su valor.
 */
export async function releaseUse(orm: any, hotelId: string, code: string): Promise<void> {
  const normalized = normalize(code)
  if (!normalized || !hotelId) return
  const found = await orm.findOne('PromoCodes', { hotelId, code: normalized })
  if (!found) return
  const freshUses = Number(found.uses ?? 0)
  if (freshUses <= 0) return
  await orm.updateMany('PromoCodes', { id: found.id, uses: freshUses }, { uses: freshUses - 1 }).catch(() => 0)
}
