// reservas/usecases/in-house.ts — #209: "quién está alojado ahora", buscable por número de habitación o
// por apellido. Lo consume el POS del restaurante (room service / cargo a habitación) a través del
// puerto `ReservationPort.searchInHouse` (connectors/restaurante-reservas.ts): el mozo NO tiene
// `reservations:view`, así que la ruta HTTP vive en `restaurant` y acá solo está la regla.
//
// Reglas:
//   - Reservas `checked_in` del hotel, MÁS las `confirmed` vigentes (llegada hoy o anterior y salida
//     hoy o posterior) que todavía no hicieron check-in: el huésped que come antes de pasar por
//     recepción también se carga a su habitación (REG-1). El POS las distingue por `status`.
//   - "Hoy" es el del HOTEL (`hotels.timezone`, shared/utils/hotel-schedule.ts), no UTC: a las 20:00
//     de Santo Domingo UTC ya cambió de día y "llega hoy" pasaría a ser "llegó ayer".
//   - Las `confirmed` NO se traen todas (un hotel tiene meses de reservas futuras confirmadas): el ORM
//     solo filtra por igualdad, así que se piden por `checkIn` = hoy y = ayer (CONFIRMED_LOOKBACK_DAYS).
//     Una confirmada con llegada anterior a ayer que sigue `confirmed` ya no existe en la práctica:
//     el cron de no-show (reports/usecases/no-show-cron.ts, cada 3 h) la marca `no_show`. La regla
//     de vigencia (llegada ≤ hoy ≤ salida) se aplica igual sobre lo que vuelve.
//   - SOLO del hotel resuelto (token → BD). Nadie puede mirar otro hotel.
//   - `id` explícito: devuelve ESA reserva del hotel (cualquier estado) — es el lookup que Cobrar hace
//     para preseleccionar la reserva de la comanda sin traerse a todos los alojados.
//   - El filtro se hace en memoria: los alojados de un hotel están acotados por sus habitaciones
//     (no es `reservations` entera) y el ORM no sabe hacer `OR`/`LIKE`/`IN` sobre dos tablas.
//   - Habitación: coincide por prefijo del número ("2" lista 201, 204…; "204" solo 204). Apellido:
//     substring del nombre del huésped sin acentos ni mayúsculas ("perez" encuentra "Pérez").
//   - Se devuelve `total` real y `data` recortada a IN_HOUSE_LIMIT: el POS avisa que faltan filas.
import { AuthError } from 'arckode-framework'
import type { RepositoryAdapter } from 'arckode-framework'
import type { ReservasDTO } from '../types'
import { assertInHouseQuery } from '../../../shared/utils/in-house-query'
import { hotelToday, stayCoversDate } from '../../../shared/utils/hotel-schedule'
import { addDays } from '../../../shared/utils/daily-availability'

export interface InHouseReservation {
  id: string
  hotelId: string
  roomId: string
  roomNumber: string
  guestId: string | null
  guestName: string
  checkIn: string
  checkOut: string
  nights: number
  /** `checked_in` = alojado; `confirmed` = llega hoy / vigente sin check-in; otro = solo por lookup de `id`. */
  status: string
}

export interface InHouseSearchResult {
  data: InHouseReservation[]
  /** Coincidencias reales; `data.length < total` cuando se recortó a IN_HOUSE_LIMIT. */
  total: number
}

export interface InHouseDeps {
  repo: RepositoryAdapter<ReservasDTO>
  roomRepo: RepositoryAdapter<any>
  guestRepo: RepositoryAdapter<any>
  userRepo: RepositoryAdapter<any>
  /** Zona horaria del hotel (`hotels.timezone`) para saber qué día es "hoy" ahí. */
  hotelRepo: RepositoryAdapter<any>
  /** Instante actual; inyectable por los tests (una noche a las 20:00 UTC-4 tiene que seguir siendo hoy). */
  now?: () => Date
}

export const IN_HOUSE_LIMIT = 50
/** Días hacia atrás (además de hoy) en que se buscan `confirmed` por `checkIn`; ver cabecera. */
export const CONFIRMED_LOOKBACK_DAYS = 1

export function normalizeQuery(q: unknown): string {
  return String(q ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const ms = Date.parse(checkOut) - Date.parse(checkIn)
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms / 86_400_000) : 0
}

export function matchesInHouse(r: Pick<InHouseReservation, 'roomNumber' | 'guestName'>, q: string): boolean {
  if (!q) return true
  const room = normalizeQuery(r.roomNumber)
  if (room && room.startsWith(q)) return true
  return normalizeQuery(r.guestName).includes(q)
}

/** Una reserva confirmada cuenta como "vigente" si hoy cae dentro de su estadía (llegada ≤ hoy ≤ salida). */
export function isCurrentConfirmed(r: Pick<ReservasDTO, 'status' | 'checkIn' | 'checkOut'>, today: string): boolean {
  return r.status === 'confirmed' && stayCoversDate(r, today)
}

/** Fechas de llegada por las que se piden las `confirmed`: hoy y CONFIRMED_LOOKBACK_DAYS hacia atrás. */
export function confirmedArrivalDates(today: string): string[] {
  return Array.from({ length: CONFIRMED_LOOKBACK_DAYS + 1 }, (_, i) => addDays(today, -i))
}

/** Hotel contra el que se busca: el del token, si no el del usuario en BD. Nadie elige otro hotel. */
async function resolveHotel(deps: InHouseDeps, user: { id: string; hotelId?: string }): Promise<string> {
  let hotelId = user.hotelId
  if (!hotelId) hotelId = (await deps.userRepo.findById(user.id))?.hotelId
  if (!hotelId) throw new AuthError('No hotel assigned')
  return hotelId
}

async function toRows(deps: InHouseDeps, hotelId: string, reservations: ReservasDTO[]): Promise<InHouseReservation[]> {
  if (!reservations.length) return []
  const rooms = (await deps.roomRepo.findMany({ hotelId })) as { id: string; number?: string }[]
  const roomNumber = new Map(rooms.map((r) => [r.id, String(r.number ?? '')]))
  // Huéspedes: una lectura por id DISTINTO, en paralelo y acotada al hotel (un guestId de otro hotel
  // — dato inconsistente — no resuelve nombre). No es `guests` entera: la tabla crece con los años.
  const guestIds = [...new Set(reservations.map((r) => r.guestId).filter((g): g is string => !!g))]
  const guests = await Promise.all(guestIds.map((id) => deps.guestRepo.findOne({ id, hotelId })))
  const guestName = new Map(guestIds.map((id, i) => [id, String(guests[i]?.name ?? '')]))
  return reservations.map((r) => ({
    // #258: roomId es nullable en el modelo; una reserva en casa SIEMPRE tiene habitación (se asigna al check-in).
    id: r.id, hotelId: r.hotelId, roomId: r.roomId ?? '', roomNumber: roomNumber.get(r.roomId ?? '') ?? '',
    guestId: r.guestId ?? null, guestName: r.guestId ? guestName.get(r.guestId) ?? '' : '',
    checkIn: r.checkIn, checkOut: r.checkOut, nights: nightsBetween(r.checkIn, r.checkOut),
    status: String(r.status ?? ''),
  }))
}

export async function searchInHouse(
  deps: InHouseDeps,
  query: { q?: string; id?: string },
  user: { id: string; role: string; hotelId?: string },
): Promise<InHouseSearchResult> {
  const q = normalizeQuery(assertInHouseQuery(query.q))
  const hotelId = await resolveHotel(deps, user)

  if (query.id) {
    // Lookup puntual (Cobrar preselecciona la reserva de la comanda): del hotel, cualquier estado.
    const one = (await deps.repo.findOne({ id: String(query.id), hotelId })) as ReservasDTO | null
    const data = one ? await toRows(deps, hotelId, [one]) : []
    return { data, total: data.length }
  }

  const hotel = await deps.hotelRepo.findOne({ id: hotelId })
  const today = hotelToday(hotel, (deps.now ?? (() => new Date()))())
  const [inHouse, ...confirmedByDay] = await Promise.all([
    deps.repo.findMany({ hotelId, status: 'checked_in' }) as Promise<ReservasDTO[]>,
    ...confirmedArrivalDates(today).map((checkIn) => deps.repo.findMany({ hotelId, status: 'confirmed', checkIn }) as Promise<ReservasDTO[]>),
  ])
  const confirmed = confirmedByDay.flat().filter((r) => isCurrentConfirmed(r, today))
  const rows = await toRows(deps, hotelId, [...inHouse, ...confirmed])
  const result = rows.filter((row) => matchesInHouse(row, q))
  result.sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, 'es', { numeric: true }) || a.guestName.localeCompare(b.guestName, 'es'))
  return { data: result.slice(0, IN_HOUSE_LIMIT), total: result.length }
}
