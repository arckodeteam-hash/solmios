// notification-route.test.ts — Ruteo de notificaciones (#135): la campana y la página abrían por
// type y no conocían metadata.link, así que una notificación de ticket de soporte no llevaba a
// ningún lado.
import { describe, it, expect } from 'vitest'
import { resolveNotificationRoute } from './notification-route'

describe('resolveNotificationRoute — metadata.link manda si es una ruta interna', () => {
  it("el link del ticket se devuelve tal cual aunque type sea 'system'", () => {
    expect(resolveNotificationRoute({ type: 'system', metadata: { ticketId: 't1', link: '/panel/support?ticket=t1' } }))
      .toBe('/panel/support?ticket=t1')
  })

  it('el link gana incluso sobre reservationId y el mapeo por type', () => {
    expect(resolveNotificationRoute({ type: 'payment', metadata: { reservationId: 'r1', link: '/panel/support?ticket=t2' } }))
      .toBe('/panel/support?ticket=t2')
  })

  it('un link a un origen externo (https://) se ignora y cae al mapeo por type', () => {
    expect(resolveNotificationRoute({ type: 'payment', metadata: { link: 'https://evil.example' } }))
      .toBe('/panel/finanzas/facturacion')
    expect(resolveNotificationRoute({ type: 'system', metadata: { link: 'https://evil.example' } })).toBeNull()
  })

  it("un link protocol-relative ('//evil.example') también se ignora", () => {
    expect(resolveNotificationRoute({ type: 'review', metadata: { link: '//evil.example' } })).toBe('/panel/resenas')
    expect(resolveNotificationRoute({ type: 'system', metadata: { link: '//evil.example' } })).toBeNull()
  })

  it('un link que no es string se ignora', () => {
    expect(resolveNotificationRoute({ type: 'system', metadata: { link: 42 } })).toBeNull()
  })
})

describe('resolveNotificationRoute — sin link, conserva el mapeo anterior', () => {
  it('reservationId gana sobre type', () => {
    expect(resolveNotificationRoute({ type: 'payment', metadata: { reservationId: 'r1' } })).toBe('/panel/reservas')
  })

  it('cada type mapeado lleva a su pantalla', () => {
    expect(resolveNotificationRoute({ type: 'payment' })).toBe('/panel/finanzas/facturacion')
    expect(resolveNotificationRoute({ type: 'housekeeping' })).toBe('/panel/operaciones/limpieza')
    expect(resolveNotificationRoute({ type: 'maintenance' })).toBe('/panel/operaciones/mantenimiento')
    expect(resolveNotificationRoute({ type: 'review' })).toBe('/panel/resenas')
  })

  it('sin link, sin reservationId y con type no mapeado → null (no navega)', () => {
    expect(resolveNotificationRoute({ type: 'system' })).toBeNull()
    expect(resolveNotificationRoute({ type: 'message', metadata: {} })).toBeNull()
    expect(resolveNotificationRoute({ type: 'system', metadata: undefined })).toBeNull()
  })
})
