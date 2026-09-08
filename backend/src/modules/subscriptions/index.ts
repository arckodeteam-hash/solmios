import { createModule, OrmRepository } from 'arckode-framework'
import { registerSubscriptionModels } from './model'
import { SubscriptionsService } from './service'
import { SubscriptionsController } from './controller'
import { rateLimit, getClientIp } from '../../shared/middlewares/rate-limit'
import { verifyCaptcha, isCaptchaEnabled } from '../../infrastructure/captcha'
import { createPermissionGuard } from '../../infrastructure/auth/create-permission-guard'

export { SubscriptionsService }

export function SubscriptionsModule() {
  return createModule({
    name: 'subscriptions',
    // STR-F: `GET /api/public/plans` cambió su contrato observable — cada plan trae ahora `limits`
    // (`usecases/public-plans.ts`) y la lista sale ordenada por precio ASC (#30,
    // `shared/utils/plans-order.ts`) en vez del
    // orden del repo. Misma regla que se aplicó en `admin/index.ts` (1.1.0), `reservas` (2.2.0) y
    // `payment-requests` (1.3.0): un cambio observable del contrato bumpea la versión.
    // #30: el orden de la lista pasó de `sortOrder` a precio ASC — observable, 1.2.0.
    // Nuevo endpoint público `publicFounderCountdown` (contador cíclico de /hotel-fundador,
    // reemplaza la fecha límite hardcodeada del frontend) — observable, 1.3.0.
    version: '1.3.0',
    description: 'Suscripción del hotel a la plataforma: alta pública, prueba gratis y corte de servicio',
    contract: {
      name: 'subscriptions', version: '1.3.0',
      description: 'SaaS subscription lifecycle',
      actions: ['signup', 'publicPlans', 'publicFounderDiscount', 'publicFounderCountdown', 'myStatus', 'onboarding', 'checkout', 'portal', 'webhookPlatform', 'applyStripeDiscount', 'publicSignupPolicy', 'resumeCheckout'],
      events: [],
      tables: ['subscriptions', 'subscription_discounts', 'special_category_config', 'founder_history'],
      dependencies: [],
      rules: [
        'checkout/portal: hotelId forzado del JWT, cobro SIEMPRE contra la cuenta de PLATAFORMA (StripeService.getClient() sin hotelId)',
        'webhookPlatform: sin auth, la autoridad es la firma de Stripe verificada con STRIPE_WEBHOOK_SECRET_PLATFORM',
        'publicPlans: los límites (`rooms`/`users`) salen de `plans.limits`, nunca de un literal en el template del frontend (GH-31)',
        'publicPlans: la lista sale del más barato al más caro (price ASC, slug ASC — #30); el orden lo fija el backend, ninguna vista re-ordena',
        'publicFounderDiscount: el % del programa Fundador sale de `special_category_config`, no de una variable de build del frontend (CFG-1)',
        'publicFounderCountdown: se calcula siempre contra un ancla fija (durationDays desde subscription_settings) — nunca una fecha límite guardada que haya que reiniciar a mano',
        'Toda ruta pública (sin auth) va rate-limitada por IP a 30 req/min antes del controller, como landing y opiniones',
      ],
    },
    create({ logger, orm, router, auth }) {
      if (!auth) throw new Error('subscriptions: auth dependency required')
      registerSubscriptionModels(orm)
      const log = logger.child('subscriptions')

      const service = new SubscriptionsService(
        new OrmRepository<any>(orm, 'Subscriptions'),
        new OrmRepository<any>(orm, 'Hotels'),
        new OrmRepository<any>(orm, 'Users'),
        new OrmRepository<any>(orm, 'Roles'),
        new OrmRepository<any>(orm, 'Plans'),
        new OrmRepository<any>(orm, 'Rooms'),
        // `RoomRates` es el modelo compartido de tarifas (shared/models.ts). Iba
        // en `undefined`, así que el paso "Definí tus tarifas" de la guía de
        // primeros pasos NUNCA se marcaba como hecho, por más tarifas cargadas.
        new OrmRepository<any>(orm, 'RoomRates'),
        log,
        // `Canales` = channel_config: dice si el hotel ya conectó sus OTAs.
        new OrmRepository<any>(orm, 'Canales'),
        // Historial de condiciones especiales — statusOf() lo usa para mostrar el descuento activo.
        new OrmRepository<any>(orm, 'SubscriptionDiscounts'),
        // orm crudo — solo lo usa handle-stripe-event.ts para el CAS de cupos al cancelar.
        orm,
        // Config de Fundador/Pionero: el % que publica la landing sale de acá (CFG-1).
        new OrmRepository<any>(orm, 'SpecialCategoryConfig'),
      )
      const controller = new SubscriptionsController(service, log)

      // Igual patrón que hoteles/index.ts para escritura de configuración del hotel:
      // cualquier rol autenticado con el permiso `settings:edit` (hotel_admin por defecto).
      const roleRepo = new OrmRepository<any>(orm, 'Roles')
      const guard = createPermissionGuard(auth, roleRepo)

      // PÚBLICAS. El alta es la única puerta abierta que escribe en la base, así
      // que va con el mismo rate-limit por IP que el login.
      router.post('/api/public/signup', async (req: any) => {
        const ip = getClientIp(req)
        const key = `signup:${ip}`
        const { allowed, retryAfter } = await rateLimit(key)
        if (!allowed) {
          return { status: 429, body: { error: `Demasiados intentos. Probá en ${retryAfter} segundos` } }
        }
        // El captcha se verifica ANTES de validar el resto y antes de tocar la
        // base: es la barrera contra el bot, no tiene sentido gastar consultas
        // ni revelar si un email ya existe si del otro lado no hay una persona.
        if (isCaptchaEnabled()) {
          const captcha = await verifyCaptcha(String(req.body?.captchaToken ?? ''), ip)
          if (!captcha.ok) {
            log.warn(`Signup rechazado por captcha desde ${ip}: ${captcha.reason}`)
            return { status: 400, body: { error: 'No pudimos verificar que no seas un robot. Recargá la página y probá de nuevo.' } }
          }
        }
        return controller.signup(req)
      })
      // ─── Lecturas públicas ────────────────────────────────────────────────
      // Sin auth ⇒ rate-limit por IP ANTES del controller, 30 req/min: el patrón del repo para
      // lecturas públicas (`landing/index.ts:94`, `opiniones/index.ts:60`). Las dos rutas leen la
      // DB en cada request y no tienen caché; sin tope, un scraper las usa de bomba de consultas.
      const publicRead = (name: string, handler: (req: any) => any) => async (req: any) => {
        const { allowed, retryAfter } = await rateLimit(`${name}:${getClientIp(req)}`, {
          maxAttempts: 30,
          windowMs: 60_000,
        })
        if (!allowed) return { status: 429, body: { error: 'Too many requests', retryAfter } }
        return handler(req)
      }
      router.get('/api/public/plans', publicRead('public-plans', (req) => controller.publicPlans(req)))
      // CFG-1: el % del programa Fundador. Público porque la página ya lo publica; no expone
      // cupos ni ocupación, sólo el número que el hotel ve.
      router.get('/api/public/founder-discount', publicRead('public-founder-discount', (req) => controller.publicFounderDiscount(req)))
      // Contador cíclico de /hotel-fundador: prendido/apagado + duración del ciclo, editables
      // desde /admin (subscription_settings). Público porque la landing ya lo muestra a
      // cualquiera; no expone nada del negocio (cupos/ocupación siguen en founder-discount aparte).
      router.get('/api/public/founder-countdown', publicRead('public-founder-countdown', (req) => controller.publicFounderCountdown(req)))
      // #28: política del alta (¿pide tarjeta? ¿cuántos días de prueba?). Pública y sin datos
      // sensibles: es exactamente lo que el visitante ve escrito en el botón de registro.
      router.get('/api/public/signup-policy', publicRead('public-signup-policy', (req) => controller.publicSignupPolicy(req)))

      // #28 — completar el pago del alta sin poder loguearse. Es un POST con contraseña, así que
      // NO va por `publicRead` (30/min es de lecturas): mismo tope que un login, 5 intentos por
      // IP cada 15 minutos, para que esto no sea un oráculo de fuerza bruta contra las claves.
      router.post('/api/public/resume-checkout', async (req: any) => {
        const { allowed, retryAfter } = await rateLimit(`resume-checkout:${getClientIp(req)}`, {
          maxAttempts: 5,
          windowMs: 15 * 60_000,
        })
        if (!allowed) return { status: 429, body: { error: 'Too many requests', retryAfter } }
        return controller.resumeCheckout(req)
      })

      // Del hotel logueado: cuánto le queda de prueba / si tiene que pagar.
      router.get('/api/subscription/me', [auth.authenticate()], (req: any) => controller.myStatus(req))
      router.get('/api/onboarding/status', [auth.authenticate()], (req: any) => controller.onboarding(req))

      // El hotel paga a la plataforma: elegir plan (Checkout) y gestionar método de pago (Portal).
      router.post('/api/subscriptions/checkout', guard('settings', 'edit'), (req: any) => controller.checkout(req))
      router.post('/api/subscriptions/portal', guard('settings', 'edit'), (req: any) => controller.portal(req))
      // Webhook de la cuenta de PLATAFORMA: sin auth, firma Stripe verificada en el service
      // (mismo patrón que payment-requests/index.ts:75, secret separado — ver contract.rules).
      router.post('/api/stripe/webhook/platform', (req: any) => controller.webhookPlatform(req))

      // Sin secret el alta queda sin captcha: se avisa fuerte porque el modo
      // "sin captcha" es indistinguible a simple vista del modo protegido.
      if (isCaptchaEnabled()) {
        log.info('Captcha del alta: ACTIVO (Turnstile)')
      } else {
        log.warn('Captcha del alta: DESACTIVADO — falta TURNSTILE_SECRET. El registro público solo está protegido por rate-limit por IP.')
      }

      log.info('Módulo subscriptions listo (7 endpoints)')
      return service
    },
  })
}
