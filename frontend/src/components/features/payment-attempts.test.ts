import { describe, it, expect } from 'vitest'
import src from './ReservationModal.vue?raw'

// REQ-RWP-02 — el detalle mostraba el "Historial de cobros" (lo que entró) pero nada de lo que
// pasó en la pasarela: un checkout abierto, una tarjeta rechazada o un link expirado eran
// invisibles para recepción. El bloque "Pasarela de pago" lista cada intento y el aviso ámbar
// sale del ÚLTIMO intento fallido/expirado, no de `payments` (que nunca ve los que no cobraron).

describe('pasarela de pago en la reserva', () => {
  it('la tarjeta existe y lista los intentos', () => {
    expect(src).toContain('data-testid="payment-attempts"')
    expect(src).toContain('data-testid="payment-attempt-row"')
    expect(src).toContain('Pasarela de pago')
    expect(src).toContain('paymentAttempts')
  })

  it('cada intento muestra monto, estado, proveedor, tarjeta, fecha y referencia', () => {
    expect(src).toContain('money(a.amount)')
    expect(src).toContain('attemptKindBadge(a.kind)')
    expect(src).toContain('providerLabel(a.provider)')
    expect(src).toContain('a.cardLast4')
    expect(src).toContain('fmtDateTime(a.occurredAt)')
    expect(src).toContain('copyProviderRef(a.providerRef)')
    expect(src).toContain('data-testid="payment-attempt-copy"')
  })

  it('un rechazo muestra el motivo que devolvió la pasarela', () => {
    expect(src).toContain('data-testid="payment-attempt-failure"')
    expect(src).toContain('a.failureMessage')
  })

  it('los links al dashboard y al recibo abren en pestaña nueva', () => {
    expect(src).toContain('Ver en Stripe')
    expect(src).toContain('Recibo')
    expect(src).toContain('target="_blank"')
    expect(src).toContain('rel="noopener noreferrer"')
  })

  it('sin intentos lo dice, no deja el bloque vacío', () => {
    expect(src).toContain('Esta reserva no pasó por la pasarela.')
  })

  it('el estado se traduce, no se muestra el valor crudo del backend', () => {
    for (const label of ['Checkout abierto', 'Pagado', 'Rechazado', 'Expirado', 'Devuelto', 'Pendiente']) {
      expect(src).toContain(`label: '${label}'`)
    }
  })
})

describe('aviso por último intento no completado', () => {
  it('sale del último intento en la pasarela y reemplaza a hasFailedPayment', () => {
    expect(src).toContain('lastAttemptFailure')
    expect(src).toContain('data-testid="failed-payment-warning"')
    expect(src).toContain('El último intento de cobro no se completó')
    expect(src).not.toContain('hasFailedPayment')
  })

  it('es ámbar (advertencia), no rojo: la reserva sigue viva y se puede reintentar', () => {
    expect(src).toContain('text-amber-800 bg-amber-50 border border-amber-200')
    expect(src).toContain('generar un link de pago')
  })
})
