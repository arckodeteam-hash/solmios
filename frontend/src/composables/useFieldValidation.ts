// Validación por campo del lado del cliente, ESPEJANDO el schema del backend.
//
// Por qué espeja y no inventa reglas: el bug más caro de esta pantalla fue justamente que el
// frontend y `hoteles/validators/schema.ts` divergieron —booleanos mandados como 0/1, enums en
// español contra enums en inglés— y el resultado era un 400 que devolvía un toast genérico
// ("Error guardando: hotel") sin decir qué campo estaba mal. El usuario no tenía forma de saberlo.
//
// La regla de oro: si acá se acepta algo, el backend lo tiene que aceptar. Este archivo no es la
// autoridad —lo es el schema— pero evita que el usuario descubra el error recién al guardar.
//
// El backend sigue validando igual: esto es UX, no seguridad.

export interface FieldRule {
  label: string
  required?: boolean
  min?: number
  max?: number
  /** Rango numérico (para type 'number'). */
  minValue?: number
  maxValue?: number
  pattern?: RegExp
  patternHint?: string
  /**
   * `image-src` es más ancho que `url` a propósito: el origen de una imagen puede ser una URL
   * externa, una ruta servida por la propia app (`/uploads/...`, que es lo que devuelve el
   * uploader) o un data URL de preview. Con `url` a secas, subir el logo desde la pantalla
   * dejaba el campo en rojo y bloqueaba el Guardar de TODA la configuración.
   */
  type?: 'string' | 'number' | 'email' | 'url' | 'image-src'
}

/** Mensaje de error del campo, o '' si está bien. */
export function validateField(value: unknown, rule: FieldRule): string {
  const empty = value === undefined || value === null || String(value).trim() === ''

  if (rule.required && empty) return `${rule.label} es obligatorio`
  // Un campo opcional vacío es válido: no se valida formato de lo que no se cargó.
  if (empty) return ''

  if (rule.type === 'number') {
    const n = Number(value)
    if (Number.isNaN(n)) return `${rule.label} debe ser un número`
    if (rule.minValue !== undefined && n < rule.minValue) return `${rule.label}: mínimo ${rule.minValue}`
    if (rule.maxValue !== undefined && n > rule.maxValue) return `${rule.label}: máximo ${rule.maxValue}`
    return ''
  }

  const s = String(value)
  if (rule.min !== undefined && s.length < rule.min) return `${rule.label}: mínimo ${rule.min} caracteres`
  if (rule.max !== undefined && s.length > rule.max) return `${rule.label}: máximo ${rule.max} caracteres`

  // Email y URL se validan por forma, no por existencia: no se hace ninguna llamada de red.
  if (rule.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) {
    return `${rule.label}: formato de email inválido`
  }
  if (rule.type === 'url' && !/^https?:\/\/.+\..+/.test(s)) {
    return `${rule.label}: debe empezar con http:// o https://`
  }
  // Un origen de imagen válido es una de tres: URL http(s), ruta absoluta del propio sitio
  // (lo que guarda el uploader) o data URL de imagen (lo que usa la previsualización).
  if (rule.type === 'image-src' && !/^(https?:\/\/.+\..+|\/.+|data:image\/[\w.+-]+[;,].+)$/.test(s)) {
    return `${rule.label}: usá una URL http(s) o una imagen subida desde acá`
  }
  if (rule.pattern && !rule.pattern.test(s)) {
    return rule.patternHint ? `${rule.label}: ${rule.patternHint}` : `${rule.label} tiene un formato inválido`
  }
  return ''
}

/** Valida un objeto entero. Devuelve { campo: mensaje } solo con los que fallan. */
export function validateAll(
  data: Record<string, unknown>,
  rules: Record<string, FieldRule>,
): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const [key, rule] of Object.entries(rules)) {
    const msg = validateField(data[key], rule)
    if (msg) errors[key] = msg
  }
  return errors
}

/**
 * Instala el aviso del navegador al cerrar/recargar con cambios sin guardar.
 * Devuelve la función de limpieza — el llamador la usa en onUnmounted.
 *
 * Sólo cubre cerrar pestaña o recargar: la navegación interna de Vue Router no dispara
 * `beforeunload`, y se maneja aparte con un guard de ruta.
 */
export function warnOnUnsavedChanges(isDirty: () => boolean): () => void {
  const handler = (e: BeforeUnloadEvent) => {
    if (!isDirty()) return
    e.preventDefault()
    // Los navegadores modernos ignoran el texto y muestran el suyo; returnValue se setea igual
    // porque algunos todavía lo exigen para mostrar el diálogo.
    e.returnValue = ''
  }
  window.addEventListener('beforeunload', handler)
  return () => window.removeEventListener('beforeunload', handler)
}

const HHMM = /^\d{2}:\d{2}$/

/**
 * Reglas del hotel — copiadas 1:1 de `backend/src/modules/hoteles/validators/schema.ts`
 * (UpdateHotelesSchema). Si allá cambia un `max`, acá también.
 */
export const HOTEL_RULES: Record<string, FieldRule> = {
  name: { label: 'Nombre del hotel', required: true, min: 2, max: 100 },
  country: { label: 'País', required: true, max: 100 },
  address: { label: 'Dirección', max: 200 },
  phone: { label: 'Teléfono principal', min: 7, max: 20 },
  phone2: { label: 'Teléfono 2', max: 20 },
  email: { label: 'Email', max: 200, type: 'email' },
  website: { label: 'Sitio web', max: 200, type: 'url' },
  logo: { label: 'Logo', max: 500, type: 'image-src' },   // el backend lo guarda como string libre; el uploader devuelve '/uploads/hotel-logos/...'
  timezone: { label: 'Zona horaria', max: 50 },
  currency: { label: 'Moneda', min: 3, max: 3 },
  checkIn: { label: 'Hora de check-in', pattern: HHMM, patternHint: 'usá el formato HH:MM (ej. 15:00)' },
  checkOut: { label: 'Hora de check-out', pattern: HHMM, patternHint: 'usá el formato HH:MM (ej. 12:00)' },
  ownerName: { label: 'Propietario', max: 100 },
  ownerTaxId: { label: 'RNC / Tax ID', max: 50 },
  province: { label: 'Provincia', max: 100 },
  municipality: { label: 'Municipio', max: 100 },
  locality: { label: 'Localidad', max: 100 },
  postalCode: { label: 'Código postal', max: 20 },
  latitude: { label: 'Latitud', type: 'number', minValue: -90, maxValue: 90 },
  longitude: { label: 'Longitud', type: 'number', minValue: -180, maxValue: 180 },
  depositPercent: { label: '% de depósito', type: 'number', minValue: 0, maxValue: 100 },
  weekendSurcharge: { label: 'Recargo de fin de semana', type: 'number', minValue: 0, maxValue: 100 },
  depositFixed: { label: 'Valor de la fianza', type: 'number', minValue: 0 },
  advanceAmount: { label: 'Monto del anticipo', type: 'number', minValue: 0 },
  releaseHours: { label: 'Horas de liberación', type: 'number', minValue: 0 },
  taxName: { label: 'Nombre del impuesto', max: 50 },
  taxRate: { label: 'Tasa de impuesto', type: 'number', minValue: 0, maxValue: 100 },
  wifiNetwork: { label: 'Red WiFi', max: 100 },
  wifiPassword: { label: 'Contraseña WiFi', max: 100 },
}
