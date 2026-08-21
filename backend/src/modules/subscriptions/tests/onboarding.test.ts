// La guía se calcula con los DATOS REALES del hotel: un checklist que se marca
// porque alguien apretó "listo" miente en cuanto se borra lo que había cargado.
import { describe, it, expect } from 'bun:test'
import { OnboardingUseCase } from '../usecases/onboarding'
import type { RepositoryAdapter } from 'arckode-framework'

function setup(opts: { rooms?: number; users?: number; rates?: number; hotel?: any; channels?: any[] } = {}) {
  const list = (n = 0) => Array.from({ length: n }, (_, i) => ({ id: `x${i}` }))
  const repo = (rows: any[]): RepositoryAdapter<any> => ({
    findMany: async () => rows,
    findById: async () => opts.hotel ?? null,
  } as unknown as RepositoryAdapter<any>)

  return new OnboardingUseCase({
    roomsRepo: repo(list(opts.rooms)),
    usersRepo: repo(list(opts.users ?? 1)), // el dueño siempre existe
    ratesRepo: repo(list(opts.rates)),
    hotelsRepo: repo([]),
    channelsRepo: repo(opts.channels ?? []),
  })
}

describe('OnboardingUseCase', () => {
  it('hotel recién creado: nada hecho y la guía se muestra', async () => {
    const st = await setup().status('h1')
    expect(st.completed).toBe(false)
    expect(st.doneCount).toBe(0)
    expect(st.steps[0]!.key).toBe('hotel') // #35: los datos del hotel van primeros
    expect(st.steps[0]!.required).toBe(true)
  })

  it('#35: datos del hotel primeros, habitaciones segundo', async () => {
    // El dueño lo pidió así: el paso 1 es "Completá los datos del hotel" y el 2
    // "Cargá tus habitaciones". El orden es del array; la completitud de cada
    // paso se detecta por condición propia, no por posición.
    const st = await setup().status('h1')
    expect(st.steps.map(s => s.key)).toEqual(['hotel', 'rooms', 'rates', 'channels', 'team'])
    expect(st.totalCount).toBe(5)

    // La completitud no depende del orden: hotel con datos y sin habitaciones.
    const conDatos = await setup({ hotel: { phone: '809' } }).status('h1')
    expect(conDatos.steps[0]!.done).toBe(true)  // hotel: teléfono alcanzó
    expect(conDatos.steps[1]!.done).toBe(false) // rooms: sin cargar
    expect(conDatos.doneCount).toBe(1)
  })

  it('cuenta lo que ya cargó', async () => {
    const st = await setup({ rooms: 12 }).status('h1')
    const rooms = st.steps.find(s => s.key === 'rooms')!
    expect(rooms.done).toBe(true)
    expect(rooms.count).toBe(12)
  })

  it('la guía se esconde cuando lo obligatorio está hecho', async () => {
    const st = await setup({ rooms: 5, hotel: { phone: '809', address: 'SD' } }).status('h1')
    expect(st.completed).toBe(true) // aunque falten tarifas y equipo, que son opcionales
  })

  it('el dueño solo no cuenta como equipo armado', async () => {
    const soloDueño = await setup({ users: 1 }).status('h1')
    expect(soloDueño.steps.find(s => s.key === 'team')!.done).toBe(false)
    const conEquipo = await setup({ users: 3 }).status('h1')
    const team = conEquipo.steps.find(s => s.key === 'team')!
    expect(team.done).toBe(true)
    expect(team.count).toBe(2) // sin contar al dueño
  })

  it('los datos del hotel se dan por hechos con teléfono o dirección', async () => {
    const st = await setup({ hotel: { address: 'Santo Domingo' } }).status('h1')
    expect(st.steps.find(s => s.key === 'hotel')!.done).toBe(true)
  })
})

describe('OnboardingUseCase — conectar canales', () => {
  it('incluye el paso de canales: es el valor central del producto', async () => {
    const st = await setup().status('h1')
    const ch = st.steps.find(s => s.key === 'channels')
    expect(ch).toBeDefined()
    expect(ch!.done).toBe(false)
  })

  it('se marca hecho solo con una propiedad asignada, no con la fila vacía', async () => {
    // La fila de channel_config se crea al entrar a la vista de Canales, sin
    // haber conectado nada: contarla como "conectado" haría desaparecer el paso
    // justo cuando todavía falta hacerlo.
    const vacio = await setup({ channels: [{ id: 'c1', hotelId: 'h1', channexPropertyId: '' }] }).status('h1')
    expect(vacio.steps.find(s => s.key === 'channels')!.done).toBe(false)

    const conectado = await setup({ channels: [{ id: 'c1', hotelId: 'h1', channexPropertyId: 'prop-123' }] }).status('h1')
    expect(conectado.steps.find(s => s.key === 'channels')!.done).toBe(true)
  })

  it('no bloquea el alta: conectar canales es opcional', async () => {
    const st = await setup({ rooms: 3, hotel: { phone: '809', address: 'SD' } }).status('h1')
    expect(st.steps.find(s => s.key === 'channels')!.required).toBe(false)
    expect(st.completed).toBe(true)
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
      '/panel/config/habitaciones', '/panel/config', '/panel/config/tarifas', '/panel/channel-manager', '/panel/rrhh/team',
    ]
    const st = await setup().status('h1')
    for (const step of st.steps) {
      const base = step.route.split('?')[0]!
      expect(EXISTENTES).toContain(base)
    }
  })

  it('no nombra al proveedor del channel manager: es white-label', async () => {
    // En el panel del hotel todo es "Canales/OTAs"; el proveedor solo se ve en
    // el panel de administración de la plataforma.
    const st = await setup().status('h1')
    const texto = JSON.stringify(st.steps).toLowerCase()
    expect(texto).not.toContain('channex')
  })
})
