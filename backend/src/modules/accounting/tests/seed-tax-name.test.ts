import { describe, it, expect } from 'bun:test'
import { seedChartOfAccounts, taxNameOf, DEFAULT_TAX_NAME } from '../usecases/seed-chart-of-accounts'

// El plan base nombraba las cuentas de impuesto "ITBIS" —el de República Dominicana— para
// TODOS los hoteles. El nombre del impuesto es configuración del hotel (`hotels.taxName`), así
// que el plan que se le siembra tiene que usar la suya (2026-08-30).

function repo() {
  const rows: any[] = []
  return {
    rows,
    accounts: {
      findMany: async (f: any) => rows.filter(r => r.hotelId === f.hotelId),
      create: async (row: any) => { const r = { id: `a${rows.length}`, ...row }; rows.push(r); return r },
    } as any,
  }
}

const nameOf = (rows: any[], code: string) => rows.find(r => r.code === code)?.name

describe('nombre del impuesto en el plan de cuentas', () => {
  it('usa el impuesto configurado por el hotel', async () => {
    const { rows, accounts } = repo()
    await seedChartOfAccounts(accounts, 'h-mx', 'IVA')
    expect(nameOf(rows, '2.1.02')).toBe('IVA por Pagar')
    expect(nameOf(rows, '1.1.04')).toBe('IVA Adelantado')
  })

  it('sin configuración cae al default del modelo', async () => {
    const { rows, accounts } = repo()
    await seedChartOfAccounts(accounts, 'h-do')
    expect(nameOf(rows, '2.1.02')).toBe(`${DEFAULT_TAX_NAME} por Pagar`)
  })

  it('no deja el placeholder crudo en ninguna cuenta', async () => {
    const { rows, accounts } = repo()
    await seedChartOfAccounts(accounts, 'h1', 'IVA')
    expect(rows.some(r => String(r.name).includes('{tax}'))).toBe(false)
  })

  it('las cuentas que no son de impuesto no cambian', async () => {
    const { rows, accounts } = repo()
    await seedChartOfAccounts(accounts, 'h1', 'IVA')
    expect(nameOf(rows, '1.1.01')).toBe('Caja')
    expect(nameOf(rows, '1.1.02')).toBe('Bancos')
  })

  it('sigue siendo idempotente: no duplica ni renombra lo ya sembrado', async () => {
    const { rows, accounts } = repo()
    await seedChartOfAccounts(accounts, 'h1', 'ITBIS')
    const n = rows.length
    // Un segundo seed con otro nombre NO pisa lo que el hotel pueda haber editado.
    const res = await seedChartOfAccounts(accounts, 'h1', 'IVA')
    expect(res.created).toBe(0)
    expect(rows.length).toBe(n)
    expect(nameOf(rows, '2.1.02')).toBe('ITBIS por Pagar')
  })
})

describe('taxNameOf', () => {
  it('toma el del hotel', () => expect(taxNameOf({ taxName: 'IVA' })).toBe('IVA'))
  it('ignora vacío y espacios', () => {
    expect(taxNameOf({ taxName: '   ' })).toBe(DEFAULT_TAX_NAME)
    expect(taxNameOf({ taxName: '' })).toBe(DEFAULT_TAX_NAME)
  })
  it('tolera hotel nulo o campo raro', () => {
    expect(taxNameOf(null)).toBe(DEFAULT_TAX_NAME)
    expect(taxNameOf({ taxName: 42 as any })).toBe(DEFAULT_TAX_NAME)
  })
})
