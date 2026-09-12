// #270 (MR-05) — URL del botón "Descargar recibo" en ConfirmStep.
// Sólo la construcción de la URL: id y token van codificados y sin ellos no hay botón.
import { describe, it, expect } from 'vitest'
import { receiptPdfUrl, receiptAvailable } from '@/utils/booking-confirmation-format'
import confirmStepSrc from './ConfirmStep.vue?raw'

describe('receiptPdfUrl (ConfirmStep)', () => {
  it('arma la URL pública del recibo con id y token codificados', () => {
    const url = receiptPdfUrl('abc 1', 'tok/=+')
    const [path, query] = url.split('?')
    expect(path).toBe('/api/public/reservations/abc%201/receipt.pdf')
    expect(query).toBe(['token', 'tok%2F%3D%2B'].join('='))
  })

  it('devuelve cadena vacía si falta id o token (el botón no se renderiza)', () => {
    expect(receiptPdfUrl('', 'tok')).toBe('')
    expect(receiptPdfUrl('abc', '')).toBe('')
  })
})

// El backend responde 409 `not_paid` si la reserva no tiene cobro: el botón sólo aparece con pago.
describe('receiptAvailable (ConfirmStep)', () => {
  it('con pago total o parcial y un importe cobrado hay recibo', () => {
    expect(receiptAvailable('paid', 380.16)).toBe(true)
    expect(receiptAvailable('partial', 100)).toBe(true)
    expect(receiptAvailable('PAID', '50')).toBe(true)
  })

  it('sin pago (unpaid/pending, importe 0 o ausente) no hay recibo', () => {
    expect(receiptAvailable('unpaid', 0)).toBe(false)
    expect(receiptAvailable('pending', 0)).toBe(false)
    expect(receiptAvailable('paid', 0)).toBe(false)
    expect(receiptAvailable('partial', undefined)).toBe(false)
    expect(receiptAvailable(undefined, 100)).toBe(false)
  })

  it('ConfirmStep arma receiptUrl sólo cuando hasReceipt (paymentStatus + amountPaid del backend)', () => {
    expect(confirmStepSrc).toContain('receiptAvailable(reservation.value?.paymentStatus, reservation.value?.reservation?.amountPaid)')
    expect(confirmStepSrc).toMatch(/resolvedIds\.value && hasReceipt\.value \? receiptPdfUrl\(/)
  })
})
