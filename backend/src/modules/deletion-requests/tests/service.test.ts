// deletion-requests/tests/service.test.ts — Reglas de negocio, con repo en memoria.
import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { NotFoundError, ValidationError } from 'arckode-framework'
import { DeletionRequestsService } from '../service'
import type { DeletionRequestDTO } from '../types'

function makeRepo(seed: DeletionRequestDTO[] = []) {
  const rows = new Map<string, DeletionRequestDTO>(seed.map((r) => [r.id, { ...r }]))
  const repo: RepositoryAdapter<DeletionRequestDTO> = {
    async findMany(filters: any = {}, opts: any = {}) {
      let out = [...rows.values()].filter((r) =>
        Object.entries(filters).every(([k, v]) => (r as any)[k] === v),
      )
      const order = opts.orderBy as any[] | undefined
      if (order) {
        out.sort((a, b) => {
          for (const { field, dir } of order) {
            const cmp = String((a as any)[field]).localeCompare(String((b as any)[field]))
            if (cmp !== 0) return dir === 'desc' || dir === 'DESC' ? -cmp : cmp
          }
          return 0
        })
      }
      return out
    },
    async findOne(filters: any) {
      return (
        [...rows.values()].find((r) =>
          Object.entries(filters).every(([k, v]) => (r as any)[k] === v),
        ) ?? null
      )
    },
    async findById(id: string) {
      return rows.get(id) ?? null
    },
    async create(data: any) {
      const row = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...data,
      } as DeletionRequestDTO
      rows.set(row.id, row)
      return row
    },
    async update(id: string, data: any) {
      const cur = rows.get(id)
      if (!cur) return null
      const next = { ...cur, ...data, updatedAt: new Date().toISOString() }
      rows.set(id, next)
      return next
    },
    async delete(id: string) {
      rows.delete(id)
    },
  } as any
  return { repo, rows }
}

const log = { info: () => {}, debug: () => {}, warn: () => {}, error: () => {}, child: () => log } as unknown as Logger

function request(partial: Partial<DeletionRequestDTO> & { id: string }): DeletionRequestDTO {
  return {
    requestNumber: 'DEL-AAAAAAAA',
    fullName: 'Juan Pérez',
    contactHandle: '+1 809-000-0000',
    hotelName: null,
    status: 'received',
    notes: null,
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
    ...partial,
  }
}

describe('deletion-requests — formulario público', () => {
  it('crea la solicitud con status=received y devuelve SOLO el acuse (requestNumber)', async () => {
    const svc = new DeletionRequestsService(makeRepo().repo, log)
    const ack = await svc.create({ fullName: 'Juan Pérez', contactHandle: '8095550000' })
    expect(ack.requestNumber).toMatch(/^DEL-[A-Z0-9]{8}$/)
    expect(ack).not.toHaveProperty('status')
    expect(ack).not.toHaveProperty('fullName')
  })

  it('genera un requestNumber distinto por cada solicitud', async () => {
    const svc = new DeletionRequestsService(makeRepo().repo, log)
    const a = await svc.create({ fullName: 'A', contactHandle: '1' })
    const b = await svc.create({ fullName: 'B', contactHandle: '2' })
    expect(a.requestNumber).not.toBe(b.requestNumber)
  })

  it('hotelName es opcional: sin dato queda null', async () => {
    const { repo, rows } = makeRepo()
    const svc = new DeletionRequestsService(repo, log)
    await svc.create({ fullName: 'Juan', contactHandle: '809' })
    const [row] = [...rows.values()]
    expect(row.hotelName).toBeNull()
  })
})

describe('deletion-requests — gestión admin', () => {
  it('lista todas, más recientes primero', async () => {
    const { repo } = makeRepo([
      request({ id: '1', createdAt: '2026-08-01T00:00:00.000Z' }),
      request({ id: '2', createdAt: '2026-08-20T00:00:00.000Z' }),
    ])
    const svc = new DeletionRequestsService(repo, log)
    const { data } = await svc.list()
    expect(data.map((r) => r.id)).toEqual(['2', '1'])
  })

  it('avanza el status del flujo received → verifying → completed', async () => {
    const { repo } = makeRepo([request({ id: '1' })])
    const svc = new DeletionRequestsService(repo, log)
    const v = await svc.updateStatus('1', { status: 'verifying' })
    expect(v.status).toBe('verifying')
    const c = await svc.updateStatus('1', { status: 'completed' })
    expect(c.status).toBe('completed')
  })

  it('rechaza un status fuera del enum', async () => {
    const { repo } = makeRepo([request({ id: '1' })])
    const svc = new DeletionRequestsService(repo, log)
    expect(svc.updateStatus('1', { status: 'ignorada' as any })).rejects.toBeInstanceOf(ValidationError)
  })

  it('guarda notas internas sin tocar los datos del solicitante', async () => {
    const { repo } = makeRepo([request({ id: '1', fullName: 'Juan Pérez' })])
    const svc = new DeletionRequestsService(repo, log)
    const updated = await svc.updateStatus('1', { notes: 'Identidad verificada por WhatsApp' })
    expect(updated.notes).toBe('Identidad verificada por WhatsApp')
    expect(updated.fullName).toBe('Juan Pérez')
  })

  it('404 al actualizar o eliminar una solicitud inexistente', async () => {
    const svc = new DeletionRequestsService(makeRepo().repo, log)
    expect(svc.updateStatus('no-existe', { status: 'verifying' })).rejects.toBeInstanceOf(NotFoundError)
    expect(svc.remove('no-existe')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('elimina una solicitud existente', async () => {
    const { repo, rows } = makeRepo([request({ id: '1' })])
    const svc = new DeletionRequestsService(repo, log)
    await svc.remove('1')
    expect(rows.has('1')).toBe(false)
  })
})
