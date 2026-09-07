// marketing/usecases/meta-templates.ts — Manda una plantilla a Meta y trae de vuelta su estado.
//
// Una plantilla de WhatsApp no se puede usar hasta que Meta la aprueba. Hasta ahora el PMS guardaba
// el texto y nada más, así que "plantilla" acá y "plantilla" en WhatsApp eran dos cosas sin relación.
// Estas dos operaciones son el puente:
//
//   submit       → la crea en la cuenta del hotel y la deja 'pending'
//   syncStatus   → pregunta a Meta cómo quedó ('approved' / 'rejected') y actualiza la copia local
//
// Meta es dueño del ESTADO; nosotros del TEXTO. Por eso el sync nunca pisa el cuerpo local, y el
// submit nunca inventa un estado que Meta no haya confirmado.

import { ValidationError, ConflictError, NotFoundError } from 'arckode-framework'
import type { RepositoryAdapter } from 'arckode-framework'
import type {
  WhatsappCloudCredentials, CreateMetaTemplateInput, MetaTemplateCategory, MetaTemplateStatus,
} from '../../../services/whatsapp-cloud-client'
import type { WhatsappTemplateDTO, TemplateApprovalStatus } from '../types'
import { toMetaBody, metaTemplateName, metaBodyProblem, buildTemplateComponents } from './meta-variable-mapping'

/**
 * De dónde salen las credenciales de WhatsApp del hotel. La config vive en el módulo
 * `ai-recepcionista` (tabla `ai_whatsapp_config`), y marketing no puede importarlo: la
 * implementación la inyecta el connector `marketing-whatsapp-meta`.
 */
export interface MetaWhatsappCredentialsPort {
  getMetaCredentials(hotelId: string): Promise<WhatsappCloudCredentials | null>
}

/** La parte del cliente de Meta que usamos. Se inyecta para poder testear sin salir a la red. */
export interface MetaTemplateClient {
  create(creds: WhatsappCloudCredentials, input: CreateMetaTemplateInput): Promise<{ id: string; status: string; category?: string }>
  getStatus(creds: WhatsappCloudCredentials, metaTemplateId: string): Promise<{ status: MetaTemplateStatus; rejectedReason?: string; category?: string }>
}

export interface MetaTemplateDeps {
  templateRepo: RepositoryAdapter<WhatsappTemplateDTO>
  credentials: MetaWhatsappCredentialsPort
  client: MetaTemplateClient
}

/** Mensaje único para el caso "este hotel todavía no conectó WhatsApp". */
const NOT_CONNECTED =
  'WhatsApp Business no está conectado — configurá la conexión primero en Configuración → Integraciones.'

/**
 * Meta maneja seis estados; el panel muestra cuatro. `PAUSED` y `DISABLED` significan que la
 * plantilla dejó de poder usarse por mala calidad: para el hotel es lo mismo que un rechazo
 * (no puede mandarla), y así lo muestra — con el motivo real en `metaRejectedReason`.
 */
export function mapMetaStatus(status: MetaTemplateStatus | string): TemplateApprovalStatus {
  switch (status) {
    case 'APPROVED': return 'approved'
    case 'PENDING':
    case 'IN_APPEAL': return 'pending'
    case 'REJECTED':
    case 'PAUSED':
    case 'DISABLED': return 'rejected'
    default: return 'pending'
  }
}

async function credentialsOrFail(deps: MetaTemplateDeps, hotelId: string): Promise<WhatsappCloudCredentials> {
  const creds = await deps.credentials.getMetaCredentials(hotelId)
  if (!creds?.wabaId || !creds?.accessToken) throw new ConflictError(NOT_CONNECTED)
  return creds
}

/**
 * Envía la plantilla a Meta para aprobación.
 *
 * Antes de salir a la red valida las reglas de forma de Meta (`metaBodyProblem`): cada rechazo suyo
 * queda registrado en la cuenta del hotel y sus errores no dicen qué corregir.
 */
export async function submitTemplateToMeta(
  deps: MetaTemplateDeps,
  template: WhatsappTemplateDTO,
): Promise<WhatsappTemplateDTO> {
  if (template.approvalStatus === 'pending') {
    throw new ConflictError('Esta plantilla ya está esperando la revisión de Meta.')
  }
  if (template.approvalStatus === 'approved') {
    throw new ConflictError('Meta ya aprobó esta plantilla. Editá el texto para volver a enviarla.')
  }

  const creds = await credentialsOrFail(deps, template.hotelId)
  const mapped = toMetaBody(template.body || '')

  const problem = metaBodyProblem(mapped.metaBody)
  if (problem) throw new ValidationError(problem)

  const language = template.language || 'es'
  const category = (template.metaCategory || 'UTILITY') as MetaTemplateCategory

  const created = await deps.client.create(creds, {
    name: metaTemplateName(template.name),
    language,
    category,
    components: buildTemplateComponents(mapped),
  })

  await deps.templateRepo.update(template.id, {
    metaTemplateId: created.id,
    approvalStatus: mapMetaStatus(created.status || 'PENDING'),
    metaCategory: created.category || category,
    metaRejectedReason: '',
    metaVariableOrder: mapped.variableOrder,
    language,
    metaSyncedAt: new Date().toISOString(),
  } as Partial<WhatsappTemplateDTO>)

  // @ignore IDOR_RISK — relectura post-escritura del MISMO id; la pertenencia la validó el service.
  const reloaded = await deps.templateRepo.findById(template.id)
  if (!reloaded) throw new NotFoundError('Plantilla no encontrada')
  return reloaded
}

/**
 * Pregunta a Meta el estado de UNA plantilla ya enviada y actualiza la copia local.
 * Nunca toca el cuerpo: si el texto local y el de Meta divergieran, el dueño del texto somos nosotros.
 */
export async function syncTemplateStatus(
  deps: MetaTemplateDeps,
  template: WhatsappTemplateDTO,
): Promise<WhatsappTemplateDTO> {
  if (!template.metaTemplateId) {
    throw new ConflictError('La plantilla todavía no fue enviada a Meta.')
  }

  const creds = await credentialsOrFail(deps, template.hotelId)
  const remote = await deps.client.getStatus(creds, template.metaTemplateId)

  await deps.templateRepo.update(template.id, {
    approvalStatus: mapMetaStatus(remote.status),
    metaRejectedReason: remote.rejectedReason || '',
    metaSyncedAt: new Date().toISOString(),
  } as Partial<WhatsappTemplateDTO>)

  // @ignore IDOR_RISK — relectura post-escritura del MISMO id; la pertenencia la validó el service.
  const reloaded = await deps.templateRepo.findById(template.id)
  if (!reloaded) throw new NotFoundError('Plantilla no encontrada')
  return reloaded
}
