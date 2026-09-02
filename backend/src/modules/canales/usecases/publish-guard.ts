// canales/usecases/publish-guard.ts — ¿Este hotel puede publicar ARI ahora mismo?
//
// Son DOS condiciones y hasta ahora solo se miraba una:
//   1. tener propiedad en Channex (sin ella no hay dónde publicar), y
//   2. tener la sincronización ACTIVA.
//
// `syncEnabled` existía en el modelo desde el principio, pero solo lo respetaba la ingesta de
// reservas (`booking-sync.ts` filtra los hoteles con la marca en 1). Los envíos SALIENTES
// —disponibilidad, tarifas por temporada y tarifas por fecha— nunca lo miraron: un hotel con la
// sincronización apagada seguía publicando precios en las OTAs igual. Cualquier botón de
// "desconectar" del panel era decorativo.
//
// La excepción deliberada es el sync MANUAL ("Forzar Sync Ahora"): apretarlo es pedir publicar,
// así que reactiva la sincronización en vez de quedar bloqueado por ella (ver `sync-property.ts`).

export interface PublishableConfig {
  channexPropertyId?: string | null
  syncEnabled?: number
}

/** Sincronización activa. Sin la marca (config vieja) se asume activa: es el default del modelo. */
export function isSyncActive(cfg: PublishableConfig | null | undefined): boolean {
  return (cfg?.syncEnabled ?? 1) === 1
}

/**
 * Publicable = hay propiedad Y la sincronización está activa.
 *
 * Es un type predicate a propósito: los pushes usan `cfg.channexPropertyId` justo después, y sin
 * el narrowing habría que repetir el `!` en cada uso (o perderlo con un `as`).
 */
export function canPublish<T extends PublishableConfig>(
  cfg: T | null | undefined,
): cfg is T & { channexPropertyId: string } {
  return !!cfg?.channexPropertyId && isSyncActive(cfg)
}
