// utils/child-composition.ts — feature "adultos+niños+edades" (2026-09-02).
// Tarea 21 (Identificar bebés en la reserva pública, 2026-09-08) — sub-clasificación "bebé".
//
// Espejo EXACTO de `backend/src/shared/usecases/child-composition.ts` — misma fórmula, para que
// el widget pueda mostrar precio/capacidad en vivo mientras el huésped ajusta adultos/niños/
// edades, sin ida y vuelta al backend por cada cambio (el backend vuelve a calcular esto mismo al
// crear la reserva — este archivo es solo para la UI, no la autoridad final).
export interface ChildPolicy {
  acceptChildren: boolean
  /** Hasta esta edad (inclusive) se considera "niño". Mayor → adulto. */
  maxChildAge: number
  /** Hasta esta edad (inclusive) el niño no consume plaza (no se cobra, no cuenta para capacidad). */
  maxFreeAge: number
  /** Hasta esta edad (inclusive) el niño se clasifica como BEBÉ (Tarea 21) — subconjunto de "no
   *  consume plaza": `0 ≤ maxBabyAge ≤ maxFreeAge`. Mismo comportamiento de precio/capacidad que un
   *  niño libre, solo cambia la etiqueta mostrada. */
  maxBabyAge: number
  /** Tarea "Cobro % niños" (2026-09-09, generalizada desde "Cobro 50% niños") — si está
   *  habilitado, cada niño con plaza (nunca bebés ni niños libres) se cobra a `childrenRatePercent`%
   *  del "valor de un adulto" de la reserva. Ver el mismo campo en el espejo backend
   *  (`shared/usecases/child-composition.ts`) para la fórmula exacta. */
  childrenDiscountEnabled: boolean
  /** Porcentaje (1-100) del "valor de un adulto" que paga cada niño con plaza, SOLO cuando
   *  `childrenDiscountEnabled` está prendido. Nunca hardcodeado — cada hotel elige el suyo. */
  childrenRatePercent: number
  /** REQ-03 (#235) — máximo de niños que NO consumen plaza (bebés incluidos) por habitación.
   *  `null`/ausente = SIN LÍMITE (nunca un default numérico). Hotel-wide, se aplica a CADA
   *  habitación de la reserva — ver `freeChildrenLimitError`. */
  maxFreeChildrenPerRoom?: number | null
}

export const DEFAULT_CHILD_POLICY: ChildPolicy = {
  acceptChildren: true, maxChildAge: 17, maxFreeAge: 0, maxBabyAge: 0,
  childrenDiscountEnabled: false, childrenRatePercent: 50,
  maxFreeChildrenPerRoom: null,
}

export interface ChildComposition {
  effectiveAdults: number
  payingChildren: number
  /** Niños que NO consumen plaza — incluye a los bebés (`babies` es subconjunto, no aparte). */
  freeChildren: number
  /** Tarea 21 — cuántos de `freeChildren` son específicamente BEBÉS. Informativo/de despliegue. */
  babies: number
  chargeableOccupancy: number
}

export type ChildAgeClassification = 'baby' | 'free' | 'paying' | 'adult'

/** Misma regla que `classifyAge` del backend — la usa `resolveChildComposition` de acá abajo y la
 *  UI (composer) para mostrar la etiqueta "Bebé" por-niño en vivo. */
export function classifyAge(age: number, policy: ChildPolicy): ChildAgeClassification {
  if (age > policy.maxChildAge) return 'adult'
  if (age <= policy.maxBabyAge) return 'baby'
  if (age <= policy.maxFreeAge) return 'free'
  return 'paying'
}

export function resolveChildComposition(adults: number, childrenAges: readonly number[], policy: ChildPolicy): ChildComposition {
  let effectiveAdults = Math.max(1, Math.floor(Number(adults)) || 0)
  let payingChildren = 0
  let freeChildren = 0
  let babies = 0
  for (const raw of childrenAges) {
    const age = Number(raw)
    if (!Number.isFinite(age) || age < 0) continue
    const c = classifyAge(age, policy)
    if (c === 'adult') effectiveAdults += 1
    else if (c === 'baby') { freeChildren += 1; babies += 1 }
    else if (c === 'free') freeChildren += 1
    else payingChildren += 1
  }
  return { effectiveAdults, payingChildren, freeChildren, babies, chargeableOccupancy: effectiveAdults + payingChildren }
}

export function fitsRoomCapacity(
  room: { capacity: number; maxAdults?: number | null; maxChildren?: number | null },
  composition: ChildComposition,
): boolean {
  if (composition.chargeableOccupancy > room.capacity) return false
  if (room.maxAdults != null && composition.effectiveAdults > room.maxAdults) return false
  if (room.maxChildren != null && composition.payingChildren > room.maxChildren) return false
  return true
}

/** REQ-03 (#235) — espejo de `freeChildrenLimitError` del backend: motivo por el que una
 *  composición supera el máximo de niños sin plaza del hotel, o `null` si entra (o si el hotel no
 *  configuró límite). Separado de `fitsRoomCapacity` a propósito: los `freeChildren` siguen sin
 *  contar para `capacity`/`maxChildren` — es un tope distinto, con su propio mensaje. */
export function freeChildrenLimitError(
  policy: Pick<ChildPolicy, 'maxFreeChildrenPerRoom'>,
  composition: Pick<ChildComposition, 'freeChildren'>,
): string | null {
  const max = policy.maxFreeChildrenPerRoom
  if (max == null) return null
  if (composition.freeChildren <= max) return null
  return `Esta habitación admite hasta ${max} niño(s) que no consumen plaza; la reserva tiene ${composition.freeChildren}`
}
