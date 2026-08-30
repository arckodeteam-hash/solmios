import { describe, it, expect } from 'vitest'
import src from './ReservationModal.vue?raw'

// La reserva mostraba un total "Pagado" sin decir por dónde entró la plata (reporte de cliente
// 2026-08-30). El listado global de /panel/billing existe pero no se puede filtrar por reserva.

describe('historial de cobros en la reserva', () => {
  it('la tarjeta existe y lista los movimientos', () => {
    expect(src).toContain('data-testid="payment-history"')
    expect(src).toContain('data-testid="payment-history-row"')
    expect(src).toContain('Historial de cobros')
    expect(src).toContain('paymentHistory')
  })

  it('cada línea muestra método, estado, fecha, referencia y quién lo registró', () => {
    expect(src).toContain('payMethodLabel(p.method)')
    expect(src).toContain('paymentStatusLabel(p.status)')
    expect(src).toContain('fmtDateTime(p.createdAt)')
    expect(src).toContain('p.reference')
    expect(src).toContain('p.registeredBy')
  })

  it('las devoluciones se distinguen del cobro', () => {
    // Signo y color propio: un reembolso no puede leerse como un ingreso más.
    expect(src).toContain("p.amount < 0 ? '−' : '+'")
    expect(src).toContain("p.amount < 0 ? 'text-purple' : 'text-teal'")
  })

  it('sin movimientos lo dice, no deja el bloque vacío', () => {
    expect(src).toContain('Todavía no se registró ningún cobro')
  })

  it('el estado se traduce, no se muestra el valor crudo del backend', () => {
    for (const label of ['Cobrado', 'Pendiente', 'Devuelto', 'Fallido']) {
      expect(src).toContain(`label: '${label}'`)
    }
  })
})
