// subscriptions/tests/extend-trial.test.ts — REQ-PIPE-05 (#146): extender la prueba de un hotel.
//
// Usecase puro con repos en memoria. Lo que se afirma: la extensión se cuenta desde HOY cuando el
// trial ya venció (no desde la fecha vieja), vuelve a `trialing`, limpia los dos dedup del cron,
// encola `trial_extended` con `{days_left}`/`{platform_name}`/`{link}` y es best-effort con el correo.
import { describe, it, expect } from 'bun:test'
import { ConflictError, NotFoundError, ValidationError } from 'arckode-framework'
import { extendTrial, assertExtendTrialDays, type ExtendTrialDeps } from '../usecases/extend-trial'

const DAY = 24 * 60 * 60 * 1000
const MINUTE = 60 * 1000
const NOW = new Date('2026-09-10T15:00:00.000Z')

function memRepo(rows: any[]) {
  return {
    rows,
    findOne: async (f: Record<string, unknown>) => rows.find((r) => Object.entries(f).every(([k, v]) => r[k] === v)) ?? null,
    findById: async (id: string) => rows.find((r) => r.id === id) ?? null,
    update: async (id: string, patch: any) => {
      const row = rows.find((r) => r.id === id)
      if (row) Object.assign(row, patch)
      return row ?? null
    },
  } as any
}

const HOTEL = { id: 'h1', name: 'Hotel Sol', email: 'dueno@hotelsol.com' }

function makeDeps(opts: {
  sub?: Partial<any>
  sender?: ExtendTrialDeps['sendPlatformEmail']
  platformName?: string
} = {}) {
  const sub = {
    id: 'sub1', hotelId: 'h1', status: 'expired',
    // Vencido hace 5 días, con los dos dedup del cron ya sellados.
    trialEndsAt: new Date(NOW.getTime() - 5 * DAY).toISOString(),
    trialReminderSentAt: '2026-09-03T10:00:00.000Z',
    trialExpiredEmailSentAt: '2026-09-06T10:00:00.000Z',
    ...opts.sub,
  }
  const sent: Array<{ event: string; to: string; hotelId: string; vars: Record<string, string> }> = []
  const deps: ExtendTrialDeps = {
    subscriptionsRepo: memRepo([sub]),
    hotelsRepo: memRepo([{ ...HOTEL }]),
    configRepo: {
      findOne: async () => (opts.platformName ? { value: JSON.stringify({ platformName: opts.platformName }) } : null),
    },
    sendPlatformEmail: opts.sender ?? (async (event, to, hotelId, vars) => { sent.push({ event, to, hotelId, vars }); return { sent: true } }),
    publicUrl: 'https://hotel.zx89.site/',
    logger: { warn() {} },
  }
  return { deps, sub, sent }
}

describe('extendTrial — REQ-PIPE-05', () => {
  it('vencido hace 5 días + 7 → trialEndsAt = now+7d (±1 min), trialing, ambos *SentAt en null', async () => {
    const { deps, sub } = makeDeps()

    const result = await extendTrial(deps, 'h1', 7, NOW)

    const expected = NOW.getTime() + 7 * DAY
    expect(Math.abs(new Date(sub.trialEndsAt).getTime() - expected)).toBeLessThanOrEqual(MINUTE)
    expect(sub.status).toBe('trialing')
    expect(sub.trialReminderSentAt).toBeNull()
    expect(sub.trialExpiredEmailSentAt).toBeNull()
    expect(result.daysLeft).toBe(7)
    expect(result.previousTrialEndsAt).toBe(new Date(NOW.getTime() - 5 * DAY).toISOString())
    expect(result.subscription.trialEndsAt).toBe(sub.trialEndsAt)
  })

  it('trial todavía vigente (vence en 3 días) + 7 → se suma a la fecha vieja: vence en 10', async () => {
    const { deps, sub } = makeDeps({ sub: { status: 'trialing', trialEndsAt: new Date(NOW.getTime() + 3 * DAY).toISOString() } })

    const result = await extendTrial(deps, 'h1', 7, NOW)

    expect(new Date(sub.trialEndsAt).getTime()).toBe(NOW.getTime() + 10 * DAY)
    expect(result.daysLeft).toBe(10)
  })

  it('sin trialEndsAt (fila vieja) + 7 → cuenta desde hoy', async () => {
    const { deps, sub } = makeDeps({ sub: { trialEndsAt: null } })
    await extendTrial(deps, 'h1', 7, NOW)
    expect(new Date(sub.trialEndsAt).getTime()).toBe(NOW.getTime() + 7 * DAY)
  })

  it('encola trial_extended al correo del hotel con days_left, platform_name (de configuration) y link', async () => {
    const { deps, sent } = makeDeps({ platformName: 'SOLMI OS' })

    const result = await extendTrial(deps, 'h1', 7, NOW)

    expect(result.emailSent).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.event).toBe('trial_extended')
    expect(sent[0]!.to).toBe('dueno@hotelsol.com')
    expect(sent[0]!.hotelId).toBe('h1')
    expect(sent[0]!.vars).toMatchObject({
      hotel_name: 'Hotel Sol',
      days_left: '7',
      platform_name: 'SOLMI OS',
      link: 'https://hotel.zx89.site/panel/suscripcion',
    })
  })

  it('sin configuration(plataforma), platform_name cae al default (nunca vacío ni literal {platform_name})', async () => {
    const { deps, sent } = makeDeps()
    await extendTrial(deps, 'h1', 7, NOW)
    expect(sent[0]!.vars.platform_name).toBe('SolmiOS')
  })

  it('con el correo roto (tira), la extensión igual queda hecha y emailSent=false', async () => {
    const { deps, sub } = makeDeps({ sender: async () => { throw new Error('cola caída') } })

    const result = await extendTrial(deps, 'h1', 7, NOW)

    expect(sub.status).toBe('trialing')
    expect(result.emailSent).toBe(false)
  })

  it('sin sender cableado: extiende y no explota', async () => {
    const { deps, sub } = makeDeps()
    deps.sendPlatformEmail = undefined
    const result = await extendTrial(deps, 'h1', 3, NOW)
    expect(sub.status).toBe('trialing')
    expect(result.emailSent).toBe(false)
  })

  it('hotel sin suscripción → NotFoundError', async () => {
    const { deps } = makeDeps()
    await expect(extendTrial(deps, 'h-otro', 7, NOW)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('days fuera de 1..30 o no entero → ValidationError (sin tocar la fila)', async () => {
    const { deps, sub } = makeDeps()
    for (const bad of [0, 31, -1, 2.5, NaN, '7' as unknown as number]) {
      await expect(extendTrial(deps, 'h1', bad, NOW)).rejects.toBeInstanceOf(ValidationError)
    }
    expect(sub.status).toBe('expired')
    expect(() => assertExtendTrialDays(1)).not.toThrow()
    expect(() => assertExtendTrialDays(30)).not.toThrow()
  })

  // COR-1/SEC-1: `status:'trialing'` era incondicional. Una sub `active` con Stripe pasada a
  // `trialing` la bloquea `access.ts` al vencer el trial y `create-checkout-session` deja de verla
  // viva (doble Checkout). Solo se extiende una PRUEBA: trialing o expired sin Stripe.
  describe('solo aplica a pruebas (trialing/expired sin stripeSubscriptionId)', () => {
    for (const status of ['active', 'past_due', 'suspended', 'canceled']) {
      it(`${status} → ConflictError y la fila NO cambia (ni correo)`, async () => {
        const { deps, sub, sent } = makeDeps({ sub: { status, stripeSubscriptionId: status === 'active' ? 'sub_stripe_1' : null, trialEndsAt: null } })
        await expect(extendTrial(deps, 'h1', 7, NOW)).rejects.toBeInstanceOf(ConflictError)
        expect(sub.status).toBe(status)
        expect(sub.trialEndsAt).toBeNull()
        expect(sub.trialReminderSentAt).toBe('2026-09-03T10:00:00.000Z')
        expect(sent).toHaveLength(0)
      })
    }

    it('expired PERO con stripeSubscriptionId (fue paga) → ConflictError', async () => {
      const { deps, sub } = makeDeps({ sub: { status: 'expired', stripeSubscriptionId: 'sub_stripe_2' } })
      await expect(extendTrial(deps, 'h1', 7, NOW)).rejects.toBeInstanceOf(ConflictError)
      expect(sub.status).toBe('expired')
    })

    it('el mensaje del 409 dice qué hacer en su lugar', async () => {
      const { deps } = makeDeps({ sub: { status: 'active', stripeSubscriptionId: 'sub_stripe_1' } })
      await expect(extendTrial(deps, 'h1', 7, NOW)).rejects.toThrow(/reactivar|condiciones especiales/)
    })

    // FE-13: el 409 lo lee el vendedor en un toast — el estado va en español, no el enum crudo.
    it('el mensaje del 409 está en español completo (sin el enum crudo del estado)', async () => {
      const { deps } = makeDeps({ sub: { status: 'canceled', stripeSubscriptionId: null } })
      await expect(extendTrial(deps, 'h1', 7, NOW)).rejects.toThrow(/está cancelada/)
      await expect(extendTrial(deps, 'h1', 7, NOW)).rejects.not.toThrow(/canceled/)
      const { deps: d2 } = makeDeps({ sub: { status: 'suspended', stripeSubscriptionId: null } })
      await expect(extendTrial(d2, 'h1', 7, NOW)).rejects.toThrow(/está suspendida/)
    })

    it('expired sin Stripe → 200 (vuelve a trialing)', async () => {
      const { deps, sub } = makeDeps({ sub: { status: 'expired', stripeSubscriptionId: null } })
      const r = await extendTrial(deps, 'h1', 7, NOW)
      expect(sub.status).toBe('trialing')
      expect(r.daysLeft).toBe(7)
    })
  })
})
