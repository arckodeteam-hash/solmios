// digitalizacion/usecases/advance-step.ts — Las reglas de avance de UN paso del expediente:
//   · cada paso exige su dato para pasar a 'listo' (plantilla, cobro, placeId, url del motor),
//   · Google Hotel solo se cierra si Google Maps ya está 'listo' —y Google Maps no se reabre
//     mientras Google Hotel siga listo— (dependencia explícita del issue, en las dos direcciones),
//   · el estado del expediente es una FUNCIÓN de los cinco pasos: cinco 'listo' → 'completado',
//     y si alguno se reabre vuelve a 'abierto',
//   · el avance de un paso solo escribe LOS DATOS DE ESE PASO,
//   · un string vacío o en blanco BORRA el dato (la pantalla necesita deshacer una carga), y con
//     valor se valida acá el formato —plantilla del catálogo, URLs http(s)—: en el borde HTTP no
//     puede estar, porque ahí el vacío se rechazaba antes de llegar a la regla de borrado.
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

/**
 * Un string vacío (o sólo espacios) NO es un dato: es "borrá lo que había". La pantalla necesita
 * poder deshacer una URL mal tipeada, y si lo guardáramos tal cual el campo quedaría "cargado" con
 * basura y dejaría cerrar el paso. Se persiste como null y las reglas de cierre lo ven como ausente.
 */
function blankToNull(value: string): string | null {
  return value.trim() === '' ? null : value
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

/**
 * La plantilla debe existir en el catálogo SIEMPRE que venga un valor, aunque el paso no se cierre:
 * no hay landing sin preset. El vacío es la excepción —significa "saqué la plantilla elegida"— y por
 * eso no se valida contra el catálogo: lo resuelve `blankToNull`.
 *
 * Esta guarda es la que antes hacía el `enum` de validators/schema.ts, y corre en las DOS rutas que
 * escriben el campo: el avance del paso y `service.update`.
 */
export function assertTemplateKey(templateKey: string): void {
  if (isBlank(templateKey)) return
  if (!SITE_TEMPLATE_KEYS.includes(templateKey.trim())) {
    throw new ValidationError(`templateKey: debe ser una de ${SITE_TEMPLATE_KEYS.join(', ')}`)
  }
}

/**
 * Una URL cargada tiene que ser una URL navegable: `http(s)://…`. Reemplaza al `type: 'url'` del
 * schema, que rechazaba el vacío —o sea, impedía borrar el dato— y en cambio aceptaba cualquier
 * esquema (`javascript:`, `file:`) porque `new URL` los parsea igual de bien.
 *
 * Devuelve lo que hay que persistir: null si viene vacío/en blanco (BORRAR el dato, que las reglas
 * de cierre siguen leyendo como AUSENTE) o la URL tal cual si es válida.
 */
export function normalizeUrlField(field: string, value: string): string | null {
  if (isBlank(value)) return null
  const invalida = new ValidationError(`${field}: debe ser una URL válida que empiece con http:// o https://`)
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    throw invalida
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw invalida
  return value
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
      // isBlank trata '   ' como ausente: una ficha no queda "hecha" con un placeId de espacios.
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

/**
 * La misma dependencia del issue —"Google Maps es necesario para poder trabajar la presencia en
 * Google Hotel"— leída al REVÉS: si Google Hotel ya está listo, reabrir Google Maps dejaría el
 * expediente en un estado imposible (Google Hotel hecho sin ficha de Maps). Se RECHAZA en lugar de
 * arrastrar Google Hotel hacia atrás: el operador ve qué pasó y no le cambiamos datos por debajo.
 */
export function assertStepNotLocked(
  step: DigitalizationStep,
  status: StepStatus,
  actual: DigitalizationCaseDTO,
): void {
  if (step === 'googleMaps' && status !== 'listo' && actual.googleHotelStatus === 'listo') {
    throw new ValidationError(
      `${STEP_LABELS.googleMaps}: no se puede reabrir mientras ${STEP_LABELS.googleHotel} esté listo — bajá primero ${STEP_LABELS.googleHotel}`,
    )
  }
}

/** Los cinco pasos en 'listo' = expediente terminado. */
export function allStepsReady(c: DigitalizationCaseDTO): boolean {
  return DIGITALIZATION_STEPS.every((s) => c[STEP_STATUS_FIELD[s]] === 'listo')
}

/**
 * Campos del paso que viajan en el request. Se guardan SIEMPRE, aunque el paso no pase a 'listo'.
 *
 * Sólo se escriben los campos QUE LE PERTENECEN al paso declarado; los de otros pasos que vengan en
 * el body se IGNORAN en silencio. Si no, avanzando 'website' se podría mandar `configPaid: false` y
 * desmarcar un cobro sin pasar nunca por las reglas de la configuración.
 * `notes` no es de ningún paso —es el comentario del operador sobre el avance— y se guarda siempre.
 */
function buildFieldsPatch(
  step: DigitalizationStep,
  input: AdvanceStepDTO,
): Partial<Omit<DigitalizationCaseDTO, 'id'>> {
  const patch: Partial<Omit<DigitalizationCaseDTO, 'id'>> = {}
  if (input.notes !== undefined) patch.notes = blankToNull(input.notes)

  switch (step) {
    case 'website':
      if (input.templateKey !== undefined) {
        // Vacío = "saqué la plantilla elegida"; con valor, tiene que estar en el catálogo.
        assertTemplateKey(input.templateKey)
        patch.templateKey = blankToNull(input.templateKey)
      }
      if (input.siteUrl !== undefined) patch.siteUrl = normalizeUrlField('siteUrl', input.siteUrl)
      return patch
    case 'config':
      if (input.configFee !== undefined) {
        // Cotizar en 0 desde el avance del paso sería "configuración gratis": el issue dice que la
        // configuración completa se cobra. Bonificarla se hace por `update`, no avanzando el paso.
        if (input.configFee <= 0) {
          throw new ValidationError('configFee: el precio de la configuración debe ser mayor que 0')
        }
        patch.configFee = input.configFee
      }
      // La moneda no se borra: el expediente siempre tiene una (arranca en USD). Vacío = no tocar.
      if (input.configCurrency !== undefined && !isBlank(input.configCurrency)) {
        patch.configCurrency = input.configCurrency
      }
      if (input.configPaid !== undefined) patch.configPaid = input.configPaid
      return patch
    case 'googleMaps':
      if (input.googlePlaceId !== undefined) patch.googlePlaceId = blankToNull(input.googlePlaceId)
      if (input.googleMapsUrl !== undefined) {
        patch.googleMapsUrl = normalizeUrlField('googleMapsUrl', input.googleMapsUrl)
      }
      return patch
    case 'googleHotel':
      // Google Hotel no tiene datos propios: sólo su estado y la dependencia con Google Maps.
      return patch
    case 'bookingEngine':
      if (input.bookingEngineUrl !== undefined) {
        patch.bookingEngineUrl = normalizeUrlField('bookingEngineUrl', input.bookingEngineUrl)
      }
      return patch
  }
}

/**
 * El patch completo del avance a partir del expediente actual: valida paso y estado, arma los
 * campos del paso, exige el dato si salta a 'listo' y recalcula el estado del expediente.
 * No toca la base: devolver el patch es todo lo que el service necesita.
 */
export function buildAdvanceStepPatch(
  actual: DigitalizationCaseDTO,
  input: AdvanceStepDTO,
): Partial<Omit<DigitalizationCaseDTO, 'id'>> {
  assertStep(input.step)
  assertStepStatus(input.status)
  assertStepNotLocked(input.step, input.status, actual)

  const patch = buildFieldsPatch(input.step, input)

  // El expediente como quedaría: las reglas de cierre miran los datos que entran en este mismo
  // request, no solo los ya guardados.
  const resultante: DigitalizationCaseDTO = { ...actual, ...patch }
  if (input.status === 'listo') assertStepReady(input.step, resultante)

  patch[STEP_STATUS_FIELD[input.step]] = input.status
  resultante[STEP_STATUS_FIELD[input.step]] = input.status

  // El estado del expediente es una FUNCIÓN de los cinco pasos, en las DOS direcciones: con los
  // cinco en 'listo' se completa solo, y si después alguno se reabre vuelve a 'abierto' (si no,
  // quedaría "completado" con un paso sin terminar). 'cancelado' lo pone el operador a mano desde
  // `update`: es una decisión suya, el auto-cálculo no la pisa.
  if (actual.status !== 'cancelado') {
    const automatico = allStepsReady(resultante) ? 'completado' : 'abierto'
    if (automatico !== actual.status) patch.status = automatico
  }

  return patch
}
