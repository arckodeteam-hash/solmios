// REQ-MON-05 — backups: lista derivada del directorio, id nunca concatenado a una ruta, retención
// por cantidad, tope de tiempo, pg_dump ausente explicado, sqlite copiado de forma consistente.
import { describe, it, expect } from 'bun:test'
import * as fsp from 'node:fs/promises'
import { mkdtempSync, writeFileSync, utimesSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { Database } from 'bun:sqlite'
import {
  BackupsStore, DEFAULT_BACKUP_DIR, resolveBackupDir, resolveRetentionCount, type BackupsFs,
} from '../observability/backups'
import { postgresDump, sqliteDump, backupDumpFromEnv, type BackupDump, type ProcessRunner } from '../observability/backup-dump'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'bk-'))
}

/** fs real que registra cada ruta tocada, para probar que nada sale del directorio. */
function recordingFs(): BackupsFs & { paths: string[] } {
  const paths: string[] = []
  const track = <T,>(p: string, v: Promise<T>) => { paths.push(p); return v }
  return {
    paths,
    mkdir: (p, o) => track(p, fsp.mkdir(p, o)),
    readdir: (p, o) => track(p, fsp.readdir(p, o)),
    stat: (p) => track(p, fsp.stat(p)),
    unlink: (p) => track(p, fsp.unlink(p)),
    rename: (a, b) => { paths.push(a, b); return fsp.rename(a, b) },
  }
}

/** Dump falso: escribe `content` en el destino (o se cuelga hasta el abort si `hang`). */
function fakeDump(content = 'dump', hang = false): BackupDump & { destinos: string[] } {
  const destinos: string[] = []
  return {
    motor: 'sqlite',
    extension: 'sql',
    destinos,
    run({ destino, signal }) {
      destinos.push(destino)
      if (!hang) {
        writeFileSync(destino, content)
        return Promise.resolve()
      }
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('abortado'))))
    },
  }
}

function seed(dir: string, name: string, ageSeconds: number, bytes = 10): void {
  const p = join(dir, name)
  writeFileSync(p, Buffer.alloc(bytes))
  const t = (Date.now() - ageSeconds * 1000) / 1000
  utimesSync(p, t, t)
}

describe('BackupsStore — directorio y lista', () => {
  it('crea el directorio si falta y lista sólo archivos de backup, más nuevo primero', async () => {
    const root = tempDir()
    const dir = join(root, 'nested', 'backups')
    try {
      const store = new BackupsStore({ dir, retentionCount: 5 })
      expect(await store.list()).toEqual([])
      expect(existsSync(dir)).toBe(true)
      seed(dir, 'backup-old.sql', 60, 5)
      seed(dir, 'backup-new.sqlite', 1, 7)
      seed(dir, 'notas.txt', 0)
      seed(dir, 'backup-parcial.sql.part', 0)
      await fsp.mkdir(join(dir, 'carpeta.sql'))
      const list = await store.list()
      expect(list.map((f) => f.id)).toEqual(['backup-new.sqlite', 'backup-old.sql'])
      expect(list[0]).toMatchObject({ bytes: 7 })
      expect(typeof list[0]!.creadoEn).toBe('string')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('el dir por defecto está en backend/data y no cae bajo frontend/dist ni uploads', () => {
    const segments = DEFAULT_BACKUP_DIR.split(sep)
    expect(segments.slice(-3)).toEqual(['backend', 'data', 'backups'])
    expect(DEFAULT_BACKUP_DIR).not.toMatch(/frontend[\\/]dist/)
    expect(segments).not.toContain('uploads')
    expect(segments).not.toContain('dist')
    expect(resolveBackupDir({})).toBe(DEFAULT_BACKUP_DIR)
    expect(resolveBackupDir({ BACKUP_DIR: '/var/backups/solmios' })).toBe('/var/backups/solmios')
    expect(resolveRetentionCount({})).toBe(10)
    expect(resolveRetentionCount({ BACKUP_RETENTION_COUNT: '3' })).toBe(3)
    expect(resolveRetentionCount({ BACKUP_RETENTION_COUNT: '0' })).toBe(10)
    expect(resolveRetentionCount({ BACKUP_RETENTION_COUNT: 'x' })).toBe(10)
  })
})

describe('BackupsStore — find / remove sin path traversal', () => {
  it('id ../../etc/passwd → null y ningún acceso fuera del directorio', async () => {
    const dir = tempDir()
    const fs = recordingFs()
    try {
      seed(dir, 'backup-a.sql', 1)
      const store = new BackupsStore({ dir, fs })
      expect(await store.find('../../etc/passwd')).toBeNull()
      expect(await store.pathOf('../../etc/passwd')).toBeNull()
      expect(await store.remove('../../etc/passwd')).toBe(false)
      expect(await store.find('backup-a.sql/../../../etc/passwd')).toBeNull()
      expect(await store.find('/etc/passwd')).toBeNull()
      expect(fs.paths.length).toBeGreaterThan(0)
      for (const p of fs.paths) expect(p.startsWith(dir + sep) || p === dir).toBe(true)
      expect(fs.paths.some((p) => p.includes('passwd'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('find exige coincidencia exacta; remove borra sólo el pedido', async () => {
    const dir = tempDir()
    try {
      seed(dir, 'backup-a.sql', 2)
      seed(dir, 'backup-b.sql', 1)
      const store = new BackupsStore({ dir })
      expect(await store.find('backup-a')).toBeNull()
      expect(await store.find('BACKUP-A.SQL')).toBeNull()
      expect((await store.find('backup-a.sql'))?.id).toBe('backup-a.sql')
      expect(await store.pathOf('backup-b.sql')).toBe(join(dir, 'backup-b.sql'))
      expect(await store.remove('backup-a.sql')).toBe(true)
      expect(readdirSync(dir)).toEqual(['backup-b.sql'])
      expect(await store.remove('backup-a.sql')).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('BackupsStore — create, retención y tope de tiempo', () => {
  it('escribe en .part dentro del dir, renombra al final y devuelve metadata', async () => {
    const dir = tempDir()
    try {
      const store = new BackupsStore({ dir, retentionCount: 3, now: () => new Date('2026-09-10T12:34:56.789Z') })
      const dump = fakeDump('hola')
      const { archivo, eliminados } = await store.create(dump)
      expect(dump.destinos[0]).toBe(join(dir, 'backup-20260910-123456-789.sql.part'))
      expect(archivo).toMatchObject({ id: 'backup-20260910-123456-789.sql', bytes: 4 })
      expect(eliminados).toEqual([])
      expect(readdirSync(dir)).toEqual(['backup-20260910-123456-789.sql'])
      // mismo instante otra vez → no pisa el anterior
      const second = await store.create(fakeDump('x'))
      expect(second.archivo.id).toBe('backup-20260910-123456-789-2.sql')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('con retención N, el backup N+1 borra el más viejo', async () => {
    const dir = tempDir()
    try {
      const N = 3
      seed(dir, 'backup-1.sql', 300)
      seed(dir, 'backup-2.sql', 200)
      seed(dir, 'backup-3.sql', 100)
      const store = new BackupsStore({ dir, retentionCount: N })
      const { archivo, eliminados } = await store.create(fakeDump())
      expect(eliminados).toEqual(['backup-1.sql'])
      const ids = (await store.list()).map((f) => f.id)
      expect(ids).toHaveLength(N)
      expect(ids[0]).toBe(archivo.id)
      expect(ids).toEqual([archivo.id, 'backup-3.sql', 'backup-2.sql'])
      expect(existsSync(join(dir, 'backup-1.sql'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('si el dump falla, no queda ni el .part ni el archivo final', async () => {
    const dir = tempDir()
    try {
      const store = new BackupsStore({ dir })
      const dump: BackupDump = {
        motor: 'postgres', extension: 'sql',
        async run({ destino }) { writeFileSync(destino, 'a medias'); throw new Error('pg_dump salió con código 1: boom') },
      }
      await expect(store.create(dump)).rejects.toThrow(/pg_dump/)
      expect(readdirSync(dir)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('superado el tope de tiempo: aborta la señal, limpia el parcial y falla explicando', async () => {
    const dir = tempDir()
    try {
      const store = new BackupsStore({ dir, timeoutMs: 20 })
      const dump = fakeDump('', true)
      await expect(store.create(dump)).rejects.toThrow(/tope de/)
      expect(readdirSync(dir)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('backup-dump — postgres', () => {
  const signal = new AbortController().signal

  it('binario pg_dump ausente → error explicativo que nombra pg_dump (which)', async () => {
    let called = false
    const runner: ProcessRunner = async () => { called = true; return { code: 0, stderr: '' } }
    const dump = postgresDump('postgres://u:p@h/db', { runner, which: () => null })
    await expect(dump.run({ destino: '/tmp/x.sql', signal })).rejects.toThrow(/pg_dump/)
    expect(called).toBe(false)
  })

  it('binario pg_dump ausente → también si el spawn falla con ENOENT', async () => {
    const runner: ProcessRunner = async () => { throw Object.assign(new Error('spawn failed'), { code: 'ENOENT' }) }
    const dump = postgresDump('postgres://u:p@h/db', { runner, which: () => '/usr/bin/pg_dump' })
    await expect(dump.run({ destino: '/tmp/x.sql', signal })).rejects.toThrow(/pg_dump.*instal/i)
  })

  it('invoca pg_dump con la DATABASE_URL y el destino; código ≠ 0 → error con stderr', async () => {
    const calls: string[][] = []
    const runner: ProcessRunner = async (cmd) => { calls.push(cmd); return { code: 0, stderr: '' } }
    const dump = postgresDump('postgres://u:p@h/db', { runner, which: () => '/usr/bin/pg_dump' })
    expect(dump.motor).toBe('postgres')
    expect(dump.extension).toBe('sql')
    await dump.run({ destino: '/tmp/out.sql.part', signal })
    expect(calls[0]![0]).toBe('pg_dump')
    expect(calls[0]).toContain('--file=/tmp/out.sql.part')
    expect(calls[0]).toContain('--dbname=postgres://u:p@h/db')

    const failing = postgresDump('postgres://u:p@h/db', {
      runner: async () => ({ code: 1, stderr: 'connection refused' }), which: () => '/usr/bin/pg_dump',
    })
    await expect(failing.run({ destino: '/tmp/x', signal })).rejects.toThrow(/pg_dump.*1.*connection refused/)
  })
})

describe('backup-dump — sqlite', () => {
  it('copia consistente: la copia abre y contiene las filas (incluidas las del WAL)', async () => {
    const dir = tempDir()
    try {
      const src = join(dir, 'app.db')
      const db = new Database(src)
      db.exec('PRAGMA journal_mode = WAL')
      db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)')
      db.run("INSERT INTO t (v) VALUES ('a'), ('b'), ('c')")
      const dump = sqliteDump(src)
      expect(dump.motor).toBe('sqlite')
      const destino = join(dir, 'copia.sqlite.part')
      await dump.run({ destino, signal: new AbortController().signal })
      const copy = new Database(destino, { readonly: true })
      expect(copy.query('SELECT count(*) AS n FROM t').get()).toEqual({ n: 3 })
      copy.close()
      db.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('backupDumpFromEnv elige el motor como composition-root', () => {
    expect(backupDumpFromEnv({ DATABASE_URL: 'postgres://x' }).motor).toBe('postgres')
    expect(backupDumpFromEnv({ DB_PATH: '/tmp/a.db' }).motor).toBe('sqlite')
    expect(backupDumpFromEnv({}).motor).toBe('sqlite')
  })
})
