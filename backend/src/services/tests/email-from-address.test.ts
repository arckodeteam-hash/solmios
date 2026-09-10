// services/tests/email-from-address.test.ts — el remitente sale de Configuración → Email y el
// nombre de la plataforma cubre el nombre vacío. Antes Resend mandaba "SolmiOS <noreply@solmios.com>"
// fijo y SMTP salía sin nombre si el admin no cargaba "Nombre Remitente".
import { describe, it, expect } from 'bun:test'
import { formatFromAddress, normalizeSmtpConfig } from '../email-service'

describe('formatFromAddress', () => {
  it('nombre + email cargados por el admin', () => {
    expect(formatFromAddress({ fromEmail: 'hola@acme.com', fromName: 'Acme PMS' }, 'SolmiOS')).toBe('Acme PMS <hola@acme.com>')
  })
  it('nombre vacío → nombre de la plataforma', () => {
    expect(formatFromAddress({ fromEmail: 'hola@acme.com', fromName: '' }, 'Acme PMS')).toBe('Acme PMS <hola@acme.com>')
    expect(formatFromAddress({ fromEmail: 'hola@acme.com' }, 'Acme PMS')).toBe('Acme PMS <hola@acme.com>')
  })
  it('sin config → fallback con nombre de plataforma; sin nombre → solo email', () => {
    expect(formatFromAddress(null, 'Acme PMS')).toBe('Acme PMS <noreply@solmios.com>')
    expect(formatFromAddress(null)).toBe('noreply@solmios.com')
  })
  it('from ya compuesto ("Nombre <a@b>") se respeta', () => {
    expect(formatFromAddress({ from: 'Legacy <legacy@acme.com>', fromName: 'Otro' }, 'X')).toBe('Legacy <legacy@acme.com>')
  })
})

describe('normalizeSmtpConfig — from', () => {
  it('usa el nombre de la plataforma como default del nombre del remitente', () => {
    const cfg = normalizeSmtpConfig({ host: 'smtp.x.com', user: 'u', pass: 'p', fromEmail: 'noreply@x.com' }, { fromName: 'Acme PMS' })
    expect(cfg?.from).toBe('Acme PMS <noreply@x.com>')
  })
  it('sin host/user/pass sigue siendo null', () => {
    expect(normalizeSmtpConfig({ fromEmail: 'a@b.com' }, { fromName: 'X' })).toBeNull()
  })
})
