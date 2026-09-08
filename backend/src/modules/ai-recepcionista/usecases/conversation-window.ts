// ai-recepcionista/usecases/conversation-window.ts — La ventana de 24 horas de WhatsApp.
//
// Regla de Meta, no nuestra: pasadas 24 h desde el último mensaje DEL HUÉSPED, el hotel solo puede
// escribirle con una plantilla aprobada. Fuera de eso, Meta rechaza el envío.
//
// Se calcula con el último mensaje ENTRANTE, nunca con el último del hilo: una respuesta del hotel
// no reabre nada. Es fácil de equivocar y el error no se nota hasta que Meta rechaza en producción.

export const VENTANA_MS = 24 * 60 * 60 * 1000

export interface EstadoVentana {
  abierta: boolean
  /** Minutos que quedan. 0 cuando está cerrada. El panel lo muestra siempre, no solo al vencer. */
  minutosRestantes: number
  expiraEn: string | null
}

export function estadoDeVentana(lastInboundAt: string | null | undefined, ahora = Date.now()): EstadoVentana {
  if (!lastInboundAt) return { abierta: false, minutosRestantes: 0, expiraEn: null }

  const desde = Date.parse(lastInboundAt)
  if (!Number.isFinite(desde)) return { abierta: false, minutosRestantes: 0, expiraEn: null }

  const vence = desde + VENTANA_MS
  const restante = vence - ahora
  return {
    abierta: restante > 0,
    minutosRestantes: restante > 0 ? Math.floor(restante / 60000) : 0,
    expiraEn: new Date(vence).toISOString(),
  }
}

/** Atajo para los guardas: la pregunta que se hace el servidor antes de dejar mandar texto libre. */
export function ventanaAbierta(lastInboundAt: string | null | undefined, ahora = Date.now()): boolean {
  return estadoDeVentana(lastInboundAt, ahora).abierta
}
