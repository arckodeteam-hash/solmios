// shared/utils/compose-sockets.ts — Registrar handlers de socket sin pisar a los anteriores.
//
// Varios connectors pueden registrar el MISMO evento del mismo módulo. Con una asignación directa
// gana el último y el primero desaparece en silencio; acá se encadenan y corren todos, en el orden
// en que se registraron. El patrón estaba duplicado en `subscriptions/service.ts` y
// `reservas/service.ts` con el mismo comentario copiado.
export function composeSockets<T extends Record<string, any>>(current: T, incoming: Partial<T>): void {
  const next = incoming as Record<string, any>
  const cur = current as Record<string, any>
  for (const key of Object.keys(next)) {
    const handler = next[key]
    if (!handler) continue
    const prev = cur[key]
    cur[key] = prev ? async (...args: any[]) => { await prev(...args); await handler(...args) } : handler
  }
}
