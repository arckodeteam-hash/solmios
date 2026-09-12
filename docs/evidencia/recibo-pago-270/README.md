# MR-05 (#270) — Recibo de pago por email + PDF · evidencia manual (2026-09-12)

Corrida real contra el buzón propio de AUTOWORK (`autowork+270-…@bot.zx89.site`), con el
pipeline de producción: `sendBookingPaidEmail` → `EmailService` (SMTP autenticado) → IMAP.

1. `01-correo-confirmacion-desglose.png` — el correo recibido: estancia (2 adultos · 1 niño (6),
   cuna Sí, llegada 18:00, pedido especial), desglose (subtotal, extras "Desayuno buffet × 2",
   amenidad "Kit bebé", promo VERANO10 −10.00, ITBIS 18% y Propina legal 10%, total 416.00 USD),
   botones "Ver mi reserva" y "Descargar recibo (PDF)", pie "Enviado por {platform_name}".
   Adjunto: `recibo-270aaaaa.pdf` (65 KB, `%PDF-`). Sin placeholders sin resolver.
2. `02-recibo-pdf-render.png` — el HTML del recibo tal como se convierte a PDF (A4): "Recibo de
   pago · no es factura fiscal", hotel con RNC/NIF, huésped, localizador, líneas, impuestos,
   total, método y referencia de Stripe.
3. `03-confirmacion-boton-descargar-recibo-375px.png` — `/h/hotel-270/confirm?booking=…&token=…`
   en Chromium a 375px: botón "Descargar recibo (PDF)"; su href responde `200 application/pdf`.
   Sin token o con token inválido el endpoint responde el mismo 404 que `GET /api/public/reservations/:id`.
