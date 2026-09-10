// shared/observability/backup-dump.ts — volcado de la base según el motor activo (REQ-MON-05).
// Postgres: `pg_dump` como proceso hijo con la DATABASE_URL del entorno (decisión 4 del design).
// SQLite: copia consistente con `VACUUM INTO` (snapshot transaccional, incluye lo que está en el
// WAL). El proceso se inyecta (`runner`) para poder probar sin binario ni base real.
import { Database } from 'bun:sqlite'

export interface DumpTarget {
  /** Ruta de destino, siempre dentro del directorio de backups (la decide el store, no el dump). */
  destino: string
  /** Se dispara cuando el store supera el tope de tiempo: hay que matar el proceso. */
  signal: AbortSignal
}

export interface BackupDump {
  motor: 'postgres' | 'sqlite'
  /** Extensión del archivo generado, sin punto. */
  extension: string
  run(target: DumpTarget): Promise<void>
}

export interface ProcessResult {
  code: number
  stderr: string
}

export type ProcessRunner = (
  cmd: string[],
  opts: { env: Record<string, string>; signal: AbortSignal },
) => Promise<ProcessResult>

export interface PostgresDumpOptions {
  runner?: ProcessRunner
  /** Resuelve el binario en PATH; null si no está. Default `Bun.which`. */
  which?: (bin: string) => string | null
}

export const PG_DUMP_BIN = 'pg_dump'

export function pgDumpMissingError(): Error {
  return new Error(
    `No se encontró el binario ${PG_DUMP_BIN} en el servidor: instalá el cliente de PostgreSQL ` +
    `(paquete postgresql-client) o agregalo al PATH del proceso para poder crear backups.`,
  )
}

function isMissingBinary(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code
  const msg = String((err as Error)?.message ?? err)
  return code === 'ENOENT' || /ENOENT|not found|no such file/i.test(msg)
}

/** Runner por defecto: Bun.spawn con stderr capturado y muerte por señal. */
export const bunProcessRunner: ProcessRunner = async (cmd, { env, signal }) => {
  const proc = Bun.spawn(cmd, { env, stdout: 'ignore', stderr: 'pipe' })
  const onAbort = () => proc.kill()
  if (signal.aborted) onAbort()
  else signal.addEventListener('abort', onAbort, { once: true })
  try {
    const code = await proc.exited
    const stderr = await new Response(proc.stderr).text()
    return { code, stderr }
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

export function postgresDump(databaseUrl: string, opts: PostgresDumpOptions = {}): BackupDump {
  const runner = opts.runner ?? bunProcessRunner
  const which = opts.which ?? ((bin: string) => Bun.which(bin))
  return {
    motor: 'postgres',
    extension: 'sql',
    async run({ destino, signal }) {
      if (!which(PG_DUMP_BIN)) throw pgDumpMissingError()
      // Formato plano: restaurable con psql y legible; --no-owner/--no-privileges para que el
      // restore no dependa de los roles del servidor origen.
      const cmd = [
        PG_DUMP_BIN, '--format=plain', '--no-owner', '--no-privileges',
        `--file=${destino}`, `--dbname=${databaseUrl}`,
      ]
      let result: ProcessResult
      try {
        result = await runner(cmd, { env: { PATH: process.env.PATH ?? '' }, signal })
      } catch (err) {
        if (isMissingBinary(err)) throw pgDumpMissingError()
        throw err
      }
      if (signal.aborted) throw new Error(`${PG_DUMP_BIN} interrumpido por tope de tiempo`)
      if (result.code !== 0) {
        throw new Error(`${PG_DUMP_BIN} salió con código ${result.code}: ${result.stderr.trim().slice(0, 300)}`)
      }
    },
  }
}

export interface SqliteDumpOptions {
  /** Abre la base en sólo lectura; inyectable para tests. */
  open?: (path: string) => Pick<Database, 'run' | 'close'>
}

export function sqliteDump(dbPath: string, opts: SqliteDumpOptions = {}): BackupDump {
  const open = opts.open ?? ((path: string) => new Database(path, { readonly: true }))
  return {
    motor: 'sqlite',
    extension: 'sqlite',
    async run({ destino }) {
      const db = open(dbPath)
      try {
        // VACUUM INTO escribe un snapshot consistente sin bloquear escritores; falla si el
        // destino ya existe, por eso el store le da un `.part` nuevo.
        db.run('VACUUM INTO ?', [destino])
      } finally {
        db.close()
      }
    },
  }
}

export interface DumpEnv {
  DATABASE_URL?: string
  DB_PATH?: string
}

/** Mismo criterio que composition-root: DATABASE_URL → Postgres, si no SQLite (DB_PATH). */
export function backupDumpFromEnv(env: DumpEnv = process.env as DumpEnv, opts: PostgresDumpOptions = {}): BackupDump {
  return env.DATABASE_URL
    ? postgresDump(env.DATABASE_URL, opts)
    : sqliteDump(env.DB_PATH || './data/managerhotel.db')
}
