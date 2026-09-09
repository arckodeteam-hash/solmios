// canales/service-channex-admin.ts — Configuración de la cuenta Channex a nivel PLATAFORMA.
// White-label: UNA cuenta Channex (API key) para todos los hoteles, seteada por el super_admin desde
// Admin → Integraciones. Separado de CanalesService (que es por-hotel) para no volverlo un God Object
// y porque estas rutas son admin-only. NUNCA devuelve la key cruda hacia afuera.

import type { ConfigUseCase } from './usecases/config'
import type { ChannexUseCase } from './usecases/channex'

export interface ChannexPlatformStatus { environment: string; hasKey: boolean; keyMasked: string; channexUserId: string }

/** Enmascara la API key para mostrarla sin filtrarla (4 primeros + 4 últimos). */
function maskKey(k?: string): string {
  if (!k) return ''
  return k.length <= 8 ? '••••' : `${k.slice(0, 4)}••••${k.slice(-4)}`
}

export class ChannexAdminService {
  constructor(
    private readonly config: ConfigUseCase,
    private readonly channex: ChannexUseCase,
  ) {}

  async getStatus(): Promise<ChannexPlatformStatus> {
    const p = await this.config.getPlatformChannex()
    return { environment: p?.environment === 'production' ? 'production' : 'staging', hasKey: !!p?.apiKey, keyMasked: maskKey(p?.apiKey), channexUserId: p?.channexUserId || '' }
  }

  /**
   * Guarda credenciales. apiKey vacío = NO se toca la existente (permite cambiar solo el entorno sin
   * reescribir la key, y evita borrarla desde un form que nunca muestra la key cruda). Misma
   * disciplina para `channexUserId` (el id de nuestra propia cuenta Channex, que el webhook usa para
   * descartar los eventos que originamos nosotros): vacío o ausente NO pisa el ya guardado.
   */
  async save(patch: { apiKey?: string; environment?: string; channexUserId?: string }): Promise<ChannexPlatformStatus> {
    const toSave: { apiKey?: string; environment?: string; channexUserId?: string } = {}
    if (patch.environment === 'production' || patch.environment === 'staging') toSave.environment = patch.environment
    if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) toSave.apiKey = patch.apiKey.trim()
    if (typeof patch.channexUserId === 'string' && patch.channexUserId.trim()) toSave.channexUserId = patch.channexUserId.trim()
    await this.config.setPlatformChannex(toSave)
    return this.getStatus()
  }

  test(): Promise<{ success: boolean; message: string; environment: string }> {
    return this.channex.testApiKey()
  }
}
