// shared/usecases/tests/find-or-create-guest.test.ts — MR-08 (#273): un huésped = una ficha.
//
// Fake in-memory del `GuestsPort` sobre un array. Las lecturas toman su snapshot y DESPUÉS ceden
// el event loop (como una consulta real: lo que se leyó no cambia mientras viaja la respuesta)
// para que el caso de concurrencia reproduzca la carrera check-then-insert y demuestre que el
// lock de fila `Hotels` es lo que la evita.
import { describe, it, expect } from 'bun:test'
import { findOrCreateGuest, guestsOnTx, normalizeGuestEmail, type GuestsPort } from '../find-or-create-guest'
import { toE164 } from '../../utils/phone-e164'

function makeGuests(seed: any[] = []) {
  const rows: any[] = seed.map(r => ({ ...r }))
  const match = (row: any, filter: any) => Object.entries(filter ?? {}).every(([k, v]) => row[k] === v)
  let creates = 0
  const yieldLoop = () => new Promise<void>(r => setTimeout(r, 0))
  const port: GuestsPort = {
    async findOne(filter) { const hit = rows.find(r => match(r, filter)) ?? null; await yieldLoop(); return hit },
    async findMany(filter) { const hits = rows.filter(r => match(r, filter)); await yieldLoop(); return hits },
    async create(data) { creates++; const row = { ...data }; rows.push(row); return row },
    async update(id, data) { const row = rows.find(r => r.id === id); if (row) Object.assign(row, data); return row ?? null },
  }
  return { rows, port, creates: () => creates }
}

describe('normalizeGuestEmail', () => {
  it('lower + trim, vacío → ""', () => {
    expect(normalizeGuestEmail('  Ana@Mail.com ')).toBe('ana@mail.com')
    expect(normalizeGuestEmail(undefined)).toBe('')
    expect(normalizeGuestEmail('   ')).toBe('')
  })
})

describe('findOrCreateGuest', () => {
  it('(a) mismo email con distinta mayúscula/espacios → 1 fila, mismo id', async () => {
    const w = makeGuests()
    const first = await findOrCreateGuest({ guests: w.port }, { hotelId: 'h1', name: 'Ana', email: 'Ana@Mail.com ' })
    const second = await findOrCreateGuest({ guests: w.port }, { hotelId: 'h1', name: 'Ana P.', email: 'ana@mail.com' })
    expect(first.created).toBe(true)
    expect(first.guest.email).toBe('ana@mail.com')
    expect(second.created).toBe(false)
    expect(second.matchedBy).toBe('email')
    expect(second.guest.id).toBe(first.guest.id)
    expect(w.rows.length).toBe(1)
    expect(w.rows[0].name).toBe('Ana') // el nombre cargado no se pisa
  })

  it('(a bis) ficha vieja guardada con mayúsculas se reusa igual', async () => {
    const w = makeGuests([{ id: 'g-old', hotelId: 'h1', name: 'Ana', email: 'ANA@MAIL.COM', phone: '' }])
    const r = await findOrCreateGuest({ guests: w.port }, { hotelId: 'h1', name: 'Ana', email: 'ana@mail.com' })
    expect(r.created).toBe(false)
    expect(r.guest.id).toBe('g-old')
    expect(w.rows.length).toBe(1)
    // Y al revés: tipeado con otra capitalización distinta de la guardada y de la normalizada.
    const r2 = await findOrCreateGuest({ guests: w.port }, { hotelId: 'h1', name: 'Ana', email: ' Ana@Mail.Com' })
    expect(r2.guest.id).toBe('g-old')
    expect(w.rows.length).toBe(1)
  })

  it('un error de lectura se propaga: no se crea una ficha "porque no existe"', async () => {
    const w = makeGuests()
    const port = { ...w.port, findOne: async () => { throw new Error('db down') } }
    await expect(findOrCreateGuest({ guests: port }, { hotelId: 'h1', name: 'Ana', email: 'ana@mail.com' })).rejects.toThrow('db down')
    expect(w.rows.length).toBe(0)
  })

  it('(b) sin email coincidente, 809-555-0000 y +1 809 555 0000 son la misma ficha', async () => {
    expect(toE164('809-555-0000', 'DO')).toBe(toE164('+1 809 555 0000'))
    const w = makeGuests()
    const first = await findOrCreateGuest({ guests: w.port }, { hotelId: 'h1', name: 'Luis', email: '', phone: '809-555-0000' })
    const second = await findOrCreateGuest({ guests: w.port }, { hotelId: 'h1', name: 'Luis', email: 'luis@mail.com', phone: '+1 809 555 0000' })
    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.matchedBy).toBe('phone')
    expect(second.guest.id).toBe(first.guest.id)
    expect(w.rows.length).toBe(1)
    // match por phone con email vacío en la ficha → se completa el email
    expect(w.rows[0].email).toBe('luis@mail.com')
    // el teléfono ya cargado queda tal cual vino la primera vez
    expect(w.rows[0].phone).toBe('809-555-0000')
  })

  it('(b bis) ficha vieja con phone en formato libre y sin email → match por phone normalizado', async () => {
    const w = makeGuests([{ id: 'g-1', hotelId: 'h1', name: 'Luis', email: 'otro@mail.com', phone: '(809) 555 0000' }])
    const r = await findOrCreateGuest({ guests: w.port }, { hotelId: 'h1', name: 'Luis', email: 'nuevo@mail.com', phone: '18095550000' })
    expect(r.created).toBe(false)
    expect(r.matchedBy).toBe('phone')
    expect(r.guest.id).toBe('g-1')
    expect(w.rows[0].email).toBe('otro@mail.com') // email cargado no se pisa
  })

  it('(c) phone cargado no se pisa; phone vacío se completa; name vacío se completa', async () => {
    const w = makeGuests([
      { id: 'g-full', hotelId: 'h1', name: 'Ana', email: 'ana@mail.com', phone: '+1 809 111 1111' },
      { id: 'g-empty', hotelId: 'h1', name: '', email: 'beto@mail.com', phone: '' },
    ])
    const a = await findOrCreateGuest({ guests: w.port }, { hotelId: 'h1', name: 'Ana', email: 'ana@mail.com', phone: '+1 809 999 9999' })
    expect(a.created).toBe(false)
    expect(a.guest.phone).toBe('+1 809 111 1111')
    expect(w.rows[0].phone).toBe('+1 809 111 1111')

    const b = await findOrCreateGuest({ guests: w.port }, { hotelId: 'h1', name: 'Beto', email: 'BETO@mail.com', phone: '809-222-2222' })
    expect(b.created).toBe(false)
    expect(b.guest.phone).toBe('809-222-2222')
    expect(b.guest.name).toBe('Beto')
    expect(w.rows[1].phone).toBe('809-222-2222')
    expect(w.rows[1].name).toBe('Beto')
    expect(w.rows.length).toBe(2)
  })

  it('(d) mismo email en otro hotelId → ficha nueva', async () => {
    const w = makeGuests()
    const a = await findOrCreateGuest({ guests: w.port }, { hotelId: 'h1', name: 'Ana', email: 'ana@mail.com' })
    const b = await findOrCreateGuest({ guests: w.port }, { hotelId: 'h2', name: 'Ana', email: 'ana@mail.com' })
    expect(a.created).toBe(true)
    expect(b.created).toBe(true)
    expect(b.guest.id).not.toBe(a.guest.id)
    expect(w.rows.length).toBe(2)
  })

  it('sin email ni phone → crea siempre (no hay con qué deduplicar)', async () => {
    const w = makeGuests()
    await findOrCreateGuest({ guests: w.port }, { hotelId: 'h1', name: 'Anon' })
    await findOrCreateGuest({ guests: w.port }, { hotelId: 'h1', name: 'Anon' })
    expect(w.rows.length).toBe(2)
    expect(w.rows[0].documentType).toBe('passport')
    expect(w.rows[0].phone).toBe('')
  })

  it('extra va solo al create', async () => {
    const w = makeGuests()
    const a = await findOrCreateGuest({ guests: w.port }, { hotelId: 'h1', name: 'Ana', email: 'ana@mail.com', extra: { nationality: 'DO' } })
    expect(a.guest.nationality).toBe('DO')
    const b = await findOrCreateGuest({ guests: w.port }, { hotelId: 'h1', name: 'Ana', email: 'ana@mail.com', extra: { nationality: 'US' } })
    expect(b.created).toBe(false)
    expect(w.rows[0].nationality).toBe('DO')
  })

  it('puerto sin update pero con updateMany → completa con updateMany({id})', async () => {
    const rows: any[] = [{ id: 'g-1', hotelId: 'h1', name: '', email: 'ana@mail.com', phone: '' }]
    const calls: any[] = []
    const port: GuestsPort = {
      async findOne(f) { return rows.find(r => Object.entries(f).every(([k, v]) => r[k] === v)) ?? null },
      async create(d) { rows.push(d); return d },
      async updateMany(f, d) { calls.push([f, d]); rows.filter(r => r.id === f.id).forEach(r => Object.assign(r, d)); return 1 },
    }
    const r = await findOrCreateGuest({ guests: port }, { hotelId: 'h1', name: 'Ana', email: 'ana@mail.com', phone: '809-555-0000' })
    expect(r.created).toBe(false)
    expect(calls).toEqual([[{ id: 'g-1' }, { name: 'Ana', phone: '809-555-0000' }]])
  })
})

describe('guestsOnTx', () => {
  it('traduce el puerto a las firmas de la tx del ORM (modelo Guests)', async () => {
    const calls: any[] = []
    const tx = {
      async findOne(m: string, f: any) { calls.push(['findOne', m, f]); return null },
      async findMany(m: string, f: any) { calls.push(['findMany', m, f]); return [] },
      async create(m: string, d: any) { calls.push(['create', m, d.email]); return d },
      async update(m: string, id: string, d: any) { calls.push(['update', m, id, d]); return d },
      async updateMany(m: string, f: any, d: any) { calls.push(['updateMany', m, f, d]); return 1 },
    }
    const port = guestsOnTx(tx)
    await port.findOne({ hotelId: 'h1', email: 'a@b.c' })
    await port.findMany!({ hotelId: 'h1' })
    await port.create({ email: 'a@b.c' })
    await port.update!('g-1', { name: 'X' })
    await port.updateMany!({ id: 'g-1' }, { name: 'Y' })
    expect(calls).toEqual([
      ['findOne', 'Guests', { hotelId: 'h1', email: 'a@b.c' }],
      ['findMany', 'Guests', { hotelId: 'h1' }],
      ['create', 'Guests', 'a@b.c'],
      ['update', 'Guests', 'g-1', { name: 'X' }],
      ['updateMany', 'Guests', { id: 'g-1' }, { name: 'Y' }],
    ])
  })

  it('tx sin findMany/update/updateMany → el puerto tampoco los expone (degrada, no revienta)', async () => {
    const port = guestsOnTx({ async findOne() { return null }, async create(_m: string, d: any) { return d } })
    expect(port.findMany).toBeUndefined()
    expect(port.update).toBeUndefined()
    expect(port.updateMany).toBeUndefined()
    expect(port.findOne).toBeFunction()
    const r = await findOrCreateGuest({ guests: port }, { hotelId: 'h1', name: 'Ana', email: 'ana@mail.com', phone: '809-555-0000' })
    expect(r.created).toBe(true)
  })
})

describe('concurrencia: dos reservas con el mismo email nuevo a la vez', () => {
  /** Mutex por promesa encadenada: simula el row lock de `Hotels` que PG mantiene hasta el COMMIT. */
  function makeHotelLock() {
    let chain: Promise<void> = Promise.resolve()
    let locks = 0
    const acquire = (): Promise<() => void> => {
      let release!: () => void
      const mine = new Promise<void>(r => { release = r })
      const prev = chain
      chain = prev.then(() => mine)
      return prev.then(() => { locks++; return release })
    }
    /** Simula `orm.transaction`: el lock tomado dentro se suelta recién al terminar (COMMIT). */
    const inTx = async <T>(fn: (lockTx: any) => Promise<T>): Promise<T> => {
      const held: { release: (() => void) | null } = { release: null }
      const lockTx = {
        async updateMany(model: string) {
          if (model === 'Hotels' && !held.release) held.release = await acquire()
          return 1
        },
      }
      try { return await fn(lockTx) } finally { held.release?.() }
    }
    return { inTx, locks: () => locks }
  }

  const input = { hotelId: 'h1', name: 'Ana', email: 'ana@mail.com', phone: '809-555-0000' }

  it('(e) con lock de fila Hotels → 1 create, mismo id', async () => {
    const w = makeGuests()
    const lock = makeHotelLock()
    const [a, b] = await Promise.all([
      lock.inTx(lockTx => findOrCreateGuest({ guests: w.port, lockTx }, input)),
      lock.inTx(lockTx => findOrCreateGuest({ guests: w.port, lockTx }, { ...input, email: 'ANA@mail.com ' })),
    ])
    expect(lock.locks()).toBe(2)
    expect(w.creates()).toBe(1)
    expect(w.rows.length).toBe(1)
    expect(a.guest.id).toBe(b.guest.id)
    expect([a.created, b.created].sort()).toEqual([false, true])
  })

  it('(e contraste) sin lock, el check-then-insert crea 2 fichas: el lock es lo que lo evita', async () => {
    const w = makeGuests()
    await Promise.all([
      findOrCreateGuest({ guests: w.port }, input),
      findOrCreateGuest({ guests: w.port }, { ...input }),
    ])
    expect(w.creates()).toBe(2)
    expect(w.rows.length).toBe(2)
  })

  it('lockTx sin updateMany (mock viejo) → no revienta, degrada al check-then-insert', async () => {
    const w = makeGuests()
    const r = await findOrCreateGuest({ guests: w.port, lockTx: {} }, input)
    expect(r.created).toBe(true)
  })

  it('el UPDATE de lock que falla no aborta la búsqueda', async () => {
    const w = makeGuests([{ id: 'g-1', hotelId: 'h1', name: 'Ana', email: 'ana@mail.com', phone: '' }])
    const lockTx = { async updateMany() { throw new Error('boom') } }
    const r = await findOrCreateGuest({ guests: w.port, lockTx }, input)
    expect(r.created).toBe(false)
    expect(r.guest.id).toBe('g-1')
  })
})
