// subscriptions/usecases/founder-countdown.ts — Contador cíclico de /hotel-fundador.
//
// Antes la landing traía la fecha límite HARDCODEADA en el frontend (`FOUNDER_DEADLINE =
// new Date('2026-08-26...')`), y al pasar esa fecha el contador se quedaba clavado en 00:00:00:00
// para siempre — nadie lo "reiniciaba" porque no había desde dónde. Acá el ciclo se calcula
// siempre contra un ancla fija: no hay una fecha límite que guardar ni reiniciar a mano, el
// módulo (%) hace que arranque otro ciclo idéntico apenas se cumple el anterior.
//
// "¿Está prendido? ¿de cuántos días es cada ciclo?" lo decide el super-admin
// (`subscription_settings.founderCountdownEnabled/founderCountdownDurationDays`, módulo `admin`,
// llega por connector — mismo patrón que `signup-policy.ts`). Acá solo se valida y se expone el
// ancla fija, para que el frontend pueda recalcular el ciclo siguiente sin volver a pedirle nada
// al backend cuando el actual llega a cero.

const DEFAULT_DURATION_DAYS = 90 // ≈ 3 meses

// Ancla fija, sin significado de negocio — solo fija la FASE del ciclo (cuándo cae cada corte
// de `durationDays`). No hace falta que sea editable: correrla unos días de una vez no cambia
// el comportamiento, sólo en qué punto del ciclo arranca cada visitante.
export const FOUNDER_COUNTDOWN_ANCHOR_ISO = '2026-01-01T00:00:00.000Z'

export interface FounderCountdownConfig {
  enabled: boolean
  durationDays: number
}

export interface PublicFounderCountdown {
  enabled: boolean
  durationDays: number
  /** Ancla fija del ciclo (ver comentario arriba) — el frontend calcula el corte vigente contra esto. */
  anchorAt: string
}

/** Config vigente. Un fallo de lectura NO rompe la página pública: el contador simplemente se apaga. */
export async function readFounderCountdown(
  read?: () => Promise<FounderCountdownConfig>,
): Promise<PublicFounderCountdown> {
  if (!read) return { enabled: false, durationDays: DEFAULT_DURATION_DAYS, anchorAt: FOUNDER_COUNTDOWN_ANCHOR_ISO }
  try {
    const cfg = await read()
    const durationDays = Number(cfg?.durationDays)
    return {
      enabled: cfg?.enabled === true,
      durationDays: Number.isFinite(durationDays) && durationDays > 0 ? durationDays : DEFAULT_DURATION_DAYS,
      anchorAt: FOUNDER_COUNTDOWN_ANCHOR_ISO,
    }
  } catch {
    return { enabled: false, durationDays: DEFAULT_DURATION_DAYS, anchorAt: FOUNDER_COUNTDOWN_ANCHOR_ISO }
  }
}
