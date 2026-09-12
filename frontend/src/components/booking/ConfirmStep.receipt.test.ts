// #270 (MR-05) — URL del botón "Descargar recibo" en ConfirmStep.
// Sólo la construcción de la URL: id y token van codificados y sin ellos no hay botón.
import { describe, it, expect } from 'vitest'
import { receiptPdfUrl } from '@/utils/booking-confirmation-format'

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
