// settings-geocoding.test.ts — GH-33: al mover el pin del mapa interactivo solo se actualizaban
// Latitud y Longitud; Provincia, Municipio, Localidad y Código Postal quedaban vacíos, sin ningún
// aviso, aunque la pantalla promete "Se completan solos al mover el pin".
//
// La reproducción simula el SDK de Google Maps (no hay red en tests) y dispara el `dragend` del
// marcador, que es exactamente lo que hace el usuario al arrastrar el pin.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'

// ── Doble del SDK de Google Maps ────────────────────────────────────────────────────────────
type Listener = (...args: unknown[]) => void

/** Componente de dirección tal como lo devuelve la Geocoding API. */
type Comp = { long_name: string; short_name: string; types: string[] }
const comp = (long_name: string, ...types: string[]): Comp => ({ long_name, short_name: long_name, types })

let geocodeImpl: (req: unknown) => Promise<{ results: Array<{ address_components: Comp[] }> }>
let geocoderCtorThrows = false
const markerListeners = new Map<string, Listener>()
/** El stub del Marker publica acá su setter de posición para que el test pueda moverlo. */
let markerPosSetter: ((lat: number, lng: number) => void) | null = null

function makeMapsStub() {
  return {
    Map: class {
      addListener(ev: string, cb: Listener) { void ev; void cb }
      setCenter() {}
    },
    Marker: class {
      private pos: { lat: number; lng: number }
      constructor(opts: { position: { lat: number; lng: number } }) {
        this.pos = opts.position
        markerPosSetter = (lat, lng) => { this.pos = { lat, lng } }
      }
      addListener(ev: string, cb: Listener) { markerListeners.set(ev, cb) }
      getPosition() { return { lat: () => this.pos.lat, lng: () => this.pos.lng } }
      setPosition(p: { lat: number; lng: number }) { this.pos = p }
    },
    Geocoder: class {
      constructor() { if (geocoderCtorThrows) throw new TypeError('maps.Geocoder is not a constructor') }
      geocode(req: unknown) { return geocodeImpl(req) }
    },
  } as unknown as typeof google.maps
}

let loadGoogleMapsImpl: () => Promise<typeof google.maps | null>
vi.mock('@/composables/useGoogleMaps', () => ({
  loadGoogleMaps: () => loadGoogleMapsImpl(),
  resetGoogleMapsLoader: () => {},
}))

// ── Mock de Nominatim fallback ────────────────────────────────────────────────────────────────
// El mock reemplaza `reverseGeocodeNominatim` (que internamente mapea a MappedAddress),
// así que nominatimImpl tiene que devolver el formato YA MAPEADO: { province, municipality, locality, postalCode }.
type MappedAddr = { province: string; municipality: string; locality: string; postalCode: string }
let nominatimImpl: (lat: number, lng: number) => Promise<MappedAddr>
vi.mock('@/utils/address-components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/address-components')>()
  return {
    ...actual,
    reverseGeocodeNominatim: (lat: number, lng: number) => nominatimImpl(lat, lng),
  }
})

const toastCalls: Array<{ kind: string; msg: string }> = []
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    success: (m: string) => { toastCalls.push({ kind: 'success', msg: m }) },
    error: (m: string) => { toastCalls.push({ kind: 'error', msg: m }) },
    info: (m: string) => { toastCalls.push({ kind: 'info', msg: m }) },
    warning: (m: string) => { toastCalls.push({ kind: 'warning', msg: m }) },
  }),
}))

// ── Resto de dependencias de la pantalla (idéntico criterio a settings-plan-pin.test.ts) ────
vi.mock('@/services/Signup.service', () => ({
  SignupService: {
    publicPlans: async () => [],
    mySubscription: async () => ({
      status: 'active', trialEndsAt: null, currentPeriodEnd: null, planId: 'plan-x',
      allowed: true, reason: null, daysLeft: null, hasStripeCustomer: true,
    }),
  },
}))
vi.mock('@/services/Settings.service', () => ({
  SettingsService: {
    get: async () => ({ hotel: { id: 'h1', name: 'Hotel Test', country: 'República Dominicana' } }),
    patchHotel: async () => ({}),
  },
}))
vi.mock('@/services/Hotel.service', () => ({
  HotelService: {
    amenitiesCatalog: async () => ({}),
    amenitiesHotel: async () => ({ data: [] }),
    saveAmenitiesHotel: async () => ({}),
  },
}))
vi.mock('@/services/Platform.service', () => ({
  ConfigService: { get: async () => null, set: async () => ({}) },
  EmergencyContactsService: { get: async () => null, invalidate: () => {} },
}))
vi.mock('@/services/Guarantee.service', () => ({
  GuaranteeService: { hasPin: async () => ({ hasPin: false }), setPin: async () => ({}) },
}))
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ push: () => {} }),
  onBeforeRouteLeave: () => {},
}))
vi.mock('@/stores/auth.store', () => ({ useAuthStore: () => ({ user: { hotelId: 'h1', name: 'Tester' } }) }))

import Settings from './index.vue'

const MOUNT_OPTS = { global: { stubs: { RouterLink: true, PhoneInput: true } } }

/** Componentes que Google devuelve para un punto en Santo Domingo, República Dominicana. */
const DR_COMPONENTS: Comp[] = [
  comp('Santo Domingo', 'locality', 'political'),
  comp('Distrito Nacional', 'administrative_area_level_1', 'political'),
  comp('10101', 'postal_code'),
  comp('República Dominicana', 'country', 'political'),
]

beforeEach(() => {
  toastCalls.length = 0
  markerListeners.clear()
  geocoderCtorThrows = false
  loadGoogleMapsImpl = async () => makeMapsStub()
  geocodeImpl = async () => ({ results: [{ address_components: DR_COMPONENTS }] })
  nominatimImpl = async () => ({
    province: 'Distrito Nacional',
    municipality: 'Santo Domingo',
    locality: 'Zona Colonial',
    postalCode: '10201',
  })
})

/** Monta la pantalla, entra a la pestaña Ubicación y espera a que el mapa se inicialice. */
async function mountOnLocationTab(): Promise<VueWrapper> {
  const wrapper = mount(Settings, MOUNT_OPTS)
  await flushPromises()
  const tab = wrapper.findAll('button').find((b) => b.text().trim() === 'Ubicación')
  expect(tab, 'la pestaña Ubicación tiene que existir').toBeTruthy()
  await tab!.trigger('click')
  await flushPromises()
  return wrapper
}

/** Arrastra el pin al punto dado, disparando el mismo `dragend` que emite el SDK real. */
async function dragPinTo(lat: number, lng: number) {
  const dragend = markerListeners.get('dragend')
  expect(dragend, 'el marcador tiene que registrar un listener de dragend').toBeTruthy()
  // El SDK mueve el marcador ANTES de emitir dragend; el handler lee getPosition().
  markerPosSetter?.(lat, lng)
  dragend!()
  await flushPromises()
}

const valueOf = (w: VueWrapper, field: string) =>
  (w.find(`[data-field="${field}"]`).element as HTMLInputElement).value

describe('GH-33 — autocompletado de dirección al mover el pin', () => {
  it('completa Provincia, Municipio, Localidad y Código Postal', async () => {
    const wrapper = await mountOnLocationTab()
    await dragPinTo(18.4861, -69.9312)

    expect(valueOf(wrapper, 'latitude')).toBe('18.4861')
    expect(valueOf(wrapper, 'longitude')).toBe('-69.9312')
    expect(valueOf(wrapper, 'province')).toBe('Distrito Nacional')
    expect(valueOf(wrapper, 'locality')).toBe('Santo Domingo')
    expect(valueOf(wrapper, 'postalCode')).toBe('10101')
    // En RD Google casi nunca devuelve administrative_area_level_2: el municipio se resuelve
    // desde locality, no puede quedar vacío.
    expect(valueOf(wrapper, 'municipality')).toBe('Santo Domingo')
  })

  // Fix GH-33 (2a ronda): el escenario reportado en producción es un mapa interactivo que
  // funciona (Maps JavaScript API habilitada) con una key que NO tiene la Geocoding API —
  // un producto SEPARADO de Google Cloud. El drag llega, Google rechaza, y los cuatro campos
  // quedaban vacíos. Ahora cualquier falla de Google cae a Nominatim antes de rendirse.
  it('REQUEST_DENIED de Google cae a Nominatim y completa los campos igual', async () => {
    geocodeImpl = async () => { throw new Error('REQUEST_DENIED') }
    const wrapper = await mountOnLocationTab()
    await dragPinTo(18.4861, -69.9312)

    expect(valueOf(wrapper, 'latitude')).toBe('18.4861')
    expect(valueOf(wrapper, 'province')).toBe('Distrito Nacional')
    expect(valueOf(wrapper, 'municipality')).toBe('Santo Domingo')
    expect(valueOf(wrapper, 'locality')).toBe('Zona Colonial')
    expect(valueOf(wrapper, 'postalCode')).toBe('10201')
  })

  it('Google y Nominatim caídos: aviso visible, sin throw, campos editables', async () => {
    geocodeImpl = async () => { throw new Error('REQUEST_DENIED') }
    nominatimImpl = async () => { throw new TypeError('Failed to fetch') }
    const wrapper = await mountOnLocationTab()
    await dragPinTo(18.4861, -69.9312)

    expect(valueOf(wrapper, 'latitude')).toBe('18.4861')
    expect(valueOf(wrapper, 'province')).toBe('')
    const avisos = toastCalls.filter((t) => t.kind === 'error' || t.kind === 'warning')
    expect(avisos.length, 'el usuario tiene que enterarse de que el autocompletado falló').toBeGreaterThan(0)
  })

  it('avisa cuando el SDK no expone Geocoder y el fallback también falla', async () => {
    geocoderCtorThrows = true
    nominatimImpl = async () => { throw new TypeError('Failed to fetch') }
    const wrapper = await mountOnLocationTab()
    await dragPinTo(18.4861, -69.9312)

    expect(valueOf(wrapper, 'latitude')).toBe('18.4861')
    const avisos = toastCalls.filter((t) => t.kind === 'error' || t.kind === 'warning')
    expect(avisos.length, 'un Geocoder ausente no puede fallar en silencio').toBeGreaterThan(0)
  })
})

describe('GH-33 — caminos de fallo del autocompletado', () => {
  it('no pisa lo que el usuario escribió a mano', async () => {
    const wrapper = await mountOnLocationTab()
    const municipio = wrapper.find('[data-field="municipality"]')
    await municipio.setValue('Boca Chica')       // corrección manual del usuario

    await dragPinTo(18.4861, -69.9312)

    expect(valueOf(wrapper, 'municipality')).toBe('Boca Chica')
    // El resto sí se completa: solo se respeta el campo tocado.
    expect(valueOf(wrapper, 'province')).toBe('Distrito Nacional')
  })

  it('sí re-escribe un valor que había puesto el propio autocompletado', async () => {
    const wrapper = await mountOnLocationTab()
    await dragPinTo(18.4861, -69.9312)
    expect(valueOf(wrapper, 'province')).toBe('Distrito Nacional')

    geocodeImpl = async () => ({
      results: [{ address_components: [
        comp('Higüey', 'locality', 'political'),
        comp('La Altagracia', 'administrative_area_level_1', 'political'),
        comp('Higüey', 'administrative_area_level_2', 'political'),
      ] }],
    })
    await dragPinTo(18.6, -68.7)

    expect(valueOf(wrapper, 'province')).toBe('La Altagracia')
    expect(valueOf(wrapper, 'municipality')).toBe('Higüey')
  })

  it('avisa cuando Google responde sin ningún componente aprovechable', async () => {
    geocodeImpl = async () => ({ results: [{ address_components: [comp('República Dominicana', 'country')] }] })
    // Con el fallback, un Google vacío prueba Nominatim: para ver el aviso de "sin datos"
    // los DOS proveedores tienen que venir vacíos.
    nominatimImpl = async () => ({ province: '', municipality: '', locality: '', postalCode: '' })
    const wrapper = await mountOnLocationTab()
    await dragPinTo(19.0, -70.0)

    expect(valueOf(wrapper, 'province')).toBe('')
    expect(toastCalls.some((t) => t.kind === 'warning')).toBe(true)
  })

  it('avisa cuando faltan solo algunos campos (RD casi nunca trae código postal)', async () => {
    geocodeImpl = async () => ({
      results: [{ address_components: [
        comp('Bávaro', 'locality', 'political'),
        comp('La Altagracia', 'administrative_area_level_1', 'political'),
      ] }],
    })
    const wrapper = await mountOnLocationTab()
    await dragPinTo(18.68, -68.42)

    expect(valueOf(wrapper, 'locality')).toBe('Bávaro')
    expect(valueOf(wrapper, 'municipality')).toBe('Bávaro')   // fallback: sin admin_area_2
    expect(valueOf(wrapper, 'postalCode')).toBe('')
    const aviso = toastCalls.find((t) => t.kind === 'warning')
    expect(aviso?.msg).toContain('parcialmente')
  })

  it('sin red: el error de la promesa no queda mudo', async () => {
    geocodeImpl = async () => { throw new TypeError('Failed to fetch') }
    nominatimImpl = async () => { throw new TypeError('Failed to fetch') }   // sin red no hay fallback
    const wrapper = await mountOnLocationTab()
    await dragPinTo(18.4861, -69.9312)

    expect(valueOf(wrapper, 'latitude')).toBe('18.4861')
    expect(toastCalls.some((t) => t.kind === 'error')).toBe(true)
  })

  it('descarta una respuesta que llega tarde y no pisa la del último pin', async () => {
    let release: (() => void) | null = null
    const slowFirst = new Promise<void>((r) => { release = r })
    let call = 0
    geocodeImpl = async () => {
      call++
      if (call === 1) {
        await slowFirst
        return { results: [{ address_components: [comp('Provincia Vieja', 'administrative_area_level_1')] }] }
      }
      return { results: [{ address_components: [comp('Provincia Nueva', 'administrative_area_level_1')] }] }
    }
    const wrapper = await mountOnLocationTab()

    const dragend = markerListeners.get('dragend')!
    markerPosSetter?.(18.4, -69.9); dragend()          // primer arrastre: queda colgado
    markerPosSetter?.(19.4, -70.9); dragend()          // segundo arrastre: responde ya
    await flushPromises()
    release!()                                          // ahora contesta el primero, tarde
    await flushPromises()

    expect(valueOf(wrapper, 'province')).toBe('Provincia Nueva')
  })
})

// ── MAPGEO — Nominatim fallback ──────────────────────────────────────────────────────────────

describe('MAPGEO — Nominatim fallback cuando no hay Google Maps key', () => {
  beforeEach(() => {
    loadGoogleMapsImpl = async () => null    // sin API key de Google
  })

  /**
   * Cuando no hay Google Maps SDK, el mapa interactivo no se crea (no hay pin que arrastrar).
   * El geocoding se dispara pegando coordenadas en el input "Pegar enlace de Google Maps",
   * que llama a applyMapsPaste → reverseGeocode → Nominatim.
   */
  async function pasteCoordinates(wrapper: VueWrapper, lat: number, lng: number) {
    // Buscar el input de pegado por su placeholder dentro del wrapper montado
    const pasteInput = wrapper.find('input[placeholder*="maps.google.com"]')
    expect(pasteInput.exists(), 'el input de pegado tiene que existir en la pestaña Ubicación').toBeTruthy()
    await pasteInput.setValue(`${lat}, ${lng}`)
    await flushPromises()
  }

  it('completa dirección via Nominatim cuando no hay SDK de Google', async () => {
    nominatimImpl = async () => ({
      province: 'La Altagracia',
      municipality: 'Higüey',
      locality: 'Villa Piantini',
      postalCode: '23000',
    })
    const wrapper = await mountOnLocationTab()
    await pasteCoordinates(wrapper, 18.6, -68.7)

    expect(valueOf(wrapper, 'latitude')).toBe('18.6')
    expect(valueOf(wrapper, 'longitude')).toBe('-68.7')
    expect(valueOf(wrapper, 'province')).toBe('La Altagracia')
    expect(valueOf(wrapper, 'municipality')).toBe('Higüey')
    expect(valueOf(wrapper, 'locality')).toBe('Villa Piantini')
    expect(valueOf(wrapper, 'postalCode')).toBe('23000')
    expect(toastCalls.some((t) => t.kind === 'success')).toBe(true)
  })

  it('usa town/village como fallback para municipio y localidad', async () => {
    nominatimImpl = async () => ({
      province: 'Duarte',
      municipality: 'San Francisco de Macoris',
      locality: 'San Francisco de Macoris',
      postalCode: '31000',
    })
    const wrapper = await mountOnLocationTab()
    await pasteCoordinates(wrapper, 19.3, -70.25)

    expect(valueOf(wrapper, 'province')).toBe('Duarte')
    expect(valueOf(wrapper, 'municipality')).toBe('San Francisco de Macoris')
    expect(valueOf(wrapper, 'locality')).toBe('San Francisco de Macoris')
    expect(valueOf(wrapper, 'postalCode')).toBe('31000')
  })

  it('avisa cuando Nominatim no devuelve direccion', async () => {
    nominatimImpl = async () => ({ province: '', municipality: '', locality: '', postalCode: '' })
    const wrapper = await mountOnLocationTab()
    await pasteCoordinates(wrapper, 19.0, -70.0)

    expect(valueOf(wrapper, 'province')).toBe('')
    const avisos = toastCalls.filter((t) => t.kind === 'warning')
    expect(avisos.length, 'tiene que avisar que no hay datos').toBeGreaterThan(0)
  })

  it('avisa cuando Nominatim falla (sin red)', async () => {
    nominatimImpl = async () => { throw new TypeError('Failed to fetch') }
    const wrapper = await mountOnLocationTab()
    await pasteCoordinates(wrapper, 18.4861, -69.9312)

    expect(valueOf(wrapper, 'latitude')).toBe('18.4861')
    const avisos = toastCalls.filter((t) => t.kind === 'warning' || t.kind === 'error')
    expect(avisos.length, 'el usuario tiene que enterarse del fallo').toBeGreaterThan(0)
  })

  it('no pisa lo que el usuario escribio a mano (mismo comportamiento que Google)', async () => {
    nominatimImpl = async () => ({
      province: 'La Altagracia',
      municipality: 'Higüey',
      locality: 'Centro',
      postalCode: '23000',
    })
    const wrapper = await mountOnLocationTab()
    const municipio = wrapper.find('[data-field="municipality"]')
    await municipio.setValue('Boca Chica')

    await pasteCoordinates(wrapper, 18.6, -68.7)

    expect(valueOf(wrapper, 'municipality')).toBe('Boca Chica')
    expect(valueOf(wrapper, 'province')).toBe('La Altagracia')
  })
})
