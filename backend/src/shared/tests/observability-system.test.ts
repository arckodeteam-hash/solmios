// REQ-MON-03/04 — salud de base por motor (sin inventar), sistema (CPU por diferencia) y uploads
// con cache.
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dbHealth, type DbHealthAdapter } from '../observability/db-health'
import { SystemHealth } from '../observability/system-health'
import { UploadsSize, walkDir } from '../observability/uploads-size'

function fakeAdapter(answers: Record<string, unknown[] | Error>): DbHealthAdapter & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async query(sql: string) {
      calls.push(sql)
      const hit = Object.entries(answers).find(([needle]) => sql.includes(needle))
      if (!hit) throw new Error(`consulta inesperada: ${sql}`)
      if (hit[1] instanceof Error) throw hit[1]
      return hit[1]
    },
  }
}

describe('dbHealth (3.1)', () => {
  it('sqlite: tamaño del archivo (+wal), tablas de sqlite_master y SIN conexiones', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbh-'))
    const path = join(dir, 'x.db')
    writeFileSync(path, Buffer.alloc(1000))
    writeFileSync(`${path}-wal`, Buffer.alloc(24))
    try {
      const adapter = fakeAdapter({ sqlite_master: [{ n: 7 }] })
      const out = await dbHealth({ engine: 'sqlite', adapter, sqlitePath: path })
      expect(out).toEqual({ motor: 'sqlite', tamanoBytes: 1024, tablas: 7 })
      expect(out.conexiones).toBeUndefined()
      expect('conexiones' in out).toBe(false)
      expect(adapter.calls.some((s) => s.includes('pg_stat_activity'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('sqlite sin archivo: omite el tamaño en vez de poner cero', async () => {
    const out = await dbHealth({ engine: 'sqlite', adapter: fakeAdapter({ sqlite_master: [{ n: 3 }] }), sqlitePath: '/no/existe.db' })
    expect(out).toEqual({ motor: 'sqlite', tablas: 3 })
  })

  it('postgres: tamaño, tablas y conexiones (count como string del driver → número)', async () => {
    const adapter = fakeAdapter({
      pg_database_size: [{ bytes: '8200000' }],
      'information_schema.tables': [{ n: '42' }],
      pg_stat_activity: [{ n: '5' }],
    })
    const out = await dbHealth({ engine: 'postgres', adapter })
    expect(out).toEqual({ motor: 'postgres', tamanoBytes: 8200000, tablas: 42, conexiones: 5 })
  })

  it('postgres: la consulta que falla se omite del payload, el resto sigue', async () => {
    const adapter = fakeAdapter({
      pg_database_size: new Error('permission denied'),
      'information_schema.tables': [{ n: 42 }],
      pg_stat_activity: [{ n: 5 }],
    })
    const out = await dbHealth({ engine: 'postgres', adapter })
    expect(out).toEqual({ motor: 'postgres', tablas: 42, conexiones: 5 })
    expect('tamanoBytes' in out).toBe(false)
  })
})

describe('SystemHealth (3.2)', () => {
  it('cpu % es del intervalo entre dos lecturas, no el acumulado del proceso', async () => {
    // cpuUsage en µs acumulados; hrtime en ns.
    const cpuSamples = [
      { user: 5_000_000, system: 1_000_000 }, // 6 s acumulados antes de arrancar
      { user: 5_400_000, system: 1_100_000 }, // +500 ms en 1 s → 50 %
      { user: 5_400_000, system: 1_100_000 }, // +0 en 2 s → 0 %
    ]
    const times = [0n, 1_000_000_000n, 3_000_000_000n]
    let i = 0
    const health = new SystemHealth({
      cpuUsage: () => cpuSamples[i]!,
      hrtime: () => times[i++]!,
      appDir: process.cwd(),
    })
    const first = await health.read()
    expect(first.proceso.cpuPct).toBeNull() // sin lectura previa no hay intervalo
    const second = await health.read()
    expect(second.proceso.cpuPct).toBe(50)
    const third = await health.read()
    expect(third.proceso.cpuPct).toBe(0) // si fuera acumulado daría > 0
  })

  it('trae uptime de proceso y de SO, memoria y disco de la partición de la app', async () => {
    const r = await new SystemHealth({ appDir: process.cwd() }).read()
    expect(r.proceso.uptimeS).toBeGreaterThanOrEqual(0)
    expect(r.proceso.memoriaRssMb).toBeGreaterThan(0)
    expect(r.proceso.memoriaHeapMb).toBeGreaterThan(0)
    expect(r.so.uptimeS).toBeGreaterThan(0)
    expect(r.so.cargas).toHaveLength(3)
    expect(r.so.memoriaTotalMb).toBeGreaterThan(r.so.memoriaLibreMb)
    expect(r.disco).toBeDefined()
    expect(r.disco!.totalBytes).toBeGreaterThan(0)
    expect(r.disco!.usadoPct).toBeGreaterThanOrEqual(0)
    expect(r.disco!.usadoPct).toBeLessThanOrEqual(100)
  })

  it('directorio inexistente → sin clave disco (no ceros inventados)', async () => {
    const r = await new SystemHealth({ appDir: '/no/existe/para/nada' }).read()
    expect('disco' in r).toBe(false)
  })
})

describe('UploadsSize (3.3)', () => {
  it('la segunda llamada dentro de los 5 minutos no recorre el directorio', async () => {
    let walks = 0
    let t = 1_000_000
    const uploads = new UploadsSize('/uploads', {
      now: () => t,
      walk: async () => { walks++; return { bytes: 2048, archivos: 3 } },
    })
    const a = await uploads.read()
    expect(a).toEqual({ bytes: 2048, archivos: 3, calculadoEn: new Date(1_000_000).toISOString() })
    t += 4 * 60_000 // 4 min después: cache válida
    const b = await uploads.read()
    expect(walks).toBe(1)
    expect(b).toBe(a)
    t += 2 * 60_000 // 6 min desde el cálculo: expiró
    await uploads.read()
    expect(walks).toBe(2)
    uploads.invalidate()
    await uploads.read()
    expect(walks).toBe(3)
  })

  it('walkDir suma bytes y archivos recursivamente; directorio ausente → ceros sin lanzar', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'up-'))
    try {
      writeFileSync(join(dir, 'a.jpg'), Buffer.alloc(100))
      mkdirSync(join(dir, 'hotel-1', 'rooms'), { recursive: true })
      writeFileSync(join(dir, 'hotel-1', 'logo.png'), Buffer.alloc(50))
      writeFileSync(join(dir, 'hotel-1', 'rooms', 'r.webp'), Buffer.alloc(25))
      expect(await walkDir(dir)).toEqual({ bytes: 175, archivos: 3 })
      const real = await new UploadsSize(dir).read()
      expect(real.bytes).toBe(175)
      expect(real.archivos).toBe(3)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    expect(await new UploadsSize(join(dir, 'nope')).read()).toMatchObject({ bytes: 0, archivos: 0 })
  })
})
