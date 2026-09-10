/**
 * El estado de aprobación de una plantilla, mantenido al día sin que nadie apriete un botón.
 *
 * Hasta acá la única forma de enterarse de que Meta aprobó (o rechazó) una plantilla era el botón
 * "Sincronizar" de cada fila. Con Meta tardando horas o días, eso significaba que el panel decía
 * "en revisión" indefinidamente: el hotel podía tener una plantilla aprobada sin saber que ya podía
 * usarla, o una rechazada sin enterarse de que había que corregirla.
 *
 * Dos vías, y las dos hacen falta:
 *  - `aplicarEventoDeEstado` — Meta avisa por el webhook en cuanto decide. Es lo inmediato.
 *  - `sincronizarPendientes` — el cron pregunta cada tanto. Es la red por si un aviso se pierde
 *    (webhook caído, evento no entregado, plantilla enviada antes de dar de alta la URL).
 */

import { mapMetaStatus } from './meta-templates'
import type { WhatsappTemplateDTO } from '../types'

/** Lo que Meta manda en un `message_template_status_update`. */
export interface EventoDeEstado {
  /** El estado nuevo. Meta lo llama `event`. */
  event?: string
  message_template_id?: string | number
  message_template_name?: string
  message_template_language?: string
  /** Presente cuando rechaza. */
  reason?: string
}

export interface TemplateStatusRepo {
  findMany(where?: Record<string, unknown>): Promise<WhatsappTemplateDTO[]>
  update(id: string, patch: Partial<WhatsappTemplateDTO>): Promise<unknown>
}

/**
 * Aplica un aviso de Meta a la copia local.
 *
 * Devuelve la plantilla que se tocó, o `null` si el aviso no corresponde a ninguna nuestra —
 * pasa con las que se crearon directamente en el panel de Meta, y con `hello_world`.
 */
export async function aplicarEventoDeEstado(
  repo: TemplateStatusRepo,
  evento: EventoDeEstado,
): Promise<{ id: string; estado: string } | null> {
  const metaId = evento.message_template_id != null ? String(evento.message_template_id) : ''
  if (!metaId || !evento.event) return null

  const encontradas = await repo.findMany({ metaTemplateId: metaId })
  const plantilla = encontradas[0]
  if (!plantilla) return null

  const estado = mapMetaStatus(evento.event)
  await repo.update(plantilla.id, {
    approvalStatus: estado,
    // Un rechazo trae motivo; una aprobación limpia el motivo viejo, si lo hubiera.
    metaRejectedReason: estado === 'rejected' ? (evento.reason || 'Sin motivo informado') : '',
    metaSyncedAt: new Date().toISOString(),
  } as Partial<WhatsappTemplateDTO>)

  return { id: plantilla.id, estado }
}

/**
 * Le pregunta a Meta por las plantillas de un hotel que siguen esperando respuesta.
 *
 * Solo las `pending` con id de Meta: las que nunca se enviaron no tienen nada que consultar, y una
 * ya resuelta no cambia sola — salvo que Meta la pause después, y eso llega por el webhook.
 */
export async function sincronizarPendientes(
  repo: TemplateStatusRepo,
  hotelId: string,
  sincronizarUna: (plantilla: WhatsappTemplateDTO) => Promise<unknown>,
  onError?: (plantillaId: string, error: unknown) => void,
): Promise<{ revisadas: number; actualizadas: number }> {
  const todas = await repo.findMany({ hotelId })
  const pendientes = todas.filter((t) => t.metaTemplateId && t.approvalStatus === 'pending')

  let actualizadas = 0
  for (const plantilla of pendientes) {
    try {
      await sincronizarUna(plantilla)
      actualizadas++
    } catch (e) {
      // Una plantilla que Meta ya no reconoce (borrada de su panel) no puede frenar a las demás.
      onError?.(plantilla.id, e)
    }
  }
  return { revisadas: pendientes.length, actualizadas }
}
