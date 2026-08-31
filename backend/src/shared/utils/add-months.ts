// shared/utils/add-months.ts — Sumar meses a una fecha SIN que se desborde al mes siguiente.
//
// `new Date(y, m + 1, 31)` no da "el 31 del mes que viene": si ese mes no tiene 31 días, el
// constructor sigue contando y devuelve el 1 del subsiguiente. Lo mismo hace `setMonth()`.
// Un "mes gratis" otorgado el 31 de agosto vencía el 1 de OCTUBRE (un día regalado de más), y
// un 31 de enero + 1 mes caía el 3 de marzo. Es la clase de bug que solo aparece los días 29-31,
// así que la suite lo destapó recién el 31 de agosto y frenó el deploy.
//
// El criterio acá es el mismo que usan las suscripciones: si el día no existe en el mes destino,
// se recorta al último día de ese mes (31/ene + 1 mes = 28/feb, o 29 en bisiesto).
//
// Conserva la hora del original: "un mes desde ahora" termina a la misma hora, no a medianoche.

/** Días que tiene ese mes (`month` 0-indexado, igual que `Date`). Contempla bisiestos. */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

/**
 * Devuelve una fecha NUEVA con `months` meses sumados (o restados, si es negativo).
 * No muta la que recibe.
 */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime())
  const day = d.getDate()
  // Parado en el día 1 ningún mes desborda; recién después se reubica el día.
  d.setDate(1)
  d.setMonth(d.getMonth() + months)
  d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth())))
  return d
}
