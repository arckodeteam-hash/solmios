import { http } from './http'

interface List { data: any[]; total: number }

export const PlatformService = {
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
export interface ChannexStatus { environment: string; hasKey: boolean; keyMasked: string }
export const ChannexAdminService = {
  status: () => _http.get<ChannexStatus>('/admin/channex-config'),
  save: (patch: { apiKey?: string; environment?: string }) => _http.put<ChannexStatus>('/admin/channex-config', patch),
  test: () => _http.post<{ success: boolean; message: string; environment: string }>('/admin/channex-config/test'),
}
