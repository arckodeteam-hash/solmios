// digitalizacion/service.ts — Orquestación del expediente de digitalización.
//
// SOLMI OS detecta hoteles SIN presencia digital y los acompaña por cinco pasos (página web por
// plantilla, configuración completa —que se cobra—, Google Maps, Google Hotel y motor de reservas).
// Acá viven las reglas que cruzan campos y que por eso no pueden estar en validators/schema.ts:
//   · un hotel que YA tiene `website` no es candidato ni puede abrir expediente,
//   · un hotel no puede tener dos expedientes vivos a la vez (abierto o completado).
// Las reglas puras de cada paso están en `usecases/advance-step.ts` y la detección de candidatos en
// `usecases/candidates.ts` (el service no puede pasar de 200 líneas — gate arckode).
//
// Scope PLATAFORMA: el expediente lo gestiona el super_admin del SaaS (mismo patrón que
// sales-leads / site-pages), aunque la fila apunte a un hotel.
import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { ConflictError, NotFoundError, ValidationError } from 'arckode-framework'
import { composeSockets } from '../../shared/utils/compose-sockets'
import type {
  AdvanceStepDTO,
  CreateDigitalizationCaseDTO,
  DigitalizationCandidateDTO,
  DigitalizationCaseDTO,
  DigitalizationCaseStatus,
  DigitalizationListResult,
  UpdateDigitalizationCaseDTO,
} from './types'
import { CASE_STATUSES } from './types'
import { assertTemplateKey, buildAdvanceStepPatch, normalizeUrlField } from './usecases/advance-step'
import type { DigitalizacionHotelRow } from './usecases/candidates'
import { hasActiveCase, hasWebsite, selectCandidates } from './usecases/candidates'

// El puerto sobre `hotels` vive con quien lo consume (usecases/candidates.ts); se re-exporta acá
// porque index.ts y los tests lo toman del service.
export type { DigitalizacionHotelRow } from './usecases/candidates'

/**
 * Eventos del expediente. El tipo vive acá (no en sockets.ts) porque el servicio es quien los
 * dispara; sockets.ts lo re-exporta para los connectors.
 */
export interface DigitalizacionSockets {
  onCaseCreated?: (c: DigitalizationCaseDTO) => Promise<void>
  onCaseUpdated?: (c: DigitalizationCaseDTO) => Promise<void>
}

function assertCaseStatus(status: string): asserts status is DigitalizationCaseStatus {
  if (!(CASE_STATUSES as readonly string[]).includes(status)) {
    throw new ValidationError(`status: debe ser una de ${CASE_STATUSES.join(', ')}`)
  }
}

export class DigitalizacionService {
  private sockets: DigitalizacionSockets = {}

  constructor(
    private readonly repo: RepositoryAdapter<DigitalizationCaseDTO>,
    private readonly hotelsRepo: RepositoryAdapter<DigitalizacionHotelRow>,
    private readonly logger: Logger,
  ) {}

  setSockets(s: Partial<DigitalizacionSockets>): void {
    composeSockets(this.sockets, s)
  }

  /** "Identificar hoteles que no tienen página web" — reglas en `usecases/candidates.ts`. */
  async listCandidates(): Promise<DigitalizationCandidateDTO[]> {
    const hotels = await this.hotelsRepo.findMany({}, { orderBy: [{ field: 'name', dir: 'ASC' }] })
    const cases = await this.repo.findMany({})
    return selectCandidates(hotels, cases)
  }

  /** Lista completa para el super_admin, más recientes primero. */
  async list(): Promise<DigitalizationListResult> {
    const data = await this.repo.findMany({}, { orderBy: [{ field: 'createdAt', dir: 'DESC' }] })
    return { data, total: data.length }
  }

  async getById(id: string): Promise<DigitalizationCaseDTO> {
    const item = await this.repo.findOne({ id })
    if (!item) throw new NotFoundError('Expediente de digitalización no encontrado')
    return item
  }

  /** Abre el expediente: todos los pasos arrancan en 'pendiente' y la configuración sin cobrar. */
  async create(input: CreateDigitalizationCaseDTO): Promise<DigitalizationCaseDTO> {
    const hotel = await this.hotelsRepo.findOne({ id: input.hotelId })
    if (!hotel) throw new NotFoundError('Hotel no encontrado')

    // Regla del issue: se considera digitalización cuando el hotel no tiene NADA.
    if (hasWebsite(hotel.website)) {
      throw new ValidationError(
        'hotelId: el hotel ya tiene página web — la digitalización es para hoteles sin presencia digital',
      )
    }

    const previos = await this.repo.findMany({ hotelId: input.hotelId })
    if (hasActiveCase(previos)) {
      throw new ConflictError(`Ya existe un expediente de digitalización para el hotel "${hotel.name}"`)
    }

    // `as` como en site-pages/service.ts: createdAt/updatedAt los llena el ORM (timestamps: true).
    const item = await this.repo.create({
      hotelId: input.hotelId,
      hotelName: hotel.name,
      status: 'abierto',
      websiteStatus: 'pendiente',
      templateKey: null,
      siteUrl: null,
      configStatus: 'pendiente',
      // null = "aún sin cotizar", no "gratis".
      configFee: null,
      configCurrency: 'USD',
      configPaid: false,
      googleMapsStatus: 'pendiente',
      googlePlaceId: null,
      googleMapsUrl: null,
      googleHotelStatus: 'pendiente',
      bookingEngineStatus: 'pendiente',
      bookingEngineUrl: null,
      notes: input.notes ?? null,
    } as Omit<DigitalizationCaseDTO, 'id'>)

    this.logger.info('digitalizacion: expediente abierto', { id: item.id, hotelId: item.hotelId })
    await this.sockets.onCaseCreated?.(item)
    return item
  }

  /**
   * Avanza UN paso. Los datos del paso viajan en el mismo request y se guardan siempre —aunque el
   * paso quede en 'pendiente'/'en_progreso'—; solo el salto a 'listo' exige el dato del paso.
   * Qué exige cada paso y cuándo se completa el expediente: `usecases/advance-step.ts`.
   */
  async advanceStep(id: string, input: AdvanceStepDTO): Promise<DigitalizationCaseDTO> {
    const actual = await this.getById(id)
    const patch = buildAdvanceStepPatch(actual, input)

    const updated = await this.repo.update(id, patch)
    // Carrera: pudo borrarse entre el getById y el update — mismo 404.
    if (!updated) throw new NotFoundError('Expediente de digitalización no encontrado')
    this.logger.info('digitalizacion: paso avanzado', {
      id,
      step: input.step,
      status: input.status,
      caseStatus: updated.status,
    })
    await this.sockets.onCaseUpdated?.(updated)
    return updated
  }

  /** Edición del super_admin: estado del expediente, notas y datos sueltos de los pasos. */
  async update(id: string, input: UpdateDigitalizationCaseDTO): Promise<DigitalizationCaseDTO> {
    await this.getById(id) // 404 si no existe
    if (input.status !== undefined) assertCaseStatus(input.status)
    if (input.templateKey !== undefined) assertTemplateKey(input.templateKey)
    // Sin `> 0` acá a propósito: por edición manual 0 es válido (configuración bonificada), igual
    // que en UpdateDigitalizationCaseSchema.
    if (input.configFee !== undefined && input.configFee < 0) {
      throw new ValidationError('configFee: no puede ser negativo')
    }

    // Las URLs se chequean acá con el MISMO validador que usa advanceStep: el schema HTTP las deja
    // pasar como `string` para que el vacío pueda BORRAR el dato, así que el formato se valida en
    // esta capa. Sin esto, `update` sería la puerta de atrás para guardar una URL inválida.
    const url = (f: 'siteUrl' | 'googleMapsUrl' | 'bookingEngineUrl') =>
      input[f] !== undefined ? { [f]: normalizeUrlField(f, input[f] as string) } : undefined

    const updated = await this.repo.update(id, {
      ...(input.status !== undefined && { status: input.status }),
      ...(input.notes !== undefined && { notes: input.notes }),
      ...(input.configFee !== undefined && { configFee: input.configFee }),
      ...(input.configCurrency !== undefined && { configCurrency: input.configCurrency }),
      ...(input.configPaid !== undefined && { configPaid: input.configPaid }),
      ...(input.templateKey !== undefined && { templateKey: input.templateKey }),
      ...(input.googlePlaceId !== undefined && { googlePlaceId: input.googlePlaceId }),
      ...url('siteUrl'),
      ...url('googleMapsUrl'),
      ...url('bookingEngineUrl'),
    })
    if (!updated) throw new NotFoundError('Expediente de digitalización no encontrado')
    this.logger.info('digitalizacion: expediente actualizado', { id, status: updated.status })
    await this.sockets.onCaseUpdated?.(updated)
    return updated
  }

  async remove(id: string): Promise<void> {
    await this.getById(id)
    await this.repo.delete(id)
    this.logger.info('digitalizacion: expediente eliminado', { id })
  }
}
