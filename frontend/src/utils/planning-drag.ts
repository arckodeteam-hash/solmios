// utils/planning-drag.ts — Destino de un arrastre en la grilla del planning (lógica PURA).
//
// Vive fuera del .vue porque acá se rompió algo que en pantalla no se ve venir: arrastrar UNA
// celda podía mover la reserva CUATRO días, y la barra "crecía" sola. En un módulo plano se
// testea sin montar el calendario entero.
//
// Fechas como texto 'YYYY-MM-DD' y comparación lexicográfica, igual que el resto del repo: nada
// de `toISOString()` sobre un `Date` local (en UTC-4, de noche, "hoy" ya es mañana en UTC).

const MS_PER_DAY = 86_400_000

/** Suma días a 'YYYY-MM-DD'. Aritmética en UTC puro: ambos lados usan la misma convención. */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Días enteros entre dos fechas (b − a). Negativo si b es anterior. */
export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / MS_PER_DAY)
}

/** Noches de una estadía. Mínimo 1: una reserva de 0 noches no existe. */
export function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.max(1, daysBetween(checkIn, checkOut))
}

/**
 * Qué se le puede tocar a una reserva arrastrándola, según en qué punto de su vida está.
 *
 * Una reserva con el huésped YA ADENTRO no puede cambiar su fecha de entrada: el huésped llegó
 * ese día, es un hecho. Lo que sí sigue siendo legítimo es cambiarlo de habitación (traslado) y
 * extenderle la salida. Una reserva ya cerrada es historia: no se arrastra.
 *
 * Sin esto, arrastrar la reserva de un huésped alojado le corría la entrada al pasado o al
 * futuro sin que nada lo impidiera —ni acá ni en el backend—, y como esas reservas empiezan
 * antes del rango visible y se dibujan recortadas, al moverse mostraban más noches y parecían
 * "alargarse solas".
 */
export type DragScope = 'full' | 'room-only' | 'none'

export function dragScopeFor(status: string | undefined): DragScope {
  const s = String(status || '').toLowerCase()
  if (s === 'checked_out') return 'none'        // ya se fue: es historia
  if (s === 'checked_in') return 'room-only'    // está adentro: traslado sí, correrle la entrada no
  return 'full'
}

export interface MoveDragInput {
  /** Estadía original, la que se está arrastrando. */
  origCheckIn: string
  origCheckOut: string
  /** Celda donde el usuario agarró la barra (no necesariamente el checkIn: puede venir recortada). */
  anchorDate: string
  /** Celda sobre la que está el cursor ahora. */
  dropDate: string
  /** Hoy, para el tope de "no agendar en el pasado". */
  today: string
}

/**
 * Dónde queda la reserva al arrastrarla para MOVERLA. Las noches NO cambian: mover es mover.
 *
 * El delta se mide contra el ANCLA (dónde agarraste), no contra el checkIn: una reserva que
 * empezó antes del rango visible se dibuja recortada, y anclar al checkIn real haría que la
 * barra saltara al primer movimiento.
 *
 * El tope de "no arrancar en el pasado" usa como piso el MENOR entre hoy y el inicio original.
 * Con el piso en hoy a secas, una reserva que YA empezaba antes de hoy quedaba EMPUJADA HACIA
 * ADELANTE: arrastrar una celda la movía varios días (visto en producción: 30/08→05/09 saltó a
 * 03/09→09/09 de un solo movimiento). Un tope solo puede FRENAR el arrastre en el borde, nunca
 * adelantarlo.
 */
export function moveDragDestination(input: MoveDragInput): { checkIn: string; checkOut: string } {
  const nights = nightsBetween(input.origCheckIn, input.origCheckOut)
  const delta = daysBetween(input.anchorDate, input.dropDate)
  const floor = input.origCheckIn < input.today ? input.origCheckIn : input.today
  let checkIn = addDays(input.origCheckIn, delta)
  if (checkIn < floor) checkIn = floor
  return { checkIn, checkOut: addDays(checkIn, nights) }
}
