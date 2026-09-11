// pages/restaurante/imprimir.ts — #216: abrir un papel de 80 mm (precuenta / ticket / comanda de cocina)
// en una pestaña nueva. Lo comparten Comanda, Cobrar y el KDS.
//
// Por qué no es un `<a target="_blank">` a la ruta: el endpoint exige el JWT (Bearer), y una pestaña
// nueva no lo manda. Se pide el HTML con `RestaurantService.printHtml` (mismo esquema que el recibo de
// nómina, PayrollDetailModal.vue) y se escribe en la pestaña. La pestaña se abre ANTES del `await`:
// un `window.open` después de una promesa ya no cuenta como gesto del usuario y el bloqueador de
// ventanas emergentes lo frena. El HTML trae su propio `window.print()` al cargar.
//
// Impresión automática (#216, `restaurant_stations.autoPrint`): al enviar a cocina hay que abrir la(s)
// pestaña(s) ANTES del `await sendOrder` (mismo motivo) y rellenarlas después, con las líneas ya
// selladas. Por eso el helper está partido en `preparePrintTab` (síncrono, dentro del gesto) y
// `fillPrintTab` (async); `openPrintTab` es el atajo de los botones.
import { RestaurantService, type PrintDoc, type PrintBatch } from '@/services/Restaurant.service'

const DOC_LABELS: Record<PrintDoc, string> = { precuenta: 'precuenta', ticket: 'ticket', kitchen: 'comanda de cocina' }

export type PrintTabResult = { ok: true } | { ok: false; error: string }

/** Placeholder mientras llega el HTML: sin esto la pestaña queda en blanco y parece que no pasó nada. */
function placeholder(doc: PrintDoc): string {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Imprimiendo…</title></head><body style="font-family:sans-serif;padding:24px;color:#333">Preparando la ${DOC_LABELS[doc]}…</body></html>`
}

export interface PrintTab { doc: PrintDoc; win: Window }
export interface PrintOpts { station?: string; batch?: PrintBatch }

/** Abre la pestaña con el placeholder. Llamar dentro del gesto del usuario. `null` = la bloqueó el navegador. */
export function preparePrintTab(doc: PrintDoc): PrintTab | null {
  const win = window.open('', '_blank')
  if (!win) return null
  win.document.open()
  win.document.write(placeholder(doc))
  win.document.close()
  return { doc, win }
}

/** Pide el HTML y lo escribe en una pestaña ya abierta; si falla, la cierra y devuelve el motivo. */
export async function fillPrintTab(tab: PrintTab, orderId: string, opts: PrintOpts = {}): Promise<PrintTabResult> {
  try {
    const html = await RestaurantService.printHtml(orderId, tab.doc, opts.station, opts.batch)
    if (typeof html !== 'string' || !html.includes('<!DOCTYPE html>')) throw new Error('El servidor no devolvió el documento')
    tab.win.document.open()
    tab.win.document.write(html)
    tab.win.document.close()
    return { ok: true }
  } catch (e: unknown) {
    tab.win.close()
    return { ok: false, error: e instanceof Error ? e.message : `No se pudo generar la ${DOC_LABELS[tab.doc]}` }
  }
}

export const POPUP_BLOCKED = 'Permití las ventanas emergentes para imprimir'

export async function openPrintTab(orderId: string, doc: PrintDoc, opts: PrintOpts = {}): Promise<PrintTabResult> {
  const tab = preparePrintTab(doc)
  if (!tab) return { ok: false, error: POPUP_BLOCKED }
  return fillPrintTab(tab, orderId, opts)
}
