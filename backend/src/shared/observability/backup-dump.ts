// shared/observability/backup-dump.ts — volcado de la base según el motor activo (REQ-MON-05).
// Postgres: `pg_dump` como proceso hijo. La DATABASE_URL se parsea y la contraseña viaja SÓLO por
// `PGPASSWORD` en el entorno del hijo: nunca en argv (visible en `ps` y /proc/<pid>/cmdline) ni en
// mensajes de error. SQLite: copia consistente con `VACUUM INTO` (snapshot transaccional, incluye
// lo que está en el WAL) ejecutada en un proceso hijo, porque `db.run` de bun:sqlite es síncrono y
// congelaría el servidor y anularía el tope de tiempo del store. Ambos motores pasan por el mismo
// `runner` inyectable, que puede matar el proceso al abortar la señal y se reemplaza en tests.
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

export interface ProcessSpec {
  /** Binario (nombre en PATH o ruta absoluta). */
  cmd: string
  /** Argumentos: NUNCA llevan secretos, son visibles para cualquier usuario del sistema. */
  args: string[]
  /** Entorno completo del hijo (no hereda el del servidor); los secretos van acá. */
  env: Record<string, string>
  /** Al abortar hay que matar el proceso. */
  signal: AbortSignal
}

export type ProcessRunner = (spec: ProcessSpec) => Promise<ProcessResult>

export interface PostgresDumpOptions {
  runner?: ProcessRunner
  /** Resuelve el binario en PATH; null si no está. Default `Bun.which`. */
  which?: (bin: string) => string | null
}

export const PG_DUMP_BIN = 'pg_dump'
const STDERR_MAX = 300

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

function baseEnv(): Record<string, string> {
  return { PATH: process.env.PATH ?? '' }
}

/** Runner por defecto: Bun.spawn con stderr capturado y muerte por señal. */
export const bunProcessRunner: ProcessRunner = async ({ cmd, args, env, signal }) => {
  const proc = Bun.spawn([cmd, ...args], { env, stdout: 'ignore', stderr: 'pipe' })
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

export interface PostgresConnection {
  /** Argumentos de conexión para pg_dump, sin contraseña. */
  args: string[]
  /** Variables PG* para el entorno del hijo; incluye PGPASSWORD si la URL la trae. */
  env: Record<string, string>
  /** Formas en que la contraseña puede aparecer en un texto (en claro y percent-encoded). */
  secretos: string[]
}

/**
 * Separa la DATABASE_URL en lo que puede ir en argv (host, puerto, usuario, base y parámetros de
 * consulta como sslmode) y lo que sólo puede ir por entorno (la contraseña). El mensaje de error
 * de una URL inválida no repite la URL, porque podría contener la contraseña.
 */
export function parsePostgresUrl(databaseUrl: string): PostgresConnection {
  let url: URL
  try {
    url = new URL(databaseUrl)
  } catch {
    throw new Error('DATABASE_URL no es una URL válida: se espera una URL postgres:// con usuario, clave, host y base')
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) {
    throw new Error(`DATABASE_URL tiene un esquema no soportado (${url.protocol.replace(/:$/, '')}): se espera postgres://`)
  }
  const claveDb = url.password ? safeDecode(url.password) : ''
  const env: Record<string, string> = {}
  if (claveDb) env.PGPASSWORD = claveDb
  const secretos = claveDb ? [...new Set([claveDb, url.password, encodeURIComponent(claveDb)])] : []
  // Sin contraseña, la URL (host/puerto/usuario/base/sslmode…) puede ir en argv: libpq resuelve el
  // resto de parámetros de conexión igual que lo haría con la URL completa.
  const sinClave = new URL(url.href)
  sinClave.password = ''
  return { args: [`--dbname=${sinClave.href}`], env, secretos }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** Quita los secretos (contraseña en claro o percent-encoded) de un texto destinado a logs o errores. */
export function redactSecrets(text: string, secretos: string[]): string {
  return secretos.reduce((out, secreto) => (secreto ? out.split(secreto).join('***') : out), text)
}

export function postgresDump(databaseUrl: string, opts: PostgresDumpOptions = {}): BackupDump {
  const runner = opts.runner ?? bunProcessRunner
  const which = opts.which ?? ((bin: string) => Bun.which(bin))
  return {
    motor: 'postgres',
    extension: 'sql',
    async run({ destino, signal }) {
      if (!which(PG_DUMP_BIN)) throw pgDumpMissingError()
      const conn = parsePostgresUrl(databaseUrl)
      // Formato plano: restaurable con psql y legible; --no-owner/--no-privileges para que el
      // restore no dependa de los roles del servidor origen.
      const args = [
        '--format=plain', '--no-owner', '--no-privileges', `--file=${destino}`, ...conn.args,
      ]
      let result: ProcessResult
      try {
        result = await runner({ cmd: PG_DUMP_BIN, args, env: { ...baseEnv(), ...conn.env }, signal })
      } catch (err) {
        if (isMissingBinary(err)) throw pgDumpMissingError()
        throw new Error(redactSecrets(String((err as Error)?.message ?? err), conn.secretos))
      }
      if (signal.aborted) throw new Error(`${PG_DUMP_BIN} interrumpido por tope de tiempo`)
      if (result.code !== 0) {
        const detalle = redactSecrets(result.stderr.trim().slice(0, STDERR_MAX), conn.secretos)
        throw new Error(`${PG_DUMP_BIN} salió con código ${result.code}: ${detalle}`)
      }
    },
  }
}

export interface SqliteDumpOptions {
  /** Proceso hijo que ejecuta el VACUUM INTO; inyectable para tests. */
  runner?: ProcessRunner
  /** Ejecutable de Bun para el hijo. Default `process.execPath`. */
  execPath?: string
}

/** Variables con las que el hijo recibe origen y destino (rutas, no secretos). */
export const SQLITE_DUMP_SRC_VAR = 'SOLMIOS_SQLITE_DUMP_SRC'
export const SQLITE_DUMP_DEST_VAR = 'SOLMIOS_SQLITE_DUMP_DEST'

/**
 * Script mínimo del hijo (`bun -e`). VACUUM INTO escribe un snapshot consistente sin bloquear
 * escritores; falla si el destino ya existe, por eso el store le da un `.part` nuevo.
 */
export const SQLITE_DUMP_SCRIPT = [
  "import { Database } from 'bun:sqlite'",
  `const db = new Database(process.env.${SQLITE_DUMP_SRC_VAR}, { readonly: true })`,
  `try { db.run('VACUUM INTO ?', [process.env.${SQLITE_DUMP_DEST_VAR}]) } finally { db.close() }`,
].join('\n')

export function sqliteDump(dbPath: string, opts: SqliteDumpOptions = {}): BackupDump {
  const runner = opts.runner ?? bunProcessRunner
  const execPath = opts.execPath ?? process.execPath
  return {
    motor: 'sqlite',
    extension: 'sqlite',
    async run({ destino, signal }) {
      const result = await runner({
        cmd: execPath,
        args: ['-e', SQLITE_DUMP_SCRIPT],
        env: { ...baseEnv(), [SQLITE_DUMP_SRC_VAR]: dbPath, [SQLITE_DUMP_DEST_VAR]: destino },
        signal,
      })
      if (signal.aborted) throw new Error('copia de SQLite interrumpida por tope de tiempo')
      if (result.code !== 0) {
        throw new Error(`la copia de SQLite falló con código ${result.code}: ${result.stderr.trim().slice(0, STDERR_MAX)}`)
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
    : sqliteDump(env.DB_PATH || './data/managerhotel.db', { runner: opts.runner })
}
