// shared/usecases/child-composition.ts — feature "adultos+niños+edades" (2026-09-02).
//
// Reemplaza el modelo "Para N" (ocupación total fija) por adultos + edades de niños declaradas
// por el huésped. Cada hotel define su propia política en Configuration(hotelId, key:
// 'child_policy') — mismo patrón que 'taxes'/'email_config' (ver hoteles/usecases/config-kv.ts).
//
// Reglas (según el pedido, sin fecha de nacimiento — la edad la declara el huésped tal cual):
//   - edad > maxChildAge          → se trata como adulto (ocupa plaza, cuenta para precio y capacidad)
//   - maxFreeAge < edad ≤ maxChildAge → niño que consume plaza (cuenta para precio y capacidad,
//                                        mismo criterio que un adulto más)
//   - 0 ≤ edad ≤ maxFreeAge       → niño que NO consume plaza (no genera cargo, no cuenta para
//                                    ningún límite de capacidad — ver ejemplo del pedido)
import type { RepositoryAdapter } from 'arckode-framework'

export interface ChildPolicy {
  acceptChildren: boolean
  /** Hasta esta edad (inclusive) se considera "niño". Mayor → adulto. */
  maxChildAge: number
  /** Hasta esta edad (inclusive) el niño no consume plaza (no se cobra, no cuenta para capacidad). */
  maxFreeAge: number
}

/** Default para hoteles que todavía no configuraron su política — mismo comportamiento que
 *  tenían antes de este feature (todo niño cuenta como ocupante, nada es gratis). */
export const DEFAULT_CHILD_POLICY: ChildPolicy = { acceptChildren: true, maxChildAge: 17, maxFreeAge: 0 }

export interface ChildComposition {
  /** Adultos declarados + niños que superaron `maxChildAge` (se tratan como adulto). */
  effectiveAdults: number
  /** Niños que consumen plaza (edad en `(maxFreeAge, maxChildAge]`). */
  payingChildren: number
  /** Niños que NO consumen plaza — informativos, no suman a ningún cargo ni límite. */
  freeChildren: number
  /** `effectiveAdults + payingChildren` — la cifra real a cotizar Y a validar contra capacidad
   *  (mismo número que antes representaba "Para N", ahora derivado en vez de elegido a mano). */
  chargeableOccupancy: number
}

export type ChildAgeClassification = 'free' | 'paying' | 'adult'

/** La ÚNICA regla que decide el balde de una edad — la usan `resolveChildComposition` (agregados)
 *  y `describeChildrenAges` (desglose para Administración, Requerimiento 13) por igual, para que
 *  nunca puedan divergir en qué cuenta como qué. */
export function classifyAge(age: number, policy: ChildPolicy): ChildAgeClassification {
  if (age > policy.maxChildAge) return 'adult'
  if (age <= policy.maxFreeAge) return 'free'
  return 'paying'
}

/** Edades basura (negativas, no numéricas) se ignoran en vez de reventar la reserva — un huésped
 *  no debería perder toda la reserva por un valor mal tipeado que ya pasó otras validaciones. */
export function resolveChildComposition(adults: number, childrenAges: readonly unknown[], policy: ChildPolicy): ChildComposition {
  let effectiveAdults = Math.max(1, Math.floor(Number(adults)) || 0)
  let payingChildren = 0
  let freeChildren = 0
  for (const raw of childrenAges) {
    const age = Number(raw)
    if (!Number.isFinite(age) || age < 0) continue
    const c = classifyAge(age, policy)
    if (c === 'adult') effectiveAdults += 1
    else if (c === 'free') freeChildren += 1
    else payingChildren += 1
  }
  return { effectiveAdults, payingChildren, freeChildren, chargeableOccupancy: effectiveAdults + payingChildren }
}

/**
 * Auditoría de integridad (cierre, 2026-09-04) — composición CONSERVADORA para validar capacidad
 * cuando `childrenAges` puede faltar: la Administración manual (`reservas/usecases/crud.ts`) y los
 * agentes de IA (`ai-gerente`, `ai-recepcionista`) no piden edad por niño — decisión de producto
 * explícita (el panel se mantiene sin el composer completo de edades, ver
 * `validators/schema.ts` y `ReservationWizardModal.vue`).
 *
 * Sin edades declaradas, `resolveChildComposition(adults, [], policy)` (la usa
 * `composeFromPersistedReservation` para reagendar/repreciar) devuelve `chargeableOccupancy:
 * adults` — el conteo de `children` queda AFUERA de la cuenta a propósito, documentado desde antes
 * de esta feature (ver `reschedule-pricing.test.ts`, "children plano nunca se sumó"). Usar ESE
 * criterio para decidir si una reserva ENTRA en una habitación asumiría que todo niño sin edad
 * conocida está libre — dejaría pasar sobre-ocupación real en silencio, exactamente lo que esta
 * validación existe para evitar.
 *
 * Acá se asume lo CONTRARIO a propósito: cada niño declarado (el conteo `children`, sin edades)
 * CONSUME PLAZA — nunca se asume libre. Conservador, explícito, documentado; no es una tercera
 * regla de clasificación (no compara contra `maxFreeAge`/`maxChildAge`, que necesitan una edad
 * real) — es una DEGRADACIÓN de "no sé la edad" a "asumo el caso que más ocupa", coherente con la
 * capacidad real del cuarto en el peor caso.
 *
 * Con `childrenAges` presente (un caller que SÍ las tiene, aunque sea el panel) se usa la
 * composición real vía `resolveChildComposition` — nunca dos criterios distintos si el dato existe.
 */
export function resolveAdminCapacityComposition(
  adults: number,
  children: number,
  childrenAges: readonly unknown[] | null | undefined,
  policy: ChildPolicy,
): ChildComposition {
  if (Array.isArray(childrenAges) && childrenAges.length > 0) {
    return resolveChildComposition(adults, childrenAges, policy)
  }
  const effectiveAdults = Math.max(1, Math.floor(Number(adults)) || 0)
  const payingChildren = Math.max(0, Math.floor(Number(children)) || 0)
  return { effectiveAdults, payingChildren, freeChildren: 0, chargeableOccupancy: effectiveAdults + payingChildren }
}

/** ¿Esta composición entra en la habitación? `capacity` es el total de plazas (siempre presente);
 *  `maxAdults`/`maxChildren` son opcionales (NULL = sin configurar → solo se valida `capacity`,
 *  ningún hotel existente ve cambiar su comportamiento hasta que los configure). */
export function fitsRoomCapacity(
  room: { capacity: number; maxAdults?: number | null; maxChildren?: number | null },
  composition: ChildComposition,
): boolean {
  if (composition.chargeableOccupancy > room.capacity) return false
  if (room.maxAdults != null && composition.effectiveAdults > room.maxAdults) return false
  if (room.maxChildren != null && composition.payingChildren > room.maxChildren) return false
  return true
}

const MS_PER_DAY = 86_400_000
/** Días por año calendario, PROMEDIO (incluye años bisiestos) — la misma constante que usan los
 *  calendarios astronómicos para este tipo de cuenta aproximada. */
const DAYS_PER_YEAR = 365.25

/**
 * Requerimiento 12 (Edad de referencia, 2026-09-03) — proyecta una edad declarada "a partir de"
 * `asOfDate` a la edad que correspondería en `targetDate`. Aproximación por AÑO CALENDARIO
 * completo: sin el mes de nacimiento (el pedido fue explícito en no pedirlo — solo un número), no
 * se puede saber el día exacto del cumpleaños, así que se usa `Math.floor` (conservador: la edad
 * NO sube hasta que haya pasado un año COMPLETO, nunca antes). Mover una reserva de enero a
 * diciembre del MISMO año no cambia la edad — moverla a un check-in un año o más después, sí.
 *
 * `asOfDate` ausente/inválida → devuelve `age` tal cual (reserva vieja sin ancla temporal, o
 * caller que no tiene fecha destino: se degrada al comportamiento de siempre, sin proyectar).
 */
export function projectAge(age: number, asOfDate: string | null | undefined, targetDate: string | null | undefined): number {
  if (!asOfDate || !targetDate) return age
  const asOf = new Date(asOfDate)
  const target = new Date(targetDate)
  if (Number.isNaN(asOf.getTime()) || Number.isNaN(target.getTime())) return age
  const daysElapsed = (target.getTime() - asOf.getTime()) / MS_PER_DAY
  const yearsElapsed = Math.floor(daysElapsed / DAYS_PER_YEAR)
  return Math.max(0, age + yearsElapsed)
}

/** `projectAge` aplicada a cada edad del array. Edades basura (no numéricas) se dejan pasar tal
 *  cual — el mismo `resolveChildComposition` de abajo ya las ignora al clasificar. */
export function projectChildrenAges(ages: readonly unknown[], asOfDate: string | null | undefined, targetDate: string | null | undefined): number[] {
  return ages.map((raw) => {
    const age = Number(raw)
    return Number.isFinite(age) ? projectAge(age, asOfDate, targetDate) : raw
  }) as number[]
}

/**
 * Recupera los ADULTOS TAL CUAL LOS TIPEÓ el huésped (antes de que la reclasificación por edad
 * los infle) a partir de campos YA PERSISTIDOS — sin esto no se puede recomponer la reserva desde
 * cero con edades proyectadas: `resolveChildComposition` necesita el `adults` CRUDO, no el
 * `effectiveAdults` de una corrida anterior (sumarle de nuevo la gente ya reclasificada la
 * contaría dos veces).
 *
 * Es recuperable EXACTO sin guardar nada nuevo: `childrenAges.length − children` es, por
 * construcción de `resolveChildComposition` (cada edad cae en EXACTAMENTE un balde: libre, con
 * plaza, o reclasificada), la cantidad de gente que la reserva ORIGINAL reclasificó como adulto.
 * Restarla de `adults` (persistido, ya inflado) da el crudo.
 */
export function recoverRawAdults(reservation: { adults?: unknown; children?: unknown; childrenAges?: unknown }): number {
  const adults = Math.max(1, Math.floor(Number(reservation.adults)) || 1)
  const children = Math.max(0, Math.floor(Number(reservation.children)) || 0)
  const ages = Array.isArray(reservation.childrenAges) ? reservation.childrenAges : []
  const reclassifiedAtCreation = Math.max(0, ages.length - children)
  return Math.max(1, adults - reclassifiedAtCreation)
}

/**
 * Reconstruye una `ChildComposition` SEGURA a partir de una reserva YA PERSISTIDA — la usan
 * `reprice.ts` (Requerimiento 7) y la revalidación de capacidad al reagendar (Requerimiento 12):
 * cualquier lugar que necesite volver a evaluar una reserva EXISTENTE contra una política
 * (posiblemente distinta a la del momento de la reserva) o una habitación destino.
 *
 * Sin `targetCheckIn` (o sin `childrenAgesAsOf` en la reserva — dato ausente en reservas
 * anteriores a este campo): NO se proyecta nada, se re-deriva `payingChildren`/`freeChildren`
 * desde `childrenAges` tal cual (con un `adults` descartable, nunca se usa el `effectiveAdults`
 * de ese llamado) y se combinan con el `adults` YA asentado de la reserva — exactamente el
 * comportamiento previo al Requerimiento 12, ningún caller se rompe.
 *
 * CON `targetCheckIn` y `childrenAgesAsOf`: se recupera el `adults` crudo (`recoverRawAdults`),
 * se proyectan las edades a `targetCheckIn` (`projectChildrenAges`) y se recompone TODO desde
 * cero con `resolveChildComposition` — esto SÍ puede reclasificar a alguien que cruzó
 * `maxFreeAge`/`maxChildAge` por el paso del tiempo, no solo por un cambio de política.
 */
export function composeFromPersistedReservation(
  reservation: { adults?: unknown; children?: unknown; childrenAges?: unknown; childrenAgesAsOf?: unknown },
  policy: ChildPolicy,
  targetCheckIn?: string | null,
): ChildComposition {
  const ages = Array.isArray(reservation.childrenAges) ? reservation.childrenAges : []
  const asOf = typeof reservation.childrenAgesAsOf === 'string' ? reservation.childrenAgesAsOf : null

  if (ages.length > 0 && targetCheckIn && asOf) {
    const rawAdults = recoverRawAdults(reservation)
    const projectedAges = projectChildrenAges(ages, asOf, targetCheckIn)
    return resolveChildComposition(rawAdults, projectedAges, policy)
  }

  const adults = Math.max(1, Math.floor(Number(reservation.adults)) || 1)
  if (ages.length === 0) return { effectiveAdults: adults, payingChildren: 0, freeChildren: 0, chargeableOccupancy: adults }
  const fromAges = resolveChildComposition(1, ages, policy)
  return {
    effectiveAdults: adults,
    payingChildren: fromAges.payingChildren,
    freeChildren: fromAges.freeChildren,
    chargeableOccupancy: adults + fromAges.payingChildren,
  }
}

export interface ChildAgeDescription {
  /** La edad TAL CUAL la declaró el huésped — nunca cambia, es la auditoría de lo tipeado. */
  declaredAge: number
  /** La edad que corresponde HOY al check-in de la reserva — igual a `declaredAge` salvo que la
   *  reserva tenga `childrenAgesAsOf` y se haya reagendado cruzando uno o más años (Requerimiento
   *  12). Es la que decide `classification`. */
  effectiveAge: number
  classification: ChildAgeClassification
}

/**
 * Requerimiento 13 (Administración | Composición de huéspedes, 2026-09-03) — desglose POR NIÑO
 * para el panel: qué edad declaró, qué edad corresponde hoy (proyectada si aplica) y en qué balde
 * cae — para poder mostrar "cuáles fueron reclasificados como adultos por edad", no solo "alguno
 * lo fue". Usa `classifyAge` (la MISMA regla que agrega `resolveChildComposition`) y `projectAge`
 * (la MISMA proyección que usa `composeFromPersistedReservation` al reagendar) — nada nuevo, solo
 * expone por-ítem lo que esas dos funciones ya calculan agregado.
 *
 * `reservation.childrenAgesAsOf`/`checkIn` ausentes (reserva legacy) → `effectiveAge` cae a
 * `declaredAge` sin proyectar (mismo criterio de degradación que el resto del Requerimiento 12).
 */
export function describeChildrenAges(
  reservation: { childrenAges?: unknown; childrenAgesAsOf?: unknown; checkIn?: unknown },
  policy: ChildPolicy,
): ChildAgeDescription[] {
  const ages = Array.isArray(reservation.childrenAges) ? reservation.childrenAges : []
  const asOf = typeof reservation.childrenAgesAsOf === 'string' ? reservation.childrenAgesAsOf : null
  const targetCheckIn = typeof reservation.checkIn === 'string' ? reservation.checkIn : null
  const out: ChildAgeDescription[] = []
  for (const raw of ages) {
    const declaredAge = Number(raw)
    if (!Number.isFinite(declaredAge) || declaredAge < 0) continue
    const effectiveAge = projectAge(declaredAge, asOf, targetCheckIn)
    out.push({ declaredAge, effectiveAge, classification: classifyAge(effectiveAge, policy) })
  }
  return out
}

/** Lee `configuration(hotelId, key:'child_policy')` — sin fallback a 'platform' (a diferencia de
 *  `taxes`/`google_maps`): la política de niños es una decisión comercial de CADA hotel, no algo
 *  razonable de heredar de la plataforma. Sin fila → `DEFAULT_CHILD_POLICY`. */
export async function resolveChildPolicy(
  configRepo: RepositoryAdapter<any> | undefined,
  hotelId: string,
): Promise<ChildPolicy> {
  if (!configRepo) return DEFAULT_CHILD_POLICY
  try {
    const row = await configRepo.findOne({ hotelId, key: 'child_policy' } as Record<string, unknown>)
    if (!row?.value) return DEFAULT_CHILD_POLICY
    const raw = (typeof row.value === 'string' ? JSON.parse(row.value) : row.value) as Partial<ChildPolicy>
    const maxChildAge = Number(raw.maxChildAge)
    const maxFreeAge = Number(raw.maxFreeAge)
    return {
      acceptChildren: raw.acceptChildren !== false,
      maxChildAge: Number.isFinite(maxChildAge) && maxChildAge >= 0 ? maxChildAge : DEFAULT_CHILD_POLICY.maxChildAge,
      maxFreeAge: Number.isFinite(maxFreeAge) && maxFreeAge >= 0 ? maxFreeAge : DEFAULT_CHILD_POLICY.maxFreeAge,
    }
  } catch {
    return DEFAULT_CHILD_POLICY
  }
}
