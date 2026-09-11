// Captcha.service.ts — La barrera anti-robots del alta pública (#12).
//
// Dos consumidores muy distintos:
//  · `publicConfig()` la llama la PÁGINA DE REGISTRO, sin sesión, para saber qué widget dibujar.
//    Antes esto era `VITE_TURNSTILE_SITE_KEY`, una variable de BUILD: activar el captcha obligaba a
//    recompilar el frontend. Ahora se pide al servidor y se puede prender sin deploy.
//  · `estado()`/`guardar()` las llama el SUPER-ADMIN desde Configuración.
//
// El secreto no aparece en ninguno de los dos: el backend devuelve, como mucho, una pista.

import { http } from './http'

export type CaptchaProvider = 'turnstile' | 'recaptcha' | 'hcaptcha'

/** Lo que necesita la página de registro para dibujar el widget. */
export interface PublicCaptchaConfig {
  enabled: boolean
  provider: CaptchaProvider
  siteKey: string
  /** Script del proveedor. Viene del backend para no tener tres URLs repetidas acá. */
  scriptUrl: string
  /** Objeto que ese script deja en `window` y que expone `.render()`. */
  globalName: string
  /** Qué pantallas lo piden. Cada una mira la suya antes de dibujar el widget. */
  scopes: CaptchaScopes
}

export interface CaptchaScopes { register: boolean; login: boolean }

export interface CaptchaProviderOption {
  value: CaptchaProvider
  label: string
  docsUrl: string
  hint: string
}

/** Lo que ve el super-admin. `pista` son los últimos caracteres del secreto, nunca el secreto. */
export interface CaptchaEstado {
  enabled: boolean
  provider: CaptchaProvider
  siteKey: string
  configurado: boolean
  origen: 'entorno' | 'panel' | null
  pista: string | null
  /** `false` cuando el secreto viene del servidor (.env) o falta la clave de cifrado. */
  puedeGuardar: boolean
  proveedores: CaptchaProviderOption[]
  scopes: CaptchaScopes
}

export interface GuardarCaptchaInput {
  enabled?: boolean
  provider?: CaptchaProvider
  siteKey?: string
  /** Vacío = conserva el guardado. La pantalla nunca muestra el secreto. */
  secret?: string
  /** Por pantalla. `login` arranca apagado: la app móvil entra por el mismo endpoint sin token. */
  register?: boolean
  login?: boolean
}

const APAGADO: PublicCaptchaConfig = {
  enabled: false, provider: 'turnstile', siteKey: '', scriptUrl: '', globalName: 'turnstile',
  scopes: { register: true, login: false },
}

export const CaptchaService = {
  /**
   * Config del widget para la página de registro. Si el servidor no contesta se devuelve
   * "apagado": el alta tiene que poder seguir aunque esta consulta falle — el backend decide si
   * exige el token o no, esto es sólo para dibujar.
   */
  async publicConfig(): Promise<PublicCaptchaConfig> {
    try {
      const r = await http.get<PublicCaptchaConfig>('/public/captcha')
      return r?.provider ? r : { ...APAGADO }
    } catch {
      return { ...APAGADO }
    }
  },

  estado(): Promise<CaptchaEstado> {
    return http.get<CaptchaEstado>('/admin/captcha')
  },

  guardar(input: GuardarCaptchaInput): Promise<CaptchaEstado> {
    return http.put<CaptchaEstado>('/admin/captcha', input)
  },
}
