# Evidencia — Factura desde la reserva (REQ-FDR-03, #254)

Recorrido hecho el 2026-09-12 en un entorno local (backend `bun run src/composition-root.ts` sobre
SQLite recién migrada, frontend `bun run dev`, Chromium headless vía Playwright) con una reserva
pagada por transferencia (`POST /api/reservas/:id/mark-paid`, US$200) y sin folio.

| # | Captura | Qué muestra |
|---|---|---|
| 01 | `01-reserva-sin-factura.png` | Tarjeta "Facturas" vacía: "Esta reserva todavía no tiene factura." + botón Facturar |
| 02 | `02-confirmacion-emitir.png` | Confirmación "Se emitirá la factura por US$200,00 a nombre de Ana Pérez…" |
| 03 | `03-factura-emitida-fila-pagada.png` | `POST /api/reservas/:id/invoice` → 201 `{source:'reservation', linkedPayments:1, amountPaid:200}`; fila INV-2026-0001 **Pagada**, saldo US$0,00; toast "Factura emitida"; scroll a la tarjeta |
| 04 | `04-imprimir-iframe-cargado.png` | Click en Imprimir: el iframe oculto recibe el HTML (8.5 KB) y llama `print()` (interceptado: 1 llamada) |
| 05 | `05-factura-impresa.png` | El documento tal cual entra al diálogo de impresión |
| 06 | `06-email-modal.png` | Modal "Enviar factura #INV-2026-0001" con validación de email |
| 07 | `07-panel-billing-factura.png` | `/panel/billing` muestra la factura PAGADA y "Cobrado hoy $200" (pago vinculado) |
| 08 | `08-409-ya-tiene-factura.png` | Con el detalle sin `invoices` (otro operador facturó mientras el modal estaba abierto): Facturar → 409 → toast "Ya tiene factura" y la tarjeta muestra la existente |
| 09 | `09-billing-ver-factura.png` | `/panel/billing` sigue abriendo la factura |
| 10 | `10-billing-imprimir.png` | `/panel/billing` sigue imprimiendo por el mismo iframe (`useInvoiceActions`): `print()` 1 llamada |

Además: el botón PDF descargó `INV-2026-0001.pdf`; un segundo click en "Facturar" con factura ya
emitida hizo 0 POSTs (sólo scroll). El recorrido en producción queda para después del deploy.
