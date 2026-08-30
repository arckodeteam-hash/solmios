// sales-leads/tests/service.test.ts — Reglas de negocio, con repo en memoria.
import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { NotFoundError, ValidationError } from 'arckode-framework'
import { SalesLeadsService } from '../service'
import type { SalesLeadDTO } from '../types'

function makeRepo(seed: SalesLeadDTO[] = []) {
  const rows = new Map<string, SalesLeadDTO>(seed.map((r) => [r.id, { ...r }]))
  const repo: RepositoryAdapter<SalesLeadDTO> = {
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
      } as SalesLeadDTO
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

function lead(partial: Partial<SalesLeadDTO> & { id: string }): SalesLeadDTO {
  return {
    fullName: 'Juan Pérez',
    email: 'juan@test.com',
    phone: null,
    hotelName: null,
    roomsRange: null,
    message: null,
    planInterest: null,
    status: 'new',
    notes: null,
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
    ...partial,
  }
}

describe('sales-leads — formulario público', () => {
  it('crea el lead con status=new y devuelve solo el acuse', async () => {
    const svc = new SalesLeadsService(makeRepo().repo, log)
    const ack = await svc.create({ fullName: 'Juan Pérez', email: 'juan@test.com' })
    expect(ack).toEqual({ received: true })
  })

  it('hotelName/phone/message/planInterest son opcionales: sin dato quedan null', async () => {
    const { repo, rows } = makeRepo()
    const svc = new SalesLeadsService(repo, log)
    await svc.create({ fullName: 'Juan', email: 'juan@test.com' })
    const [row] = [...rows.values()]
    expect(row.hotelName).toBeNull()
    expect(row.phone).toBeNull()
    expect(row.message).toBeNull()
    expect(row.planInterest).toBeNull()
    expect(row.status).toBe('new')
  })

  it('guarda el planInterest cuando viene de "Contactar ventas" en un plan a cotización', async () => {
    const { repo, rows } = makeRepo()
    const svc = new SalesLeadsService(repo, log)
    await svc.create({ fullName: 'Juan', email: 'juan@test.com', planInterest: 'ultra' })
    const [row] = [...rows.values()]
    expect(row.planInterest).toBe('ultra')
  })

  it('sin emailSender configurado, igual crea el lead (no rompe el formulario)', async () => {
    const svc = new SalesLeadsService(makeRepo().repo, log)
    const ack = await svc.create({ fullName: 'Juan', email: 'juan@test.com' })
    expect(ack.received).toBe(true)
  })
})

describe('sales-leads — emails (acuse + aviso a ventas)', () => {
  function makeEmailSender() {
    const sent: Array<{ to: string; subject: string }> = []
    const emailSender = { enqueue: async (input: { to: string; subject: string }) => { sent.push({ to: input.to, subject: input.subject }); return 'queued-id' } }
    return { emailSender, sent }
  }

  it('manda acuse al lead Y aviso a ventas', async () => {
    const svc = new SalesLeadsService(makeRepo().repo, log)
    const { emailSender, sent } = makeEmailSender()
    svc.setEmailDeps(emailSender)
    await svc.create({ fullName: 'Juan', email: 'juan@test.com' })
    expect(sent.map((s) => s.to)).toEqual(['juan@test.com', 'ventas@solmios.com'])
  })

  it('si el envío falla, el lead igual queda creado (best-effort, no revienta el submit)', async () => {
    const svc = new SalesLeadsService(makeRepo().repo, log)
    svc.setEmailDeps({ enqueue: async () => { throw new Error('SMTP caído') } })
    const ack = await svc.create({ fullName: 'Juan', email: 'juan@test.com' })
    expect(ack.received).toBe(true)
  })
})

describe('sales-leads — gestión admin', () => {
  it('lista todos, más recientes primero', async () => {
    const { repo } = makeRepo([
      lead({ id: '1', createdAt: '2026-08-01T00:00:00.000Z' }),
      lead({ id: '2', createdAt: '2026-08-20T00:00:00.000Z' }),
    ])
    const svc = new SalesLeadsService(repo, log)
    const { data } = await svc.list()
    expect(data.map((r) => r.id)).toEqual(['2', '1'])
  })

  it('avanza el status del flujo new → contacted → won', async () => {
    const { repo } = makeRepo([lead({ id: '1' })])
    const svc = new SalesLeadsService(repo, log)
    const c = await svc.updateStatus('1', { status: 'contacted' })
    expect(c.status).toBe('contacted')
    const w = await svc.updateStatus('1', { status: 'won' })
    expect(w.status).toBe('won')
  })

  it('rechaza un status fuera del enum', async () => {
    const { repo } = makeRepo([lead({ id: '1' })])
    const svc = new SalesLeadsService(repo, log)
    expect(svc.updateStatus('1', { status: 'ignorado' as any })).rejects.toBeInstanceOf(ValidationError)
  })

  it('guarda notas internas sin tocar los datos del lead', async () => {
    const { repo } = makeRepo([lead({ id: '1', fullName: 'Juan Pérez' })])
    const svc = new SalesLeadsService(repo, log)
    const updated = await svc.updateStatus('1', { notes: 'Contactado por WhatsApp' })
    expect(updated.notes).toBe('Contactado por WhatsApp')
    expect(updated.fullName).toBe('Juan Pérez')
  })

  it('404 al actualizar o eliminar un lead inexistente', async () => {
    const svc = new SalesLeadsService(makeRepo().repo, log)
    expect(svc.updateStatus('no-existe', { status: 'contacted' })).rejects.toBeInstanceOf(NotFoundError)
    expect(svc.remove('no-existe')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('elimina un lead existente', async () => {
    const { repo, rows } = makeRepo([lead({ id: '1' })])
    const svc = new SalesLeadsService(repo, log)
    await svc.remove('1')
    expect(rows.has('1')).toBe(false)
  })
})
