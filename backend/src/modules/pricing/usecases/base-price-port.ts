// pricing/usecases/base-price-port.ts — Cómo pricing fija el precio base de un tipo de habitación.
//
// El precio base vive en `rooms.basePrice` (ver shared/utils/base-price.ts): es de la habitación, no de la
// tarifa. Pero se EDITA desde la grilla de tarifas, que es donde el hotel piensa los precios. Como
// pricing no puede importar habitaciones (CLAUDE #3), el connector `pricing-habitaciones` inyecta
// este puerto.
//
// Sin puerto inyectado (tests mínimos, o un arranque sin ese connector) `applyBasePrices` no hace
// nada y devuelve 0: el guardado de tarifas sigue funcionando con el base que ya estaba.

/** Lo que la grilla manda junto con las tarifas: un precio base por tipo de habitación. */
export interface BasePriceInput { roomType?: string; basePrice?: unknown }

export interface BasePricePort {
  /** Devuelve cuántas habitaciones cambiaron de precio. */
  setTypeBasePrice: (hotelId: string, roomType: string, basePrice: unknown) => Promise<number>
}

/**
 * Aplica los precios base ANTES de guardar las tarifas: el `price` de cada fila se deriva del base,
 * así que si se aplicaran después, el guardado usaría el base viejo y el hotel vería el precio
 * anterior hasta volver a guardar.
 *
 * Un tipo repetido en la lista se aplica una sola vez (el último gana), que es lo que hace la grilla
 * al mandar una entrada por fila.
 */
export async function applyBasePrices(
  port: BasePricePort | null, hotelId: string, input: readonly BasePriceInput[] | undefined,
): Promise<number> {
  if (!port || !Array.isArray(input) || input.length === 0) return 0
  const byType = new Map<string, unknown>()
  for (const b of input) {
    const type = String(b?.roomType || '').trim()
    if (type) byType.set(type, b.basePrice)
  }
  let touched = 0
  for (const [type, price] of byType) touched += await port.setTypeBasePrice(hotelId, type, price)
  return touched
}
