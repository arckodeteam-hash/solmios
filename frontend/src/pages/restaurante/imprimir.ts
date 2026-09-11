// pages/restaurante/imprimir.ts — #216: abrir un papel de 80 mm (precuenta / ticket / comanda de cocina)
// en una pestaña nueva. Lo comparten Comanda, Cobrar y el KDS.
//
// Por qué no es un `<a target="_blank">` a la ruta: el endpoint exige el JWT (Bearer), y una pestaña
// nueva no lo manda. Se pide el HTML con `RestaurantService.printHtml` (mismo esquema que el recibo de
// nómina, PayrollDetailModal.vue) y se escribe en la pestaña. La pestaña se abre ANTES del `await`:
// un `window.open` después de una promesa ya no cuenta como gesto del usuario y el bloqueador de
// ventanas emergentes lo frena. El HTML trae su propio `window.print()` al cargar.
import { RestaurantService, type PrintDoc } from '@/services/Restaurant.service'

const DOC_LABELS: Record<PrintDoc, string> = { precuenta: 'precuenta', ticket: 'ticket', kitchen: 'comanda de cocina' }

export type PrintTabResult = { ok: true } | { ok: false; error: string }

/** Placeholder mientras llega el HTML: sin esto la pestaña queda en blanco y parece que no pasó nada. */
function placeholder(doc: PrintDoc): string {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Imprimiendo…</title></head><body style="font-family:sans-serif;padding:24px;color:#333">Preparando la ${DOC_LABELS[doc]}…</body></html>`
}

export async function openPrintTab(orderId: string, doc: PrintDoc, opts: { station?: string } = {}): Promise<PrintTabResult> {
  const tab = window.open('', '_blank')
  if (!tab) return { ok: false, error: 'Permití las ventanas emergentes para imprimir' }
  tab.document.open()
  tab.document.write(placeholder(doc))
  tab.document.close()
  try {
    const html = await RestaurantService.printHtml(orderId, doc, opts.station)
    if (typeof html !== 'string' || !html.includes('<!DOCTYPE html>')) throw new Error('El servidor no devolvió el documento')
    tab.document.open()
    tab.document.write(html)
    tab.document.close()
    return { ok: true }
  } catch (e: unknown) {
    tab.close()
    return { ok: false, error: e instanceof Error ? e.message : `No se pudo generar la ${DOC_LABELS[doc]}` }
  }
}
