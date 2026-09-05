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
import type {
  AdvanceStepDTO,
  DigitalizationCaseDTO,
  DigitalizationCaseStatus,
  DigitalizationStep,
  StepStatus,
} from '../types'
import { CASE_STATUSES, DIGITALIZATION_STEPS, SITE_TEMPLATE_KEYS, STEP_LABELS, STEP_STATUSES } from '../types'

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
 *
 * Exportada porque `service.update` escribe los MISMOS campos que el avance del paso: si ahí el
 * vacío se guardara crudo quedaría un '' que no es ni un dato ni "sin dato" para el resto del código.
 */
export function blankToNull(value: string): string | null {
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
 * Los estados del expediente que el operador puede fijar A MANO desde `service.update`.
 *
 * 'completado' NO es uno de ellos: es un estado DERIVADO de los cinco pasos que calcula
 * `reconcileCaseStatus`. Aceptarlo a mano dejaba cerrar el expediente con los cinco pasos en
 * 'pendiente' —y un expediente completado saca al hotel de `listCandidates` para siempre, o sea que
 * una sola llamada lo bloqueaba—. 'cancelado' y 'abierto' (reabrir) sí son decisiones del operador.
 */
export function assertManualCaseStatus(status: string): asserts status is DigitalizationCaseStatus {
  if (!(CASE_STATUSES as readonly string[]).includes(status)) {
    throw new ValidationError(`status: debe ser una de ${CASE_STATUSES.join(', ')}`)
  }
  if (status === 'completado') {
    throw new ValidationError(
      "status: 'completado' no se asigna a mano — el expediente se completa solo cuando los cinco pasos quedan en listo",
    )
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
  // Se persiste lo VALIDADO, no lo crudo: devolver `value` guardaba la URL con los espacios de
  // los extremos, que después rompen la comparación y el link de la pantalla.
  return value.trim()
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
      // `configFee` NO se exige acá a propósito. El issue dice que el precio exacto no está
      // definido, así que null es "todavía sin cotizar", y 0 es una configuración bonificada —
      // ambas legítimas. Quien acredita que se cobró es `configPaid`, y ya lo exigimos arriba.
      // Exigir `> 0` dejaba un expediente bonificado trabado para siempre: nunca llegaba a
      // 'completado' y el hotel quedaba fuera de listCandidates sin poder volver a entrar.
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
 * Coherencia del expediente ENTERO: todo paso que quede en 'listo' tiene que seguir teniendo su
 * dato (plantilla, cobro, placeId, url del motor) y Google Hotel listo sigue exigiendo Google Maps
 * listo. Se mira el expediente RESULTANTE, no el guardado.
 *
 * Existe porque `advanceStep` no es la única ruta que escribe estos campos: `service.update` podía
 * vaciar el dato de un paso ya cerrado (borrar `googlePlaceId` con `googleMapsStatus: 'listo'`) y
 * dejar el expediente en el mismo estado imposible que `assertStepNotLocked` bloquea en el avance.
 */
export function assertCaseCoherent(c: DigitalizationCaseDTO): void {
  for (const step of DIGITALIZATION_STEPS) {
    if (c[STEP_STATUS_FIELD[step]] === 'listo') assertStepReady(step, c)
  }
}

/**
 * La puerta única de las DOS rutas que escriben el expediente (`advanceStep` y `update`): verifica
 * la coherencia del resultado y devuelve el estado del expediente RECALCULADO a partir de los cinco
 * pasos —cinco 'listo' → 'completado', si alguno se reabre → 'abierto'—.
 *
 * 'cancelado' es lo único que el cálculo no pisa: es una decisión del operador. Reabrir un
 * expediente cancelado (`update({ status: 'abierto' })`) vuelve a pasar por acá, así que si los
 * cinco pasos ya estaban listos queda 'completado' en vez de un 'abierto' incoherente.
 */
export function reconcileCaseStatus(resultante: DigitalizationCaseDTO): DigitalizationCaseStatus {
  assertCaseCoherent(resultante)
  if (resultante.status === 'cancelado') return 'cancelado'
  return allStepsReady(resultante) ? 'completado' : 'abierto'
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
        // Mismo criterio que `update`: 0 es una configuración bonificada, no un error, y el issue
        // deja el precio sin definir. Lo único inválido es un importe negativo. Que se haya
        // cobrado lo acredita `configPaid`, que sí se exige para cerrar el paso.
        if (input.configFee < 0) {
          throw new ValidationError('configFee: no puede ser negativo')
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
  patch[STEP_STATUS_FIELD[input.step]] = input.status
  resultante[STEP_STATUS_FIELD[input.step]] = input.status

  // Coherencia del resultado (incluido "este paso salta a listo sin su dato") y estado del
  // expediente recalculado, con la MISMA función que usa `service.update`: si divergieran, una de
  // las dos rutas volvería a ser la puerta de atrás de la otra.
  const automatico = reconcileCaseStatus(resultante)
  if (automatico !== actual.status) patch.status = automatico

  return patch
}
