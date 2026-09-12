// channex-webhooks-client.test.ts — El cliente del camino de WEBHOOK: GET puntual de una
// revisión y las operaciones de /webhooks. Sin base de datos: el ChannexUseCase se instancia
// con credenciales de plataforma falsas y el fetch global mockeado.
import { describe, it, expect, afterEach, beforeEach } from 'bun:test'
import { ChannexUseCase } from '../usecases/channex'
import { resetChannexHttpForTests } from '../usecases/channex-http'
import { silentLogger } from 'arckode-framework/testing'

const log = silentLogger()
const uc = () => new ChannexUseCase(log as any, async () => ({ apiKey: 'k', environment: 'staging' }) as any)

type Call = { method: string; url: string; body?: any }

/** Mock del fetch global que registra {method, url, body} y responde lo que se le pase. */
function installFetch(calls: Call[], responder: (url: string, method: string) => any, status = 200) {
  const orig = globalThis.fetch
  globalThis.fetch = (async (url: string, opts: any) => {
    const method = opts?.method || 'GET'
    calls.push({ method, url: String(url), body: opts?.body ? JSON.parse(opts.body) : undefined })
    return new Response(JSON.stringify(responder(String(url), method)), {
      status, headers: { 'content-type': 'application/json' },
    })
  }) as any
  return () => { globalThis.fetch = orig }
}

// Un raw de Channex con TODOS los campos que mira el mapeo.
const RAW = {
  id: 'rev-1',
  attributes: {
    property_id: 'prop-1', booking_id: 'bk-1', unique_id: 'uq-1',
    ota_reservation_code: 'OTA-123', ota_name: 'Booking.com', status: 'new',
    arrival_date: '2099-11-01', departure_date: '2099-11-04',
    amount: '450.00', currency: 'USD',
    customer: { name: 'Ana', surname: 'Pérez', mail: 'ana@example.com' },
    rooms: [
      { room_type_id: 'rt-1', rate_plan_id: 'rp-1', checkin_date: '2099-11-01', checkout_date: '2099-11-04', amount: '450.00', occupancy: { adults: 2, children: 1, infants: 0 } },
      { checkin_date: '2099-11-01', checkout_date: '2099-11-04', amount: '0.00' }, // sin ids ni ocupación → defaults
    ],
    inserted_at: '2099-10-01T10:00:00Z',
  },
}

let restore: (() => void) | undefined
beforeEach(() => resetChannexHttpForTests())
afterEach(() => { restore?.(); restore = undefined; resetChannexHttpForTests() })

describe('fetchBookingRevision', () => {
  it('hace GET a /booking_revisions/<id> y mapea IGUAL que el feed del cron', async () => {
    const calls: Call[] = []
    restore = installFetch(calls, (url) => (url.includes('/feed') ? { data: [RAW] } : { data: RAW }))

    const porWebhook = await uc().fetchBookingRevision('k', 'rev-1')
    const [porCron] = await uc().fetchBookingFeed('k')

    // La prueba de que NO hay mapeo duplicado: el MISMO raw por las dos vías da el mismo DTO.
    expect(porWebhook).toEqual(porCron)
    expect(porWebhook!.id).toBe('rev-1')
    expect(porWebhook!.otaReservationCode).toBe('OTA-123')
    expect(porWebhook!.rooms[0]!.roomTypeId).toBe('rt-1')
    expect(porWebhook!.rooms[1]!.roomTypeId).toBeNull()
    expect(porWebhook!.rooms[1]!.occupancy).toEqual({ adults: 1, children: 0, infants: 0 })

    expect(calls[0]!.method).toBe('GET')
    expect(calls[0]!.url.endsWith('/booking_revisions/rev-1')).toBe(true)
  })

  it('devuelve null cuando la respuesta no trae data', async () => {
    const calls: Call[] = []
    restore = installFetch(calls, () => ({}))
    expect(await uc().fetchBookingRevision('k', 'rev-9')).toBeNull()
  })
})

describe('listWebhooks', () => {
  it('mapea id, callback_url, event_mask y property_id', async () => {
    const calls: Call[] = []
    restore = installFetch(calls, () => ({
      data: [
        { id: 'wh-1', attributes: { callback_url: 'https://app/hook', event_mask: 'booking_new', property_id: 'prop-1', send_data: true } },
        { id: 'wh-2', attributes: { callback_url: 'https://app/hook2', event_mask: 'booking_new;booking_cancellation', send_data: false } },
      ],
    }))

    const out = await uc().listWebhooks('k')
    expect(out).toEqual([
      { id: 'wh-1', callbackUrl: 'https://app/hook', eventMask: 'booking_new', propertyId: 'prop-1', sendData: true },
      { id: 'wh-2', callbackUrl: 'https://app/hook2', eventMask: 'booking_new;booking_cancellation', propertyId: null, sendData: false },
    ])
    expect(calls[0]!.method).toBe('GET')
    expect(calls[0]!.url.endsWith('/webhooks')).toBe(true)
  })

  it('devuelve [] cuando no hay datos', async () => {
    const calls: Call[] = []
    restore = installFetch(calls, () => ({}))
    expect(await uc().listWebhooks('k')).toEqual([])
  })
})

describe('updateWebhook (#342)', () => {
  it('manda PUT /webhooks/:id con solo send_data', async () => {
    const calls: Call[] = []
    restore = installFetch(calls, () => ({ data: { id: 'wh-1' } }))

    const out = await uc().updateWebhook('k', 'wh-1', { sendData: true })

    expect(out).toEqual({ ok: true })
    expect(calls[0]!.method).toBe('PUT')
    expect(calls[0]!.url.endsWith('/webhooks/wh-1')).toBe(true)
    expect(calls[0]!.body).toEqual({ webhook: { send_data: true } })
  })

  it('devuelve el motivo si Channex rechaza', async () => {
    const calls: Call[] = []
    restore = installFetch(calls, () => ({ errors: { code: 'not_found', title: 'Resource Not Found' } }), 404)

    const out = await uc().updateWebhook('k', 'wh-x', { sendData: true })
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('Not Found')
  })
})

describe('createWebhook', () => {
  // Sin propertyId el callback es DE CUENTA (todas las properties). Channex no lo expresa con
  // `property_id: null` sino con `is_global: true`: mandar el null pelado devuelve
  // `422 {"property_id": ["is required when is_global is false"]}`. Verificado contra
  // staging.channex.io el 2026-09-09 — el alta del webhook fallaba en silencio por esto.
  it('un callback de cuenta va con is_global true, NO con property_id null', async () => {
    const calls: Call[] = []
    restore = installFetch(calls, () => ({ data: { id: 'wh-nuevo' } }))

    const out = await uc().createWebhook('k', {
      callbackUrl: 'https://app/api/channels/channex/webhook',
      eventMask: 'booking_new;booking_modification;booking_cancellation',
    })

    expect(out).toEqual({ id: 'wh-nuevo' })
    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url.endsWith('/webhooks')).toBe(true)
    expect(calls[0]!.body).toEqual({
      webhook: {
        is_global: true,
        callback_url: 'https://app/api/channels/channex/webhook',
        event_mask: 'booking_new;booking_modification;booking_cancellation',
        is_active: true,
        send_data: true,
      },
    })
  })

  it('con propertyId va acotado a esa property, sin is_global', async () => {
    const calls: Call[] = []
    restore = installFetch(calls, () => ({ data: { id: 'wh-prop' } }))

    const out = await uc().createWebhook('k', {
      callbackUrl: 'https://app/api/channels/channex/webhook',
      eventMask: 'booking_new',
      propertyId: 'prop-1',
    })

    expect(out).toEqual({ id: 'wh-prop' })
    expect(calls[0]!.body).toEqual({
      webhook: {
        property_id: 'prop-1',
        callback_url: 'https://app/api/channels/channex/webhook',
        event_mask: 'booking_new',
        is_active: true,
        send_data: true,
      },
    })
  })

  // El rechazo tiene que llegar LEGIBLE hasta el operador: el alta fallaba con un log que sólo
  // decía "Channex rechazó el alta" y había que reproducir el POST a mano para ver el motivo.
  it('un rechazo de Channex devuelve el motivo, no un null pelado', async () => {
    const orig = globalThis.fetch
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ errors: { code: 'validation_error', title: 'Validation Error', details: { property_id: ['is required when is_global is false'] } } }),
      { status: 422, headers: { 'content-type': 'application/json' } },
    )) as any
    restore = () => { globalThis.fetch = orig }

    const out = await uc().createWebhook('k', { callbackUrl: 'https://app/x', eventMask: 'booking_new' })

    expect(out.id).toBeNull()
    expect(out.error).toContain('property_id')
  })
})
