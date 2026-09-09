export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

function getToken(): string | null {
  return localStorage.getItem('token')
}

function getRefreshToken(): string | null {
  return localStorage.getItem('refreshToken')
}

// Claves donde auth.store aparca la sesión del super admin mientras impersona.
// (duplicadas acá a propósito: services/ no puede importar stores/ sin ciclo)
const IMP_TOKEN = 'imp.adminToken'
const IMP_REFRESH = 'imp.adminRefreshToken'
const IMP_USER = 'imp.adminUser'

// Ruta real del listado de usuarios del super admin (router: '/admin' + 'users').
const SUPER_ADMIN_USERS_PATH = '/admin/users'

/**
 * Vuelve a la sesión del super admin. Se usa cuando el token de impersonación (que dura 2h y a
 * propósito NO tiene refresh) vence: la salida correcta es devolverlo a su propia cuenta, no
 * desloguearlo. Sin esto, dos horas dentro de la cuenta de un cliente terminaban en un logout sin
 * aviso —el admin perdía su sesión original, que seguía válida, tirada en el navegador—.
 * Devuelve true si había una sesión de admin que restaurar.
 */
function restoreAdminSession(): boolean {
  const adminToken = localStorage.getItem(IMP_TOKEN)
  if (!adminToken) return false
  const adminRefresh = localStorage.getItem(IMP_REFRESH)
  const adminUser = localStorage.getItem(IMP_USER)

  localStorage.setItem('token', adminToken)
  if (adminRefresh) localStorage.setItem('refreshToken', adminRefresh)
  else localStorage.removeItem('refreshToken')
  if (adminUser) localStorage.setItem('user', adminUser)
  else localStorage.removeItem('user')

  localStorage.removeItem(IMP_TOKEN)
  localStorage.removeItem(IMP_REFRESH)
  localStorage.removeItem(IMP_USER)
  return true
}

let _redirecting = false
function forceLogout() {
  if (_redirecting) return
  _redirecting = true
  // Si esto es una impersonación vencida, el 401 no es "se cayó la sesión": es "se acabó el rato
  // en la cuenta del cliente". Devolverlo a su propia cuenta con una carga completa, así el store
  // se rehidrata solo con el token del admin y no queda estado a medias.
  if (restoreAdminSession()) {
    location.href = SUPER_ADMIN_USERS_PATH
    return
  }
  localStorage.removeItem('token')
  localStorage.removeItem('refreshToken')
  localStorage.removeItem('user')
  // Sin esto quedaría una sesión de admin huérfana en el navegador después del logout.
  localStorage.removeItem(IMP_TOKEN)
  localStorage.removeItem(IMP_REFRESH)
  localStorage.removeItem(IMP_USER)
  // Evitar loop: no redirigir si ya estamos en /login
  if (!location.pathname.startsWith('/login')) {
    location.href = '/login'
  }
}

// --- Token refresh queue ---
let isRefreshing = false
let failedQueue: Array<{ resolve: (token: string) => void; reject: (err: unknown) => void }> = []

function processQueue(error: unknown, token: string | null) {
  failedQueue.forEach(({ resolve, reject }) => {
    if (error || !token) {
      reject(error)
    } else {
      resolve(token)
    }
  })
  failedQueue = []
}

const REFRESH_TIMEOUT_MS = 10_000
// Margen antes del `exp` del token para renovarlo proactivamente (1 min).
const TOKEN_EXPIRY_THRESHOLD_MS = 60_000

async function refreshAccessToken(): Promise<string> {
  const rt = getRefreshToken()
  if (!rt) throw new Error('No refresh token')

  // Timeout duro con AbortController: sin esto, una conexión TCP stale (laptop dormida,
  // red caída tras mucho idle) deja este fetch colgado indefinidamente. Como TODA request
  // 401 espera a que este refresh resuelva (isRefreshing + failedQueue), un refresh colgado
  // congela la app entera hasta un F5 — el `finally` que resetea isRefreshing nunca corre.
  // El abort garantiza que el await SIEMPRE termina (resuelve o rechaza).
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: rt }),
      signal: controller.signal,
    })
  } catch (e) {
    // AbortError (timeout) o fallo de red → refresh no pudo completarse.
    throw new Error(controller.signal.aborted ? 'Refresh timeout' : 'Refresh network error')
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) throw new Error('Refresh failed')

  const data = await res.json()
  const newToken = data.data?.token ?? data.token
  const newRefreshToken = data.data?.refreshToken ?? data.refreshToken

  if (!newToken || !newRefreshToken) throw new Error('Invalid refresh response')

  localStorage.setItem('token', newToken)
  localStorage.setItem('refreshToken', newRefreshToken)

  return newToken
}

// --- Refresh proactivo ---
// Renovar ANTES de que el token venza, así al volver a la pestaña tras mucho idle
// no se dispara el 401 reactivo (que, aun con timeout, mete un ida y vuelta y puede
// cortar la sesión). Decodifica el `exp` del JWT (base64url).
function tokenExpiresAt(token: string): number | null {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(b64)) as { exp?: number }
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null
  } catch {
    return null
  }
}

function tokenExpiringSoon(thresholdMs = TOKEN_EXPIRY_THRESHOLD_MS): boolean {
  const token = getToken()
  if (!token) return false
  const exp = tokenExpiresAt(token)
  if (exp === null) return false
  return exp - Date.now() < thresholdMs
}

// Comparte isRefreshing/failedQueue con el flujo del 401 → nunca corren dos refresh a la vez.
async function ensureFreshToken(): Promise<void> {
  if (isRefreshing || !getRefreshToken() || !tokenExpiringSoon()) return
  isRefreshing = true
  try {
    const newToken = await refreshAccessToken()
    processQueue(null, newToken)
  } catch (err) {
    processQueue(err, null)
  } finally {
    isRefreshing = false
  }
}

// Al recuperar foco la pestaña (tras idle/sleep), revalidar proactivamente el token.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void ensureFreshToken()
  })
}

/**
 * Rutas donde un 401 significa "no pudiste entrar", no "tu sesión venció":
 * login y alta pública. Todo lo demás sí es sesión caída.
 */
function isPublicAuthPath(path: string): boolean {
  return /\/(auth\/login|public\/)/.test(path)
}

// #659 — mismo problema que ya se había arreglado SOLO en refreshAccessToken() (ver comentario
// ahí): un `fetch` sin AbortController que cae sobre una conexión TCP colgada nunca resuelve ni
// rechaza. Acá lo sufría CUALQUIER pantalla del panel (ej. booking-engine: 3 GETs en Promise.all,
// uno se cuelga → el "● Cargando…" queda eterno, el catch que muestra el error nunca corre porque
// nunca llega a ejecutarse). Timeout generoso (no el de 10s del refresh) para no cortar de golpe
// una subida de archivo grande (foto/firma/video) en una conexión lenta pero viva.
const REQUEST_TIMEOUT_MS = 30_000

async function request<T>(method: string, path: string, body?: unknown, _isRetry = false): Promise<T> {
  // FormData (multipart): el browser setea el boundary; NO forzar Content-Type ni stringificar.
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData
  const headers: Record<string, string> = isFormData ? {} : { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  const url = path.startsWith('/api') ? path : `/api${path}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? (isFormData ? (body as FormData) : JSON.stringify(body)) : undefined,
      signal: controller.signal,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new ApiError(0, 'Tiempo de espera agotado. Revisá tu conexión e intentá de nuevo.')
    throw e
  } finally {
    clearTimeout(timer)
  }

  // Un 401 en las rutas públicas de acceso NO es una sesión vencida: es "no
  // pudiste entrar". Tratarlo como expiración pisaba el motivo real —el hotel
  // con la prueba terminada leía "Sesión expirada" en vez de que tenía que
  // contratar un plan— y encima disparaba un logout de una sesión inexistente.
  if (res.status === 401 && isPublicAuthPath(path)) {
    const raw = await res.json().catch(() => null)
    const errObj = (raw as any)?.error
    const msg = (typeof errObj === 'object' && errObj?.message) || (raw as any)?.error || (raw as any)?.message || 'No se pudo iniciar sesión'
    const err = new ApiError(401, msg)
    // El motivo permite al login ofrecer "ver planes" en vez de un error pelado.
    ;(err as any).reason = (typeof errObj === 'object' && errObj?.code) || ''
    throw err
  }

  if (res.status === 401 && !_isRetry) {
    // Si ya estamos refrestando, encolar esta request
    if (isRefreshing) {
      return new Promise<string>((resolve, reject) => {
        failedQueue.push({ resolve, reject })
      }).then((newToken) => {
        // Reintentar con el nuevo token
        const retryHeaders: Record<string, string> = isFormData ? {} : { 'Content-Type': 'application/json' }
        retryHeaders['Authorization'] = `Bearer ${newToken}`
        const retryController = new AbortController()
        const retryTimer = setTimeout(() => retryController.abort(), REQUEST_TIMEOUT_MS)
        return fetch(url, {
          method,
          headers: retryHeaders,
          body: body !== undefined ? (isFormData ? (body as FormData) : JSON.stringify(body)) : undefined,
          signal: retryController.signal,
        }).finally(() => clearTimeout(retryTimer))
      }).then(async (retryRes) => {
        if (!retryRes.ok) {
          const text = await retryRes.text()
          const raw = text ? JSON.parse(text) : null
          const errObj = raw?.error ?? raw
          const msg = (typeof errObj === 'object' && errObj?.message) || raw?.error || raw?.message || `Error ${retryRes.status}`
          throw new ApiError(retryRes.status, msg)
        }
        const text = await retryRes.text()
        const raw = text ? JSON.parse(text) : null
        if (raw && typeof raw === 'object' && 'success' in raw && 'data' in raw) {
          const pagination = (raw as any).meta?.pagination
          if (pagination && Array.isArray((raw as any).data)) {
            return { data: (raw as any).data, total: pagination.total ?? (raw as any).data.length } as unknown as T
          }
          return (raw as any).data as T
        }
        return raw as T
      }) as Promise<T>
    }

    // Intentar refresh
    isRefreshing = true
    try {
      const newToken = await refreshAccessToken()
      processQueue(null, newToken)
      // Reintentar la request original con el nuevo token
      return request<T>(method, path, body, true)
    } catch (refreshError) {
      processQueue(refreshError, null)
      forceLogout()
      throw new ApiError(401, 'Sesión expirada')
    } finally {
      isRefreshing = false
    }
  }

  if (res.status === 401) {
    forceLogout()
    throw new ApiError(401, 'Sesión expirada')
  }

  const text = await res.text()

/**
 * Un VALIDATION_ERROR del framework trae `message: "Validation error"` y el
 * detalle real en `details.fields` ({ password: ["Minimum 10 characters"] }).
 * Mostrar solo el `message` deja al usuario con "Validation error" y sin saber
 * qué campo corregir, así que se le pega el detalle.
 *
 * Se ignora el detalle cuando el mensaje ya es específico: los usecases del
 * proyecto responden en español y esos textos ganan.
 */
function withFieldDetail(message: string, errObj: unknown): string {
  const fields = (errObj as { details?: { fields?: Record<string, string[]> } })?.details?.fields
  if (!fields || typeof fields !== 'object') return message
  if (!/^validation error$/i.test(String(message).trim())) return message

  const parts = Object.entries(fields)
    .map(([field, msgs]) => `${field}: ${(Array.isArray(msgs) ? msgs : [String(msgs)]).join(', ')}`)
  return parts.length ? parts.join(' · ') : message
}

  // Detect HTML response (backend error page / redirect)
  if (text && text.trimStart().startsWith('<')) {
    throw new ApiError(res.status, `El servidor respondió HTML en vez de JSON (HTTP ${res.status}). Verificá que el backend esté corriendo en el puerto correcto.`)
  }

  const raw = text ? JSON.parse(text) : null

  if (!res.ok) {
    // El framework envuelve errores en { success, error }; server.ts usa { error }
    const errObj = raw?.error ?? raw
    const msg = (typeof errObj === 'object' && errObj?.message) || raw?.error || raw?.message || `Error ${res.status}`
    throw new ApiError(res.status, withFieldDetail(msg, errObj))
  }

  // Envelope del framework arckode: { success, data, meta, error }
  if (raw && typeof raw === 'object' && 'success' in raw && 'data' in raw) {
    // Lista paginada: el framework pone el array en `data` y el total en `meta.pagination`
    const pagination = (raw as any).meta?.pagination
    if (pagination && Array.isArray((raw as any).data)) {
      return { data: (raw as any).data, total: pagination.total ?? (raw as any).data.length } as unknown as T
    }
    return (raw as any).data as T
  }

  return raw as T
}

export const http = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
  /** Descarga binaria (PDF, etc.) con el mismo token JWT. Devuelve Blob para descarga/preview. */
  async getBlob(path: string): Promise<Blob> {
    const headers: Record<string, string> = {}
    const token = getToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
    const url = path.startsWith('/api') ? path : `/api${path}`
    const res = await fetch(url, { method: 'GET', headers })
    if (res.status === 401) { forceLogout(); throw new ApiError(401, 'Sesión expirada') }
    if (!res.ok) throw new ApiError(res.status, `Error ${res.status} al descargar`)
    return res.blob()
  },
}
