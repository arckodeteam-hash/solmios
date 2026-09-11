// admin/usecases/announcement-templates.ts — Plantillas de anuncios del super admin (#111, ANN-7).
// Mismo patrón que trial-days.ts (#103): 1 fila en `configuration`
// (hotelId='platform', key='announcement_templates') cuyo `value` es el array de plantillas.
// La pestaña Anuncios guardaba ese mismo shape vía /configuracion (JSON.stringify del array), así
// que la lectura tolera `value` serializado como string u objeto y un JSON corrupto cae a `[]`.
import type { RepositoryAdapter } from 'arckode-framework'
import { ValidationError } from 'arckode-framework'

export interface AnnouncementTemplate {
  name: string
  icon: string
  description: string
  type: string
  message: string
}

export const DEFAULT_TEMPLATE_ICON = '📌'
/** Más de 50 plantillas ya no es una lista de atajos: es otra pantalla. */
export const ANNOUNCEMENT_TEMPLATES_MAX = 50

const TEMPLATES_KEY = 'announcement_templates'
const PLATFORM = 'platform'

/**
 * Deserializa `value` con tolerancia: el driver puede devolver el json como objeto o string, y la
 * escritura histórica desde el frontend (JSON.stringify del array guardado en una columna json)
 * puede dejar el array serializado DENTRO del string. Cualquier cosa que no termine en array → [].
 */
function parseTemplates(raw: unknown): unknown[] {
  let value: unknown = raw
  try {
    for (let i = 0; i < 2 && typeof value === 'string'; i++) value = JSON.parse(value)
  } catch { return [] }
  return Array.isArray(value) ? value : []
}

async function readRaw(configRepo: RepositoryAdapter<any>): Promise<{ row: any; templates: unknown[] }> {
  const rows = await configRepo.findMany({ hotelId: PLATFORM, key: TEMPLATES_KEY })
  const row = (rows as any[])?.[0]
  return { row, templates: row ? parseTemplates(row.value) : [] }
}

function esTexto(v: unknown): v is string {
  return typeof v === 'string'
}

/** Ítem leído de la fila: se descarta en silencio si no tiene lo mínimo (name/type/message). */
function normalizarLeida(item: unknown): AnnouncementTemplate | null {
  if (!item || typeof item !== 'object') return null
  const t = item as Record<string, unknown>
  if (!esTexto(t.name) || !t.name.trim() || !esTexto(t.type) || !t.type.trim() || !esTexto(t.message)) return null
  return {
    name: t.name.trim(),
    icon: esTexto(t.icon) && t.icon.trim() ? t.icon.trim() : DEFAULT_TEMPLATE_ICON,
    description: esTexto(t.description) ? t.description : '',
    type: t.type.trim(),
    message: t.message,
  }
}

/** Sin fila, JSON corrupto o `value` que no es array → `[]` (fallback silencioso, como getTrialDays). */
export async function getAnnouncementTemplates(configRepo: RepositoryAdapter<any>): Promise<{ templates: AnnouncementTemplate[] }> {
  const { templates } = await readRaw(configRepo)
  return { templates: templates.map(normalizarLeida).filter((t): t is AnnouncementTemplate => t !== null) }
}

/**
 * Valida y normaliza la lista entrante: array de hasta 50 ítems, cada uno con `name` y `type`
 * no vacíos y `message` string; `icon`/`description` opcionales con default; nombres únicos
 * (case-insensitive, porque la tarjeta se identifica por el nombre). ValidationError si no.
 */
export function normalizarTemplates(input: unknown): AnnouncementTemplate[] {
  if (!Array.isArray(input)) throw new ValidationError('templates debe ser un array de plantillas')
  if (input.length > ANNOUNCEMENT_TEMPLATES_MAX) {
    throw new ValidationError(`templates admite como máximo ${ANNOUNCEMENT_TEMPLATES_MAX} plantillas`)
  }
  const vistos = new Set<string>()
  return input.map((item, i) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new ValidationError(`templates[${i}] debe ser un objeto`)
    }
    const t = item as Record<string, unknown>
    if (!esTexto(t.name) || !t.name.trim()) throw new ValidationError(`templates[${i}].name es obligatorio`)
    if (!esTexto(t.type) || !t.type.trim()) throw new ValidationError(`templates[${i}].type es obligatorio`)
    if (!esTexto(t.message)) throw new ValidationError(`templates[${i}].message debe ser un string`)
    if (t.icon !== undefined && !esTexto(t.icon)) throw new ValidationError(`templates[${i}].icon debe ser un string`)
    if (t.description !== undefined && !esTexto(t.description)) {
      throw new ValidationError(`templates[${i}].description debe ser un string`)
    }
    const name = t.name.trim()
    const clave = name.toLowerCase()
    if (vistos.has(clave)) throw new ValidationError(`templates: el nombre "${name}" está repetido`)
    vistos.add(clave)
    return {
      name,
      icon: esTexto(t.icon) && t.icon.trim() ? t.icon.trim() : DEFAULT_TEMPLATE_ICON,
      description: esTexto(t.description) ? t.description : '',
      type: t.type.trim(),
      message: t.message,
    }
  })
}

/** Upsert de la única fila platform/announcement_templates; devuelve la lista normalizada. */
export async function setAnnouncementTemplates(
  configRepo: RepositoryAdapter<any>,
  templates: unknown,
): Promise<{ templates: AnnouncementTemplate[] }> {
  const value = normalizarTemplates(templates)
  const { row } = await readRaw(configRepo)
  if (row) await configRepo.update(row.id, { value })
  else await configRepo.create({ id: crypto.randomUUID(), hotelId: PLATFORM, key: TEMPLATES_KEY, value })
  return { templates: value }
}
