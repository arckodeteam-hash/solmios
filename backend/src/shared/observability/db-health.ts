// shared/observability/db-health.ts — métricas de la base según el motor activo, sin inventar.
// Cada consulta va en su propio try/catch: la que falla se omite del payload (nunca un cero que se
// lea como medición). En SQLite `conexiones` no aplica y queda AUSENTE.
import { statSync } from 'node:fs'

export type DbEngine = 'postgres' | 'sqlite'

export interface DbHealthAdapter {
  query(sql: string, params?: unknown[]): Promise<unknown[]>
}

export interface DbHealthInput {
  engine: DbEngine
  adapter: DbHealthAdapter
  sqlitePath?: string
}

export interface DbHealth {
  motor: DbEngine
  tamanoBytes?: number
  tablas?: number
  conexiones?: number
}

/** Primera columna numérica de la primera fila. Los drivers de PG devuelven count como string. */
function firstNumber(rows: unknown[], col: string): number | undefined {
  const row = rows[0] as Record<string, unknown> | undefined
  if (!row) return undefined
  const raw = row[col] ?? Object.values(row)[0]
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

async function tryNumber(adapter: DbHealthAdapter, sql: string, col: string): Promise<number | undefined> {
  try {
    return firstNumber(await adapter.query(sql), col)
  } catch {
    return undefined
  }
}

function fileSize(path: string): number | undefined {
  try {
    return statSync(path).size
  } catch {
    return undefined
  }
}

async function postgresHealth(adapter: DbHealthAdapter): Promise<DbHealth> {
  const out: DbHealth = { motor: 'postgres' }
  const bytes = await tryNumber(adapter, 'SELECT pg_database_size(current_database()) AS bytes', 'bytes')
  if (bytes !== undefined) out.tamanoBytes = bytes
  const tablas = await tryNumber(adapter, "SELECT count(*) AS n FROM information_schema.tables WHERE table_schema = 'public'", 'n')
  if (tablas !== undefined) out.tablas = tablas
  const conexiones = await tryNumber(adapter, 'SELECT count(*) AS n FROM pg_stat_activity', 'n')
  if (conexiones !== undefined) out.conexiones = conexiones
  return out
}

async function sqliteHealth(adapter: DbHealthAdapter, sqlitePath?: string): Promise<DbHealth> {
  const out: DbHealth = { motor: 'sqlite' }
  if (sqlitePath) {
    const main = fileSize(sqlitePath)
    if (main !== undefined) out.tamanoBytes = main + (fileSize(`${sqlitePath}-wal`) ?? 0)
  }
  const tablas = await tryNumber(adapter, "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'", 'n')
  if (tablas !== undefined) out.tablas = tablas
  return out
}

export async function dbHealth(input: DbHealthInput): Promise<DbHealth> {
  return input.engine === 'postgres'
    ? postgresHealth(input.adapter)
    : sqliteHealth(input.adapter, input.sqlitePath)
}
