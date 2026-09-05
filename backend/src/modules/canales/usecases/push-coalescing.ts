// canales/usecases/push-coalescing.ts — Coalescing de pushes de tarifas (certificación T12).
//
// Un guardado de la UI dispara AMBOS eventos de pricing (rates + restrictions) a milésimas
// de distancia, cada uno con fuente distinta (canal vs base): dos pushes inmediatos se pisan
// el rate mutuamente y el del precio sale antes de que la restricción se persista (carrera
// real vista en prod). Este usecase agrupa la ráfaga por hotel y sale UN push por canal al
// final de la ventana — cuando TODO (precios + CTA/CTD/through) ya está guardado en la DB.
// El conector pricing-canales solo wirea (CLAUDE #3); la lógica vive acá.

export type PushFn = (hotelId: string, channel?: string) => Promise<unknown>

const DEFAULT_DEBOUNCE_MS = 1500

export class PushCoalescer {
  private readonly pending = new Map<string, { timer: any; channels: Set<string> }>()

  constructor(
    private readonly push: PushFn,
    private readonly debounceMs: number = DEFAULT_DEBOUNCE_MS,
    private readonly onError: (hotelId: string, channel: string | undefined, err: unknown) => void = () => {},
    /** Canales con tarifa propia. Se consulta solo en los cambios GLOBALES (ver `flush`). */
    private readonly overrideChannels?: (hotelId: string) => Promise<string[]>,
  ) {}

  /** Agenda un push para el hotel; `channel` con override se acumula con los de la ráfaga. */
  schedule(hotelId: string, channels: Array<string | undefined> = [undefined]): void {
    const entry = this.pending.get(hotelId) ?? { timer: null, channels: new Set<string>() }
    for (const channel of channels) if (channel) entry.channels.add(channel)
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => void this.flush(hotelId), this.debounceMs)
    this.pending.set(hotelId, entry)
  }

  private async flush(hotelId: string): Promise<void> {
    const entry = this.pending.get(hotelId)
    this.pending.delete(hotelId)
    // Dos casos distintos:
    //
    //  - La ráfaga trae canal(es): el hotel editó la tarifa DE ESE canal. Se publica solo eso.
    //  - La ráfaga no trae ninguno: es un cambio GLOBAL —fechas de una temporada, días pintados en
    //    el planning, copiar tarifas al año próximo, CTA/CTD—. Ahí hay que publicar la base Y
    //    DESPUÉS los canales con tarifa propia.
    //
    // Publicar solo la base era el comportamiento hasta el 2026-09-05, y borraba los precios por
    // canal en cada cambio de temporada: medido en producción, la suite pasó de los $330 del canal
    // a $120 —la tarifa base— ocho segundos después de mover la fecha de fin de una temporada, sin
    // haber tocado una sola tarifa.
    const explicit = entry?.channels.size ? [...entry.channels] : null
    const targets: Array<string | undefined> = explicit
      ?? [undefined, ...(await this.resolveOverrides(hotelId))]
    // SECUENCIAL, no en paralelo: todos los pushes escriben sobre los mismos rate plans y el último
    // gana, así que el orden —base primero, canales después— es lo que hace que el canal mande.
    for (const channel of targets) {
      try {
        await this.push(hotelId, channel)
      } catch (err: unknown) {
        this.onError(hotelId, channel, err)
      }
    }
  }

  /** Sin resolver (o si falla) se publica solo la base: es preferible a un precio elegido al azar. */
  private async resolveOverrides(hotelId: string): Promise<string[]> {
    if (!this.overrideChannels) return []
    try {
      return await this.overrideChannels(hotelId)
    } catch (err) {
      this.onError(hotelId, undefined, err)
      return []
    }
  }
}

/** Dependencias del despacho de la grilla de tarifas por fecha (las inyecta `pricing-canales`). */
export interface OverrideDispatchDeps {
  /** Push DELTA: una sola llamada con las celdas tocadas. */
  pushOverrides: (hotelId: string, items: Array<Record<string, unknown>>) => Promise<unknown>
  /** Push CONSOLIDADO por temporadas (el que sabe qué precio va cuando se revierte un override). */
  scheduleConsolidated: (hotelId: string) => void | Promise<void>
  onError: (hotelId: string, err: unknown) => void
}

/**
 * Qué se publica cuando el hotel guarda la grilla de tarifas por fecha.
 *
 * Celdas GUARDADAS → push delta inmediato (no pasa por el coalescer: el coalescer dispara el mapa
 * consolidado de temporadas, que es justo lo que el test 13 de la certificación pide NO mandar en
 * cada cambio). Celdas REVERTIDAS → sí hace falta el consolidado, porque Channex tiene publicado
 * el precio del override y solo el mapa de temporadas sabe con qué reemplazarlo.
 *
 * Fire-and-forget en el delta: guardar la grilla nunca espera a Channex.
 */
export async function dispatchOverridePush(
  deps: OverrideDispatchDeps,
  hotelId: string,
  saved: Array<Record<string, unknown>>,
  removed: number,
): Promise<void> {
  if (saved.length) {
    void deps.pushOverrides(hotelId, saved).catch((err: unknown) => deps.onError(hotelId, err))
  }
  if (removed > 0) await deps.scheduleConsolidated(hotelId)
}
