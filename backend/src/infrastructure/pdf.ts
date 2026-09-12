// infrastructure/pdf.ts — Generación de PDF desde HTML vía Puppeteer (Chromium headless).
//
// Vive en infraestructura (no en un módulo) porque es un adaptador a un proceso externo (el
// navegador headless) que consumen varios módulos: facturas (A4 de la factura) y bookingengine
// (recibo de pago del huésped, #270) — antes bookingengine lo importaba de facturas/usecases,
// un import módulo→módulo. El worker de la cola de correo también lo usa para el recibo adjunto.
//
// Hardening producción: timeouts en cada paso (un chromium colgado no cuelga el request) +
// rate limit por IP (puppeteer es caro → prevenir abuso/DoS).
import puppeteer from 'puppeteer'

const PDF_LAUNCH_TIMEOUT_MS = 15_000
const PDF_CONTENT_TIMEOUT_MS = 10_000

// Rate limit por IP: 10 PDFs/minuto. puppeteer lanza un chromium por request → sin esto,
// un cliente puede tirar el server lanzando decenas de browsers en paralelo.
const PDF_RATE_LIMIT = 10
const PDF_RATE_WINDOW_MS = 60_000
const pdfHits = new Map<string, { count: number; resetAt: number }>()

/** ¿Esta IP puede generar otro PDF? false → responder 429. */
export function checkPdfRateLimit(ip: string): boolean {
  const now = Date.now()
  const e = pdfHits.get(ip)
  if (!e || now > e.resetAt) { pdfHits.set(ip, { count: 1, resetAt: now + PDF_RATE_WINDOW_MS }); return true }
  if (e.count >= PDF_RATE_LIMIT) return false
  e.count++
  return true
}

/** Convierte HTML a PDF A4 usando Chromium headless. Timeouts en launch + setContent. */
export async function htmlToPdf(html: string): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
    timeout: PDF_LAUNCH_TIMEOUT_MS,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'load', timeout: PDF_CONTENT_TIMEOUT_MS })
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '15mm', bottom: '15mm', left: '20mm', right: '20mm' },
    })
    return Buffer.from(pdf)
  } finally {
    await browser.close()
  }
}
