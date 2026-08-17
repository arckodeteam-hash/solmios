// utils/occupancy-groups.ts — Agrupa la matriz de ocupaciones para PRESENTARLA.
//
// La matriz que arma el backend (`occupancy-matrix.ts`) muestra una fila por ocupación,
// como el motor de la competencia — y esa es la regla cuando los precios DIFIEREN: la
// fila "para 4" a otro precio es información que el huésped necesita antes de pagar.
//
// El problema es el caso plano: el hotel cargó UNA tarifa por tipo y todas las
// ocupaciones cotizan igual. "Para 1 $130 · para 2 $130 · para 3 $130" no informa nada
// — es el mismo número tres veces, y lee como bug (reportado por el dueño 2026-08-17).
//
// Este módulo colapsa SOLO lo redundante: corridas de ocupaciones contiguas,
// vendibles y de IDÉNTICO precio se agrupan para mostrar el número una sola vez.
// Las ocupaciones siguen existiendo como opciones clickeables dentro del grupo —
// elegir "para 2" sigue propagando occupancy=2 al flujo de reserva (multi-habitación,
// conteo de huéspedes). Lo que se deduplica es el PRECIO pintado, nunca la elección.
//
// Fuera del grupo quedan, como filas individuales de siempre:
//   - las ocupaciones NO vendibles (available:false) — la regla del dueño es que se
//     vean deshabilitadas CON su motivo, no que desaparezcan ni se fundan en un grupo;
//   - las vendibles con precio distinto — ahí la fila por ocupación ES la información.
import type { RoomOccupancyRate } from '@/types/booking'

/** Una fila que se pinta como hoy (gris con motivo, o precio distinto a sus vecinas). */
export interface OccupancySingle {
  kind: 'single'
  row: RoomOccupancyRate
}

/** Corrida ≥2 de ocupaciones vendibles contiguas con el mismo precio. */
export interface OccupancyGroup {
  kind: 'group'
  rows: RoomOccupancyRate[]
}

export type OccupancyEntry = OccupancySingle | OccupancyGroup

const samePrice = (a: RoomOccupancyRate, b: RoomOccupancyRate): boolean =>
  a.price === b.price && a.pricePerNight === b.pricePerNight

const groupable = (row: RoomOccupancyRate): boolean => row.available === true

/**
 * Ordena por ocupación y agrupa las corridas agrupables de igual precio.
 * Puro: sin DOM, sin store — toda la lógica testeable de un vistazo.
 */
export function groupOccupancyRows(occupancies: RoomOccupancyRate[]): OccupancyEntry[] {
  const sorted = [...occupancies].sort((a, b) => a.occupancy - b.occupancy)

  const entries: OccupancyEntry[] = []
  let run: RoomOccupancyRate[] = []

  const flushRun = () => {
    if (run.length === 0) return
    if (run.length === 1) {
      entries.push({ kind: 'single', row: run[0]! })
    } else {
      entries.push({ kind: 'group', rows: [...run] })
    }
    run = []
  }

  for (const row of sorted) {
    // Extender exige que la fila nueva Y la última del run sean vendibles al mismo precio:
    // una gris con precio cargado (stop_sell) no puede arrastrarse a un grupo.
    const canExtend =
      groupable(row) &&
      run.length > 0 &&
      groupable(run[run.length - 1]!) &&
      samePrice(run[run.length - 1]!, row)
    if (canExtend) {
      run.push(row)
    } else {
      flushRun()
      run = [row]
    }
  }
  flushRun()

  return entries
}
