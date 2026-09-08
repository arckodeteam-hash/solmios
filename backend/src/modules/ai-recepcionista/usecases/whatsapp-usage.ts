// ai-recepcionista/usecases/whatsapp-usage.ts — Cuánto consume cada hotel, y hasta dónde puede.
//
// WhatsApp es un servicio que SOLMI OS le presta al hotel: Meta le cobra a la plataforma y la
// plataforma se lo cobra al hotel. Eso obliga a dos cosas que sin esto no existían:
//
//   · que el hotel VEA su consumo antes de que le llegue la factura, y
//   · que haya un TOPE, porque un hotel que manda 5.000 conversaciones sin límite las paga la
//     plataforma. El corte no es una comodidad: es lo que hace viable el modelo.
//
// El consumo NO se calcula acá. Meta cobra por conversación de 24 h y con precio distinto por
// categoría; contar los mensajes de `message_logs` daría otro número y la diferencia la terminaría
// discutiendo el hotel. Se trae de Meta y se guarda.

import { ConflictError } from 'arckode-framework'
import type { RepositoryAdapter, Logger } from 'arckode-framework'
import type { WhatsappCloudCredentials, ConsumoPorCategoria } from '../../../services/whatsapp-cloud-client'

export interface UsagePort {
  credentialsFor(hotelId: string): Promise<WhatsappCloudCredentials | null>
  getUsage(creds: WhatsappCloudCredentials, desde: Date, hasta: Date): Promise<ConsumoPorCategoria[]>
}

export interface UsageDeps {
  usageRepo: RepositoryAdapter<any>
  /** Lee `plans.limits` y `configuration` para saber el cupo del hotel. */
  cupoPort: CupoPort
  meta: UsagePort
  logger: Logger
}

export interface CupoPort {
  /** Conversaciones por mes que tiene incluidas el hotel. `null` = sin tope. */
  cupoMensual(hotelId: string): Promise<number | null>
}

/** Cupo por defecto cuando el plan no dice nada. Conservador a propósito: el que paga es la plataforma. */
export const CUPO_POR_DEFECTO = 1000

/** A partir de qué porcentaje se avisa. Antes del corte, no después. */
export const UMBRAL_AVISO = 0.8

export interface ResumenConsumo {
  /** YYYY-MM */
  mes: string
  conversaciones: number
  /** Lo que informó Meta. 0 si no lo informa (no significa gratis). */
  costo: number
  moneda: string | null
  porCategoria: Array<{ category: string; conversations: number; cost: number }>
  cupo: number | null
  /** 0 a 1. `null` cuando no hay tope. */
  usoDelCupo: number | null
  cerca: boolean
  agotado: boolean
  ultimaSync: string | null
}

const mesDe = (fecha: string): string => fecha.slice(0, 7)

/** Mes calendario en UTC, que es como Meta agrupa. */
export function rangoDelMes(mes: string): { desde: Date; hasta: Date } {
  const [y, m] = mes.split('-').map(Number)
  return { desde: new Date(Date.UTC(y, m - 1, 1)), hasta: new Date(Date.UTC(y, m, 1)) }
}

export function mesActual(ahora = new Date()): string {
  return ahora.toISOString().slice(0, 7)
}

/**
 * Trae de Meta el consumo del período y lo guarda.
 *
 * Reemplaza las filas del mismo día y categoría en vez de sumar: Meta corrige sus propios números
 * durante las horas siguientes, y acumular convertiría una corrección en un cobro doble.
 */
export async function sincronizarConsumo(
  deps: UsageDeps,
  hotelId: string,
  mes = mesActual(),
): Promise<{ guardados: number }> {
  const creds = await deps.meta.credentialsFor(hotelId)
  if (!creds) throw new ConflictError('Este hotel todavía no conectó su WhatsApp.')

  const { desde, hasta } = rangoDelMes(mes)
  const puntos = await deps.meta.getUsage(creds, desde, hasta)
  const ahora = new Date().toISOString()

  for (const p of puntos) {
    const existentes = await deps.usageRepo.findMany({ hotelId, date: p.date, category: p.category } as any)
    const fila = {
      hotelId, date: p.date, category: p.category,
      conversations: p.conversations, cost: p.cost, currency: p.currency ?? null, syncedAt: ahora,
    }
    if (existentes[0]) await deps.usageRepo.update(existentes[0].id, fila as any)
    else await deps.usageRepo.create({ id: crypto.randomUUID(), ...fila } as any)
  }

  deps.logger.info('Consumo de WhatsApp sincronizado', { hotelId, mes, puntos: puntos.length })
  return { guardados: puntos.length }
}

/** Lo que el hotel ve en su panel, y lo que la plataforma factura. */
export async function consumoDelMes(
  deps: Pick<UsageDeps, 'usageRepo' | 'cupoPort'>,
  hotelId: string,
  mes = mesActual(),
): Promise<ResumenConsumo> {
  const filas = (await deps.usageRepo.findMany({ hotelId } as any)).filter((f: any) => mesDe(String(f.date)) === mes)

  const porCategoria = new Map<string, { conversations: number; cost: number }>()
  let conversaciones = 0
  let costo = 0
  let moneda: string | null = null
  let ultimaSync: string | null = null

  for (const f of filas) {
    const c = Number(f.conversations ?? 0)
    const k = Number(f.cost ?? 0)
    conversaciones += c
    costo += k
    if (f.currency && !moneda) moneda = String(f.currency)
    if (f.syncedAt && (!ultimaSync || String(f.syncedAt) > ultimaSync)) ultimaSync = String(f.syncedAt)

    const acc = porCategoria.get(String(f.category)) ?? { conversations: 0, cost: 0 }
    acc.conversations += c
    acc.cost += k
    porCategoria.set(String(f.category), acc)
  }

  const cupo = await deps.cupoPort.cupoMensual(hotelId)
  const usoDelCupo = cupo && cupo > 0 ? conversaciones / cupo : null

  return {
    mes, conversaciones, costo: Math.round(costo * 100) / 100, moneda,
    porCategoria: [...porCategoria.entries()]
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.conversations - a.conversations),
    cupo,
    usoDelCupo,
    cerca: usoDelCupo !== null && usoDelCupo >= UMBRAL_AVISO && usoDelCupo < 1,
    agotado: usoDelCupo !== null && usoDelCupo >= 1,
    ultimaSync,
  }
}

/**
 * La guarda del corte: se llama ANTES de iniciar una conversación nueva.
 *
 * Solo frena lo que ARRANCA una conversación (una plantilla). Responder dentro de la ventana de
 * 24 h no se corta nunca: esa conversación ya está pagada y dejar a un huésped sin respuesta a
 * mitad de una charla es peor que el sobrecosto.
 */
export async function assertPuedeIniciarConversacion(
  deps: Pick<UsageDeps, 'usageRepo' | 'cupoPort'>,
  hotelId: string,
): Promise<void> {
  const resumen = await consumoDelMes(deps, hotelId)
  if (!resumen.agotado) return
  throw new ConflictError(
    `Este hotel alcanzó su tope de ${resumen.cupo} conversaciones de WhatsApp del mes ` +
    `(lleva ${resumen.conversaciones}). Podés seguir respondiendo las charlas abiertas; para ` +
    'iniciar nuevas hay que ampliar el plan.',
  )
}

/**
 * Cupo del hotel: lo que diga su plan, y si no, el default.
 *
 * `limits.whatsappConversations` en la tabla `plans`. Un `0` explícito significa "sin WhatsApp",
 * distinto de "no configurado" — por eso se distingue `null` de `0`.
 */
export function cupoDesdeLimits(limits: unknown): number | null {
  if (!limits || typeof limits !== 'object') return CUPO_POR_DEFECTO
  const v = (limits as Record<string, unknown>).whatsappConversations
  if (v === null) return null            // explícitamente sin tope
  if (typeof v === 'number' && v >= 0) return v
  return CUPO_POR_DEFECTO
}
