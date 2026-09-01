// bookingengine/usecases/rate-resolution.ts — Resolución de PRECIO POR NOCHE (lógica pura).
//
// La implementación se movió a `shared/utils/rate-resolution.ts` porque el planning del panel
// (`reservas/usecases/reprice.ts`, repricear una reserva que se mueve de habitación o de fechas)
// necesita exactamente la MISMA cadena de precio (season_assignments → room_rates → fallback
// `rooms.basePrice`) y los módulos no se importan entre sí. Mismo precedente que
// `canales/usecases/availability.ts` → `shared/utils/daily-availability.ts`.
//
// Acá se re-exporta para no tocar callers ni tests: `public-calendar.ts`, `public-rates.ts` y
// `stay-restrictions.ts` siguen importando de este archivo y el comportamiento es idéntico.
// La documentación de la cadena de precio y sus reglas vive en el archivo de `shared`.

export {
  buildSeasonByDate,
  baseRatesOnly,
  pickRate,
  pickCoveringRate,
  occupanciesForStay,
  isOccupancyQuotable,
  ratePrice,
  resolveNightlyPrice,
  sumStayPrice,
  overrideRateFor,
} from '../../../shared/utils/rate-resolution'

// STR-1: `round2` NO pasa por acá. Su único origen es `shared/utils/money.ts`; encadenarlo por dos
// re-exports más dejaba tres rutas de import para el mismo símbolo y un `rg 'utils/money'` no
// encontraba a todos los consumidores.
