// Convierte un HEVC real (hecho con ffmpeg acá mismo) y comprueba que la salida
// es lo que el navegador sí sabe leer: H.264, 720p y con el índice adelante.
//
// Si la máquina no tiene ffmpeg, los casos que lo necesitan se saltean en vez de
// fallar: el conversor es opcional y el resto del módulo funciona sin él.
import { describe, it, expect, beforeAll } from 'bun:test'
import { unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RepositoryAdapter } from 'arckode-framework'
import { VideoTranscoder } from '../usecases/transcode'
import { probeMp4 } from '../usecases/mp4-probe'
import type { HousekeepingDTO, VideoEvidence } from '../types'
import type { S3StorageAdapter } from '../../../infrastructure/storage/s3-adapter'

let hasFfmpeg = false
beforeAll(async () => {
  hasFfmpeg = (await Bun.spawn(['sh', '-c', 'command -v ffmpeg']).exited) === 0
})

/** Genera un mp4 HEVC de prueba, como los que sube el teléfono. */
async function makeHevc(seconds = 1): Promise<Uint8Array | null> {
  // Nombre único por invocación: con Date.now() dos llamadas dentro del mismo
  // milisegundo comparten archivo, y el patrón crear→leer→borrar de acá abajo hace
  // que una borre el temporal de la otra (ENOENT intermitente al leerlo).
  const out = join(tmpdir(), `hk-test-hevc-${crypto.randomUUID()}.mp4`)
  const ok = await Bun.spawn([
    'ffmpeg', '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `testsrc=size=1280x720:rate=10:duration=${seconds}`,
    '-c:v', 'libx265', '-tag:v', 'hvc1', '-preset', 'ultrafast', '-crf', '35',
    out,
  ], { stderr: 'pipe' }).exited
  if (ok !== 0) return null
  const bytes = new Uint8Array(await Bun.file(out).arrayBuffer())
  await unlink(out).catch(() => {})
  return bytes
}

/** Bucket en memoria: guarda lo que se sube y sirve rangos como Backblaze. */
function fakeBucket(initial: Record<string, Uint8Array>) {
  const files = { ...initial }
  const s3 = {
    statSize: async (k: string) => files[k]?.length ?? null,
    readRange: async (k: string, s: number, e: number) =>
      files[k] ? files[k]!.subarray(s, Math.min(e, files[k]!.length)) : null,
    readAll: async (k: string) => files[k] ?? null,
    putAt: async (k: string, b: Uint8Array) => { files[k] = b },
    delete: async (k: string) => { delete files[k] },
    getUrl: (k: string) => `https://bucket/${k}`,
  } as unknown as S3StorageAdapter
  return { s3, files }
}

function fakeRepo() {
  const saved: VideoEvidence[] = []
  const repo = {
    update: async (_id: string, patch: any) => { saved.push(patch.video); return {} as HousekeepingDTO },
  } as unknown as RepositoryAdapter<HousekeepingDTO>
  return { repo, saved }
}

const hevcVideo: VideoEvidence = {
  url: 'https://bucket/housekeeping/t1/video/evidence.mp4',
  path: 'housekeeping/t1/video/evidence.mp4',
  durationSeconds: 1,
  mimeType: 'video/mp4',
  uploadedAt: '2026-07-18T00:00:00Z',
  codec: 'hvc1',
  playableInBrowser: false,
}

describe('VideoTranscoder', () => {
  it('convierte el HEVC a algo que el navegador puede reproducir', async () => {
    if (!hasFfmpeg) return
    const source = await makeHevc()
    if (!source) return

    // El archivo de partida es efectivamente el que Chrome no sabe leer.
    const { s3, files } = fakeBucket({ [hevcVideo.path]: source })
    const before = await probeMp4(s3, hevcVideo.path)
    expect(before?.codec).toBe('hvc1')
    expect(before?.playableInBrowser).toBe(false)

    const { repo, saved } = fakeRepo()
    const ok = await new VideoTranscoder(repo, s3).run('t1', hevcVideo)
    expect(ok).toBe(true)

    const final = saved.at(-1)!
    expect(final.playableInBrowser).toBe(true)
    expect(final.codec).toBe('avc1')
    expect(final.originalCodec).toBe('hvc1')
    expect(final.transcoding).toBe(false)

    // Y el archivo nuevo lo confirma, no solo el registro.
    const after = await probeMp4(s3, final.path)
    expect(after?.codec).toBe('avc1')
    expect(after?.height).toBeLessThanOrEqual(720)

    // El original se reemplaza: no quedan dos copias ocupando el bucket.
    expect(files[hevcVideo.path]).toBeUndefined()
    expect(files[final.path]).toBeDefined()
  }, 120_000)

  it('marca "procesando" mientras trabaja y lo apaga al terminar', async () => {
    if (!hasFfmpeg) return
    const source = await makeHevc()
    if (!source) return
    const { s3 } = fakeBucket({ [hevcVideo.path]: source })
    const { repo, saved } = fakeRepo()
    await new VideoTranscoder(repo, s3).run('t1', hevcVideo)
    expect(saved[0]!.transcoding).toBe(true)
    expect(saved.at(-1)!.transcoding).toBe(false)
  }, 120_000)

  it('si el objeto no está en el bucket, no se pierde la evidencia', async () => {
    const { s3 } = fakeBucket({})
    const { repo, saved } = fakeRepo()
    const ok = await new VideoTranscoder(repo, s3).run('t1', hevcVideo)
    expect(ok).toBe(false)
    // Queda el video original, sin "procesando" colgado para siempre.
    expect(saved.at(-1)!.path).toBe(hevcVideo.path)
    expect(saved.at(-1)!.transcoding).toBe(false)
  })

  it('no toca un video que el navegador ya puede reproducir', async () => {
    const { s3 } = fakeBucket({})
    const { repo, saved } = fakeRepo()
    new VideoTranscoder(repo, s3).scheduleIfNeeded('t1', {
      ...hevcVideo, codec: 'avc1', playableInBrowser: true,
    })
    expect(saved).toHaveLength(0)
  })
})
