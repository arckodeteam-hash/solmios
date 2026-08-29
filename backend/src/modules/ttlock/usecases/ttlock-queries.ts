import { DEFAULT_ADD_TYPE } from '../../../services/ttlock-client'

function safeParse(v: any) { if (typeof v !== 'string') return v; try { return JSON.parse(v) } catch { return v } }

export class TtlockQueries {
  constructor(private readonly orm: any) {}

  async getConfig(hotelId: string): Promise<any> {
    const cfg = (await this.orm.findMany('Configuration', { hotelId, key: 'ttlock_config' }))[0] as any
    const parsed = cfg ? safeParse(cfg.value) : {}
    return {
      clientId: parsed?.clientId || '', username: parsed?.username || '',
      region: parsed?.region || 'eu', accountId: parsed?.accountId || '',
      addType: Number(parsed?.addType) || DEFAULT_ADD_TYPE,
      // El secret y el password NUNCA se devuelven. Pero la UI necesita saber que EXISTEN,
      // sino los inputs se ven vacíos al recargar y parece que la config no se guardó.
      hasSecret: !!parsed?.clientSecret, hasPassword: !!parsed?.password,
      configured: !!(parsed?.clientId && parsed?.clientSecret), connected: !!parsed?.accessToken,
    }
  }

  async updateConfig(hotelId: string, body: any): Promise<void> {
    const cfg = await this.orm.findMany('Configuration', { hotelId, key: 'ttlock_config' }) as any[]
    const prev = cfg[0] ? safeParse(cfg[0].value) : {}
    const keep = (k: string): string => (body[k] === undefined || body[k] === '') ? (prev[k] ?? '') : body[k]
    const value = JSON.stringify({
      clientId: keep('clientId'), clientSecret: keep('clientSecret'),
      username: keep('username'), password: keep('password'),
      region: body.region ?? prev.region ?? 'eu',
      accountId: body.accountId ?? prev.accountId ?? '',
      addType: Number(body.addType ?? prev.addType) || DEFAULT_ADD_TYPE,
      accessToken: keep('accessToken'), refreshToken: keep('refreshToken'),
    })
    if (cfg.length > 0) await this.orm.update('Configuration', cfg[0].id, { value })
    else await this.orm.create('Configuration', { id: crypto.randomUUID(), hotelId, key: 'ttlock_config', value })
  }

  /** Códigos del hotel, más nuevos primero. Sin esto la tabla de la UI queda siempre vacía. */
  async listCodesByHotel(hotelId: string): Promise<any[]> {
    const codes = await this.orm.findMany('LockCodes', { hotelId }) as any[]
    return codes.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
  }

  async connectConfig(hotelId: string, body: any, getAccessToken: Function): Promise<void> {
    const cfg = await this.orm.findMany('Configuration', { hotelId, key: 'ttlock_config' }) as any[]
    const prev = cfg[0] ? safeParse(cfg[0].value) : {}
    const creds = {
      clientId: body.clientId || prev.clientId, clientSecret: body.clientSecret || prev.clientSecret,
      username: body.username || prev.username, password: body.password || prev.password,
      region: body.region || prev.region || 'eu',
    }
    const tokens = await getAccessToken(creds)
    const value = JSON.stringify({ ...prev, ...creds, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken || prev.refreshToken })
    if (cfg.length > 0) await this.orm.update('Configuration', cfg[0].id, { value })
    else await this.orm.create('Configuration', { id: crypto.randomUUID(), hotelId, key: 'ttlock_config', value })
  }

  async getRoomsByHotel(hotelId: string): Promise<any[]> {
    return this.orm.findMany('Rooms', { hotelId }) as any[]
  }

  async getTtlockConfig(hotelId: string): Promise<any> {
    const cfg = (await this.orm.findMany('Configuration', { hotelId, key: 'ttlock_config' }))[0] as any
    return cfg ? safeParse(cfg.value) : {}
  }

  async findReservationById(reservationId: string): Promise<any> {
    return (await this.orm.findMany('Reservations', { id: reservationId }))[0] || null
  }

  /** Registro del hotel: aporta `checkIn`/`checkOut`/`timezone` a la ventana del código (2026-08-29). */
  async findHotelById(hotelId: string): Promise<any> {
    return (await this.orm.findMany('Hotels', { id: hotelId }))[0] || null
  }
}
