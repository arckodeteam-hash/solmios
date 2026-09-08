// composables/useMetaSignup.ts — Abre la ventana de Meta para conectar el WhatsApp del hotel.
//
// Es la mitad del Embedded Signup que corre en el navegador. Su única salida es un CÓDIGO de un
// solo uso, que el servidor canjea por el token permanente del hotel. El navegador NUNCA ve ese
// token: pedirlo directo (`response_type: 'token'`) lo dejaría en el JavaScript de la página, al
// alcance de cualquiera con la consola abierta, y con él se le puede escribir a todos los huéspedes.

/** Identifican a la app de SOLMI OS. Son públicos por diseño; el secreto vive en el servidor. */
const APP_ID = import.meta.env.VITE_META_APP_ID || '1727869705161184'
const CONFIG_ID = import.meta.env.VITE_META_CONFIG_ID || '1088480837040398'
const GRAPH_VERSION = import.meta.env.VITE_META_GRAPH_VERSION || 'v26.0'
const SDK_SRC = 'https://connect.facebook.net/es_LA/sdk.js'

export interface DatosDeConexion {
  code: string
  wabaId: string
  phoneNumberId: string
}

declare global {
  interface Window {
    FB?: any
    fbAsyncInit?: () => void
  }
}

let sdkListo: Promise<void> | null = null

/**
 * Carga el SDK de Facebook la primera vez que hace falta, no al arrancar la app.
 *
 * Importa: es un script de un tercero que observa la página. Cargarlo en el arranque significaría
 * que Meta ve a todos los usuarios del panel, incluidos los que nunca van a tocar WhatsApp.
 */
function cargarSdk(): Promise<void> {
  if (sdkListo) return sdkListo
  sdkListo = new Promise<void>((resolve, reject) => {
    if (window.FB) { resolve(); return }
    const script = document.createElement('script')
    script.src = SDK_SRC
    script.async = true
    script.crossOrigin = 'anonymous'
    script.onload = () => {
      try {
        window.FB.init({ appId: APP_ID, cookie: true, xfbml: false, version: GRAPH_VERSION })
        resolve()
      } catch (err) {
        reject(err)
      }
    }
    script.onerror = () => {
      // Un bloqueador de rastreadores alcanza para tumbar esto, y es frecuente. El mensaje tiene
      // que decir qué pasó, no "error desconocido".
      sdkListo = null
      reject(new Error('No se pudo cargar la ventana de Meta. Si tenés un bloqueador de anuncios, desactivalo para este sitio y volvé a intentar.'))
    }
    document.head.appendChild(script)
  })
  return sdkListo
}

/**
 * Escucha el evento que Meta emite DENTRO del flujo con la cuenta y el número elegidos.
 *
 * Estos dos ids no vienen en la respuesta del login: llegan por `postMessage` mientras el usuario
 * completa los pasos. Sin ellos el servidor no sabría a qué cuenta suscribirse.
 */
function escucharDatosDeLaCuenta(): { leer: () => { wabaId: string; phoneNumberId: string }; parar: () => void } {
  let wabaId = ''
  let phoneNumberId = ''

  const onMessage = (event: MessageEvent) => {
    if (!/facebook\.com$/.test(new URL(event.origin).hostname)) return
    try {
      const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
      if (data?.type !== 'WA_EMBEDDED_SIGNUP') return
      if (data?.data?.waba_id) wabaId = String(data.data.waba_id)
      if (data?.data?.phone_number_id) phoneNumberId = String(data.data.phone_number_id)
    } catch {
      // Otros scripts también hablan por postMessage: lo que no parsea, no es nuestro.
    }
  }

  window.addEventListener('message', onMessage)
  return {
    leer: () => ({ wabaId, phoneNumberId }),
    parar: () => window.removeEventListener('message', onMessage),
  }
}

/**
 * Abre la ventana de Meta y devuelve lo que hace falta para conectar.
 * `null` cuando la persona la cerró sin terminar: no es un error, es una decisión.
 */
export async function abrirVentanaDeMeta(): Promise<DatosDeConexion | null> {
  await cargarSdk()
  const escucha = escucharDatosDeLaCuenta()

  try {
    const respuesta = await new Promise<any>((resolve) => {
      window.FB.login(resolve, {
        config_id: CONFIG_ID,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {}, featureType: '', sessionInfoVersion: '3' },
      })
    })

    const code = respuesta?.authResponse?.code
    if (!code) return null

    const { wabaId, phoneNumberId } = escucha.leer()
    if (!wabaId || !phoneNumberId) {
      throw new Error('Meta no devolvió la cuenta ni el número. Volvé a intentar y completá todos los pasos de la ventana.')
    }
    return { code, wabaId, phoneNumberId }
  } finally {
    escucha.parar()
  }
}
