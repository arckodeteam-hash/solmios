// shared/utils/money.ts — FUENTE ÚNICA del redondeo de dinero y de la tolerancia de centavos.
//
// Había CUATRO copias de `round2` (`rate-resolution.ts`, `reservation-balance.ts`, un local dentro
// de `payment-requests/usecases/stripe-webhook.ts` y otro en `reservas/usecases/reschedule.ts`) y
// CUATRO de la misma constante de epsilon con dos nombres distintos (`BALANCE_EPSILON` en
// `folios/usecases/folio-entries.ts`, `facturas/usecases/pay-invoice.ts` y el webhook;
// `AMOUNT_EPSILON` en `payment-requests/usecases/charge-ceiling.ts`).
//
// Dos redondeos incompatibles sobre el mismo importe (uno con `+ Number.EPSILON`, otro sin) o dos
// epsilon que se divorcian producen el peor bug de un dominio de dinero: un pago que el panel
// acepta y el webhook rechaza por un centavo. Se unifican acá.
//
// `shared/` no es un módulo: importarlo NO viola la regla "nunca import cross-módulo".

/** Redondeo a 2 decimales. `+ Number.EPSILON` corrige la cola binaria de 1.005 → 1.00. */
export function round2(n: number): number {
  const v = Number(n) || 0
  return Math.round((v + Number.EPSILON) * 100) / 100
}

/**
 * Tolerancia de centavos al comparar dos importes (pago vs saldo, cobro vs techo).
 * Sumar N floats redondeados a centavos deja un drift real ≤ 0.01: por debajo de eso, dos
 * importes son EL MISMO importe. Ojo: `accounting/usecases/journal-entry.ts` usa 0.005 a
 * propósito (partida doble, cuadre exacto) — esa NO es esta constante.
 */
export const BALANCE_EPSILON = 0.01
