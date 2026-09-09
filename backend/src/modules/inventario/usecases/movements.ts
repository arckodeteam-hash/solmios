// inventario/usecases/movements.ts — Ledger de stock (INV-2). ÚNICA vía para mover existencias.
// Idempotente: (source,sourceId) no se aplica dos veces (una recepción suma una vez, una venta resta una
// vez). Valuación = costo promedio ponderado, recalculado en cada entrada con costo. `balanceAfter` deja
// el rastro auditable. currentStock del ítem es el balance materializado.
import type { RepositoryAdapter, Auth } from 'arckode-framework'
import { NotFoundError, ValidationError } from 'arckode-framework'
import type { InventoryItemDTO, StockMovementDTO, MovementType, CurrentUser } from '../types'
import { isUniqueViolation } from '../../../shared/utils/db-errors'

export interface MovementDeps {
  items: RepositoryAdapter<InventoryItemDTO>
  movements: RepositoryAdapter<StockMovementDTO>
  userRepo: RepositoryAdapter<any>
  auth: Auth
}

export interface ApplyMovementInput {
  itemId: string
  type: MovementType
  quantity: number
  unitCost?: number
  reason?: string
  source?: string
  sourceId?: string
}

const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100
const round4 = (n: number): number => Math.round((Number(n) || 0) * 10000) / 10000

/**
 * Aplica un movimiento de stock y devuelve el ítem actualizado. Valida ownership (findById + assertOwnership
 * inline). Idempotente por (source,sourceId): si ya existe un movimiento con esa clave, NO reaplica.
 */
export async function applyMovement(deps: MovementDeps, input: ApplyMovementInput, user: CurrentUser): Promise<InventoryItemDTO> {
  const hotelId = hotelOf(user)
  if (!input.itemId) throw new ValidationError('itemId requerido')
  const qty = Number(input.quantity)
  if (!Number.isFinite(qty) || qty < 0) throw new ValidationError('La cantidad debe ser ≥ 0')

  // QA-M1: validar unitCost ANTES de usarlo (applyExternalMovement entra directo desde conectores, sin
  // validateSchema). Distinguir "no informado" (undefined) de "0" para el promedio (QA-M2).
  const hasCost = input.unitCost !== undefined && input.unitCost !== null
  const unitCost = Number(input.unitCost) || 0
  if (hasCost && (!Number.isFinite(unitCost) || unitCost < 0)) throw new ValidationError('El costo unitario debe ser un número ≥ 0')

  const item = await deps.items.findById(input.itemId)
  if (!item) throw new NotFoundError('Insumo no encontrado')
  const me = await deps.userRepo.findById(user.id)
  const ownerHotel = (me as any)?.hotelId ?? ''
  deps.auth.assertOwnership(item.hotelId, ownerHotel, user.role, 'super_admin')

  // Idempotencia (fast-path): mismo (source,sourceId) → devolver el ítem tal cual (ya se aplicó).
  // La garantía dura está en el UNIQUE INDEX (hotelId,source,sourceId): el create de abajo la respeta.
  if (input.source && input.sourceId) {
    const dup = await deps.movements.findMany({ hotelId: item.hotelId, source: input.source, sourceId: input.sourceId })
    if (dup.length > 0) return item
  }

  const cur = Number(item.currentStock) || 0
  const curAvg = Number(item.avgCost) || 0
  let newStock: number
  let newAvg = curAvg

  if (input.type === 'in') {
    newStock = round4(cur + qty)
    // Costo promedio ponderado. QA-A1: el tramo NEGATIVO del stock no aporta costo (base = max(cur,0)),
    // si no, un stock oversold contamina el promedio (podía dar avgCost negativo o inflado). Con cur<=0
    // colapsa a newAvg = unitCost (base de costo fresca), que es lo correcto. Solo si vino unitCost (M2).
    if (hasCost && qty > 0) {
      const base = cur > 0 ? cur : 0
      newAvg = round4((base * curAvg + qty * unitCost) / (base + qty))
    }
  } else if (input.type === 'out') {
    // Se permite quedar en negativo (no bloqueamos una venta por descuadre de stock); queda como señal.
    newStock = round4(cur - qty)
  } else if (input.type === 'adjust') {
    // adjust FIJA el stock al valor absoluto `quantity` (conteo físico). No toca el costo promedio.
    newStock = round4(qty)
  } else {
    throw new ValidationError(`Tipo de movimiento inválido: ${input.type}`)
  }

  // QA-A3: el create es el gate de idempotencia. El UNIQUE INDEX (hotelId,source,sourceId) hace que una
  // carrera con el mismo sourceId falle acá; lo tratamos como no-op idempotente (releemos y devolvemos).
  try {
    await deps.movements.create({
      hotelId: item.hotelId,       // QA-BAJO: hotelId del recurso (DB), no del JWT
      itemId: input.itemId,
      type: input.type,
      quantity: round4(qty),
      unitCost: round4(unitCost),
      reason: input.reason,
      source: input.source || 'manual',
      sourceId: input.sourceId,
      balanceAfter: newStock,
    } as Omit<StockMovementDTO, 'id'>)
  } catch (e: unknown) {
    if (input.source && input.sourceId && isUniqueViolation(e)) {
      const fresh = await deps.items.findById(input.itemId)
      return (fresh as InventoryItemDTO) ?? item
    }
    throw e
  }

  const updated = await deps.items.update(input.itemId, {
    currentStock: newStock,
    avgCost: round4(newAvg),
  } as Partial<Omit<InventoryItemDTO, 'id'>>)
  if (!updated) throw new NotFoundError('Insumo no encontrado')
  return updated
}

/** Historial de movimientos de un ítem (más reciente primero). Valida ownership. */
export async function listMovements(deps: MovementDeps, itemId: string, user: CurrentUser): Promise<{ data: StockMovementDTO[]; total: number }> {
  const hotelId = hotelOf(user)
  const item = await deps.items.findById(itemId)
  if (!item) throw new NotFoundError('Insumo no encontrado')
  const me = await deps.userRepo.findById(user.id)
  deps.auth.assertOwnership(item.hotelId, (me as any)?.hotelId ?? '', user.role, 'super_admin')
  const data = (await deps.movements.findMany({ hotelId, itemId })) as StockMovementDTO[]
  data.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
  return { data, total: data.length }
}

/**
 * Lista movimientos por `source` para un hotel (sin ownership check: es query interna de conectores
 * de sistema — p.ej. el conector restaurante→inventario la usa para hallar los `out` pos_sale a
 * revertir en un refund). NO expone datos cross-hotel: el hotelId lo aporta el conector desde la
 * comanda (ownership ya validado por el módulo restaurant).
 */
export async function listMovementsBySource(deps: MovementDeps, hotelId: string, source: string): Promise<StockMovementDTO[]> {
  return (await deps.movements.findMany({ hotelId, source })) as StockMovementDTO[]
}

/** Valuación total del inventario del hotel: Σ currentStock × avgCost. */
export function valuation(items: InventoryItemDTO[]): number {
  return round2(items.reduce((acc, i) => acc + (Number(i.currentStock) || 0) * (Number(i.avgCost) || 0), 0))
}

function hotelOf(user: CurrentUser): string {
  const h = user.hotelId || ''
  if (!h) throw new ValidationError('Sin hotel asignado')
  return h
}
