// facturas/usecases/invoice-number.ts
// Genera el siguiente número secuencial de factura: "{prefix}-{year}-{NNNN}".
//
// ⚠️ Esta función NO es atómica por sí sola, y no puede serlo con la API del RepositoryAdapter
// (no hay UPDATE condicional ni RETURNING, y un read-modify-write dentro de una transacción
// READ COMMITTED de Postgres sigue permitiendo que dos sesiones lean el mismo valor).
//
// La garantía DURA vive en el UNIQUE INDEX `idx_invoices_hotel_number` (hotelId, invoiceNumber),
// creado en migrate-db.ts: el `repo.create` del perdedor de la carrera falla y `createInvoice`
// reintenta con el número siguiente. Este contador es la marca de agua que evita recorrer la
// secuencia desde cero en cada alta, no el árbitro de la concurrencia.
//
// Antes había un fallback `${prefix}-${year}-${Date.now()}` que se disparaba ante CUALQUIER
// excepción: rompía el formato de 4 dígitos y dejaba un agujero en la secuencia sin avisar.
// Se eliminó — una factura sin número correlativo válido es peor que una factura no emitida.

import type { RepositoryAdapter } from 'arckode-framework'

/** Nombre de la clave del contador en `configuration`. Un contador por hotel y por año. */
export function invoiceCounterKey(hotelId: string, year: number): string {
  return `invoice_counter_${hotelId}_${year}`
}

/** Formato correlativo del número. `seq` se emite con 4 dígitos como mínimo. */
export function formatInvoiceNumber(prefix: string, year: number, seq: number): string {
  return `${prefix}-${year}-${seq.toString().padStart(4, '0')}`
}

/**
 * Reserva el próximo número de factura del hotel y devuelve el número junto con la secuencia usada.
 *
 * Adelanta el contador antes de devolver, de modo que dos altas concurrentes que lean el mismo
 * valor produzcan a lo sumo una colisión, que el UNIQUE INDEX rechaza y el llamador reintenta
 * pasando `minSeq` para saltear el número ya tomado.
 *
 * @param minSeq Piso para el reintento: fuerza una secuencia estrictamente mayor a la que colisionó.
 * @throws Si `configuration` no se puede leer o escribir. No hay número de respaldo.
 */
export async function nextInvoiceNumber(
  configRepo: RepositoryAdapter<any>,
  hotelId: string,
  prefix: string,
  minSeq = 0,
): Promise<{ invoiceNumber: string; seq: number }> {
  const year = new Date().getFullYear()
  const counterKey = invoiceCounterKey(hotelId, year)

  const counter = await configRepo.findOne({ key: counterKey, hotelId })
  const currentSeq = Number(counter?.value) || 0
  const nextSeq = Math.max(currentSeq, minSeq) + 1

  if (counter) {
    await configRepo.update(counter.id, { value: nextSeq } as any)
  } else {
    const now = new Date().toISOString()
    await configRepo.create({
      key: counterKey,
      hotelId,
      value: nextSeq,
      description: `Invoice counter for ${prefix} ${year}`,
      createdAt: now,
      updatedAt: now,
    } as any)
  }

  return { invoiceNumber: formatInvoiceNumber(prefix, year, nextSeq), seq: nextSeq }
}
