// useHotelLocationMap.ts — Mapa de ubicación del hotel (Google Maps).
//
// Extraído de `pages/settings/index.vue` (tarea 1.1, docs/wizard-refactor) para que tanto
// `pages/pagina-publica/ubicacion.vue` como los pasos del futuro Centro de configuración puedan
// usar la misma lógica sin duplicar ~200 líneas de geocoding.
//
// SIEMPRE Google Maps — decisión explícita del usuario (2026-09-08: "tienes que usar google maps
// no puedes usar otro"), sin fallback a otro proveedor de mapas. Con key configurada (Admin →
// Integraciones): mapa interactivo real (`google.maps.Map` + `Marker`, clic y arrastre). Sin key:
// iframe embed (`output=embed`, no requiere key ni facturación) — un iframe es de otro origen y
// NO puede avisarnos dónde hizo clic el usuario, así que en ese caso el pin se fija pegando el
// enlace/coordenadas de Google Maps o con "usar mi ubicación". La interactividad real (arrastrar
// el pin en el mapa) requiere sí o sí una Maps JavaScript API key válida — no hay forma de
// conseguirla sin key manteniendo Google Maps como único proveedor.
import { ref, computed, nextTick, watch, type Ref } from 'vue'
import { useToast } from '@/composables/useToast'
import { parseLatLng } from '@/composables/useLatLngParse'
import { loadGoogleMaps } from '@/composables/useGoogleMaps'
import { countryName, countryCode } from '@/data/locales'
import {
  mapAddressComponents, unresolvedFields, geocodeErrorMessage,
  reverseGeocodeNominatim, searchNominatim,
  ADDRESS_FIELD_LABELS, type AddressField, type AddressSuggestion, type MappedAddress,
} from '@/utils/address-components'

export interface HotelLocationFormFields {
  country?: string
  address?: string
  latitude?: number | string
  longitude?: number | string
  province?: string
  municipality?: string
  locality?: string
  postalCode?: string
}

/** Centro por defecto cuando el hotel no tiene coordenadas NI un país reconocido. */
const FALLBACK_LAT = 18.4861
const FALLBACK_LNG = -69.9312

/**
 * Centro aproximado por país (bug 3.2 de la auditoría — docs/wizard-refactor/01: el mapa
 * arrancaba SIEMPRE en Santo Domingo sin importar el país del hotel). No existe ninguna fuente
 * de esto en el repo (confirmado tarea 0.3, `rg` sin resultados en frontend/src/data y
 * backend/src/shared) — tabla nueva, coordenadas aproximadas de centro/capital, suficientes para
 * centrar un mapa a nivel país, NO para geocoding preciso. Cubre los mercados con uso real
 * (Caribe/LatAm/Iberia, foco del producto — ver CLAUDE.md). Un país sin entrada acá simplemente
 * no recentra: cae al FALLBACK_LAT/FALLBACK_LNG de siempre, no rompe nada.
 *
 * Las keys son el NOMBRE en español tal cual lo guarda `hotels.country` (mismo formato que
 * `COUNTRIES` de `data/locales.ts`) — se normaliza con `countryName()` antes de buscar acá por si
 * el valor guardado es un código ISO viejo (`hotels.country` tuvo los dos formatos conviviendo,
 * ver comentario de `countryName()`).
 */
const COUNTRY_CENTER: Record<string, { lat: number; lng: number }> = {
  'República Dominicana': { lat: 18.7357, lng: -70.1627 },
  'Estados Unidos': { lat: 37.0902, lng: -95.7129 },
  'España': { lat: 40.4637, lng: -3.7492 },
  'Colombia': { lat: 4.5709, lng: -74.2973 },
  'México': { lat: 23.6345, lng: -102.5528 },
  'Argentina': { lat: -38.4161, lng: -63.6167 },
  'Venezuela': { lat: 6.4238, lng: -66.5897 },
  'Puerto Rico': { lat: 18.2208, lng: -66.5901 },
  'Cuba': { lat: 21.5218, lng: -77.7812 },
  'Brasil': { lat: -14.2350, lng: -51.9253 },
  'Chile': { lat: -35.6751, lng: -71.5430 },
  'Perú': { lat: -9.1900, lng: -75.0152 },
  'Canadá': { lat: 56.1304, lng: -106.3468 },
  'Panamá': { lat: 8.5380, lng: -80.7821 },
  'Costa Rica': { lat: 9.7489, lng: -83.7534 },
  'Guatemala': { lat: 15.7835, lng: -90.2308 },
  'Honduras': { lat: 15.2000, lng: -86.2419 },
  'El Salvador': { lat: 13.7942, lng: -88.8965 },
  'Nicaragua': { lat: 12.8654, lng: -85.2072 },
  'Ecuador': { lat: -1.8312, lng: -78.1834 },
  'Bolivia': { lat: -16.2902, lng: -63.5887 },
  'Paraguay': { lat: -23.4425, lng: -58.4438 },
  'Uruguay': { lat: -32.5228, lng: -55.7658 },
  'Jamaica': { lat: 18.1096, lng: -77.2975 },
  'Haití': { lat: 18.9712, lng: -72.2852 },
  'Trinidad y Tobago': { lat: 10.6918, lng: -61.2225 },
  'Bahamas': { lat: 25.0343, lng: -77.3963 },
  'Barbados': { lat: 13.1939, lng: -59.5432 },
  'Portugal': { lat: 39.3999, lng: -8.2245 },
  'Francia': { lat: 46.2276, lng: 2.2137 },
  'Italia': { lat: 41.8719, lng: 12.5674 },
  'Reino Unido': { lat: 55.3781, lng: -3.4360 },
  'Alemania': { lat: 51.1657, lng: 10.4515 },
}

export function useHotelLocationMap<T extends HotelLocationFormFields>(form: Ref<T>) {
  const toast = useToast()

  /** Centro a usar cuando el hotel todavía no fijó coordenadas propias. */
  const defaultCenter = computed(() => {
    const name = countryName(form.value.country ?? '') || form.value.country || ''
    return COUNTRY_CENTER[name] ?? { lat: FALLBACK_LAT, lng: FALLBACK_LNG }
  })

  /** ISO 3166-1 alpha-2 del país elegido, para restringir el autocompletado de dirección
   *  (Google `componentRestrictions.country` / Nominatim `countrycodes`). `undefined` si no hay
   *  país reconocido — el autocompletado simplemente busca sin restringir. */
  const countryIso = computed(() => {
    const name = countryName(form.value.country ?? '') || form.value.country || ''
    return countryCode(name)
  })

  const mapLat = computed(() => Number(form.value.latitude) || defaultCenter.value.lat)
  const mapLng = computed(() => Number(form.value.longitude) || defaultCenter.value.lng)

  const googleMapsEmbedUrl = computed(
    () => `https://www.google.com/maps?q=${mapLat.value},${mapLng.value}&z=16&output=embed`,
  )
  const googleMapsLinkUrl = computed(
    () => `https://www.google.com/maps/search/?api=1&query=${mapLat.value},${mapLng.value}`,
  )

  const mapsPaste = ref('')

  function applyMapsPaste() {
    const parsed = parseLatLng(mapsPaste.value)
    if (!parsed) return          // se escribe de a poco: no molestar hasta que haya un par válido
    form.value.latitude = parsed.lat
    form.value.longitude = parsed.lng
    mapsPaste.value = ''
    syncMarkerFromForm()
    toast.success('Ubicación actualizada desde Google Maps')
    reverseGeocode(parsed.lat, parsed.lng)
  }

  // ─── Mapa interactivo (sólo si hay API key configurada en Admin → Integraciones) ─────
  const mapEl = ref<HTMLElement | null>(null)
  const mapsInteractive = ref(false)
  let gmap: google.maps.Map | null = null
  let gmarker: google.maps.Marker | null = null
  let geocoder: google.maps.Geocoder | null = null

  function setCoords(lat: number, lng: number) {
    form.value.latitude = Number(lat.toFixed(6))
    form.value.longitude = Number(lng.toFixed(6))
  }

  /**
   * Último valor que el autocompletado escribió en cada campo. Sirve para NO pisar lo que el
   * usuario tipeó a mano: solo se sobrescribe un campo vacío o uno cuyo contenido lo puso el
   * geocoding anterior. Si el usuario corrigió "Municipio" y después mueve el pin, su corrección
   * se respeta.
   */
  const geocodedValues = ref<Partial<Record<AddressField, string>>>({})

  /** Descarta respuestas viejas: si el usuario arrastra el pin dos veces seguidas, la primera
   *  respuesta puede llegar después de la segunda y dejaría una dirección que no corresponde. */
  let geocodeSeq = 0

  /**
   * Reverse geocoding: dado un punto, pregunta qué dirección hay ahí y completa
   * Provincia/Municipio/Localidad/Código Postal.
   *
   * GH-33 — cadena de proveedores Google → Nominatim (OpenStreetMap):
   *
   *  1. La "Geocoding API" es un producto SEPARADO de la "Maps JavaScript API" en Google Cloud:
   *     la key que dibuja el mapa NO habilita el geocoding, y la request vuelve `REQUEST_DENIED`.
   *     Ese es el escenario reportado: el mapa interactivo funciona, el pin se mueve, lat/lng se
   *     actualizan… y los cuatro campos quedaban vacíos (en `main` además con un catch mudo, sin
   *     ningún mensaje). Por eso NINGUNA falla de Google termina el flujo: cae a Nominatim
   *     (gratis, sin key) antes de rendirse — SOLO como fallback de GEOCODING (traducir un punto
   *     a dirección), nunca como proveedor de MAPA (eso es siempre Google, ver header).
   *  2. Sin key de Google directamente no hay SDK ni Geocoder: mismo fallback de Nominatim para
   *     las otras vías de coordenadas (pegar enlace de Maps, "usar mi ubicación").
   *  3. Si los DOS proveedores fallan, recién ahí el aviso visible (`geocodeErrorMessage`) —
   *     nunca silencio, nunca bloquea: los campos siguen editables a mano.
   *
   * El mapeo de componentes vive en `utils/address-components.ts` (con sus cadenas de fallback,
   * porque el esquema de Google no calza 1:1 con ninguna división administrativa nacional).
   * Es MEJOR ESFUERZO y los campos siguen siendo editables.
   */
  async function reverseGeocode(lat: number, lng: number) {
    const seq = ++geocodeSeq
    const maps = await loadGoogleMaps()

    // 1) Google Geocoding (si hay SDK cargado).
    if (maps) {
      try {
        geocoder ??= new maps.Geocoder()
        const { results } = await geocoder.geocode({ location: { lat, lng } })
        if (seq !== geocodeSeq) return       // llegó tarde: el pin ya está en otro lado
        const result = results?.[0]
        if (!result) throw new Error('ZERO_RESULTS')

        const mapped = mapAddressComponents(result.address_components)
        if (unresolvedFields(mapped).length === Object.keys(ADDRESS_FIELD_LABELS).length) {
          // Google respondió, pero sin NINGÚN componente aprovechable para estos cuatro campos.
          // Antes de rendirse, probar el fallback: a veces OSM tiene lo que Google no trae.
          throw new Error('ZERO_RESULTS')
        }
        applyGeocodedValues(mapped, 'Google')
        return
      } catch {
        if (seq !== geocodeSeq) return       // respuesta vieja: ni fallback ni aviso
        // Google caído (REQUEST_DENIED, librería sin cargar, red): sigue al fallback.
      }
    }

    // 2) Nominatim (OpenStreetMap): gratis, sin API key. Se llama UNA vez por dragend/click/
    //    pegado (no por frame), así el rate limit del proveedor (1 req/s) no se satura arrastrando.
    try {
      const mapped = await reverseGeocodeNominatim(lat, lng)
      if (seq !== geocodeSeq) return
      applyGeocodedValues(mapped, 'OpenStreetMap')
    } catch (err) {
      if (seq !== geocodeSeq) return
      // Nada de silencio: el usuario tiene que saber por qué los campos siguen vacíos y qué hacer.
      const { variant, title, detail } = geocodeErrorMessage(err)
      if (variant === 'warning') toast.warning(title, detail)
      else toast.error(title, detail)
    }
  }

  /**
   * Aplica los valores geocodificados (de Google o Nominatim) a los campos del formulario.
   * Respeta lo que el usuario escribió a mano: solo pisa campos vacíos o los que puso
   * el propio autocompletado previo.
   */
  function applyGeocodedValues(mapped: { province: string; municipality: string; locality: string; postalCode: string }, source: string) {
    const pending = unresolvedFields(mapped)
    const kept: AddressField[] = []

    for (const field of Object.keys(ADDRESS_FIELD_LABELS) as AddressField[]) {
      const value = mapped[field]
      if (!value) continue
      const current = String((form.value as Record<string, unknown>)[field] ?? '').trim()
      // Solo se pisa lo vacío o lo que puso el propio autocompletado.
      if (current && current !== (geocodedValues.value[field] ?? '')) {
        kept.push(field)
        continue
      }
      ;(form.value as Record<string, unknown>)[field] = value
      geocodedValues.value[field] = value
    }

    // El Código Postal no hace falta (pedido explícito, 2026-09-08): igual se completa arriba
    // cuando el proveedor lo trae, pero que falte NO dispara ningún aviso — ni cuenta para decidir
    // si avisar, ni aparece en el texto. Provincia/Municipio/Localidad sí siguen avisando.
    const notifiableFields = (Object.keys(ADDRESS_FIELD_LABELS) as AddressField[]).filter((f) => f !== 'postalCode')
    const notifiablePending = pending.filter((f) => f !== 'postalCode')
    const notifiableKept = kept.filter((f) => f !== 'postalCode').map((f) => ADDRESS_FIELD_LABELS[f])

    if (notifiablePending.length === 0) {
      // Provincia/Municipio/Localidad completos: éxito, sea cual sea el estado del Código
      // Postal (se aplicó si vino, y no importa si no vino).
      toast.success(
        'Dirección completada automáticamente',
        notifiableKept.length ? `Se respetó lo que escribiste en: ${notifiableKept.join(', ')}.` : 'Revisá los campos antes de guardar.',
      )
      return
    }

    if (notifiablePending.length === notifiableFields.length) {
      toast.warning(
        `${source} no devolvió datos de dirección para ese punto`,
        'Completá Provincia, Municipio y Localidad a mano.',
      )
      return
    }

    const notas = [
      `${source} no devolvió: ${notifiablePending.map((f) => ADDRESS_FIELD_LABELS[f]).join(', ')}.`,
      notifiableKept.length ? `Se respetó lo que escribiste en: ${notifiableKept.join(', ')}.` : '',
    ].filter(Boolean).join(' ')

    toast.warning('Dirección completada parcialmente', `${notas} Revisá y completá a mano.`)
  }

  async function initInteractiveMap() {
    if (gmap || !mapEl.value) return
    const maps = await loadGoogleMaps()
    if (!maps) return                      // sin key o key inválida → queda el iframe
    mapsInteractive.value = true
    await nextTick()                       // el div estaba en v-show: necesita estar medido
    const center = { lat: mapLat.value, lng: mapLng.value }
    gmap = new maps.Map(mapEl.value, { center, zoom: 16, mapTypeControl: true, streetViewControl: false })
    gmarker = new maps.Marker({ position: center, map: gmap, draggable: true })
    gmarker.addListener('dragend', () => {
      const p = gmarker!.getPosition()
      if (p) {
        setCoords(p.lat(), p.lng())
        reverseGeocode(p.lat(), p.lng())
      }
    })
    gmap.addListener('click', (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return
      setCoords(e.latLng.lat(), e.latLng.lng())
      gmarker!.setPosition(e.latLng)
      reverseGeocode(e.latLng.lat(), e.latLng.lng())
    })
  }

  /** Recentra el mapa cuando las coordenadas cambian por otra vía (pegar enlace, geolocalización,
   *  autocompletado de dirección, o el país elegido cuando todavía no hay coordenadas propias —
   *  bug 3.2). Sin mapa interactivo (sin key) no hace nada — el iframe ya es reactivo solo. */
  function syncMarkerFromForm() {
    if (!gmap || !gmarker) return
    const pos = { lat: mapLat.value, lng: mapLng.value }
    gmarker.setPosition(pos)
    gmap.setCenter(pos)
  }

  // ─── Autocompletado de dirección ────────────────────────────────────────────────────────────
  // Con key de Google: `google.maps.places.Autocomplete` nativo sobre el input de dirección —
  // el propio SDK dibuja su dropdown, no hace falta renderizar nada acá. Sin key: fallback a
  // Nominatim `/search` con un dropdown propio (`addressSuggestions`), debounced. En ambos
  // casos, la búsqueda se restringe al país elegido (`countryIso`) — pedido explícito del
  // usuario: sin esto, buscar "Piantini" desde un hotel en RD puede traer un resultado de otro
  // país con el mismo nombre de barrio.
  const addressInputEl = ref<HTMLInputElement | null>(null)
  const addressSuggestions = ref<AddressSuggestion[]>([])
  const addressSearching = ref(false)
  let placesAutocomplete: google.maps.places.Autocomplete | null = null
  let nominatimDebounce: ReturnType<typeof setTimeout> | null = null
  /** Evita que `applyAddressSelection` dispare una nueva búsqueda sobre la dirección que ACABA
   *  de aplicar (el watch de `form.value.address` de más abajo, si no, se re-dispara solo). */
  let suppressAddressSearch = false

  /** Aplica una dirección elegida (Google Places o una sugerencia de Nominatim) a TODO el
   *  formulario de una — dirección, coordenadas y los 4 campos autocompletados juntos. Estos
   *  campos pasan a ser de solo lectura en la UI (pedido del usuario): el ÚNICO camino para
   *  completarlos es elegir una sugerencia, mover el pin, pegar un link o "usar mi ubicación" —
   *  nunca tipeando directo. */
  function applyAddressSelection(formattedAddress: string, lat: number, lng: number, mapped: MappedAddress) {
    suppressAddressSearch = true
    form.value.address = formattedAddress
    setCoords(lat, lng)
    for (const field of Object.keys(ADDRESS_FIELD_LABELS) as AddressField[]) {
      const value = mapped[field]
      if (!value) continue
      ;(form.value as Record<string, unknown>)[field] = value
      geocodedValues.value[field] = value
    }
    addressSuggestions.value = []
    syncMarkerFromForm()
  }

  /** Conecta `google.maps.places.Autocomplete` al input de dirección — llamar en `onMounted`
   *  junto a `initInteractiveMap()`, después de que `addressInputEl` ya esté montado. Si no hay
   *  key de Google no hace nada: queda el fallback por Nominatim (watch de más abajo). */
  async function initAddressAutocomplete() {
    if (placesAutocomplete || !addressInputEl.value) return
    const maps = await loadGoogleMaps()
    if (!maps?.places) return
    placesAutocomplete = new maps.places.Autocomplete(addressInputEl.value, {
      fields: ['address_components', 'geometry', 'formatted_address'],
      ...(countryIso.value ? { componentRestrictions: { country: countryIso.value } } : {}),
    })
    placesAutocomplete.addListener('place_changed', () => {
      const place = placesAutocomplete!.getPlace()
      const loc = place.geometry?.location
      if (!loc) return   // Enter sin elegir una sugerencia real: no hay geometría, no hay nada que aplicar
      applyAddressSelection(
        place.formatted_address || form.value.address || '',
        loc.lat(), loc.lng(),
        mapAddressComponents(place.address_components),
      )
    })
  }

  function selectAddressSuggestion(s: AddressSuggestion) {
    applyAddressSelection(s.label, s.lat, s.lng, s.mapped)
  }

  // `ready`/`markLocationLoaded()`: evita que los dos watches de abajo (dirección y país)
  // disparen durante la carga inicial — el consumidor llama `markLocationLoaded()` recién
  // después de poblar `form` con los datos reales del hotel. Antes de eso, asignar `form.value`
  // desde la API también "cambia" `address`/`country` técnicamente, pero no hay nada que buscar
  // ni limpiar todavía.
  const ready = ref(false)
  function markLocationLoaded() { ready.value = true }

  /** Distinto de "sin resultados" — se muestra en el dropdown para que quede claro que la
   *  búsqueda falló (red/Nominatim caído) y no que la dirección no existe. */
  const addressSearchError = ref(false)

  /** Descarta respuestas de búsqueda viejas: si el usuario sigue escribiendo, una request lenta
   *  para un texto más corto puede resolver DESPUÉS que una más reciente y pisar resultados
   *  mejores con otros peores — exactamente el "a veces lo que sale es pobre" reportado. Mismo
   *  patrón que `geocodeSeq` de arriba. */
  let addressSearchSeq = 0

  /** Fallback sin key de Google: busca en Nominatim mientras el usuario tipea (debounced).
   *  Reactivo sobre `form.value.address` en vez de atado a un evento del template — así funciona
   *  sin importar cómo cambió el valor (v-model, autocompletar, etc.), y `suppressAddressSearch`
   *  evita que se re-dispare sobre la dirección que `applyAddressSelection` acaba de aplicar. */
  watch(() => form.value.address, (query) => {
    if (suppressAddressSearch) { suppressAddressSearch = false; return }
    if (!ready.value || mapsInteractive.value) return   // carga inicial, o Google ya tiene su propio dropdown
    if (nominatimDebounce) clearTimeout(nominatimDebounce)
    const seq = ++addressSearchSeq
    nominatimDebounce = setTimeout(async () => {
      addressSearching.value = true
      addressSearchError.value = false
      try {
        const results = await searchNominatim(query ?? '', countryIso.value)
        if (seq !== addressSearchSeq) return   // llegó tarde: ya hay una búsqueda más nueva en curso
        addressSuggestions.value = results
      } catch {
        if (seq !== addressSearchSeq) return
        addressSuggestions.value = []
        addressSearchError.value = true   // sin internet o Nominatim caído: visible, no un silencio confuso
      } finally {
        if (seq === addressSearchSeq) addressSearching.value = false
      }
    }, 350)
  })

  // ─── Cambio de país: limpia todo lo derivado de la dirección anterior ──────────────────────
  // Pedido explícito del usuario (2026-09-08): una dirección/pin/provincia de OTRO país ya no
  // tiene sentido una vez que se cambia el país — se limpian de una para que no queden datos
  // mezclados de dos países distintos.
  let lastCountry = form.value.country
  watch(() => form.value.country, (next) => {
    const prev = lastCountry
    lastCountry = next
    if (!ready.value || next === prev) {
      // Sin limpiar, pero el mapa igual se recentra al país (bug 3.2) — sirve incluso durante la
      // carga inicial si el hotel no tiene coordenadas propias.
      if (!(form.value.latitude && form.value.longitude)) syncMarkerFromForm()
      return
    }

    suppressAddressSearch = true
    form.value.address = ''
    form.value.latitude = undefined
    form.value.longitude = undefined
    form.value.province = ''
    form.value.municipality = ''
    form.value.locality = ''
    form.value.postalCode = ''
    geocodedValues.value = {}
    addressSuggestions.value = []
    placesAutocomplete?.setComponentRestrictions(countryIso.value ? { country: countryIso.value } : null)
    syncMarkerFromForm()
  })

  function useMyLocation() {
    if (!navigator.geolocation) {
      toast.error('Geolocalización no disponible')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        form.value.latitude = pos.coords.latitude
        form.value.longitude = pos.coords.longitude
        syncMarkerFromForm()
        toast.success('Ubicación actualizada')
        reverseGeocode(pos.coords.latitude, pos.coords.longitude)
      },
      () => toast.error('No se pudo obtener tu ubicación'),
    )
  }

  return {
    mapEl,
    mapsInteractive,
    googleMapsEmbedUrl,
    googleMapsLinkUrl,
    mapsPaste,
    applyMapsPaste,
    useMyLocation,
    syncMarkerFromForm,
    initInteractiveMap,
    // Autocompletado de dirección
    addressInputEl,
    addressSuggestions,
    addressSearching,
    addressSearchError,
    initAddressAutocomplete,
    selectAddressSuggestion,
    // Carga inicial (evita que el watch de país limpie datos recién cargados)
    markLocationLoaded,
  }
}
