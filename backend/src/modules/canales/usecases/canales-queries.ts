function safeParse(v: any) { if (typeof v !== 'string') return v; try { return JSON.parse(v) } catch { return v } }

/**
 * La config Channex de PLATAFORMA. Es un solo objeto json: además de las credenciales guarda el
 * secreto del webhook de reservas y el id del callback registrado (#50), que son de la cuenta
 * entera y no de un hotel. `setPlatformChannex` mergea, así que cada campo se escribe por separado.
 */
export interface PlatformChannexConfig {
  apiKey?: string
  environment?: string
  webhookSecret?: string
  webhookId?: string
  channexUserId?: string
}

export class CanalesQueries {
  constructor(private readonly orm: any) {}

  /** Escape hatch: expone el orm para usecases que operan sobre múltiples modelos (booking-sync). */
  getOrm(): any { return this.orm }

  async findMany(model: string, query: any): Promise<any[]> {
    return this.orm.findMany(model, query)
  }

  async resolveHotelId(hotelId?: string): Promise<string | undefined> {
    if (hotelId) return hotelId
    return ((await this.orm.findMany('Hotels', {}))[0] as any)?.id
  }

  async getSyncLog(hotelId?: string): Promise<any[]> {
    const rows = await this.orm.findMany('Configuration', { hotelId: hotelId || 'platform', key: 'channex_sync_log' })
    const raw = (rows[0] as any)?.value; return raw ? JSON.parse(raw) : []
  }

  async getOTACatalog(): Promise<any[]> {
    try {
      // `key` (no `clave`): el modelo Configuration usa `key`; con `clave` el ORM descartaba el filtro
      // (campo inexistente) y traía la 1ª config del platform → catálogo siempre vacío. Fix.
      const rows = await this.orm.findMany('Configuration', { hotelId: 'platform', key: 'canales_ota' })
      const cfg = (rows as any[])?.[0]
      if (!cfg) return []
      const val = typeof cfg.value === 'string' ? JSON.parse(cfg.value) : cfg.value
      return Array.isArray(val) ? val : []
    } catch { return [] }
  }

  // ─── Credenciales Channex a nivel PLATAFORMA (white-label: una cuenta para todos los hoteles) ──
  // Se guardan en configuration(hotelId='platform', key='channex') = { apiKey, environment }, más
  // lo que el webhook de reservas necesita a nivel cuenta (#50): ver PlatformChannexConfig.
  async getPlatformChannex(): Promise<PlatformChannexConfig | null> {
    try {
      const rows = await this.orm.findMany('Configuration', { hotelId: 'platform', key: 'channex' })
      const row = (rows as any[])?.[0]
      if (!row) return null
      const v = typeof row.value === 'string' ? JSON.parse(row.value) : row.value
      return v && typeof v === 'object' && !Array.isArray(v) ? v : null
    } catch { return null }
  }

  async setPlatformChannex(patch: PlatformChannexConfig): Promise<void> {
    const rows = await this.orm.findMany('Configuration', { hotelId: 'platform', key: 'channex' })
    const row = (rows as any[])?.[0]
    const cur = row ? (typeof row.value === 'string' ? JSON.parse(row.value) : row.value) : {}
    const value = { ...(cur && typeof cur === 'object' ? cur : {}), ...patch }
    if (row) await this.orm.update('Configuration', row.id, { value })
    else await this.orm.create('Configuration', { id: crypto.randomUUID(), hotelId: 'platform', key: 'channex', value })
  }

  // ─── Datos de la CUENTA Channex que NO vienen de la API ───────────────
  // El vencimiento del plan es el ejemplo: Channex no lo expone, y cuando se vence deja de
  // entrar el feed de reservas. Vivía solo en la cabeza de quien contrató la cuenta. Va en su
  // propia clave (`channex_account`) y no en `channex` para no mezclar dato operativo con
  // credenciales: esta la lee y la escribe la tarjeta del panel, la otra el cliente HTTP.
  async getChannexAccount(): Promise<{ planExpiresAt?: string }> {
    try {
      const rows = await this.orm.findMany('Configuration', { hotelId: 'platform', key: 'channex_account' })
      const row = (rows as any[])?.[0]
      if (!row) return {}
      const v = typeof row.value === 'string' ? JSON.parse(row.value) : row.value
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
    } catch { return {} }
  }

  async setChannexAccount(patch: { planExpiresAt?: string }): Promise<void> {
    const rows = await this.orm.findMany('Configuration', { hotelId: 'platform', key: 'channex_account' })
    const row = (rows as any[])?.[0]
    const cur = row ? (typeof row.value === 'string' ? JSON.parse(row.value) : row.value) : {}
    const value = { ...(cur && typeof cur === 'object' ? cur : {}), ...patch }
    if (row) await this.orm.update('Configuration', row.id, { value })
    else await this.orm.create('Configuration', { id: crypto.randomUUID(), hotelId: 'platform', key: 'channex_account', value })
  }

  // ─── Mapping persistente local↔Channex (P6) ──────────────────────────
  // Mismo patrón que setPlatformChannex: el queries encapsula el orm, el service no lo toca.

  async readChannelMappings(hotelId: string): Promise<any[]> {
    return this.orm.findMany('ChannelMapping', { hotelId })
  }

  async upsertChannelMapping(hotelId: string, entry: { kind: string; localId: string; channexId: string }): Promise<void> {
    const row = ((await this.orm.findMany('ChannelMapping', { hotelId, kind: entry.kind, localId: entry.localId })) as any[])?.[0]
    if (row) {
      if (row.channexId !== entry.channexId) await this.orm.update('ChannelMapping', row.id, { channexId: entry.channexId })
    } else {
      await this.orm.create('ChannelMapping', { id: crypto.randomUUID(), hotelId, kind: entry.kind, localId: entry.localId, channexId: entry.channexId })
    }
  }
}
