// shared/utils/room-type-titles.ts — Título público de un tipo de habitación.
//
// El PMS guarda el tipo como CÓDIGO del enum (`single`, `double`, `twin`, `suite`…). Ese código
// es interno, pero hasta ahora era también lo que se creaba como título del room type en Channex
// — y de ahí sale lo que ve el huésped en Booking/Expedia: un "twin" en minúscula, o peor, un
// tipo llamado "n" (el código histórico del twin en el panel).
//
// Acá se traduce código → título vendible en inglés, que es el idioma del contenido de la API
// (regla del proyecto: UI en español, DB/API/código en inglés). Los títulos coinciden además con
// los que pide el setup de la certificación PMS de Channex ("Twin Room", "Double Room").
//
// La vuelta (`localRoomTypeFromTitle`) hace falta porque las reservas que llegan del canal
// referencian el room type de Channex por TÍTULO y hay que encontrar la habitación local.

export const ROOM_TYPE_TITLES: Record<string, string> = {
  single: 'Single Room',
  double: 'Double Room',
  twin: 'Twin Room',
  // 'n' es el código con el que el panel guardó los twin históricamente (ver rooms/index.vue).
  n: 'Twin Room',
  triple: 'Triple Room',
  quad: 'Quad Room',
  family: 'Family Room',
  suite: 'Suite',
  deluxe: 'Deluxe Room',
  presidential: 'Presidential Suite',
  villa: 'Villa',
  dorm: 'Dormitory',
}

/** Title Case de un código desconocido: `garden_view` → `Garden View`. */
function titleCase(raw: string): string {
  return raw
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** Título con el que el tipo se publica en el channel manager. */
export function channexRoomTypeTitle(type: string): string {
  const key = String(type || '').trim().toLowerCase()
  if (!key) return ''
  return ROOM_TYPE_TITLES[key] ?? titleCase(key)
}

/**
 * Código local a partir del título de Channex. Devuelve el título tal cual si no lo reconoce:
 * las properties sincronizadas ANTES de este cambio tienen el código crudo como título, y una
 * reserva que llegue para ellas tiene que seguir resolviendo igual.
 */
export function localRoomTypeFromTitle(title: string): string {
  const t = String(title || '').trim().toLowerCase()
  if (!t) return ''
  for (const [code, label] of Object.entries(ROOM_TYPE_TITLES)) {
    // 'n' comparte título con 'twin': gana 'twin', que es el código del enum vigente.
    if (label.toLowerCase() === t && code !== 'n') return code
  }
  return String(title || '').trim()
}
