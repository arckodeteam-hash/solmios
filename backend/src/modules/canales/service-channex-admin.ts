// canales/service-channex-admin.ts — Configuración y SALUD de la cuenta Channex de PLATAFORMA.
// White-label: UNA cuenta Channex (API key) para todos los hoteles, seteada por el super_admin desde
// Admin → Integraciones. Separado de CanalesService (que es por-hotel) para no volverlo un God Object
// y porque estas rutas son admin-only. NUNCA devuelve la key cruda hacia afuera.
//
// La tarjeta mostraba tres campos (key, entorno, user id) y nada más. Todo lo que hace falta para
// operar de verdad —si el webhook de reservas está registrado, cuántas properties tiene la cuenta
// contra cuántos hoteles las usan, y cuándo vence el plan— había que ir a buscarlo al dashboard de
// Channex o a la memoria de quien contrató la cuenta. El plan venció el 2026-09-09 y ninguna
// pantalla lo dijo: la ingesta de reservas se corta y el síntoma es "no entran reservas".

import type { ConfigUseCase } from './usecases/config'
import type { ChannexUseCase } from './usecases/channex'
import type { CanalesQueries } from './usecases/canales-queries'
import { channexDashboardUrl } from './usecases/channel-requests-admin'

export interface ChannexOrphanProperty { id: string; title: string }

export interface ChannexPlatformStatus {
  environment: string
  hasKey: boolean
  keyMasked: string
  channexUserId: string
  /** Raíz del dashboard del entorno configurado (staging vs producción son cuentas distintas). */
  dashboardUrl: string
  webhook: { registered: boolean; callbackUrl: string; error?: string }
  properties: {
    inAccount: number
    hotelsWithProperty: number
    orphans: ChannexOrphanProperty[]
    error?: string
  }
  /** Vencimiento del plan, cargado a mano: Channex no lo expone por API. */
  planExpiresAt: string
  /** Días que faltan (negativo = vencido). `null` si no está cargado. */
  planDaysLeft: number | null
  planExpired: boolean
}

/** A cuántos días del vencimiento se pinta la alerta roja. */
export const CHANNEX_PLAN_WARNING_DAYS = 15
const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Enmascara la API key para mostrarla sin filtrarla (4 primeros + 4 últimos). */
function maskKey(k?: string): string {
  if (!k) return ''
  return k.length <= 8 ? '••••' : `${k.slice(0, 4)}••••${k.slice(-4)}`
}

/**
 * Días hasta el vencimiento, contados por DÍA calendario y no por milisegundos: un plan que vence
 * "hoy a las 00:00" tiene que dar 0 (vence hoy), no -1 (vencido hace un rato).
 */
export function planDaysLeft(planExpiresAt: string, now: Date = new Date()): number | null {
  const ts = Date.parse(planExpiresAt)
  if (!planExpiresAt || Number.isNaN(ts)) return null
  const vence = new Date(ts)
  const a = Date.UTC(vence.getUTCFullYear(), vence.getUTCMonth(), vence.getUTCDate())
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((a - b) / MS_PER_DAY)
}

export class ChannexAdminService {
  constructor(
    private readonly config: ConfigUseCase,
    private readonly channex: ChannexUseCase,
    /** Lecturas que no son de la API de Channex: properties de los hoteles y datos de la cuenta. */
    private readonly queries?: CanalesQueries,
  ) {}

  /**
   * `callbackUrl` lo arma la ruta (necesita el host del request). Sin él, "registrado" se decide
   * por si la cuenta tiene ALGÚN webhook apuntando a nuestro endpoint, que es la pregunta real.
   */
  async getStatus(callbackUrl = '', now: Date = new Date()): Promise<ChannexPlatformStatus> {
    const p = await this.config.getPlatformChannex()
    const environment = p?.environment === 'production' ? 'production' : 'staging'
    const account = this.queries ? await this.queries.getChannexAccount() : {}
    const planExpiresAt = String(account.planExpiresAt || '')
    const dias = planDaysLeft(planExpiresAt, now)

    const base: ChannexPlatformStatus = {
      environment,
      hasKey: !!p?.apiKey,
      keyMasked: maskKey(p?.apiKey),
      channexUserId: p?.channexUserId || '',
      dashboardUrl: channexDashboardUrl(environment),
      webhook: { registered: false, callbackUrl },
      properties: { inAccount: 0, hotelsWithProperty: 0, orphans: [] },
      planExpiresAt,
      planDaysLeft: dias,
      planExpired: dias !== null && dias < 0,
    }
    // Sin credencial no hay nada que consultar y Channex tiraría en cada llamada: la tarjeta tiene
    // que abrir igual para que el admin pueda CARGAR la key.
    if (!base.hasKey) return base

    const [webhook, properties] = await Promise.all([
      this.readWebhookState(callbackUrl),
      this.readProperties(),
    ])
    return { ...base, webhook: { ...base.webhook, ...webhook }, properties }
  }

  /**
   * ¿La cuenta tiene registrado NUESTRO callback de reservas? Un error de Channex no puede tumbar
   * la tarjeta (misma regla que `GET /api/admin/channex-webhook`): viaja en el body.
   */
  private async readWebhookState(callbackUrl: string): Promise<{ registered: boolean; error?: string }> {
    try {
      const webhooks = await this.channex.listWebhooks('')
      const esperado = callbackUrl.split('?')[0] || ''
      const registered = webhooks.some((w) => {
        const url = String(w.callbackUrl || '').split('?')[0]
        return esperado ? url === esperado : url.includes('/channex/webhook')
      })
      return { registered }
    } catch (e: any) {
      return { registered: false, error: e?.message || String(e) }
    }
  }

  /** Properties de la cuenta vs hoteles que las usan. Lo que sobra son huérfanas. */
  private async readProperties(): Promise<ChannexPlatformStatus['properties']> {
    try {
      const [enCuenta, configs] = await Promise.all([
        this.channex.listProperties(),
        this.queries ? this.queries.findMany('Canales', {}) : Promise.resolve([]),
      ])
      const usadas = new Set(
        (configs as any[]).map((c) => String(c?.channexPropertyId || '')).filter(Boolean),
      )
      return {
        inAccount: enCuenta.length,
        hotelsWithProperty: usadas.size,
        orphans: enCuenta.filter((prop) => !usadas.has(prop.id)),
      }
    } catch (e: any) {
      return { inAccount: 0, hotelsWithProperty: 0, orphans: [], error: e?.message || String(e) }
    }
  }

  /**
   * Guarda credenciales. apiKey vacío = NO se toca la existente (permite cambiar solo el entorno sin
   * reescribir la key, y evita borrarla desde un form que nunca muestra la key cruda). Misma
   * disciplina para `channexUserId` (el id de nuestra propia cuenta Channex, que el webhook usa para
   * descartar los eventos que originamos nosotros): vacío o ausente NO pisa el ya guardado.
   *
   * `planExpiresAt` es la excepción: se puede BORRAR mandando cadena vacía, porque es un dato que el
   * admin carga a mano y puede haberse equivocado (y una fecha falsa dispara alarmas falsas).
   */
  async save(patch: { apiKey?: string; environment?: string; channexUserId?: string; planExpiresAt?: string }): Promise<ChannexPlatformStatus> {
    const toSave: { apiKey?: string; environment?: string; channexUserId?: string } = {}
    if (patch.environment === 'production' || patch.environment === 'staging') toSave.environment = patch.environment
    if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) toSave.apiKey = patch.apiKey.trim()
    if (typeof patch.channexUserId === 'string' && patch.channexUserId.trim()) toSave.channexUserId = patch.channexUserId.trim()
    await this.config.setPlatformChannex(toSave)
    if (typeof patch.planExpiresAt === 'string' && this.queries) {
      await this.queries.setChannexAccount({ planExpiresAt: patch.planExpiresAt.trim() })
    }
    return this.getStatus()
  }

  test(): Promise<{ success: boolean; message: string; environment: string }> {
    return this.channex.testApiKey()
  }
}
