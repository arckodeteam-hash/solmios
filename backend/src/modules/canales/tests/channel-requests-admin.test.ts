// channel-requests-admin.test.ts — La bandeja tiene que traer armado el alta manual.
//
// El alta de una OTA la hace una persona: llama al hotel, entra al dashboard de Channex con el
// contrato y las credenciales, crea el canal y lo mapea. La pantalla anterior mostraba hotel,
// canal, quién pidió y un `<select>` — el mensaje que había escrito el hotel, su teléfono y si
// tenía property en Channex estaban en la base pero no en la pantalla.

import { describe, it, expect } from 'bun:test'
import {
  listChannelRequestsForAdmin, getChannelRequestForAdmin, matchesFilter,
  channexPropertyUrl, channexDashboardUrl,
  type AdminChannelRequestRow,
} from '../usecases/channel-requests-admin'
import type { ChannelRequestRow, ChannelRequestActivityRow } from '../usecases/channel-requests'

const AHORA = new Date('2026-09-10T12:00:00Z')
const ayer = '2026-09-09T10:00:00Z'
const hoyMasTarde = '2026-09-10T18:00:00Z'
const manana = '2026-09-11T10:00:00Z'

const pedido = (patch: Partial<ChannelRequestRow>): ChannelRequestRow => ({
  id: 'r1', hotelId: 'h1', channel: 'booking', channelName: 'Booking.com',
  status: 'pending', createdAt: '2026-09-01T10:00:00Z', ...patch,
} as ChannelRequestRow)

function deps(rows: ChannelRequestRow[], opciones: {
  hotels?: Record<string, unknown>[]
  configs?: Record<string, unknown>[]
  users?: Record<string, unknown>[]
  mappings?: Record<string, unknown>[]
  environment?: string
} = {}) {
  return {
    environment: opciones.environment,
    findMany: async (model: string) => {
      if (model === 'ChannelRequests') return rows as unknown as Record<string, unknown>[]
      if (model === 'Hotels') return opciones.hotels ?? []
      if (model === 'Canales') return opciones.configs ?? []
      if (model === 'Users') return opciones.users ?? []
      if (model === 'ChannelMapping') return opciones.mappings ?? []
      return []
    },
  }
}

describe('listChannelRequestsForAdmin — datos para el alta manual (REQ-CAN-05)', () => {
  it('trae el teléfono y el correo del hotel que pidió', async () => {
    const { data } = await listChannelRequestsForAdmin(
      deps([pedido({})], { hotels: [{ id: 'h1', name: 'Hotel Frente Sol', phone: '809-555-0000', email: 'hola@frentesol.com' }] }),
      { now: AHORA },
    )
    expect(data[0]).toMatchObject({ hotelPhone: '809-555-0000', hotelEmail: 'hola@frentesol.com' })
  })

  it('trae la property de Channex del hotel y el enlace al dashboard', async () => {
    const { data } = await listChannelRequestsForAdmin(
      deps([pedido({})], { configs: [{ hotelId: 'h1', channexPropertyId: 'prop-123' }], environment: 'production' }),
      { now: AHORA },
    )
    expect(data[0]!.channexPropertyId).toBe('prop-123')
    expect(data[0]!.channexUrl).toBe('https://app.channex.io/properties/prop-123')
  })

  it('un hotel sin property queda explícito y el enlace va a la raíz del dashboard', async () => {
    const { data } = await listChannelRequestsForAdmin(deps([pedido({})]), { now: AHORA })
    expect(data[0]!.channexPropertyId).toBe('')
    expect(data[0]!.channexUrl).toBe('https://staging.channex.io')
  })

  it('cuenta los tipos de habitación ya publicados: sin ellos no hay nada que mapear', async () => {
    const { data } = await listChannelRequestsForAdmin(
      deps([pedido({})], { mappings: [{ hotelId: 'h1' }, { hotelId: 'h1' }, { hotelId: 'h2' }] }),
      { now: AHORA },
    )
    expect(data[0]!.mappedRoomTypes).toBe(2)
  })

  it('resuelve el nombre del responsable contra users (no contra empleados)', async () => {
    const { data } = await listChannelRequestsForAdmin(
      deps([pedido({ assignedTo: 'u-1', status: 'in_progress' })], { users: [{ id: 'u-1', name: 'Ana Soporte' }] }),
      { now: AHORA },
    )
    expect(data[0]!.assignedToName).toBe('Ana Soporte')
  })
})

describe('listChannelRequestsForAdmin — filtros y urgencia (REQ-CAN-03, REQ-CAN-08)', () => {
  const universo = [
    pedido({ id: 'sin-atender', status: 'pending' }),
    pedido({ id: 'vencida', status: 'scheduled', appointmentAt: ayer }),
    pedido({ id: 'hoy', status: 'scheduled', appointmentAt: hoyMasTarde }),
    pedido({ id: 'manana', status: 'scheduled', appointmentAt: manana }),
    pedido({ id: 'configurando', status: 'in_progress' }),
    pedido({ id: 'cerrada', status: 'connected' }),
  ]

  it('una cita de ayer viene con overdue:true y encabeza la lista', async () => {
    const { data } = await listChannelRequestsForAdmin(deps(universo), { filter: 'all', now: AHORA })
    expect(data[0]!.id).toBe('vencida')
    expect(data[0]!.overdue).toBe(true)
    expect(data.find((r) => r.id === 'manana')!.overdue).toBe(false)
  })

  it('cada filtro corta lo suyo', async () => {
    const corte = async (filter: string) =>
      (await listChannelRequestsForAdmin(deps(universo), { filter, now: AHORA })).data.map((r) => r.id)
    expect(await corte('pending')).toEqual(['sin-atender'])
    expect(await corte('overdue')).toEqual(['vencida'])
    expect(await corte('today')).toEqual(['hoy'])
    expect((await corte('in_management')).sort()).toEqual(['configurando', 'hoy', 'manana', 'vencida'])
    expect(await corte('closed')).toEqual(['cerrada'])
  })

  it('el corte por defecto junta lo sin atender con lo vencido, y lo vencido va primero', async () => {
    const { data } = await listChannelRequestsForAdmin(deps(universo), { filter: 'attention', now: AHORA })
    expect(data.map((r) => r.id)).toEqual(['vencida', 'sin-atender'])
  })

  it('los contadores se calculan sobre TODO, no sobre el filtro aplicado', async () => {
    const { counts, data } = await listChannelRequestsForAdmin(deps(universo), { filter: 'pending', now: AHORA })
    expect(data).toHaveLength(1)
    expect(counts.pending).toBe(1)
    expect(counts.overdue).toBe(1)
    expect(counts.closed).toBe(1)
    expect(counts.all).toBe(6)
    expect(counts.attention).toBe(2)
  })

  it('un filtro inventado no vacía la bandeja: cae en "todas"', async () => {
    const { data } = await listChannelRequestsForAdmin(deps(universo), { filter: 'lo-que-sea', now: AHORA })
    expect(data).toHaveLength(6)
  })

  it('una cita de hoy ya cerrada no aparece en "Citas de hoy"', () => {
    const fila = { id: 'x', status: 'connected', appointmentToday: true, overdue: false } as AdminChannelRequestRow
    expect(matchesFilter(fila, 'today')).toBe(false)
    expect(matchesFilter(fila, 'closed')).toBe(true)
  })
})

describe('getChannelRequestForAdmin', () => {
  const actividades: ChannelRequestActivityRow[] = [
    { id: 'a1', requestId: 'r1', hotelId: 'h1', kind: 'created', createdAt: '2026-09-01T10:00:00Z' },
    { id: 'a2', requestId: 'r1', hotelId: 'h1', kind: 'status_changed', createdAt: '2026-09-03T10:00:00Z' },
  ]

  it('devuelve el caso con su historial, lo más nuevo primero', async () => {
    const row = await getChannelRequestForAdmin(
      { ...deps([pedido({})]), listActivities: async () => actividades },
      'r1', AHORA,
    )
    expect(row?.activities.map((a) => a.id)).toEqual(['a2', 'a1'])
  })

  it('un id que no existe devuelve null (la ruta lo convierte en 404)', async () => {
    const row = await getChannelRequestForAdmin(
      { ...deps([pedido({})]), listActivities: async () => [] },
      'no-existe', AHORA,
    )
    expect(row).toBeNull()
  })
})

describe('enlaces al dashboard de Channex', () => {
  it('staging y producción son cuentas distintas: nunca el mismo enlace', () => {
    expect(channexDashboardUrl('production')).toBe('https://app.channex.io')
    expect(channexDashboardUrl('staging')).toBe('https://staging.channex.io')
    expect(channexDashboardUrl(undefined)).toBe('https://staging.channex.io')
    expect(channexPropertyUrl('production', 'p1')).toBe('https://app.channex.io/properties/p1')
    expect(channexPropertyUrl('production', '')).toBe('https://app.channex.io')
  })
})
