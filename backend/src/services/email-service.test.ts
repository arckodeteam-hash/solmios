// services/email-service.test.ts — Tests del EmailService (cola + backoff + providers).
// Sin tocar SQLite ni SMTP real: mock.module intercepta nodemailer y resend.

import { describe, it, expect, mock, beforeEach } from 'bun:test'
import type { RepositoryAdapter } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'

// ─── Mocks de transports (registrados antes del import del service) ─────────
const sendMailMock = mock(async () => ({ messageId: 'mocked-smtp' }))
mock.module('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: sendMailMock }) },
}))

const resendSendMock = mock(async () => ({ error: null }))
mock.module('resend', () => ({
  Resend: class MockResend {
    emails = { send: resendSendMock }
  },
}))

import { EmailService, renderTemplate } from './email-service'
import type { EmailQueueDTO } from './email-service'

const log = silentLogger()

// ─── Fakes ──────────────────────────────────────────────────────────────────

/** Repo de Configuration configurable por key. */
function makeConfigRepo(byKey: Record<string, unknown> = {}): RepositoryAdapter<Record<string, unknown>> {
  return {
    findMany: async () => [],
    findById: async () => null,
    findOne: async (f: { key?: string }) => (f && f.key && f.key in byKey ? { value: byKey[f.key] } : null),
    create: async () => ({}),
    update: async () => ({}),
    delete: async () => true,
    count: async () => 0,
    paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0 }),
  } as unknown as RepositoryAdapter<Record<string, unknown>>
}

/** Repo de cola con store en memoria. forceDue ignora nextRetryAt (para testear backoff). */
function makeQueueRepo(opts: { forceDue?: boolean } = {}): RepositoryAdapter<EmailQueueDTO> & { _store: Map<string, EmailQueueDTO> } {
  const store = new Map<string, EmailQueueDTO>()
  const repo = {
    _store: store,
    findMany: async () => [...store.values()].map((r) => (opts.forceDue ? { ...r, nextRetryAt: null } : r)),
    findOne: async (f: { id?: string; status?: string }) =>
      [...store.values()].find((r) => (!f?.id || r.id === f.id) && (!f?.status || r.status === f.status)) ?? null,
    create: async (data: Partial<EmailQueueDTO>) => {
      const row = { id: `q-${store.size + 1}`, attempts: 0, maxAttempts: 3, ...data } as EmailQueueDTO
      store.set(row.id, row)
      return row
    },
    update: async (id: string, data: Partial<EmailQueueDTO>) => {
      const r = store.get(id)
      if (r) Object.assign(r, data, { updatedAt: new Date().toISOString() })
      return r as EmailQueueDTO
    },
    delete: async () => true,
    count: async () => store.size,
    paginate: async () => ({ data: [...store.values()], total: store.size, limit: 20, offset: 0, pages: 1 }),
  }
  return repo as unknown as RepositoryAdapter<EmailQueueDTO> & { _store: Map<string, EmailQueueDTO> }
}

const SMTP_CFG = { host: 'smtp.test', port: 587, user: 'u', pass: 'p', from: 'h@test.com' }

// ─── Tests renderTemplate (puro) ────────────────────────────────────────────

describe('renderTemplate', () => {
  it('reemplaza las variables presentes (incluye vacías)', () => {
    const out = renderTemplate('Hola {guest_name} hab {room_number} loc {locator}!', {
      guest_name: 'María',
      room_number: 101,
      locator: '',
    })
    expect(out).toBe('Hola María hab 101 loc !')
  })

  it('deja literales las variables ausentes (no rompe)', () => {
    const out = renderTemplate('{guest_name} {wifi_password}', { guest_name: 'Pepe' })
    expect(out).toBe('Pepe {wifi_password}')
  })
})

// ─── Tests EmailService ─────────────────────────────────────────────────────

describe('EmailService', () => {
  beforeEach(() => {
    sendMailMock.mockClear()
    resendSendMock.mockClear()
  })

  describe('enqueue', () => {
    it('rechaza recipient inválido', async () => {
      const svc = new EmailService(makeConfigRepo(), makeQueueRepo(), log)
      await expect(svc.enqueue({ to: 'no-email', subject: 's', html: '<p/>', hotelId: 'h1' })).rejects.toThrow(/recipient/i)
    })

    it('rechaza HTML mayor a 500KB', async () => {
      const svc = new EmailService(makeConfigRepo(), makeQueueRepo(), log)
      const huge = '<p>' + 'x'.repeat(500_001) + '</p>'
      await expect(svc.enqueue({ to: 'a@b.com', subject: 's', html: huge, hotelId: 'h1' })).rejects.toThrow(/500KB|payload/i)
    })

    it('crea una fila pending y devuelve su id', async () => {
      const queue = makeQueueRepo()
      const svc = new EmailService(makeConfigRepo(), makeQueueRepo(), log)
      // Forzamos un queueRepo propio para inspeccionar el store.
      const svc2 = new EmailService(makeConfigRepo(), queue, log)
      const id = await svc2.enqueue({ to: 'a@b.com', subject: 'Hola', html: '<p>{guest_name}</p>', hotelId: 'h1', variables: { guest_name: 'Ana' } })
      expect(id).toBe('q-1')
      const row = queue._store.get('q-1')
      expect(row?.status).toBe('pending')
      expect(row?.html).toBe('<p>Ana</p>') // variables interpoladas al encolar
      expect(row?.recipient).toBe('a@b.com')
    })
  })

  describe('processQueue — backoff y fallo', () => {
    it('sin provider: reintenta 3 veces y termina en failed', async () => {
      const queue = makeQueueRepo({ forceDue: true })
      const svc = new EmailService(makeConfigRepo(), queue, log)
      await queue.create({ hotelId: 'h1', recipient: 'a@b.com', subject: 's', html: '<p/>', status: 'pending', maxAttempts: 3 } as any)

      await svc.processQueue() // intento 1 → fail → attempts 1
      let row = queue._store.get('q-1')!
      expect(row.status).toBe('pending')
      expect(row.attempts).toBe(1)
      expect(row.nextRetryAt).not.toBeNull()

      await svc.processQueue() // intento 2 → attempts 2
      row = queue._store.get('q-1')!
      expect(row.attempts).toBe(2)
      expect(row.status).toBe('pending')

      await svc.processQueue() // intento 3 → agota → failed
      row = queue._store.get('q-1')!
      expect(row.attempts).toBe(3)
      expect(row.status).toBe('failed')
      expect(row.lastError).toContain('no provider configured')
    })

    it('es reentrante-safe (guard processing)', async () => {
      const queue = makeQueueRepo({ forceDue: true })
      const svc = new EmailService(makeConfigRepo(), queue, log)
      await queue.create({ hotelId: 'h1', recipient: 'a@b.com', subject: 's', html: '<p/>', status: 'pending', maxAttempts: 3 } as any)
      // Dos llamadas concurrentes: solo una procesa.
      await Promise.all([svc.processQueue(), svc.processQueue()])
      expect(queue._store.get('q-1')!.attempts).toBe(1) // no duplicó el intento
    })
  })

  describe('processQueue — envío exitoso', () => {
    it('usa SMTP cuando email_config está configurado', async () => {
      const queue = makeQueueRepo({ forceDue: true })
      const svc = new EmailService(makeConfigRepo({ email_config: SMTP_CFG }), queue, log)
      await queue.create({ hotelId: 'h1', recipient: 'a@b.com', subject: 's', html: '<p/>', status: 'pending', maxAttempts: 3 } as any)

      await svc.processQueue()

      const row = queue._store.get('q-1')!
      expect(row.status).toBe('sent')
      expect(row.provider).toBe('smtp')
      expect(sendMailMock).toHaveBeenCalledTimes(1)
    })

    it('cae a Resend cuando no hay SMTP pero sí resend_api_key', async () => {
      const queue = makeQueueRepo({ forceDue: true })
      const svc = new EmailService(makeConfigRepo({ resend_api_key: 'rk_test_123' }), queue, log)
      await queue.create({ hotelId: 'h1', recipient: 'a@b.com', subject: 's', html: '<p/>', status: 'pending', maxAttempts: 3 } as any)

      await svc.processQueue()

      const row = queue._store.get('q-1')!
      expect(row.status).toBe('sent')
      expect(row.provider).toBe('resend')
      expect(resendSendMock).toHaveBeenCalledTimes(1)
      expect(sendMailMock).not.toHaveBeenCalled()
    })
  })

  describe('adjuntos (#270)', () => {
    const PDF_BASE64 = Buffer.from('%PDF-1.4 recibo').toString('base64')
    const attachment = { filename: 'recibo-ABC123.pdf', contentType: 'application/pdf', contentBase64: PDF_BASE64 }
    /** enqueue dispara processQueue fire-and-forget: esperamos a que la fila salga de pending/processing. */
    const settle = async (queue: ReturnType<typeof makeQueueRepo>, id: string): Promise<EmailQueueDTO> => {
      for (let i = 0; i < 50; i++) {
        const row = queue._store.get(id)!
        if (row.status === 'sent' || row.status === 'failed') return row
        await new Promise((r) => setTimeout(r, 5))
      }
      throw new Error(`fila ${id} no se procesó`)
    }

    it('enqueueNotification persiste attachments en la fila y SMTP los recibe como Buffer + contentType', async () => {
      const queue = makeQueueRepo({ forceDue: true })
      const svc = new EmailService(makeConfigRepo({ email_config: SMTP_CFG }), queue, log)

      const id = await svc.enqueueNotification({
        to: 'a@b.com', hotelId: 'h1', event: 'reservation_confirmed', language: 'es',
        variables: { guest_name: 'Ana', hotel_name: 'H' },
        relatedType: 'reservation', relatedId: 'r1',
        attachments: [attachment],
      })
      expect(id).toBe('q-1')
      const row = queue._store.get('q-1')!
      expect(row.attachments).toEqual([attachment])

      await settle(queue, 'q-1')
      expect(row.status).toBe('sent')
      expect(sendMailMock).toHaveBeenCalledTimes(1)
      const mail = (sendMailMock.mock.calls[0] as unknown[])[0] as { attachments: { filename: string; content: Buffer; contentType: string }[] }
      expect(mail.attachments).toHaveLength(1)
      expect(mail.attachments[0].filename).toBe('recibo-ABC123.pdf')
      expect(mail.attachments[0].contentType).toBe('application/pdf')
      expect(Buffer.isBuffer(mail.attachments[0].content)).toBe(true)
      expect(mail.attachments[0].content.equals(Buffer.from(PDF_BASE64, 'base64'))).toBe(true)
    })

    it('sin attachments no manda la clave; attachments como JSON string (repo crudo) también se decodifica', async () => {
      const queue = makeQueueRepo({ forceDue: true })
      const svc = new EmailService(makeConfigRepo({ email_config: SMTP_CFG }), queue, log)
      await svc.enqueue({ to: 'a@b.com', subject: 's', html: '<p/>', hotelId: 'h1' })
      expect(queue._store.get('q-1')!.attachments).toBeUndefined()
      await settle(queue, 'q-1')
      await queue.create({ hotelId: 'h1', recipient: 'b@b.com', subject: 's', html: '<p/>', status: 'pending', maxAttempts: 3, attachments: JSON.stringify([attachment]) } as any)

      await svc.processQueue()

      const calls = sendMailMock.mock.calls as unknown as [{ attachments?: { content: Buffer }[] }][]
      expect(calls).toHaveLength(2)
      expect(calls[0][0].attachments).toBeUndefined()
      expect(calls[1][0].attachments?.[0].content.equals(Buffer.from(PDF_BASE64, 'base64'))).toBe(true)
    })

    it('adjuntos por encima de 8MB se descartan con warn y el correo se encola igual', async () => {
      const queue = makeQueueRepo({ forceDue: true })
      const svc = new EmailService(makeConfigRepo({ email_config: SMTP_CFG }), queue, log)
      const huge = { ...attachment, contentBase64: 'A'.repeat(8_000_001) }
      await svc.enqueue({ to: 'a@b.com', subject: 's', html: '<p/>', hotelId: 'h1', attachments: [huge] })
      expect(queue._store.get('q-1')!.attachments).toBeUndefined()
      await settle(queue, 'q-1')
      expect(queue._store.get('q-1')!.status).toBe('sent')
      const mail = (sendMailMock.mock.calls[0] as unknown[])[0] as { attachments?: unknown[] }
      expect(mail.attachments).toBeUndefined()
    })

    it('Resend recibe attachments [{filename, content: base64}]', async () => {
      const queue = makeQueueRepo({ forceDue: true })
      const svc = new EmailService(makeConfigRepo({ resend_api_key: 'rk_test_123' }), queue, log)
      await svc.enqueue({ to: 'a@b.com', subject: 's', html: '<p/>', hotelId: 'h1', attachments: [attachment] })
      expect((await settle(queue, 'q-1')).provider).toBe('resend')
      const sent = (resendSendMock.mock.calls[0] as unknown[])[0] as { attachments: { filename: string; content: string }[] }
      expect(sent.attachments).toEqual([{ filename: 'recibo-ABC123.pdf', content: PDF_BASE64 }])
    })
  })

  // El recibo PDF se genera en el WORKER (fila por fila), no en el request que encola: el marcador
  // `{ kind: 'receipt', reservationId }` se persiste y el resolutor lo convierte al enviar.
  describe('adjuntos diferidos (#270)', () => {
    const PDF_BASE64 = Buffer.from('%PDF-1.4 recibo').toString('base64')
    const marker = { kind: 'receipt' as const, reservationId: 'res-1', filename: 'recibo-res-1.pdf' }
    const settle = async (queue: ReturnType<typeof makeQueueRepo>, id: string): Promise<EmailQueueDTO> => {
      for (let i = 0; i < 50; i++) {
        const row = queue._store.get(id)!
        if (row.status === 'sent' || row.status === 'failed') return row
        await new Promise((r) => setTimeout(r, 5))
      }
      throw new Error(`fila ${id} no se procesó`)
    }

    it('el marcador se persiste tal cual al encolar y el resolutor lo genera recién en el worker', async () => {
      const queue = makeQueueRepo({ forceDue: true })
      const svc = new EmailService(makeConfigRepo({ email_config: SMTP_CFG }), queue, log)
      const resolved: string[] = []
      svc.setAttachmentResolver(async (m) => {
        resolved.push(m.reservationId)
        return { filename: m.filename, contentType: 'application/pdf', contentBase64: PDF_BASE64 }
      })
      await svc.enqueue({ to: 'a@b.com', subject: 's', html: '<p/>', hotelId: 'h1', attachments: [marker] })
      // La fila guarda el marcador, no el PDF: encolar no generó nada.
      expect(queue._store.get('q-1')!.attachments).toEqual([marker])
      expect((await settle(queue, 'q-1')).status).toBe('sent')
      expect(resolved).toEqual(['res-1'])
      const mail = (sendMailMock.mock.calls[0] as unknown[])[0] as { attachments: { filename: string; content: Buffer; contentType: string }[] }
      expect(mail.attachments).toHaveLength(1)
      expect(mail.attachments[0].filename).toBe('recibo-res-1.pdf')
      expect(mail.attachments[0].contentType).toBe('application/pdf')
      expect(mail.attachments[0].content.equals(Buffer.from(PDF_BASE64, 'base64'))).toBe(true)
    })

    it('si el resolutor falla el correo sale igual, sin adjunto (best-effort)', async () => {
      const queue = makeQueueRepo({ forceDue: true })
      const svc = new EmailService(makeConfigRepo({ email_config: SMTP_CFG }), queue, log)
      svc.setAttachmentResolver(async () => { throw new Error('chromium no arranca') })
      await svc.enqueue({ to: 'a@b.com', subject: 's', html: '<p/>', hotelId: 'h1', attachments: [marker] })
      expect((await settle(queue, 'q-1')).status).toBe('sent')
      const mail = (sendMailMock.mock.calls[0] as unknown[])[0] as { attachments?: unknown[] }
      expect(mail.attachments).toBeUndefined()
    })

    it('sin resolutor inyectado el marcador se omite y el correo sale igual', async () => {
      const queue = makeQueueRepo({ forceDue: true })
      const svc = new EmailService(makeConfigRepo({ email_config: SMTP_CFG }), queue, log)
      await svc.enqueue({ to: 'a@b.com', subject: 's', html: '<p/>', hotelId: 'h1', attachments: [marker] })
      expect((await settle(queue, 'q-1')).status).toBe('sent')
      const mail = (sendMailMock.mock.calls[0] as unknown[])[0] as { attachments?: unknown[] }
      expect(mail.attachments).toBeUndefined()
    })

    it('un marcador como JSON string (repo crudo) también se resuelve', async () => {
      const queue = makeQueueRepo({ forceDue: true })
      const svc = new EmailService(makeConfigRepo({ email_config: SMTP_CFG }), queue, log)
      svc.setAttachmentResolver(async (m) => ({ filename: m.filename, contentType: 'application/pdf', contentBase64: PDF_BASE64 }))
      await queue.create({ hotelId: 'h1', recipient: 'b@b.com', subject: 's', html: '<p/>', status: 'pending', maxAttempts: 3, attachments: JSON.stringify([marker]) } as any)
      await svc.processQueue()
      const mail = (sendMailMock.mock.calls[0] as unknown[])[0] as { attachments?: { filename: string }[] }
      expect(mail.attachments?.[0].filename).toBe('recibo-res-1.pdf')
    })
  })
})
