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

import { EmailService, renderTemplate, normalizeSmtpConfig } from './email-service'
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

  describe('identidad de plataforma (CFG-1)', () => {
    it('sendTestEmail vía Resend usa el nombre de configuration(plataforma) en From y asunto', async () => {
      const svc = new EmailService(
        makeConfigRepo({
          resend_api_key: 'rk_test_123',
          plataforma: JSON.stringify({ platformName: 'HotelPro', supportEmail: 'help@hotelpro.com', supportPhone: '+34 600 000 000' }),
        }),
        makeQueueRepo(),
        log,
      )

      const provider = await svc.sendTestEmail('admin@hotelpro.com')

      expect(provider).toBe('resend')
      expect(resendSendMock).toHaveBeenCalledTimes(1)
      const [payload] = resendSendMock.mock.calls[0] as unknown as [{ from: string; subject: string; to: string }]
      expect(payload.from).toBe('HotelPro <noreply@solmios.com>')
      expect(payload.subject.startsWith('HotelPro')).toBe(true)
      expect(payload.to).toBe('admin@hotelpro.com')
    })

    it('sin fila plataforma cae al default SolmiOS', async () => {
      const svc = new EmailService(makeConfigRepo({ resend_api_key: 'rk_test_123' }), makeQueueRepo(), log)

      await svc.sendTestEmail('admin@test.com')

      const [payload] = resendSendMock.mock.calls[0] as unknown as [{ from: string; subject: string }]
      expect(payload.from).toBe('SolmiOS <noreply@solmios.com>')
      expect(payload.subject.startsWith('SolmiOS')).toBe(true)
    })

    it('SMTP sin fromName usa el nombre de la plataforma como remitente', async () => {
      const svc = new EmailService(
        makeConfigRepo({
          email_config: { host: 'smtp.test', user: 'u', pass: 'p', fromEmail: 'a@b.com' },
          plataforma: { platformName: 'HotelPro' },
        }),
        makeQueueRepo(),
        log,
      )

      await svc.sendTestEmail('admin@test.com')

      expect(sendMailMock).toHaveBeenCalledTimes(1)
      const [payload] = sendMailMock.mock.calls[0] as unknown as [{ from: string }]
      expect(payload.from).toBe('HotelPro <a@b.com>')
    })
  })
})

// ─── Tests normalizeSmtpConfig (puro) ───────────────────────────────────────

describe('normalizeSmtpConfig', () => {
  const base = { host: 'smtp.test', user: 'u', pass: 'p', fromEmail: 'a@b.com' }

  it('null si falta algo esencial', () => {
    expect(normalizeSmtpConfig(null)).toBeNull()
    expect(normalizeSmtpConfig({ host: 'h', user: 'u' })).toBeNull()
  })

  it('sin fromName ni defaultFromName → sólo la dirección (comportamiento previo)', () => {
    expect(normalizeSmtpConfig(base)?.from).toBe('a@b.com')
  })

  it('sin fromName pero con defaultFromName → "Nombre <email>"', () => {
    expect(normalizeSmtpConfig(base, 'HotelPro')?.from).toBe('HotelPro <a@b.com>')
  })

  it('fromName explícito gana sobre defaultFromName', () => {
    expect(normalizeSmtpConfig({ ...base, fromName: 'Otro' }, 'HotelPro')?.from).toBe('Otro <a@b.com>')
  })

  it('sin fromEmail cae a noreply@solmios.com, con nombre si viene', () => {
    const { fromEmail: _omit, ...noFrom } = base
    expect(normalizeSmtpConfig(noFrom)?.from).toBe('noreply@solmios.com')
    expect(normalizeSmtpConfig(noFrom, 'HotelPro')?.from).toBe('HotelPro <noreply@solmios.com>')
  })

  it('acepta el shape legacy {server,password} y secure por puerto 465', () => {
    const out = normalizeSmtpConfig({ server: 'smtp.legacy', port: 465, user: 'u', password: 'p', from: 'x@y.com' }, 'HotelPro')
    expect(out).toEqual({ host: 'smtp.legacy', port: 465, user: 'u', pass: 'p', from: 'HotelPro <x@y.com>', secure: true })
  })
})
