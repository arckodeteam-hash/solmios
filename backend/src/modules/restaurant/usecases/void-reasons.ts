// restaurant/usecases/void-reasons.ts — Motivos predefinidos de anulación (#207). Viven en
// configuration(key='restaurant_void_reasons') por hotel, con un default si el hotel nunca los editó.
// Los usa el modal de motivo del KDS y de la comanda (botones grandes); "Otro" habilita texto libre
// del lado del cliente — acá solo se sirve la lista.
import type { RepositoryAdapter } from 'arckode-framework'
import { ValidationError } from 'arckode-framework'
import type { CurrentUser } from '../types'

export const VOID_REASONS_KEY = 'restaurant_void_reasons'
export const DEFAULT_VOID_REASONS: readonly string[] = ['Sin stock', 'Cliente se arrepintió', 'Error de carga', 'Otro']
const MAX_REASONS = 20
const MAX_REASON_LENGTH = 80

export interface VoidReasonsDeps { config: RepositoryAdapter<any> }

function hotelFor(user: CurrentUser): string {
  const h = user.hotelId || ''
  if (!h) throw new ValidationError('Sin hotel asignado')
  return h
}

/** Normaliza la lista: strings no vacíos, sin duplicados, recortados. Lanza si no queda ninguno. */
export function normalizeReasons(input: unknown): string[] {
  if (!Array.isArray(input)) throw new ValidationError('Los motivos deben ser una lista de textos')
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of input) {
    if (typeof raw !== 'string') throw new ValidationError('Cada motivo debe ser un texto')
    const text = raw.trim()
    if (!text) continue
    if (text.length > MAX_REASON_LENGTH) throw new ValidationError(`Un motivo no puede superar ${MAX_REASON_LENGTH} caracteres`)
    const key = text.toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(text)
  }
  if (!out.length) throw new ValidationError('Indicá al menos un motivo')
  if (out.length > MAX_REASONS) throw new ValidationError(`Máximo ${MAX_REASONS} motivos`)
  return out
}

/** Lista del hotel o el default. Una fila corrupta (no-array) cae al default, no a 500. */
export async function getVoidReasons(deps: VoidReasonsDeps, user: CurrentUser): Promise<{ reasons: string[]; isDefault: boolean }> {
  const hotelId = hotelFor(user)
  const row = await deps.config.findOne({ hotelId, key: VOID_REASONS_KEY })
  const value = row?.value
  if (Array.isArray(value) && value.length && value.every((v) => typeof v === 'string' && v.trim())) {
    return { reasons: value.map((v: string) => v.trim()), isDefault: false }
  }
  return { reasons: [...DEFAULT_VOID_REASONS], isDefault: true }
}

/** Reemplaza la lista del hotel (UPSERT en configuration). */
export async function setVoidReasons(deps: VoidReasonsDeps, input: unknown, user: CurrentUser): Promise<{ reasons: string[]; isDefault: boolean }> {
  const hotelId = hotelFor(user)
  const reasons = normalizeReasons(input)
  const now = new Date().toISOString()
  const row = await deps.config.findOne({ hotelId, key: VOID_REASONS_KEY })
  if (row) {
    await deps.config.update(row.id, { value: reasons, updatedAt: now } as any)
  } else {
    await deps.config.create({
      hotelId, key: VOID_REASONS_KEY, value: reasons,
      description: 'Motivos de anulación del restaurante', createdAt: now, updatedAt: now,
    } as any)
  }
  return { reasons, isDefault: false }
}
