import { describe, it, expect } from 'bun:test'
import {
  resolverHotelDelEvento,
  resolverHotelDeVerificacion,
  wabaIdDelEvento,
  type WhatsappConfigRow,
} from '../usecases/webhook-routing'

function repoCon(filas: WhatsappConfigRow[]) {
  return {
    async findMany(where?: Record<string, unknown>) {
      if (!where || Object.keys(where).length === 0) return filas
      return filas.filter((f) => Object.entries(where).every(([k, v]) => (f as any)[k] === v))
    },
  }
}

const HOTEL_A: WhatsappConfigRow = { hotelId: 'hotel-a', wabaId: 'waba-aaa', verifyToken: 'token-a' }
const HOTEL_B: WhatsappConfigRow = { hotelId: 'hotel-b', wabaId: 'waba-bbb', verifyToken: 'token-b' }

const evento = (waba: string) => ({ entry: [{ id: waba, changes: [{ value: { messages: [{ from: '1809', text: { body: 'hola' } }] } }] }] })

describe('a qué hotel pertenece un evento de WhatsApp', () => {
  it('el dueño sale de la cuenta de WhatsApp, no de la URL', async () => {
    // El caso que motivó el cambio: Meta acepta UNA sola URL por app. Si esa URL quedó dada de
    // alta con el hotel A en el path, los mensajes del hotel B llegan por la misma URL.
    const hotel = await resolverHotelDelEvento(repoCon([HOTEL_A, HOTEL_B]), 'hotel-a', evento('waba-bbb'))
    expect(hotel).toBe('hotel-b')
  })

  it('sin path, igual identifica al hotel', async () => {
    expect(await resolverHotelDelEvento(repoCon([HOTEL_A, HOTEL_B]), undefined, evento('waba-aaa'))).toBe('hotel-a')
  })

  it('descarta el evento de una cuenta que no es de ningún hotel', async () => {
    expect(await resolverHotelDelEvento(repoCon([HOTEL_A]), 'hotel-a', evento('waba-desconocida'))).toBeNull()
  })

  it('sin cuenta en el evento cae al path, pero sólo si ese hotel tiene conexión', async () => {
    expect(await resolverHotelDelEvento(repoCon([HOTEL_A]), 'hotel-a', { entry: [{}] })).toBe('hotel-a')
    expect(await resolverHotelDelEvento(repoCon([HOTEL_A]), 'hotel-inventado', { entry: [{}] })).toBeNull()
    expect(await resolverHotelDelEvento(repoCon([HOTEL_A]), undefined, {})).toBeNull()
  })

  it('lee el id de cuenta del evento', () => {
    expect(wabaIdDelEvento(evento('waba-aaa'))).toBe('waba-aaa')
    expect(wabaIdDelEvento({})).toBeNull()
    expect(wabaIdDelEvento({ entry: [{ id: '' }] })).toBeNull()
  })
})

describe('alta del webhook (el GET de verificación)', () => {
  it('acepta el token del hotel', async () => {
    expect(await resolverHotelDeVerificacion(repoCon([HOTEL_A, HOTEL_B]), undefined, 'token-b')).toBe('hotel-b')
  })

  it('rechaza un token que no es de nadie', async () => {
    expect(await resolverHotelDeVerificacion(repoCon([HOTEL_A]), undefined, 'token-falso')).toBeNull()
    expect(await resolverHotelDeVerificacion(repoCon([HOTEL_A]), undefined, '')).toBeNull()
  })

  it('con el hotel en la URL, el token tiene que ser el de ESE hotel', async () => {
    expect(await resolverHotelDeVerificacion(repoCon([HOTEL_A, HOTEL_B]), 'hotel-a', 'token-b')).toBeNull()
    expect(await resolverHotelDeVerificacion(repoCon([HOTEL_A, HOTEL_B]), 'hotel-a', 'token-a')).toBe('hotel-a')
  })

  it('un token repetido en dos hoteles no vale para ninguno', async () => {
    const clonado = { ...HOTEL_B, verifyToken: 'token-a' }
    expect(await resolverHotelDeVerificacion(repoCon([HOTEL_A, clonado]), undefined, 'token-a')).toBeNull()
  })
})
