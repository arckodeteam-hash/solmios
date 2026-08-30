import { describe, it, expect } from 'bun:test'
import { recordAutoEntry } from '../usecases/record-auto'

// Auditoría 2026-08-30: un cobro de 220 del "Hotel Demo Canales" no tenía asiento contable.
// Causa: el plan de cuentas solo se creaba si alguien apretaba "sembrar" a mano, y `recordAuto`
// devolvía `skipped` EN SILENCIO cuando faltaba. Todo hotel nuevo cobraba plata sin asentarla.

function deps(seedAccounts = true) {
  const accounts: any[] = []
  const entries: any[] = []
  const lines: any[] = []
  const d: any = {
    orm: { transaction: async (fn: any) => fn({
      create: async (t: string, row: any) => { (t === 'JournalEntries' ? entries : lines).push(row); return row },
      update: async () => ({}),
    }) },
    accounts: {
      findMany: async (f: any) => accounts.filter(a => a.hotelId === f.hotelId && (!f.code || a.code === f.code)),
      findOne: async (f: any) => accounts.find(a => Object.entries(f).every(([k, v]) => (a as any)[k] === v)) ?? null,
      findById: async (id: string) => accounts.find(a => a.id === id) ?? null,
      create: async (row: any) => {
        if (!seedAccounts) throw new Error('no se puede crear')
        const r = { id: `acc-${accounts.length}`, ...row }; accounts.push(r); return r
      },
    },
    entries: {
      findMany: async (f: any) => entries.filter(e => Object.entries(f).every(([k, v]) => e[k] === v)),
      create: async (row: any) => { entries.push(row); return row },
      update: async (id: string, patch: any) => { const e = entries.find(x => x.id === id); if (e) Object.assign(e, patch); return e },
      findById: async (id: string) => entries.find(x => x.id === id) ?? null,
      findOne: async (f: any) => entries.find(e => Object.entries(f).every(([k, v]) => (e as any)[k] === v)) ?? null,
    },
    lines: { create: async (row: any) => { lines.push(row); return row }, findMany: async () => lines },
    periods: {
      findMany: async () => [],
      create: async (row: any) => ({ id: 'per-1', ...row }),
      update: async () => ({}),
      findOne: async () => null,
    },
  }
  return { d, accounts, entries }
}

const INPUT = {
  entryDate: '2026-08-30', description: 'Cobro cash', reference: 'pay-1', referenceType: 'payment',
  lines: [{ code: '1.1.01', debit: 220 }, { code: '1.1.03', credit: 220 }],
}

describe('asiento automático en un hotel sin plan de cuentas', () => {
  it('siembra el plan y asienta el cobro en vez de saltearlo', async () => {
    const { d, accounts, entries } = deps()
    const res = await recordAutoEntry(d, 'hotel-nuevo', INPUT as any)
    expect(res.skipped).toBeUndefined()
    expect(accounts.length).toBeGreaterThan(0)
    expect(entries.length).toBe(1)
  })

  it('el plan sembrado incluye Caja y Cuentas por Cobrar', async () => {
    const { d, accounts } = deps()
    await recordAutoEntry(d, 'hotel-nuevo', INPUT as any)
    const codes = accounts.map((a: any) => a.code)
    expect(codes).toContain('1.1.01')
    expect(codes).toContain('1.1.03')
  })

  it('el plan es del hotel que cobró, no de otro (multi-tenancy)', async () => {
    const { d, accounts } = deps()
    await recordAutoEntry(d, 'hotel-A', INPUT as any)
    expect(accounts.every((a: any) => a.hotelId === 'hotel-A')).toBe(true)
  })

  it('un hotel que YA tiene plan no lo vuelve a sembrar', async () => {
    const { d, accounts } = deps()
    await recordAutoEntry(d, 'h1', INPUT as any)
    const afterFirst = accounts.length
    await recordAutoEntry(d, 'h1', { ...INPUT, reference: 'pay-2' } as any)
    expect(accounts.length).toBe(afterFirst)
  })

  it('si el plan no se puede crear, el cobro NO se rompe: se saltea como antes', async () => {
    const { d, entries } = deps(false)
    const res = await recordAutoEntry(d, 'hotel-sin-permiso', INPUT as any)
    expect(res.skipped).toBe(true)
    expect(entries).toHaveLength(0)
  })

  it('sin hotelId sigue siendo no-op', async () => {
    const { d } = deps()
    expect((await recordAutoEntry(d, '', INPUT as any)).skipped).toBe(true)
  })

  it('con menos de dos líneas no asienta (partida doble)', async () => {
    const { d } = deps()
    const res = await recordAutoEntry(d, 'h1', { ...INPUT, lines: [{ code: '1.1.01', debit: 220 }] } as any)
    expect(res.skipped).toBe(true)
  })
})
