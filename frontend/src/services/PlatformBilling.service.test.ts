// El armado del query string: es lo que decide si el filtro llega al backend o se pierde.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const get = vi.fn()
const post = vi.fn()
const getBlob = vi.fn()
vi.mock('./http', () => ({ http: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), getBlob: (...a: unknown[]) => getBlob(...a) } }))

const { PlatformBillingService } = await import('./PlatformBilling.service')

beforeEach(() => { get.mockReset(); post.mockReset(); getBlob.mockReset() })

describe('PlatformBillingService.list', () => {
  it('manda solo los filtros con valor', async () => {
    await PlatformBillingService.list({ status: 'open', q: 'sol', page: 2, limit: 20 })
    expect(get).toHaveBeenCalledWith('/admin/billing/invoices?status=open&q=sol&page=2&limit=20')
  })

  it('sin filtros no ensucia la URL', async () => {
    await PlatformBillingService.list()
    expect(get).toHaveBeenCalledWith('/admin/billing/invoices')
  })

  it('descarta los vacíos y el "all" de los selects (el backend los ignoraría igual)', async () => {
    await PlatformBillingService.list({ status: '', planId: 'all', from: '2026-08-01' })
    expect(get).toHaveBeenCalledWith('/admin/billing/invoices?from=2026-08-01')
  })
})

describe('PlatformBillingService.stats', () => {
  it('acepta el mismo rango de fechas del listado', async () => {
    await PlatformBillingService.stats({ from: '2026-08-01', to: '2026-08-31' })
    expect(get).toHaveBeenCalledWith('/admin/billing/stats?from=2026-08-01&to=2026-08-31')
  })
})

describe('PlatformBillingService.exportCsv', () => {
  it('exporta LO FILTRADO, no la página: `page` y `limit` no viajan', async () => {
    getBlob.mockResolvedValue(new Blob(['x'], { type: 'text/csv' }))
    const click = vi.fn()
    const anchor = { href: '', download: '', click } as unknown as HTMLAnchorElement
    vi.spyOn(document, 'createElement').mockReturnValue(anchor)
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()

    await PlatformBillingService.exportCsv({ status: 'paid', page: 3, limit: 20 })

    expect(getBlob).toHaveBeenCalledWith('/admin/billing/export.csv?status=paid')
    expect(click).toHaveBeenCalled()
    expect(anchor.download).toContain('.csv')
    vi.restoreAllMocks()
  })
})

describe('PlatformBillingService — acciones', () => {
  it('remind pega en la ruta de la factura', async () => {
    await PlatformBillingService.remind('pi-1')
    expect(post).toHaveBeenCalledWith('/admin/billing/invoices/pi-1/remind')
  })

  it('manualPayment manda el cuerpo tal cual', async () => {
    const input = { hotelId: 'h1', invoiceId: 'pi-1', amount: 49, currency: 'USD', paidAt: '2026-09-01T12:00:00.000Z', reference: 'TRF-1', periodEnd: '2026-10-01T12:00:00.000Z' }
    await PlatformBillingService.manualPayment(input)
    expect(post).toHaveBeenCalledWith('/admin/billing/manual-payment', input)
  })
})
