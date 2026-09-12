// useInvoiceActions.ts — Acciones sobre una factura ya emitida (Imprimir por iframe, PDF, Email).
// Lógica compartida entre /panel/billing y la tarjeta "Facturas" del modal de reserva (#254),
// extraída de billing/index.vue sin cambiar comportamiento ni mensajes.
// Uso: const { printFrame, printInvoice, downloadPdf, openEmailModal, ... } = useInvoiceActions()
// En el template: <iframe ref="printFrame" class="hidden" ...></iframe>

import { ref } from 'vue'
import { BillingService } from '@/services/Billing.service'
import { useToast } from '@/composables/useToast'

export interface InvoiceRef { id: string; number: string }

// Un `prompt()` no valida nada y no distingue "cancelé" de "escribí cualquier cosa": el email salía
// al backend sin chequear formato. El modal valida antes de gastar el request.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function useInvoiceActions() {
  const toast = useToast()

  const printFrame = ref<HTMLIFrameElement | null>(null)

  async function printInvoice(inv: InvoiceRef) {
    try {
      const html = await BillingService.print(inv.id)
      if (typeof html === 'string' && html.includes('<!DOCTYPE html>') && printFrame.value) {
        const doc = printFrame.value.contentDocument
        if (doc) {
          doc.open()
          doc.write(html)
          doc.close()
          setTimeout(() => printFrame.value?.contentWindow?.print(), 300)
        }
      }
    } catch { toast.error('Error al generar impresión') }
  }

  // Envío de factura por email
  const showEmailModal = ref(false)
  const emailTarget = ref<InvoiceRef | null>(null)
  const emailTo = ref('')
  const emailError = ref('')
  const sendingEmail = ref(false)

  function openEmailModal(inv: InvoiceRef) {
    emailTarget.value = inv
    emailTo.value = ''
    emailError.value = ''
    showEmailModal.value = true
  }

  function closeEmailModal() {
    showEmailModal.value = false
    emailTarget.value = null
    emailTo.value = ''
    emailError.value = ''
  }

  async function confirmEmail() {
    if (!emailTarget.value || sendingEmail.value) return
    const to = emailTo.value.trim()
    if (!to) { emailError.value = 'Ingresá un email'; return }
    if (!EMAIL_RE.test(to)) { emailError.value = 'El email no tiene un formato válido'; return }

    sendingEmail.value = true
    emailError.value = ''
    try {
      const res = await BillingService.emailInvoice(emailTarget.value.id, to)
      if (!res.configured) {
        toast.warning('El hotel no tiene email configurado (SMTP/Resend). Configurarlo en Settings.')
        closeEmailModal()
        return
      }
      toast.success(`Factura enviada a ${to}`)
      closeEmailModal()
    } catch {
      emailError.value = 'No se pudo enviar la factura. Intentá de nuevo.'
    } finally {
      sendingEmail.value = false
    }
  }

  async function downloadPdf(inv: InvoiceRef) {
    try {
      const blob = await BillingService.downloadPdf(inv.id)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${inv.number}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch { toast.error('Error al generar el PDF') }
  }

  return {
    printFrame, printInvoice, downloadPdf,
    showEmailModal, emailTarget, emailTo, emailError, sendingEmail,
    openEmailModal, closeEmailModal, confirmEmail,
  }
}
