// signup.ts — Alta pública: alguien crea su hotel y arranca la prueba gratis.
//
// Deja el hotel LISTO PARA TRABAJAR, que es lo que hoy no pasa: el alta manual
// del super-admin crea la fila del hotel y nada más — sin usuario (el formulario
// ni siquiera pide contraseña), sin roles, sin suscripción. El resultado es un
// hotel al que nadie puede entrar.
//
// Acá se crean las cuatro cosas juntas: hotel + dueño + roles + prueba.
import { ValidationError } from 'arckode-framework'
import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { passwordIssues } from '../../../shared/password-policy'
import { isValidEmail } from '../../../shared/email'
import { newVerificationToken, verificationEmail } from '../../usuarios/usecases/email-verification'
import { DEFAULT_ROLE_PERMISSIONS } from '../../../shared/permissions'

/** Días de prueba gratis. Es la promesa de la landing: si cambia, cambia acá. */
export const TRIAL_DAYS = 7

const MS_PER_DAY = 24 * 60 * 60 * 1000

export interface SignupInput {
  hotelName: string
  email: string
  password: string
  /** Nombre de la persona dueña de la cuenta. */
  ownerName?: string
  phone?: string
  address?: string
  /** País del hotel. Se elige de un catálogo en el alta (data/locales.ts). */
  country?: string
  /** Plan que quiere probar. Si no viene, se prueba sin plan asignado. */
  planId?: string
  /** Código de referido (link `/r/:code`), si vino uno. No se guarda en el hotel — solo se
   *  propaga vía socket para que `referrals` (módulo aparte) vincule el alta. */
  referralCode?: string
}

export interface SignupResult {
  hotelId: string
  userId: string
  trialEndsAt: string
  trialDays: number
}

export interface SignupDeps {
  hotelsRepo: RepositoryAdapter<any>
  usersRepo: RepositoryAdapter<any>
  rolesRepo: RepositoryAdapter<any>
  subscriptionsRepo: RepositoryAdapter<any>
  /** `plans` — para sincronizar el espejo `hotels.plan` con el plan elegido en el trial. */
  plansRepo: RepositoryAdapter<any>
  hashPassword: (plain: string) => Promise<string>
  /** Envío del correo de verificación (#421). Opcional y best-effort: si falta o falla, el alta
   *  igual funciona — no se pierde el hotel porque el SMTP esté caído. */
  emailSender?: { enqueue: (input: { to: string; subject: string; html: string; hotelId: string; relatedType?: string }) => Promise<string> }
  /** Base pública para armar el link de verificación (ej. https://hotel.zx89.site). */
  appUrl?: string
  /** `platform-emails.sendEvent('welcome', ...)`. Opcional y best-effort: igual criterio que emailSender. */
  platformEmailSender?: (event: string, to: string, hotelId: string, vars: Record<string, string>) => Promise<{ sent: boolean }>
  /** Obligatorio: los envíos del alta son best-effort, y sin log un SMTP caído no deja rastro
   *  (el alta devuelve 201 y nadie se entera de que el correo nunca salió — issue #27). */
  logger: Logger
}

export class SignupUseCase {
  constructor(private readonly deps: SignupDeps) {}

  /** Inyecta el envío del correo de verificación (best-effort). Lo cablea el composition-root. */
  setEmailDeps(sender: SignupDeps['emailSender'], appUrl: string): void {
    this.deps.emailSender = sender
    this.deps.appUrl = appUrl
  }

  /** Inyecta `platform-emails.sendEvent()` para el correo de bienvenida (best-effort). */
  setPlatformEmailSender(fn: SignupDeps['platformEmailSender']): void {
    this.deps.platformEmailSender = fn
  }

  async signup(input: SignupInput, now: Date = new Date()): Promise<SignupResult> {
    const email = String(input.email ?? '').trim().toLowerCase()
    const hotelName = String(input.hotelName ?? '').trim()

    if (!hotelName) throw new ValidationError('El nombre del hotel es obligatorio')
    if (!isValidEmail(email)) throw new ValidationError('El email no es válido')

    // La política vive en shared/password-policy: el alta y el cambio de
    // contraseña tienen que exigir lo mismo, o la más floja define la real.
    const issues = passwordIssues(input.password ?? '', { email, name: hotelName })
    // Se nombra el campo: "Debe tener al menos 10 caracteres" a secas no dice
    // cuál de los campos del formulario está mal.
    if (issues.length) throw new ValidationError(`La contraseña no es segura: ${issues.join('. ')}`)

    // El email es la llave con la que después inicia sesión: si ya existe, el
    // alta no puede seguir o quedarían dos cuentas peleando por el mismo login.
    const taken = await this.deps.usersRepo.findMany({ email })
    if (taken.length) throw new ValidationError('Ya existe una cuenta con ese email')

    const hotelId = crypto.randomUUID()
    const trialEnds = new Date(now.getTime() + TRIAL_DAYS * MS_PER_DAY)

    // El alta son cuatro inserciones y cualquiera puede fallar. Si se cae a
    // mitad, lo creado se borra: un hotel sin suscripción entraría gratis para
    // siempre, y un email a medio registrar impide reintentar el alta ("ya
    // existe una cuenta") sin que exista una cuenta usable.
    try {
      return await this.createAll(hotelId, email, hotelName, input, trialEnds)
    } catch (err) {
      await this.rollback(hotelId)
      throw err
    }
  }

  private async createAll(
    hotelId: string,
    email: string,
    hotelName: string,
    input: SignupInput,
    trialEnds: Date,
  ): Promise<SignupResult> {
    await this.deps.hotelsRepo.create({
      id: hotelId,
      name: hotelName,
      email,
      phone: input.phone ?? '',
      // `address`, no `location`: el formulario del super-admin manda `location`,
      // que el ORM descarta sin avisar, y la dirección se pierde.
      address: input.address ?? '',
      country: input.country ?? '',
      // Espejo legacy del plan del trial. La FUENTE DE VERDAD es la fila de `subscriptions`
      // (resolve-plan.ts); sin esto el ORM dejaba el default 'professional' y el panel le
      // mostraba al hotel todos los módulos aunque hubiera elegido 'host' (bug de prod).
      plan: await this.trialPlanSlug(input.planId),
      status: 'active',
      active: 1,
    })

    const userId = crypto.randomUUID()
    // Verificación de email (#421): el token va hasheado en la BD; el claro viaja en el link.
    const verification = newVerificationToken()
    await this.deps.usersRepo.create({
      id: userId,
      hotelId,
      name: input.ownerName?.trim() || hotelName,
      email,
      password: await this.deps.hashPassword(input.password),
      role: 'hotel_admin',
      userType: 'merchant',
      active: 1,
      emailVerificationToken: verification.tokenHash,
      emailVerificationExpires: verification.expires,
    })

    await this.createDefaultRoles(hotelId)

    await this.deps.subscriptionsRepo.create({
      id: crypto.randomUUID(),
      hotelId,
      planId: input.planId ?? '',
      status: 'trialing',
      trialEndsAt: trialEnds.toISOString(),
    })

    // Encolar el correo de verificación. BEST-EFFORT: un fallo acá NO tumba el alta (el hotel ya
    // está creado y entra igual; puede reenviar el correo desde el banner del panel —
    // `frontend/src/layouts/AdminLayout.vue:134-146` → `POST /api/auth/resend-verification`,
    // `backend/src/modules/usuarios/index.ts:81`. Verificado 2026-08-19: ambos existen).
    // Best-effort NO es silencioso: se loguea el fallo, o el alta devuelve 201 y nadie se entera
    // de que el correo nunca salió (issue #27).
    if (this.deps.emailSender) {
      try {
        const base = (this.deps.appUrl || '').replace(/\/$/, '')
        const link = `${base}/api/public/verify-email?token=${verification.token}`
        const mail = verificationEmail(link, hotelName)
        await this.deps.emailSender.enqueue({ to: email, subject: mail.subject, html: mail.html, hotelId, relatedType: 'email_verification' })
      } catch (e) {
        // SMTP caído no puede perder el hotel, pero tiene que quedar registrado.
        this.deps.logger.warn('Alta: no se pudo encolar el correo de verificación', { hotelId, email, error: (e as Error).message })
      }
    }

    // Correo de bienvenida (platform-emails, plantilla `welcome`). BEST-EFFORT: el alta ya terminó
    // (201 con la cuenta creada) — un fallo acá no puede deshacer nada de lo anterior.
    if (this.deps.platformEmailSender) {
      try {
        const base = (this.deps.appUrl || '').replace(/\/$/, '')
        await this.deps.platformEmailSender('welcome', email, hotelId, { hotel_name: hotelName, link: `${base}/panel/dashboard` })
      } catch (e) {
        // Un correo de bienvenida caído no puede perder el hotel, pero tiene que quedar registrado.
        this.deps.logger.warn('Alta: no se pudo encolar el correo de bienvenida', { hotelId, email, error: (e as Error).message })
      }
    }

    return {
      hotelId,
      userId,
      trialEndsAt: trialEnds.toISOString(),
      trialDays: TRIAL_DAYS,
    }
  }

  /**
   * Slug del plan elegido para el espejo `hotels.plan`. `undefined` si no hay plan o no se
   * resuelve (el trial sigue siendo válido: la suscripción es la fuente de verdad y el gate
   * avisa por warn cuando su planId no existe — no inventamos un espejo mentiroso).
   */
  private async trialPlanSlug(planId?: string): Promise<string | undefined> {
    if (!planId) return undefined
    const plan = ((await this.deps.plansRepo.findMany({ id: planId })) as any[])?.[0]
    if (!plan?.slug) {
      this.deps.logger.warn('Alta con plan inexistente — hotels.plan queda sin espejo', { planId })
      return undefined
    }
    return String(plan.slug)
  }

  /**
   * Deshace un alta que quedó a medias. Es best-effort a propósito: si el
   * borrado también falla, se propaga el error ORIGINAL, que es el que explica
   * qué pasó.
   */
  private async rollback(hotelId: string): Promise<void> {
    const del = async (repo: RepositoryAdapter<any>, rows: any[]) => {
      for (const r of rows) await repo.delete?.(r.id).catch(() => {})
    }
    await del(this.deps.subscriptionsRepo, await this.deps.subscriptionsRepo.findMany({ hotelId }).catch(() => []))
    await del(this.deps.rolesRepo, await this.deps.rolesRepo.findMany({ hotelId }).catch(() => []))
    await del(this.deps.usersRepo, await this.deps.usersRepo.findMany({ hotelId }).catch(() => []))
    await this.deps.hotelsRepo.delete?.(hotelId).catch(() => {})
  }

  /**
   * Sin roles el hotel arranca sin permisos configurables: el dueño entra por
   * su `role` de usuario, pero no puede dar de alta a su recepcionista.
   */
  private async createDefaultRoles(hotelId: string): Promise<void> {
    for (const [name, permissions] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      await this.deps.rolesRepo.create({
        id: crypto.randomUUID(),
        hotelId,
        name,
        permissions,
        isSystem: 1,
      }).catch(() => { /* un rol repetido no puede tumbar el alta entera */ })
    }
  }
}
