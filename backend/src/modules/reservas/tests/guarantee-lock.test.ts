// reservas/tests/guarantee-lock.test.ts — B1 (auditoría 2026-08-19): el PIN de garantía
// no podía probarse indefinidamente. Protege: tope de intentos, lock incluso con PIN
// correcto, expiración, y reset por acierto.
import { describe, it, expect, beforeEach, spyOn } from 'bun:test'
import { setGuaranteePin, unlockGuaranteeCard, __resetPinFailsForTests } from '../usecases/guarantee'

const HOTEL = 'h1'
const user = { id: 'u1', role: 'hotel_admin', hotelId: HOTEL }
const reserva = { id: 'r1', hotelId: HOTEL, hasGuaranteeCard: 1, cardLast4: '4242', cardHolder: 'Juan P', cardBrand: 'visa' }

function makeQueries() {
  const store = new Map<string, any>()
  return {
    store,
    findConfiguration: async (hid: string, key: string) => store.get(`${hid}|${key}`) ?? null,
    upsertConfiguration: async (hid: string, key: string, value: any) => { store.set(`${hid}|${key}`, { value }) },
    findHotels: async () => [],
  } as any
}

async function setup(pin = '1234') {
  const queries = makeQueries()
  await setGuaranteePin(queries, { findMany: async () => [] }, user, { pin })
  const repo = { findById: async () => reserva } as any
  return { queries, repo }
}

describe('guarantee PIN lockout (B1)', () => {
  beforeEach(() => __resetPinFailsForTests())

  it('4 fallos avisan intentos restantes; el 5º bloquea 15 minutos', async () => {
    const { queries, repo } = await setup('1234')
    for (let i = 4; i > 0; i--) {
      await expect(unlockGuaranteeCard(queries, repo, {}, 'r1', user, { pin: '0000' }, undefined)).rejects.toThrow(`${i} intento`)
    }
    // 5º fallo dispara el lock
    await expect(unlockGuaranteeCard(queries, repo, {}, 'r1', user, { pin: '0000' }, undefined)).rejects.toThrow('PIN incorrecto')
    // y a partir de acá, incluso el PIN CORRECTO queda bloqueado con mensaje de espera
    await expect(unlockGuaranteeCard(queries, repo, {}, 'r1', user, { pin: '1234' }, undefined)).rejects.toThrow('Demasiados intentos fallidos')
  })

  it('el lock expira y el PIN correcto vuelve a funcionar', async () => {
    const { queries, repo } = await setup('1234')
    for (let i = 0; i < 5; i++) {
      await unlockGuaranteeCard(queries, repo, {}, 'r1', user, { pin: '0000' }, undefined).catch(() => {})
    }
    await expect(unlockGuaranteeCard(queries, repo, {}, 'r1', user, { pin: '1234' }, undefined)).rejects.toThrow('Demasiados intentos')

    const realNow = Date.now
    const spy = spyOn(Date, 'now').mockReturnValue(realNow() + 16 * 60 * 1000) // +16 min: lock vencido
    const card = await unlockGuaranteeCard(queries, repo, {}, 'r1', user, { pin: '1234' }, undefined)
    spy.mockRestore()
    expect(card.cardLast4).toBe('4242')
  })

  it('acierto temprano resetea el contador (sin acumular fallos eternos)', async () => {
    const { queries, repo } = await setup('1234')
    await unlockGuaranteeCard(queries, repo, {}, 'r1', user, { pin: '0000' }, undefined).catch(() => {})
    await unlockGuaranteeCard(queries, repo, {}, 'r1', user, { pin: '0000' }, undefined).catch(() => {})
    const card = await unlockGuaranteeCard(queries, repo, {}, 'r1', user, { pin: '1234' }, undefined)
    expect(card.cardHolder).toBe('Juan P')
    // 2 fallos más NO bloquean (contador volvió a cero con el acierto)
    await unlockGuaranteeCard(queries, repo, {}, 'r1', user, { pin: '0000' }, undefined).catch(() => {})
    await unlockGuaranteeCard(queries, repo, {}, 'r1', user, { pin: '0000' }, undefined).catch(() => {})
    await expect(unlockGuaranteeCard(queries, repo, {}, 'r1', user, { pin: '1234' }, undefined)).resolves.toMatchObject({ cardLast4: '4242' })
  })

  it('el lock es POR HOTEL: otro hotel no se ve afectado', async () => {
    const { queries, repo } = await setup('1234')
    for (let i = 0; i < 5; i++) {
      await unlockGuaranteeCard(queries, repo, {}, 'r1', user, { pin: '0000' }, undefined).catch(() => {})
    }
    const otro = { id: 'u2', role: 'hotel_admin', hotelId: 'h2' }
    const repoH2 = { findById: async () => ({ ...reserva, hotelId: 'h2' }) } as any
    // h2 sin PIN configurado → otro error distinto al lock (prueba que no llega bloqueado)
    await expect(unlockGuaranteeCard(queries, repoH2, {}, 'r1', otro, { pin: '1234' }, undefined)).rejects.toThrow('No hay PIN')
  })
})
