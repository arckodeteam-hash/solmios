// marketing/tests/meta-templates.test.ts — Envío de plantillas a Meta y sincronización de estado.
import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, CacheAdapter } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { MarketingService } from '../service'
import { mapMetaStatus } from '../usecases/meta-templates'
import { WhatsappCloudError } from '../../../services/whatsapp-cloud-client'

const log = silentLogger()
const silentCache: CacheAdapter = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} }

const TEMPLATE = {
  id: 't1', hotelId: 'h1', name: 'Confirmación de reserva',
  body: 'Hola {guest_name}, tu reserva en {hotel_name} está confirmada.',
  category: 'reservation', isActive: true, approvalStatus: 'none' as const,
  language: 'es', metaCategory: 'UTILITY',
}

function makeRepo(overrides: Partial<RepositoryAdapter<any>> = {}): RepositoryAdapter<any> {
  return {
    findMany: async () => [], findById: async () => null, findOne: async () => null,
    create: async (data) => ({ id: 'test-id', ...data }),
    update: async (id, data) => ({ id, ...data }),
    delete: async () => true, count: async () => 0,
    paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0 }),
    ...overrides,
  }
}

/** Auth mínimo: sólo `assertOwnership`, que es lo único que usa este camino. */
const auth: any = {
  assertOwnership(owner: string, requester: string, role?: string, bypass?: string) {
    if (role === bypass) return
    if (owner !== requester) { const e: any = new Error('Forbidden'); e.status = 403; throw e }
  },
}

/**
 * Service con un repo de plantillas que recuerda lo último persistido, y un cliente de Meta falso.
 * `client` puede pisarse por test para simular lo que contesta Meta.
 */
function makeService(opts: {
  template?: any
  credentials?: any
  create?: (creds: any, input: any) => Promise<any>
  getStatus?: (creds: any, id: string) => Promise<any>
} = {}) {
  const tpl = opts.template === undefined ? { ...TEMPLATE } : opts.template
  const saved: { patch: any } = { patch: null }
  let current = tpl ? { ...tpl } : null

  const templateRepo = makeRepo({
    findById: async () => current,
    update: async (_id, data: any) => { saved.patch = data; current = { ...current, ...data }; return current },
  })

  const svc = new MarketingService(makeRepo(), makeRepo(), templateRepo, log, silentCache, undefined, auth)
  const calls: { create: any[]; getStatus: any[] } = { create: [], getStatus: [] }

  svc.setMetaCredsDeps({
    credentials: {
      getMetaCredentials: async () => (
        opts.credentials === undefined ? { wabaId: 'waba1', accessToken: 'tok1' } : opts.credentials
      ),
    },
    client: {
      create: async (creds: any, input: any) => {
        calls.create.push(input)
        return opts.create ? opts.create(creds, input) : { id: 'meta123', status: 'PENDING' }
      },
      getStatus: async (creds: any, id: string) => {
        calls.getStatus.push(id)
        return opts.getStatus ? opts.getStatus(creds, id) : { status: 'APPROVED' }
      },
    } as any,
  })

  return { svc, saved, calls, current: () => current }
}

const user = { id: 'u1', role: 'hotel_admin', hotelId: 'h1' } as any

describe('submitTemplateToMeta', () => {
  it('envía la plantilla y guarda el id, el estado y el orden de variables', async () => {
    const { svc, saved, calls } = makeService()
    await svc.submitTemplateToMeta('t1', user)

    expect(calls.create[0].name).toBe('confirmacion_de_reserva')
    expect(calls.create[0].language).toBe('es')
    expect(calls.create[0].category).toBe('UTILITY')
    expect(calls.create[0].components[0].text).toBe('Hola {{1}}, tu reserva en {{2}} está confirmada.')

    expect(saved.patch.metaTemplateId).toBe('meta123')
    expect(saved.patch.approvalStatus).toBe('pending')
    expect(saved.patch.metaVariableOrder).toEqual(['guest_name', 'hotel_name'])
    expect(saved.patch.metaSyncedAt).toBeTruthy()
  })

  // Sin credenciales el hotel no tiene a quién mandarle nada: debe cortar ANTES de la red y dejar
  // el estado intacto, no marcar 'pending' sobre una llamada que nunca ocurrió.
  it('sin credenciales de Meta: 409 y no llama a la API', async () => {
    const { svc, saved, calls } = makeService({ credentials: null })
    expect(svc.submitTemplateToMeta('t1', user)).rejects.toThrow(/no está conectado/)
    await Promise.resolve()
    expect(calls.create.length).toBe(0)
    expect(saved.patch).toBeNull()
  })

  it('rechaza un cuerpo que Meta no acepta, sin llamar a la API', async () => {
    const { svc, calls } = makeService({ template: { ...TEMPLATE, body: '{guest_name} bienvenido' } })
    expect(svc.submitTemplateToMeta('t1', user)).rejects.toThrow(/EMPIECE/)
    await Promise.resolve()
    expect(calls.create.length).toBe(0)
  })

  it('no reenvía una plantilla que ya está esperando revisión', async () => {
    const { svc, calls } = makeService({ template: { ...TEMPLATE, approvalStatus: 'pending' } })
    expect(svc.submitTemplateToMeta('t1', user)).rejects.toThrow(/esperando la revisión/)
    await Promise.resolve()
    expect(calls.create.length).toBe(0)
  })

  // El error de Meta se propaga: marcar 'pending' cuando Meta rechazó el alta dejaría al panel
  // esperando para siempre una aprobación de algo que no existe.
  it('si Meta rechaza el alta, no se marca pendiente', async () => {
    const { svc, saved } = makeService({ create: async () => { throw new Error('name already exists') } })
    expect(svc.submitTemplateToMeta('t1', user)).rejects.toThrow(/already exists/)
    await Promise.resolve()
    expect(saved.patch).toBeNull()
  })

  it('un usuario de otro hotel no puede enviar la plantilla', async () => {
    const { svc, calls } = makeService()
    expect(svc.submitTemplateToMeta('t1', { id: 'u2', role: 'hotel_admin', hotelId: 'h2' } as any))
      .rejects.toThrow(/Forbidden/)
    await Promise.resolve()
    expect(calls.create.length).toBe(0)
  })
})

// Regresión (2026-09-07): `WhatsappCloudError` no es un tipo que el framework reconozca, así que el
// handler global lo convertía en un 500 "Error interno del servidor" y el hotel no veía el motivo
// del rechazo de Meta — que es lo único accionable.
describe('el error de Meta llega con su mensaje, no como 500', () => {
  it('un rechazo de contenido se propaga con el texto de Meta', async () => {
    const { svc } = makeService({
      create: async () => { throw new WhatsappCloudError('Las variables no pueden estar al final.', 400, 100) },
    })
    expect(svc.submitTemplateToMeta('t1', user)).rejects.toThrow(/no pueden estar al final/)
  })

  it('un token vencido se reporta como problema de credenciales', async () => {
    const { svc } = makeService({
      create: async () => { throw new WhatsappCloudError('Invalid OAuth access token', 401, 190) },
    })
    expect(svc.submitTemplateToMeta('t1', user)).rejects.toThrow(/credenciales de este hotel/)
  })

  it('si Meta no responde, el mensaje invita a reintentar', async () => {
    const { svc } = makeService({
      create: async () => { throw new WhatsappCloudError('No se pudo contactar a Meta: timeout', 503) },
    })
    expect(svc.submitTemplateToMeta('t1', user)).rejects.toThrow(/unos minutos/)
  })
})

describe('syncTemplateStatus', () => {
  it('trae el estado aprobado de Meta', async () => {
    const { svc, saved, calls } = makeService({ template: { ...TEMPLATE, approvalStatus: 'pending', metaTemplateId: 'meta123' } })
    await svc.syncTemplateStatus('t1', user)
    expect(calls.getStatus[0]).toBe('meta123')
    expect(saved.patch.approvalStatus).toBe('approved')
  })

  it('guarda el motivo cuando Meta rechaza', async () => {
    const { svc, saved } = makeService({
      template: { ...TEMPLATE, approvalStatus: 'pending', metaTemplateId: 'meta123' },
      getStatus: async () => ({ status: 'REJECTED', rejectedReason: 'INVALID_FORMAT' }),
    })
    await svc.syncTemplateStatus('t1', user)
    expect(saved.patch.approvalStatus).toBe('rejected')
    expect(saved.patch.metaRejectedReason).toBe('INVALID_FORMAT')
  })

  it('una plantilla nunca enviada no se puede sincronizar', async () => {
    const { svc, calls } = makeService()
    expect(svc.syncTemplateStatus('t1', user)).rejects.toThrow(/todavía no fue enviada/)
    await Promise.resolve()
    expect(calls.getStatus.length).toBe(0)
  })
})

describe('mapMetaStatus', () => {
  it('traduce los estados de Meta a los cuatro del panel', () => {
    expect(mapMetaStatus('APPROVED')).toBe('approved')
    expect(mapMetaStatus('PENDING')).toBe('pending')
    expect(mapMetaStatus('REJECTED')).toBe('rejected')
  })

  // PAUSED/DISABLED significan que la plantilla dejó de poder usarse. Para el hotel es un rechazo:
  // mostrarla como "aprobada" haría que intente mandarla y falle.
  it('pausada y deshabilitada cuentan como rechazo', () => {
    expect(mapMetaStatus('PAUSED')).toBe('rejected')
    expect(mapMetaStatus('DISABLED')).toBe('rejected')
  })
})

describe('updateTemplate — la edición invalida la aprobación', () => {
  it('cambiar el cuerpo de una aprobada la vuelve "sin enviar"', async () => {
    const { svc, saved } = makeService({ template: { ...TEMPLATE, approvalStatus: 'approved', metaTemplateId: 'meta123' } })
    await svc.updateTemplate('t1', { body: 'Otro texto {guest_name} distinto' }, user)
    expect(saved.patch.approvalStatus).toBe('none')
    expect(saved.patch.metaTemplateId).toBe('')
  })

  it('cambiar el idioma también la invalida', async () => {
    const { svc, saved } = makeService({ template: { ...TEMPLATE, approvalStatus: 'approved', metaTemplateId: 'meta123' } })
    await svc.updateTemplate('t1', { language: 'en' }, user)
    expect(saved.patch.approvalStatus).toBe('none')
  })

  // Pausar una plantilla no cambia el texto que Meta aprobó: perder la aprobación por esto obligaría
  // a re-tramitar cada vez que alguien la activa o desactiva.
  it('pausarla NO invalida la aprobación', async () => {
    const { svc, saved } = makeService({ template: { ...TEMPLATE, approvalStatus: 'approved', metaTemplateId: 'meta123' } })
    await svc.updateTemplate('t1', { isActive: 0 }, user)
    expect(saved.patch.approvalStatus).toBeUndefined()
    expect(saved.patch.isActive).toBe(0)
  })

  it('cambiar solo el nombre visible NO invalida la aprobación', async () => {
    const { svc, saved } = makeService({ template: { ...TEMPLATE, approvalStatus: 'approved', metaTemplateId: 'meta123' } })
    await svc.updateTemplate('t1', { name: 'Confirmación (v2)' }, user)
    expect(saved.patch.approvalStatus).toBeUndefined()
  })
})
