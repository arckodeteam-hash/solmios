/**
 * A qué hotel pertenece un webhook de WhatsApp.
 *
 * Meta acepta UNA sola URL de callback por aplicación, y por ahí entran los eventos de TODOS los
 * hoteles que conectaron su número a través nuestro (modelo Tech Provider). Sacar el hotel del path
 * (`/webhook/:hotelId`) sólo funciona mientras haya un hotel conectado: con dos, los mensajes del
 * segundo caen en la bandeja del primero.
 *
 * El identificador que sí viene en cada evento es el de la cuenta de WhatsApp del hotel
 * (`entry[].id` = WABA ID), que ya guardamos al conectar (`model.ts` → `wabaId`). Ese es el que
 * manda. El `:hotelId` del path se sigue aceptando por las conexiones que ya lo estén usando, pero
 * sólo si coincide con el dueño real de la WABA.
 */

export interface WhatsappConfigRow {
  hotelId: string
  wabaId?: string
  phoneNumberId?: string
  verifyToken?: string
}

export interface WebhookConfigRepo {
  findMany(where?: Record<string, unknown>): Promise<WhatsappConfigRow[]>
}

/** El id de la cuenta de WhatsApp que Meta pone en cada evento. */
export function wabaIdDelEvento(body: unknown): string | null {
  const entry = (body as any)?.entry
  const id = Array.isArray(entry) ? entry[0]?.id : undefined
  return typeof id === 'string' && id.length > 0 ? id : null
}

/**
 * Hotel dueño de un evento entrante.
 *
 * Devuelve `null` cuando no se puede probar de quién es: preferimos descartar el evento antes que
 * escribirle la conversación de un huésped al hotel equivocado.
 */
export async function resolverHotelDelEvento(
  repo: WebhookConfigRepo,
  hotelIdDelPath: string | undefined,
  body: unknown,
): Promise<string | null> {
  const waba = wabaIdDelEvento(body)

  if (waba) {
    const porWaba = await repo.findMany({ wabaId: waba })
    const dueno = porWaba[0]
    if (!dueno) return null
    // Un path que apunte a otro hotel es un error de configuración (o un intento de cruzar
    // tenants): gana el dueño real de la WABA, nunca la URL.
    return dueno.hotelId
  }

  // Sin WABA en el evento no hay forma de identificarlo. Sólo entonces vale el path, y sólo si ese
  // hotel tiene de verdad una conexión: un hotelId inventado en la URL no crea conversaciones.
  if (!hotelIdDelPath) return null
  const porPath = await repo.findMany({ hotelId: hotelIdDelPath })
  return porPath[0] ? hotelIdDelPath : null
}

/**
 * Hotel que corresponde al alta del webhook (el GET con `hub.verify_token` que Meta hace una vez).
 *
 * Ese GET no trae WABA: sólo el token. Se acepta si algún hotel conectado tiene ese token, y se
 * exige que sea único — dos hoteles con el mismo token sería un token adivinable o copiado, y
 * validarlo dejaría entrar a cualquiera de los dos.
 */
export async function resolverHotelDeVerificacion(
  repo: WebhookConfigRepo,
  hotelIdDelPath: string | undefined,
  token: string,
): Promise<string | null> {
  if (!token) return null

  if (hotelIdDelPath) {
    const propias = await repo.findMany({ hotelId: hotelIdDelPath })
    return propias[0]?.verifyToken === token ? hotelIdDelPath : null
  }

  const conEseToken = (await repo.findMany({})).filter((c) => c.verifyToken && c.verifyToken === token)
  if (conEseToken.length !== 1) return null
  return conEseToken[0].hotelId
}
