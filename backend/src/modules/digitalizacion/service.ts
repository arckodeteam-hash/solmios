// digitalizacion/service.ts — Reglas de negocio del expediente de digitalización.
//
// SOLMI OS detecta hoteles SIN presencia digital y los acompaña por cinco pasos (página web por
// plantilla, configuración completa —que se cobra—, Google Maps, Google Hotel y motor de reservas).
// Acá viven las reglas que cruzan campos y que por eso no pueden estar en validators/schema.ts:
//   · un hotel que YA tiene `website` no es candidato ni puede abrir expediente,
//   · un hotel no puede tener dos expedientes vivos a la vez (abierto o completado),
//   · Google Hotel solo se cierra si Google Maps ya está 'listo' (dependencia explícita del issue),
//   · cada paso exige su dato para pasar a 'listo' (plantilla, cobro, placeId, url del motor),
//   · con los cinco pasos en 'listo' el expediente se completa solo.
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
  DigitalizationStep,
  StepStatus,
  UpdateDigitalizationCaseDTO,
} from './types'
import { CASE_STATUSES, DIGITALIZATION_STEPS, SITE_TEMPLATE_KEYS, STEP_LABELS, STEP_STATUSES } from './types'

/**
 * Puerto mínimo sobre la tabla `hotels`: el módulo solo necesita saber si el hotel existe, cómo se
 * llama y si tiene web. Se inyecta como repo aparte (igual que subscriptions con `hotelsRepo`) para
 * no acoplar digitalizacion al DTO completo de hoteles y para poder testear con un fake.
 */
export interface DigitalizacionHotelRow {
  id: string
  name: string
  slug?: string | null
  website?: string | null
  /** La ciudad del hotel no tiene columna propia: `locality` y si no `municipality`. */
  locality?: string | null
  municipality?: string | null
}

/**
 * Eventos del expediente. El tipo vive acá (no en sockets.ts) porque el servicio es quien los
 * dispara; sockets.ts lo re-exporta para los connectors.
 */
export interface DigitalizacionSockets {
  onCaseCreated?: (c: DigitalizationCaseDTO) => Promise<void>
  onCaseUpdated?: (c: DigitalizationCaseDTO) => Promise<void>
}

/** Columna de estado de cada paso dentro del expediente. */
type StepStatusField =
  | 'websiteStatus'
  | 'configStatus'
  | 'googleMapsStatus'
  | 'googleHotelStatus'
  | 'bookingEngineStatus'

const STEP_STATUS_FIELD: Record<DigitalizationStep, StepStatusField> = {
  website: 'websiteStatus',
  config: 'configStatus',
  googleMaps: 'googleMapsStatus',
  googleHotel: 'googleHotelStatus',
  bookingEngine: 'bookingEngineStatus',
}

/**
 * Estados que "ocupan" al hotel: mientras haya un expediente abierto o completado no se abre otro
 * ni el hotel vuelve a la lista de candidatos. Un expediente `cancelado` no ocupa — el hotel puede
 * volver a entrar al programa más adelante.
 */
const ACTIVE_CASE_STATUSES: readonly DigitalizationCaseStatus[] = ['abierto', 'completado']

/** Presencia digital = tener algo cargado en `website`. '' y '   ' cuentan como no tener nada. */
function hasWebsite(website?: string | null): boolean {
  return typeof website === 'string' && website.trim() !== ''
}

function isBlank(value?: string | null): boolean {
  return typeof value !== 'string' || value.trim() === ''
}

function assertCaseStatus(status: string): asserts status is DigitalizationCaseStatus {
  if (!(CASE_STATUSES as readonly string[]).includes(status)) {
    throw new ValidationError(`status: debe ser una de ${CASE_STATUSES.join(', ')}`)
  }
}

function assertStep(step: string): asserts step is DigitalizationStep {
  if (!(DIGITALIZATION_STEPS as readonly string[]).includes(step)) {
    throw new ValidationError(`step: debe ser uno de ${DIGITALIZATION_STEPS.join(', ')}`)
  }
}

function assertStepStatus(status: string): asserts status is StepStatus {
  if (!(STEP_STATUSES as readonly string[]).includes(status)) {
    throw new ValidationError(`status: debe ser uno de ${STEP_STATUSES.join(', ')}`)
  }
}

/** La plantilla debe existir en el catálogo aunque el paso no se cierre: no hay landing sin preset. */
function assertTemplateKey(templateKey: string): void {
  if (!SITE_TEMPLATE_KEYS.includes(templateKey)) {
    throw new ValidationError(`templateKey: debe ser una de ${SITE_TEMPLATE_KEYS.join(', ')}`)
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

  /**
   * "Identificar hoteles que no tienen página web": candidatos = hoteles sin `website` y sin un
   * expediente vivo. Se resuelve en memoria (dos lecturas) porque el repo no hace joins y el
   * universo de hoteles del SaaS es chico.
   */
  async listCandidates(): Promise<DigitalizationCandidateDTO[]> {
    const hotels = await this.hotelsRepo.findMany({}, { orderBy: [{ field: 'name', dir: 'ASC' }] })
    const cases = await this.repo.findMany({})
    const conExpediente = new Set(
      cases.filter((c) => ACTIVE_CASE_STATUSES.includes(c.status)).map((c) => c.hotelId),
    )

    return hotels
      .filter((h) => !hasWebsite(h.website) && !conExpediente.has(h.id))
      .map((h) => ({
        hotelId: h.id,
        name: h.name,
        slug: h.slug ?? undefined,
        city: h.locality ?? h.municipality ?? undefined,
        website: h.website ?? undefined,
      }))
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
    if (previos.some((c) => ACTIVE_CASE_STATUSES.includes(c.status))) {
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
   */
  async advanceStep(id: string, input: AdvanceStepDTO): Promise<DigitalizationCaseDTO> {
    const actual = await this.getById(id)
    assertStep(input.step)
    assertStepStatus(input.status)

    const patch: Partial<Omit<DigitalizationCaseDTO, 'id'>> = {}
    if (input.templateKey !== undefined) {
      assertTemplateKey(input.templateKey)
      patch.templateKey = input.templateKey
    }
    if (input.siteUrl !== undefined) patch.siteUrl = input.siteUrl
    if (input.configFee !== undefined) {
      // Cotizar en 0 desde el avance del paso sería "configuración gratis": el issue dice que la
      // configuración completa se cobra. Bonificarla se hace por `update`, no avanzando el paso.
      if (input.configFee <= 0) {
        throw new ValidationError('configFee: el precio de la configuración debe ser mayor que 0')
      }
      patch.configFee = input.configFee
    }
    if (input.configCurrency !== undefined) patch.configCurrency = input.configCurrency
    if (input.configPaid !== undefined) patch.configPaid = input.configPaid
    if (input.googlePlaceId !== undefined) patch.googlePlaceId = input.googlePlaceId
    if (input.googleMapsUrl !== undefined) patch.googleMapsUrl = input.googleMapsUrl
    if (input.bookingEngineUrl !== undefined) patch.bookingEngineUrl = input.bookingEngineUrl
    if (input.notes !== undefined) patch.notes = input.notes

    // El expediente como quedaría: las reglas de cierre miran los datos que entran en este mismo
    // request, no solo los ya guardados.
    const resultante: DigitalizationCaseDTO = { ...actual, ...patch }
    if (input.status === 'listo') assertStepReady(input.step, resultante)

    patch[STEP_STATUS_FIELD[input.step]] = input.status
    resultante[STEP_STATUS_FIELD[input.step]] = input.status

    // Con los cinco pasos en 'listo' el expediente se completa solo — no hace falta cerrarlo a mano.
    if (actual.status === 'abierto' && DIGITALIZATION_STEPS.every((s) => resultante[STEP_STATUS_FIELD[s]] === 'listo')) {
      patch.status = 'completado'
    }

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

    const updated = await this.repo.update(id, {
      ...(input.status !== undefined && { status: input.status }),
      ...(input.notes !== undefined && { notes: input.notes }),
      ...(input.configFee !== undefined && { configFee: input.configFee }),
      ...(input.configCurrency !== undefined && { configCurrency: input.configCurrency }),
      ...(input.configPaid !== undefined && { configPaid: input.configPaid }),
      ...(input.templateKey !== undefined && { templateKey: input.templateKey }),
      ...(input.siteUrl !== undefined && { siteUrl: input.siteUrl }),
      ...(input.googlePlaceId !== undefined && { googlePlaceId: input.googlePlaceId }),
      ...(input.googleMapsUrl !== undefined && { googleMapsUrl: input.googleMapsUrl }),
      ...(input.bookingEngineUrl !== undefined && { bookingEngineUrl: input.bookingEngineUrl }),
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

/**
 * Qué exige cada paso para pasar a 'listo'. Fuera de la clase porque es una regla pura sobre el
 * expediente resultante — no necesita repo ni logger.
 */
function assertStepReady(step: DigitalizationStep, c: DigitalizationCaseDTO): void {
  switch (step) {
    case 'website':
      // El paso es "página web por plantilla": sin plantilla elegida no hay web que dar por hecha.
      if (isBlank(c.templateKey)) {
        throw new ValidationError(`${STEP_LABELS.website}: elegí una plantilla (templateKey) antes de darlo por listo`)
      }
      assertTemplateKey(c.templateKey as string)
      return
    case 'config':
      // Regla del issue: la configuración completa se cobra.
      if (c.configPaid !== true) {
        throw new ValidationError(`${STEP_LABELS.config}: la configuración completa se cobra — marcá configPaid antes de darlo por listo`)
      }
      if (c.configFee !== null && c.configFee !== undefined && c.configFee <= 0) {
        throw new ValidationError('configFee: el precio de la configuración debe ser mayor que 0')
      }
      return
    case 'googleMaps':
      if (isBlank(c.googlePlaceId)) {
        throw new ValidationError(`${STEP_LABELS.googleMaps}: falta el googlePlaceId de la ficha antes de darlo por listo`)
      }
      return
    case 'googleHotel':
      // Regla explícita del issue: Google Maps es necesario para trabajar la presencia en Google Hotel.
      if (c.googleMapsStatus !== 'listo') {
        throw new ValidationError(`${STEP_LABELS.googleHotel}: requiere ${STEP_LABELS.googleMaps} en estado listo`)
      }
      return
    case 'bookingEngine':
      if (isBlank(c.bookingEngineUrl)) {
        throw new ValidationError(`${STEP_LABELS.bookingEngine}: falta la bookingEngineUrl antes de darlo por listo`)
      }
      return
  }
}
