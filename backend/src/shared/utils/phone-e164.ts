// shared/utils/phone-e164.ts — Normaliza un teléfono al formato que exige Meta.
//
// Existe porque la misma lógica estaba copiada en tres componentes del frontend con criterios
// distintos, y una de esas copias ya produjo un bug documentado: un teléfono cargado sin prefijo
// armaba `wa.me/8095550000`, que WhatsApp no resuelve — el botón existía y no contactaba a nadie
// (ver `pages/technical-providers/index.vue`). Meta rechaza cualquier cosa que no sea E.164.

/**
 * Prefijos telefónicos por país, en ISO-3166 alfa-2. Solo los países donde hoy hay hoteles o
 * huéspedes; agregar uno es una línea. Un país que falte cae al camino "exigir el + explícito",
 * que es correcto: es preferible pedirle al hotel que cargue el prefijo antes que adivinarlo mal
 * y mandarle la reserva de un huésped a un desconocido.
 */
const PREFIJOS: Record<string, string> = {
  DO: '1', US: '1', CA: '1', PR: '1',
  MX: '52', CO: '57', AR: '54', CL: '56', PE: '51', BR: '55',
  ES: '34', UY: '598', PY: '595', BO: '591', EC: '593', VE: '58',
  CR: '506', PA: '507', GT: '502', HN: '504', SV: '503', NI: '505',
  CU: '53', HT: '509', JM: '1', FR: '33', DE: '49', IT: '39', GB: '44',
}

/** Un E.164 razonable tiene entre 8 y 15 dígitos contando el prefijo del país. */
const MIN_DIGITOS = 8
const MAX_DIGITOS = 15

/**
 * Devuelve el número en E.164 sin el `+` (que es como lo quiere la Cloud API), o `null` si no se
 * puede construir uno creíble.
 *
 * `null` NO es un detalle: quien llama debe frenar y pedir que corrijan el teléfono del huésped.
 * Mandar a un número inventado es, en el mejor caso, plata tirada, y en el peor, mandarle los datos
 * de una reserva a un tercero.
 */
export function toE164(phone: string | null | undefined, defaultCountry?: string | null): string | null {
  const bruto = String(phone ?? '').trim()
  if (!bruto) return null

  // Un `+` inicial significa que el número YA trae su prefijo: se respeta tal cual.
  const traePrefijo = bruto.startsWith('+') || bruto.startsWith('00')
  const digitos = bruto.replace(/\D/g, '').replace(/^00/, '')
  if (!digitos) return null

  if (traePrefijo) {
    return digitos.length >= MIN_DIGITOS && digitos.length <= MAX_DIGITOS ? digitos : null
  }

  const prefijo = PREFIJOS[String(defaultCountry ?? '').trim().toUpperCase()]
  if (!prefijo) {
    // Sin país conocido, un número local es ambiguo: 809-555-0000 puede ser de cualquier lado.
    // Solo se acepta si ya viene con pinta de internacional completo.
    return digitos.length >= 11 && digitos.length <= MAX_DIGITOS ? digitos : null
  }

  // El hotel a veces carga el número ya con su prefijo pero sin el `+`. Duplicarlo lo rompería.
  const completo = digitos.startsWith(prefijo) && digitos.length > prefijo.length + 6
    ? digitos
    : `${prefijo}${digitos}`

  return completo.length >= MIN_DIGITOS && completo.length <= MAX_DIGITOS ? completo : null
}
