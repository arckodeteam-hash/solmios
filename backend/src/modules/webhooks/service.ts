// webhooks/service.ts — Facade pública del módulo Webhooks salientes.
// CRUD de subscriptions (ownership por hotelId, igual que apikeys) + `dispatch()` — el puerto que
// consumen los connectors de otros módulos (ej. `reservas-webhooks.ts`) para avisar un evento.

import type { RepositoryAdapter, Logger, CacheAdapter } from 'arckode-framework'
import { NotFoundError, AuthError, ValidationError } from 'arckode-framework'
import type {
  WebhookSubscriptionDTO, CreateWebhookSubscriptionDTO, UpdateWebhookSubscriptionDTO,
  WebhookSubscriptionsQuery, WebhookSubscriptionsPaginated, WebhookSubscriptionView,
  WebhookDeliveryDTO, CurrentUser,
} from './types'
import { generateWebhookSecret, maskWebhookSecret } from './usecases/secret'
import { dispatchWebhookEvent, testWebhookSubscription, type DispatchDeps } from './usecases/dispatch'
import { assertPublicWebhookUrl, type DnsLookupFn } from './usecases/validate-url'
import { versionedListCache, type VersionedListCache } from '../../shared/usecases/versioned-list-cache'

const CACHE_TTL = 300

export class WebhooksService {
  constructor(
    private readonly repo: RepositoryAdapter<WebhookSubscriptionDTO>,
    private readonly deliveryRepo: RepositoryAdapter<WebhookDeliveryDTO>,
    private readonly logger: Logger,
    private readonly cache: CacheAdapter,
    /** Inyectable en tests para no depender de DNS real (ver usecases/validate-url.ts). */
    private readonly lookupImpl?: DnsLookupFn,
  ) {
    this.listCache = versionedListCache(cache, 'webhooks')
  }

  private readonly listCache: VersionedListCache

  private dispatchDeps(): DispatchDeps {
    return { subscriptionRepo: this.repo, deliveryRepo: this.deliveryRepo, logger: this.logger, lookupImpl: this.lookupImpl }
  }

  /**
   * Puerto que consumen los connectors de otros módulos (ej. reservas-webhooks.ts) para avisar un
   * evento. Best-effort a propósito: un webhook saliente es una notificación a un tercero, nunca
   * debe poder tumbar el flujo de negocio que lo disparó (crear una reserva no puede fallar porque
   * el hotel configuró mal una URL de webhook).
   */
  async dispatch(hotelId: string, event: string, payload: unknown): Promise<void> {
    try {
      await dispatchWebhookEvent(this.dispatchDeps(), hotelId, event, payload)
    } catch (e) {
      this.logger.warn('dispatch de webhook falló (best-effort, no bloquea al llamante)', {
        hotelId, event, error: (e as Error).message,
      })
    }
  }

  private async withCounts(sub: WebhookSubscriptionDTO): Promise<WebhookSubscriptionView> {
    const [delivered, failed] = await Promise.all([
      this.deliveryRepo.count({ webhookId: sub.id, success: 1 }),
      this.deliveryRepo.count({ webhookId: sub.id, success: 0 }),
    ])
    const { secret: _omit, ...rest } = sub
    return { ...rest, masked: maskWebhookSecret(sub.secret), delivered, failed }
  }

  async list(query: WebhookSubscriptionsQuery, currentUser: CurrentUser): Promise<WebhookSubscriptionsPaginated> {
    const filters: Record<string, unknown> = {}
    if (query.active !== undefined) filters.active = query.active

    if (currentUser.role !== 'super_admin') {
      if (!currentUser.hotelId) throw new AuthError('No hotel assigned')
      filters.hotelId = currentUser.hotelId
    } else if (query.hotelId) {
      filters.hotelId = query.hotelId
    }

    const page = Math.max(query.page || 1, 1)
    const limit = Math.min(Math.max(query.limit || 20, 1), 100)
    const offset = (page - 1) * limit

    // Clave versionada (shared/usecases/versioned-list-cache.ts). Antes las mutaciones borraban
    // `webhooks:list:{hotelId}`, que nunca coincidía con esta clave: el webhook recién creado y
    // los contadores tras "Probar" no se veían hasta vencer el TTL.
    const cacheKey = await this.listCache.key(filters.hotelId as string | undefined, { filters, page, limit })
    const cached = await this.cache.get(cacheKey)
    if (cached) return cached as WebhookSubscriptionsPaginated

    const result = await this.repo.paginate(filters, { offset, limit })
    const data = await Promise.all(result.data.map((s) => this.withCounts(s)))
    const response = { data, total: result.total, page, limit, pages: Math.ceil(result.total / limit) }
    await this.cache.set(cacheKey, response, CACHE_TTL)
    return response
  }

  async getById(id: string, currentUser: CurrentUser): Promise<WebhookSubscriptionView> {
    const item = await this.repo.findById(id)
    if (!item) throw new NotFoundError('Webhook no encontrado')
    if (currentUser.role !== 'super_admin' && item.hotelId !== currentUser.hotelId) {
      throw new AuthError('No autorizado')
    }
    return this.withCounts(item)
  }

  async create(dto: CreateWebhookSubscriptionDTO, currentUser: CurrentUser): Promise<WebhookSubscriptionView> {
    if (currentUser.role !== 'super_admin' && dto.hotelId !== currentUser.hotelId) {
      throw new AuthError('No autorizado para crear en otro hotel')
    }
    if (!dto.events?.length) throw new ValidationError('Debe seleccionar al menos un evento')
    await assertPublicWebhookUrl(dto.url, this.lookupImpl)
    const secret = generateWebhookSecret()
    const item = await this.repo.create({
      hotelId: dto.hotelId, url: dto.url, events: dto.events, secret, active: dto.active ?? 1,
    } as Omit<WebhookSubscriptionDTO, 'id'>)
    await this.listCache.invalidate(dto.hotelId)
    // El secreto en claro SOLO viaja acá (una vez, para que el hotel configure la verificación HMAC
    // en su servidor) — igual que `plainKey` en apikeys. Nunca se vuelve a exponer completo.
    return { ...(await this.withCounts(item)), secret } as WebhookSubscriptionView & { secret: string }
  }

  async update(id: string, dto: UpdateWebhookSubscriptionDTO, currentUser: CurrentUser): Promise<WebhookSubscriptionView> {
    const existing = await this.repo.findById(id)
    if (!existing) throw new NotFoundError('Webhook no encontrado')
    if (currentUser.role !== 'super_admin' && existing.hotelId !== currentUser.hotelId) {
      throw new AuthError('No autorizado')
    }
    if (dto.url) await assertPublicWebhookUrl(dto.url, this.lookupImpl)
    const item = await this.repo.update(id, dto as Partial<Omit<WebhookSubscriptionDTO, 'id'>>)
    if (!item) throw new NotFoundError('Webhook no encontrado')
    await this.listCache.invalidate(existing.hotelId)
    return this.withCounts(item)
  }

  async delete(id: string, currentUser: CurrentUser): Promise<void> {
    const existing = await this.repo.findById(id)
    if (!existing) throw new NotFoundError('Webhook no encontrado')
    if (currentUser.role !== 'super_admin' && existing.hotelId !== currentUser.hotelId) {
      throw new AuthError('No autorizado')
    }
    const deleted = await this.repo.delete(id)
    if (!deleted) throw new NotFoundError('Webhook no encontrado')
    await this.listCache.invalidate(existing.hotelId)
  }

  /** POST /webhooks/:id/test — dispara un evento sintético "ping" SOLO a esta subscription. */
  async test(id: string, currentUser: CurrentUser): Promise<{ delivered: boolean }> {
    const existing = await this.repo.findById(id)
    if (!existing) throw new NotFoundError('Webhook no encontrado')
    if (currentUser.role !== 'super_admin' && existing.hotelId !== currentUser.hotelId) {
      throw new AuthError('No autorizado')
    }
    const before = await this.deliveryRepo.count({ webhookId: id, success: 1 })
    await testWebhookSubscription(this.dispatchDeps(), existing)
    const after = await this.deliveryRepo.count({ webhookId: id, success: 1 })
    // Los contadores delivered/failed viajan dentro del listado cacheado: sin esto, "Probar" no
    // movía los números en pantalla hasta vencer el TTL.
    await this.listCache.invalidate(existing.hotelId)
    return { delivered: after > before }
  }
}
