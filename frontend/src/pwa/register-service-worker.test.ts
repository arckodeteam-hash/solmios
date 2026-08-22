// Regresión de T-registro-ref: el visitante que entra por PRIMERA vez no debe comerse una
// recarga. `sw.js` hace `clients.claim()`, así que `navigator.serviceWorker.controller` queda
// puesto durante la primera activación: usarlo como señal de "había una versión anterior" es un
// falso positivo y recargaba la primera carga de todo visitante nuevo (la audiencia de un link
// de referido `/registro?ref=`). La recarga aborta los chunks de la ruta en vuelo.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerServiceWorker } from './register-service-worker'

/** Doble del SW: permite disparar `statechange` cuando el test quiera. */
function makeFakeSW() {
  const listeners: Array<() => void> = []
  return {
    state: 'installing' as string,
    addEventListener: (_e: string, cb: () => void) => { listeners.push(cb) },
    /** Simula el `activate` del SW (que incluye `clients.claim()`). */
    activate(setsController: boolean) {
      this.state = 'activated'
      if (setsController) setController({})
      listeners.forEach((cb) => cb())
    },
  }
}

function makeFakeRegistration(sw: ReturnType<typeof makeFakeSW>) {
  const listeners: Array<() => void> = []
  return {
    installing: sw,
    addEventListener: (_e: string, cb: () => void) => { listeners.push(cb) },
    fireUpdateFound: () => listeners.forEach((cb) => cb()),
  }
}

let controller: unknown = null
function setController(c: unknown) { controller = c }

const registerMock = vi.fn()

beforeEach(() => {
  controller = null
  registerMock.mockReset()
  sessionStorage.clear()
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    get: () => ({ get controller() { return controller }, register: registerMock }),
  })
})

/** `location.reload` no es espiable directo en happy-dom: se reemplaza el objeto location. */
function stubReload() {
  const reload = vi.fn()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload },
  })
  return reload
}

describe('registerServiceWorker', () => {
  it('NO recarga en la primera instalación, aunque clients.claim() ponga el controller', async () => {
    const reload = stubReload()
    const sw = makeFakeSW()
    const reg = makeFakeRegistration(sw)
    registerMock.mockResolvedValue(reg)

    // Primera visita: no hay controller al momento de registrar.
    expect(navigator.serviceWorker.controller).toBeNull()
    await registerServiceWorker()

    reg.fireUpdateFound()
    sw.activate(true) // el activate del SW hace clients.claim() → aparece controller

    expect(reload).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('sw:reloaded')).toBeNull()
  })

  it('recarga UNA vez cuando ya había un SW controlando (deploy nuevo)', async () => {
    const reload = stubReload()
    setController({}) // visita previa: ya hay un SW controlando antes de registrar
    const sw = makeFakeSW()
    const reg = makeFakeRegistration(sw)
    registerMock.mockResolvedValue(reg)

    await registerServiceWorker()
    reg.fireUpdateFound()
    sw.activate(true)

    expect(reload).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('sw:reloaded')).toBe('1')
  })

  it('no vuelve a recargar si ya recargó en esta pestaña', async () => {
    const reload = stubReload()
    setController({})
    sessionStorage.setItem('sw:reloaded', '1')
    const sw = makeFakeSW()
    const reg = makeFakeRegistration(sw)
    registerMock.mockResolvedValue(reg)

    await registerServiceWorker()
    reg.fireUpdateFound()
    sw.activate(true)

    expect(reload).not.toHaveBeenCalled()
  })

  it('un fallo al registrar no rompe la app', async () => {
    stubReload()
    registerMock.mockRejectedValue(new Error('sin https'))
    await expect(registerServiceWorker()).resolves.toBeUndefined()
  })
})
