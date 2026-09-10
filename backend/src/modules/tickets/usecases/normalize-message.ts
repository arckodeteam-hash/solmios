// tickets/usecases/normalize-message.ts — Normaliza `messages` en LECTURA (REQ-SOP-02).
// El JSON persistido puede traer la forma vieja { author, date, message } (mock del panel de
// soporte, nunca tipada) mezclada con la forma nueva { id, authorId, authorName, authorKind,
// message, createdAt }. Nunca lanza: un valor corrupto/legacy se normaliza o se descarta, no
// tumba la lectura del ticket.
import type { TicketMessage } from '../types'

function normalizeOne(raw: unknown): TicketMessage | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Record<string, unknown>

  // Forma nueva: ya trae authorKind/authorId — se toma casi tal cual, solo se blindan los tipos.
  if (typeof m.authorKind === 'string' || typeof m.authorId === 'string') {
    return {
      id: typeof m.id === 'string' ? m.id : '',
      authorId: typeof m.authorId === 'string' ? m.authorId : '',
      authorName: typeof m.authorName === 'string' ? m.authorName : '',
      authorKind: m.authorKind === 'support' ? 'support' : 'hotel',
      message: typeof m.message === 'string' ? m.message : '',
      createdAt: typeof m.createdAt === 'string' ? m.createdAt : '',
    }
  }

  // Forma vieja: { author, date, message } — sin authorId (nunca lo tuvo).
  if (typeof m.author === 'string' || typeof m.date === 'string' || typeof m.message === 'string') {
    return {
      id: '',
      authorId: '',
      authorName: typeof m.author === 'string' ? m.author : '',
      authorKind: m.author === 'Soporte Arckode' ? 'support' : 'hotel',
      message: typeof m.message === 'string' ? m.message : '',
      createdAt: typeof m.date === 'string' ? m.date : '',
    }
  }

  return null
}

/** Acepta array, JSON string, o cualquier otra cosa (→ []). Nunca lanza. */
export function normalizeMessages(raw: unknown): TicketMessage[] {
  let value = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (!Array.isArray(value)) return []
  return value.map(normalizeOne).filter((m): m is TicketMessage => m !== null)
}
