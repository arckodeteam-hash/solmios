// Fija los invariantes que se rompieron cuando este catálogo estaba duplicado en tres
// componentes del dashboard: un mismo estado con dos nombres, y un mismo color con dos
// significados opuestos en widgets vecinos.
import { describe, it, expect } from 'vitest'
import {
  ROOM_STATUS_META, ROOM_STATUS_ORDER, roomStatusMeta,
  frontDeskActionFor, FRONT_DESK_PERMISSION, FRONT_DESK_LABEL,
} from './room-status'
import type { RoomStatus } from '@/types'

const ALL_STATUSES: RoomStatus[] = [
  'available', 'occupied', 'pending', 'cleaning', 'dirty', 'out_of_service',
]

describe('catálogo de estados de habitación', () => {
  it('cubre los 6 estados del tipo RoomStatus, sin faltantes', () => {
    expect(Object.keys(ROOM_STATUS_META).sort()).toEqual([...ALL_STATUSES].sort())
  })

  it('el orden de presentación incluye TODOS los estados una sola vez', () => {
    // La leyenda del mapa de habitaciones se deriva de este orden: si falta un estado,
    // aparecen celdas de un color que la leyenda no explica (pasaba con "Sucia").
    expect([...ROOM_STATUS_ORDER].sort()).toEqual([...ALL_STATUSES].sort())
    expect(new Set(ROOM_STATUS_ORDER).size).toBe(ROOM_STATUS_ORDER.length)
  })

  it('ningún color se repite entre estados', () => {
    // El bug original: #EF4444 significaba "ocupada" en el mapa y "fuera de servicio" en el
    // donut de al lado. Dos estados con el mismo color son indistinguibles en un gráfico.
    const colors = ALL_STATUSES.map(s => ROOM_STATUS_META[s].color)
    expect(new Set(colors).size).toBe(colors.length)
  })

  it('todo estado tiene label, plural, short y color hex válido', () => {
    for (const s of ALL_STATUSES) {
      const meta = ROOM_STATUS_META[s]
      expect(meta.label.length).toBeGreaterThan(0)
      expect(meta.plural.length).toBeGreaterThan(0)
      expect(meta.short.length).toBeGreaterThan(0)
      expect(meta.color).toMatch(/^#[0-9A-F]{6}$/i)
    }
  })

  it('los estados contables pluralizan (la leyenda del donut acompaña un conteo)', () => {
    // Regresión concreta: al unificar el catálogo, la leyenda pasó de "12 Ocupadas" a
    // "12 Ocupada". Los estados nombrados con una frase ("En limpieza", "Fuera de servicio")
    // no pluralizan a propósito y por eso no entran acá.
    expect(ROOM_STATUS_META.occupied.plural).toBe('Ocupadas')
    expect(ROOM_STATUS_META.available.plural).toBe('Disponibles')
    expect(ROOM_STATUS_META.dirty.plural).toBe('Sucias')
  })

  it('el short entra en la celda del mapa (8 caracteres)', () => {
    for (const s of ALL_STATUSES) {
      expect(ROOM_STATUS_META[s].short.length).toBeLessThanOrEqual(8)
    }
  })

  it('degrada a gris neutro si la API manda un estado desconocido', () => {
    const meta = roomStatusMeta('teleported')
    expect(meta.color).toMatch(/^#[0-9A-F]{6}$/i)
    expect(meta.label).toBe('Desconocido')
    expect(meta.plural.length).toBeGreaterThan(0)
    expect(meta.short.length).toBeGreaterThan(0)
  })
})

describe('frontDeskActionFor — qué operación de recepción admite una habitación', () => {
  // El bug: el modal del mapa de habitaciones ofrecía "Check-in" y ejecutaba
  // `PUT /rooms/:id {status:'occupied'}`. El check-in real (reservas/usecases/checkin.ts) es
  // una transacción que reclama la reserva, crea el folio y postea el cargo de habitación; el
  // check-out cierra folio, factura, cobra y empuja disponibilidad a Channex. Marcar la
  // habitación dejaba "fantasmas": ocupadas sin reserva, sin folio y sin cargo.
  it('una habitación libre o con llegada pendiente admite check-in', () => {
    expect(frontDeskActionFor('available')).toBe('checkin')
    expect(frontDeskActionFor('pending')).toBe('checkin')
  })

  it('una habitación ocupada admite check-out', () => {
    expect(frontDeskActionFor('occupied')).toBe('checkout')
  })

  it('sucia o en limpieza NO admite check-in: primero se limpia', () => {
    expect(frontDeskActionFor('dirty')).toBeNull()
    expect(frontDeskActionFor('cleaning')).toBeNull()
  })

  it('fuera de servicio no admite nada hasta reactivarla', () => {
    expect(frontDeskActionFor('out_of_service')).toBeNull()
  })

  it('un estado desconocido no habilita operaciones (falla cerrado)', () => {
    expect(frontDeskActionFor('teleported')).toBeNull()
    expect(frontDeskActionFor('')).toBeNull()
  })

  it('cubre TODOS los estados del catálogo sin dejar ninguno indefinido', () => {
    for (const status of ROOM_STATUS_ORDER) {
      const action = frontDeskActionFor(status)
      expect(action === null || action === 'checkin' || action === 'checkout').toBe(true)
    }
  })

  it('cada acción declara el permiso que el backend exige y su texto de botón', () => {
    // Si estos strings se desalinean de `reservas/index.ts`, el botón se le oculta a quien sí
    // puede operar (o se le ofrece a quien va a comerse un 403).
    expect(FRONT_DESK_PERMISSION.checkin).toEqual({ module: 'reservations', action: 'checkin' })
    expect(FRONT_DESK_PERMISSION.checkout).toEqual({ module: 'reservations', action: 'checkout' })
    expect(FRONT_DESK_LABEL.checkin.length).toBeGreaterThan(0)
    expect(FRONT_DESK_LABEL.checkout.length).toBeGreaterThan(0)
  })
})
