// imprimir.test.ts — #216: abrir un papel de 80 mm en una pestaña nueva.
//   - La pestaña se abre ANTES de pedir el HTML (gesto del usuario → sin bloqueador de emergentes) y se
//     rellena cuando llega; el HTML viaja al servicio con el doc y la estación pedidos.
//   - Si el servidor falla, la pestaña se cierra y vuelve el mensaje (nada queda en blanco).
//   - Si el navegador bloqueó la ventana, se avisa sin llamar al servidor.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const printHtml = vi.fn()
vi.mock('@/services/Restaurant.service', () => ({ RestaurantService: { printHtml } }))

type FakeTab = { document: { open: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }; close: ReturnType<typeof vi.fn> }
function fakeTab(): FakeTab {
  return { document: { open: vi.fn(), write: vi.fn(), close: vi.fn() }, close: vi.fn() }
}
const HTML = '<!DOCTYPE html><html><body>PRECUENTA</body></html>'

describe('openPrintTab', () => {
  beforeEach(() => { printHtml.mockReset() })

  it('abre la pestaña de forma síncrona (antes del await), pide el HTML con doc/estación y lo escribe', async () => {
    const tab = fakeTab()
    let resolveHtml!: (v: string) => void
    printHtml.mockImplementation(() => new Promise<string>((r) => { resolveHtml = r }))
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
    const { openPrintTab } = await import('./imprimir')

    const pending = openPrintTab('o1', 'kitchen', { station: 's-bar' })
    expect(open).toHaveBeenCalledWith('', '_blank')                 // ya abierta, con la promesa sin resolver
    expect(tab.document.write.mock.calls[0][0]).toContain('Preparando la comanda de cocina')
    expect(printHtml).toHaveBeenCalledWith('o1', 'kitchen', 's-bar', undefined)

    resolveHtml(HTML)
    expect(await pending).toEqual({ ok: true })
    expect(tab.document.write).toHaveBeenLastCalledWith(HTML)
    expect(tab.close).not.toHaveBeenCalled()
    open.mockRestore()
  })

  // #282 (L): el placeholder decía "Preparando la ticket…".
  it('el placeholder del ticket concuerda: "Preparando el ticket…"', async () => {
    const tab = fakeTab()
    printHtml.mockResolvedValue(HTML)
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
    const { openPrintTab } = await import('./imprimir')
    await openPrintTab('o1', 'ticket')
    expect(tab.document.write.mock.calls[0][0]).toContain('Preparando el ticket…')
    expect(tab.document.write.mock.calls[0][0]).not.toContain('la ticket')
    open.mockRestore()
  })

  it('el servidor falla → cierra la pestaña y devuelve el mensaje', async () => {
    const tab = fakeTab()
    printHtml.mockRejectedValue(new Error('El ticket se imprime después de cobrar'))
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
    const { openPrintTab } = await import('./imprimir')
    expect(await openPrintTab('o1', 'ticket')).toEqual({ ok: false, error: 'El ticket se imprime después de cobrar' })
    expect(tab.close).toHaveBeenCalledTimes(1)
    open.mockRestore()
  })

  it('respuesta que no es el documento → se trata como error (no se escribe basura en la pestaña)', async () => {
    const tab = fakeTab()
    printHtml.mockResolvedValue({ success: true } as unknown as string)
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
    const { openPrintTab } = await import('./imprimir')
    const r = await openPrintTab('o1', 'precuenta')
    expect(r.ok).toBe(false)
    expect(tab.close).toHaveBeenCalledTimes(1)
    open.mockRestore()
  })

  // #216 autoPrint: la pestaña se prepara dentro del gesto (antes de `sendOrder`) y se rellena después.
  it('preparePrintTab/fillPrintTab: la pestaña se abre sola con el placeholder y se rellena más tarde con estación y batch', async () => {
    const tab = fakeTab()
    printHtml.mockResolvedValue(HTML)
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
    const { preparePrintTab, fillPrintTab } = await import('./imprimir')
    const prepared = preparePrintTab('kitchen')
    expect(prepared?.doc).toBe('kitchen')
    expect(tab.document.write.mock.calls[0][0]).toContain('Preparando la comanda de cocina')
    expect(printHtml).not.toHaveBeenCalled()
    expect(await fillPrintTab(prepared!, 'o1', { station: 's-cocina', batch: 'last' })).toEqual({ ok: true })
    expect(printHtml).toHaveBeenCalledWith('o1', 'kitchen', 's-cocina', 'last')
    expect(tab.document.write).toHaveBeenLastCalledWith(HTML)
    open.mockRestore()
  })

  it('preparePrintTab: ventana bloqueada → null (el que llama decide avisar sin frenar el envío)', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const { preparePrintTab } = await import('./imprimir')
    expect(preparePrintTab('kitchen')).toBeNull()
    open.mockRestore()
  })

  it('ventana bloqueada → aviso y NO se pide nada al servidor', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const { openPrintTab } = await import('./imprimir')
    const r = await openPrintTab('o1', 'precuenta')
    expect(r).toEqual({ ok: false, error: 'Permití las ventanas emergentes para imprimir' })
    expect(printHtml).not.toHaveBeenCalled()
    open.mockRestore()
  })
})
