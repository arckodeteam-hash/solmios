// Channel.service.test.ts — Los 6 estados de una solicitud de conexión tienen que estar completos.
//
// La tarjeta de la OTA en el panel del hotel pinta la etiqueta y el color a partir de dos
// diccionarios. Cuando el backend sumó `scheduled` y `waiting_hotel`, los diccionarios se quedaron
// en cuatro: la tarjeta salía vacía y sin borde, sin ningún error en consola. Este test recorre
// la lista canónica de estados y falla si falta cualquiera de los dos.
import { describe, it, expect } from 'vitest'
import {
  CHANNEL_REQUEST_STATUSES, CHANNEL_REQUEST_LABELS, CHANNEL_REQUEST_CLASSES,
  CHANNEL_REQUEST_MEDIUM_LABELS, type ChannelRequestStatus,
} from './Channel.service'

describe('estados de una solicitud de conexión', () => {
  it('son los seis del backend, en el mismo orden', () => {
    expect([...CHANNEL_REQUEST_STATUSES]).toEqual([
      'pending', 'scheduled', 'in_progress', 'waiting_hotel', 'connected', 'rejected',
    ])
  })

  it('cada estado tiene etiqueta en español', () => {
    for (const status of CHANNEL_REQUEST_STATUSES) {
      expect(CHANNEL_REQUEST_LABELS[status], `falta la etiqueta de "${status}"`).toBeTruthy()
    }
  })

  it('cada estado tiene clases de badge (si no, la tarjeta sale sin color)', () => {
    for (const status of CHANNEL_REQUEST_STATUSES) {
      const clases = CHANNEL_REQUEST_CLASSES[status]
      expect(clases, `falta el color de "${status}"`).toBeTruthy()
      // Fondo + texto + borde: un badge a medias se lee como un bug visual.
      expect(clases).toMatch(/bg-/)
      expect(clases).toMatch(/text-/)
      expect(clases).toMatch(/border/)
    }
  })

  it('no hay etiquetas ni colores de estados que ya no existen', () => {
    const canonicos = new Set<string>(CHANNEL_REQUEST_STATUSES)
    for (const clave of Object.keys(CHANNEL_REQUEST_LABELS)) expect(canonicos.has(clave)).toBe(true)
    for (const clave of Object.keys(CHANNEL_REQUEST_CLASSES)) expect(canonicos.has(clave)).toBe(true)
  })

  it('los estados abiertos y los cerrados se distinguen por color', () => {
    const cerrado: ChannelRequestStatus[] = ['connected', 'rejected']
    for (const s of cerrado) expect(CHANNEL_REQUEST_CLASSES[s]).not.toBe(CHANNEL_REQUEST_CLASSES.pending)
  })

  it('los tres medios de contacto tienen nombre en español', () => {
    expect(CHANNEL_REQUEST_MEDIUM_LABELS.call).toBe('Llamada')
    expect(CHANNEL_REQUEST_MEDIUM_LABELS.whatsapp).toBe('WhatsApp')
    expect(CHANNEL_REQUEST_MEDIUM_LABELS.video).toBe('Videollamada')
  })
})
