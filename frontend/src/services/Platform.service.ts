import { http } from './http'

interface List { data: any[]; total: number }

/**
 * Credenciales de la APP de Meta, a nivel plataforma. Distintas de las de cada hotel: este secreto
 * firma los webhooks de TODOS los hoteles, por eso vive acá y nunca se devuelve en claro.
 */
export interface MetaAppEstado {
  appId: string
  graphVersion: string
  configurado: boolean
  /** De dónde sale el que se usa. El entorno gana sobre el panel. */
  origen: 'entorno' | 'panel' | null
  /** Últimos caracteres, para reconocer cuál está puesto sin revelarlo. */
  pista: string | null
  /** Sin cifrado configurado en el servidor, esta pantalla no puede guardar. */
  puedeGuardar: boolean
}

/** Estado de la API key de Resend. `last4` sirve para reconocer cuál está cargada sin revelarla. */
export interface ResendEstado { configured: boolean; last4: string | null }

/**
 * #102: estado de un servicio de plataforma. `source` null ⇔ `configured` false. El backend
 * NUNCA manda el valor ni una pista (ni últimos 4, ni máscara): solo si está y de dónde sale.
 */
export interface ServicioEstado { configured: boolean; source: 'env' | 'configuration' | null }
export type ServicioClave =
  | 'stripe' | 'stripeWebhook' | 'turnstile' | 'publicUrl' | 'metaApp'
  | 'resend' | 'smtp' | 'googleMaps' | 'channex'
export type SettingsStatus = Record<ServicioClave, ServicioEstado>

export const PlatformService = {
  /** Estado de las credenciales de la app de Meta. NUNCA devuelve el secreto. */
  getMetaWhatsapp: () => http.get<MetaAppEstado>('/admin/meta-whatsapp'),
  /** Guarda el secreto cifrado. El del servidor (.env) sigue teniendo prioridad. */
  saveMetaWhatsapp: (data: { appId?: string; appSecret: string }) =>
    http.put<MetaAppEstado>('/admin/meta-whatsapp', data),

  // #100: API key de Resend (respaldo cuando no hay SMTP). Solo estado: la key nunca vuelve.
  getResend: () => http.get<ResendEstado>('/admin/settings/resend'),
  saveResend: (apiKey: string) => http.put<ResendEstado>('/admin/settings/resend', { apiKey }),
  deleteResend: () => http.delete<ResendEstado>('/admin/settings/resend'),
  // #102: qué servicios están configurados y desde dónde (env | panel). Solo lectura, sin secretos.
  getSettingsStatus: () => http.get<SettingsStatus>('/admin/settings/status'),

  subscriptions: () => http.get<any>('/admin/subscriptions'),
  // Auditoría extraída a AuditLogService (services/AuditLog.service.ts) — M45 #313
  monitoring: () => http.get<any>('/admin/monitoring'),
  announcements: () => http.get<List>('/admin/announcements'),
  apiKeys: (hotelId?: string) => http.get<List>(`/api-keys${hotelId ? `?hotelId=${hotelId}` : ''}`),
  anuncios: () => http.get<List>('/anuncios'),
  users: (hotelId?: string) => http.get<List>(`/users${hotelId ? `?hotelId=${hotelId}` : ''}`),
  // SMTP-UI (2026-08-19): test REAL de la config de correo — envío directo, devuelve el
  // provider usado o el error verdadero de SMTP/Resend.
  testEmail: (to: string) => http.post<{ provider: string; message: string }>('/admin/email/test', { to }),
}

import { http as _http } from './http'
export const ConfigService = {
  get: async (key: string, hotelId?: string): Promise<any> => {
    const q = hotelId ? `?hotelId=${hotelId}` : ''
    const r = await _http.get<{ valor: any }>(`/configuracion/${key}${q}`)
    return r.valor
  },
  set: async (key: string, value: any, hotelId?: string): Promise<void> => {
    await _http.post('/configuracion', { clave: key, valor: value, hotelId: hotelId || 'platform' })
  },
}

// Contactos de emergencia — LECTURA solo-login (cualquier usuario del hotel, incluido
// housekeeper/supervisor/maintenance, que no tienen `settings:view`). El hotel lo resuelve
// el backend desde el token. La EDICIÓN sigue por ConfigService.set (`settings:edit`).
//
// #636: `EmergencyButton.vue` vive dentro de `CommandCenterHeader`, que se desmonta y remonta
// cada vez que se cruza hacia/desde `/panel/dashboard` (dos árboles de componentes distintos —
// AppHeader vs la barra propia del dashboard, ver `AdminLayout.vue` `v-if="!isCommandCenter"`).
// Sin cache, cada cruce vuelve a pedir un dato que casi nunca cambia en una sesión. TTL corto
// (no infinito: si el admin edita los contactos desde /panel/settings, se refleja en <5 min sin
// necesitar un F5 duro).
const CACHE_TTL_MS = 5 * 60_000
let cached: { value: any; at: number } | null = null

export const EmergencyContactsService = {
  get: async (): Promise<any> => {
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value
    const r = await _http.get<{ valor: any }>('/contactos-emergencia')
    cached = { value: r.valor, at: Date.now() }
    return r.valor
  },
  /** Invalidar tras editar desde settings — evita que el header siga mostrando datos viejos. */
  invalidate: (): void => { cached = null },
}

// Módulos del producto (activar/desactivar). Admin edita; el panel del hotel lee para filtrar su menú.
// Un módulo puede tener submódulos (entradas hijas del menú) que se togglean por separado.
export interface SubModuleMeta { key: string; label: string; description: string }
export interface ModuleMeta { key: string; label: string; description: string; submodules?: SubModuleMeta[] }
export type ModuleState = Record<string, boolean>
// Catálogo módulo→sub-módulos para el EDITOR DE PLANES (claves + labels en español, sin
// description). Fuente única: el backend lo proyecta del mismo MODULE_CATALOG que lee el
// gate — la lista NO se duplica en el frontend.
export interface CatalogChildDTO { key: string; label: string; description: string }
export interface CatalogModuleDTO { key: string; label: string; description: string; children: CatalogChildDTO[] }
export const ModulesService = {
  adminGet: () => _http.get<{ catalog: ModuleMeta[]; state: ModuleState }>('/admin/modules'),
  catalog: () => _http.get<CatalogModuleDTO[]>('/admin/modules/catalog'),
  adminSave: (state: ModuleState) => _http.put<{ state: ModuleState }>('/admin/modules', { state }),
  enabled: () => _http.get<{ state: ModuleState }>('/modules'),
}

// Gestión de hoteles a nivel PLATAFORMA (super_admin). Asignar plan, estado y datos de cualquier hotel.
// El `plan` se valida contra la tabla de planes en el backend.
export const HotelAdminService = {
  update: (id: string, patch: { plan?: string; status?: string; name?: string; email?: string; phone?: string; location?: string }) =>
    _http.put<any>(`/admin/hoteles/${id}`, patch),
}

// Excepciones de módulos por hotel (bonos/trials/revocaciones). #568
// enabled = fuerza ON aunque el plan no lo incluya (bono/trial). disabled = fuerza OFF.
// endsAt null = permanente; con fecha = trial que vence.
export interface ModuleOverrideDTO {
  id: string
  hotelId: string
  moduleKey: string
  status: 'enabled' | 'disabled'
  reason: string
  grantedByUserId?: string
  startsAt?: string
  endsAt?: string
  createdAt?: string
  updatedAt?: string
}

export const HotelModuleOverridesService = {
  list: (hotelId: string) =>
    _http.get<ModuleOverrideDTO[]>(`/admin/hotels/${hotelId}/module-overrides`),
  upsert: (hotelId: string, body: {
    moduleKey: string
    status: 'enabled' | 'disabled'
    reason?: string
    startsAt?: string
    endsAt?: string
  }) =>
    _http.post<ModuleOverrideDTO>(`/admin/hotels/${hotelId}/module-overrides`, body),
  remove: (hotelId: string, id: string) =>
    _http.delete<void>(`/admin/hotels/${hotelId}/module-overrides/${id}`),
}

// Cuenta Channex a nivel PLATAFORMA (white-label). Solo super_admin. La API key nunca vuelve cruda.
export interface ChannexStatus { environment: string; hasKey: boolean; keyMasked: string; channexUserId: string }
export const ChannexAdminService = {
  status: () => _http.get<ChannexStatus>('/admin/channex-config'),
  save: (patch: { apiKey?: string; environment?: string; channexUserId?: string }) => _http.put<ChannexStatus>('/admin/channex-config', patch),
  test: () => _http.post<{ success: boolean; message: string; environment: string }>('/admin/channex-config/test'),
}
