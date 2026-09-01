// canales/usecases/open-channel-api.ts — Lado servidor de la API "Open Channel" de Channex.
// Doc oficial: https://docs.channex.io/for-ota/open-channel-api
//
// Acá SolmiOS actúa de "canal" propio para Channex: en vez de que el hotel conecte una OTA real
// (Airbnb, Booking), puede conectar ESTE endpoint como un canal más — sirve para probar el flujo
// de conexión de punta a punta sin depender de credenciales de ninguna OTA real, y como base para
// integrar cualquier sistema propio del hotel (una web, un Excel con API, etc.) más adelante.
//
// Antes de este archivo, un hotel (Hotel Boutique Palma, canal "SolmiOS Open (prueba mapeo)") ya
// había configurado esto en Channex apuntando a `/api/channels/open-ari`, pero esa ruta no existía
// en el backend → Channex la llamaba y recibía 404. El canal quedó con isActive:false desde
// entonces. Este archivo + el wiring en index.ts son lo que faltaba.
//
// `hotel_code` (el campo que Channex reenvía en cada llamada) = nuestro hotelId directo: es el
// valor que el hotel escribe en el campo "Hotel Code" al configurar el canal en Channex, así que
// no hace falta ninguna tabla de traducción — se busca el hotel por ese id tal cual.
//
// La única autenticación de estas rutas es el header `api-key` contra la clave que generamos acá
// por hotel (no hay JWT: quien llama es el servidor de Channex, no un usuario logueado).

import type { RepositoryAdapter } from 'arckode-framework'
import { readRatePlans } from '../../../shared/utils/rate-plans'
import type { CanalesDTO } from '../types'

export interface OpenChannelDeps {
  canalesRepo: RepositoryAdapter<CanalesDTO>
  syncLogRepo: RepositoryAdapter<any>
  /** Mismo patrón que PushRatesDeps: consulta genérica por modelo, sin crear un repo nuevo por tabla. */
  findMany: (model: string, query: any) => Promise<any[]>
}

export interface OpenChannelCredentials {
  apiKey: string
  hotelCode: string
  endpoint: string
}

/**
 * Arma la URL absoluta del endpoint a partir del propio request: nunca hardcodear el dominio.
 *
 * Cloudflare (modo Flexible) habla HTTP plano con el origen: nginx ve $scheme=http y reenvía
 * X-Forwarded-Proto:http aunque el visitante haya entrado por HTTPS — el header queda mintiendo.
 * `cf-visitor` es la señal que Cloudflare agrega con el scheme REAL del visitante independiente
 * de cómo hable con el origen; se prioriza sobre x-forwarded-proto cuando está presente.
 *
 * Trailing slash OBLIGATORIO: Channex concatena el Endpoint configurado directamente con
 * "test_connection"/"mapping_details" SIN insertar una barra propia (`{endpoint}test_connection/`,
 * no `{endpoint}/test_connection/`). Sin la barra final acá, la URL que arma Channex da 404
 * (`open-aritest_connection`) y el canal nunca puede activarse — bug real encontrado y confirmado
 * contra tráfico real de Channex (user-agent `hackney`) en los access logs de nginx (#241, CH-02).
 */
export function buildEndpointUrl(req: any): string {
  const cfVisitor = req?.headers?.['cf-visitor']
  let proto: string | undefined
  if (typeof cfVisitor === 'string') {
    try { proto = JSON.parse(cfVisitor)?.scheme } catch { /* header malformado, se ignora */ }
  }
  proto = proto || (req?.headers?.['x-forwarded-proto'] as string) || 'https'
  const host = (req?.headers?.host as string) || 'localhost'
  return `${proto}://${host}/api/channels/open-ari/`
}

/**
 * Config Open Channel del hotel: crea la clave la primera vez que se pide, la reutiliza después.
 * Vive dentro del `config` (json) de `channel_config` — no hace falta columna nueva.
 */
export async function getOrCreateOpenChannelKey(
  deps: Pick<OpenChannelDeps, 'canalesRepo'>,
  hotelId: string,
): Promise<string> {
  const cfg = await deps.canalesRepo.findOne({ hotelId } as any)
  const existing = (cfg?.config as any)?.openChannelApiKey
  if (existing) return existing

  const apiKey = crypto.randomUUID()
  const nextConfig = { ...((cfg?.config as any) ?? {}), openChannelApiKey: apiKey }
  if (cfg) await deps.canalesRepo.update(cfg.id, { config: nextConfig } as any)
  else await deps.canalesRepo.create({ id: crypto.randomUUID(), hotelId, syncEnabled: 1, config: nextConfig } as any)
  return apiKey
}

/** ¿La clave que mandó Channex coincide con la guardada para este hotel? Fail-closed: sin config, no pasa. */
export async function verifyOpenChannelKey(
  deps: Pick<OpenChannelDeps, 'canalesRepo'>,
  hotelId: string | undefined,
  providedKey: string | undefined,
): Promise<boolean> {
  if (!hotelId || !providedKey) return false
  const cfg = await deps.canalesRepo.findOne({ hotelId } as any)
  const expected = (cfg?.config as any)?.openChannelApiKey
  return !!expected && expected === providedKey
}

/**
 * `mapping_details` — le dice a Channex qué tipos de habitación y "rate plans" tiene el hotel, para
 * que el hotel los mapee en la UI de Channex.
 *
 * Lo que se declara acá TIENE que ser lo que el hotel realmente vende: un rate plan por cada
 * (tipo de habitación × plan del hotel) — BAR, Bed & Breakfast… — en `per_person`, que es como
 * tarifa el sistema. Antes se exponía UNO solo por tipo llamado "X Standard" y en `per_room`:
 * con eso, la mitad de los planes del hotel no tenía contraparte que mapear (por eso un canal
 * quedaba con 0 rate plans mapeados) y Channex mandaba updates solo de la ocupación máxima.
 *
 * Los ids son estables (`${tipo}-${plan}`): son los códigos con los que Channex referencia cada
 * plan cuando devuelve cambios, así que cambiarlos rompe un mapeo ya hecho.
 */
export async function buildMappingDetails(
  deps: Pick<OpenChannelDeps, 'findMany'>,
  hotelId: string,
): Promise<{ data: { type: string; attributes: { room_types: unknown[] } } }> {
  const [rooms, hotels, ratePlans] = await Promise.all([
    deps.findMany('Rooms', { hotelId }),
    deps.findMany('Hotels', { id: hotelId }),
    readRatePlans((model, query) => deps.findMany(model, query), hotelId),
  ])
  const currency = (hotels as any[])?.[0]?.currency || 'USD'

  const byType = new Map<string, { capacity: number }>()
  for (const r of rooms as any[]) {
    const type = String(r.type || 'double')
    const cur = byType.get(type)
    const capacity = Number(r.capacity) || 2
    if (!cur || capacity > cur.capacity) byType.set(type, { capacity })
  }

  const titleOf = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
  const room_types = [...byType.entries()].map(([type, { capacity }]) => ({
    id: type,
    title: titleOf(type),
    rate_plans: ratePlans.map((plan) => ({
      id: `${type}-${plan.code}`,
      title: `${titleOf(type)} ${plan.label}`,
      // El hotel tarifa SIEMPRE por persona: Channex tiene que mandar el precio de cada ocupación,
      // no solo el de la máxima.
      sell_mode: 'per_person',
      max_persons: capacity,
      currency,
      read_only: false,
    })),
  }))

  return { data: { type: 'mapping_details', attributes: { room_types } } }
}

/** Una entrada del array `changes` del webhook — la forma exacta la define Channex, no nosotros. */
interface ChangeItem {
  type?: string
  attributes?: Record<string, unknown>
}

/**
 * `changes/` — Channex empuja acá cambios de disponibilidad y tarifas/restricciones.
 *
 * Alcance deliberado: se autentica, se valida la forma del payload, y CADA cambio queda registrado
 * en `sync_log` (mismo lugar que ya alimenta "Historial de Sincronización" en el panel) para que
 * quede visible y auditable. NO se escribe todavía sobre Rooms/RoomRates en vivo: este proyecto
 * modela las tarifas por TEMPORADA (season/season_assignments), y Channex manda rangos de fecha
 * sueltos (date_from/date_to) que no calzan 1:1 con ese modelo sin una capa de traducción propia.
 * Aplicar precios de un tercero directo sobre el motor de tarifas real, sin esa traducción diseñada
 * y revisada aparte, es más riesgoso que dejarlo registrado y no aplicado todavía.
 */
export async function applyChanges(
  deps: Pick<OpenChannelDeps, 'syncLogRepo'>,
  hotelId: string,
  changes: ChangeItem[],
): Promise<{ recorded: number }> {
  let recorded = 0
  for (const change of changes) {
    if (!change || typeof change !== 'object') continue
    await deps.syncLogRepo.create({
      id: crypto.randomUUID(),
      hotelId,
      channel: 'open_channel',
      action: 'open_channel_change',
      status: 'success',
      details: { changeType: change.type ?? 'unknown', ...(change.attributes ?? {}) },
      createdAt: new Date().toISOString(),
    } as any)
    recorded++
  }
  return { recorded }
}

/** Registra test_connection / mapping_details en el historial — igual que sync/ingest ya lo hacen. */
export async function logOpenChannelCall(
  deps: Pick<OpenChannelDeps, 'syncLogRepo'>,
  hotelId: string,
  action: 'open_channel_test' | 'open_channel_mapping',
): Promise<void> {
  await deps.syncLogRepo.create({
    id: crypto.randomUUID(),
    hotelId,
    channel: 'open_channel',
    action,
    status: 'success',
    details: {},
    createdAt: new Date().toISOString(),
  } as any)
}
