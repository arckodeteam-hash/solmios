// facturas/usecases/list-invoices.ts — Listado paginado con filtros, enriquecido y cacheado.
// Extraído del service para mantenerlo < 200 líneas.

import type { RepositoryAdapter, CacheAdapter, Logger } from 'arckode-framework'
import { AuthError } from 'arckode-framework'
import type { FacturasDTO, FacturasQuery, FacturasListResult, CurrentUser } from '../types'
import { type EnrichDeps } from './billing'
import { enrichInvoicesBatch } from './enrich-invoices-batch'
import { facturasListCacheKey } from './cache'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
const LIST_TTL_SECONDS = 300

export interface ListInvoicesDeps {
  repo: RepositoryAdapter<FacturasDTO>
  itemRepo: RepositoryAdapter<any>
  cache: CacheAdapter
  logger: Logger
  enrichDeps: EnrichDeps
}

/** Filtros de la query resueltos contra el usuario (multi-tenant). */
function resolveFilters(query?: FacturasQuery, user?: CurrentUser): Record<string, unknown> {
  const filters: Record<string, unknown> = {}
  if (query?.type) filters.type = query.type
  if (query?.status) filters.status = query.status
  if (user && user.role !== 'super_admin') {
    if (!user.hotelId) throw new AuthError('No hotel assigned')
    filters.hotelId = user.hotelId
  } else if (query?.hotelId) {
    filters.hotelId = query.hotelId
  }
  return filters
}

export async function listInvoices(
  deps: ListInvoicesDeps,
  query?: FacturasQuery,
  user?: CurrentUser,
): Promise<FacturasListResult> {
  const { repo, itemRepo, cache, logger, enrichDeps } = deps
  logger.info('Listando facturas', { query })

  const filters = resolveFilters(query, user)
  const page = Math.max(query?.page || 1, 1)
  const limit = Math.min(Math.max(query?.limit || DEFAULT_LIMIT, 1), MAX_LIMIT)
  const offset = (page - 1) * limit

  // La clave incluye filtros + paginación: antes todas las páginas compartían entrada
  // y la página 2 devolvía la 1 hasta la próxima escritura.
  const cacheKey = await facturasListCacheKey(cache, user?.hotelId, { filters, page, limit, search: query?.search })
  const cached = await cache.get(cacheKey)
  if (cached) return cached as FacturasListResult

  // DT-07 (#15): con `search`, el filtro se aplica sobre TODA la tabla filtrada (no una sola
  // página), así un match en cualquier página aparece. El adapter no tiene operador
  // `contains`/LIKE (`buildWhere` emite `campo = ?`, arckode-framework 1.6.3) y el SQL crudo
  // está prohibido en módulos, así que el match de texto no puede bajar al WHERE — eso queda
  // pendiente del framework (ver issue). Lo que SÍ se optimizó: antes se enriquecía TODO el
  // conjunto y recién después se filtraba; ahora se matchea en crudo (invoiceNumber/notes son
  // columnas propias; el nombre del huésped vive en `guests` — otra tabla, sin join en el ORM —
  // y se resuelve con UN findMany por hotel) y el enrich corre SOLO sobre la página final.
  if (query?.search) {
    const q = String(query.search).toLowerCase()
    const allRows = await repo.findMany(filters)
    const hotelIds = [...new Set(allRows.map((r) => r.hotelId).filter(Boolean))] as string[]
    const matchingGuestIds = new Set<string>()
    // COR-8: si la carga de huéspedes falla, el resultado es una página DEGRADADA (la
    // búsqueda por nombre baja a 0 matches). Ese total/páginas equivocado NO se cachea:
    // cada request degradada reintenta, y el panel se recupera solo cuando la query sana.
    let degraded = false
    await Promise.all(
      hotelIds.map(async (hid) => {
        const guests = await enrichDeps.guest.findMany({ hotelId: hid }).catch((err: unknown) => {
          // Degradación VISIBLE (COR-4/REG-4): sin log era un fallo mudo imposible de
          // diagnosticar desde el panel.
          degraded = true
          logger.warn('DT-07 search: falló la carga de huéspedes — búsqueda por nombre degradada a 0 matches', {
            hotelId: hid, error: (err as Error)?.message ?? String(err),
          })
          return [] as any[]
        })
        for (const g of guests) {
          if (g?.id && (g.name || '').toLowerCase().includes(q)) matchingGuestIds.add(g.id)
        }
      }),
    )
    const matched = allRows.filter((r) =>
      (r.invoiceNumber || '').toLowerCase().includes(q) ||
      (r.notes || '').toLowerCase().includes(q) ||
      (r.guestId ? matchingGuestIds.has(r.guestId) : false),
    )
    const pages = Math.max(1, Math.ceil(matched.length / limit))
    // N+1 eliminado (#274/#276): enriquecido en lote — y solo de la página, no del conjunto.
    const data = await enrichInvoicesBatch(matched.slice(offset, offset + limit), enrichDeps, itemRepo)
    const finalResult = {
      data,
      total: matched.length, limit, offset, pages,
      hasNext: page < pages, hasPrev: page > 1,
    }
    if (!degraded) await cache.set(cacheKey, finalResult, LIST_TTL_SECONDS)
    return finalResult
  }

  const result = await repo.paginate(filters, { offset, limit })
  // N+1 eliminado (#274/#276): enriquecido en lote (antes hasta 4 queries por factura).
  const data = await enrichInvoicesBatch(result.data, enrichDeps, itemRepo)
  const pages = Math.ceil(result.total / limit)
  const response = { data, total: result.total, limit, offset, pages, hasNext: page < pages, hasPrev: page > 1 }

  await cache.set(cacheKey, response, LIST_TTL_SECONDS)
  return response
}
