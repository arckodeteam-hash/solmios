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
  ) {}

  /** Agenda un push para el hotel; `channel` con override se acumula con los de la ráfaga. */
  schedule(hotelId: string, channels: Array<string | undefined> = [undefined]): void {
    const entry = this.pending.get(hotelId) ?? { timer: null, channels: new Set<string>() }
    for (const channel of channels) if (channel) entry.channels.add(channel)
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => this.flush(hotelId), this.debounceMs)
    this.pending.set(hotelId, entry)
  }

  private flush(hotelId: string): void {
    const entry = this.pending.get(hotelId)
    this.pending.delete(hotelId)
    // Con override de canal(es): un push por canal (el push con canal prefiere el override).
    // Sin canal: la base. El push lee rates + restrictions ya persistidos → viaja todo junto.
    const targets: Array<string | undefined> = entry?.channels.size ? [...entry.channels] : [undefined]
    for (const channel of targets) {
      void this.push(hotelId, channel).catch((err: unknown) => this.onError(hotelId, channel, err))
    }
  }
}
