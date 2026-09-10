// shared/observability/system-health.ts — proceso, SO y disco de la partición de la aplicación.
// El CPU se calcula por diferencia entre dos muestras de process.cpuUsage() (nunca el acumulado):
// la primera lectura no tiene con qué comparar y devuelve null.
import * as os from 'node:os'
import { statfs } from 'node:fs/promises'

export interface SystemHealthOptions {
  appDir?: string
  cpuUsage?: () => NodeJS.CpuUsage
  hrtime?: () => bigint
}

export interface SystemHealthReading {
  proceso: { uptimeS: number; memoriaRssMb: number; memoriaHeapMb: number; cpuPct: number | null }
  so: { uptimeS: number; cargas: number[]; memoriaTotalMb: number; memoriaLibreMb: number }
  disco?: { totalBytes: number; libreBytes: number; usadoPct: number }
}

const BYTES_PER_MB = 1024 * 1024
const NS_PER_US = 1000n

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function toMb(bytes: number): number {
  return round1(bytes / BYTES_PER_MB)
}

async function readDisk(dir: string): Promise<SystemHealthReading['disco'] | undefined> {
  try {
    const st = await statfs(dir)
    const totalBytes = Number(st.blocks) * Number(st.bsize)
    const libreBytes = Number(st.bavail) * Number(st.bsize)
    if (!totalBytes) return undefined
    return { totalBytes, libreBytes, usadoPct: round1(((totalBytes - libreBytes) / totalBytes) * 100) }
  } catch {
    return undefined
  }
}

export class SystemHealth {
  private readonly appDir: string
  private readonly cpuUsage: () => NodeJS.CpuUsage
  private readonly hrtime: () => bigint
  private last: { cpuUs: number; at: bigint } | null = null

  constructor(opts: SystemHealthOptions = {}) {
    this.appDir = opts.appDir ?? process.cwd()
    this.cpuUsage = opts.cpuUsage ?? (() => process.cpuUsage())
    this.hrtime = opts.hrtime ?? (() => process.hrtime.bigint())
  }

  /** % de CPU del intervalo desde la lectura anterior; null en la primera. */
  private sampleCpu(): number | null {
    const usage = this.cpuUsage()
    const cpuUs = usage.user + usage.system
    const at = this.hrtime()
    const prev = this.last
    this.last = { cpuUs, at }
    if (!prev) return null
    const elapsedUs = Number((at - prev.at) / NS_PER_US)
    if (elapsedUs <= 0) return null
    return round1(((cpuUs - prev.cpuUs) / elapsedUs) * 100)
  }

  async read(): Promise<SystemHealthReading> {
    const cpuPct = this.sampleCpu()
    const mem = process.memoryUsage()
    const disco = await readDisk(this.appDir)
    const reading: SystemHealthReading = {
      proceso: {
        uptimeS: Math.round(process.uptime()),
        memoriaRssMb: toMb(mem.rss),
        memoriaHeapMb: toMb(mem.heapUsed),
        cpuPct,
      },
      so: {
        uptimeS: Math.round(os.uptime()),
        cargas: os.loadavg().map(round1),
        memoriaTotalMb: toMb(os.totalmem()),
        memoriaLibreMb: toMb(os.freemem()),
      },
    }
    if (disco) reading.disco = disco
    return reading
  }
}
