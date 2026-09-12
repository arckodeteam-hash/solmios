// infrastructure/email-bootstrap.test.ts — #270: el recibo PDF del correo de pago se genera en el
// worker de la cola, NO dentro de `onBookingPaid` (que el webhook de Stripe y el retorno de
// Azul/CardNet esperan con `await`). Cablea el bootstrap real sobre un ORM en memoria y un
// `toPdf` cuya resolución controla el test: si el handler termina mientras el PDF sigue
// "generándose", no lo esperó.

import { describe, it, expect, mock } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'

const sendMailMock = mock(async () => ({ messageId: 'mocked-smtp' }))
mock.module('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: sendMailMock }) },
}))

import { bootstrapEmail } from './email-bootstrap'

/** ORM mínimo en memoria: lo que usan OrmRepository, buildReceiptHtmlFor y el EmailService. */
function makeOrm(seed: Record<string, Record<string, unknown>[]>) {
  const tables = new Map<string, Record<string, unknown>[]>()
  for (const [model, rows] of Object.entries(seed)) tables.set(model, rows.map((r) => ({ ...r })))
  const rowsOf = (model: string) => tables.get(model) ?? []
  const matches = (row: Record<string, unknown>, filter?: Record<string, unknown>) =>
    !filter || Object.entries(filter).every(([k, v]) => row[k] === v)
  return {
    rows: rowsOf,
    findMany: async (model: string, filter?: Record<string, unknown>) => rowsOf(model).filter((r) => matches(r, filter)),
    findOne: async (model: string, filter?: Record<string, unknown>) => rowsOf(model).find((r) => matches(r, filter)) ?? null,
    findById: async (model: string, id: string) => rowsOf(model).find((r) => r.id === id) ?? null,
    create: async (model: string, data: Record<string, unknown>) => {
      const row = { id: `${model}-${rowsOf(model).length + 1}`, ...data }
      if (!tables.has(model)) tables.set(model, [])
      tables.get(model)!.push(row)
      return row
    },
    update: async (model: string, id: string, data: Record<string, unknown>) => {
      const row = rowsOf(model).find((r) => r.id === id)
      if (row) Object.assign(row, data, { updatedAt: new Date().toISOString() })
      return row ?? null
    },
    count: async (model: string, filter?: Record<string, unknown>) => rowsOf(model).filter((r) => matches(r, filter)).length,
  }
}

const SMTP_CFG = { host: 'smtp.test', port: 587, user: 'u', pass: 'p', from: 'h@test.com' }

const settle = async (orm: ReturnType<typeof makeOrm>, id: string) => {
  for (let i = 0; i < 100; i++) {
    const row = orm.rows('EmailQueue').find((r) => r.id === id)
    if (row && (row.status === 'sent' || row.status === 'failed')) return row
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error(`fila ${id} no se procesó`)
}

describe('bootstrapEmail — onBookingPaid y el recibo PDF (#270)', () => {
  it('onBookingPaid termina sin esperar al PDF; el worker lo genera después y lo adjunta al enviar', async () => {
    const orm = makeOrm({
      Hotels: [{ id: 'h1', name: 'Hotel Test', slug: 'hotel-test', currency: 'USD' }],
      Guests: [{ id: 'g1', hotelId: 'h1', name: 'Ana', email: 'ana@example.com' }],
      Reservations: [{
        id: 'res-1', hotelId: 'h1', guestId: 'g1', roomId: 'r1', accessToken: 'tok',
        checkIn: '2026-09-12', checkOut: '2026-09-13', totalAmount: 100, deposit: 100, currency: 'USD', paymentMethod: 'card',
      }],
      Rooms: [{ id: 'r1', hotelId: 'h1', name: 'Doble' }],
      Payment: [],
      Configuration: [{ id: 'c1', hotelId: 'h1', key: 'email_config', value: SMTP_CFG }],
      AutoMessages: [],
      Notifications: [],
      EmailQueue: [],
    })

    // El PDF "tarda" hasta que el test lo libere: si el handler termina antes, no lo esperó.
    let releasePdf: () => void = () => {}
    const pdfGate = new Promise<void>((r) => { releasePdf = r })
    const pdfCalls: string[] = []
    const toPdf = async (html: string) => { pdfCalls.push(html); await pdfGate; return Buffer.from('%PDF-1.4 recibo') }

    let sockets: { onBookingPaid?: (d: { id?: string }) => Promise<void> } = {}
    const resolveModule = <T,>(name: string): T | null =>
      name === 'bookingengine' ? ({ setSockets: (s: typeof sockets) => { sockets = s } } as unknown as T) : null

    bootstrapEmail(orm, silentLogger(), resolveModule, { toPdf })
    expect(typeof sockets.onBookingPaid).toBe('function')

    await sockets.onBookingPaid!({ id: 'res-1' })

    // (1) El handler ya volvió y el correo está encolado con el MARCADOR, no con el PDF.
    const queued = orm.rows('EmailQueue')
    expect(queued).toHaveLength(1)
    expect(queued[0].recipient).toBe('ana@example.com')
    expect(queued[0].attachments).toEqual([{ kind: 'receipt', reservationId: 'res-1', filename: 'recibo-res-1.pdf' }])
    expect(sendMailMock).not.toHaveBeenCalled()

    // (2) Recién el worker genera el PDF (fila por fila) y lo manda como adjunto real.
    releasePdf()
    const row = await settle(orm, String(queued[0].id))
    expect(row.status).toBe('sent')
    expect(pdfCalls).toHaveLength(1)
    expect(pdfCalls[0]).toContain('RECIBO')
    const mail = (sendMailMock.mock.calls[0] as unknown[])[0] as { attachments: { filename: string; content: Buffer; contentType: string }[] }
    expect(mail.attachments).toHaveLength(1)
    expect(mail.attachments[0].filename).toBe('recibo-res-1.pdf')
    expect(mail.attachments[0].contentType).toBe('application/pdf')
    expect(mail.attachments[0].content.equals(Buffer.from('%PDF-1.4 recibo'))).toBe(true)
  })
})
