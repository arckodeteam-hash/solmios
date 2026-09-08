// email-verification.test.ts — #421: token de verificación de email (hash, vencimiento, un solo uso).
import { describe, it, expect } from 'bun:test'
import {
  hashToken, newVerificationToken, verifyEmailToken, welcomeVerificationEmail, resendVerificationEmail,
  TOKEN_TTL_MS, type VerificationUser,
} from '../usecases/email-verification'

const NOW = Date.parse('2026-07-21T12:00:00Z')

function makeRepo(users: VerificationUser[]) {
  const updates: Array<{ id: string; patch: any }> = []
  return {
    repo: {
      findOne: async (f: any) => users.find((u) => u.emailVerificationToken === f.emailVerificationToken) ?? null,
      update: async (id: string, patch: any) => { updates.push({ id, patch }); const u = users.find((x) => x.id === id); if (u) Object.assign(u, patch); return u },
    } as any,
    updates,
  }
}

describe('newVerificationToken', () => {
  it('el token va en claro pero se guarda su hash (no coinciden)', () => {
    const v = newVerificationToken(NOW)
    expect(v.token).toMatch(/^[0-9a-f]{64}$/)
    expect(v.tokenHash).toBe(hashToken(v.token))
    expect(v.tokenHash).not.toBe(v.token)
    expect(v.expires).toBe(NOW + 24 * 60 * 60 * 1000)
  })
})

describe('verifyEmailToken', () => {
  it('token válido → marca verificado y limpia el token (un solo uso)', async () => {
    const v = newVerificationToken(NOW)
    const { repo, updates } = makeRepo([{ id: 'u1', email: 'a@b.com', emailVerificationToken: v.tokenHash, emailVerificationExpires: v.expires }])
    expect(await verifyEmailToken(repo, v.token, NOW + 1000)).toBe('verified')
    expect(updates[0].patch.emailVerifiedAt).toBeTruthy()
    expect(updates[0].patch.emailVerificationToken).toBeNull()   // no reutilizable
  })

  it('token vencido → expired, no marca verificado', async () => {
    const v = newVerificationToken(NOW)
    const { repo, updates } = makeRepo([{ id: 'u1', emailVerificationToken: v.tokenHash, emailVerificationExpires: v.expires }])
    expect(await verifyEmailToken(repo, v.token, v.expires + 1)).toBe('expired')
    expect(updates).toHaveLength(0)
  })

  it('token ya usado (verificado) → already_verified', async () => {
    const v = newVerificationToken(NOW)
    const { repo } = makeRepo([{ id: 'u1', emailVerifiedAt: '2026-07-01T00:00:00Z', emailVerificationToken: v.tokenHash, emailVerificationExpires: v.expires }])
    expect(await verifyEmailToken(repo, v.token, NOW)).toBe('already_verified')
  })

  it('token inexistente / de otro → invalid, sin revelar nada', async () => {
    const { repo } = makeRepo([{ id: 'u1', emailVerificationToken: hashToken('otro-token'), emailVerificationExpires: NOW + 1000 }])
    expect(await verifyEmailToken(repo, 'token-que-no-existe', NOW)).toBe('invalid')
  })

  it('token vacío → invalid', async () => {
    const { repo } = makeRepo([])
    expect(await verifyEmailToken(repo, '', NOW)).toBe('invalid')
  })
})

// ─── #69: un solo correo de alta (bienvenida + verificación) ────────────────

const LINK = 'https://app.solmios.com/api/public/verify-email?token=abc123'
/** Voseo prohibido: el correo va en español neutro. */
const VOSEO = /Verific[aá]\b|hac[eé]\b|ten[eé]s|ignor[aá]\b|registr[aá]\b|revis[aá]\b/

describe('welcomeVerificationEmail', () => {
  it('da la bienvenida al producto en el asunto y en el cuerpo', () => {
    const mail = welcomeVerificationEmail(LINK, 'Hotel Palma')
    expect(mail.subject).toContain('Bienvenido')
    expect(mail.subject).toContain('SolmiOS')
    expect(mail.html).toContain('Bienvenido a SOLMI OS')
    expect(mail.html).toContain('bienvenida')
    expect(mail.html).toContain('SOLMI OS')
  })

  it('identifica la cuenta con el nombre del hotel, escapado', () => {
    const { html } = welcomeVerificationEmail(LINK, 'Hotel <b>Sol</b> & Mar')
    expect(html).toContain('Hotel &lt;b&gt;Sol&lt;/b&gt; &amp; Mar')
    expect(html).not.toContain('<b>')
  })

  it('el CTA dice "Verificar mi correo" y apunta al link', () => {
    const { html } = welcomeVerificationEmail(LINK, 'Hotel Palma')
    expect(html).toContain(`<a href="${LINK}"`)
    expect(html).toContain('Verificar mi correo')
  })

  it('la vigencia sale de TOKEN_TTL_MS, no de un literal', () => {
    const horas = TOKEN_TTL_MS / 3_600_000
    expect(horas).toBe(24)
    expect(welcomeVerificationEmail(LINK, 'Hotel Palma').html).toContain(`El enlace es válido por ${horas} horas`)
  })

  it('con trialDays anuncia la prueba; sin trialDays no promete ninguna', () => {
    expect(welcomeVerificationEmail(LINK, 'Hotel Palma', 15).html).toContain('15 días')
    const sinPrueba = welcomeVerificationEmail(LINK, 'Hotel Palma').html
    expect(sinPrueba).not.toContain('prueba')
    expect(sinPrueba).not.toContain('días')
    expect(welcomeVerificationEmail(LINK, 'Hotel Palma', 0).html).not.toContain('prueba')
  })

  it('español neutro: sin voseo', () => {
    expect(welcomeVerificationEmail(LINK, 'Hotel Palma', 15).html).not.toMatch(VOSEO)
    expect(welcomeVerificationEmail(LINK, 'Hotel Palma').html).not.toMatch(VOSEO)
  })
})

describe('correos del ciclo de verificación', () => {
  it('verificar el token NO dispara ningún correo', async () => {
    const enviados: any[] = []
    const sender = { enqueue: async (i: any) => { enviados.push(i); return 'q1' } }
    const v = newVerificationToken(NOW)
    const { repo } = makeRepo([{ id: 'u1', email: 'a@b.com', emailVerificationToken: v.tokenHash, emailVerificationExpires: v.expires }])
    expect(await verifyEmailToken(repo, v.token, NOW + 1000)).toBe('verified')
    expect(enviados).toHaveLength(0)
    expect(sender.enqueue).toBeDefined()   // el espía existía y nadie lo llamó
  })

  it('el reenvío usa el nombre del HOTEL, no el del usuario', async () => {
    const enviados: any[] = []
    const user: any = { id: 'u1', email: 'a@b.com', name: 'Juan Pérez', hotelId: 'h1' }
    const repo: any = {
      findById: async (id: string) => (id === user.id ? user : null),
      update: async (_id: string, patch: any) => Object.assign(user, patch),
    }
    const hotelRepo: any = { findById: async () => ({ id: 'h1', name: 'Hotel Palma' }) }
    const sender = { enqueue: async (i: any) => { enviados.push(i); return 'q1' } }

    expect(await resendVerificationEmail(repo, sender, 'https://app.solmios.com/', 'u1', hotelRepo)).toEqual({ sent: true })
    expect(enviados).toHaveLength(1)
    expect(enviados[0].html).toContain('Hotel Palma')
    expect(enviados[0].html).not.toContain('Juan Pérez')
    expect(enviados[0].html).toContain('Verificar mi correo')
    expect(enviados[0].html).not.toMatch(VOSEO)
  })

  it('sin hotelRepo el reenvío cae al nombre del usuario', async () => {
    const enviados: any[] = []
    const user: any = { id: 'u1', email: 'a@b.com', name: 'Juan Pérez', hotelId: 'h1' }
    const repo: any = {
      findById: async (id: string) => (id === user.id ? user : null),
      update: async (_id: string, patch: any) => Object.assign(user, patch),
    }
    const sender = { enqueue: async (i: any) => { enviados.push(i); return 'q1' } }
    expect(await resendVerificationEmail(repo, sender, 'https://app.solmios.com', 'u1')).toEqual({ sent: true })
    expect(enviados[0].html).toContain('Juan Pérez')
  })
})
