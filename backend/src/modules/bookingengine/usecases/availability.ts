// bookingengine/usecases/availability.ts — Qué puede reservar un cliente.
//
// La disponibilidad se calcula con las habitaciones REALES del hotel menos las
// que ya están reservadas en esas fechas.
//
// Antes se leía de un modelo legacy de stock diario que ningún proceso llenaba:
// tenía 0 filas en toda la base. Como estaba vacía, el motor respondía "no hay
// habitaciones" SIEMPRE — un hotel con 54 habitaciones libres rechazaba a todos
// los clientes que intentaban reservar por la web, y nadie se enteraba porque
// el endpoint devolvía 200.
//
// F4 4.2 — Modelo legacy BORRADO: ni el repo ni el modelo se referencian acá.
// Si algún día el inventario lo maneja el channel manager, se reintroduce como
// fuente; mientras tanto la verdad son las habitaciones y las reservas.
//
// FIX — `room_blocks` + `room_rates.closed`: el motor vendía lo que el hotel ya había cerrado.
// La disponibilidad se calculaba como `rooms − reservations` y NUNCA consultaba la tabla
// `room_blocks`, ni miraba el stop-sell de la tarifa. El push ARI a Channex sí los respetaba
// (`canales/usecases/availability.ts`) y `/calendar` también, así que una habitación bloqueada
// por mantenimiento quedaba CERRADA en Booking/Airbnb y ABIERTA en la web propia del hotel.
// Las dos reglas viven en `usecases/stay-restrictions.ts`, compartidas con `public-booking.ts`
// (lo que el motor no ofrece, el POST tampoco lo acepta).
import type { RepositoryAdapter, CacheAdapter } from 'arckode-framework'
import { ValidationError } from 'arckode-framework'
import type { AvailabilityQuery, AvailabilityResult, RoomTypeAvailability } from '../types'
import { blockedRoomIds, isClosedForOccupancy, stayNights } from './stay-restrictions'
import { baseRatesOnly, buildSeasonByDate } from './rate-resolution'
import { MAX_OCCUPANCY_ROWS } from './occupancy-matrix'
import { isRoomSellable } from '../../../shared/usecases/room-status'

const MS_PER_DAY = 1000 * 60 * 60 * 24
const CACHE_TTL_SECONDS = 60

/** Reservas que ocupan la habitación. Una cancelada libera la fecha. */
const BLOCKING_RESERVATION_STATUS = new Set(['confirmed', 'checked_in', 'pending', 'guaranteed'])

export class AvailabilityUseCase {
  constructor(
    private readonly cache: CacheAdapter,
    private readonly roomsRepo?: RepositoryAdapter<any>,
    private readonly reservationsRepo?: RepositoryAdapter<any>,
    private readonly hotelsRepo?: RepositoryAdapter<any>,
    /**
     * Bloqueos de habitación (`room_blocks`) + temporada por fecha + tarifas — los tres modelos
     * COMPARTIDOS (`shared/models.ts`), los mismos que ya usa `/calendar`. Van al final para no
     * correr las posiciones existentes, y son opcionales: sin cablear, el usecase degrada al
     * comportamiento previo (sin bloqueos ni stop-sell) y los tests/callers viejos siguen
     * funcionando. En producción los cablea `index.ts` vía `BookingengineService`.
     *
     * Nota: NO se atrapan errores de lectura (a diferencia de `readSeasonPricing` en
     * `public-rates.ts`). Fallar acá cierra la venta; tragarse el error la ABRE de más, que es
     * exactamente el bug que este código arregla. Mismo criterio que `/calendar`, que tampoco
     * atrapa.
     */
    private readonly roomBlocksRepo?: RepositoryAdapter<any>,
    private readonly seasonAssignmentsRepo?: RepositoryAdapter<any>,
    private readonly roomRatesRepo?: RepositoryAdapter<any>,
  ) {}

  async check(query: AvailabilityQuery): Promise<AvailabilityResult> {
    const nights = this.calculateNights(query.checkIn, query.checkOut)
    if (nights <= 0) throw new ValidationError('checkOut must be after checkIn')

    // TTL corto: dos personas mirando las mismas fechas no pueden ver stock que
    // ya se vendió hace cinco minutos.
    //
    // La clave sigue siendo CORRECTA al sumar `room_blocks` y `room_rates`: identifica la
    // CONSULTA (hotel + rango + huéspedes), no los datos. Todas sus fuentes —rooms, reservas,
    // bloqueos y tarifas— comparten la misma cota de staleness de 60s: bloquear una habitación
    // se ve como máximo 60s después, igual que venderla. Meter bloqueos/tarifas en la clave no
    // cambiaría ningún resultado, solo bajaría el hit-rate. Y no hace falta invalidar: el
    // `CacheAdapter` solo borra claves EXACTAS (no hay glob ni prefijo), así que un
    // `delete('availability:*')` no borraría nada; si algún día hiciera falta invalidar en el
    // acto, la salida es un token de versión como `facturas/usecases/cache.ts`.
    const adults = query.adults ?? 2
    const cacheKey = `availability:${query.hotelId}:${query.checkIn}:${query.checkOut}:${adults}`
    const cached = await this.cache.get<AvailabilityResult>(cacheKey)
    if (cached) return cached

    const [rooms, reservations, hotel, blocks, assignments, rates] = await Promise.all([
      this.roomsRepo?.findMany({ hotelId: query.hotelId }) ?? Promise.resolve([]),
      this.reservationsRepo?.findMany({ hotelId: query.hotelId }) ?? Promise.resolve([]),
      // Ruta PÚBLICA: no hay sesión que validar contra el hotel, el cliente
      // consulta el hotel que está mirando. Se usa `findOne` porque el analyzer
      // exige ownership en todo `findById`, y acá no hay dueño que verificar.
      this.hotelsRepo?.findOne({ id: query.hotelId }).catch(() => null) ?? Promise.resolve(null),
      this.roomBlocksRepo?.findMany({ hotelId: query.hotelId }) ?? Promise.resolve([]),
      this.seasonAssignmentsRepo?.findMany({ hotelId: query.hotelId }) ?? Promise.resolve([]),
      this.roomRatesRepo?.findMany({ hotelId: query.hotelId }) ?? Promise.resolve([]),
    ])

    // Noches reales de la estadía — las mismas celdas que pinta `/calendar` para este rango.
    const nightDates = stayNights(query.checkIn, query.checkOut)
    const occupied = this.occupiedIn(reservations as any[], query.checkIn, query.checkOut)
    const blocked = blockedRoomIds(blocks as any[], nightDates)
    // Stop-sell POR OCUPACIÓN, no por tipo: un hotel puede cerrar la tarifa "para 4" de un mes y
    // dejar abierta la de "para 2". `closedRoomTypes` (que resolvía una sola vez, con el `adults`
    // consultado) borraba el tipo entero en ese caso — ver el comentario de `aggregate`.
    const baseRates = baseRatesOnly(rates as any[])
    const seasonByDate = buildSeasonByDate(assignments as any[])
    const isClosedFor = (roomType: string, occupancy: number): boolean =>
      isClosedForOccupancy(baseRates, seasonByDate, roomType, nightDates, occupancy)
    const roomTypes = this.aggregate(rooms as any[], occupied, blocked, isClosedFor, adults)

    const result: AvailabilityResult = {
      hotelId: query.hotelId,
      // Viajaba vacío: la página pública mostraba el título en blanco.
      hotelName: (hotel as any)?.name ?? '',
      checkIn: query.checkIn,
      checkOut: query.checkOut,
      nights,
      roomTypes,
    }

    await this.cache.set(cacheKey, result, CACHE_TTL_SECONDS)
    return result
  }

  /**
   * Habitaciones ocupadas en el rango pedido.
   *
   * Dos estadías se pisan cuando una empieza antes de que la otra termine. El
   * día de salida NO cuenta: quien se va el 10 libera esa noche para quien
   * entra el 10.
   */
  private occupiedIn(reservations: any[], checkIn: string, checkOut: string): Set<string> {
    const occupied = new Set<string>()
    for (const r of reservations) {
      if (!r.roomId) continue
      const status = String(r.status ?? '').toLowerCase()
      if (status && !BLOCKING_RESERVATION_STATUS.has(status)) continue
      const from = String(r.checkIn ?? '').slice(0, 10)
      const to = String(r.checkOut ?? '').slice(0, 10)
      if (!from || !to) continue
      if (from < checkOut && to > checkIn) occupied.add(r.roomId)
    }
    return occupied
  }

  /**
   * Agrupa por tipo lo que queda libre, con su precio y capacidad.
   *
   * `blocked` (room_blocks) descuenta UNIDADES, igual que `occupied`. El stop-sell saca el tipo
   * de la respuesta aunque le queden unidades libres: el hotel cerró la venta de ese producto
   * para esas fechas, no se quedó sin stock.
   *
   * ─── FIX — el tipo no se cae por la ocupación consultada ──────────────────────────────────
   * El filtro era `available > 0 && !isRoomTypeClosed(...)`, y los DOS se computaban con el
   * `adults` de la consulta. Buscando para 4, con la única unidad de 4 tomada (o con la tarifa
   * "para 4" cerrada), el tipo desaparecía ENTERO: el huésped no veía la fila gris "para 4 no
   * disponible" ni las de 1/2/3 que sí estaban libres — se rompía la regla del dueño ("lo que no
   * hay se muestra en gris") justo en el caso que la motivó.
   * Ahora el tipo viaja mientras tenga ALGUNA ocupación vendible (unidad libre que la acepte Y
   * tarifa abierta para ella); la fila agotada la pinta en gris `buildOccupancyMatrix` con
   * `no_availability`/`stop_sell`. Lo que NO cambia:
   *  - `available` sigue siendo el conteo para el `adults` consultado (puede ser 0 con el tipo
   *    presente) y `price` el mínimo del tipo → `availableCount`/`fromPrice` de `/rates` valen
   *    exactamente lo mismo que antes para la landing y el widget en producción;
   *  - un tipo donde el grupo NO ENTRA (capacidad máxima < `adults`) se sigue descartando: no es
   *    un producto agotado, es un producto que no existe para esa consulta;
   *  - un tipo sin NINGUNA unidad libre, o cerrado para todas sus ocupaciones, se sigue cayendo.
   */
  private aggregate(
    rooms: any[],
    occupied: Set<string>,
    blocked: Set<string>,
    isClosedFor: (roomType: string, occupancy: number) => boolean,
    adults: number,
  ): RoomTypeAvailability[] {
    const grouped: Record<string, { available: number; price: number; capacity: number; surfaceArea: number; amenities: string[]; sellableCapacities: number[] }> = {}

    for (const room of rooms) {
      const type = room.type || 'standard'
      if (!grouped[type]) {
        grouped[type] = {
          available: 0,
          price: 0,
          capacity: room.capacity ?? adults,
          surfaceArea: room.surfaceArea ?? 0,
          amenities: room.amenities ?? [],
          sellableCapacities: [],
        }
      }
      // Se publica el precio más bajo del tipo.
      const price = Number(room.basePrice ?? room.price ?? 0)
      if (price > 0 && (grouped[type]!.price === 0 || price < grouped[type]!.price)) {
        grouped[type]!.price = price
      }
      if (room.capacity) grouped[type]!.capacity = Math.max(grouped[type]!.capacity, room.capacity)
      if (room.surfaceArea) grouped[type]!.surfaceArea = Math.max(grouped[type]!.surfaceArea, room.surfaceArea)

      if (occupied.has(room.id)) continue
      // Bloqueo por mantenimiento/uso interno: la habitación puede estar libre de reservas y
      // aun así cerrada por el hotel para esas fechas.
      if (blocked.has(room.id)) continue
      if (!isRoomSellable(room.status)) continue
      // La habitación es VENDIBLE (libre, sin bloqueo, en servicio). Se guarda su capacidad
      // ANTES de filtrar por el grupo consultado: `availableByOccupancy` necesita saber cuántas
      // unidades aceptan 1, 2, 3... huéspedes, no solo cuántas aceptan `adults`.
      grouped[type]!.sellableCapacities.push(Number(room.capacity ?? adults) || 0)
      // No se ofrece una habitación donde no entra el grupo.
      if ((room.capacity ?? adults) < adults) continue
      grouped[type]!.available++
    }

    return Object.entries(grouped)
      .map(([roomType, d]) => ({
        roomType, d, byOccupancy: countByOccupancy(d.sellableCapacities, d.capacity),
      }))
      .filter(({ roomType, d, byOccupancy }) =>
        // En la habitación tiene que entrar el grupo consultado: si la capacidad MÁXIMA del tipo
        // no llega, no es un producto de esta búsqueda (comportamiento previo, intacto).
        d.capacity >= adults &&
        // ...y tiene que quedar al menos una ocupación vendible. `.some` corta en la primera:
        // en el caso normal (todo abierto) es UNA evaluación del stop-sell por tipo.
        byOccupancy.some((units, i) => units > 0 && !isClosedFor(roomType, i + 1)))
      .map(({ roomType, d, byOccupancy }) => ({
        roomType,
        available: d.available,
        price: d.price,
        currency: 'USD',
        capacity: d.capacity,
        surfaceArea: d.surfaceArea,
        amenities: d.amenities,
        availableByOccupancy: byOccupancy,
      }))
  }

  private calculateNights(checkIn: string, checkOut: string): number {
    const a = new Date(checkIn)
    const b = new Date(checkOut)
    return Math.ceil((b.getTime() - a.getTime()) / MS_PER_DAY)
  }
}

/**
 * Unidades vendibles que aceptan 1, 2, ... `capacity` huéspedes (índice `i - 1` → ocupación `i`).
 * Un tipo puede mezclar habitaciones de distinta capacidad: la de 4 ocupada y la de 2 libre
 * significa "para 2 hay, para 3 no", y ese matiz es el que `available` (un solo número) pierde.
 *
 * El techo es el MISMO `MAX_OCCUPANCY_ROWS` que aplica la matriz de ocupaciones, y por la misma
 * razón: `rooms.capacity` es un número tipeado a mano y un valor corrupto haría iterar (y
 * serializar, esto viaja en la respuesta) miles de posiciones en una ruta pública sin auth. El
 * guard estaba solo del lado del consumidor; acá se cierra también del lado del PRODUCTOR.
 */
function countByOccupancy(sellableCapacities: number[], capacity: number): number[] {
  const max = Math.min(MAX_OCCUPANCY_ROWS, Math.max(1, Math.floor(Number(capacity) || 1)))
  const out: number[] = []
  for (let occ = 1; occ <= max; occ++) {
    out.push(sellableCapacities.filter((c) => c >= occ).length)
  }
  return out
}
