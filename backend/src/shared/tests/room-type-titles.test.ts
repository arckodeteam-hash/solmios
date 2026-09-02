// room-type-titles.test.ts — El tipo local es un código; lo que se publica en el canal (y ve el
// huésped en la OTA) es un título. La vuelta tiene que resolver las reservas entrantes.
import { describe, it, expect } from 'bun:test'
import { channexRoomTypeTitle, localRoomTypeFromTitle } from '../utils/room-type-titles'

describe('channexRoomTypeTitle', () => {
  it('traduce los códigos del enum a títulos vendibles', () => {
    expect(channexRoomTypeTitle('twin')).toBe('Twin Room')
    expect(channexRoomTypeTitle('double')).toBe('Double Room')
    expect(channexRoomTypeTitle('suite')).toBe('Suite')
    expect(channexRoomTypeTitle('DELUXE')).toBe('Deluxe Room')
  })

  it("'n' (el código histórico del twin en el panel) no llega crudo a la OTA", () => {
    expect(channexRoomTypeTitle('n')).toBe('Twin Room')
  })

  it('un código desconocido se publica en Title Case, no en crudo', () => {
    expect(channexRoomTypeTitle('garden_view')).toBe('Garden View')
    expect(channexRoomTypeTitle('')).toBe('')
  })
})

describe('localRoomTypeFromTitle', () => {
  it('vuelve al código del enum (y elige twin, no el legacy n)', () => {
    expect(localRoomTypeFromTitle('Twin Room')).toBe('twin')
    expect(localRoomTypeFromTitle('double room')).toBe('double')
  })

  it('deja pasar el título tal cual si no lo conoce (properties sincronizadas antes del cambio)', () => {
    expect(localRoomTypeFromTitle('double')).toBe('double')
    expect(localRoomTypeFromTitle('Habitación Jardín')).toBe('Habitación Jardín')
  })
})
