// shared/observability/uploads-size.ts — tamaño de uploads/ recorriendo el árbol, con cache.
// El recorrido es caro en discos con miles de archivos: se cachea `ttlMs` (default 5 min) para no
// recorrerlo en cada carga de la pantalla. Directorio ausente → ceros, sin lanzar.
import { readdir, lstat } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'

export interface UploadsSizeResult {
  bytes: number
  archivos: number
  calculadoEn: string
}

export interface UploadsSizeOptions {
  ttlMs?: number
  now?: () => number
  walk?: (dir: string) => Promise<{ bytes: number; archivos: number }>
}

const DEFAULT_TTL_MS = 5 * 60_000

/** Recorre el directorio sin seguir symlinks. Lo que no se puede leer se salta. */
export async function walkDir(dir: string): Promise<{ bytes: number; archivos: number }> {
  let bytes = 0
  let archivos = 0
  const pending = [dir]
  while (pending.length) {
    const current = pending.pop()!
    let entries: Dirent[]
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        pending.push(full)
        continue
      }
      if (!entry.isFile()) continue
      try {
        bytes += (await lstat(full)).size
        archivos++
      } catch { /* borrado entre el readdir y el stat */ }
    }
  }
  return { bytes, archivos }
}

export class UploadsSize {
  private readonly ttlMs: number
  private readonly now: () => number
  private readonly walk: (dir: string) => Promise<{ bytes: number; archivos: number }>
  private cache: { at: number; value: UploadsSizeResult } | null = null

  constructor(private readonly dir: string, opts: UploadsSizeOptions = {}) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS
    this.now = opts.now ?? (() => Date.now())
    this.walk = opts.walk ?? walkDir
  }

  async read(): Promise<UploadsSizeResult> {
    const at = this.now()
    if (this.cache && at - this.cache.at < this.ttlMs) return this.cache.value
    let sizes = { bytes: 0, archivos: 0 }
    try {
      sizes = await this.walk(this.dir)
    } catch { /* directorio inexistente o ilegible → ceros */ }
    const value: UploadsSizeResult = { ...sizes, calculadoEn: new Date(at).toISOString() }
    this.cache = { at, value }
    return value
  }

  /** Test-only / tras borrar archivos: fuerza el recorrido en la próxima lectura. */
  invalidate(): void {
    this.cache = null
  }
}
