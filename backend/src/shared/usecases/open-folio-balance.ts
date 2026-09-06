// shared/usecases/open-folio-balance.ts — Cuánto debe la cuenta abierta de una reserva.
//
// Lo consulta el checkout ANTES de tocar nada, para no cerrar una estadía con deuda sin que alguien
// lo haya confirmado. Vive en `shared` porque lo usa reservas leyendo folios, y un módulo no importa
// de otro (CLAUDE #3): el connector `reservas-folios-settlement` inyecta el lector.

/** Lo mínimo que se necesita del módulo folios. */
export interface FolioReaderPort {
  list: (query: any, user: any) => Promise<any>
  getById: (id: string, user: any) => Promise<any>
}

export interface OpenFolioBalance { folioId: string; balance: number }

/**
 * Folio ABIERTO de esa reserva con su saldo, o `null` si no tiene ninguno (la estadía nunca abrió
 * cuenta, o ya se cerró). Un error de lectura también devuelve `null`: la guarda de deuda no puede
 * ser la que impida cerrar un checkout por un problema de consulta.
 */
export async function openFolioBalance(
  folios: FolioReaderPort | undefined, reservationId: string, user: any,
): Promise<OpenFolioBalance | null> {
  if (!folios) return null
  try {
    const res = await folios.list({ status: 'open' }, user)
    const rows: any[] = Array.isArray(res) ? res : (res?.data ?? [])
    const match = rows.find((f) => f?.reservationId === reservationId)
    if (!match?.id) return null
    // `list` no trae los totales: el balance sale del detalle, que suma cargos y pagos.
    const detail = await folios.getById(String(match.id), user)
    return { folioId: String(match.id), balance: Number(detail?.balance) || 0 }
  } catch {
    return null
  }
}
