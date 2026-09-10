/**
 * Meta avisa por el MISMO webhook cuando decide sobre una plantilla (`message_template_status_update`).
 *
 * Sin esto, el panel se quedaba en "en revisión" hasta que alguien apretara "Sincronizar" fila por
 * fila: un hotel podía tener una plantilla aprobada sin saber que ya podía usarla, o una rechazada
 * sin enterarse de que había que corregirla.
 *
 * Las plantillas viven en `marketing`; el webhook lo recibe este módulo. El puerto es lo mínimo que
 * hace falta para cruzar esa frontera sin que los módulos se importen entre sí.
 */

import type { Logger } from 'arckode-framework'

/** Lo que Meta manda adentro de `changes[].value` para este campo. */
export interface TemplateStatusEvent {
  event?: string
  message_template_id?: string | number
  message_template_name?: string
  message_template_language?: string
  reason?: string
}

export interface TemplateStatusPort {
  aplicarEstado(evento: TemplateStatusEvent): Promise<{ id: string; estado: string } | null>
}

/** El campo del webhook que trae estos avisos. */
export const CAMPO_ESTADO_PLANTILLA = 'message_template_status_update'

export async function aplicarEstadoDePlantilla(
  deps: { port: TemplateStatusPort; logger: Logger },
  evento: TemplateStatusEvent,
): Promise<{ aplicado: boolean }> {
  try {
    const r = await deps.port.aplicarEstado(evento)
    if (!r) {
      // Pasa con las plantillas creadas directo en el panel de Meta y con `hello_world`, la de
      // ejemplo que Meta crea sola: no son nuestras, no hay nada que actualizar.
      deps.logger.info('Aviso de plantilla que no es del PMS', {
        plantilla: evento.message_template_name, estado: evento.event,
      })
      return { aplicado: false }
    }
    deps.logger.info('Estado de plantilla actualizado desde Meta', {
      plantillaId: r.id, estado: r.estado, nombre: evento.message_template_name,
    })
    return { aplicado: true }
  } catch (e: any) {
    // Nunca propagar: un error acá haría que Meta reintente el mismo aviso indefinidamente.
    deps.logger.error('No se pudo aplicar el estado de la plantilla', {
      plantilla: evento.message_template_name, error: String(e?.message ?? e),
    })
    return { aplicado: false }
  }
}
