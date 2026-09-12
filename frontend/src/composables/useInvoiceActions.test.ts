// useInvoiceActions.test.ts — #254: Imprimir / PDF / Email extraídos de billing/index.vue a un composable
// compartido con el modal de reserva. Mismos mensajes y flujo que tenía la página.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { print, downloadPdf, emailInvoice, toastSuccess, toastError, toastWarning } = vi.hoisted(() => ({
  print: vi.fn(), downloadPdf: vi.fn(), emailInvoice: vi.fn(),
  toastSuccess: vi.fn(), toastError: vi.fn(), toastWarning: vi.fn(),
}))
vi.mock('@/services/Billing.service', () => ({ BillingService: { print, downloadPdf, emailInvoice } }))
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, info: vi.fn(), warning: toastWarning }),
}))

import { useInvoiceActions } from './useInvoiceActions'

const inv = { id: 'inv-1', number: 'F-0001' }
const HTML = '<!DOCTYPE html><html><body><h1>Factura F-0001</h1></body></html>'

describe('useInvoiceActions', () => {
  beforeEach(() => { vi.clearAllMocks() })
  afterEach(() => { vi.useRealTimers(); document.body.innerHTML = '' })

  function mountFrame() {
    const frame = document.createElement('iframe')
    document.body.appendChild(frame)
    return frame
  }

  it('printInvoice: escribe el html en el iframe y llama a print() a los 300ms', async () => {
    vi.useFakeTimers()
    print.mockResolvedValue(HTML)
    const frame = mountFrame()
    const printSpy = vi.fn()
    ;(frame.contentWindow as any).print = printSpy
    const doc = frame.contentDocument!
    const open = vi.spyOn(doc, 'open'), write = vi.spyOn(doc, 'write'), close = vi.spyOn(doc, 'close')

    const a = useInvoiceActions()
    a.printFrame.value = frame
    await a.printInvoice(inv)

    expect(print).toHaveBeenCalledWith('inv-1')
    expect(open).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith(HTML)
    expect(close).toHaveBeenCalledTimes(1)
    expect(printSpy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)
    expect(printSpy).toHaveBeenCalledTimes(1)
    expect(toastError).not.toHaveBeenCalled()
  })

  it('printInvoice: si el backend falla, toast.error("Error al generar impresión")', async () => {
    print.mockRejectedValue(new Error('500'))
    const a = useInvoiceActions()
    a.printFrame.value = mountFrame()
    await a.printInvoice(inv)
    expect(toastError).toHaveBeenCalledWith('Error al generar impresión')
  })

  it('printInvoice: html sin <!DOCTYPE html> no se escribe en el iframe ni se imprime', async () => {
    vi.useFakeTimers()
    print.mockResolvedValue('<html><body>x</body></html>')
    const frame = mountFrame()
    const printSpy = vi.fn()
    ;(frame.contentWindow as any).print = printSpy
    const doc = frame.contentDocument!
    const open = vi.spyOn(doc, 'open'), write = vi.spyOn(doc, 'write'), close = vi.spyOn(doc, 'close')

    const a = useInvoiceActions()
    a.printFrame.value = frame
    await a.printInvoice(inv)

    expect(print).toHaveBeenCalledWith('inv-1')
    expect(open).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
    expect(doc.body.innerHTML).toBe('')
    vi.advanceTimersByTime(300)
    expect(printSpy).not.toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalled()
  })

  it('printInvoice: sin printFrame asignado no explota ni imprime', async () => {
    vi.useFakeTimers()
    print.mockResolvedValue(HTML)
    const frame = mountFrame()
    const printSpy = vi.fn()
    ;(frame.contentWindow as any).print = printSpy
    const write = vi.spyOn(frame.contentDocument!, 'write')

    const a = useInvoiceActions()
    expect(a.printFrame.value).toBeNull()
    await expect(a.printInvoice(inv)).resolves.toBeUndefined()

    expect(print).toHaveBeenCalledWith('inv-1')
    expect(write).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)
    expect(printSpy).not.toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalled()
  })

  it('confirmEmail: email inválido setea emailError y NO llama al backend', async () => {
    const a = useInvoiceActions()
    a.openEmailModal(inv)
    expect(a.showEmailModal.value).toBe(true)
    expect(a.emailTarget.value).toEqual(inv)

    a.emailTo.value = ''
    await a.confirmEmail()
    expect(a.emailError.value).toBe('Ingresá un email')

    a.emailTo.value = 'no-es-un-email'
    await a.confirmEmail()
    expect(a.emailError.value).toBe('El email no tiene un formato válido')
    expect(emailInvoice).not.toHaveBeenCalled()
    expect(a.showEmailModal.value).toBe(true)
  })

  it('confirmEmail OK: llama emailInvoice(id, to), toast.success y cierra el modal', async () => {
    emailInvoice.mockResolvedValue({ sent: true, messageId: 'm1', configured: true })
    const a = useInvoiceActions()
    a.openEmailModal(inv)
    a.emailTo.value = '  cliente@hotel.com '
    await a.confirmEmail()
    expect(emailInvoice).toHaveBeenCalledWith('inv-1', 'cliente@hotel.com')
    expect(toastSuccess).toHaveBeenCalledWith('Factura enviada a cliente@hotel.com')
    expect(a.showEmailModal.value).toBe(false)
    expect(a.emailTarget.value).toBeNull()
    expect(a.emailTo.value).toBe('')
    expect(a.sendingEmail.value).toBe(false)
  })

  it('confirmEmail con configured=false: toast.warning y cierra el modal', async () => {
    emailInvoice.mockResolvedValue({ sent: false, messageId: '', configured: false })
    const a = useInvoiceActions()
    a.openEmailModal(inv)
    a.emailTo.value = 'cliente@hotel.com'
    await a.confirmEmail()
    expect(toastWarning).toHaveBeenCalledWith('El hotel no tiene email configurado (SMTP/Resend). Configurarlo en Settings.')
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(a.showEmailModal.value).toBe(false)
  })

  it('confirmEmail: si el envío falla, deja el mensaje en emailError y el modal abierto', async () => {
    emailInvoice.mockRejectedValue(new Error('500'))
    const a = useInvoiceActions()
    a.openEmailModal(inv)
    a.emailTo.value = 'cliente@hotel.com'
    await a.confirmEmail()
    expect(a.emailError.value).toBe('No se pudo enviar la factura. Intentá de nuevo.')
    expect(a.showEmailModal.value).toBe(true)
    expect(a.sendingEmail.value).toBe(false)
  })

  it('confirmEmail: dos llamadas seguidas con el envío en curso disparan un solo request', async () => {
    let resolve!: (v: { sent: boolean; messageId: string; configured: boolean }) => void
    emailInvoice.mockReturnValue(new Promise((r) => { resolve = r }))
    const a = useInvoiceActions()
    a.openEmailModal(inv)
    a.emailTo.value = 'cliente@hotel.com'

    const first = a.confirmEmail()
    const second = a.confirmEmail()
    expect(a.sendingEmail.value).toBe(true)
    expect(emailInvoice).toHaveBeenCalledTimes(1)

    resolve({ sent: true, messageId: 'm1', configured: true })
    await Promise.all([first, second])

    expect(emailInvoice).toHaveBeenCalledTimes(1)
    expect(toastSuccess).toHaveBeenCalledTimes(1)
    expect(a.sendingEmail.value).toBe(false)
    expect(a.showEmailModal.value).toBe(false)
  })

  it('downloadPdf: crea la blob url, dispara el click con <número>.pdf y la revoca', async () => {
    const blob = new Blob(['%PDF'], { type: 'application/pdf' })
    downloadPdf.mockResolvedValue(blob)
    const createObjectURL = vi.fn(() => 'blob:fake-url')
    const revokeObjectURL = vi.fn()
    ;(URL as any).createObjectURL = createObjectURL
    ;(URL as any).revokeObjectURL = revokeObjectURL
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const created: HTMLAnchorElement[] = []
    const origCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag)
      if (tag === 'a') created.push(el as HTMLAnchorElement)
      return el
    })

    const a = useInvoiceActions()
    await a.downloadPdf(inv)

    expect(downloadPdf).toHaveBeenCalledWith('inv-1')
    expect(createObjectURL).toHaveBeenCalledWith(blob)
    expect(created).toHaveLength(1)
    expect(created[0].download).toBe('F-0001.pdf')
    expect(created[0].href).toBe('blob:fake-url')
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url')
    expect(toastError).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('downloadPdf: si el backend falla, toast.error("Error al generar el PDF")', async () => {
    downloadPdf.mockRejectedValue(new Error('500'))
    const a = useInvoiceActions()
    await a.downloadPdf(inv)
    expect(toastError).toHaveBeenCalledWith('Error al generar el PDF')
  })
})
