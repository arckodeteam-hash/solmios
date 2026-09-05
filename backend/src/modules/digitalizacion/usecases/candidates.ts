// digitalizacion/usecases/candidates.ts — "Identificar hoteles que no tienen página web": quién es
// candidato a entrar al programa de digitalización y quién ya está ocupado por un expediente vivo.
//
// Está fuera del service porque es una función PURA sobre las dos lecturas (hoteles + expedientes):
// no necesita repo, logger ni sockets, y así el service se queda solo con la orquestación
// (extraído para no pasar de 200 líneas — gate GOD_SERVICE de arckode analyze).
import type { DigitalizationCandidateDTO, DigitalizationCaseDTO, DigitalizationCaseStatus } from '../types'

/**
 * Puerto mínimo sobre la tabla `hotels`: el módulo solo necesita saber si el hotel existe, cómo se
 * llama y si tiene web. Se inyecta como repo aparte (igual que subscriptions con `hotelsRepo`) para
 * no acoplar digitalizacion al DTO completo de hoteles y para poder testear con un fake.
 */
export interface DigitalizacionHotelRow {
  id: string
  name: string
  slug?: string | null
  website?: string | null
  /** La ciudad del hotel no tiene columna propia: `locality` y si no `municipality`. */
  locality?: string | null
  municipality?: string | null
}

/**
 * Estados que "ocupan" al hotel: mientras haya un expediente abierto o completado no se abre otro
 * ni el hotel vuelve a la lista de candidatos. Un expediente `cancelado` no ocupa — el hotel puede
 * volver a entrar al programa más adelante.
 */
const ACTIVE_CASE_STATUSES: readonly DigitalizationCaseStatus[] = ['abierto', 'completado']

/** Presencia digital = tener algo cargado en `website`. '' y '   ' cuentan como no tener nada. */
export function hasWebsite(website?: string | null): boolean {
  return typeof website === 'string' && website.trim() !== ''
}

function ocupaAlHotel(c: DigitalizationCaseDTO): boolean {
  return ACTIVE_CASE_STATUSES.includes(c.status)
}

/** ¿Alguno de estos expedientes ocupa al hotel? Usado también al abrir uno nuevo (ConflictError). */
export function hasActiveCase(cases: DigitalizationCaseDTO[]): boolean {
  return cases.some(ocupaAlHotel)
}

/**
 * Candidatos = hoteles sin `website` y sin un expediente vivo. Se resuelve en memoria (dos lecturas)
 * porque el repo no hace joins y el universo de hoteles del SaaS es chico.
 */
export function selectCandidates(
  hotels: DigitalizacionHotelRow[],
  cases: DigitalizationCaseDTO[],
): DigitalizationCandidateDTO[] {
  const conExpediente = new Set(cases.filter(ocupaAlHotel).map((c) => c.hotelId))

  return hotels
    .filter((h) => !hasWebsite(h.website) && !conExpediente.has(h.id))
    .map((h) => ({
      hotelId: h.id,
      name: h.name,
      slug: h.slug ?? undefined,
      city: h.locality ?? h.municipality ?? undefined,
      website: h.website ?? undefined,
    }))
}
