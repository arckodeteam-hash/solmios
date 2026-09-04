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
import { useBookingStore } from './useBooking'
import { resolveChildComposition, fitsRoomCapacity } from '@/utils/child-composition'
import type { RoomOccupancyRate, RoomTypeRate } from '@/types/booking'

interface ComposerState { adults: number; ages: number[] }

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
    if (!composerState[rt.id]) composerState[rt.id] = { adults: 1, ages: [] }
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
  }

  function setChildAge(rt: RoomTypeRate, index: number, age: number): void {
    const c = composer(rt)
    if (index >= 0 && index < c.ages.length) c.ages[index] = age
  }

  /** Composición resuelta contra la política del hotel — mismo cálculo que hace el backend al
   *  crear la reserva (utils/child-composition.ts, espejo de shared/usecases/child-composition.ts). */
  function composition(rt: RoomTypeRate) {
    return resolveChildComposition(composer(rt).adults, composer(rt).ages, store.childPolicy)
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

  function composedPrice(rt: RoomTypeRate): number {
    return matchedRow(rt)?.price ?? rt.fromPrice
  }

  function composedPricePerNight(rt: RoomTypeRate): number {
    const row = matchedRow(rt)
    if (row) return row.pricePerNight
    const n = store.nights > 0 ? store.nights : 1
    return rt.fromPrice / n
  }

  /** ¿Se puede agregar esta composición? Capacidad (total + maxAdults/maxChildren si están
   *  configurados) Y, si hay matriz, que la fila resuelta esté vendible. */
  function canAddComposition(rt: RoomTypeRate): boolean {
    const c = composition(rt)
    if (!fitsRoomCapacity({ capacity: rt.capacity, maxAdults: rt.maxAdults, maxChildren: rt.maxChildren }, c)) return false
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
  function capacityBlockReason(rt: RoomTypeRate): 'max_adults' | 'max_children' | 'capacity' | null {
    const c = composition(rt)
    if (rt.maxAdults != null && c.effectiveAdults > rt.maxAdults) return 'max_adults'
    if (rt.maxChildren != null && c.payingChildren > rt.maxChildren) return 'max_children'
    const rows = rt.occupancies
    if ((!Array.isArray(rows) || rows.length === 0) && c.chargeableOccupancy > rt.capacity) return 'capacity'
    return null
  }

  async function addComposedRoom(rt: RoomTypeRate): Promise<void> {
    if (!canAddComposition(rt)) return
    const c = composer(rt)
    await store.addToCart(rt, { adults: c.adults, childrenAges: [...c.ages] })
    // Reset: la próxima habitación (misma tarjeta u otra) arranca de nuevo en 1 adulto/0 niños.
    composerState[rt.id] = { adults: 1, ages: [] }
  }

  return {
    composer, setAdults, setChildrenCount, setChildAge,
    composition, matchedRow, composedPrice, composedPricePerNight,
    canAddComposition, addComposedRoom, maxChildAgeOptions, capacityBlockReason,
  }
}
