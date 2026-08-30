// accounting/usecases/seed-chart-of-accounts.ts — Plan de cuentas base hotelero (CTB-1.3).
// Idempotente por hotel: no duplica las cuentas ya existentes (match por `code`).
// Ver openspec/changes/contabilidad-tesoreria/design.md §plan de cuentas base.
import type { RepositoryAdapter } from 'arckode-framework'
import type { AccountDTO, AccountType } from '../types'

interface SeedAccount { code: string; name: string; type: AccountType; postable: boolean }

/** Catálogo base (DGII/RD-aware, editable por el contador). Los grupos (no postable) dan la jerarquía. */
export const BASE_CHART: SeedAccount[] = [
  { code: '1', name: 'Activo', type: 'asset', postable: false },
  { code: '1.1', name: 'Activo Corriente', type: 'asset', postable: false },
  { code: '1.1.01', name: 'Caja', type: 'asset', postable: true },
  { code: '1.1.02', name: 'Bancos', type: 'asset', postable: true },
  { code: '1.1.03', name: 'Cuentas por Cobrar Clientes', type: 'asset', postable: true },
  { code: '1.1.04', name: '{tax} Adelantado', type: 'asset', postable: true },
  { code: '1.2', name: 'Activo Fijo', type: 'asset', postable: false },
  { code: '2', name: 'Pasivo', type: 'liability', postable: false },
  { code: '2.1', name: 'Pasivo Corriente', type: 'liability', postable: false },
  { code: '2.1.01', name: 'Cuentas por Pagar Proveedores', type: 'liability', postable: true },
  { code: '2.1.02', name: '{tax} por Pagar', type: 'liability', postable: true },
  { code: '2.1.03', name: 'Depósitos de Huéspedes', type: 'liability', postable: true },
  { code: '2.1.04', name: 'Ingresos Diferidos', type: 'liability', postable: true },
  { code: '2.1.05', name: 'Propinas por Pagar', type: 'liability', postable: true },
  { code: '3', name: 'Patrimonio', type: 'equity', postable: false },
  { code: '3.1', name: 'Capital', type: 'equity', postable: false },
  { code: '3.1.01', name: 'Capital Social', type: 'equity', postable: true },
  { code: '3.2', name: 'Resultados', type: 'equity', postable: false },
  { code: '3.2.01', name: 'Resultados Acumulados', type: 'equity', postable: true },
  { code: '4', name: 'Ingresos', type: 'income', postable: false },
  { code: '4.1', name: 'Ingresos Operativos', type: 'income', postable: false },
  { code: '4.1.01', name: 'Ingresos por Habitación', type: 'income', postable: true },
  { code: '4.2', name: 'Ingresos por Servicios', type: 'income', postable: false },
  { code: '4.2.01', name: 'Ingresos por Servicios / Extras', type: 'income', postable: true },
  { code: '4.2.02', name: 'Ingresos por Restaurante', type: 'income', postable: true },
  { code: '4.3', name: 'Otros Ingresos', type: 'income', postable: false },
  { code: '4.3.01', name: 'Otros Ingresos', type: 'income', postable: true },
  { code: '5', name: 'Costos y Gastos', type: 'expense', postable: false },
  { code: '5.1', name: 'Costos Operativos', type: 'expense', postable: false },
  { code: '5.1.01', name: 'Costos Operativos', type: 'expense', postable: true },
  { code: '5.2', name: 'Gastos de Personal', type: 'expense', postable: false },
  { code: '5.2.01', name: 'Nómina', type: 'expense', postable: true },
  { code: '5.3', name: 'Gastos Administrativos', type: 'expense', postable: false },
  { code: '5.3.01', name: 'Gastos Administrativos', type: 'expense', postable: true },
  { code: '5.4', name: 'Servicios', type: 'expense', postable: false },
  { code: '5.4.01', name: 'Servicios (agua, luz, internet)', type: 'expense', postable: true },
  { code: '5.5', name: 'Ajustes', type: 'expense', postable: false },
  { code: '5.5.01', name: 'Devoluciones y Notas de Crédito', type: 'expense', postable: true },
]

/** El código del padre = el código sin el último segmento (1.1.01 → 1.1; 1 → sin padre). */
function parentCode(code: string): string | undefined {
  const i = code.lastIndexOf('.')
  return i > 0 ? code.slice(0, i) : undefined
}

/**
 * Inserta el plan base para un hotel. Idempotente: salta las cuentas cuyo `code` ya existe.
 * Devuelve cuántas creó. Los grupos van primero (orden del array) para que el `parentId` resuelva.
 */
/** Default alineado con `hoteles/model.ts` (`taxName`). */
export const DEFAULT_TAX_NAME = 'ITBIS'

/**
 * Nombre del impuesto que el HOTEL configuró (`hotels.taxName`), no un literal.
 * El plan base nombraba las dos cuentas de impuesto como "ITBIS" —el de República Dominicana—
 * aunque el hotel fuera de México (IVA) o de otro país. El nombre del impuesto es configuración
 * del hotel, así que el plan que se le siembra tiene que usarla (2026-08-30).
 */
export function taxNameOf(hotel: { taxName?: unknown } | null | undefined): string {
  const raw = hotel?.taxName
  const name = typeof raw === 'string' ? raw.trim() : ''
  return name || DEFAULT_TAX_NAME
}

export async function seedChartOfAccounts(
  accounts: RepositoryAdapter<AccountDTO>,
  hotelId: string,
  /** Impuesto del hotel. Sin él se usa el default del modelo. */
  taxName: string = DEFAULT_TAX_NAME,
): Promise<{ created: number; total: number }> {
  const existing = await accounts.findMany({ hotelId })
  const byCode = new Map<string, string>()   // code → id (existentes + recién creadas)
  for (const a of existing) byCode.set(a.code, a.id)

  let created = 0
  for (const node of BASE_CHART) {
    if (byCode.has(node.code)) continue      // idempotente
    const pCode = parentCode(node.code)
    const parentId = pCode ? byCode.get(pCode) : undefined
    const row = await accounts.create({
      hotelId, code: node.code, name: node.name.replace('{tax}', taxName), type: node.type,
      parentId, isPostable: node.postable ? 1 : 0, active: 1,
    } as Omit<AccountDTO, 'id'>)
    byCode.set(node.code, row.id)
    created++
  }
  return { created, total: BASE_CHART.length }
}
