// restaurant/usecases/in-house.ts — #209: buscador "quién está alojado" para room service y cargo a
// habitación. El mozo no tiene `reservations:view`, así que la ruta vive en este módulo
// (`GET /api/restaurant/in-house?q=` · `?id=` para una reserva puntual) y la búsqueda real la hace
// `reservas` a través del puerto (connectors/restaurante-reservas.ts). El hotel se resuelve acá
// (token → BD) y viaja explícito al puerto, mismo criterio que `assertReservationOfHotel`. Sin puerto
// cableado se falla CERRADO.
import { ValidationError } from 'arckode-framework'
import type { RepositoryAdapter } from 'arckode-framework'
import type { CurrentUser } from '../types'
import type { InHouseSearchResult, ReservationPort } from './reservation-port'
import { assertInHouseQuery } from '../../../shared/utils/in-house-query'

export interface InHouseDeps {
  reservations?: ReservationPort | null
  userRepo: RepositoryAdapter<any>
}

export async function searchInHouse(deps: InHouseDeps, query: { q?: unknown; id?: unknown }, user: CurrentUser): Promise<InHouseSearchResult> {
  const term = assertInHouseQuery(query.q)
  const id = typeof query.id === 'string' && query.id.trim() ? query.id.trim() : undefined
  if (!deps.reservations?.searchInHouse) throw new ValidationError('Búsqueda de huéspedes no disponible (reservas no conectado)')

  let hotelId = user.hotelId || ''
  if (!hotelId) hotelId = (await deps.userRepo.findById(user.id))?.hotelId ?? ''
  if (!hotelId) throw new ValidationError('Sin hotel asignado')

  return deps.reservations.searchInHouse({ q: term, id }, hotelId, { ...user, hotelId })
}
