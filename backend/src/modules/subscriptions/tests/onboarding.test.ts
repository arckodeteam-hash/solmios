// La guía se calcula con los DATOS REALES del hotel: un checklist que se marca
// porque alguien apretó "listo" miente en cuanto se borra lo que había cargado.
//
// F2 (wizard-refactor, docs/wizard-refactor/tareas/tareas.md 2.1-2.9): el paso
// único `hotel` (mal calibrado, `Boolean(phone || address)` nacía "hecho" con
// datos que ya traía el registro) se reemplazó por pasos de perfil granulares
// (`kind: 'profile'`) que van primero en `steps[]`; el operativo de siempre
// (`kind: 'external'`) queda sin cambios de lógica, después. (`team`,
// `amenities`, `rates` y `channels` se sacaron después, 2026-09-08 — ver
// onboarding.ts: todos eran opcionales, ninguno bloqueaba `completed` ni el %.)
import { describe, it, expect } from 'bun:test'
import { OnboardingUseCase } from '../usecases/onboarding'
import type { RepositoryAdapter } from 'arckode-framework'

/** Hotel tal como lo deja el alta (`signup.ts`): name/country/phone/address ya vienen cargados,
 *  `email` queda vacío (el registro solo persiste el login en `users.email`, doc 02), y
 *  accommodationType/currency/taxName/taxRate/latitude/longitude están en su DEFAULT de columna
 *  (`hoteles/model.ts`) — ninguno es un valor que el usuario haya confirmado a mano todavía. */
const SIGNUP_HOTEL = {
  name: 'Hotel Test', country: 'República Dominicana', phone: '8095550000', address: 'Calle Test 123',
  email: '',
  accommodationType: 'hotel', currency: 'USD',
  latitude: 0, longitude: 0,
  taxName: 'ITBIS', taxRate: 18.0,
}

/** Hotel con TODOS los pasos de perfil REQUERIDOS satisfechos (bienvenida/identidad/ubicacion/
 *  politicas) — deja contacto (opcional) y rooms como único pendiente, para probar que
 *  `completed` no necesita lo opcional. */
const FULL_REQUIRED_HOTEL = {
  ...SIGNUP_HOTEL,
  email: 'hotel@test.com',
  latitude: 18.4861, longitude: -69.9312,
}

function setup(opts: {
  rooms?: number; users?: number; hotel?: any
  ownerName?: string
} = {}) {
  const list = (n = 0) => Array.from({ length: n }, (_, i) => ({ id: `x${i}` }))
  const repo = (rows: any[]): RepositoryAdapter<any> => ({
    findMany: async () => rows,
    findById: async () => opts.hotel ?? null,
    findOne: async () => null,
  } as unknown as RepositoryAdapter<any>)

  // El dueño siempre existe (se crea solo en el alta) — mismo criterio que `signup.ts`
  // (`role: 'hotel_admin'`, `name` = el nombre que tipeó al registrarse).
  const ownerName = opts.ownerName ?? 'Dueño Test'
  const users = [
    { id: 'owner', role: 'hotel_admin', name: ownerName },
    ...list(Math.max(0, (opts.users ?? 1) - 1)),
  ]

  return new OnboardingUseCase({
    roomsRepo: repo(list(opts.rooms)),
    usersRepo: repo(users),
    hotelsRepo: repo([]),
  })
}

describe('OnboardingUseCase — orden y shape general', () => {
  it('hotel recién creado (sin datos): nada hecho y la guía se muestra', async () => {
    const st = await setup().status('h1')
    expect(st.completed).toBe(false)
    expect(st.doneCount).toBe(0)
    expect(st.steps[0]!.key).toBe('bienvenida') // perfil primero (F2, tarea 2.8)
    expect(st.steps[0]!.required).toBe(true)
  })

  it('tarea 2.8 — perfil primero (bienvenida→identidad→contacto→ubicacion→politicas), operativo después', async () => {
    const st = await setup().status('h1')
    expect(st.steps.map(s => s.key)).toEqual([
      'bienvenida', 'identidad', 'contacto', 'ubicacion', 'politicas', 'rooms',
    ])
    expect(st.totalCount).toBe(6)
  })

  it('tarea 2.1 — cada paso trae `kind`: perfil para los 5 nuevos, external para el operativo', async () => {
    const st = await setup().status('h1')
    const profileKeys = ['bienvenida', 'identidad', 'contacto', 'ubicacion', 'politicas']
    for (const key of profileKeys) expect(st.steps.find(s => s.key === key)!.kind).toBe('profile')
    expect(st.steps.find(s => s.key === 'rooms')!.kind).toBe('external')
  })

  it('cuenta lo que ya cargó', async () => {
    const st = await setup({ rooms: 12 }).status('h1')
    const rooms = st.steps.find(s => s.key === 'rooms')!
    expect(rooms.done).toBe(true)
    expect(rooms.count).toBe(12)
  })
})

describe('OnboardingUseCase — tarea 2.2, paso `bienvenida`', () => {
  it('hotel de signup (email vacío) → done false', async () => {
    const st = await setup({ hotel: SIGNUP_HOTEL }).status('h1')
    expect(st.steps.find(s => s.key === 'bienvenida')!.done).toBe(false)
  })

  it('completando el email → done true', async () => {
    const st = await setup({ hotel: { ...SIGNUP_HOTEL, email: 'hotel@test.com' } }).status('h1')
    expect(st.steps.find(s => s.key === 'bienvenida')!.done).toBe(true)
  })

  it('sin nombre de dueño resuelto (`users.name` vacío) → done false aunque el resto esté', async () => {
    const st = await setup({ hotel: { ...SIGNUP_HOTEL, email: 'hotel@test.com' }, ownerName: '' }).status('h1')
    expect(st.steps.find(s => s.key === 'bienvenida')!.done).toBe(false)
  })
})

describe('OnboardingUseCase — tarea 2.3, paso `identidad`', () => {
  it('decisión: accommodationType/currency en su default de columna YA cuentan como hecho (ver comentario en onboarding.ts)', async () => {
    const st = await setup({ hotel: SIGNUP_HOTEL }).status('h1')
    expect(st.steps.find(s => s.key === 'identidad')!.done).toBe(true)
  })

  it('sin ninguno de los dos campos → done false', async () => {
    const st = await setup({ hotel: { ...SIGNUP_HOTEL, accommodationType: '', currency: '' } }).status('h1')
    expect(st.steps.find(s => s.key === 'identidad')!.done).toBe(false)
  })

  it('hotel de signup (default hotel/USD sin tocar) → usingDefaults true', async () => {
    const st = await setup({ hotel: SIGNUP_HOTEL }).status('h1')
    expect(st.steps.find(s => s.key === 'identidad')!.usingDefaults).toBe(true)
  })

  it('con un tipo/moneda distintos al default → usingDefaults false', async () => {
    const st = await setup({ hotel: { ...SIGNUP_HOTEL, accommodationType: 'villa', currency: 'EUR' } }).status('h1')
    expect(st.steps.find(s => s.key === 'identidad')!.usingDefaults).toBe(false)
  })
})

describe('OnboardingUseCase — tarea 2.4, paso `contacto`', () => {
  it('sin phone2/website/ownerTaxId → done false, pero NUNCA bloquea completed', async () => {
    const st = await setup({ hotel: FULL_REQUIRED_HOTEL, rooms: 1 }).status('h1')
    const contacto = st.steps.find(s => s.key === 'contacto')!
    expect(contacto.done).toBe(false)
    expect(contacto.required).toBe(false)
    expect(st.completed).toBe(true) // el resto de lo requerido está OK
  })

  it('con al menos uno de los 3 campos → done true', async () => {
    const st = await setup({ hotel: { ...FULL_REQUIRED_HOTEL, website: 'https://hotel.test' } }).status('h1')
    expect(st.steps.find(s => s.key === 'contacto')!.done).toBe(true)
  })
})

describe('OnboardingUseCase — tarea 2.5, paso `ubicacion`', () => {
  it('hotel de signup (lat/lng en el default 0) → done false', async () => {
    const st = await setup({ hotel: SIGNUP_HOTEL }).status('h1')
    expect(st.steps.find(s => s.key === 'ubicacion')!.done).toBe(false)
  })

  it('con coordenadas reales → done true', async () => {
    const st = await setup({ hotel: { ...SIGNUP_HOTEL, latitude: 18.4861, longitude: -69.9312 } }).status('h1')
    expect(st.steps.find(s => s.key === 'ubicacion')!.done).toBe(true)
  })
})

describe('OnboardingUseCase — tarea 2.6, paso `politicas`', () => {
  it('decisión: taxName/taxRate en su default (sesgado a RD, riesgo R1) YA cuentan como hecho (ver comentario en onboarding.ts)', async () => {
    const st = await setup({ hotel: SIGNUP_HOTEL }).status('h1')
    expect(st.steps.find(s => s.key === 'politicas')!.done).toBe(true)
  })

  it('sin taxName ni taxRate → done false', async () => {
    const st = await setup({ hotel: { ...SIGNUP_HOTEL, taxName: '', taxRate: 0 } }).status('h1')
    expect(st.steps.find(s => s.key === 'politicas')!.done).toBe(false)
  })

  it('hotel de signup (default ITBIS/18 sin tocar) → usingDefaults true', async () => {
    const st = await setup({ hotel: SIGNUP_HOTEL }).status('h1')
    expect(st.steps.find(s => s.key === 'politicas')!.usingDefaults).toBe(true)
  })

  it('con un impuesto distinto al default → usingDefaults false', async () => {
    const st = await setup({ hotel: { ...SIGNUP_HOTEL, taxName: 'IVA', taxRate: 16 } }).status('h1')
    expect(st.steps.find(s => s.key === 'politicas')!.usingDefaults).toBe(false)
  })
})

describe('OnboardingUseCase — tarea 2.9, combinaciones', () => {
  it('perfil 0% (hotel de signup, sin tocar nada más): bienvenida y ubicación bloquean completed', async () => {
    const st = await setup({ hotel: SIGNUP_HOTEL }).status('h1')
    expect(st.steps.find(s => s.key === 'bienvenida')!.done).toBe(false)
    expect(st.steps.find(s => s.key === 'ubicacion')!.done).toBe(false)
    // identidad y politicas SÍ cuentan como hechas por su default (tareas 2.3/2.6).
    expect(st.steps.find(s => s.key === 'identidad')!.done).toBe(true)
    expect(st.steps.find(s => s.key === 'politicas')!.done).toBe(true)
    expect(st.completed).toBe(false)
  })

  it('perfil 100% requerido con contacto pendiente (opcional) → completed true igual', async () => {
    const st = await setup({ hotel: FULL_REQUIRED_HOTEL }).status('h1')
    for (const key of ['bienvenida', 'identidad', 'ubicacion', 'politicas']) {
      expect(st.steps.find(s => s.key === key)!.done).toBe(true)
    }
    expect(st.steps.find(s => s.key === 'contacto')!.done).toBe(false)
    // rooms es operativo Y requerido: sin cargar, sigue bloqueando.
    expect(st.completed).toBe(false)
  })

  it('perfil + operativo 100%: los 6 pasos hechos', async () => {
    const st = await setup({
      hotel: { ...FULL_REQUIRED_HOTEL, phone2: '8095550001' },
      rooms: 3,
    }).status('h1')
    expect(st.doneCount).toBe(6)
    expect(st.totalCount).toBe(6)
    expect(st.completed).toBe(true)
    expect(st.steps.every(s => s.done)).toBe(true)
  })
})

describe('OnboardingUseCase — la guía tiene que explicar', () => {
  it('cada paso dice cómo se hace y qué se pierde si falta', async () => {
    // El bug original: la guía mostraba una línea y un botón "Empezar" que
    // dejaba al usuario en una pantalla vacía sin saber qué apretar.
    const st = await setup().status('h1')
    for (const step of st.steps) {
      expect(step.how.length).toBeGreaterThan(40)
      expect(step.impact.length).toBeGreaterThan(20)
      expect(step.cta).toBeTruthy()
      expect(step.cta).not.toBe('Empezar')  // el botón nombra la acción
    }
  })

  it('todos los pasos apuntan a rutas del panel que existen', async () => {
    // "Definí tus tarifas" mandaba a /panel/pricing, que no existe: el botón
    // sacaba al usuario del panel.
    const EXISTENTES = [
      '/panel/configuracion-inicial', '/panel/config/habitaciones',
    ]
    const st = await setup().status('h1')
    for (const step of st.steps) {
      const base = step.route.split('?')[0]!
      expect(EXISTENTES).toContain(base)
    }
  })
})
