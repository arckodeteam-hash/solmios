// canales/usecases/channex-mapping.ts — Mapping persistente local↔Channex (P6).
//
// Antes de esto cada push hacía 2 GETs (/room_types + /rate_plans) y matcheaba los UUIDs
// POR TÍTULO case-insensitive: renombrar un tipo en el PMS rompía el push silenciosamente
// (ya pasó en la POC de junio: tipos en español vs inglés). Acá el sync persiste
// (kind, localId) → channexId y los pushes resuelven por mapping, con fallback a la
// vía vieja (GET + título) para hoteles sin mapping todavía.

import { channexRoomTypeTitle } from '../../../shared/utils/room-type-titles'

export type MappingKind = 'property' | 'room_type' | 'rate_plan'

export interface MappingEntry {
  kind: MappingKind
  /** room_type: el type local tal cual. rate_plan: `${type}|${plan.code}`. property: 'default'. */
  localId: string
  channexId: string
}

/** Store mínimo que el service inyecta al usecase (el usecase no toca la DB directo). */
export interface ChannelMappingStore {
  read(hotelId: string): Promise<MappingEntry[]>
  /** Upsert por (hotelId, kind, localId): actualiza el channexId si ya existía. */
  upsert(hotelId: string, entries: MappingEntry[]): Promise<void>
}

export interface AriTargets {
  /** título local (lowercase) → room_type UUID de Channex. */
  rtIdByTitle: Map<string, string>
  /** room_type UUID de Channex → sus rate plans (id + título para el matcheo por keywords). */
  rpsByRt: Map<string, Array<{ id: string; title?: string }>>
}

/** Arma los targets de ARI desde los mappings persistidos — sin ningún GET a Channex. */
export function targetsFromMappings(mappings: MappingEntry[]): AriTargets {
  const rtIdByTitle = new Map<string, string>()
  const rpLocalByRt = new Map<string, Array<{ id: string; planLabel: string }>>()
  // Dos pasadas: primero room types (los rate plans dependen de su UUID).
  for (const m of mappings) {
    if (m.kind === 'room_type') rtIdByTitle.set(m.localId.toLowerCase(), m.channexId)
  }
  for (const m of mappings) {
    if (m.kind !== 'rate_plan') continue
    const [type, planLabel] = m.localId.split('|')
    if (!type || !planLabel) continue
    const rtId = rtIdByTitle.get(type.toLowerCase())
    if (!rtId) continue   // rate plan huérfano (sin room type mapeado): se ignora
    const list = rpLocalByRt.get(rtId) ?? []
    list.push({ id: m.channexId, planLabel })
    rpLocalByRt.set(rtId, list)
  }
  const rpsByRt = new Map<string, Array<{ id: string; title?: string }>>()
  for (const [rtId, list] of rpLocalByRt) {
    // El title lleva el label del plan ("BAR", "Bed & Breakfast") para que matchRatePlan
    // por keywords siga funcionando igual que contra los títulos reales de Channex.
    rpsByRt.set(rtId, list.map((x) => ({ id: x.id, title: x.planLabel })))
  }
  return { rtIdByTitle, rpsByRt }
}

/**
 * UUID del room type de Channex para un tipo local.
 *
 * Busca por el CÓDIGO local (así lo indexa el mapping persistido) y, si no está, por el TÍTULO
 * publicado — que es como quedan indexadas las properties viejas resueltas por GET + título.
 * Sin el segundo intento, un hotel sin mapping dejaría de publicar en silencio en cuanto los
 * room types de Channex pasaron a llamarse "Twin Room" en vez de "twin".
 */
export function lookupRoomTypeId(rtIdByTitle: Map<string, string>, type: string): string | undefined {
  const raw = String(type || '').toLowerCase()
  if (!raw) return undefined
  return rtIdByTitle.get(raw) ?? rtIdByTitle.get(channexRoomTypeTitle(raw).toLowerCase())
}
