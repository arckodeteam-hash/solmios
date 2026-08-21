// subscriptions/usecases/public-founder-discount.ts — El % del programa Hotel Fundador, público.
//
// CFG-1: la landing `/hotel-fundador` derivaba el precio fundador de `VITE_FOUNDER_DISCOUNT_PCT`,
// un valor congelado en el build, mientras la verdad del negocio vive en
// `special_category_config.discountPct` (`model.ts`), editable desde /admin y usada por
// `admin/usecases/special-conditions.ts` para el descuento que REALMENTE se aplica al cobrar.
// Que /admin baje el descuento del 30% al 20% y la página siga prometiendo 30% es la misma
// divergencia precio-mostrado vs precio-cobrado que GH-31 vino a cerrar para el precio base.
//
// Es público a propósito: el número ya se publica en la página. No se expone nada más de la fila
// (cupos, secuencia, ocupación) — eso sí es interno.

import type { RepositoryAdapter } from 'arckode-framework'

/** Categorías que la página de Fundador anuncia. `pioneer` es otro programa, con su propia página. */
export const FOUNDER_CATEGORY_KEYS = ['founder_one', 'founder_two'] as const

/** Un % de descuento sólo es usable si es un número dentro de (0, 100). */
function usablePct(raw: unknown): number | null {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 && n < 100 ? n : null
}

/**
 * Descuento vigente del programa Fundador, o `null` si no hay configuración usable (ahí el
 * frontend muestra su copy de reserva en vez de inventar un precio).
 *
 * Criterio: manda la categoría que está `open` — es la que un hotel puede tomar HOY, y es el
 * descuento que `applySpecialConditions` le va a aplicar. Si ninguna está abierta (cupos llenos o
 * programa cerrado) se muestra el mayor de las configuradas: la página sigue describiendo el
 * programa, y ese número sale igual de la base y no de un literal.
 */
export async function publicFounderDiscount(
  repo: Pick<RepositoryAdapter<any>, 'findMany'> | undefined | null,
): Promise<number | null> {
  if (!repo) return null
  const rows = await repo.findMany({}) as Array<Record<string, unknown>>
  const founders = (rows ?? []).filter((r) => (FOUNDER_CATEGORY_KEYS as readonly string[]).includes(String(r?.key ?? '')))
  if (!founders.length) return null

  const open = founders.find((r) => String(r?.status ?? '') === 'open')
  const fromOpen = usablePct(open?.discountPct)
  if (fromOpen !== null) return fromOpen

  const configured = founders.map((r) => usablePct(r?.discountPct)).filter((n): n is number => n !== null)
  return configured.length ? Math.max(...configured) : null
}
