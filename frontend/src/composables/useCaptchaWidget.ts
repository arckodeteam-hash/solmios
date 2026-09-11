// useCaptchaWidget.ts — Widget de captcha (Turnstile / reCAPTCHA v2 / hCaptcha) para una pantalla.
//
// Pide la config pública al servidor y dibuja el widget SOLO si el interruptor general y el de
// esta pantalla (`scope`) están prendidos. El backend decide si exige el token; esto es solo para
// dibujarlo y mandarlo. Turnstile, reCAPTCHA v2 y hCaptcha exponen la misma forma
// (`render`/`reset`/`remove` con `sitekey` + `callback`), que es lo que permite un solo código.
//
// `register.vue` tiene su propia copia de esta lógica (anterior a este composable); el login usa
// esta. Unificarlos es una limpieza pendiente, no un cambio de comportamiento.
import { ref, computed, nextTick, onUnmounted, type Ref } from 'vue'
import { CaptchaService, type PublicCaptchaConfig } from '@/services/Captcha.service'

interface CaptchaApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  reset: (id?: string) => void
  remove: (id?: string) => void
  ready?: (cb: () => void) => void
}

const APAGADO: PublicCaptchaConfig = {
  enabled: false, provider: 'turnstile', siteKey: '', scriptUrl: '', globalName: 'turnstile',
  scopes: { register: true, login: false },
}

export function useCaptchaWidget(scope: 'login' | 'register', el: Ref<HTMLElement | null>) {
  const cfg = ref<PublicCaptchaConfig>({ ...APAGADO })
  const token = ref('')
  const error = ref('')
  let widgetId: string | undefined

  /** Site key a usar, o '' si esta pantalla no pide captcha. */
  const siteKey = computed(() => (cfg.value.enabled && cfg.value.scopes?.[scope] ? cfg.value.siteKey : ''))
  const required = computed(() => siteKey.value !== '')

  function api(): CaptchaApi | undefined {
    return (window as unknown as Record<string, CaptchaApi | undefined>)[cfg.value.globalName]
  }

  function loadScript(): Promise<void> {
    const SRC = cfg.value.scriptUrl
    if (!SRC) return Promise.reject(new Error('sin script de captcha'))
    if (api()) return Promise.resolve()
    const existing = document.querySelector(`script[src="${SRC}"]`)
    if (existing) return new Promise((res) => existing.addEventListener('load', () => res()))
    return new Promise((res, rej) => {
      const sc = document.createElement('script')
      sc.src = SRC
      sc.async = true
      sc.defer = true
      sc.onload = () => res()
      sc.onerror = () => rej(new Error('no se pudo cargar el captcha'))
      document.head.appendChild(sc)
    })
  }

  async function mount() {
    if (!siteKey.value || widgetId !== undefined) return
    try {
      await loadScript()
      await nextTick()
      const a = api()
      if (!a || !el.value) return
      // reCAPTCHA deja el objeto antes de terminar de inicializarse: `render` existe recién
      // dentro de su `ready()`. Los otros dos no tienen `ready`.
      if (typeof a.ready === 'function') await new Promise<void>((res) => a.ready!.call(a, res))
      widgetId = a.render(el.value, {
        sitekey: siteKey.value,
        callback: (t: string) => { token.value = t; error.value = '' },
        'expired-callback': () => { token.value = '' },
        'error-callback': () => {
          token.value = ''
          error.value = 'No se pudo cargar la verificación. Revisa tu conexión.'
        },
      })
    } catch {
      error.value = 'No se pudo cargar la verificación anti-robots. Recarga la página.'
    }
  }

  /** Pide la config y, si esta pantalla lo necesita, dibuja el widget. */
  async function init() {
    cfg.value = await CaptchaService.publicConfig()
    await mount()
  }

  /** El token es de un solo uso: tras un intento fallido hay que resetear o todo reintento falla. */
  function reset() {
    token.value = ''
    if (widgetId !== undefined) api()?.reset(widgetId)
  }

  onUnmounted(() => {
    if (widgetId !== undefined) api()?.remove(widgetId)
  })

  return { cfg, token, error, required, init, reset }
}
