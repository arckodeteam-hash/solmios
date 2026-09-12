import { describe, it, expect } from 'bun:test'
import {
  parseRoomInfoConfig, ROOM_INFO_DEFAULTS, MIN_HOURS_BEFORE, MAX_HOURS_BEFORE,
  buildRoomInfo, roomInfoFingerprint, roomInfoDedupKey,
  renderRoomInfoEmail, renderRoomInfoText,
  roomInfoSendState, channelsFor, ROOM_INFO_MAX_ATTEMPTS,
  type RoomInfoConfig, type RoomInfoData, type RoomInfoLog,
} from '../room-info-notice'

const HOTEL = { id: 'h1', name: 'Hotel Palma', checkIn: '15:00', checkOut: '12:00', timezone: 'America/Santo_Domingo' }
const RESERVA = { id: '9503bb41-cad6-4f99-8a1b-000000000001', hotelId: 'h1', roomId: 'r1', checkIn: '2026-09-12', checkOut: '2026-09-14' }
const ROOM = { id: 'r1', number: 101, name: 'Suite Mar' }
const GUEST = { id: 'g1', name: 'Ana Pérez' }

function info(over: Partial<RoomInfoData> = {}): RoomInfoData {
  return {
    roomNumber: '101', roomName: 'Suite Mar', accessCode: '4821', accessFrom: '15:00', accessUntil: '12:00',
    checkIn: '2026-09-12', checkOut: '2026-09-14', preCheckinUrl: 'https://app.test/checkin/9503bb41cad6',
    guestName: 'Ana', hotelName: 'Hotel Palma', ...over,
  }
}

describe('parseRoomInfoConfig', () => {
  it('null/undefined/basura → defaults (apagado, 24 h, email)', () => {
    expect(parseRoomInfoConfig(null)).toEqual(ROOM_INFO_DEFAULTS)
    expect(parseRoomInfoConfig(undefined)).toEqual(ROOM_INFO_DEFAULTS)
    expect(parseRoomInfoConfig('no es json')).toEqual(ROOM_INFO_DEFAULTS)
    expect(parseRoomInfoConfig([1, 2])).toEqual(ROOM_INFO_DEFAULTS)
    expect(ROOM_INFO_DEFAULTS.enabled).toBe(false)
  })

  it('acepta objeto y string JSON por igual', () => {
    const obj = { enabled: true, hoursBefore: 48, channel: 'both', whatsappTemplateId: '  tpl_1 ' }
    const expected: RoomInfoConfig = { enabled: true, hoursBefore: 48, channel: 'both', whatsappTemplateId: 'tpl_1' }
    expect(parseRoomInfoConfig(obj)).toEqual(expected)
    expect(parseRoomInfoConfig(JSON.stringify(obj))).toEqual(expected)
  })

  it('clampa hoursBefore a [1,168], redondea y cae a 24 si no es número', () => {
    expect(parseRoomInfoConfig({ hoursBefore: 0 }).hoursBefore).toBe(MIN_HOURS_BEFORE)
    expect(parseRoomInfoConfig({ hoursBefore: 500 }).hoursBefore).toBe(MAX_HOURS_BEFORE)
    expect(parseRoomInfoConfig({ hoursBefore: 'x' }).hoursBefore).toBe(24)
    expect(parseRoomInfoConfig({ hoursBefore: 12.6 }).hoursBefore).toBe(13)
    expect(parseRoomInfoConfig({ hoursBefore: '36' }).hoursBefore).toBe(36)
  })

  it('channel fuera del enum → email; enabled se vuelve boolean', () => {
    expect(parseRoomInfoConfig({ channel: 'sms' }).channel).toBe('email')
    expect(parseRoomInfoConfig({ channel: 'whatsapp' }).channel).toBe('whatsapp')
    expect(parseRoomInfoConfig({ enabled: 'true' }).enabled).toBe(true)
    expect(parseRoomInfoConfig({ enabled: 'no' }).enabled).toBe(false)
    expect(parseRoomInfoConfig({ whatsappTemplateId: null }).whatsappTemplateId).toBe('')
  })
})

describe('buildRoomInfo', () => {
  it('arma número, nombre, código, horario del hotel y link de check-in', () => {
    const r = buildRoomInfo({ reservation: RESERVA, room: ROOM, hotel: HOTEL, guest: GUEST, lockCode: ' 4821 ', publicUrl: 'https://app.test/' })
    expect(r.roomNumber).toBe('101')
    expect(r.roomName).toBe('Suite Mar')
    expect(r.accessCode).toBe('4821')
    expect(r.accessFrom).toBe('15:00')
    expect(r.accessUntil).toBe('12:00')
    expect(r.checkIn).toBe('2026-09-12')
    expect(r.checkOut).toBe('2026-09-14')
    expect(r.preCheckinUrl).toBe('https://app.test/checkin/9503bb41cad6')
    expect(r.guestName).toBe('Ana Pérez')
    expect(r.hotelName).toBe('Hotel Palma')
  })

  it('preCheckinUrl vacío si el check-in ya se completó o no hay publicUrl', () => {
    const done = buildRoomInfo({ reservation: { ...RESERVA, preCheckinStatus: 'completed' }, room: ROOM, hotel: HOTEL, publicUrl: 'https://app.test' })
    expect(done.preCheckinUrl).toBe('')
    const noUrl = buildRoomInfo({ reservation: RESERVA, room: ROOM, hotel: HOTEL })
    expect(noUrl.preCheckinUrl).toBe('')
    const blank = buildRoomInfo({ reservation: RESERVA, room: ROOM, hotel: HOTEL, publicUrl: '   ' })
    expect(blank.preCheckinUrl).toBe('')
  })

  it('accessCode vacío si lockCode es null; el override de la reserva pisa el horario del hotel', () => {
    const r = buildRoomInfo({ reservation: RESERVA, room: ROOM, hotel: HOTEL, lockCode: null })
    expect(r.accessCode).toBe('')
    // Sin checkInTime en la reserva cae al del hotel (17:00, no el default 15:00).
    const hotelLate = buildRoomInfo({ reservation: RESERVA, room: ROOM, hotel: { ...HOTEL, checkIn: '17:00' } })
    expect(hotelLate.accessFrom).toBe('17:00')
    const early = buildRoomInfo({ reservation: { ...RESERVA, checkInTime: '10:00' }, room: ROOM, hotel: HOTEL })
    expect(early.accessFrom).toBe('10:00')
  })

  it('degrada a "Huésped" / "Hotel" sin datos', () => {
    const r = buildRoomInfo({ reservation: RESERVA, room: {}, hotel: null })
    expect(r.guestName).toBe('Huésped')
    expect(r.hotelName).toBe('Hotel')
    expect(r.roomNumber).toBe('')
    expect(r.roomName).toBe('')
  })
})

describe('roomInfoFingerprint / roomInfoDedupKey', () => {
  it('16 chars hex, cambia con la habitación o el código, y no expone el código', () => {
    const a = roomInfoFingerprint('r1', '4821')
    expect(a).toMatch(/^[0-9a-f]{16}$/)
    expect(roomInfoFingerprint('r1', '4821')).toBe(a)
    expect(roomInfoFingerprint('r2', '4821')).not.toBe(a)
    expect(roomInfoFingerprint('r1', '9999')).not.toBe(a)
    expect(a).not.toContain('4821')
    expect(roomInfoDedupKey(a)).toBe(`auto:room_info:${a}`)
  })
})

describe('renderRoomInfoEmail', () => {
  it('incluye número, nombre, código, horario y link cuando existen', () => {
    const { subject, html } = renderRoomInfoEmail(info())
    expect(subject).toBe('Tu habitación en Hotel Palma')
    expect(html).toContain('Habitación 101')
    expect(html).toContain('Suite Mar')
    expect(html).toContain('Código de acceso')
    expect(html).toContain('>4821<')
    expect(html).toContain('desde las 15:00 del 2026-09-12 hasta las 12:00 del 2026-09-14')
    expect(html).toContain('href="https://app.test/checkin/9503bb41cad6"')
    expect(html).toContain('Completar check-in digital')
    expect(html).toContain('Hola <strong>Ana</strong>')
  })

  it('omite el bloque de código, el horario y el botón cuando faltan', () => {
    const { html } = renderRoomInfoEmail(info({ accessCode: '', accessFrom: '', preCheckinUrl: '', roomName: '' }))
    expect(html).not.toContain('Código de acceso')
    expect(html).not.toContain('Horario de acceso')
    expect(html).not.toContain('Completar check-in digital')
    expect(html).toContain('Habitación 101')
  })

  it('escapa HTML en todos los campos', () => {
    const { html } = renderRoomInfoEmail(info({ guestName: '<script>alert(1)</script>', roomName: 'A & B', accessCode: '<b>1</b>' }))
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('A &amp; B')
    expect(html).not.toContain('<b>1</b>')
  })
})

describe('renderRoomInfoText', () => {
  it('texto plano con las mismas reglas de "sólo si está"', () => {
    const full = renderRoomInfoText(info())
    expect(full).toContain('Habitación 101 — Suite Mar')
    expect(full).toContain('Código de acceso: 4821')
    expect(full).toContain('Horario de acceso: desde las 15:00 del 2026-09-12 hasta las 12:00 del 2026-09-14.')
    expect(full).toContain('Completar check-in digital: https://app.test/checkin/9503bb41cad6')
    const bare = renderRoomInfoText(info({ accessCode: '', accessFrom: '', preCheckinUrl: '', roomName: '' }))
    expect(bare).toContain('Habitación 101\n')
    expect(bare).not.toContain('Código de acceso')
    expect(bare).not.toContain('Horario de acceso')
    expect(bare).not.toContain('check-in digital')
  })
})

describe('roomInfoSendState', () => {
  const KEY = roomInfoDedupKey('abc')
  const failed = (channel = 'email'): RoomInfoLog => ({ response: KEY, channel, status: 'failed' })

  it('sin filas → pending', () => {
    expect(roomInfoSendState([], KEY, 'email')).toBe('pending')
  })

  it('sent o queued con la misma key+canal → sent, aunque haya fallos anteriores', () => {
    expect(roomInfoSendState([failed(), failed(), failed(), { response: KEY, channel: 'email', status: 'sent' }], KEY, 'email')).toBe('sent')
    expect(roomInfoSendState([{ response: KEY, channel: 'email', status: 'queued' }], KEY, 'email')).toBe('sent')
  })

  it('3 failed → exhausted; 2 failed → pending (se reintenta)', () => {
    expect(ROOM_INFO_MAX_ATTEMPTS).toBe(3)
    expect(roomInfoSendState([failed(), failed(), failed()], KEY, 'email')).toBe('exhausted')
    expect(roomInfoSendState([failed(), failed()], KEY, 'email')).toBe('pending')
  })

  it('otro canal u otra key no cuentan', () => {
    const logs: RoomInfoLog[] = [
      { response: KEY, channel: 'email', status: 'sent' },
      failed('whatsapp_api'), failed('whatsapp_api'), failed('whatsapp_api'),
      { response: roomInfoDedupKey('otra'), channel: 'email', status: 'failed' },
    ]
    expect(roomInfoSendState(logs, KEY, 'whatsapp_api')).toBe('exhausted')
    expect(roomInfoSendState(logs, KEY, 'email')).toBe('sent')
    expect(roomInfoSendState(logs, roomInfoDedupKey('otra'), 'email')).toBe('pending')
    expect(roomInfoSendState(logs, roomInfoDedupKey('nueva'), 'whatsapp_api')).toBe('pending')
  })
})

describe('channelsFor', () => {
  it('mapea el enum de config a los canales de message_logs', () => {
    expect(channelsFor({ ...ROOM_INFO_DEFAULTS, channel: 'email' })).toEqual(['email'])
    expect(channelsFor({ ...ROOM_INFO_DEFAULTS, channel: 'whatsapp' })).toEqual(['whatsapp_api'])
    expect(channelsFor({ ...ROOM_INFO_DEFAULTS, channel: 'both' })).toEqual(['email', 'whatsapp_api'])
  })
})
