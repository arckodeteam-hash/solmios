// El alta pública tiene que dejar el hotel USABLE. El bug que motivó esto: el
// alta del super-admin crea la fila del hotel y nada más, así que nadie puede
// entrar (sin usuario) ni configurar permisos (sin roles).
import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import { SignupUseCase, TRIAL_DAYS } from '../usecases/signup'
import type { Logger, RepositoryAdapter } from 'arckode-framework'

/** Logger que además guarda los `warn`: los envíos del alta son best-effort y lo único
 *  que queda de un fallo es esa línea de log (issue #27). */
function recordingLogger(): { logger: Logger; warns: Array<{ msg: string; meta: any }> } {
  const warns: Array<{ msg: string; meta: any }> = []
  const base = silentLogger()
  const logger = { ...base, warn: (msg: string, meta?: any) => { warns.push({ msg, meta }) } } as unknown as Logger
  return { logger, warns }
}

const NOW = new Date('2026-07-19T12:00:00Z')

function setup(existingUsers: any[] = []) {
  const hotels: any[] = []
  const users: any[] = [...existingUsers]
  const roles: any[] = []
  const subs: any[] = []
  const repo = (store: any[]): RepositoryAdapter<any> => ({
    create: async (row: any) => { store.push(row); return row },
    findMany: async (f: any = {}) => store.filter(r =>
      Object.entries(f).every(([k, v]) => r[k] === v)),
  } as unknown as RepositoryAdapter<any>)

  const uc = new SignupUseCase({
    hotelsRepo: repo(hotels),
    usersRepo: repo(users),
    rolesRepo: repo(roles),
    subscriptionsRepo: repo(subs),
    hashPassword: async (p: string) => `hashed:${p}`,
    logger: silentLogger(),
  })
  return { uc, hotels, users, roles, subs }
}

const VALID = {
  hotelName: 'Hotel Prueba',
  email: 'Dueño@Ejemplo.com ',
  password: 'unaClave123',
  ownerName: 'Ana Pérez',
  address: 'Santo Domingo',
}

describe('SignupUseCase', () => {
  it('deja el hotel listo para trabajar: hotel + dueño + roles + prueba', async () => {
    const { uc, hotels, users, roles, subs } = setup()
    const res = await uc.signup(VALID, NOW)

    expect(hotels).toHaveLength(1)
    expect(users).toHaveLength(1)
    expect(roles.length).toBeGreaterThan(0)  // sin roles no puede dar de alta a su gente
    expect(subs).toHaveLength(1)
    expect(res.trialDays).toBe(TRIAL_DAYS)
  })

  it('el dueño queda como hotel_admin y puede iniciar sesión', async () => {
    const { uc, users } = setup()
    await uc.signup(VALID, NOW)
    expect(users[0]).toMatchObject({
      role: 'hotel_admin',
      userType: 'merchant',
      active: 1,
      name: 'Ana Pérez',
    })
    expect(users[0].password).toBe('hashed:unaClave123') // nunca en texto plano
  })

  it('normaliza el email: se registra con mayúsculas y entra en minúsculas', async () => {
    const { uc, users, hotels } = setup()
    await uc.signup(VALID, NOW)
    expect(users[0].email).toBe('dueño@ejemplo.com')
    expect(hotels[0].email).toBe('dueño@ejemplo.com')
  })

  it('guarda la dirección en `address` (no en `location`, que el ORM descarta)', async () => {
    const { uc, hotels } = setup()
    await uc.signup(VALID, NOW)
    expect(hotels[0].address).toBe('Santo Domingo')
    expect(hotels[0]).not.toHaveProperty('location')
  })

  // El producto es internacional: el alta elige país de un catálogo. Si el
  // usecase no lo copia a la fila, se pierde sin error (el ORM descarta los
  // campos que no llegan) y el hotel queda sin país aunque se haya elegido uno.
  it('persiste el país elegido en el alta', async () => {
    const { uc, hotels } = setup()
    await uc.signup({ ...VALID, country: 'España' }, NOW)
    expect(hotels[0].country).toBe('España')
  })

  it('sin país queda vacío, no undefined: la fila se crea igual', async () => {
    const { uc, hotels } = setup()
    await uc.signup(VALID, NOW)
    expect(hotels[0].country).toBe('')
  })

  it('la prueba vence a los 7 días exactos', async () => {
    const { uc, subs } = setup()
    const res = await uc.signup(VALID, NOW)
    expect(subs[0].status).toBe('trialing')
    expect(res.trialEndsAt).toBe('2026-07-26T12:00:00.000Z')
    expect(subs[0].trialEndsAt).toBe(res.trialEndsAt)
  })

  it('no deja registrar dos veces el mismo email', async () => {
    const { uc, hotels } = setup([{ id: 'u0', email: 'dueño@ejemplo.com' }])
    await expect(uc.signup(VALID, NOW)).rejects.toThrow('Ya existe una cuenta')
    expect(hotels).toHaveLength(0) // no queda un hotel huérfano
  })

  it('rechaza datos incompletos sin crear nada a medias', async () => {
    const { uc, hotels, users } = setup()
    await expect(uc.signup({ ...VALID, hotelName: '  ' }, NOW)).rejects.toThrow('nombre del hotel')
    await expect(uc.signup({ ...VALID, email: 'no-es-email' }, NOW)).rejects.toThrow('email')
    await expect(uc.signup({ ...VALID, password: '123' }, NOW)).rejects.toThrow('contraseña')
    expect(hotels).toHaveLength(0)
    expect(users).toHaveLength(0)
  })
})

describe('SignupUseCase — el alta no puede quedar a medias', () => {
  it('si falla la suscripción, no deja el hotel ni el usuario creados', async () => {
    const hotels: any[] = []
    const users: any[] = []
    const roles: any[] = []
    const repo = (store: any[], failOnCreate = false): any => ({
      create: async (row: any) => {
        if (failOnCreate) throw new Error('la base se cayó')
        store.push(row); return row
      },
      findMany: async (f: any = {}) => store.filter(r => Object.entries(f).every(([k, v]) => r[k] === v)),
      delete: async (id: string) => {
        const i = store.findIndex(r => r.id === id)
        if (i >= 0) store.splice(i, 1)
      },
    })

    const uc = new SignupUseCase({
      hotelsRepo: repo(hotels),
      usersRepo: repo(users),
      rolesRepo: repo(roles),
      subscriptionsRepo: repo([], true), // falla justo en el último paso
      hashPassword: async (p: string) => `hashed:${p}`,
      logger: silentLogger(),
    })

    await expect(uc.signup(VALID, NOW)).rejects.toThrow('la base se cayó')

    // Sin esto quedaría un hotel sin suscripción (entraría gratis para siempre)
    // y un email tomado que impide reintentar el registro.
    expect(hotels).toHaveLength(0)
    expect(users).toHaveLength(0)
    expect(roles).toHaveLength(0)
  })
})

// Issue #27 — el alta devolvía 201 y el correo nunca salía, sin dejar rastro: los dos envíos
// best-effort tenían `catch {}` con el cuerpo vacío. Best-effort sigue siendo best-effort (el
// alta NO se cae), pero el fallo tiene que quedar logueado con el hotelId para poder rastrearlo.
describe('SignupUseCase — un envío caído se loguea, no se silencia', () => {
  function repos() {
    const hotels: any[] = []; const users: any[] = []; const roles: any[] = []; const subs: any[] = []
    const repo = (store: any[]): RepositoryAdapter<any> => ({
      create: async (row: any) => { store.push(row); return row },
      findMany: async (f: any = {}) => store.filter(r => Object.entries(f).every(([k, v]) => r[k] === v)),
    } as unknown as RepositoryAdapter<any>)
    return { hotels, users, roles, subs, repo }
  }

  it('SMTP caído: el alta devuelve 201 igual y el fallo queda logueado con el hotelId', async () => {
    const { hotels, users, roles, subs, repo } = repos()
    const { logger, warns } = recordingLogger()
    const uc = new SignupUseCase({
      hotelsRepo: repo(hotels), usersRepo: repo(users), rolesRepo: repo(roles), subscriptionsRepo: repo(subs),
      hashPassword: async (p: string) => `hashed:${p}`,
      logger,
      appUrl: 'https://hotel.example.com',
      emailSender: { enqueue: async () => { throw new Error('SMTP timeout') } },
    })

    const res = await uc.signup(VALID, NOW)

    expect(hotels).toHaveLength(1)          // el hotel NO se pierde por un SMTP caído
    expect(warns).toHaveLength(1)
    expect(warns[0]!.msg).toContain('verificación')
    expect(warns[0]!.meta).toMatchObject({ hotelId: res.hotelId, error: 'SMTP timeout' })
  })

  it('bienvenida caída: se loguea aparte y tampoco tumba el alta', async () => {
    const { hotels, users, roles, subs, repo } = repos()
    const { logger, warns } = recordingLogger()
    const uc = new SignupUseCase({
      hotelsRepo: repo(hotels), usersRepo: repo(users), rolesRepo: repo(roles), subscriptionsRepo: repo(subs),
      hashPassword: async (p: string) => `hashed:${p}`,
      logger,
      appUrl: 'https://hotel.example.com',
      emailSender: { enqueue: async () => 'queued-1' },
      platformEmailSender: async () => { throw new Error('plantilla welcome rota') },
    })

    const res = await uc.signup(VALID, NOW)

    expect(hotels).toHaveLength(1)
    expect(warns).toHaveLength(1)
    expect(warns[0]!.msg).toContain('bienvenida')
    expect(warns[0]!.meta).toMatchObject({ hotelId: res.hotelId, error: 'plantilla welcome rota' })
  })

  it('con los dos envíos OK no ensucia el log', async () => {
    const { hotels, users, roles, subs, repo } = repos()
    const { logger, warns } = recordingLogger()
    const uc = new SignupUseCase({
      hotelsRepo: repo(hotels), usersRepo: repo(users), rolesRepo: repo(roles), subscriptionsRepo: repo(subs),
      hashPassword: async (p: string) => `hashed:${p}`,
      logger,
      appUrl: 'https://hotel.example.com',
      emailSender: { enqueue: async () => 'queued-1' },
      platformEmailSender: async () => ({ sent: true }),
    })

    await uc.signup(VALID, NOW)
    expect(warns).toHaveLength(0)
  })
})
