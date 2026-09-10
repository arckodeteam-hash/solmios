// PlatformBilling.service.ts — lo que los hoteles le pagan a la PLATAFORMA (/admin/billing).
//
// Distinto de `Billing.service.ts`, que es la facturación del hotel a SUS huéspedes. Acá se lee
// `platform_invoices`, la tabla que llenan los webhooks de Stripe de la cuenta de plataforma.
//
// Todo tipado: la pantalla vieja armaba las "facturas" con `any` a partir de
// `PlatformService.subscriptions()` y leía campos que ese endpoint nunca devolvió (`h.createdAt`
// como fecha de emisión, `h.plan` como plan facturado) — por eso la columna Fecha salía vacía y
// "Ver" reventaba. Con los tipos, ese error no compila.
import { http } from './http'

export type PlatformInvoiceStatus = 'open' | 'paid' | 'failed' | 'void' | 'uncollectible'
export type PlatformInvoiceMethod = 'card' | 'manual'

export interface PlatformInvoice {
  id: string
  /** Número de Stripe. Vacío en las manuales: ahí manda la referencia. */
  number: string
  hotelId: string
  hotelName: string
  planId: string
  planName: string
  status: PlatformInvoiceStatus
  method: PlatformInvoiceMethod
  currency: string
  amountDue: number
  amountPaid: number
  issuedAt: string
  dueAt: string
  paidAt: string
  periodStart: string
  periodEnd: string
  reference: string
  hostedInvoiceUrl: string
  invoicePdfUrl: string
  notes: string
  lastReminderAt: string
  /** `open` con el vencimiento pasado. Lo calcula el backend: la UI no rehace la cuenta. */
  overdue: boolean
}

export interface PlatformInvoiceDetail extends PlatformInvoice {
  hotelEmail: string
  subscriptionStatus: string
  isRecurring: boolean
  currentPeriodEnd: string
}

export interface PlatformBillingStats {
  collected: number
  open: number
  overdue: number
  failed: number
  collectionRate: number
  mrr: number
}

export interface InvoiceFilters {
  status?: string
  planId?: string
  /** `YYYY-MM-DD`, sobre la fecha de emisión. */
  from?: string
  to?: string
  q?: string
  page?: number
  limit?: number
}

export interface InvoicePage {
  data: PlatformInvoice[]
  total: number
  page: number
  limit: number
}

export interface RemindResult {
  sent: true
  /** Plantilla que salió: `payment_failed` | `subscription_renewal_auto` | `subscription_renewal_manual`. */
  template: string
  to: string
  sentAt: string
}

export interface ManualPaymentInput {
  hotelId: string
  /** Marca PAGADA esa factura pendiente en vez de crear otra. */
  invoiceId?: string
  amount: number
  currency: string
  paidAt: string
  reference: string
  periodEnd: string
  notes?: string
}

export interface ManualPaymentResult {
  invoice: PlatformInvoiceDetail
  subscriptionActivated: boolean
  /** Presente cuando el cobro quedó registrado pero la suscripción NO se pudo activar. */
  warning?: string
}

/** Solo viajan los filtros con valor: `?status=&q=` ensucia la URL y el backend igual los ignora. */
function queryString(filters: InvoiceFilters): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '' || value === 'all') continue
    params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export const PlatformBillingService = {
  list: (filters: InvoiceFilters = {}) =>
    http.get<InvoicePage>(`/admin/billing/invoices${queryString(filters)}`),

  detail: (id: string) => http.get<PlatformInvoiceDetail>(`/admin/billing/invoices/${id}`),

  /** Totales del período. Acepta los mismos `from`/`to` que el listado. */
  stats: (filters: Pick<InvoiceFilters, 'from' | 'to'> = {}) =>
    http.get<PlatformBillingStats>(`/admin/billing/stats${queryString(filters)}`),

  /** 409 si la factura ya no se reclama o si hubo un recordatorio en las últimas 24 h. */
  remind: (id: string) => http.post<RemindResult>(`/admin/billing/invoices/${id}/remind`),

  manualPayment: (input: ManualPaymentInput) =>
    http.post<ManualPaymentResult>('/admin/billing/manual-payment', input),

  /**
   * Baja el CSV que arma el backend con los MISMOS filtros de la pantalla (no la página que se ve).
   * Va por `getBlob` y no por un `<a href>`: la ruta exige el token de super-admin.
   */
  async exportCsv(filters: InvoiceFilters = {}): Promise<void> {
    const { page, limit, ...rest } = filters
    void page; void limit // el export no se pagina: se lleva todo lo filtrado
    const blob = await http.getBlob(`/admin/billing/export.csv${queryString(rest)}`)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `facturacion-plataforma-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  },
}
