// pricing/usecases/blocks.ts — Bloqueos de habitaciones (mantenimiento/uso interno).
// Lógica pura sobre el repo `RoomBlocks`; el service delega acá y emite los sockets.
// Los bloqueos ocupan disponibilidad: el service notifica onBlocksChanged para que el
// connector baje la availability de las OTAs (Channex) — sin eso, bloquear una habitación
// no se reflejaba en los canales.

import { AuthError } from 'arckode-framework'
import type { RepositoryAdapter } from 'arckode-framework'

export interface BlockRow {
  id: string; hotelId: string; roomId: string; reason: string
  startDate: string; endDate: string; createdBy: string
}

export async function listBlocks(
  repo: RepositoryAdapter<any>, hotelId: string, startDate?: string, endDate?: string,
): Promise<BlockRow[]> {
  const data = (await repo.findMany({ hotelId })) as BlockRow[]
  if (startDate && endDate) return data.filter((b) => b.startDate <= endDate && b.endDate >= startDate)
  return data
}

export async function createBlocks(
  repo: RepositoryAdapter<any>, hotelId: string, userId: string, roomIds: string[], reason: string, startDate: string, endDate: string,
): Promise<BlockRow[]> {
  const created: BlockRow[] = []
  for (const roomId of roomIds) {
    created.push(await repo.create({ id: crypto.randomUUID(), hotelId, roomId, reason: reason || '', startDate, endDate, createdBy: userId }) as BlockRow)
  }
  return created
}

/** Borra un bloqueo. Seguridad (IDOR): solo del hotel del token — si es de otro hotel, AuthError. */
export async function deleteBlock(repo: RepositoryAdapter<any>, id: string, hotelId: string): Promise<BlockRow> {
  const block = await repo.findById(id) as BlockRow
  if (!block) throw new Error('Bloqueo no encontrado')
  if (block.hotelId !== hotelId) throw new AuthError('Sin acceso a este bloqueo')
  await repo.delete(id)
  return block
}
