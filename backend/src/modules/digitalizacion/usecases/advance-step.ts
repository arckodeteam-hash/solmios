// digitalizacion/usecases/advance-step.ts — Las reglas de avance de UN paso del expediente:
//   · cada paso exige su dato para pasar a 'listo' (plantilla, cobro, placeId, url del motor),
//   · Google Hotel solo se cierra si Google Maps ya está 'listo' (dependencia explícita del issue),
//   · con los cinco pasos en 'listo' el expediente se completa solo.
//
// Está fuera del service porque son funciones PURAS sobre el expediente resultante: no necesitan
// repo, logger ni sockets. El service se queda con la orquestación —leer, aplicar el patch, guardar
// y avisar por socket— (extraído para no pasar de 200 líneas — gate GOD_SERVICE de arckode analyze).
import { ValidationError } from 'arckode-framework'
import type { AdvanceStepDTO, DigitalizationCaseDTO, DigitalizationStep, StepStatus } from '../types'
import { DIGITALIZATION_STEPS, SITE_TEMPLATE_KEYS, STEP_LABELS, STEP_STATUSES } from '../types'

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

function isBlank(value?: string | null): boolean {
  return typeof value !== 'string' || value.trim() === ''
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
export function assertTemplateKey(templateKey: string): void {
  if (!SITE_TEMPLATE_KEYS.includes(templateKey)) {
    throw new ValidationError(`templateKey: debe ser una de ${SITE_TEMPLATE_KEYS.join(', ')}`)
  }
}

/**
 * Qué exige cada paso para pasar a 'listo'. Regla pura sobre el expediente resultante —el que ya
 * incorpora los datos que entran en este mismo request—, no sobre el guardado.
 */
export function assertStepReady(step: DigitalizationStep, c: DigitalizationCaseDTO): void {
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

/** Los cinco pasos en 'listo' = expediente terminado. */
export function allStepsReady(c: DigitalizationCaseDTO): boolean {
  return DIGITALIZATION_STEPS.every((s) => c[STEP_STATUS_FIELD[s]] === 'listo')
}

/** Campos del paso que viajan en el request. Se guardan SIEMPRE, aunque el paso no pase a 'listo'. */
function buildFieldsPatch(input: AdvanceStepDTO): Partial<Omit<DigitalizationCaseDTO, 'id'>> {
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
  return patch
}

/**
 * El patch completo del avance a partir del expediente actual: valida paso y estado, arma los
 * campos, exige el dato del paso si salta a 'listo' y completa el expediente si quedan los cinco
 * pasos listos. No toca la base: devolver el patch es todo lo que el service necesita.
 */
export function buildAdvanceStepPatch(
  actual: DigitalizationCaseDTO,
  input: AdvanceStepDTO,
): Partial<Omit<DigitalizationCaseDTO, 'id'>> {
  assertStep(input.step)
  assertStepStatus(input.status)

  const patch = buildFieldsPatch(input)

  // El expediente como quedaría: las reglas de cierre miran los datos que entran en este mismo
  // request, no solo los ya guardados.
  const resultante: DigitalizationCaseDTO = { ...actual, ...patch }
  if (input.status === 'listo') assertStepReady(input.step, resultante)

  patch[STEP_STATUS_FIELD[input.step]] = input.status
  resultante[STEP_STATUS_FIELD[input.step]] = input.status

  // Con los cinco pasos en 'listo' el expediente se completa solo — no hace falta cerrarlo a mano.
  if (actual.status === 'abierto' && allStepsReady(resultante)) patch.status = 'completado'

  return patch
}
