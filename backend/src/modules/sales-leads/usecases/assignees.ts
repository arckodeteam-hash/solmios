// sales-leads/usecases/assignees.ts — Quiénes pueden tener un prospecto asignado (SEC-3/FE-3).
//
// `sales_prospects.assignedTo` guarda `users.id` de un ADMIN de la plataforma (userType='admin'),
// no texto libre: el frontend elige de esta lista y el PUT rechaza cualquier id que no esté acá.
// Se devuelven SOLO `id`, `name`, `email` — nunca `password`, tokens ni PIN — y se pide con
// `select` para que esas columnas ni siquiera viajen desde la base. Un admin desactivado
// (`active = 0`) no recibe leads nuevos.
import type { RepositoryAdapter } from 'arckode-framework'
import { ValidationError } from 'arckode-framework'

export interface Assignee {
  id: string
  name: string
  email: string
}

export interface AssigneesResult {
  data: Assignee[]
}

const ADMIN_USER_TYPE = 'admin'
const SELECT = ['id', 'name', 'email', 'active']

type UserRow = { id: string; name?: string | null; email?: string | null; active?: number | boolean | null }

const isActive = (u: UserRow): boolean => u.active === undefined || u.active === null || Number(u.active) !== 0

export async function listAssignees(users: RepositoryAdapter<any>): Promise<AssigneesResult> {
  const rows = (await users.findMany(
    { userType: ADMIN_USER_TYPE },
    { select: SELECT, orderBy: { field: 'name', dir: 'ASC' } },
  )) as UserRow[]
  return {
    data: rows.filter(isActive).map((u) => ({ id: u.id, name: String(u.name ?? ''), email: String(u.email ?? '') })),
  }
}

/** `assignedTo` no vacío tiene que ser un admin activo; si no, 400 (nunca se guarda texto libre). */
export async function assertAssignable(users: RepositoryAdapter<any>, assignedTo: unknown): Promise<void> {
  if (assignedTo === undefined || assignedTo === null || assignedTo === '') return
  const rows = (await users.findMany({ id: String(assignedTo), userType: ADMIN_USER_TYPE }, { select: SELECT, limit: 1 })) as UserRow[]
  const user = rows[0]
  if (!user || !isActive(user)) {
    throw new ValidationError('assignedTo: debe ser el id de un usuario administrador activo de la plataforma')
  }
}
