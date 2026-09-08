// shared/usecases/whatsapp-usage-cron.ts — Trae de Meta el consumo de WhatsApp de cada hotel.
//
// Molde: trial-reminder-cron.ts.
//
// Sin esto, el consumo del hotel se quedaría en el número de la última vez que alguien abrió la
// pantalla, y el corte por tope decidiría sobre datos viejos: un hotel podría pasarse del cupo sin
// que nadie lo frene, y esas conversaciones las paga la plataforma.
//
// Meta corrige sus propios números durante las horas siguientes, así que se re-sincroniza el mes
// entero en cada pasada (la escritura reemplaza el día, no suma). Barato: son pocos días por hotel.

export function createWhatsappUsageCron(
  resolveModule: (name: string) => any,
  logger: any,
): (mes?: string) => Promise<{ hoteles: number; sincronizados: number }> {
  return async (mes?: string): Promise<{ hoteles: number; sincronizados: number }> => {
    try {
      const ai = resolveModule('ai-recepcionista')
      if (!ai || typeof ai.listarConexiones !== 'function') {
        logger.warn('whatsapp-usage-cron: ai-recepcionista no disponible')
        return { hoteles: 0, sincronizados: 0 }
      }

      const conexiones = (await ai.listarConexiones()) as Array<{ hotelId: string; estado: string }>
      const conectados = conexiones.filter((c) => c.estado === 'connected')
      let sincronizados = 0

      for (const c of conectados) {
        try {
          await ai.sincronizarConsumo(c.hotelId, mes)
          sincronizados++
        } catch (e: any) {
          // Un hotel con el token vencido no puede frenar la sincronización de los demás.
          logger.warn('whatsapp-usage-cron: hotel sin sincronizar', { hotelId: c.hotelId, error: e?.message })
        }
      }

      if (conectados.length > 0) {
        logger.info('whatsapp-usage-cron completado', { hoteles: conectados.length, sincronizados })
      }
      return { hoteles: conectados.length, sincronizados }
    } catch (e: any) {
      logger.warn('whatsapp-usage-cron falló', { error: e?.message })
      return { hoteles: 0, sincronizados: 0 }
    }
  }
}
