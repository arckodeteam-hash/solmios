// marketing/usecases/meta-variable-mapping.ts — Traduce una plantilla del PMS al formato de Meta.
//
// El PMS escribe variables POR NOMBRE (`{guest_name}`), que es lo que ve el recepcionista.
// Meta solo acepta variables POSICIONALES (`{{1}}`, `{{2}}`) y exige un valor de ejemplo por
// cada una. Esta pieza hace la traducción en un solo lugar y guarda el ORDEN resultante:
// sin ese orden, a la hora de enviar no habría forma de saber que `{{2}}` era el hotel.
//
// Es lógica pura (sin repos, sin red) a propósito: las reglas de Meta son puntillosas y esto
// se testea sin levantar nada.

/** Reglas de nombre de Meta: minúsculas, dígitos y guión bajo, hasta 512 caracteres. */
const MAX_NAME = 512
/** Tope de cuerpo de una plantilla en Meta. */
export const MAX_BODY = 1024

/**
 * Variables del PMS con un valor de muestra creíble para el revisor de Meta.
 *
 * Es también la LISTA ÚNICA de lo que una plantilla puede usar. Debe mantenerse alineada con
 * `resolverVariables` en `reservas/usecases/send-whatsapp.ts`, que es quien pone el valor real al
 * enviar: una variable que esté acá y no allá se manda como guión, y una que esté allá y no acá se
 * va sin ejemplo y Meta rechaza la plantilla.
 */
const SAMPLE_VALUES: Record<string, string> = {
  guest_name: 'María García',
  hotel_name: 'Hotel Paraíso',
  hotel_address: 'Av. Principal 100, Punta Cana',
  hotel_phone: '+1 809 555 0100',
  checkin_date: '15/07/2026',
  checkout_date: '18/07/2026',
  checkin_time: '15:00',
  checkout_time: '12:00',
  room_number: '204',
  nights: '3',
  total_amount: 'USD 360',
  pending_amount: 'USD 120',
  locator: 'HX-7842',
  precheckin_link: 'https://solmios.com/pre-checkin/abc123',
  wifi_network: 'HotelParaiso-Guest',
  wifi_password: 'paraiso2026',
  lock_codes: '458219',
}

/** Lo que una plantilla puede usar. Se deriva de las muestras: sin muestra, Meta la rechaza. */
export const VARIABLES_CONOCIDAS = Object.keys(SAMPLE_VALUES)

/** Fallback cuando la plantilla usa una variable que no está en la tabla de muestras. */
const GENERIC_SAMPLE = 'Ejemplo'

export interface MetaBody {
  /** El cuerpo con `{{1}}`, `{{2}}`… listo para mandarle a Meta. */
  metaBody: string
  /** Nombres del PMS en el orden en que Meta los numeró. `variableOrder[0]` es `{{1}}`. */
  variableOrder: string[]
  /** Un valor de muestra por variable, en el mismo orden. */
  samples: string[]
}

/**
 * Convierte un nombre humano ("Confirmación de reserva") en el identificador que Meta acepta
 * ("confirmacion_de_reserva"). Quita tildes, baja a minúsculas y colapsa lo que no sirva.
 */
export function metaTemplateName(name: string): string {
  const slug = name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // "ó" → "o"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX_NAME)
  // Meta rechaza el nombre vacío y el que arranca con dígito no es un problema, pero uno
  // que quedó en nada sí: pasa cuando el nombre era solo emojis o signos.
  return slug || 'plantilla'
}

/**
 * Traduce `{guest_name}` → `{{1}}`. Una variable repetida reusa su número (Meta lo permite y
 * es lo que espera el hotel: el nombre del huésped es el mismo las dos veces que aparece).
 */
export function toMetaBody(body: string): MetaBody {
  const variableOrder: string[] = []
  const metaBody = (body || '').replace(/\{\s*([a-zA-Z][\w.]*)\s*\}/g, (_m, rawName: string) => {
    const name = rawName.trim()
    let idx = variableOrder.indexOf(name)
    if (idx === -1) { variableOrder.push(name); idx = variableOrder.length - 1 }
    return `{{${idx + 1}}}`
  })
  return {
    metaBody,
    variableOrder,
    samples: variableOrder.map((v) => SAMPLE_VALUES[v] ?? GENERIC_SAMPLE),
  }
}

/**
 * Comprueba las reglas de forma de Meta ANTES de mandarle nada.
 *
 * No es celo de más: Meta responde estos casos con un error genérico ("Invalid parameter") que
 * no dice cuál es el problema, y cada rechazo suyo queda en el historial de la cuenta. Es mucho
 * mejor frenarlo acá con un mensaje que el recepcionista pueda entender y corregir.
 *
 * Devuelve el motivo en castellano, o `null` si el cuerpo pasa.
 */
export function metaBodyProblem(metaText: string): string | null {
  const t = (metaText || '').trim()
  if (!t) return 'El cuerpo del mensaje está vacío.'
  if (t.length > MAX_BODY) return `El cuerpo supera los ${MAX_BODY} caracteres que permite WhatsApp.`

  // La puntuación NO salva la regla: Meta rechaza "…tu habitación es la {{3}}." igual que sin el
  // punto (probado contra la API 2026-09-07: "Las variables no pueden estar al principio ni al
  // final de la plantilla"). Por eso se recorta la puntuación de los extremos antes de mirar.
  // La apertura se recorta con una lista explícita y NO con \p{P}: las llaves de `{{1}}` también
  // son puntuación, y borrarlas haría que el chequeo nunca encontrara nada.
  const sinApertura = t.replace(/^[\s"'“‘(\[\u00A1\u00BF]+/u, '')

  if (/^\{\{\d+\}\}/.test(sinApertura)) {
    return 'Meta no acepta que el mensaje EMPIECE con una variable. Escribí algo antes, por ejemplo "Hola {guest_name}".'
  }
  if (/\{\{\d+\}\}[\s.,;:!?"\u2019\u201D)\]]*$/u.test(t)) {
    return 'Meta no acepta que el mensaje TERMINE con una variable, ni siquiera seguida de un punto. Agregá texto después, por ejemplo "…{room_number}. Te esperamos."'
  }
  if (/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(t)) return 'Meta no acepta dos variables seguidas. Poné algún texto entre ellas.'
  return null
}

/**
 * Arma el cuerpo completo que espera la API de Meta.
 * El bloque `example` solo va cuando hay variables: mandarlo vacío es un error de la API.
 */
export interface TemplateBodyComponent {
  type: 'BODY'
  text: string
  example?: { body_text: string[][] }
}

export function buildTemplateComponents(metaBody: MetaBody): TemplateBodyComponent[] {
  const body: TemplateBodyComponent = { type: 'BODY', text: metaBody.metaBody }
  if (metaBody.variableOrder.length > 0) {
    body.example = { body_text: [metaBody.samples] }
  }
  return [body]
}
