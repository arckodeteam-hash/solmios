// Tests del change `finanzas-consolidacion` (tareas 1.3 y 1.4).
//
// Cada uno falla contra el código anterior al change:
//   1.3 — dos altas concurrentes producían el MISMO invoiceNumber (read-modify-write sin lock) y
//         un fallo de `configuration` devolvía `INV-{año}-{timestamp}` en vez de fallar.
//   1.4 — sin conector de pagos, `payInvoice` marcaba la factura `paid` sin fila en `payments`.

import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import { createInvoice } from '../usecases/create-invoice'
import { payInvoice } from '../usecases/pay-invoice'

const log = silentLogger()

/** Cede el turno de verdad: sin esto los mocks resuelven en el mismo tick y NO hay concurrencia. */
const tick = () => new Promise<void>(r => setTimeout(r, 0))

/**
 * Repo de `configuration` en memoria. `taxes` ausente ⇒ tasa 0, así el total es el neto.
 *
 * `interleave` mete un tick entre el read y el write del contador, que es exactamente la ventana
 * donde el read-modify-write pierde la carrera: dos altas leen el mismo valor y proponen el mismo
 * número. Sin esto el test pasaba aun con el bug puesto.
 */
function makeConfigRepo(interleave = false) {
  const rows = new Map<string, any>()
  let seq = 0
  return {
    rows,
    findOne: async (f: any) => {
      if (interleave) await tick()
      for (const r of rows.values()) if (r.key === f.key && r.hotelId === f.hotelId) return r
      return null
    },
    create: async (d: any) => {
      if (interleave) await tick()
      const row = { id: `cfg-${++seq}`, ...d }
      rows.set(row.id, row)
      return row
    },
    update: async (id: string, patch: any) => {
      if (interleave) await tick()
      const row = rows.get(id)
      if (!row) return null
      Object.assign(row, patch)
      return row
    },
  } as any
}

/**
 * Repo de `invoices` que hace cumplir el UNIQUE (hotelId, invoiceNumber) igual que
 * `idx_invoices_hotel_number` en la base. Sin esta restricción el test no probaría nada:
 * es justamente el árbitro que el change agrega.
 */
function makeInvoiceRepo() {
  const rows: any[] = []
  const taken = new Set<string>()
  return {
    rows,
    create: async (d: any) => {
      const key = `${d.hotelId}::${d.invoiceNumber}`
      if (taken.has(key)) throw new Error('UNIQUE constraint failed: invoices.hotelId, invoices.invoiceNumber')
      taken.add(key)
      const row = { id: `inv-${rows.length + 1}`, ...d }
      rows.push(row)
      return row
    },
    update: async (id: string, patch: any) => {
      const row = rows.find(r => r.id === id)
      if (!row) return null
      Object.assign(row, patch)
      return row
    },
  } as any
}

const noopItems = { create: async (d: any) => d, findMany: async () => [], delete: async () => true } as any

function deps(repo: any, configRepo: any) {
  return { repo, configRepo, itemRepo: noopItems, logger: log }
}

describe('1.3 — numerador de facturas', () => {
  it('dos altas CONCURRENTES obtienen números distintos y el contador queda en el mayor', async () => {
    const repo = makeInvoiceRepo()
    const configRepo = makeConfigRepo(true) // read y write del contador entrelazados

    // Precarga del contador en 7: las dos próximas deben ser 0008 y 0009.
    const year = new Date().getFullYear()
    await configRepo.create({ key: `invoice_counter_h1_${year}`, hotelId: 'h1', value: 7 })

    const [a, b] = await Promise.all([
      createInvoice(deps(repo, configRepo), { amount: 100, issueDate: '2026-09-06' } as any, 'h1'),
      createInvoice(deps(repo, configRepo), { amount: 200, issueDate: '2026-09-06' } as any, 'h1'),
    ])

    expect(a.invoiceNumber).not.toBe(b.invoiceNumber)
    expect([a.invoiceNumber, b.invoiceNumber].sort()).toEqual([
      `INV-${year}-0008`, `INV-${year}-0009`,
    ])
    expect(repo.rows).toHaveLength(2)

    const counter = await configRepo.findOne({ key: `invoice_counter_h1_${year}`, hotelId: 'h1' })
    expect(counter.value).toBe(9)
  })

  it('dos hoteles distintos arrancan su propia secuencia sin chocar', async () => {
    const repo = makeInvoiceRepo()
    const configRepo = makeConfigRepo()
    const year = new Date().getFullYear()

    const a = await createInvoice(deps(repo, configRepo), { amount: 50, issueDate: '2026-09-06' } as any, 'h1')
    const b = await createInvoice(deps(repo, configRepo), { amount: 50, issueDate: '2026-09-06' } as any, 'h2')

    expect(a.invoiceNumber).toBe(`INV-${year}-0001`)
    expect(b.invoiceNumber).toBe(`INV-${year}-0001`)
  })

  it('si configuration falla, la emisión FALLA y no se crea la factura (nada de número por timestamp)', async () => {
    const repo = makeInvoiceRepo()
    const brokenConfig = {
      findOne: async () => { throw new Error('configuration no disponible') },
      create: async () => { throw new Error('configuration no disponible') },
      update: async () => { throw new Error('configuration no disponible') },
    } as any

    await expect(
      createInvoice(deps(repo, brokenConfig), { amount: 100, issueDate: '2026-09-06' } as any, 'h1'),
    ).rejects.toThrow()
    expect(repo.rows).toHaveLength(0)
  })

  it('un invoiceNumber provisto por el llamador se respeta y NO consume el contador', async () => {
    const repo = makeInvoiceRepo()
    const configRepo = makeConfigRepo()
    const year = new Date().getFullYear()

    const r = await createInvoice(
      deps(repo, configRepo),
      { amount: 100, issueDate: '2026-09-06', invoiceNumber: 'MANUAL-1' } as any,
      'h1',
    )

    expect(r.invoiceNumber).toBe('MANUAL-1')
    expect(await configRepo.findOne({ key: `invoice_counter_h1_${year}`, hotelId: 'h1' })).toBeNull()
  })
})

describe('1.4 — sin conector de pagos no hay cobro', () => {
  const invoice = {
    id: 'inv1', amount: 100, amountPaid: 0, hotelId: 'h1', guestId: 'g1',
    currency: 'USD', invoiceNumber: 'INV-2026-0001', notes: '', status: 'pending',
  }

  it('falla el cobro y deja la factura intacta cuando el puerto no está registrado', async () => {
    let updated = false
    const repo = { update: async () => { updated = true; return invoice } } as any

    await expect(
      payInvoice(repo, log, null, invoice as any, { amount: 100, method: 'cash' } as any),
    ).rejects.toThrow(/conector de pagos no está registrado/)

    // Lo que importa: la factura NO quedó marcada como pagada sin asiento en `payments`.
    expect(updated).toBe(false)
  })
})
