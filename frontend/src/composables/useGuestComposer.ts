// composables/useGuestComposer.ts — Estado + resolución del composer de adultos+niños+edades
// por tarjeta de tipo de habitación (feature 2026-09-02, extendido a Requerimiento 3 2026-09-03).
//
// Compartido entre `RoomsStep.vue` (widget `/book/:slug`) y `BookingModal.vue` (landing
// `/h/:slug`) — las DOS entradas públicas de reserva. Antes vivía duplicado inline en
// RoomsStep.vue; se extrajo acá al migrar BookingModal.vue para que ambas usen EXACTAMENTE la
// misma lógica de composición/cotización/capacidad y no diverjan con el tiempo (un fix en una no
// se olvida en la otra). `useBookingStore()` es un store Pinia singleton, así que ambos
// componentes comparten `childPolicy`/`nights`/`cart` sin necesidad de pasarlos por parámetro.
import { computed, reactive } from 'vue'
import { useBookingStore, MEAL_PLAN_CODES, computeMealPlanTotal, type CartLine } from './useBooking'
import { resolveChildComposition, fitsRoomCapacity, freeChildrenLimitError, classifyAge, type ChildAgeClassification } from '@/utils/child-composition'
import type { MealPlanCode, MealPlanPriceMode, RoomOccupancyRate, RoomTypeRate } from '@/types/booking'

/** MR-03 (#268) — una opción del radio de régimen de una tarjeta. "Solo alojamiento" siempre va
 *  primero y siempre está disponible; los 3 códigos fijos van SIEMPRE (regla del dueño: nunca
 *  ocultar), con `available:false` cuando el hotel no los tiene activos. `total` = importe para
 *  la composición actual de la tarjeta (0 si `included` o no disponible). */
export interface MealPlanOption {
  code: MealPlanCode | 'room_only'
  priceMode: MealPlanPriceMode | null
  unitPrice: number
  total: number
  available: boolean
}

/** Mismo criterio que el `round2` local de `useBooking.ts` (no exportado desde ahí) — evita un
 *  import cruzado solo por esto. Espejo de `shared/utils/money.ts` del backend. */
function round2(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round((n + Number.EPSILON) * 100) / 100
}

interface ComposerState {
  adults: number
  ages: number[]
  // Tarea 22 (Cuna, 2026-09-08), simplificada 2026-09-09 — por TARJETA, igual que adults/ages:
  // cada habitación pide su propia cuna para SU bebé, no la del carrito entero. Sí/No únicamente
  // (el pedido de corrección es explícito: "no preguntar si desea una, dos o más cunas") — no
  // existe una cantidad en el estado, `addComposedRoom` la deriva SIEMPRE en 1/0 al enviar.
  needsCrib: boolean
  // REQ-01 (#233, amenidades para niños y bebés) — ids del catálogo público del hotel
  // (`store.childAmenities`) tildados para ESTA tarjeta, mismo criterio POR HABITACIÓN que la
  // cuna. Opcional y ausente en el estado fresco (se crea recién al primer toggle): el estado
  // inicial sigue siendo exactamente `{adults, ages, needsCrib}`, que es lo que la UI y los
  // tests existentes comparan. Leer siempre vía `childAmenityIds(rt)` / `isChildAmenitySelected`.
  childAmenityIds?: string[]
  // REQ-01 (#290, amenidades de la habitación) — keys del catálogo por tipo
  // (`store.roomAmenitiesFor(rt.id)`) tildadas para ESTA tarjeta. Mismo criterio opcional/ausente
  // que `childAmenityIds`, pero SIN relación con la composición: no se limpian al cambiar edades
  // (una cuna o cama extra se pide para cualquier ocupación). Leer vía `roomAmenityKeys(rt)`.
  roomAmenityKeys?: string[]
  // MR-03 (#268, régimen) — código elegido en el radio de ESTA tarjeta. Mismo criterio opcional/
  // ausente que los anteriores (el estado fresco sigue siendo `{adults, ages, needsCrib}`);
  // ausente = 'room_only'. Se conserva al cambiar adultos/niños — solo cambia el importe. Leer vía
  // `mealPlanCode(rt)`.
  mealPlan?: MealPlanCode | 'room_only'
}

function freshComposerState(): ComposerState {
  return { adults: 1, ages: [], needsCrib: false }
}

export function useGuestComposer() {
  const store = useBookingStore()
  const composerState = reactive<Record<string, ComposerState>>({})

  /** Requerimiento 4 (Edad de los niños, 2026-09-03) — cantidad de `<option>` que debe ofrecer el
   *  desplegable de edad (0..maxChildAge, NO un rango fijo 0-17): si el hotel configuró
   *  maxChildAge=12, no tiene sentido dejar elegir 15 como edad de un "niño" — esa persona es un
   *  adulto (ver `resolveChildComposition`). `v-for="a in maxChildAgeOptions"` con `:value="a-1"`
   *  da exactamente las opciones 0..maxChildAge. */
  const maxChildAgeOptions = computed(() => Math.max(0, Math.floor(store.childPolicy.maxChildAge)) + 1)

  /** Estado del composer de una tarjeta — se crea con 1 adulto / 0 niños la primera vez que se lee. */
  function composer(rt: RoomTypeRate): ComposerState {
    if (!composerState[rt.id]) composerState[rt.id] = freshComposerState()
    return composerState[rt.id]!
  }

  function setAdults(rt: RoomTypeRate, value: number): void {
    composer(rt).adults = Math.max(1, Math.floor(value))
  }

  /** Cambiar la CANTIDAD de niños agrega/quita edades al final del array (default 0 años para la
   *  nueva) — cada una se ajusta después con su propio selector. */
  function setChildrenCount(rt: RoomTypeRate, count: number): void {
    const c = composer(rt)
    const n = Math.max(0, Math.floor(count))
    if (n > c.ages.length) c.ages.push(...Array(n - c.ages.length).fill(0))
    else c.ages.length = n
    syncCribToBabies(rt)
  }

  function setChildAge(rt: RoomTypeRate, index: number, age: number): void {
    const c = composer(rt)
    if (index >= 0 && index < c.ages.length) c.ages[index] = age
    syncCribToBabies(rt)
  }

  /** Tarea 21 — cuántos bebés hay AHORA MISMO en esta composición (subconjunto de "sin plaza"). */
  function babiesCount(rt: RoomTypeRate): number {
    return composition(rt).babies
  }

  /** Tarea 22 — si el último cambio de edad/cantidad de niños dejó la composición sin bebés, la
   *  cuna queda "pedida" para algo que ya no corresponde: se limpia sola, en vez de depender solo
   *  del gateo silencioso al enviar (defensa en profundidad, mismo criterio que el backend). */
  function syncCribToBabies(rt: RoomTypeRate): void {
    const c = composer(rt)
    if (babiesCount(rt) === 0) c.needsCrib = false
    syncChildAmenitiesToChildren(rt)
  }

  /** REQ-01 (#233) — hermana de `syncCribToBabies`: si la composición quedó SIN menores, las
   *  amenidades tildadas ya no corresponden a nadie y se limpian solas (el backend las rechaza
   *  igual sin `childrenAges`; acá se evita que el huésped vea un "+ $X" fantasma). */
  function syncChildAmenitiesToChildren(rt: RoomTypeRate): void {
    const c = composer(rt)
    if (c.ages.length === 0 && c.childAmenityIds && c.childAmenityIds.length > 0) c.childAmenityIds = []
  }

  /** Tarea 21 (Identificar bebés, 2026-09-08) — clasificación EN VIVO de un niño puntual, con la
   *  misma política del hotel y la misma regla (`classifyAge`) que resuelve la composición
   *  agregada. Lo usa el composer para mostrar "Bebé" junto al selector de edad apenas se elige,
   *  sin esperar a agregar la habitación al carrito. */
  function childAgeClassification(rt: RoomTypeRate, index: number): ChildAgeClassification | null {
    const c = composer(rt)
    if (index < 0 || index >= c.ages.length) return null
    return classifyAge(c.ages[index]!, store.childPolicy)
  }

  /** Composición resuelta contra la política del hotel — mismo cálculo que hace el backend al
   *  crear la reserva (utils/child-composition.ts, espejo de shared/usecases/child-composition.ts). */
  function composition(rt: RoomTypeRate) {
    return resolveChildComposition(composer(rt).adults, composer(rt).ages, store.childPolicy)
  }

  /** Tarea 22 (Cuna, 2026-09-08), simplificada 2026-09-09 — ¿corresponde ofrecer "¿Necesita
   *  cuna?" para ESTA tarjeta ahora mismo? Sí solo si hay al menos un bebé en la composición Y el
   *  hotel habilitó la cuna (`childPolicy.cribAvailable`, Página pública → Motor de Reservas). Centralizado acá
   *  para que RoomsStep.vue y BookingModal.vue nunca puedan mostrar la pregunta en un caso y
   *  ocultarla en el otro. */
  function shouldOfferCrib(rt: RoomTypeRate): boolean {
    return store.childPolicy.cribAvailable && babiesCount(rt) > 0
  }

  /** Sí/No — sin cantidad. "No" limpia el estado por si se reactiva sin querer. */
  function setNeedsCrib(rt: RoomTypeRate, value: boolean): void {
    composer(rt).needsCrib = value
  }

  // ─── REQ-01 (#233) — amenidades para niños y bebés, POR TARJETA ─────────────────────────────

  /** Ids tildados en esta tarjeta (siempre un array, aunque el estado todavía no lo tenga). */
  function childAmenityIds(rt: RoomTypeRate): string[] {
    return composer(rt).childAmenityIds ?? []
  }

  /** ¿Corresponde mostrar el checklist de amenidades infantiles en ESTA tarjeta ahora mismo?
   *  Sí solo si el hotel acepta niños, la composición tiene al menos un menor (cualquier edad —
   *  no hace falta que sea bebé: una silla alta es para un niño de 3) Y el hotel publicó al
   *  menos una amenidad activa. Centralizado acá para que RoomsStep.vue y BookingModal.vue no
   *  diverjan (mismo criterio que `shouldOfferCrib`). */
  function shouldOfferChildAmenities(rt: RoomTypeRate): boolean {
    return store.childPolicy.acceptChildren && composer(rt).ages.length > 0 && store.childAmenities.length > 0
  }

  function isChildAmenitySelected(rt: RoomTypeRate, id: string): boolean {
    return childAmenityIds(rt).includes(id)
  }

  /** Tilda/destilda una amenidad del catálogo para esta tarjeta. Ids que no están en el catálogo
   *  se ignoran (nunca se guarda algo que el hotel no ofrece). */
  function toggleChildAmenity(rt: RoomTypeRate, id: string): void {
    if (!store.childAmenities.some((a) => a.id === id)) return
    const c = composer(rt)
    const current = c.childAmenityIds ?? []
    c.childAmenityIds = current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
  }

  /** Σ precio de las amenidades tildadas en esta tarjeta (para el "+ $X" de la tarjeta). Precios
   *  del catálogo en vivo — el snapshot fijo se toma recién al agregar (`store.addToCart`). */
  function composedChildAmenitiesTotal(rt: RoomTypeRate): number {
    const wanted = new Set(childAmenityIds(rt))
    return round2(store.childAmenities.reduce((s, a) => s + (wanted.has(a.id) ? Number(a.price) || 0 : 0), 0))
  }

  // ─── REQ-01 (#290) — amenidades DE la habitación (cuna, cama extra…), POR TARJETA ───────────

  /** Keys tildadas en esta tarjeta (siempre un array, aunque el estado todavía no lo tenga). */
  function roomAmenityKeys(rt: RoomTypeRate): string[] {
    return composer(rt).roomAmenityKeys ?? []
  }

  /** ¿Corresponde mostrar el checklist de amenidades de la habitación en ESTA tarjeta? Sí apenas
   *  el tipo tenga catálogo (alguna habitación del tipo con una amenidad personalizada activa) —
   *  a diferencia de `shouldOfferChildAmenities` NO depende de la composición ni de la política de
   *  niños. Centralizado acá para que RoomsStep.vue y BookingModal.vue no diverjan. */
  function shouldOfferRoomAmenities(rt: RoomTypeRate): boolean {
    return store.roomAmenitiesFor(rt.id).length > 0
  }

  function isRoomAmenitySelected(rt: RoomTypeRate, key: string): boolean {
    return roomAmenityKeys(rt).includes(key)
  }

  /** Tilda/destilda una amenidad del catálogo del tipo para esta tarjeta. Keys que el tipo no
   *  ofrece se ignoran (nunca se guarda algo que el hotel no publicó para ese tipo). */
  function toggleRoomAmenity(rt: RoomTypeRate, key: string): void {
    if (!store.roomAmenitiesFor(rt.id).some((a) => a.key === key)) return
    const c = composer(rt)
    const current = c.roomAmenityKeys ?? []
    c.roomAmenityKeys = current.includes(key) ? current.filter((x) => x !== key) : [...current, key]
  }

  /** Σ precio de las amenidades de habitación tildadas en esta tarjeta (para el "+ $X"). Precios
   *  del catálogo en vivo — el snapshot fijo se toma recién al agregar (`store.addToCart`). */
  function composedRoomAmenitiesTotal(rt: RoomTypeRate): number {
    const wanted = new Set(roomAmenityKeys(rt))
    return round2(store.roomAmenitiesFor(rt.id).reduce((s, a) => s + (wanted.has(a.key) ? Number(a.price) || 0 : 0), 0))
  }

  // ─── MR-03 (#268) — régimen de alimentación, POR TARJETA ────────────────────────────────────

  /** Código elegido en esta tarjeta ('room_only' si todavía no eligió nada). */
  function mealPlanCode(rt: RoomTypeRate): MealPlanCode | 'room_only' {
    return composer(rt).mealPlan ?? 'room_only'
  }

  /** Elige un régimen para esta tarjeta. Un código que el hotel no tiene activo se ignora (la UI
   *  ya lo deshabilita; esto cubre un click programático o un estado viejo). */
  function setMealPlan(rt: RoomTypeRate, code: string): void {
    const option = mealPlanOptions(rt).find((o) => o.code === code)
    if (!option || !option.available) return
    composer(rt).mealPlan = option.code
  }

  /** Personas que pagan régimen en la composición actual = ocupación chargeable (adultos + niños
   *  con plaza) — los niños libres no pagan, mismo criterio que el backend. */
  function mealPlanPersons(rt: RoomTypeRate): number {
    const c = composition(rt)
    return c.effectiveAdults + c.payingChildren
  }

  /** Las opciones del radio de régimen para esta tarjeta, con el importe YA resuelto para la
   *  composición actual (`price × personas × noches`, misma fórmula que el backend). El catálogo
   *  (`store.mealPlans`) trae SOLO los activos del hotel: un código que no está se devuelve igual
   *  con `available:false` para pintarlo deshabilitado — nunca se oculta. */
  function mealPlanOptions(rt: RoomTypeRate): MealPlanOption[] {
    const persons = mealPlanPersons(rt)
    // Mismas noches que usa `store.addToCart` al tomar el snapshot (`store.nights`, de /rates):
    // la tarjeta y el carrito tienen que decir el mismo número.
    const nights = store.nights
    const roomOnly: MealPlanOption = { code: 'room_only', priceMode: null, unitPrice: 0, total: 0, available: true }
    return [roomOnly, ...MEAL_PLAN_CODES.map((code): MealPlanOption => {
      const found = store.mealPlans.find((m) => m.code === code)
      if (!found) return { code, priceMode: null, unitPrice: 0, total: 0, available: false }
      const unitPrice = Number(found.price) || 0
      return {
        code, priceMode: found.priceMode, unitPrice, available: true,
        total: computeMealPlanTotal(found.priceMode, unitPrice, persons, nights),
      }
    })]
  }

  /** Importe del régimen elegido para la composición actual (para el "+ $X" de la tarjeta). 0 con
   *  solo alojamiento, `included` o un código que dejó de estar disponible. */
  function composedMealPlanTotal(rt: RoomTypeRate): number {
    const code = mealPlanCode(rt)
    if (code === 'room_only') return 0
    const option = mealPlanOptions(rt).find((o) => o.code === code)
    return option && option.available ? option.total : 0
  }

  /** Fila de la matriz para la ocupación chargeable actual. `null` = sin matriz (fallback al
   *  `fromPrice` único). Si HAY matriz pero la ocupación pedida excede sus filas, se sintetiza una
   *  fila "no disponible" — nunca se inventa un precio para una ocupación que el hotel no publicó. */
  function matchedRow(rt: RoomTypeRate): RoomOccupancyRate | null {
    const rows = rt.occupancies
    if (!Array.isArray(rows) || rows.length === 0) return null
    const occ = composition(rt).chargeableOccupancy
    return rows.find((o) => o.occupancy === occ) ?? {
      occupancy: occ, price: 0, pricePerNight: 0, available: false, unavailableReason: 'over_capacity', taxBreakdown: [],
    }
  }

  /** Tarea "Cobro % niños" (2026-09-09, generalizada desde "Cobro 50% niños") — precio de la
   *  composición actual CON el descuento infantil opcional Y PORCENTUAL del hotel, o `null` si no
   *  aplica (regla apagada, o sin niños con plaza en esta composición) para que el caller caiga al
   *  precio plano de siempre.
   *
   *  Mismo criterio EXACTO que el backend (`sumStayPriceForComposition` en
   *  `shared/utils/rate-resolution.ts`): "el valor de un adulto" es el precio TOTAL de la estadía
   *  para SOLO los adultos de esta composición — la fila de la matriz que YA trae `/rates` para
   *  `effectiveAdults` (nunca una fila de ocupación=1 inventada, la grilla de este sistema no es
   *  lineal por persona) — dividido entre esa cantidad de adultos. Cada niño con plaza cuesta
   *  `childrenRatePercent`% de eso — NUNCA hardcodeado a 50. Reutiliza la MISMA matriz
   *  `rt.occupancies` que ya usa `matchedRow` — no hace falta ida y vuelta al backend para cotizar
   *  en vivo mientras se compone. */
  function composedPriceWithChildDiscount(rt: RoomTypeRate): number | null {
    const c = composition(rt)
    if (!store.childPolicy.childrenDiscountEnabled || c.payingChildren <= 0) return null
    const rows = rt.occupancies
    if (!Array.isArray(rows) || rows.length === 0) return null
    const adultsRow = rows.find((o) => o.occupancy === c.effectiveAdults)
    if (!adultsRow) return null
    const perAdult = adultsRow.price / Math.max(1, c.effectiveAdults)
    const pct = Math.min(100, Math.max(1, store.childPolicy.childrenRatePercent)) / 100
    return round2(adultsRow.price + c.payingChildren * pct * perAdult)
  }

  function composedPrice(rt: RoomTypeRate): number {
    return composedPriceWithChildDiscount(rt) ?? matchedRow(rt)?.price ?? rt.fromPrice
  }

  function composedPricePerNight(rt: RoomTypeRate): number {
    const discounted = composedPriceWithChildDiscount(rt)
    const n = store.nights > 0 ? store.nights : 1
    if (discounted !== null) return round2(discounted / n)
    const row = matchedRow(rt)
    if (row) return row.pricePerNight
    return rt.fromPrice / n
  }

  /** ¿Se puede agregar esta composición? Capacidad (total + maxAdults/maxChildren si están
   *  configurados) Y, si hay matriz, que la fila resuelta esté vendible. */
  function canAddComposition(rt: RoomTypeRate): boolean {
    const c = composition(rt)
    if (!fitsRoomCapacity({ capacity: rt.capacity, maxAdults: rt.maxAdults, maxChildren: rt.maxChildren }, c)) return false
    // REQ-03 (#235) — tope hotel-wide de niños sin plaza por habitación (null = sin límite).
    if (freeChildrenLimitError(store.childPolicy, c)) return false
    const row = matchedRow(rt)
    return !row || row.available
  }

  /**
   * Requerimiento 6 (Validación de capacidad, 2026-09-03) — MOTIVO por el que `canAddComposition`
   * bloqueó, cuando ese motivo NO viene ya en la fila de la matriz (`matchedRow`).
   *
   * `occupancy-matrix.ts` (backend) solo conoce OCUPACIÓN (un número) — no sabe qué es `maxAdults`
   * ni `maxChildren`, así que una fila puede decir `available:true` con precio real aunque la
   * composición actual exceda el máximo de adultos o de niños del tipo. Sin esto, el botón
   * "Agregar" quedaba apagado con un precio arriba y SIN explicación — la REGLA DEL DUEÑO (nunca
   * ocultar/callar un rechazo) se rompía justo para maxAdults/maxChildren, que quedaron afuera de
   * la matriz original (capacidad total sí es consistente entre las dos: `occupancy-matrix.ts`
   * también marca `over_capacity` cuando `occupancy > capacity`, así que NO se duplica ese motivo
   * acá salvo en el fallback sin matriz, donde `matchedRow` es siempre `null` y nunca lo diría).
   */
  function capacityBlockReason(rt: RoomTypeRate): 'max_adults' | 'max_children' | 'max_free_children' | 'capacity' | null {
    const c = composition(rt)
    if (rt.maxAdults != null && c.effectiveAdults > rt.maxAdults) return 'max_adults'
    if (rt.maxChildren != null && c.payingChildren > rt.maxChildren) return 'max_children'
    // REQ-03 (#235) — los niños sin plaza no entran en la matriz ni en capacity: motivo propio.
    if (freeChildrenLimitError(store.childPolicy, c)) return 'max_free_children'
    const rows = rt.occupancies
    if ((!Array.isArray(rows) || rows.length === 0) && c.chargeableOccupancy > rt.capacity) return 'capacity'
    return null
  }

  async function addComposedRoom(rt: RoomTypeRate): Promise<void> {
    if (!canAddComposition(rt)) return
    const c = composer(rt)
    // Tarea 22 — mismo gateo que el backend (defensa en profundidad EN LOS DOS LADOS): sin bebé
    // en la composición final, o sin que el hotel haya habilitado la cuna, no se manda nada, sin
    // importar qué haya quedado tildado. Sí/No únicamente: `cribCount` es siempre 1 o 0, nunca
    // una cantidad elegida por el huésped.
    const needsCrib = shouldOfferCrib(rt) && c.needsCrib
    // REQ-01 (#233) — mismo gateo: sin menores en la composición, sin catálogo o con el hotel
    // sin aceptar niños, no viaja ninguna amenidad aunque haya quedado algo tildado.
    const childAmenityIdsToSend = shouldOfferChildAmenities(rt) ? [...childAmenityIds(rt)] : []
    // REQ-01 (#290) — sin gateo por composición: viaja lo tildado (el store descarta keys que el
    // tipo ya no ofrezca).
    const roomAmenityKeysToSend = shouldOfferRoomAmenities(rt) ? [...roomAmenityKeys(rt)] : []
    // MR-03 (#268) — si el código elegido ya no está activo (catálogo cambiado entre medio), viaja
    // 'room_only': nunca se agrega una línea con un régimen que el backend rechazaría.
    const chosenMealPlan = mealPlanCode(rt)
    const mealPlanToSend = mealPlanOptions(rt).find((o) => o.code === chosenMealPlan)?.available ? chosenMealPlan : 'room_only'
    await store.addToCart(rt, {
      adults: c.adults, childrenAges: [...c.ages],
      needsCrib, cribCount: needsCrib ? 1 : 0,
      ...(childAmenityIdsToSend.length > 0 ? { childAmenityIds: childAmenityIdsToSend } : {}),
      ...(roomAmenityKeysToSend.length > 0 ? { roomAmenityKeys: roomAmenityKeysToSend } : {}),
      ...(mealPlanToSend !== 'room_only' ? { mealPlan: mealPlanToSend } : {}),
    })
    // Reset: la próxima habitación (misma tarjeta u otra) arranca de nuevo en 1 adulto/0 niños.
    composerState[rt.id] = freshComposerState()
  }

  /**
   * REQ-02 (#234) — "al regresar a editar la habitación, recuperar los mismos datos": el botón
   * Editar de una línea del carrito devuelve UNA unidad de esa línea al composer de SU tarjeta,
   * precargado con exactamente los adultos, edades, cuna y amenidades que se guardaron al agregar
   * (`ages` y `childAmenityIds` se copian — la línea que sigue en el carrito, si tenía `quantity`
   * > 1, no comparte arrays con el composer). Solo se toca `composerState[rt.id]` de esa tarjeta
   * y esa línea (vía `store.removeCartLineUnit`, que descuenta una unidad o quita la línea si era
   * la última): las OTRAS líneas y las OTRAS tarjetas quedan como estaban — nunca se mezclan los
   * datos de una habitación con los de otra.
   *
   * Devuelve `false` sin tocar nada si el tipo ya no está en `ratesResponse` (cotización vieja) o
   * si la línea es del flujo legacy de ocupación plana (sin `adults`/`childrenAges`): no hay
   * composición que recuperar. `childAmenityIds` y `roomAmenityKeys` (#290: cama extra, cuna…) se
   * omiten cuando están vacíos para que el estado siga siendo exactamente `{adults, ages, needsCrib}`
   * (mismo criterio que `freshComposerState`).
   */
  function editCartLine(line: CartLine): boolean {
    const rt = (store.ratesResponse?.roomTypes ?? []).find((r) => r.id === line.roomType)
    if (!rt || line.adults === undefined || line.childrenAges === undefined) return false
    const ids = (line.childAmenities ?? []).map((a) => a.id)
    const keys = (line.roomAmenities ?? []).map((a) => a.key)
    composerState[rt.id] = {
      adults: line.adults,
      ages: [...line.childrenAges],
      needsCrib: !!line.needsCrib,
      ...(ids.length > 0 ? { childAmenityIds: ids } : {}),
      ...(keys.length > 0 ? { roomAmenityKeys: keys } : {}),
    }
    store.removeCartLineUnit(line.key)
    return true
  }

  return {
    composer, setAdults, setChildrenCount, setChildAge,
    composition, matchedRow, composedPrice, composedPricePerNight,
    canAddComposition, addComposedRoom, maxChildAgeOptions, capacityBlockReason,
    childAgeClassification, babiesCount, shouldOfferCrib, setNeedsCrib,
    // REQ-01 (#233)
    childAmenityIds, shouldOfferChildAmenities, isChildAmenitySelected, toggleChildAmenity,
    composedChildAmenitiesTotal,
    // REQ-02 (#234)
    editCartLine,
    // REQ-01 (#290)
    roomAmenityKeys, shouldOfferRoomAmenities, isRoomAmenitySelected, toggleRoomAmenity,
    composedRoomAmenitiesTotal,
    // MR-03 (#268) — régimen por habitación.
    mealPlanCode, setMealPlan, mealPlanOptions, composedMealPlanTotal,
  }
}
