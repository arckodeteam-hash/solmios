// shared/tests/rate-limit-distributed.test.ts — RL-01 (#316).
// Prueba el criterio de aceptación real: "dos requests atendidos por workers distintos
// incrementan el MISMO contador" — sin esto, un atacante que rota entre workers multiplica
// su cupo (el bug que este issue viene a cerrar).
//
// El modo distribuido se instancia con `createRateLimiter(url)`, que recibe la URL por argumento.
// La versión anterior seteaba `process.env.REDIS_URL` y reimportaba el módulo con cache-busting
// para forzar el modo Redis: eso dejaba la variable puesta durante el `await` del import, así que
// cualquier otro test que cargara rate-limit.ts en esa ventana arrancaba en modo Redis, no podía
// conectar y caía en fail-open (permitir todo). Los tests de "a la 21ª bloquea" fallaban en
// bloque según el orden de archivos y trababan el deploy. Sin variables globales no hay ventana.
//
// Si no hay Redis disponible en TEST_REDIS_URL/localhost:6379, el test se salta (skip) en vez
// de fallar el suite — no todos los entornos de dev/CI tienen redis-server instalado.

import { describe, it, expect, beforeAll } from 'bun:test'
import { createRateLimiter } from '../middlewares/rate-limit'

const TEST_REDIS_URL = process.env.TEST_REDIS_URL || 'redis://localhost:6379/15'

let rateLimitDistributed: ReturnType<typeof createRateLimiter>['rateLimit']
let redisAvailable = true

beforeAll(async () => {
  const limiter = createRateLimiter(TEST_REDIS_URL)
  rateLimitDistributed = limiter.rateLimit

  try {
    // Race contra un timeout corto: el RedisClient puede tardar más en fallar que rechazar
    // (reconexión implícita en el primer comando, no cubierta por connectionTimeout del
    // connect() inicial) — sin esto, en runners más lentos (CI) el catch nunca llega a tiempo
    // y el beforeAll entero revienta por el timeout de 5s de Bun en vez de skippear limpio.
    const probe = await Promise.race([
      rateLimitDistributed(`__probe__:${crypto.randomUUID()}`),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('probe timeout')), 2000)),
    ])
    if (!probe.allowed) redisAvailable = false
  } catch {
    redisAvailable = false
  }
}, 8000)

describe('rateLimit distribuido (REDIS_URL) — RL-01 #316', () => {
  it('dos "workers" (llamadas concurrentes) contra la MISMA key comparten un único contador global', async () => {
    if (!redisAvailable) return
    const key = `distributed-workers:${crypto.randomUUID()}`
    const maxAttempts = 10

    // Simula 2 workers atendiendo 15 requests EN PARALELO para la misma key: si el contador
    // no fuera realmente compartido/atómico, más de `maxAttempts` pasarían como allowed.
    const results = await Promise.all(
      Array.from({ length: 15 }, () => rateLimitDistributed(key, { maxAttempts, windowMs: 60_000 })),
    )

    const allowedCount = results.filter((r) => r.allowed).length
    const blockedCount = results.filter((r) => !r.allowed).length

    expect(allowedCount).toBe(maxAttempts)
    expect(blockedCount).toBe(15 - maxAttempts)
  })

  it('keys distintas no se contaminan entre sí en el store compartido', async () => {
    if (!redisAvailable) return
    const keyA = `distributed-a:${crypto.randomUUID()}`
    const keyB = `distributed-b:${crypto.randomUUID()}`

    for (let i = 0; i < 5; i++) await rateLimitDistributed(keyA, { maxAttempts: 5, windowMs: 60_000 })
    expect((await rateLimitDistributed(keyA, { maxAttempts: 5, windowMs: 60_000 })).allowed).toBe(false)
    expect((await rateLimitDistributed(keyB, { maxAttempts: 5, windowMs: 60_000 })).allowed).toBe(true)
  })
})
