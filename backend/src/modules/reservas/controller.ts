import type { HttpRequest, Logger, Auth, RepositoryAdapter } from 'arckode-framework'
import { validateSchema, OrmRepository } from 'arckode-framework'
import type { FileUpload } from 'arckode-framework/modules/storage'
import type { ReservasService } from './service'
import { CreateReservasSchema, UpdateReservasSchema, CompanionSchema, AddonSchema, PreCheckinSchema, PreCheckinPhotoSchema, SettleSchema, RescheduleSchema, RescheduleChargeSchema, RescheduleCreditSchema, CancelReservationSchema, StayQuoteSchema, ManualMessageLogSchema } from './validators/schema'
import { listCompanions, createCompanion, updateCompanion, deleteCompanion } from './usecases/companions'
import { listAddons, createAddon, deleteAddon } from './usecases/addons'
import { logManualMessage } from './usecases/message-log'
import { hashGuaranteePin, verifyGuaranteePin } from '../../services/guarantee-pin'
import { sendCheckinEmail } from './usecases/checkin-email'
import { dispatchLifecycleEmail } from './usecases/lifecycle-email'
import { hotelIdOfUserLegacy } from '../../shared/usecases/hotel-of-legacy'
import { toSettleActor } from './usecases/settle-port'

// Decodifica un data URL base64 (data:<mime>;base64,<data>) → buffer + metadata.
// Mismo patrón que housekeeping/controller.ts (el router no propaga req.files al handler).
function parseDataUrl(dataUrl: string): { buffer: Buffer; mimeType: string; ext: string } | null {
  const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/s)
  if (!m) return null
  const mimeType = m[1]
  const buffer = Buffer.from(m[2], 'base64')
  const ext = (mimeType.split('/')[1] ?? 'bin').split(';')[0]
  return { buffer, mimeType, ext }
}

export class ReservasController {
  constructor(
    private readonly service: ReservasService,
    private readonly logger: Logger,
    private readonly companionsRepo: RepositoryAdapter<any>,
    private readonly addonsRepo: RepositoryAdapter<any>,
    private readonly reservationRepo: RepositoryAdapter<any>,
    private readonly userRepo: RepositoryAdapter<any>,
    private readonly auth: Auth,
    private readonly orm?: any,
    private readonly emailSender?: any,
    private readonly messageLogRepo?: any,
    private readonly roomRepoForEmail?: any,
    private readonly hotelRepoForEmail?: any,
    private readonly guestRepoForEmail?: any,
  ) {}

  // ── CRUD reservas (/api/reservas) ──
  async index(req: HttpRequest) {
    const result = await this.service.list(req.query as any, req.user as any)
    return { status: 200, body: result }
  }
  async show(req: HttpRequest) {
    const item = await this.service.getById(req.params.id, req.user as any)
    return { status: 200, body: item }
  }
  async store(req: HttpRequest) {
    const data = validateSchema(CreateReservasSchema, req.body) as Record<string, unknown>
    // Requerimiento 11 (2026-09-03) — FIX: el schema declaraba (en un comentario) que `childrenAges`
    // se reincorporaba crudo desde `req.body`, mismo patrón que bookingengine — pero esa
    // reincorporación nunca se había escrito acá, así que una reserva cargada a mano desde el panel
    // con edades de niños las perdía en silencio. Mismo motivo que en bookingengine: el validador
    // nativo descarta `type:'array'` sin avisar.
    const rawBody = (req.body ?? {}) as Record<string, unknown>
    if (Array.isArray(rawBody.childrenAges)) data.childrenAges = rawBody.childrenAges
    const item = await this.service.create(data as any, req.user as any)
    return { status: 201, body: item }
  }
  async update(req: HttpRequest) {
    const data = validateSchema(UpdateReservasSchema, req.body) as Record<string, unknown>
    // Requerimiento 11 — mismo fix que `store`: sin esto, editar una reserva NUNCA podía tocar
    // `childrenAges` (ni actualizarla ni, si el caller la manda, conservarla a propósito). Si el
    // caller no la manda, el campo queda AFUERA del dto y el UPDATE parcial no la toca — no hay
    // riesgo de borrarla por omisión.
    const rawBody = (req.body ?? {}) as Record<string, unknown>
    if (Array.isArray(rawBody.childrenAges)) data.childrenAges = rawBody.childrenAges
    const item = await this.service.update(req.params.id, data as any, req.user as any)
    return { status: 200, body: item }
  }
  async destroy(req: HttpRequest) {
    await this.service.delete(req.params.id, req.user as any)
    return { status: 204, body: null }
  }
  // ── STAY QUOTE (cotización del wizard: precio por temporada, noche a noche) ──
  // POST (no GET) a propósito: `/api/reservas/:id` está registrado ANTES y capturaría
  // `quote` como id. Igual que `reschedule/quote`, que también es POST en este módulo.
  // Ownership: `hotelId` sale del usuario (super_admin puede pasar el suyo en el body);
  // sin hotelId en el token se resuelve contra `users` (mismo fallback que crud.ts).
  async quote(req: HttpRequest) {
    const body = { ...(req.body ?? {}) } as Record<string, any>
    const user = req.user as any
    if (user?.role === 'super_admin' && body.hotelId) {
      // super_admin cotiza el hotel que pide — hotelId del body tal cual
    } else if (user?.hotelId) {
      body.hotelId = user.hotelId
    } else {
      const hotelId = await hotelIdOfUserLegacy(this.userRepo, user?.id)
      if (!hotelId) return { status: 400, body: { error: 'Usuario sin hotel asignado' } }
      body.hotelId = hotelId
    }
    const data = validateSchema(StayQuoteSchema, body)
    const quote = await this.service.quoteStay({ ...(data as any), guests: Number((data as any).guests) || 2 })
    return { status: 200, body: quote }
  }

  // ── CANCEL (F2 plan #627): aplica política de cancelación ──
  async cancel(req: HttpRequest) {
    try {
      // reason es opcional: si no hay body o está vacío, no se valida ({}).
      const body = req.body as Record<string, any> | undefined
      const dto = body && Object.keys(body).length > 0 ? validateSchema(CancelReservationSchema, body) : {}
      const item = await this.service.cancel(req.params.id, dto as any, req.user as any)
      return { status: 200, body: item }
    } catch (e: any) {
      if (e.name === 'NotFoundError') return { status: 404, body: { error: e.message } }
      if (e.name === 'AuthError' || e.name === 'ForbiddenError') return { status: 403, body: { error: e.message } }
      if (e.name === 'ConflictError') return { status: 409, body: { error: e.message } }
      return { status: 500, body: { error: e.message } }
    }
  }

  // ── APPROVE (Tarea 3.4, corrección 2026-08-25): reserva pública pendiente de revisión
  //    del hotel ("confirmación instantánea" apagada) → el hotel la da por buena ──
  async approve(req: HttpRequest) {
    try {
      const item = await this.service.approve(req.params.id, req.user as any)
      return { status: 200, body: item }
    } catch (e: any) {
      if (e.name === 'NotFoundError') return { status: 404, body: { error: e.message } }
      if (e.name === 'AuthError' || e.name === 'ForbiddenError') return { status: 403, body: { error: e.message } }
      if (e.name === 'ConflictError') return { status: 409, body: { error: e.message } }
      return { status: 500, body: { error: e.message } }
    }
  }

  // ── CANCEL PREVIEW: qué pasaría si cancelo ahora (no persiste, no emite) ──
  // Siempre 200 cuando la reserva existe y es del hotel: el "no se puede cancelar" viaja
  // en el body (canCancel/blockedReason), NO como 409 — es un preview, no una acción.
  async cancelPreview(req: HttpRequest) {
    try {
      const preview = await this.service.cancelPreview(req.params.id, req.user as any)
      return { status: 200, body: preview }
    } catch (e: any) {
      if (e.name === 'NotFoundError') return { status: 404, body: { error: e.message } }
      if (e.name === 'AuthError' || e.name === 'ForbiddenError') return { status: 403, body: { error: e.message } }
      return { status: 500, body: { error: e.message } }
    }
  }

  // ── Companions (/api/reservations/:id/companions, /api/companions/:id) — F2 ──
  async listCompanions(req: HttpRequest) {
    const data = await listCompanions(this.companionsRepo, this.reservationRepo, this.userRepo, this.auth, req.params.id, req.user as any)
    return { status: 200, body: { data } }
  }
  async createCompanion(req: HttpRequest) {
    const dto = validateSchema(CompanionSchema, req.body) as any
    const c = await createCompanion(this.companionsRepo, this.reservationRepo, this.userRepo, this.auth, req.params.id, dto, req.user as any)
    return { status: 201, body: c }
  }
  async updateCompanion(req: HttpRequest) {
    const dto = validateSchema(CompanionSchema, req.body) as any
    const c = await updateCompanion(this.companionsRepo, this.reservationRepo, this.userRepo, this.auth, req.params.id, dto, req.user as any)
    return { status: 200, body: c }
  }
  async deleteCompanion(req: HttpRequest) {
    await deleteCompanion(this.companionsRepo, this.reservationRepo, this.userRepo, this.auth, req.params.id, req.user as any)
    return { status: 200, body: { success: true } }
  }

  // ── Addons (/api/reservations/:id/addons, /api/addons/:id) — F2 ──
  async listAddons(req: HttpRequest) {
    const data = await listAddons(this.addonsRepo, this.reservationRepo, this.userRepo, this.auth, req.params.id, req.user as any)
    return { status: 200, body: { data } }
  }
  async createAddon(req: HttpRequest) {
    const dto = validateSchema(AddonSchema, req.body) as any
    // El notificador (socket + invalidación del listado) lo arma el service, que es quien tiene
    // caché y sockets. Sin él, el saldo nuevo no llega a `GET /api/reservas` por 300s (COR-1).
    // RTC-7.2: el clamp del techo va TAMBIÉN acá — un extra `kind:'discount'` baja el total cobrable
    // igual que borrar uno `service`, y sólo el `deleteAddon` de abajo lo tenía.
    // RTC-8.10: deps por objeto (10 posicionales eran una línea de 240 caracteres).
    const a = await createAddon(
      { repo: this.addonsRepo, reservationRepo: this.reservationRepo, userRepo: this.userRepo, auth: this.auth,
        notifyChanged: this.service.reservationChanged(), paidOf: this.service.paidSource(), ceilingGuard: this.service.addonsCeilingGuard() },
      { reservationId: req.params.id, dto, user: req.user as any },
    )
    return { status: 201, body: a }
  }
  async deleteAddon(req: HttpRequest) {
    // SEC3-2: un extra menos es techo menos — los links vivos se recortan al saldo nuevo.
    await deleteAddon(
      { repo: this.addonsRepo, reservationRepo: this.reservationRepo, userRepo: this.userRepo, auth: this.auth,
        notifyChanged: this.service.reservationChanged(), paidOf: this.service.paidSource(), ceilingGuard: this.service.addonsCeilingGuard() },
      { id: req.params.id, user: req.user as any },
    )
    return { status: 200, body: { success: true } }
  }

  // ── CHECK-IN ──────────────────────────────────────────────────────────
  async checkin(req: HttpRequest) {
    try {
      const { reservation, hotelId } = await this.service.checkin(req.params.id, req.user as any)
      const result = await this.service.executeCheckin(reservation, req.user as any, { orm: this.orm, logger: this.logger })
      this.pushChannex(reservation.hotelId, reservation.roomId)
      sendCheckinEmail({ ...this.service.getNotifyDeps(), messageLogRepo: this.messageLogRepo, lockCodeRepo: this.orm ? new OrmRepository(this.orm, 'LockCodes') : undefined }, { reservationId: reservation.id, hotelId: reservation.hotelId, guestId: result.guestId, roomId: reservation.roomId, checkIn: reservation.checkIn, checkOut: reservation.checkOut, checkInTime: (reservation as any).checkInTime, checkOutTime: (reservation as any).checkOutTime }).catch((e: any) => this.logger.warn('check-in email', { error: e.message }))
      return { status: 200, body: result }
    } catch (e: any) {
      if (e.name === 'NotFoundError') return { status: 404, body: { error: e.message } }
      if (e.name === 'AuthError') return { status: 403, body: { error: e.message } }
      if (e.name === 'ForbiddenError') return { status: 403, body: { error: e.message } }
      if (e.name === 'ConflictError') return { status: 409, body: { error: e.message } }
      return { status: 500, body: { error: e.message } }
    }
  }

  // ── CHECK-OUT ─────────────────────────────────────────────────────────
  async checkout(req: HttpRequest) {
    try {
      const { reservation, hotelId } = await this.service.checkout(req.params.id, req.user as any)

      // R-1 (auditoría 2026-08-19): el CLAIM (executeCheckout con CAS) corre ANTES del
      // settlement — en el orden viejo, dos checkouts concurrentes hacían el settlement
      // ambos (doble folio/pago/factura) antes de que alguien moviera el estado. Con el
      // claim primero, el perdedor recibe 409 sin tocar plata. Si el settlement falla tras
      // un claim exitoso, la reserva queda checked_out con folio open (se factura desde el
      // panel) — deuda visible, nunca doble cobro.
      const result = await this.service.executeCheckout(reservation, req.user as any, { orm: this.orm, logger: this.logger })

      // Settlement: close folio → create invoice → record payment (if any)
      // `!= null` (no `!== undefined`): el checkout "con deuda" del frontend manda
      // `{ settle: null }` a propósito (Reservation.service.ts siempre incluye la clave) — con
      // `!== undefined` un `null` explícito entraba a validateSchema y explotaba con 400 antes
      // de settear nada, aunque el claim ya había corrido (folio quedaba open sin aviso claro).
      let settlementResult = null
      const body = req.body as Record<string, any> | undefined
      if (body?.settle != null) {
        const settle = validateSchema(SettleSchema, body.settle) as { method: string; amount: number; reference?: string }
        settlementResult = await this.service.settleFolioForCheckout(reservation, settle, toSettleActor(req.user))
      }

      this.pushChannex(reservation.hotelId, reservation.roomId)
      dispatchLifecycleEmail({ ...this.service.getNotifyDeps(), messageLogRepo: this.messageLogRepo }, { reservationId: reservation.id, hotelId: reservation.hotelId, guestId: reservation.guestId, roomId: reservation.roomId, checkIn: reservation.checkIn, checkOut: reservation.checkOut, event: 'checkout' }).catch((e: any) => this.logger.warn('checkout email', { error: e.message }))
      return { status: 200, body: { ...result, settlement: settlementResult } }
    } catch (e: any) {
      if (e.name === 'NotFoundError') return { status: 404, body: { error: e.message } }
      if (e.name === 'AuthError') return { status: 403, body: { error: e.message } }
      if (e.name === 'ForbiddenError') return { status: 403, body: { error: e.message } }
      if (e.name === 'ConflictError') return { status: 409, body: { error: e.message } }
      if (e.name === 'ValidationError') return { status: 400, body: { error: e.message, fields: e.fields } }
      return { status: 500, body: { error: e.message } }
    }
  }

  // ── RESCHEDULE (mover/extender desde planning) ────────────────────────
  async rescheduleQuote(req: HttpRequest) {
    try {
      const data = validateSchema(RescheduleSchema, req.body) as any
      return { status: 200, body: await this.service.quoteReschedule(req.params.id, data, req.user as any) }
    } catch (e: any) {
      return this.mapRescheduleError(e)
    }
  }

  async reschedule(req: HttpRequest) {
    try {
      const body = req.body as Record<string, any> | undefined
      const move = validateSchema(RescheduleSchema, body) as any
      const charge = body?.charge ? validateSchema(RescheduleChargeSchema, body.charge) : undefined
      const credit = body?.credit ? validateSchema(RescheduleCreditSchema, body.credit) : undefined
      const result = await this.service.reschedule(req.params.id, { ...move, charge, credit }, req.user as any)
      return { status: 200, body: result }
    } catch (e: any) {
      return this.mapRescheduleError(e)
    }
  }

  private mapRescheduleError(e: any) {
    if (e.name === 'NotFoundError') return { status: 404, body: { error: e.message } }
    if (e.name === 'AuthError' || e.name === 'ForbiddenError') return { status: 403, body: { error: e.message } }
    if (e.name === 'ConflictError') return { status: 409, body: { error: e.message } }
    if (e.name === 'ValidationError') return { status: 400, body: { error: e.message, fields: e.fields } }
    return { status: 500, body: { error: e.message } }
  }

  private pushChannex(hotelId: string, roomId: string): void {
    const svc = this.service as any
    if (svc.orchestrationDeps?.pushAvailabilityToChannex) {
      svc.orchestrationDeps.pushAvailabilityToChannex(hotelId, roomId)
    }
  }

  // ── PRE-CHECKIN (público) ─────────────────────────────────────────────
  // `body.error` va PLANO (string), no `{message}` anidado: buildEnvelope (server.ts) lee
  // `b.error` directo y lo mete tal cual en `error.message` del envelope final — si acá se manda
  // un objeto, el frontend termina renderizando "[object Object]" (bug real, encontrado probando
  // el link de autocheckin en vivo). Mismo patrón correcto que ya usa `getExtendedDetail` abajo.
  async getPreCheckinData(req: HttpRequest) {
    try {
      return { status: 200, body: await this.service.getPreCheckinData(req.params.hash) }
    } catch (e: any) {
      return { status: e.message.includes('expiro') ? 410 : 404, body: { error: e.message } }
    }
  }

  async submitPreCheckin(req: HttpRequest) {
    try {
      validateSchema(PreCheckinSchema, req.body)
    } catch (e: any) {
      // `e.message` tiene que quedar EXACTO "Validation error" (sin prefijo propio) — el
      // frontend (`http.ts`, `withFieldDetail()`) solo enriquece el mensaje con el detalle por
      // campo ("name: Minimum 2 characters") cuando matchea ese texto exacto; con un prefijo
      // como "Datos inválidos: ..." el regex no matchea y el detalle de `e.details.fields` se
      // pierde, dejando al huésped un genérico sin decir qué campo está mal.
      return { status: 400, body: { error: e.message, details: e.details } }
    }
    // La firma llega como data URL dentro del body ya validado (`signature`, string requerido).
    // Se decodifica ACÁ (antes de llamar al service) para no tocar nada si el formato es inválido.
    const rawSignature = (req.body as Record<string, unknown> | undefined)?.signature
    const parsedSignature = parseDataUrl(String(rawSignature ?? ''))
    if (!parsedSignature) return { status: 400, body: { error: 'Firma inválida (se espera imagen base64)' } }
    const signatureFile: FileUpload = {
      fieldName: 'signature',
      originalName: `signature.${parsedSignature.ext}`,
      buffer: parsedSignature.buffer,
      mimeType: parsedSignature.mimeType,
      size: parsedSignature.buffer.length,
    }
    try {
      await this.service.submitPreCheckin(req.params.hash, req.body, signatureFile)
      return { status: 200, body: { success: true, message: 'Pre-checkin completado' } }
    } catch (e: any) {
      // ValidationError acá = no aceptó contrato/GDPR (ver usecases/pre-checkin.ts) → 400, no 404.
      if (e.name === 'ValidationError') return { status: 400, body: { error: e.message } }
      return { status: 404, body: { error: e.message } }
    }
  }

  // ── PRE-CHECKIN — foto del documento (público) ─────────────────────────
  async uploadPreCheckinPhoto(req: HttpRequest) {
    const data = validateSchema(PreCheckinPhotoSchema, req.body ?? {}) as { photo: string; fileName?: string }
    const parsed = parseDataUrl(data.photo)
    if (!parsed) return { status: 400, body: { error: 'Formato inválido (se espera data URL base64)' } }
    if (!parsed.mimeType.startsWith('image/')) return { status: 400, body: { error: 'Solo se permiten imágenes' } }
    const file: FileUpload = {
      fieldName: 'file',
      originalName: data.fileName || `document.${parsed.ext}`,
      buffer: parsed.buffer,
      mimeType: parsed.mimeType,
      size: parsed.buffer.length,
    }
    try {
      const result = await this.service.uploadPreCheckinPhoto(req.params.hash, file)
      return { status: 201, body: result }
    } catch (e: any) {
      if (e.name === 'ValidationError') return { status: 400, body: { error: e.message } }
      return { status: 404, body: { error: e.message } }
    }
  }

  // ── EXTENDED DETAIL ───────────────────────────────────────────────────
  async getExtendedDetail(req: HttpRequest) {
    try {
      return { status: 200, body: await this.service.getExtendedDetail(req.params.id, req.user) }
    } catch (e: any) {
      if (e.name === 'NotFoundError') return { status: 404, body: { error: e.message } }
      return { status: 403, body: { error: e.message } }
    }
  }

  // ── AUDIT TRAIL ───────────────────────────────────────────────────────
  async getAuditTrail(req: HttpRequest) {
    try {
      return { status: 200, body: { data: await this.service.getAuditTrail(req.params.id, req.user) } }
    } catch (e: any) {
      if (e.name === 'NotFoundError') return { status: 404, body: { error: e.message } }
      return { status: 403, body: { error: e.message } }
    }
  }

  // ── GUARANTEE CARD ────────────────────────────────────────────────────
  async setGuaranteePin(req: HttpRequest) {
    try {
      return { status: 200, body: await this.service.setGuaranteePin(req.user as any, req.body) }
    } catch (e: any) {
      return { status: 400, body: { error: e.message } }
    }
  }

  async getGuaranteeHasPin(req: HttpRequest) {
    try {
      return { status: 200, body: await this.service.getGuaranteeHasPin(req.user as any) }
    } catch (e: any) {
      return { status: 401, body: { error: e.message } }
    }
  }

  async unlockGuaranteeCard(req: HttpRequest) {
    try {
      return { status: 200, body: await this.service.unlockGuaranteeCard(req.params.id, req.user as any, req.body) }
    } catch (e: any) {
      if (e.name === 'NotFoundError') return { status: 404, body: { error: e.message } }
      if (e.name === 'AuthError') return { status: 403, body: { error: e.message } }
      if (e.name === 'ForbiddenError') return { status: 403, body: { error: e.message } }
      return { status: 400, body: { error: e.message } }
    }
  }

  // ── BOOKING ENGINE DASHBOARD ──────────────────────────────────────────
  async getBookingEngineDashboard(req: HttpRequest) {
    try {
      return { status: 200, body: await this.service.getBookingEngineDashboard(req.user as any) }
    } catch (e: any) {
      return { status: 500, body: { error: e.message } }
    }
  }

  // ── SEND LOCK CODE EMAIL (botón "Enviar código por email" del planning) ──
  /** Traza de un envío manual (WhatsApp/SMS/email) hecho desde el panel — ver usecases/message-log.ts. */
  async logManualMessage(req: HttpRequest) {
    // Sin repo NO se puede registrar nada: antes esto devolvía 201 con `{logged:false}` y el
    // cliente mostraba el envío como registrado. Un fallo de cableado tiene que verse como fallo.
    const repo = this.messageLogRepo ?? (this.orm ? new OrmRepository<any>(this.orm, 'MessageLogs') : null)
    if (!repo) return { status: 503, body: { error: 'El registro de envíos no está disponible' } }
    try {
      const dto = validateSchema(ManualMessageLogSchema, req.body) as any
      const out = await logManualMessage(
        { messageLogRepo: repo, reservationRepo: this.reservationRepo, userRepo: this.userRepo, auth: this.auth },
        req.params.id, dto, req.user as any,
      )
      return { status: 201, body: out }
    } catch (e: any) {
      if (e.name === 'NotFoundError') return { status: 404, body: { error: e.message } }
      if (e.name === 'ValidationError') return { status: 400, body: { error: e.message } }
      if (e.name === 'AuthError' || e.name === 'ForbiddenError') return { status: 403, body: { error: e.message } }
      return { status: 500, body: { error: e.message } }
    }
  }

  async sendLockCodeEmail(req: HttpRequest) {
    try {
      const result = await this.service.sendLockCodeEmail(req.params.id, req.user as any, { orm: this.orm })
      return { status: 200, body: { success: true, sentTo: result.sentTo } }
    } catch (e: any) {
      if (e.name === 'NotFoundError') return { status: 404, body: { error: e.message } }
      if (e.name === 'ValidationError') return { status: 400, body: { error: e.message } }
      if (e.name === 'AuthError' || e.name === 'ForbiddenError') return { status: 403, body: { error: e.message } }
      return { status: 500, body: { error: e.message } }
    }
  }
}
