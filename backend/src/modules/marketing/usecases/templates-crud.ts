// marketing/usecases/templates-crud.ts — Alta, edición y baja de plantillas de WhatsApp.
//
// Vive fuera del service por dos motivos: el service ya está en el límite de tamaño que impone el
// analyzer, y la edición dejó de ser un patch plano — ahora tiene que decidir qué pasa con la
// aprobación de Meta cuando cambia el texto.

import { NotFoundError } from 'arckode-framework'
import type { RepositoryAdapter, Auth, Logger } from 'arckode-framework'
import type { WhatsappTemplateDTO, CreateWhatsappTemplateDTO, MarketingUser } from '../types'
import { activeFlag } from './active-flag'
import { auditSafely, type AuditPort } from '../../../shared/usecases/audit'
import { PLANTILLAS_BASE } from './plantillas-base'

export interface TemplateCrudDeps {
  templateRepo: RepositoryAdapter<WhatsappTemplateDTO>
  auth?: Auth
  auditPort: AuditPort | null
  logger: Logger
}

/** Campos que el cliente puede editar. Los `meta*` de estado los escribe solo el servidor. */
const EDITABLE = ['name', 'body', 'category', 'language', 'metaCategory'] as const

/**
 * Cambiar cualquiera de estos invalida la aprobación: Meta aprobó una combinación exacta de
 * texto + idioma + categoría. El nombre visible y el interruptor de activa NO están acá — se pueden
 * cambiar sin volver a pedir permiso.
 */
const INVALIDATES_APPROVAL = ['body', 'language', 'metaCategory'] as const

async function ownedTemplate(
  deps: TemplateCrudDeps,
  id: string,
  user?: MarketingUser,
): Promise<WhatsappTemplateDTO> {
  const existing = await deps.templateRepo.findById(id)
  if (!existing) throw new NotFoundError('Plantilla no encontrada')
  if (deps.auth) deps.auth.assertOwnership(existing.hotelId, user?.hotelId ?? '', user?.role, 'super_admin')
  return existing
}

export async function createTemplate(
  repo: RepositoryAdapter<WhatsappTemplateDTO>,
  dto: CreateWhatsappTemplateDTO,
): Promise<WhatsappTemplateDTO> {
  return repo.create({ ...dto, isActive: activeFlag(dto.isActive) } as any)
}

/**
 * Edita la plantilla. Si el cambio toca lo que Meta aprobó, la aprobación se cae y hay que
 * reenviarla: mostrar "Aprobada" sobre un texto que Meta nunca vio es peor que perder la aprobación.
 */
export async function updateTemplate(
  deps: TemplateCrudDeps,
  id: string,
  data: Partial<CreateWhatsappTemplateDTO>,
  user?: MarketingUser,
): Promise<WhatsappTemplateDTO> {
  const existing = await ownedTemplate(deps, id, user)

  const patch: Record<string, any> = {}
  for (const k of EDITABLE) if ((data as any)[k] !== undefined) patch[k] = (data as any)[k]
  if (data.isActive !== undefined) patch.isActive = activeFlag(data.isActive)

  const touchesApproved = INVALIDATES_APPROVAL.some((k) => (data as any)[k] !== undefined)
  if (touchesApproved && existing.approvalStatus && existing.approvalStatus !== 'none') {
    patch.approvalStatus = 'none'
    patch.metaTemplateId = ''
    patch.metaRejectedReason = ''
  }

  await deps.templateRepo.update(id, patch as any)
  // @ignore IDOR_RISK — relectura post-escritura del MISMO id; la pertenencia se validó arriba.
  return deps.templateRepo.findById(id) as Promise<WhatsappTemplateDTO>
}

export async function deleteTemplate(deps: TemplateCrudDeps, id: string, user?: MarketingUser): Promise<void> {
  const existing = await ownedTemplate(deps, id, user)
  await deps.templateRepo.delete(id)
  await auditSafely(deps.auditPort, deps.logger, {
    hotelId: existing.hotelId, userId: user?.id, action: 'whatsapp_template.delete',
    entity: 'whatsapp_template', entityId: id, detail: `Plantilla de WhatsApp "${existing.name}" eliminada`,
  })
}

/** Carga la plantilla validando pertenencia, para las operaciones contra Meta. */
export async function loadOwnedTemplate(
  deps: TemplateCrudDeps,
  id: string,
  user?: MarketingUser,
): Promise<WhatsappTemplateDTO> {
  return ownedTemplate(deps, id, user)
}

/**
 * Crea de una vez las plantillas recomendadas que le falten al hotel.
 *
 * Idempotente por NOMBRE: tocar el botón dos veces no duplica nada, y una plantilla que el hotel
 * ya editó o mandó a Meta no se pisa. Las crea inactivas de texto listo — el hotel revisa, ajusta
 * si quiere, y recién ahí las manda a aprobar.
 */
export async function crearPlantillasBase(
  deps: TemplateCrudDeps,
  hotelId: string,
): Promise<{ creadas: string[]; yaExistian: string[] }> {
  const existentes = await deps.templateRepo.findMany({ hotelId })
  const nombres = new Set(existentes.map((t) => String(t.name).trim().toLowerCase()))

  const creadas: string[] = []
  const yaExistian: string[] = []

  for (const base of PLANTILLAS_BASE) {
    if (nombres.has(base.name.toLowerCase())) { yaExistian.push(base.name); continue }
    await deps.templateRepo.create({
      hotelId,
      name: base.name,
      body: base.body,
      category: base.category,
      metaCategory: base.metaCategory,
      language: 'es',
      isActive: 1,
      approvalStatus: 'none',
    } as any)
    creadas.push(base.name)
  }
  return { creadas, yaExistian }
}
