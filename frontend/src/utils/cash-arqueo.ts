// utils/cash-arqueo.ts — Matemática PURA del arqueo de cierre de caja (sin Vue, testeable sola).
//
// QA-UI caja-2026-08-22 (H2/H3): el modal de cierre prellenaba el contado con el esperado y su
// matemática no cerraba a la vista (sumaba todos los métodos contra un esperado solo-efectivo).
// Toda la cuenta del arqueo vive acá para que la UI solo muestre lo que estas funciones devuelven.
//
// `round2`/`BALANCE_EPSILON` son espejo EXACTO de backend/src/shared/utils/money.ts (misma
// fórmula, mismo epsilon): si la UI decidiera que "cuadra" algo que el backend rechaza (o al
// revés), el cajero vería un error después de contar todo. El backend no se importa acá para no
// arrastrar deps de node — mismo criterio que types/currency.ts.

export const BALANCE_EPSILON = 0.01

/** Redondeo a 2 decimales. `+ Number.EPSILON` corrige la cola binaria de 1.005 → 1.00. */
export function round2(n: number): number {
  const v = Number(n) || 0
  return Math.round((v + Number.EPSILON) * 100) / 100
}

/** Denominaciones físicas (billetes y monedas) por moneda ISO del hotel, de mayor a menor.
 * Si la moneda del hotel no está acá, la UI ofrece campo libre de total contado. */
export const CASH_DENOMINATIONS: Record<string, number[]> = {
  USD: [100, 50, 20, 10, 5, 2, 1, 0.25, 0.1, 0.05, 0.01],
  EUR: [500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01],
  DOP: [2000, 1000, 500, 200, 100, 50, 25, 20, 10, 5, 1],
  MXN: [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5],
  COP: [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50],
  ARS: [20000, 10000, 2000, 1000, 500, 200, 100, 50, 20, 10],
  PEN: [200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1],
  CLP: [20000, 10000, 5000, 2000, 1000, 500, 100, 50, 10],
  GTQ: [200, 100, 50, 20, 10, 5, 1, 0.5, 0.25],
}

export function denominationsFor(currency: string | undefined | null): number[] {
  return CASH_DENOMINATIONS[(currency || '').toUpperCase()] || []
}

/** Esperado en cajón (efectivo): fondo + ingresos efectivo − egresos efectivo. DERIVACIÓN ÚNICA.
 *
 * El número protagonista de la caja y la cuenta visible que lo arma salen de ACÁ, nunca del
 * `expected` que traiga el payload del reconcile: si ese campo difiere de la suma de SUS PROPIOS
 * movimientos (saldo legacy guardado en el turno, backend viejo que no exponía los getters),
 * gana la suma de movimientos — es la auditable. Derivar el hero de los mismos términos que la
 * cuenta imprime hace que los dos números no PUEDAN discrepar. */
export function expectedCashInDrawer(opening: number, cashIncome: number, cashExpense: number): number {
  return round2(round2(opening) + round2(cashIncome) - round2(cashExpense))
}

/** Σ cantidad × valor de cada denominación. Las cantidades vacías ('' del v-model) no suman. */
export function sumDenominations(counts: Record<string, number | string | null>, denoms: number[]): number {
  let total = 0
  for (const d of denoms) {
    const raw = counts[String(d)]
    if (raw === null || raw === undefined || raw === '') continue
    const qty = Number(raw)
    if (!Number.isNaN(qty)) total += d * qty
  }
  return round2(total)
}

export interface MethodArqueo {
  method: string
  /** Esperado del método: efectivo = fondo + neto de movimientos cash; el resto = neto del método. */
  expected: number
  /** Contado por el cajero. `null` = todavía no lo contó. */
  counted: number | null
  difference: number | null
}

/** Normaliza lo que deja v-model.number en un input numérico: '' o basura → null (sin contar). */
function toCounted(raw: number | string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  const n = Number(raw)
  return Number.isNaN(n) ? null : round2(n)
}

export interface ArqueoTotals {
  methods: MethodArqueo[]
  totalExpected: number
  totalCounted: number | null
  totalDifference: number | null
  /** true si falta contar algún método (no dejas cerrar un arqueo a medias). */
  pendingCount: boolean
  /** Cualquier diferencia (por método o total) fuera del centavo de tolerancia exige motivo. */
  requiresReason: boolean
}

/** Desglose esperado vs contado por método + totales que cierran a la vista:
 *  total contado = Σ contados, diferencia total = total contado − total esperado.
 *
 *  `byMethodNet` es el neto firmado por método (ingreso +, egreso −) que devuelve el reconcile
 *  del backend. El efectivo esperado en cajón suma el fondo inicial (el resto de los métodos no
 *  tiene fondo: la plata con tarjeta/transferencia nunca entró al cajón). */
export function buildArqueo(input: {
  opening: number
  byMethodNet: Record<string, number>
  countedByMethod: Record<string, number | string | null>
}): ArqueoTotals {
  const keys = new Set<string>(['cash', ...Object.keys(input.byMethodNet)])
  const methods: MethodArqueo[] = []
  let totalExpected = 0
  let totalCounted = 0
  let pendingCount = false

  for (const method of keys) {
    const net = Number(input.byMethodNet[method]) || 0
    const expected = method === 'cash' ? round2(input.opening + net) : round2(net)
    const counted = toCounted(input.countedByMethod[method])
    methods.push({ method, expected, counted, difference: counted === null ? null : round2(counted - expected) })
    totalExpected = round2(totalExpected + expected)
    if (counted === null) pendingCount = true
    else totalCounted = round2(totalCounted + counted)
  }
  // Efectivo siempre primero (es el cajón físico), el resto alfabético.
  methods.sort((a, b) => (a.method === 'cash' ? -1 : b.method === 'cash' ? 1 : a.method.localeCompare(b.method)))

  const totalDifference = pendingCount ? null : round2(totalCounted - totalExpected)
  const anyMethodOff = methods.some(m => m.difference !== null && Math.abs(m.difference) > BALANCE_EPSILON)
  const requiresReason = anyMethodOff || (totalDifference !== null && Math.abs(totalDifference) > BALANCE_EPSILON)

  return {
    methods,
    totalExpected,
    totalCounted: pendingCount ? null : totalCounted,
    totalDifference,
    pendingCount,
    requiresReason,
  }
}
