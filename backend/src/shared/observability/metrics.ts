// shared/observability/metrics.ts — agregado en memoria de peticiones HTTP por ruta normalizada.
// Sin I/O y O(1) por registro: se actualiza un acumulador y un ring buffer acotado por ruta para
// el p95. Al reiniciar el proceso arranca de cero: `ventanaDesde` lo dice explícitamente.
export const MAX_ROUTES = 300
export const OTHER_ROUTE_KEY = 'otras'
const RING_SIZE = 256
const ERROR_STATUS = 500
const P95 = 0.95

export interface HttpMetricSample {
  method: string
  route: string
  status: number
  durationMs: number
}

export interface RouteMetrics {
  ruta: string
  metodo: string
  count: number
  avgMs: number
  p95Ms: number
  maxMs: number
  errors: number
}

export interface HttpMetricsSnapshot {
  ventanaDesde: string
  rutas: RouteMetrics[]
  totales: { peticiones: number; erroresPct: number; avgMs: number }
}

interface Bucket {
  ruta: string
  metodo: string
  count: number
  totalMs: number
  maxMs: number
  errors: number
  ring: number[]
  ringPos: number
}

function newBucket(ruta: string, metodo: string): Bucket {
  return { ruta, metodo, count: 0, totalMs: 0, maxMs: 0, errors: 0, ring: [], ringPos: 0 }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function percentile95(ring: number[]): number {
  if (ring.length === 0) return 0
  const sorted = [...ring].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * P95) - 1)
  return sorted[Math.max(0, idx)]!
}

export class HttpMetricsStore {
  private buckets = new Map<string, Bucket>()
  private startedAt = new Date()
  private readonly maxRoutes: number

  constructor(maxRoutes = MAX_ROUTES) {
    this.maxRoutes = maxRoutes
  }

  record(sample: HttpMetricSample): void {
    const bucket = this.bucketFor(sample.method, sample.route)
    const ms = Math.max(0, sample.durationMs)
    bucket.count++
    bucket.totalMs += ms
    if (ms > bucket.maxMs) bucket.maxMs = ms
    if (sample.status >= ERROR_STATUS) bucket.errors++
    if (bucket.ring.length < RING_SIZE) bucket.ring.push(ms)
    else bucket.ring[bucket.ringPos] = ms
    bucket.ringPos = (bucket.ringPos + 1) % RING_SIZE
  }

  snapshot(): HttpMetricsSnapshot {
    let peticiones = 0
    let errores = 0
    let totalMs = 0
    const rutas: RouteMetrics[] = []
    for (const b of this.buckets.values()) {
      peticiones += b.count
      errores += b.errors
      totalMs += b.totalMs
      rutas.push({
        ruta: b.ruta,
        metodo: b.metodo,
        count: b.count,
        avgMs: round1(b.count ? b.totalMs / b.count : 0),
        p95Ms: round1(percentile95(b.ring)),
        maxMs: round1(b.maxMs),
        errors: b.errors,
      })
    }
    return {
      ventanaDesde: this.startedAt.toISOString(),
      rutas,
      totales: {
        peticiones,
        erroresPct: round1(peticiones ? (errores / peticiones) * 100 : 0),
        avgMs: round1(peticiones ? totalMs / peticiones : 0),
      },
    }
  }

  reset(): void {
    this.buckets.clear()
    this.startedAt = new Date()
  }

  private bucketFor(method: string, route: string): Bucket {
    const key = `${method} ${route}`
    let bucket = this.buckets.get(key)
    if (bucket) return bucket
    if (this.buckets.size >= this.maxRoutes) {
      // Tope alcanzado: todo patrón nuevo cae en `otras` para que el mapa tenga techo.
      bucket = this.buckets.get(OTHER_ROUTE_KEY)
      if (!bucket) {
        bucket = newBucket(OTHER_ROUTE_KEY, '*')
        this.buckets.set(OTHER_ROUTE_KEY, bucket)
      }
      return bucket
    }
    bucket = newBucket(route, method)
    this.buckets.set(key, bucket)
    return bucket
  }
}
