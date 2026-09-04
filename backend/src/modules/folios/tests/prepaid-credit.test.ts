// El huésped que pagó por adelantado llegaba al check-out con el folio pidiéndole toda la plata
// otra vez. Estos casos son ese bug y las dos guardas que lo hacen seguro de reintentar.
import { describe, it, expect } from 'bun:test'
import { postPrepaidCredit } from '../usecases/prepaid-credit'

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any

const USER = { id: 'u1', role: 'hotel_admin' } as any

function makeDeps(charges: any[] = [], folio: any = { id: 'f1', hotelId: 'h1', status: 'open' }) {
  const rows = [...charges]
  const deps = {
    folioRepo: { findById: async () => folio },
    chargeRepo: {
      findMany: async () => rows,
      create: async (c: any) => { const row = { id: `c${rows.length + 1}`, ...c }; rows.push(row); return row },
    },
    userRepo: { findById: async () => ({ id: 'u1', hotelId: 'h1' }) },
    auth: { assertOwnership: () => {} },
    logger,
  } as any
  return { deps, rows }
}

const cargo = (total: number, extra: any = {}) => ({ kind: 'charge', total, amount: total, taxes: 0, ...extra })

describe('postPrepaidCredit', () => {
  it('acredita el anticipo y baja el saldo del folio', async () => {
    const { deps, rows } = makeDeps([cargo(76.7)])
    const out = await postPrepaidCredit(deps, 'f1', { amount: 76.7, reference: 'prepaid:res-1' }, USER)
    expect(out.applied).toBe(76.7)
    expect(rows).toHaveLength(2)
    expect(rows[1]).toMatchObject({ kind: 'payment', total: -76.7, source: 'prepaid', reference: 'prepaid:res-1' })
  })

  it('NO crea una fila en payments: la plata ya está asentada', async () => {
    // El deps ni siquiera tiene un puerto de pagos — si el usecase intentara asentar el cobro,
    // este test explotaría. Esa es justamente la diferencia con `applyPayment`.
    const { deps } = makeDeps([cargo(100)])
    const out = await postPrepaidCredit(deps, 'f1', { amount: 100, reference: 'prepaid:res-1' }, USER)
    expect(out.applied).toBe(100)
  })

  it('correrlo dos veces no acredita dos veces', async () => {
    const { deps, rows } = makeDeps([cargo(100)])
    await postPrepaidCredit(deps, 'f1', { amount: 100, reference: 'prepaid:res-1' }, USER)
    const segunda = await postPrepaidCredit(deps, 'f1', { amount: 100, reference: 'prepaid:res-1' }, USER)
    expect(segunda.applied).toBe(0)
    expect(segunda.reason).toBe('already-applied')
    expect(rows).toHaveLength(2)
  })

  it('pagó MÁS de lo que consumió: se acredita hasta el saldo y nada más', async () => {
    // 195 pagados contra 76,70 de consumo. El folio queda en 0, no en -118,30: el sobrante es
    // saldo a favor de la RESERVA, no un pago inventado de este folio.
    const { deps, rows } = makeDeps([cargo(76.7)])
    const out = await postPrepaidCredit(deps, 'f1', { amount: 195, reference: 'prepaid:res-1' }, USER)
    expect(out.applied).toBe(76.7)
    expect(rows[1].total).toBe(-76.7)
  })

  it('folio ya saldado: no acredita nada', async () => {
    const { deps } = makeDeps([cargo(100), { kind: 'payment', total: -100 }])
    const out = await postPrepaidCredit(deps, 'f1', { amount: 50, reference: 'prepaid:res-1' }, USER)
    expect(out.applied).toBe(0)
    expect(out.reason).toBe('no-balance')
  })

  it('monto cero o negativo no hace nada', async () => {
    const { deps, rows } = makeDeps([cargo(100)])
    expect((await postPrepaidCredit(deps, 'f1', { amount: 0, reference: 'r' }, USER)).applied).toBe(0)
    expect((await postPrepaidCredit(deps, 'f1', { amount: -50, reference: 'r' }, USER)).applied).toBe(0)
    expect(rows).toHaveLength(1)
  })

  it('sin referencia se rechaza: sin ella no hay forma de no duplicar', async () => {
    const { deps } = makeDeps([cargo(100)])
    expect(postPrepaidCredit(deps, 'f1', { amount: 50, reference: '' }, USER)).rejects.toThrow(/referencia/i)
  })

  it('un folio cerrado no se toca', async () => {
    const { deps } = makeDeps([cargo(100)], { id: 'f1', hotelId: 'h1', status: 'closed' })
    expect(postPrepaidCredit(deps, 'f1', { amount: 50, reference: 'r' }, USER)).rejects.toThrow(/no está abierto/i)
  })

  it('redondea a centavos', async () => {
    const { deps, rows } = makeDeps([cargo(100)])
    await postPrepaidCredit(deps, 'f1', { amount: 33.333, reference: 'r' }, USER)
    expect(rows[1].total).toBe(-33.33)
  })
})
