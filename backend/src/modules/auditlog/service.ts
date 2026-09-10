// auditlog/service.ts — Facade pública del módulo
// Append-only: create y read. Sin update ni delete.

import type { RepositoryAdapter, Logger, CacheAdapter, Auth } from 'arckode-framework'
import { NotFoundError } from 'arckode-framework'
import type { AuditlogDTO, CreateAuditlogDTO, AuditlogQuery, AuditlogPaginated } from './types'
import type { AuditlogSockets } from './sockets'
import { currentRequestContext } from '../../shared/request-context'

export interface AuditlogUser { id: string; hotelId?: string | null; role?: string }

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 20

export class AuditlogService {
  private sockets: AuditlogSockets = {}

  constructor(
    private readonly repo: RepositoryAdapter<AuditlogDTO>,
    private readonly userRepo: RepositoryAdapter<any>,
    private readonly hotelRepo: RepositoryAdapter<any>,
    private readonly logger: Logger,
    private readonly cache: CacheAdapter,
    private readonly auth: Auth,
  ) {}

  setSockets(s: Partial<AuditlogSockets>): void {
    const next = s as Record<string, any>
    const cur = this.sockets as Record<string, any>
    for (const key of Object.keys(next)) {
      const h = next[key]
      if (!h) continue
      const prev = cur[key]
      cur[key] = prev
        ? async (...a: any[]) => {
            try { await prev(...a) } catch (e) { this.logger.error(`Socket chain error [${key}]`, e as any) }
            await h(...a)
          }
        : h
    }
  }

  async list(query?: AuditlogQuery): Promise<AuditlogPaginated> {
    this.logger.info('Listando auditlog', { query })

    const page = Math.max(1, Math.floor(Number(query?.page) || 1))
    const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(query?.limit) || DEFAULT_LIMIT)))
    const offset = (page - 1) * limit
    const filters: Record<string, unknown> = {}

    if (query?.hotelId !== undefined) filters.hotelId = query.hotelId
    if (query?.status !== undefined) filters.status = query.status
    if (query?.type !== undefined) filters.type = query.type
    if (query?.category !== undefined) filters.category = query.category
    // M3 (qa-ui config-2026-08-22): igualdad soportada por buildWhere → van al WHERE.
    if (query?.userId) filters.userId = query.userId
    if (query?.action) filters.action = query.action

    // El listado NO se cachea: es un log forense y la frescura es un requisito, no un lujo — un
    // admin revisando un incidente tiene que ver las entradas al instante, no con delay. (Antes se
    // cacheaba con TTL 60_000: ese arg son SEGUNDOS → 16,6 h, y la invalidación por clave fija
    // `auditlog:list` nunca matcheaba las claves reales `auditlog:list:${page}:...`.)
    //
    // Orden explícito createdAt DESC: sin ORDER BY la paginación es orden no definido (en PG
    // cambia entre queries) — página 1 = lo más reciente, como todo listado del panel.
    const orderBy = [{ field: 'createdAt', dir: 'DESC' as const }]

    // `hotelName`: antes se devolvía la fila cruda, sin el nombre del hotel, y la columna y el
    // filtro "Hotel" de /admin/audit salían vacíos aunque el registro tuviera `hotelId`. Se
    // resuelve con un `Map` de hoteles cargado UNA vez (mismo patrón que `listUsers` de admin);
    // una consulta por fila adentro del loop sería N+1. Sin `hotelId` (o con uno huérfano —
    // hotel borrado) queda ''.
    const hotels = await this.hotelRepo.findMany({})
    const hotelNameById = new Map(hotels.map((h: any) => [h.id, h.name]))
    const withHotelName = (r: AuditlogDTO): AuditlogDTO =>
      ({ ...r, hotelName: (r.hotelId && hotelNameById.get(r.hotelId)) || '' })

    // Rango de fechas: buildWhere solo hace igualdad (RepositoryAdapter no soporta >=/<=, mismo
    // límite que DT-07 de facturas) → traer las filas del hotel, filtrar en memoria y paginar acá.
    // Es O(n) sobre el log del hotel, correcto y aceptable para el volumen actual (2k filas dev).
    if (query?.from || query?.to) {
      const from = query.from ? `${query.from}T00:00:00.000Z` : ''
      const to = query.to ? `${query.to}T23:59:59.999Z` : ''
      const all = await this.repo.findMany(filters, { orderBy })
      const rows = all.filter((r) => {
        const ts = String(r.createdAt || '')
        return (!from || ts >= from) && (!to || ts <= to)
      })
      return { data: rows.slice(offset, offset + limit).map(withHotelName), total: rows.length }
    }

    const result = await this.repo.paginate(filters, { limit, offset, orderBy })
    return { data: result.data.map(withHotelName), total: result.total }
  }

  async getById(id: string, user: AuditlogUser): Promise<AuditlogDTO> {
    this.logger.info('Obteniendo auditlog', { id })
    const item = await this.repo.findById(id)
    if (!item) throw new NotFoundError('Auditlog no encontrado')
    // IDOR (REGLA #9): el log debe pertenecer al hotel del usuario.
    const me = await this.userRepo.findById(user.id)
    this.auth.assertOwnership((item as any).hotelId ?? '', me?.hotelId ?? '', user.role, 'super_admin')
    return item
  }

  /**
   * Escribe la entrada. Es el ÚNICO camino de escritura del log (no hay POST HTTP), así que acá
   * se completa lo que el llamador no puede saber (#141):
   *
   * - `ip`: la del request en curso (`shared/request-context.ts`). El service que audita está
   *   tres capas debajo del handler y no tiene `req`; pasarla a mano obligaría a tocar los ~30
   *   connectors `*-auditlog` y a que nadie se olvide nunca. Medido en producción antes de esto:
   *   5 de 414 filas tenían IP.
   * - `userName`: el nombre de `users`, resuelto por `userId`. 243 de 414 filas salían sin
   *   nombre y la pantalla las mostraba como "Sistema" — que es mentira cuando hubo una persona.
   *
   * Las dos son best-effort y el llamador manda: si la entrada ya trae el dato, no se toca. Un
   * cron o un script corren fuera de un request y quedan sin IP ni usuario — ahí "Sistema" sí es
   * la verdad. Un fallo resolviendo el nombre NO puede tumbar la escritura del log.
   */
  async create(dto: CreateAuditlogDTO): Promise<AuditlogDTO> {
    this.logger.info('Creando auditlog')
    const enriched: CreateAuditlogDTO = { ...dto }
    if (!enriched.ip) {
      const ip = currentRequestContext().ip
      if (ip && ip !== 'unknown') enriched.ip = ip
    }
    if (!enriched.userName && enriched.userId) {
      try {
        // @ignore IDOR_RISK — se resuelve el nombre del usuario que EJECUTÓ la acción, que ya
        // viene del token del request; no es un id elegido por el cliente.
        const user = await this.userRepo.findById(enriched.userId)
        if (user?.name) enriched.userName = String(user.name)
      } catch (e) {
        this.logger.warn('No se pudo resolver el nombre para el audit log', { userId: enriched.userId, error: String(e) })
      }
    }
    const item = await this.repo.create(enriched as Omit<AuditlogDTO, 'id'>)
    await this.sockets.onAuditlogCreated?.(item)
    return item
  }
}
