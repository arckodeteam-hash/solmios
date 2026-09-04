// utils/child-composition.ts — feature "adultos+niños+edades" (2026-09-02).
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
}

export const DEFAULT_CHILD_POLICY: ChildPolicy = { acceptChildren: true, maxChildAge: 17, maxFreeAge: 0 }

export interface ChildComposition {
  effectiveAdults: number
  payingChildren: number
  freeChildren: number
  chargeableOccupancy: number
}

export function resolveChildComposition(adults: number, childrenAges: readonly number[], policy: ChildPolicy): ChildComposition {
  let effectiveAdults = Math.max(1, Math.floor(Number(adults)) || 0)
  let payingChildren = 0
  let freeChildren = 0
  for (const raw of childrenAges) {
    const age = Number(raw)
    if (!Number.isFinite(age) || age < 0) continue
    if (age > policy.maxChildAge) effectiveAdults += 1
    else if (age <= policy.maxFreeAge) freeChildren += 1
    else payingChildren += 1
  }
  return { effectiveAdults, payingChildren, freeChildren, chargeableOccupancy: effectiveAdults + payingChildren }
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
