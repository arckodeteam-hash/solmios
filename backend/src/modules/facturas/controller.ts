// facturas/controller.ts — Adaptador HTTP del módulo
// Responsabilidad ÚNICA: traducir request → service → response.
// SIN lógica de negocio. SIN llamadas directas al ORM. (REGLA #12)
// Toda mutación (POST/PUT/PATCH) DEBE pasar por validateSchema(). (REGLA #11)

import type { HttpRequest, Logger } from 'arckode-framework'
import { validateSchema } from '../../shared/validators/validate-body'
import type { FacturasService } from './service'
import { CreateFacturasSchema, UpdateFacturasSchema, PayFacturasSchema, CreditNoteSchema, EmailInvoiceSchema } from './validators/schema'
import { renderInvoiceHtml } from './usecases/invoice-template'
import { hotelHeaderOf } from './usecases/hotel-header'
import { htmlToPdf, checkPdfRateLimit } from '../../infrastructure/pdf'

export class FacturasController {
  constructor(
    private readonly service: FacturasService,
    private readonly logger: Logger,
    private readonly hotelRepo?: any,
  ) {}

  async index(req: HttpRequest) {
    this.logger.info('GET /facturas')
    const result = await this.service.list(req.query as any, req.user as any)
    return { status: 200, body: result }
  }

  async show(req: HttpRequest) {
    this.logger.info('GET /facturas/:id', { id: req.params.id })
    const item = await this.service.getById(req.params.id, req.user as any)
    return { status: 200, body: item }
  }

  async store(req: HttpRequest) {
    this.logger.info('POST /facturas')
    const data = validateSchema(CreateFacturasSchema, req.body)
    const item = await this.service.create(data as any, req.user as any)
    return { status: 201, body: item }
  }

  async pay(req: HttpRequest) {
    this.logger.info('POST /facturas/:id/pay', { id: req.params.id })
    const data = validateSchema(PayFacturasSchema, req.body)
    const item = await this.service.pay(req.params.id, data as any, req.user as any)
    return { status: 200, body: item }
  }

  async update(req: HttpRequest) {
    this.logger.info('PUT /facturas/:id', { id: req.params.id })
    const data = validateSchema(UpdateFacturasSchema, req.body)
    const item = await this.service.update(req.params.id, data as any, req.user as any)
    return { status: 200, body: item }
  }

  async destroy(req: HttpRequest) {
    this.logger.info('DELETE /facturas/:id', { id: req.params.id })
    await this.service.delete(req.params.id, req.user as any)
    return { status: 204, body: null }
  }

  async stats(req: HttpRequest) {
    this.logger.info('GET /facturas/stats')
    const result = await this.service.getStats(req.user as any)
    return { status: 200, body: result }
  }

  async taxRate(req: HttpRequest) {
    this.logger.info('GET /facturas/tax-rate')
    const result = await this.service.getTaxRate(req.user as any)
    return { status: 200, body: result }
  }

  async printInvoice(req: HttpRequest) {
    this.logger.info('GET /facturas/:id/print', { id: req.params.id })
    const invoice = await this.service.getById(req.params.id, req.user as any)
    const header = await hotelHeaderOf(this.hotelRepo, invoice.hotelId)
    const policyText = invoice.hotelId ? await this.service.getInvoicePolicyText(invoice.hotelId) : undefined
    const html = renderInvoiceHtml({ invoice, ...header, policyText })
    return { status: 200, body: html, headers: { 'content-type': 'text/html; charset=utf-8' } }
  }

  async pdf(req: HttpRequest) {
    this.logger.info('GET /facturas/:id/pdf', { id: req.params.id })
    // Rate limit por IP: puppeteer lanza un chromium por request — prevenir abuso/DoS.
    const rawIp = (req.headers?.['x-forwarded-for'] as string) || (req.headers?.['x-real-ip'] as string) || 'unknown'
    const ip = rawIp.split(',')[0].trim()
    if (!checkPdfRateLimit(ip)) {
      return { status: 429, body: { error: 'Demasiadas generaciones de PDF. Intente nuevamente en un minuto.' } }
    }
    const invoice = await this.service.getById(req.params.id, req.user as any)
    const header = await hotelHeaderOf(this.hotelRepo, invoice.hotelId)
    const policyText = invoice.hotelId ? await this.service.getInvoicePolicyText(invoice.hotelId) : undefined
    const html = renderInvoiceHtml({ invoice, ...header, policyText })
    const pdfBuffer = await htmlToPdf(html)
    return {
      status: 200,
      body: pdfBuffer,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="${invoice.invoiceNumber}.pdf"`,
      },
    }
  }

  async creditNote(req: HttpRequest) {
    this.logger.info('POST /facturas/:id/credit-note', { id: req.params.id })
    const data = validateSchema(CreditNoteSchema, req.body) as { reason: string }
    const result = await this.service.creditNote(req.params.id, data.reason, req.user as any)
    return { status: 201, body: result }
  }

  async taxReport(req: HttpRequest) {
    this.logger.info('GET /facturas/tax-report')
    const { from, to } = (req.query ?? {}) as { from?: string; to?: string }
    const result = await this.service.taxReport(req.user as any, from, to)
    return { status: 200, body: result }
  }

  async email(req: HttpRequest) {
    this.logger.info('POST /facturas/:id/email', { id: req.params.id })
    const { to } = validateSchema(EmailInvoiceSchema, req.body) as { to: string }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return { status: 400, body: { error: 'Email del destinatario inválido' } }
    }
    const result = await this.service.emailInvoice(req.params.id, to, req.user as any)
    return { status: 200, body: result }
  }
}
