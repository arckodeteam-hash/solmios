import { http } from './http'

export interface PaymentRequest {
  id?: string
  hotelId?: string
  reservationId: string
  amount: number
  currency?: string
  stripeSessionId?: string
  stripePaymentUrl?: string
  status: 'pending' | 'paid' | 'expired' | 'cancelled'
  sentTo?: string
  sentVia?: 'email' | 'whatsapp' | 'sms'
  paidAt?: string
  createdAt?: string
  guestName?: string
}

export const PaymentsService = {
  list: (reservationId?: string) =>
    http.get<{ data: PaymentRequest[] }>(`/payment-requests${reservationId ? `?reservationId=${reservationId}` : ''}`),
  create: (data: { reservationId: string; amount: number; currency?: string; sentTo?: string; sentVia?: string }) =>
    http.post<PaymentRequest>('/payment-requests', data),
  /**
   * Sólo estos cuatro campos. `stripeSessionId`, `stripePaymentUrl` y `paidAt` son estado interno
   * del servidor: el backend los descarta (payment-requests/validators/schema.ts, BUG-ceiling-bypass)
   * porque escribirlos desde el cliente permitía soltar el puntero de la Checkout Session y liberar
   * el techo de cobro con el link todavía pagable.
   */
  update: (id: string, data: Partial<Pick<PaymentRequest, 'amount' | 'status' | 'sentTo' | 'sentVia'>>) =>
    http.put<PaymentRequest>(`/payment-requests/${id}`, data),
  remove: (id: string) => http.delete<{ success: boolean }>(`/payment-requests/${id}`),
  /** Crea una Checkout Session de Stripe y actualiza el PaymentRequest con la URL */
  createStripeCheckout: (paymentRequestId: string) =>
    http.post<{ url: string; sessionId: string }>(`/payment-requests/${paymentRequestId}/create-checkout`),
  /** Crea PaymentRequest + Checkout Session en un solo flujo (PC-3.2.1). Devuelve { paymentRequest, url }. */
  createWithStripe: async (reservationId: string, amount: number, opts?: { currency?: string; sentTo?: string; sentVia?: 'email' | 'whatsapp' | 'sms' }) => {
    const pr = await PaymentsService.create({ reservationId, amount, ...opts })
    const { url } = await PaymentsService.createStripeCheckout(pr.id!)
    return { paymentRequest: pr, url }
  },
  /** Estado de configuración de Stripe (para mostrar/ocultar botones) */
  status: () => http.get<{ configured: boolean; publishableKey: string }>('/stripe/status'),
}
