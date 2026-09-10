// shared/observability/backups.ts — directorio de backups de la base (REQ-MON-05).
// La lista SE DERIVA del directorio (no hay tabla). El `id` que manda el cliente nunca se
// concatena a una ruta: se lista y se busca la coincidencia exacta; lo que no está en la lista no
// existe (decisión 4 del design: path traversal cerrado por construcción).
// El directorio por defecto vive en backend/data/, fuera de frontend/dist y de uploads/, para que
// un volcado con los datos de todos los hoteles no sea descargable por URL directa.
import * as fsp from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { BackupDump } from './backup-dump'

export interface BackupFile {
  id: string
  bytes: number
  creadoEn: string
}

export interface BackupCreated {
  archivo: BackupFile
  /** Ids eliminados por retención al crear este backup. */
  eliminados: string[]
}

/** Subconjunto de node:fs/promises que usa el store; inyectable para observar accesos en tests. */
export interface BackupsFs {
  mkdir(path: string, opts: { recursive: true }): Promise<unknown>
  readdir(path: string, opts: { withFileTypes: true }): Promise<Array<{ name: string; isFile(): boolean }>>
  stat(path: string): Promise<{ size: number; mtimeMs: number }>
  unlink(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>
}

export interface BackupsStoreOptions {
  dir?: string
  retentionCount?: number
  timeoutMs?: number
  fs?: BackupsFs
  now?: () => Date
}

export interface BackupsEnv {
  BACKUP_DIR?: string
  BACKUP_RETENTION_COUNT?: string
}

export const DEFAULT_BACKUP_DIR = resolve(import.meta.dir, '../../../data/backups')
export const DEFAULT_RETENTION_COUNT = 10
export const DEFAULT_TIMEOUT_MS = 10 * 60_000
const EXTENSIONS = ['sql', 'sqlite']
const PART_SUFFIX = '.part'

export function resolveBackupDir(env: BackupsEnv = process.env as BackupsEnv): string {
  return env.BACKUP_DIR ? resolve(env.BACKUP_DIR) : DEFAULT_BACKUP_DIR
}

export function resolveRetentionCount(env: BackupsEnv = process.env as BackupsEnv): number {
  const n = Number(env.BACKUP_RETENTION_COUNT)
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_RETENTION_COUNT
}

function isBackupName(name: string): boolean {
  return EXTENSIONS.some((ext) => name.endsWith(`.${ext}`))
}

/** Más nuevo primero; a igual fecha desempata el nombre (lleva la marca de tiempo). */
function newestFirst(a: BackupFile, b: BackupFile): number {
  return b.creadoEn.localeCompare(a.creadoEn) || b.id.localeCompare(a.id)
}

export class BackupsStore {
  readonly dir: string
  readonly retentionCount: number
  readonly timeoutMs: number
  private readonly fs: BackupsFs
  private readonly now: () => Date

  constructor(opts: BackupsStoreOptions = {}) {
    this.dir = opts.dir ? resolve(opts.dir) : resolveBackupDir()
    this.retentionCount = opts.retentionCount ?? resolveRetentionCount()
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.fs = opts.fs ?? fsp
    this.now = opts.now ?? (() => new Date())
  }

  async ensureDir(): Promise<void> {
    await this.fs.mkdir(this.dir, { recursive: true })
  }

  async list(): Promise<BackupFile[]> {
    await this.ensureDir()
    const entries = await this.fs.readdir(this.dir, { withFileTypes: true })
    const out: BackupFile[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !isBackupName(entry.name)) continue
      try {
        const st = await this.fs.stat(join(this.dir, entry.name))
        out.push({ id: entry.name, bytes: st.size, creadoEn: new Date(st.mtimeMs).toISOString() })
      } catch { /* borrado entre el readdir y el stat */ }
    }
    return out.sort(newestFirst)
  }

  /** Coincidencia exacta contra la lista real: nunca arma una ruta con el id recibido. */
  async find(id: string): Promise<BackupFile | null> {
    return (await this.list()).find((f) => f.id === id) ?? null
  }

  /** Ruta absoluta del archivo, sólo si está en la lista. */
  async pathOf(id: string): Promise<string | null> {
    const found = await this.find(id)
    return found ? join(this.dir, found.id) : null
  }

  async remove(id: string): Promise<boolean> {
    const path = await this.pathOf(id)
    if (!path) return false
    await this.fs.unlink(path)
    return true
  }

  async create(dump: BackupDump): Promise<BackupCreated> {
    await this.ensureDir()
    const id = await this.newId(dump.extension)
    const final = join(this.dir, id)
    const part = `${final}${PART_SUFFIX}`
    try {
      await this.withTimeout((signal) => dump.run({ destino: part, signal }))
      await this.fs.rename(part, final)
    } catch (err) {
      await this.fs.unlink(part).catch(() => {})
      throw err
    }
    const st = await this.fs.stat(final)
    const archivo: BackupFile = { id, bytes: st.size, creadoEn: new Date(st.mtimeMs).toISOString() }
    const eliminados = await this.applyRetention()
    return { archivo, eliminados }
  }

  /** Deja los `retentionCount` más nuevos; devuelve los ids borrados (del más viejo al más nuevo). */
  async applyRetention(): Promise<string[]> {
    const sobran = (await this.list()).slice(this.retentionCount).reverse()
    const eliminados: string[] = []
    for (const f of sobran) {
      try {
        await this.fs.unlink(join(this.dir, f.id))
        eliminados.push(f.id)
      } catch { /* ya no está */ }
    }
    return eliminados
  }

  private async newId(extension: string): Promise<string> {
    const stamp = this.now().toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/\.(\d{3})Z$/, '-$1')
    const existing = new Set((await this.list()).map((f) => f.id))
    const base = `backup-${stamp}`
    let id = `${base}.${extension}`
    for (let n = 2; existing.has(id); n++) id = `${base}-${n}.${extension}`
    return id
  }

  private async withTimeout(fn: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const ctrl = new AbortController()
    const vencido = new Error(`El backup superó el tope de ${Math.round(this.timeoutMs / 1000)} s y se marcó fallido`)
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { reject(vencido); ctrl.abort() }, this.timeoutMs)
    })
    try {
      await Promise.race([fn(ctrl.signal), timeout])
    } catch (err) {
      // Si el dump reacciona al abort con su propio error, gana el motivo real: el tope.
      throw ctrl.signal.aborted ? vencido : err
    } finally {
      clearTimeout(timer)
    }
  }
}
