// services/notification-renderer.test.ts — Tests del NotificationRenderer (P1 SRP + fix H2/H4).
// Sin DB: fake del templateRepo. Verifica resolución [override hotel > default código > 'es'] y el
// render con/sin escape (fix H2: subject texto plano, body HTML).

import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { NotificationRenderer, renderTemplate, isRawHtmlKey, type AutoMessageTemplateRow } from './notification-renderer'

const log = silentLogger()

/** Repo fake: findOne devuelve la primera fila del store (o null si vacío). Tipado con AutoMessageTemplateRow. */
function makeTemplateRepo(rows: Partial<AutoMessageTemplateRow>[]): RepositoryAdapter<AutoMessageTemplateRow> {
  return {
    findMany: async () => rows as AutoMessageTemplateRow[],
    findById: async () => null,
    findOne: async () => (rows[0] as AutoMessageTemplateRow | undefined) ?? null,
    create: async (d: AutoMessageTemplateRow) => d,
    update: async () => ({}) as AutoMessageTemplateRow,
    delete: async () => true,
    count: async () => rows.length,
    paginate: async () => ({ data: rows as AutoMessageTemplateRow[], total: rows.length, limit: 20, offset: 0, pages: 1 }),
  } as unknown as RepositoryAdapter<AutoMessageTemplateRow>
}

describe('renderTemplate (parámetro escape)', () => {
  it('escape=true (default): escapa HTML en strings (para bodies)', () => {
    expect(renderTemplate('Hola {n}', { n: 'A & B <c>' })).toBe('Hola A &amp; B &lt;c&gt;')
  })

  it('escape=false: NO escapa (para subjects de texto plano — fix H2)', () => {
    expect(renderTemplate('Hola {n}', { n: 'A & B' }, false)).toBe('Hola A & B')
  })

  it('#270: las keys *_lines son HTML ya armado por el usecase → se insertan tal cual', () => {
    expect(renderTemplate('{extras_lines}', { extras_lines: '<ul><li>a</li></ul>' })).toBe('<ul><li>a</li></ul>')
    expect(isRawHtmlKey('tax_lines')).toBe(true)
    expect(isRawHtmlKey('guest_name')).toBe(false)
  })

  it('#270: el resto de las variables sigue escapado aunque haya *_lines en el mismo template', () => {
    expect(renderTemplate('{guest_name}', { guest_name: '<b>x</b>' })).toBe('&lt;b&gt;x&lt;/b&gt;')
    expect(renderTemplate('{guest_name}{rooms_lines}', { guest_name: '<b>', rooms_lines: '<i>' })).toBe('&lt;b&gt;<i>')
  })
})

describe('NotificationRenderer.resolveAndRender', () => {
  it('default de código: subject SIN escape y body CON escape (fix H2)', async () => {
    const renderer = new NotificationRenderer(null, log)
    const out = await renderer.resolveAndRender({
      hotelId: 'h1', event: 'checkin_welcome', language: 'es',
      variables: { hotel_name: 'Bed & Breakfast', guest_name: 'Ana' },
    })
    // Subject es texto plano: el '&' del hotel NO se escapa (antes llegaba 'Bed &amp; Breakfast').
    expect(out.subject).toContain('Bed & Breakfast')
    expect(out.subject).not.toContain('&amp;')
    // Body es HTML: el '&' SÍ se escapa (defensa XSS).
    expect(out.html).toContain('Bed &amp; Breakfast')
  })

  it('override del hotel completo: usa emailSubject + emailBody del repo', async () => {
    const repo = makeTemplateRepo([{ emailSubject: 'Custom {hotel_name}', emailBody: '<p>{guest_name}</p>' }])
    const renderer = new NotificationRenderer(repo, log)
    const out = await renderer.resolveAndRender({
      hotelId: 'h1', event: 'checkin_welcome', language: 'es',
      variables: { hotel_name: 'X', guest_name: 'Ana' },
    })
    expect(out.subject).toBe('Custom X')
    expect(out.html).toBe('<p>Ana</p>')
  })

  it('override parcial (falta emailBody) → cae a default de código (no mezcla)', async () => {
    const repo = makeTemplateRepo([{ emailSubject: 'Custom subject', emailBody: null }])
    const renderer = new NotificationRenderer(repo, log)
    const out = await renderer.resolveAndRender({
      hotelId: 'h1', event: 'checkin_welcome', language: 'es',
      variables: { hotel_name: 'H', guest_name: 'Ana' },
    })
    // Descarta el override parcial → default código (subject contiene 'Bienvenido').
    expect(out.subject).not.toBe('Custom subject')
    expect(out.subject).toContain('Bienvenido')
  })

  it('idioma sin default (fr) → fallback es', async () => {
    const renderer = new NotificationRenderer(null, log)
    const out = await renderer.resolveAndRender({
      hotelId: 'h1', event: 'checkin_welcome', language: 'fr' as never,
      variables: { hotel_name: 'H', guest_name: 'Ana' },
    })
    expect(out.subject).toContain('Bienvenido') // default 'es'
  })
})
