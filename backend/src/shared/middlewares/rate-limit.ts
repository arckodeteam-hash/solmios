// Rate limiter de intentos (login, forgot-password, endpoints públicos del booking engine, etc.)
//
// RL-01 (#316): el contador vivía en un Map en memoria del proceso — con varios workers/PM2
// cluster cada uno tiene su propio contador y el límite real termina siendo N× lo configurado
// (un atacante que rota entre workers multiplica su cupo). Con REDIS_URL seteada, el contador
// se comparte vía Redis (INCR atómico + EXPIRE en el primer hit de la ventana). Sin la var,
// Map en memoria de siempre — cero config nueva en dev, mismo comportamiento que antes.
//
// Fail-open: si Redis no está disponible, se permite el request (no se bloquea login legítimo
// por una caída de infraestructura) y se loguea una alerta — decisión documentada en el issue.
//
// La firma pública (rateLimit/recordFailedAttempt/resetAttempts) pasa a ser async: un contador
// realmente distribuido necesita un round-trip a un store compartido, no hay forma de que sea
// atómico entre procesos y siga siendo síncrono. Los ~30 call-sites ya corren dentro de
// handlers `async`, así que el cambio es agregar `await` — no se toca la lógica de negocio de
// qué se limita ni el reset-solo-en-éxito.
//
// La URL de Redis entra por ARGUMENTO (`createRateLimiter`), igual que `RedisCache`, y no se
// lee de `process.env` más que en la instancia por defecto de abajo. El motivo es concreto: el
// test del modo distribuido seteaba `process.env.REDIS_URL` para forzar ese modo y lo restauraba
// después de un `await`; cualquier OTRO test que importara este módulo dentro de esa ventana
// arrancaba en modo Redis sin querer, no podía conectar, y caía en fail-open — o sea, permitía
// todo. Los tests que verifican "a la 21ª bloquea" fallaban en bloque, de forma intermitente
// según el orden de archivos, y trababan el deploy (visto en CI: "no se pudo conectar a Redis al
// arrancar" seguido de N× "fail-open"). Con la URL como argumento no hay estado global que pisar.

import type { HttpRequest } from 'arckode-framework'
import { RedisClient } from 'bun'
import { Logger } from 'arckode-framework'

const logger = new Logger('rate-limit', 'info')

const MAX_ATTEMPTS = 20
const WINDOW_MS = 5 * 60 * 1000 // 5 minutes
const MS_TO_SEC = 1000
const SWEEP_INTERVAL_MS = 5 * 60 * 1000 // cleanup every 5 min

export interface RateLimitResult { allowed: boolean; retryAfter?: number }
export interface RateLimitOpts { maxAttempts?: number; windowMs?: number }

export interface RateLimiter {
  rateLimit: (key: string, opts?: RateLimitOpts) => Promise<RateLimitResult>
  recordFailedAttempt: (key: string) => Promise<RateLimitResult>
  resetAttempts: (key: string) => Promise<void>
  /** Resuelve cuando el handshake con Redis terminó (o falló). `null` en modo memoria. */
  ready: Promise<void> | null
}

/**
 * Un limitador con su propio contador. `redisUrl` vacío → Map en memoria del proceso.
 *
 * Es una fábrica y no un singleton con `process.env` adentro para que el modo distribuido se
 * pueda probar en aislamiento sin tocar variables de entorno globales (ver comentario de arriba).
 */
export function createRateLimiter(redisUrl?: string | null): RateLimiter {
  const attempts = new Map<string, { count: number; resetAt: number }>()

  // Periodic cleanup to prevent memory leak (solo aplica al backend en memoria).
  // unref: un limitador creado en un test no puede dejar el proceso vivo por este timer.
  const sweep = setInterval(() => {
    const now = Date.now()
    for (const [key, record] of attempts) {
      if (now > record.resetAt) attempts.delete(key)
    }
  }, SWEEP_INTERVAL_MS)
  ;(sweep as unknown as { unref?: () => void }).unref?.()

  // Cliente Redis: mismo patrón fail-soft que RedisCache (#279) — enableOfflineQueue:false para
  // que un Redis caído rechace rápido en vez de colgar el request indefinidamente. Se conecta
  // al crear el limitador y cada llamada espera ese handshake: sin esto, la PRIMERA llamada a
  // rateLimit() justo después del boot podía perder la carrera contra el handshake TCP y caer
  // en fail-open aunque Redis estuviera sano.
  const redis = redisUrl
    ? new RedisClient(redisUrl, { enableOfflineQueue: false, connectionTimeout: 3000 })
    : null
  const ready: Promise<void> | null = redis
    ? redis.connect().then(() => undefined).catch((e: unknown) => {
        logger.warn(`rate-limit: no se pudo conectar a Redis al arrancar — ${(e as Error).message}`)
      })
    : null

  function memoryRateLimit(key: string, maxAttempts: number, windowMs: number): RateLimitResult {
    const now = Date.now()
    const record = attempts.get(key)

    if (!record || now > record.resetAt) {
      attempts.set(key, { count: 1, resetAt: now + windowMs })
      return { allowed: true }
    }

    if (record.count >= maxAttempts) {
      const retryAfter = Math.ceil((record.resetAt - now) / MS_TO_SEC)
      return { allowed: false, retryAfter }
    }

    record.count++
    return { allowed: true }
  }

  /**
   * Contador distribuido: INCR atómico (Redis garantiza que cada llamada devuelve un valor
   * único e incremental aunque lleguen concurrentes desde workers distintos). Si el contador
   * volvió a 1 (clave recién creada por este INCR), fija el TTL de la ventana — evita el
   * read-modify-write no atómico de "leer, decidir, escribir" que reintroduciría la carrera
   * que este issue viene a cerrar.
   */
  async function redisRateLimit(key: string, maxAttempts: number, windowMs: number): Promise<RateLimitResult> {
    const redisKey = `ratelimit:${key}`
    const count = await redis!.incr(redisKey)
    if (count === 1) {
      await redis!.expire(redisKey, Math.ceil(windowMs / MS_TO_SEC))
    }
    if (count > maxAttempts) {
      const ttl = await redis!.ttl(redisKey)
      return { allowed: false, retryAfter: ttl > 0 ? ttl : Math.ceil(windowMs / MS_TO_SEC) }
    }
    return { allowed: true }
  }

  async function rateLimit(key: string, opts?: RateLimitOpts): Promise<RateLimitResult> {
    const maxAttempts = opts?.maxAttempts ?? MAX_ATTEMPTS
    const windowMs = opts?.windowMs ?? WINDOW_MS

    if (!redis) return memoryRateLimit(key, maxAttempts, windowMs)

    try {
      if (ready) await ready
      return await redisRateLimit(key, maxAttempts, windowMs)
    } catch (e) {
      // Fail-open documentado: no bloquear login legítimo por una caída de Redis.
      logger.warn(`rate-limit: Redis no disponible, fail-open para "${key}" — ${(e as Error).message}`)
      return { allowed: true }
    }
  }

  async function resetAttempts(key: string): Promise<void> {
    attempts.delete(key)
    if (!redis) return
    try {
      await redis.del(`ratelimit:${key}`)
    } catch (e) {
      logger.warn(`rate-limit: resetAttempts falló para "${key}" — ${(e as Error).message}`)
    }
  }

  return { rateLimit, recordFailedAttempt: (key) => rateLimit(key), resetAttempts, ready }
}

/** Instancia del proceso: el único lugar donde se lee REDIS_URL. */
const limiter = createRateLimiter(process.env.REDIS_URL)
// Se espera el handshake acá (top-level await, mismo patrón que `await db.connect()` en
// composition-root.ts) para que el primer request del boot no encuentre el cliente a medio abrir.
await limiter.ready

export const rateLimit = limiter.rateLimit
export const recordFailedAttempt = limiter.recordFailedAttempt
export const resetAttempts = limiter.resetAttempts

/**
 * IP real del cliente para el rate limit. Orden de confianza (SEC-4.1):
 * 1. `CF-Connecting-IP`: Cloudflare la setea con la IP real y la sobrescribe en el borde
 *    (no forjable a través de CF). Es la fuente correcta en este deploy (Cloudflare → nginx).
 * 2. ÚLTIMA IP de `X-Forwarded-For`: la agrega el proxy confiable (nginx). La PRIMERA la puede
 *    forjar el cliente para rotar el bucket y saltarse el límite → NO se usa la primera.
 * 3. `remoteAddress`: fallback en dev/local sin proxy.
 */
export function getClientIp(req: HttpRequest): string {
  const cf = req.headers?.['cf-connecting-ip']
  if (cf) { const ip = String(cf).trim(); if (ip) return ip }
  const xff = req.headers?.['x-forwarded-for']
  if (xff) {
    const parts = String(xff).split(',').map((s) => s.trim()).filter(Boolean)
    if (parts.length) return parts[parts.length - 1]
  }
  return req.remoteAddress || 'unknown'
}
