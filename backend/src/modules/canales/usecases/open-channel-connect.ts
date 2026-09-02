// canales/usecases/open-channel-connect.ts — Conectar SolmiOS como canal, sin copiar y pegar.
//
// El "Open Channel" de Channex es el canal propio del PMS: sirve para probar la conexión de punta
// a punta sin credenciales de ninguna OTA real, y es la base para enchufar cualquier sistema del
// hotel. Hasta ahora el panel solo mostraba las TRES credenciales (endpoint, api key, hotel code)
// para que el hotelero las pegara a mano en el asistente de Channex. El servidor ya conoce las
// tres: no hay razón para pedirle a nadie que las transcriba, y ese paso manual es la razón por la
// que un hotel nuevo se quedaba sin ningún canal conectado.
//
// El mapeo se arma solo desde el mapping persistido del último sync: cada rate plan de Channex se
// enlaza con el CÓDIGO que expone `buildMappingDetails` para ese mismo plan — `room_type_code` es
// el tipo local (`double`) y `rate_plan_code` es `${tipo}-${plan}` (`double-bar`). Si los códigos
// no coinciden exactamente, Channex manda precios contra un plan que el PMS no reconoce.

import type { RatePlanDef } from '../../../shared/utils/rate-plans'
import type { MappingEntry } from './channex-mapping'
import type { OTAChannelMappingDTO } from '../types'

export interface OpenChannelRoomType {
  type: string
  capacity: number
}

/**
 * Mapeo (rate plan de Channex) → (código de tipo, código de plan) del PMS.
 *
 * Sale del mapping local, cuyo `localId` es `${tipo}|${label del plan}`; el label se traduce a
 * código con el catálogo del hotel (BAR → `bar`). Un plan que no matchee se saltea en vez de
 * mandar un código inventado.
 */
export function buildOpenChannelMappings(
  mappings: MappingEntry[],
  ratePlans: RatePlanDef[],
  roomTypes: OpenChannelRoomType[],
): OTAChannelMappingDTO[] {
  const codeByLabel = new Map(ratePlans.map((p) => [p.label.toLowerCase(), p.code]))
  const capacityByType = new Map(roomTypes.map((rt) => [rt.type.toLowerCase(), Math.max(1, rt.capacity)]))
  const out: OTAChannelMappingDTO[] = []

  for (const m of mappings) {
    if (m.kind !== 'rate_plan') continue
    const [type, label] = m.localId.split('|')
    if (!type || !label) continue
    const planCode = codeByLabel.get(label.toLowerCase())
    if (!planCode) continue                       // plan que el hotel ya no tiene
    const capacity = capacityByType.get(type.toLowerCase())
    if (!capacity) continue                       // tipo sin habitaciones vivas
    out.push({
      ratePlanId: m.channexId,
      roomTypeCode: type,
      ratePlanCode: `${type}-${planCode}`,
      occupancy: capacity,
      // El hotel tarifa SIEMPRE por persona (`buildMappingDetails` publica `sell_mode: per_person`):
      // el canal tiene que pedir el precio de cada ocupación, no solo el de la máxima.
      pricingType: 'per_person',
      primaryOcc: true,
    })
  }
  return out
}

/** Los tipos vivos del hotel con su capacidad máxima — el mismo criterio que el mapping details. */
export function roomTypesFromRooms(rooms: Array<{ type?: string; capacity?: number }>): OpenChannelRoomType[] {
  const byType = new Map<string, number>()
  for (const r of rooms) {
    const type = String(r?.type || '').trim()
    if (!type) continue
    byType.set(type, Math.max(byType.get(type) ?? 0, Number(r.capacity) || 2))
  }
  return [...byType.entries()].map(([type, capacity]) => ({ type, capacity }))
}

// ─── Mantener el mapeo al día ────────────────────────────────────────────────────────────────
//
// Un hotel que carga sus habitaciones en dos tandas (4 dobles, después 2 twin) terminaba con el
// canal mapeado SOLO contra lo que existía cuando lo conectó: las tarifas del tipo nuevo quedaban
// "Sin mapear" y no se publicaban, con la tarjeta del panel diciendo "Conectado". Verificado en
// producción el 2026-09-02 con un hotel recién registrado: 2 de 4 tarifas mapeadas.
//
// Por eso el sync, además de publicar la estructura, deja el canal propio al día. No CREA el canal
// —conectarlo es decisión del hotelero— y no toca las credenciales: solo re-mapea lo que hay.

import type { Logger } from 'arckode-framework'

export interface OpenChannelSyncDeps {
  /** Id del canal OpenChannel de la property, o null si el hotel no conectó ninguno. */
  findOpenChannel: (hotelId: string) => Promise<string | null>
  readMappings: (hotelId: string) => Promise<MappingEntry[]>
  readRatePlans: (hotelId: string) => Promise<RatePlanDef[]>
  readRooms: (hotelId: string) => Promise<Array<{ type?: string; capacity?: number }>>
  updateMapping: (hotelId: string, channelId: string, ratePlans: OTAChannelMappingDTO[]) => Promise<{ success: boolean; mapped: number; message: string }>
  logger: Logger
}

/** `null` si no había canal que actualizar; si no, cuántas tarifas quedaron mapeadas. */
export async function syncOpenChannelMapping(
  deps: OpenChannelSyncDeps, hotelId: string,
): Promise<number | null> {
  try {
    const channelId = await deps.findOpenChannel(hotelId)
    if (!channelId) return null
    const [mappings, plans, rooms] = await Promise.all([
      deps.readMappings(hotelId), deps.readRatePlans(hotelId), deps.readRooms(hotelId),
    ])
    const ratePlans = buildOpenChannelMappings(mappings, plans, roomTypesFromRooms(rooms))
    // Sin tarifas que mapear, un PUT vacío DESMAPEARÍA el canal entero (el mapeo se reemplaza
    // completo): mejor dejarlo como está.
    if (!ratePlans.length) return null
    const res = await deps.updateMapping(hotelId, channelId, ratePlans)
    if (!res.success) {
      deps.logger.warn('No se pudo actualizar el mapeo del canal propio', { hotelId, channelId, message: res.message })
      return null
    }
    deps.logger.info('Mapeo del canal propio actualizado tras el sync', { hotelId, channelId, mapeados: res.mapped })
    return res.mapped
  } catch (e) {
    // El mapeo del canal NUNCA puede tirar abajo un sync que ya publicó la estructura.
    deps.logger.error('Falló el re-mapeo del canal propio', { hotelId, error: e instanceof Error ? e.message : String(e) })
    return null
  }
}
