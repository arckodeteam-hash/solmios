// services/notification-defaults.ts — Plantillas base de notificaciones por evento × idioma.
//
// Fuente de verdad de los defaults de email (NO se seedean en DB). El override del hotel
// vive en auto_messages; este archivo es el fallback. Versionado con git, testeable sin DB.
// Las variables {key} se interpolan con renderTemplate() de email-service (6.1.2).
//
// Ciclo de vida de estas plantillas (#270):
//   · Los defaults viven en código y se actualizan con el deploy: no hay migración ni seed que
//     correr para que un cambio acá llegue a producción.
//   · El override por hotel (tabla `auto_messages`, resuelto por notification-renderer.ts) tiene
//     prioridad sobre este archivo y NO se pisa nunca desde acá.
//   · No existe seed ni `--refresh` para estos defaults (a diferencia de
//     `scripts/seed-platform-email-templates.ts --refresh`, que es de platform-emails). Un hotel
//     con plantilla personalizada de `reservation_confirmed` sigue viendo la suya: si quiere el
//     desglose nuevo ({rooms_lines}, {extras_lines}, {tax_lines}, {receipt_url}, …) tiene que
//     agregar esas variables a mano desde su panel.

export type NotificationEvent = 'reservation_confirmed' | 'reservation_presale' | 'reservation_cancelled_guest' | 'reservation_cancelled_staff' | 'checkin_welcome' | 'no_show' | 'checkout' | 'invoice' | 'reminder' | 'checkin_link' | 'payment_link' | 'review_request' | 'reservation_new_staff' | 'reservation_new_ota_staff' | 'reservation_received_unpaid' | 'reservation_approved' | 'reservation_rejected'
export type NotificationLanguage = 'es' | 'en' | 'pt'

export interface NotificationDefault {
  /** Asunto del email (con placeholders {key}). */
  subject: string
  /** Cuerpo HTML del email (con placeholders {key}). */
  body: string
}

// ─── reservation_confirmed ──────────────────────────────────────────────────
//
// Recibo completo de la reserva pagada (#270). Todas las variables las provee
// shared/usecases/booking-paid-email.ts (hay test de contrato en
// shared/usecases/tests/booking-paid-email.test.ts: NO inventar variables acá).
// Las `*_lines` llegan ya como HTML (<ul><li>…</li></ul>) o '' y se insertan sin escapar.
// Lo que puede no existir (niños, promo, botones "Ver mi reserva"/"Descargar recibo", la mención
// al recibo) llega como fragmento condicional de shared/usecases/confirmation-email-variables.ts
// (`{occupancy}`, `{promo_lines}`, `{actions_lines}`, `{receipt_intro}`): el renderer no tiene
// condicionales y una reserva del panel no tiene enlaces públicos ni recibo.
// El evento también lo dispara reservas/usecases/reservation-email.ts (reserva creada desde el
// panel), que no tiene desglose ni enlaces públicos: parte de la base neutra de
// shared/usecases/confirmation-email-variables.ts (test en reservas/tests/reservation-email-
// variables.test.ts), porque el renderer deja literal cualquier {var} que falte. Una variable
// nueva acá se agrega en los dos flujos.
// Tono: "usted" en es, formal en pt, neutro en en. Sin marca hardcodeada: {platform_name}.

const CONFIRMED_ES = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:24px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">Confirmación de reserva</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Estimado/a {guest_name},</p>
    <p>Su reserva ha sido confirmada. A continuación encontrará el detalle de su estancia{receipt_intro}.</p>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 6px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Estancia</p>
      <table style="width:100%;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;">Check-in</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkin_date} · {checkin_time}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-out</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkout_date} · {checkout_time}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Huéspedes</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{occupancy}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Cuna</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{crib}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Régimen</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{meal_plan}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Llegada estimada</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{estimated_arrival}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;vertical-align:top;">Pedido especial</td><td style="padding:6px 0;text-align:right;">{special_requests}</td></tr>
      </table>
    </div>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 6px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Habitaciones · {rooms_count} habitación(es)</p>
      <div style="font-size:14px;color:#4b5563;">{rooms_lines}</div>
    </div>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 6px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Desglose</p>
      <table style="width:100%;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;">Subtotal alojamiento</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{subtotal}</td></tr>
        <tr><td colspan="2" style="padding:6px 0 0;color:#6b7280;">Extras</td></tr>
        <tr><td colspan="2" style="padding:0 0 6px;color:#4b5563;">{extras_lines}</td></tr>
        <tr><td colspan="2" style="padding:6px 0 0;color:#6b7280;">Amenidades infantiles</td></tr>
        <tr><td colspan="2" style="padding:0 0 6px;color:#4b5563;">{child_amenities_lines}</td></tr>
        <tr><td colspan="2" style="padding:6px 0 0;color:#6b7280;">Amenidades de habitación</td></tr>
        <tr><td colspan="2" style="padding:0 0 6px;color:#4b5563;">{room_amenities_lines}</td></tr>
        {promo_lines}
        <tr><td colspan="2" style="padding:6px 0 0;color:#6b7280;">Impuestos</td></tr>
        <tr><td colspan="2" style="padding:0 0 6px;color:#4b5563;">{tax_lines}</td></tr>
        <tr><td style="padding:6px 0;border-top:2px solid #e5e7eb;color:#1a2b4c;font-weight:bold;">TOTAL</td><td style="padding:6px 0;border-top:2px solid #e5e7eb;font-weight:bold;text-align:right;font-size:18px;color:#1a2b4c;">{total_amount}</td></tr>
      </table>
    </div>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 6px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Gestión del pago</p>
      <table style="width:100%;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;">Forma de pago</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{payment_method}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Pagado</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{deposit_amount}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Pendiente</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{pending_amount}</td></tr>
      </table>
    </div>
    <p style="font-size:13px;color:#6b7280;">Localizador: <strong>{locator}</strong></p>
    {actions_lines}
    <div style="background:white;border-radius:8px;padding:14px;margin:16px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 6px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Política de cancelación</p>
      <p style="margin:0;font-size:13px;color:#4b5563;">{cancellation_policy}</p>
    </div>
    <div style="background:white;border-radius:8px;padding:14px;margin:16px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 6px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Cómo llegar</p>
      <p style="margin:0;font-size:13px;color:#4b5563;">{hotel_address}</p>
      <p style="margin:6px 0 0;font-size:13px;color:#4b5563;">Tel: <strong>{hotel_phone}</strong> · {hotel_email}</p>
    </div>
    <p style="font-size:13px;color:#6b7280;">Le enviaremos el número de habitación y el código de acceso el día anterior a su llegada.</p>
    <p style="font-size:13px;color:#6b7280;">Le esperamos.</p>
    <p style="font-size:11px;color:#9ca3af;text-align:center;margin:24px 0 0;">Enviado por {platform_name}</p>
  </div>
</body>
</html>`

const CONFIRMED_EN = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:24px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">Reservation confirmation</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Dear {guest_name},</p>
    <p>Your reservation is confirmed. Below you will find the details of your stay{receipt_intro}.</p>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 6px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Stay</p>
      <table style="width:100%;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;">Check-in</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkin_date} · {checkin_time}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-out</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkout_date} · {checkout_time}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Guests</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{occupancy}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Crib</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{crib}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Meal plan</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{meal_plan}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Estimated arrival</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{estimated_arrival}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;vertical-align:top;">Special requests</td><td style="padding:6px 0;text-align:right;">{special_requests}</td></tr>
      </table>
    </div>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 6px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Rooms · {rooms_count} room(s)</p>
      <div style="font-size:14px;color:#4b5563;">{rooms_lines}</div>
    </div>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 6px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Breakdown</p>
      <table style="width:100%;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;">Accommodation subtotal</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{subtotal}</td></tr>
        <tr><td colspan="2" style="padding:6px 0 0;color:#6b7280;">Extras</td></tr>
        <tr><td colspan="2" style="padding:0 0 6px;color:#4b5563;">{extras_lines}</td></tr>
        <tr><td colspan="2" style="padding:6px 0 0;color:#6b7280;">Children amenities</td></tr>
        <tr><td colspan="2" style="padding:0 0 6px;color:#4b5563;">{child_amenities_lines}</td></tr>
        <tr><td colspan="2" style="padding:6px 0 0;color:#6b7280;">Room amenities</td></tr>
        <tr><td colspan="2" style="padding:0 0 6px;color:#4b5563;">{room_amenities_lines}</td></tr>
        {promo_lines}
        <tr><td colspan="2" style="padding:6px 0 0;color:#6b7280;">Taxes</td></tr>
        <tr><td colspan="2" style="padding:0 0 6px;color:#4b5563;">{tax_lines}</td></tr>
        <tr><td style="padding:6px 0;border-top:2px solid #e5e7eb;color:#1a2b4c;font-weight:bold;">TOTAL</td><td style="padding:6px 0;border-top:2px solid #e5e7eb;font-weight:bold;text-align:right;font-size:18px;color:#1a2b4c;">{total_amount}</td></tr>
      </table>
    </div>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 6px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Payment</p>
      <table style="width:100%;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;">Payment method</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{payment_method}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Paid</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{deposit_amount}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Pending</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{pending_amount}</td></tr>
      </table>
    </div>
    <p style="font-size:13px;color:#6b7280;">Booking ref: <strong>{locator}</strong></p>
    {actions_lines}
    <div style="background:white;border-radius:8px;padding:14px;margin:16px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 6px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Cancellation policy</p>
      <p style="margin:0;font-size:13px;color:#4b5563;">{cancellation_policy}</p>
    </div>
    <div style="background:white;border-radius:8px;padding:14px;margin:16px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 6px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Getting there</p>
      <p style="margin:0;font-size:13px;color:#4b5563;">{hotel_address}</p>
      <p style="margin:6px 0 0;font-size:13px;color:#4b5563;">Phone: <strong>{hotel_phone}</strong> · {hotel_email}</p>
    </div>
    <p style="font-size:13px;color:#6b7280;">We will send your room number and access code the day before your arrival.</p>
    <p style="font-size:13px;color:#6b7280;">We look forward to welcoming you.</p>
    <p style="font-size:11px;color:#9ca3af;text-align:center;margin:24px 0 0;">Sent by {platform_name}</p>
  </div>
</body>
</html>`

const CONFIRMED_PT = `<!DOCTYPE html>
<html lang="pt">
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:24px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">Confirmação de reserva</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Prezado(a) {guest_name},</p>
    <p>A sua reserva está confirmada. A seguir encontrará os detalhes da sua estadia{receipt_intro}.</p>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 6px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Estadia</p>
      <table style="width:100%;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;">Check-in</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkin_date} · {checkin_time}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-out</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkout_date} · {checkout_time}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Hóspedes</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{occupancy}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Berço</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{crib}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Regime</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{meal_plan}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Chegada estimada</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{estimated_arrival}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;vertical-align:top;">Pedido especial</td><td style="padding:6px 0;text-align:right;">{special_requests}</td></tr>
      </table>
    </div>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 6px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Quartos · {rooms_count} quarto(s)</p>
      <div style="font-size:14px;color:#4b5563;">{rooms_lines}</div>
    </div>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 6px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Detalhe</p>
      <table style="width:100%;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;">Subtotal da hospedagem</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{subtotal}</td></tr>
        <tr><td colspan="2" style="padding:6px 0 0;color:#6b7280;">Extras</td></tr>
        <tr><td colspan="2" style="padding:0 0 6px;color:#4b5563;">{extras_lines}</td></tr>
        <tr><td colspan="2" style="padding:6px 0 0;color:#6b7280;">Comodidades infantis</td></tr>
        <tr><td colspan="2" style="padding:0 0 6px;color:#4b5563;">{child_amenities_lines}</td></tr>
        <tr><td colspan="2" style="padding:6px 0 0;color:#6b7280;">Comodidades do quarto</td></tr>
        <tr><td colspan="2" style="padding:0 0 6px;color:#4b5563;">{room_amenities_lines}</td></tr>
        {promo_lines}
        <tr><td colspan="2" style="padding:6px 0 0;color:#6b7280;">Impostos</td></tr>
        <tr><td colspan="2" style="padding:0 0 6px;color:#4b5563;">{tax_lines}</td></tr>
        <tr><td style="padding:6px 0;border-top:2px solid #e5e7eb;color:#1a2b4c;font-weight:bold;">TOTAL</td><td style="padding:6px 0;border-top:2px solid #e5e7eb;font-weight:bold;text-align:right;font-size:18px;color:#1a2b4c;">{total_amount}</td></tr>
      </table>
    </div>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 6px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Gestão do pagamento</p>
      <table style="width:100%;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;">Forma de pagamento</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{payment_method}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Pago</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{deposit_amount}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Pendente</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{pending_amount}</td></tr>
      </table>
    </div>
    <p style="font-size:13px;color:#6b7280;">Localizador: <strong>{locator}</strong></p>
    {actions_lines}
    <div style="background:white;border-radius:8px;padding:14px;margin:16px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 6px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Política de cancelamento</p>
      <p style="margin:0;font-size:13px;color:#4b5563;">{cancellation_policy}</p>
    </div>
    <div style="background:white;border-radius:8px;padding:14px;margin:16px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 6px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Como chegar</p>
      <p style="margin:0;font-size:13px;color:#4b5563;">{hotel_address}</p>
      <p style="margin:6px 0 0;font-size:13px;color:#4b5563;">Tel: <strong>{hotel_phone}</strong> · {hotel_email}</p>
    </div>
    <p style="font-size:13px;color:#6b7280;">Enviaremos o número do quarto e o código de acesso no dia anterior à sua chegada.</p>
    <p style="font-size:13px;color:#6b7280;">Aguardamos a sua chegada.</p>
    <p style="font-size:11px;color:#9ca3af;text-align:center;margin:24px 0 0;">Enviado por {platform_name}</p>
  </div>
</body>
</html>`

// ─── reservation_presale ────────────────────────────────────────────────────

const PRESALE_ES = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:24px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">Reserva — Pago Pendiente</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Hola <strong>{guest_name}</strong>,</p>
    <p>Tenemos una reserva preparada para vos. Para confirmarla, necesitamos el pago del anticipo.</p>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <table style="width:100%;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;">Habitación</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{room_number}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-in</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkin_date}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-out</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkout_date}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Anticipo requerido</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{total_amount}</td></tr>
      </table>
    </div>
    <p style="font-size:13px;color:#6b7280;">Localizador: <strong>{locator}</strong></p>
    <p style="font-size:13px;color:#6b7280;">Si tenés alguna consulta, llamá al <strong>{hotel_phone}</strong>.</p>
  </div>
</body>
</html>`

const PRESALE_EN = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:24px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">Booking — Payment Pending</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Hi <strong>{guest_name}</strong>,</p>
    <p>We have a booking ready for you. To confirm it, we need the deposit payment.</p>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <table style="width:100%;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;">Room</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{room_number}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-in</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkin_date}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-out</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkout_date}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Deposit required</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{total_amount}</td></tr>
      </table>
    </div>
    <p style="font-size:13px;color:#6b7280;">Booking ref: <strong>{locator}</strong></p>
    <p style="font-size:13px;color:#6b7280;">For any questions, call <strong>{hotel_phone}</strong>.</p>
  </div>
</body>
</html>`

const PRESALE_PT = `<!DOCTYPE html>
<html lang="pt">
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:24px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">Reserva — Pagamento Pendente</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Olá <strong>{guest_name}</strong>,</p>
    <p>Temos uma reserva pronta para si. Para a confirmar, precisamos do pagamento do sinal.</p>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <table style="width:100%;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;">Quarto</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{room_number}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-in</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkin_date}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-out</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkout_date}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Sinal exigido</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{total_amount}</td></tr>
      </table>
    </div>
    <p style="font-size:13px;color:#6b7280;">Localizador: <strong>{locator}</strong></p>
    <p style="font-size:13px;color:#6b7280;">Para qualquer dúvida, ligue para <strong>{hotel_phone}</strong>.</p>
  </div>
</body>
</html>`

// ─── reservation_cancelled_guest (#272) ─────────────────────────────────────
// El huésped canceló desde la web. `{refund_line}` la arma el usecase según el estado REAL del
// reembolso (hecho / pendiente / sin reembolso) para no prometer plata que Stripe no devolvió.

const CANCELLED_GUEST_ES = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:22px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">Reserva cancelada</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Hola <strong>{guest_name}</strong>,</p>
    <p>Tu reserva del <strong>{checkin_date}</strong> al <strong>{checkout_date}</strong> ({rooms_count} habitación/es) quedó cancelada el {cancelled_at}.</p>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <table style="width:100%;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;">Total de la reserva</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{total_amount}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Penalidad por cancelación</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{cancellation_fee_text}</td></tr>
        <tr><td style="padding:6px 0;border-top:2px solid #e5e7eb;color:#1a2b4c;font-weight:bold;">Reembolso</td><td style="padding:6px 0;border-top:2px solid #e5e7eb;font-weight:bold;text-align:right;color:#1a2b4c;">{refund_amount_text}</td></tr>
      </table>
    </div>
    <p style="font-size:14px;color:#4b5563;">{refund_line}</p>
    <p style="font-size:13px;color:#6b7280;">Localizador: <strong>{locator}</strong></p>
    <p style="font-size:13px;color:#6b7280;">¿Dudas? Escribinos a {hotel_email} o llamanos al <strong>{hotel_phone}</strong>.</p>
  </div>
</body></html>`

const CANCELLED_GUEST_EN = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:22px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">Booking cancelled</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Hello <strong>{guest_name}</strong>,</p>
    <p>Your booking from <strong>{checkin_date}</strong> to <strong>{checkout_date}</strong> ({rooms_count} room/s) was cancelled on {cancelled_at}.</p>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <table style="width:100%;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;">Booking total</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{total_amount}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Cancellation fee</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{cancellation_fee_text}</td></tr>
        <tr><td style="padding:6px 0;border-top:2px solid #e5e7eb;color:#1a2b4c;font-weight:bold;">Refund</td><td style="padding:6px 0;border-top:2px solid #e5e7eb;font-weight:bold;text-align:right;color:#1a2b4c;">{refund_amount_text}</td></tr>
      </table>
    </div>
    <p style="font-size:14px;color:#4b5563;">{refund_line}</p>
    <p style="font-size:13px;color:#6b7280;">Locator: <strong>{locator}</strong></p>
    <p style="font-size:13px;color:#6b7280;">Questions? Write to {hotel_email} or call us at <strong>{hotel_phone}</strong>.</p>
  </div>
</body></html>`

const CANCELLED_GUEST_PT = `<!DOCTYPE html>
<html lang="pt"><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:22px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">Reserva cancelada</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Olá <strong>{guest_name}</strong>,</p>
    <p>A sua reserva de <strong>{checkin_date}</strong> a <strong>{checkout_date}</strong> ({rooms_count} quarto/s) foi cancelada em {cancelled_at}.</p>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <table style="width:100%;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;">Total da reserva</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{total_amount}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Taxa de cancelamento</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{cancellation_fee_text}</td></tr>
        <tr><td style="padding:6px 0;border-top:2px solid #e5e7eb;color:#1a2b4c;font-weight:bold;">Reembolso</td><td style="padding:6px 0;border-top:2px solid #e5e7eb;font-weight:bold;text-align:right;color:#1a2b4c;">{refund_amount_text}</td></tr>
      </table>
    </div>
    <p style="font-size:14px;color:#4b5563;">{refund_line}</p>
    <p style="font-size:13px;color:#6b7280;">Localizador: <strong>{locator}</strong></p>
    <p style="font-size:13px;color:#6b7280;">Dúvidas? Escreva para {hotel_email} ou ligue para <strong>{hotel_phone}</strong>.</p>
  </div>
</body></html>`

// ─── reservation_cancelled_staff (#272) ─────────────────────────────────────
// Aviso al buzón del hotel (`hotels.email`). La campanita y el push ya salieron por el connector
// `bookingengine-notificaciones`; acá va el correo con el estado del reembolso y el link al panel.

const CANCELLED_STAFF_ES = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:22px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">Cancelación desde la web</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p><strong>{guest_name}</strong> canceló su reserva desde la web el {cancelled_at}.</p>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <table style="width:100%;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;">Estadía</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkin_date} → {checkout_date}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Habitaciones</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{rooms_count}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Total</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{total_amount}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Penalidad</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{cancellation_fee_text}</td></tr>
        <tr><td style="padding:6px 0;border-top:2px solid #e5e7eb;color:#1a2b4c;font-weight:bold;">Reembolso</td><td style="padding:6px 0;border-top:2px solid #e5e7eb;font-weight:bold;text-align:right;color:#1a2b4c;">{refund_amount_text}</td></tr>
      </table>
    </div>
    <p style="font-size:14px;color:#4b5563;">Estado: {refund_line}</p>
    <p style="font-size:13px;color:#6b7280;">Localizador: <strong>{locator}</strong> · Reserva {reservation_id}</p>
    <p><a href="{reservation_link}" style="color:#1a2b4c;font-weight:bold;">Abrir la reserva en el panel</a></p>
  </div>
</body></html>`

const CANCELLED_STAFF_EN = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:22px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">Web cancellation</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p><strong>{guest_name}</strong> cancelled their booking from the website on {cancelled_at}.</p>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <table style="width:100%;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;">Stay</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkin_date} → {checkout_date}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Rooms</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{rooms_count}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Total</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{total_amount}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Cancellation fee</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{cancellation_fee_text}</td></tr>
        <tr><td style="padding:6px 0;border-top:2px solid #e5e7eb;color:#1a2b4c;font-weight:bold;">Refund</td><td style="padding:6px 0;border-top:2px solid #e5e7eb;font-weight:bold;text-align:right;color:#1a2b4c;">{refund_amount_text}</td></tr>
      </table>
    </div>
    <p style="font-size:14px;color:#4b5563;">Status: {refund_line}</p>
    <p style="font-size:13px;color:#6b7280;">Locator: <strong>{locator}</strong> · Booking {reservation_id}</p>
    <p><a href="{reservation_link}" style="color:#1a2b4c;font-weight:bold;">Open the booking in the panel</a></p>
  </div>
</body></html>`

const CANCELLED_STAFF_PT = `<!DOCTYPE html>
<html lang="pt"><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:22px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">Cancelamento pela web</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p><strong>{guest_name}</strong> cancelou a sua reserva pelo site em {cancelled_at}.</p>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <table style="width:100%;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;">Estadia</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkin_date} → {checkout_date}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Quartos</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{rooms_count}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Total</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{total_amount}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Taxa de cancelamento</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{cancellation_fee_text}</td></tr>
        <tr><td style="padding:6px 0;border-top:2px solid #e5e7eb;color:#1a2b4c;font-weight:bold;">Reembolso</td><td style="padding:6px 0;border-top:2px solid #e5e7eb;font-weight:bold;text-align:right;color:#1a2b4c;">{refund_amount_text}</td></tr>
      </table>
    </div>
    <p style="font-size:14px;color:#4b5563;">Estado: {refund_line}</p>
    <p style="font-size:13px;color:#6b7280;">Localizador: <strong>{locator}</strong> · Reserva {reservation_id}</p>
    <p><a href="{reservation_link}" style="color:#1a2b4c;font-weight:bold;">Abrir a reserva no painel</a></p>
  </div>
</body></html>`

// ─── checkin_welcome ────────────────────────────────────────────────────────

const CHECKIN_ES = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
    <div style="font-size:40px;">🏨</div>
    <h1 style="margin:8px 0 0;font-size:24px;">{hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.85;">¡Bienvenido!</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:18px;">Bienvenido, <strong>{guest_name}</strong></p>
    <p style="font-size:15px;">Nos complace darle la bienvenida a <strong>{hotel_name}</strong>. A continuación, le proporcionamos la información necesaria para su acceso y estancia:</p>

    <div style="background:white;border-radius:8px;padding:14px;margin:14px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 4px;font-weight:bold;color:#1a2b4c;">🔑 Acceso al hotel</p>
      <p style="margin:0;color:#6b7280;">Código: <strong style="font-size:18px;letter-spacing:2px;color:#111827;">{lock_code}</strong></p>
    </div>

    <div style="background:white;border-radius:8px;padding:14px;margin:14px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 4px;font-weight:bold;color:#1a2b4c;">🚪 Habitación asignada</p>
      <p style="margin:0;color:#6b7280;">Número: <strong>{room_number}</strong></p>
      <p style="margin:2px 0 0;color:#6b7280;">Código de acceso: <strong style="font-size:18px;letter-spacing:2px;color:#111827;">{lock_code}</strong> — ingresalo en el teclado de la puerta.</p>
    </div>

    <div style="background:white;border-radius:8px;padding:14px;margin:14px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 4px;font-weight:bold;color:#1a2b4c;">🕒 Horario de estancia</p>
      <p style="margin:0;color:#6b7280;">Check-in: <strong>{checkin_date}</strong> a partir de las <strong>{checkin_time}</strong></p>
      <p style="margin:2px 0 0;color:#6b7280;">Check-out: <strong>{checkout_date}</strong> hasta las <strong>{checkout_time}</strong></p>
    </div>

    <div style="background:white;border-radius:8px;padding:14px;margin:14px 0;border:1px solid #d1d5db;font-size:13px;">
      <p style="margin:0 0 4px;font-weight:bold;color:#1a2b4c;">📶 Conexión WiFi</p>
      <p style="margin:0;color:#6b7280;">Red: <strong>{wifi_network}</strong> · Contraseña: <strong>{wifi_password}</strong></p>
    </div>

    <p style="font-size:13px;color:#6b7280;">📍 {hotel_address}</p>
    <p style="font-size:13px;color:#6b7280;">📞 <a href="tel:{hotel_phone}" style="color:#1a2b4c;">{hotel_phone}</a></p>
    <p style="font-size:14px;">¡Que disfrutes tu estancia! Si necesitás algo, estamos para ayudarte.</p>
  </div>
</body>
</html>`

const CHECKIN_EN = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
    <div style="font-size:40px;">🏨</div>
    <h1 style="margin:8px 0 0;font-size:24px;">{hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.85;">Welcome!</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:18px;">Welcome, <strong>{guest_name}</strong></p>
    <p style="font-size:15px;">We are pleased to welcome you to <strong>{hotel_name}</strong>. Below is the information you need for your access and stay:</p>

    <div style="background:white;border-radius:8px;padding:14px;margin:14px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 4px;font-weight:bold;color:#1a2b4c;">🔑 Hotel access</p>
      <p style="margin:0;color:#6b7280;">Code: <strong style="font-size:18px;letter-spacing:2px;color:#111827;">{lock_code}</strong></p>
    </div>

    <div style="background:white;border-radius:8px;padding:14px;margin:14px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 4px;font-weight:bold;color:#1a2b4c;">🚪 Assigned room</p>
      <p style="margin:0;color:#6b7280;">Number: <strong>{room_number}</strong></p>
      <p style="margin:2px 0 0;color:#6b7280;">Access code: <strong style="font-size:18px;letter-spacing:2px;color:#111827;">{lock_code}</strong> — enter it on the door keypad.</p>
    </div>

    <div style="background:white;border-radius:8px;padding:14px;margin:14px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 4px;font-weight:bold;color:#1a2b4c;">🕒 Stay schedule</p>
      <p style="margin:0;color:#6b7280;">Check-in: <strong>{checkin_date}</strong> from <strong>{checkin_time}</strong></p>
      <p style="margin:2px 0 0;color:#6b7280;">Check-out: <strong>{checkout_date}</strong> until <strong>{checkout_time}</strong></p>
    </div>

    <div style="background:white;border-radius:8px;padding:14px;margin:14px 0;border:1px solid #d1d5db;font-size:13px;">
      <p style="margin:0 0 4px;font-weight:bold;color:#1a2b4c;">📶 WiFi</p>
      <p style="margin:0;color:#6b7280;">Network: <strong>{wifi_network}</strong> · Password: <strong>{wifi_password}</strong></p>
    </div>

    <p style="font-size:13px;color:#6b7280;">📍 {hotel_address}</p>
    <p style="font-size:13px;color:#6b7280;">📞 <a href="tel:{hotel_phone}" style="color:#1a2b4c;">{hotel_phone}</a></p>
    <p style="font-size:14px;">Enjoy your stay! If you need anything, we're here to help.</p>
  </div>
</body>
</html>`

const CHECKIN_PT = `<!DOCTYPE html>
<html lang="pt">
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
    <div style="font-size:40px;">🏨</div>
    <h1 style="margin:8px 0 0;font-size:24px;">{hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.85;">Bem-vindo!</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:18px;">Bem-vindo, <strong>{guest_name}</strong></p>
    <p style="font-size:15px;">Temos o prazer de o dar as boas-vindas ao <strong>{hotel_name}</strong>. Abaixo, a informação necessária para o seu acesso e estadia:</p>

    <div style="background:white;border-radius:8px;padding:14px;margin:14px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 4px;font-weight:bold;color:#1a2b4c;">🔑 Acesso ao hotel</p>
      <p style="margin:0;color:#6b7280;">Código: <strong style="font-size:18px;letter-spacing:2px;color:#111827;">{lock_code}</strong></p>
    </div>

    <div style="background:white;border-radius:8px;padding:14px;margin:14px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 4px;font-weight:bold;color:#1a2b4c;">🚪 Quarto atribuído</p>
      <p style="margin:0;color:#6b7280;">Número: <strong>{room_number}</strong></p>
      <p style="margin:2px 0 0;color:#6b7280;">Código de acesso: <strong style="font-size:18px;letter-spacing:2px;color:#111827;">{lock_code}</strong> — introduza-o no teclado da porta.</p>
    </div>

    <div style="background:white;border-radius:8px;padding:14px;margin:14px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 4px;font-weight:bold;color:#1a2b4c;">🕒 Horário da estadia</p>
      <p style="margin:0;color:#6b7280;">Check-in: <strong>{checkin_date}</strong> a partir das <strong>{checkin_time}</strong></p>
      <p style="margin:2px 0 0;color:#6b7280;">Check-out: <strong>{checkout_date}</strong> até às <strong>{checkout_time}</strong></p>
    </div>

    <div style="background:white;border-radius:8px;padding:14px;margin:14px 0;border:1px solid #d1d5db;font-size:13px;">
      <p style="margin:0 0 4px;font-weight:bold;color:#1a2b4c;">📶 WiFi</p>
      <p style="margin:0;color:#6b7280;">Rede: <strong>{wifi_network}</strong> · Palavra-passe: <strong>{wifi_password}</strong></p>
    </div>

    <p style="font-size:13px;color:#6b7280;">📍 {hotel_address}</p>
    <p style="font-size:13px;color:#6b7280;">📞 <a href="tel:{hotel_phone}" style="color:#1a2b4c;">{hotel_phone}</a></p>
    <p style="font-size:14px;">Desfrute da sua estadia! Se precisar de algo, estamos aqui para ajudar.</p>
  </div>
</body>
</html>`

// ─── no_show (D3 — ciclo de vida: reserva vencida sin llegada) ──────────────

const NOSHOW_ES = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:22px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">Reserva no realizada</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Hola <strong>{guest_name}</strong>,</p>
    <p>Tu reserva del <strong>{checkin_date}</strong> al <strong>{checkout_date}</strong> (Hab. {room_number}) fue marcada como <strong>no-show</strong>.</p>
    <p style="font-size:13px;color:#6b7280;">Si creés que es un error, contactanos al <strong>{hotel_phone}</strong>.</p>
  </div>
</body></html>`

const NOSHOW_EN = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:22px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">Booking not fulfilled</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Hi <strong>{guest_name}</strong>,</p>
    <p>Your booking from <strong>{checkin_date}</strong> to <strong>{checkout_date}</strong> (Room {room_number}) was marked as <strong>no-show</strong>.</p>
    <p style="font-size:13px;color:#6b7280;">If you believe this is an error, please call <strong>{hotel_phone}</strong>.</p>
  </div>
</body></html>`

const NOSHOW_PT = `<!DOCTYPE html>
<html lang="pt"><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:22px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">Reserva não realizada</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Olá <strong>{guest_name}</strong>,</p>
    <p>A sua reserva de <strong>{checkin_date}</strong> a <strong>{checkout_date}</strong> (Quarto {room_number}) foi marcada como <strong>no-show</strong>.</p>
    <p style="font-size:13px;color:#6b7280;">Se acha que é um erro, ligue para <strong>{hotel_phone}</strong>.</p>
  </div>
</body></html>`

// ─── checkout (D3 — ciclo de vida: cierre de estancia) ──────────────────────

const CHECKOUT_ES = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:22px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">¡Gracias por tu estancia!</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Hola <strong>{guest_name}</strong>,</p>
    <p>Esperamos que hayas disfrutado tu estancia con nosotros. ¡Gracias por elegir {hotel_name}!</p>
    <p style="font-size:13px;color:#6b7280;">Reserva: {checkin_date} → {checkout_date} · Hab. {room_number}</p>
    <p style="font-size:14px;">¡Te esperamos de vuelta!</p>
  </div>
</body></html>`

const CHECKOUT_EN = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:22px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">Thank you for your stay!</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Hi <strong>{guest_name}</strong>,</p>
    <p>We hope you enjoyed your stay with us. Thank you for choosing {hotel_name}!</p>
    <p style="font-size:13px;color:#6b7280;">Booking: {checkin_date} → {checkout_date} · Room {room_number}</p>
    <p style="font-size:14px;">We look forward to welcoming you back!</p>
  </div>
</body></html>`

const CHECKOUT_PT = `<!DOCTYPE html>
<html lang="pt"><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:22px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">Obrigado pela sua estadia!</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Olá <strong>{guest_name}</strong>,</p>
    <p>Esperamos que tenha desfrutado da sua estadia connosco. Obrigado por escolher {hotel_name}!</p>
    <p style="font-size:13px;color:#6b7280;">Reserva: {checkin_date} → {checkout_date} · Quarto {room_number}</p>
    <p style="font-size:14px;">Esperamos vê-lo de novo em breve!</p>
  </div>
</body></html>`

// ─── reservation_approved / reservation_rejected (#271 MR-06 — aprobación manual) ─
// El hotel con "Confirmación instantánea" apagada revisa cada reserva web: al aprobar se le
// confirma al huésped; al rechazar se le explica el motivo y qué se le devolvió. Variables extra
// del rechazo: {rejection_reason} y {refund_amount} (ej. "100.00 USD"; "0.00 USD" si pagó fuera
// de Stripe — en ese caso el hotel se contacta).

const APPROVED_ES = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:22px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">Reserva confirmada</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Hola <strong>{guest_name}</strong>,</p>
    <p>El hotel confirmó su reserva del <strong>{checkin_date}</strong> al <strong>{checkout_date}</strong>.</p>
    <p style="font-size:13px;color:#6b7280;">Ante cualquier consulta, contactanos al <strong>{hotel_phone}</strong>.</p>
    <p style="font-size:14px;">¡Te esperamos!</p>
  </div>
</body></html>`

const APPROVED_EN = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:22px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">Booking confirmed</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Hi <strong>{guest_name}</strong>,</p>
    <p>The hotel has confirmed your booking from <strong>{checkin_date}</strong> to <strong>{checkout_date}</strong>.</p>
    <p style="font-size:13px;color:#6b7280;">If you have any questions, please call <strong>{hotel_phone}</strong>.</p>
    <p style="font-size:14px;">We look forward to welcoming you!</p>
  </div>
</body></html>`

const APPROVED_PT = `<!DOCTYPE html>
<html lang="pt"><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:22px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">Reserva confirmada</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Olá <strong>{guest_name}</strong>,</p>
    <p>O hotel confirmou a sua reserva de <strong>{checkin_date}</strong> a <strong>{checkout_date}</strong>.</p>
    <p style="font-size:13px;color:#6b7280;">Para qualquer dúvida, ligue para <strong>{hotel_phone}</strong>.</p>
    <p style="font-size:14px;">Esperamos por si!</p>
  </div>
</body></html>`

const REJECTED_ES = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:22px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">Reserva no confirmada</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Hola <strong>{guest_name}</strong>,</p>
    <p>Lamentablemente el hotel no pudo confirmar su reserva del <strong>{checkin_date}</strong> al <strong>{checkout_date}</strong>.</p>
    <p><strong>Motivo:</strong> {rejection_reason}</p>
    <p>Se reembolsó <strong>{refund_amount}</strong> al medio de pago original. Si el importe es 0, el hotel se pondrá en contacto para coordinar la devolución.</p>
    <p style="font-size:13px;color:#6b7280;">Ante cualquier consulta, contactanos al <strong>{hotel_phone}</strong>.</p>
  </div>
</body></html>`

const REJECTED_EN = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:22px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">Booking not confirmed</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Hi <strong>{guest_name}</strong>,</p>
    <p>Unfortunately the hotel could not confirm your booking from <strong>{checkin_date}</strong> to <strong>{checkout_date}</strong>.</p>
    <p><strong>Reason:</strong> {rejection_reason}</p>
    <p><strong>{refund_amount}</strong> has been refunded to your original payment method. If the amount is 0, the hotel will contact you to arrange the refund.</p>
    <p style="font-size:13px;color:#6b7280;">If you have any questions, please call <strong>{hotel_phone}</strong>.</p>
  </div>
</body></html>`

const REJECTED_PT = `<!DOCTYPE html>
<html lang="pt"><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:22px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">Reserva não confirmada</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Olá <strong>{guest_name}</strong>,</p>
    <p>Infelizmente o hotel não pôde confirmar a sua reserva de <strong>{checkin_date}</strong> a <strong>{checkout_date}</strong>.</p>
    <p><strong>Motivo:</strong> {rejection_reason}</p>
    <p>Foi reembolsado <strong>{refund_amount}</strong> para o meio de pagamento original. Se o valor for 0, o hotel entrará em contacto para combinar a devolução.</p>
    <p style="font-size:13px;color:#6b7280;">Para qualquer dúvida, ligue para <strong>{hotel_phone}</strong>.</p>
  </div>
</body></html>`

// ─── invoice (envío de factura al huésped) ─────────────────────────────────
// Email que acompaña el envío de una factura. Placeholders solo del set resoluble
// por los consumidores (hotel_name, guest_name, room_number, fechas, total_amount,
// locator, hotel_phone, logo_url). El PDF/detalle de la factura va aparte.

const INVOICE_ES = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:24px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">Tu factura</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Hola <strong>{guest_name}</strong>,</p>
    <p>Te enviamos la factura correspondiente a tu estancia. Aquí tienes el detalle:</p>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <table style="width:100%;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;">Habitación</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{room_number}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-in</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkin_date}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-out</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkout_date}</td></tr>
        <tr><td style="padding:6px 0;border-top:2px solid #e5e7eb;color:#1a2b4c;font-weight:bold;">Total</td><td style="padding:6px 0;border-top:2px solid #e5e7eb;font-weight:bold;text-align:right;font-size:18px;color:#1a2b4c;">{total_amount}</td></tr>
      </table>
    </div>
    <p style="font-size:13px;color:#6b7280;">Localizador: <strong>{locator}</strong></p>
    <p style="font-size:13px;color:#6b7280;">Si tenés alguna consulta sobre tu factura, llamá al <strong>{hotel_phone}</strong>.</p>
    <p style="font-size:13px;color:#6b7280;">¡Gracias por tu preferencia!</p>
  </div>
</body></html>`

const INVOICE_EN = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:24px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">Your invoice</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Hi <strong>{guest_name}</strong>,</p>
    <p>Here is the invoice for your stay. Please find the details below:</p>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <table style="width:100%;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;">Room</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{room_number}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-in</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkin_date}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-out</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkout_date}</td></tr>
        <tr><td style="padding:6px 0;border-top:2px solid #e5e7eb;color:#1a2b4c;font-weight:bold;">Total</td><td style="padding:6px 0;border-top:2px solid #e5e7eb;font-weight:bold;text-align:right;font-size:18px;color:#1a2b4c;">{total_amount}</td></tr>
      </table>
    </div>
    <p style="font-size:13px;color:#6b7280;">Booking ref: <strong>{locator}</strong></p>
    <p style="font-size:13px;color:#6b7280;">If you have any questions about your invoice, call <strong>{hotel_phone}</strong>.</p>
    <p style="font-size:13px;color:#6b7280;">Thank you for choosing us!</p>
  </div>
</body></html>`

const INVOICE_PT = `<!DOCTYPE html>
<html lang="pt"><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:24px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">A sua fatura</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Olá <strong>{guest_name}</strong>,</p>
    <p>Enviamos a fatura referente à sua estadia. Aqui estão os detalhes:</p>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <table style="width:100%;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;">Quarto</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{room_number}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-in</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkin_date}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-out</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkout_date}</td></tr>
        <tr><td style="padding:6px 0;border-top:2px solid #e5e7eb;color:#1a2b4c;font-weight:bold;">Total</td><td style="padding:6px 0;border-top:2px solid #e5e7eb;font-weight:bold;text-align:right;font-size:18px;color:#1a2b4c;">{total_amount}</td></tr>
      </table>
    </div>
    <p style="font-size:13px;color:#6b7280;">Localizador: <strong>{locator}</strong></p>
    <p style="font-size:13px;color:#6b7280;">Para qualquer dúvida sobre a sua fatura, ligue para <strong>{hotel_phone}</strong>.</p>
    <p style="font-size:13px;color:#6b7280;">Obrigado pela sua preferência!</p>
  </div>
</body></html>`

// ─── reminder (recordatorio pre-llegada) ────────────────────────────────────
// Recordatorio previo al check-in. Placeholders solo del set resoluble.

const REMINDER_ES = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:24px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">Recordatorio de tu llegada</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Hola <strong>{guest_name}</strong>,</p>
    <p>Te recordamos que tu llegada se acerca. Estos son los datos de tu reserva:</p>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <table style="width:100%;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;">Habitación</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{room_number}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-in</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkin_date}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-out</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkout_date}</td></tr>
      </table>
    </div>
    <p style="font-size:13px;color:#6b7280;">📍 {hotel_address}</p>
    <p style="font-size:13px;color:#6b7280;">Localizador: <strong>{locator}</strong></p>
    <div style="background:white;border-radius:8px;padding:14px;margin:16px 0;border:1px dashed #d1d5db;font-size:13px;">
      <p style="margin:0 0 6px;font-weight:bold;color:#1a2b4c;">📋 Completá tu registro antes de llegar</p>
      <p style="margin:0;"><a href="{pre_checkin_url}" style="color:#1a2b4c;">{pre_checkin_url}</a></p>
    </div>
    <p style="font-size:13px;color:#6b7280;">Si necesitás algo antes de llegar, llamá al <strong>{hotel_phone}</strong>.</p>
    <p style="font-size:14px;">¡Te esperamos!</p>
  </div>
</body></html>`

const REMINDER_EN = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:24px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">Your arrival reminder</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Hi <strong>{guest_name}</strong>,</p>
    <p>Just a reminder that your arrival is coming up. Here are your booking details:</p>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <table style="width:100%;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;">Room</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{room_number}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-in</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkin_date}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-out</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkout_date}</td></tr>
      </table>
    </div>
    <p style="font-size:13px;color:#6b7280;">📍 {hotel_address}</p>
    <p style="font-size:13px;color:#6b7280;">Booking ref: <strong>{locator}</strong></p>
    <div style="background:white;border-radius:8px;padding:14px;margin:16px 0;border:1px dashed #d1d5db;font-size:13px;">
      <p style="margin:0 0 6px;font-weight:bold;color:#1a2b4c;">📋 Complete your registration before you arrive</p>
      <p style="margin:0;"><a href="{pre_checkin_url}" style="color:#1a2b4c;">{pre_checkin_url}</a></p>
    </div>
    <p style="font-size:13px;color:#6b7280;">If you need anything before you arrive, call <strong>{hotel_phone}</strong>.</p>
    <p style="font-size:14px;">We look forward to welcoming you!</p>
  </div>
</body></html>`

const REMINDER_PT = `<!DOCTYPE html>
<html lang="pt"><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:24px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">Lembrete da sua chegada</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Olá <strong>{guest_name}</strong>,</p>
    <p>Lembramos que a sua chegada está próxima. Aqui estão os dados da sua reserva:</p>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <table style="width:100%;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;">Quarto</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{room_number}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-in</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkin_date}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-out</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkout_date}</td></tr>
      </table>
    </div>
    <p style="font-size:13px;color:#6b7280;">📍 {hotel_address}</p>
    <p style="font-size:13px;color:#6b7280;">Localizador: <strong>{locator}</strong></p>
    <div style="background:white;border-radius:8px;padding:14px;margin:16px 0;border:1px dashed #d1d5db;font-size:13px;">
      <p style="margin:0 0 6px;font-weight:bold;color:#1a2b4c;">📋 Complete o seu registo antes de chegar</p>
      <p style="margin:0;"><a href="{pre_checkin_url}" style="color:#1a2b4c;">{pre_checkin_url}</a></p>
    </div>
    <p style="font-size:13px;color:#6b7280;">Se precisar de algo antes de chegar, ligue para <strong>{hotel_phone}</strong>.</p>
    <p style="font-size:14px;">Esperamos por si!</p>
  </div>
</body></html>`

// ─── checkin_link (enlace del check-in digital, #336) ───────────────────────
// Envío MANUAL desde la tarjeta "Check-in digital" del detalle de la reserva
// (POST /api/reservas/:id/send-checkin-link-email → reservas/usecases/checkin-link-email.ts).
// Variables: hotel_name, guest_name, locator, checkin_date, checkout_date, checkin_url, hotel_phone.
// Sin logo ni condicionales: el renderer no los tiene. El enlace va como botón Y como texto
// visible (clientes de correo que no muestran botones).

const CHECKIN_LINK_ES = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:24px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">Tu check-in digital</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Hola <strong>{guest_name}</strong>,</p>
    <p>Para que tu llegada sea más rápida, te invitamos a completar el check-in digital antes de llegar. Te toma solo unos minutos.</p>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <table style="width:100%;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;">Reserva</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{locator}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-in</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkin_date}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-out</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkout_date}</td></tr>
      </table>
    </div>
    <p style="text-align:center;margin:24px 0;"><a href="{checkin_url}" style="background:#1a2b4c;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:bold;display:inline-block;">Completar mi check-in</a></p>
    <p style="font-size:12px;color:#6b7280;">Si el botón no funciona, copiá y pegá este enlace:<br><a href="{checkin_url}" style="color:#1a2b4c;">{checkin_url}</a></p>
    <p style="font-size:13px;color:#6b7280;">Si necesitás ayuda, llamá al <strong>{hotel_phone}</strong>.</p>
    <p style="font-size:14px;">¡Te esperamos!</p>
  </div>
</body></html>`

const CHECKIN_LINK_EN = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:24px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">Your digital check-in</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Hi <strong>{guest_name}</strong>,</p>
    <p>To speed up your arrival, we invite you to complete your digital check-in before you get here. It only takes a few minutes.</p>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <table style="width:100%;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;">Booking ref</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{locator}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-in</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkin_date}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-out</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkout_date}</td></tr>
      </table>
    </div>
    <p style="text-align:center;margin:24px 0;"><a href="{checkin_url}" style="background:#1a2b4c;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:bold;display:inline-block;">Complete my check-in</a></p>
    <p style="font-size:12px;color:#6b7280;">If the button doesn't work, copy and paste this link:<br><a href="{checkin_url}" style="color:#1a2b4c;">{checkin_url}</a></p>
    <p style="font-size:13px;color:#6b7280;">If you need any help, call <strong>{hotel_phone}</strong>.</p>
    <p style="font-size:14px;">We look forward to welcoming you!</p>
  </div>
</body></html>`

const CHECKIN_LINK_PT = `<!DOCTYPE html>
<html lang="pt"><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:24px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">O seu check-in digital</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Olá <strong>{guest_name}</strong>,</p>
    <p>Para agilizar a sua chegada, convidamos você a completar o check-in digital antes de chegar. Leva só alguns minutos.</p>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <table style="width:100%;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;">Reserva</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{locator}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-in</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkin_date}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-out</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkout_date}</td></tr>
      </table>
    </div>
    <p style="text-align:center;margin:24px 0;"><a href="{checkin_url}" style="background:#1a2b4c;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:bold;display:inline-block;">Completar o meu check-in</a></p>
    <p style="font-size:12px;color:#6b7280;">Se o botão não funcionar, copie e cole este link:<br><a href="{checkin_url}" style="color:#1a2b4c;">{checkin_url}</a></p>
    <p style="font-size:13px;color:#6b7280;">Se precisar de ajuda, ligue para <strong>{hotel_phone}</strong>.</p>
    <p style="font-size:14px;">Esperamos por si!</p>
  </div>
</body></html>`

// ─── Registro central ───────────────────────────────────────────────────────

// ─── payment_link ───────────────────────────────────────────────────────────
// Link de pago (Stripe) generado para una reserva. Variables: hotel_name, amount, currency, payment_url.
const PAYMENT_LINK_ES = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111827;">
  <h2 style="color:#0f172a;">Pago pendiente — {hotel_name}</h2>
  <p>Hola, tenés un pago pendiente por <b>{amount} {currency}</b>.</p>
  <p style="text-align:center;margin:28px 0;"><a href="{payment_url}" style="background:#2563eb;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:bold;display:inline-block;">Pagar ahora</a></p>
  <p style="font-size:12px;color:#6b7280;">Si el botón no funciona, copiá y pegá este enlace:<br>{payment_url}</p>
</div>`
const PAYMENT_LINK_EN = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111827;">
  <h2 style="color:#0f172a;">Payment pending — {hotel_name}</h2>
  <p>Hi, you have a pending payment of <b>{amount} {currency}</b>.</p>
  <p style="text-align:center;margin:28px 0;"><a href="{payment_url}" style="background:#2563eb;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:bold;display:inline-block;">Pay now</a></p>
  <p style="font-size:12px;color:#6b7280;">If the button doesn't work, copy and paste this link:<br>{payment_url}</p>
</div>`
const PAYMENT_LINK_PT = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111827;">
  <h2 style="color:#0f172a;">Pagamento pendente — {hotel_name}</h2>
  <p>Olá, você tem um pagamento pendente de <b>{amount} {currency}</b>.</p>
  <p style="text-align:center;margin:28px 0;"><a href="{payment_url}" style="background:#2563eb;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:bold;display:inline-block;">Pagar agora</a></p>
  <p style="font-size:12px;color:#6b7280;">Se o botão não funcionar, copie e cole este link:<br>{payment_url}</p>
</div>`

// ─── review_request ─────────────────────────────────────────────────────────
// Invitación a dejar una reseña tras el checkout. Variables: hotel_name, guest_name, review_url.
const REVIEW_ES = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111827;">
  <h2 style="color:#0f172a;">¿Cómo fue tu estadía en {hotel_name}?</h2>
  <p>Hola {guest_name}, nos encantaría conocer tu opinión. Solo te toma un minuto.</p>
  <p style="text-align:center;margin:28px 0;"><a href="{review_url}" style="background:#2563eb;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:bold;display:inline-block;">Dejar mi reseña</a></p>
  <p style="font-size:12px;color:#6b7280;">Si el botón no funciona, copiá y pegá este enlace:<br>{review_url}</p>
</div>`
const REVIEW_EN = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111827;">
  <h2 style="color:#0f172a;">How was your stay at {hotel_name}?</h2>
  <p>Hi {guest_name}, we'd love to hear your feedback. It only takes a minute.</p>
  <p style="text-align:center;margin:28px 0;"><a href="{review_url}" style="background:#2563eb;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:bold;display:inline-block;">Leave my review</a></p>
  <p style="font-size:12px;color:#6b7280;">If the button doesn't work, copy and paste this link:<br>{review_url}</p>
</div>`
const REVIEW_PT = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111827;">
  <h2 style="color:#0f172a;">Como foi a sua estadia em {hotel_name}?</h2>
  <p>Olá {guest_name}, adoraríamos saber a sua opinião. Leva só um minuto.</p>
  <p style="text-align:center;margin:28px 0;"><a href="{review_url}" style="background:#2563eb;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:bold;display:inline-block;">Deixar a minha avaliação</a></p>
  <p style="font-size:12px;color:#6b7280;">Se o botão não funcionar, copie e cole este link:<br>{review_url}</p>
</div>`

// ─── reservation_new_staff ──────────────────────────────────────────────────
// Aviso al STAFF del hotel por reserva web nueva / pago recibido (#267). Destinatario: el hotel, no el huésped.
// Variables: title (ej. "Nueva reserva web — Ana"), hotel_name, guest_name, guest_email, guest_phone, checkin_date,
// checkout_date, room (habitación o tipo), adults, children, children_ages, crib (Sí/No), regime, details,
// total_amount, payment_status, panel_link, platform_name.
// ⚠️ renderTemplate() escapa HTML en TODAS las variables string: `{details}` se pasa como TEXTO PLANO (sin <br>),
// una línea por nota separada con "\n" (el <p> usa white-space:pre-line) o con " · ". Nunca HTML.
// `{platform_name}` lo resuelve el envío desde platformIdentity (shared/utils/platform-identity.ts): NO hardcodear.

const NEW_STAFF_ES = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:24px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">{title}</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Entró una reserva desde el motor web. Estos son los datos:</p>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <table style="width:100%;font-size:14px;">
        <tr><td colspan="2" style="padding:4px 0;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Huésped</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Nombre</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{guest_name}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Email</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{guest_email}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Teléfono</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{guest_phone}</td></tr>
        <tr><td colspan="2" style="padding:12px 0 4px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Estancia</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-in</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkin_date}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-out</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkout_date}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Habitación</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{room}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Adultos / Niños</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{adults} / {children}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Edades de los niños</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{children_ages}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Cuna</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{crib}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Régimen</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{regime}</td></tr>
        <tr><td style="padding:6px 0;border-top:2px solid #e5e7eb;color:#1a2b4c;font-weight:bold;">Total</td><td style="padding:6px 0;border-top:2px solid #e5e7eb;font-weight:bold;text-align:right;font-size:18px;color:#1a2b4c;">{total_amount}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Estado del pago</td><td style="padding:6px 0;text-align:right;"><strong style="font-size:16px;color:#1a2b4c;">{payment_status}</strong></td></tr>
      </table>
    </div>
    <div style="background:white;border-radius:8px;padding:14px;margin:16px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 6px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Notas del huésped</p>
      <p style="margin:0;font-size:13px;color:#4b5563;white-space:pre-line;">{details}</p>
    </div>
    <p style="text-align:center;margin:24px 0;"><a href="{panel_link}" style="background:#2563eb;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:bold;display:inline-block;">Abrir la reserva en el panel</a></p>
    <p style="font-size:12px;color:#6b7280;">Si el botón no funciona, copiá y pegá este enlace:<br>{panel_link}</p>
    <p style="font-size:12px;color:#9ca3af;text-align:center;margin-top:24px;">Enviado por {platform_name}</p>
  </div>
</body>
</html>`

const NEW_STAFF_EN = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:24px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">{title}</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">A booking came in from the web booking engine. Here are the details:</p>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <table style="width:100%;font-size:14px;">
        <tr><td colspan="2" style="padding:4px 0;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Guest</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Name</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{guest_name}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Email</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{guest_email}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Phone</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{guest_phone}</td></tr>
        <tr><td colspan="2" style="padding:12px 0 4px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Stay</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-in</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkin_date}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-out</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkout_date}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Room</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{room}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Adults / Children</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{adults} / {children}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Children ages</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{children_ages}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Crib</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{crib}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Meal plan</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{regime}</td></tr>
        <tr><td style="padding:6px 0;border-top:2px solid #e5e7eb;color:#1a2b4c;font-weight:bold;">Total</td><td style="padding:6px 0;border-top:2px solid #e5e7eb;font-weight:bold;text-align:right;font-size:18px;color:#1a2b4c;">{total_amount}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Payment status</td><td style="padding:6px 0;text-align:right;"><strong style="font-size:16px;color:#1a2b4c;">{payment_status}</strong></td></tr>
      </table>
    </div>
    <div style="background:white;border-radius:8px;padding:14px;margin:16px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 6px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Guest notes</p>
      <p style="margin:0;font-size:13px;color:#4b5563;white-space:pre-line;">{details}</p>
    </div>
    <p style="text-align:center;margin:24px 0;"><a href="{panel_link}" style="background:#2563eb;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:bold;display:inline-block;">Open the booking in the panel</a></p>
    <p style="font-size:12px;color:#6b7280;">If the button doesn't work, copy and paste this link:<br>{panel_link}</p>
    <p style="font-size:12px;color:#9ca3af;text-align:center;margin-top:24px;">Sent by {platform_name}</p>
  </div>
</body>
</html>`

const NEW_STAFF_PT = `<!DOCTYPE html>
<html lang="pt">
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:24px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">{title}</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Entrou uma reserva pelo motor de reservas web. Estes são os dados:</p>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <table style="width:100%;font-size:14px;">
        <tr><td colspan="2" style="padding:4px 0;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Hóspede</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Nome</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{guest_name}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Email</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{guest_email}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Telefone</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{guest_phone}</td></tr>
        <tr><td colspan="2" style="padding:12px 0 4px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Estadia</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-in</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkin_date}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-out</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkout_date}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Quarto</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{room}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Adultos / Crianças</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{adults} / {children}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Idades das crianças</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{children_ages}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Berço</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{crib}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Regime</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{regime}</td></tr>
        <tr><td style="padding:6px 0;border-top:2px solid #e5e7eb;color:#1a2b4c;font-weight:bold;">Total</td><td style="padding:6px 0;border-top:2px solid #e5e7eb;font-weight:bold;text-align:right;font-size:18px;color:#1a2b4c;">{total_amount}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Estado do pagamento</td><td style="padding:6px 0;text-align:right;"><strong style="font-size:16px;color:#1a2b4c;">{payment_status}</strong></td></tr>
      </table>
    </div>
    <div style="background:white;border-radius:8px;padding:14px;margin:16px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 6px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Notas do hóspede</p>
      <p style="margin:0;font-size:13px;color:#4b5563;white-space:pre-line;">{details}</p>
    </div>
    <p style="text-align:center;margin:24px 0;"><a href="{panel_link}" style="background:#2563eb;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:bold;display:inline-block;">Abrir a reserva no painel</a></p>
    <p style="font-size:12px;color:#6b7280;">Se o botão não funcionar, copie e cole este link:<br>{panel_link}</p>
    <p style="font-size:12px;color:#9ca3af;text-align:center;margin-top:24px;">Enviado por {platform_name}</p>
  </div>
</body>
</html>`

// ─── reservation_new_ota_staff ──────────────────────────────────────────────
// Aviso al STAFF por reserva entrada desde una OTA vía Channex (#246/#267). Misma tabla que `reservation_new_staff`
// pero SIN "Estado del pago": la ingestión de Channex (`canales/usecases/booking-ingestion.ts`) no recibe ningún
// dato de cobro (ni payment_collect ni tarjeta), así que decir "Pendiente de pago" o "Cobrada" sería inventar. El
// cobro lo rige el canal; el correo lo dice y manda a la extranet. Tampoco cuna/edades/régimen: la OTA no los trae.
// Variables: title, hotel_name, channel_name, guest_name, guest_email, guest_phone, checkin_date, checkout_date, room,
// adults, children, details, total_amount, panel_link, platform_name.

const NEW_OTA_STAFF_ES = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:24px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">{title}</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Entró una reserva desde {channel_name}. Estos son los datos:</p>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <table style="width:100%;font-size:14px;">
        <tr><td colspan="2" style="padding:4px 0;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Huésped</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Nombre</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{guest_name}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Email</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{guest_email}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Teléfono</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{guest_phone}</td></tr>
        <tr><td colspan="2" style="padding:12px 0 4px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Estancia</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Canal</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{channel_name}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-in</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkin_date}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-out</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkout_date}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Habitación</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{room}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Adultos / Niños</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{adults} / {children}</td></tr>
        <tr><td style="padding:6px 0;border-top:2px solid #e5e7eb;color:#1a2b4c;font-weight:bold;">Total informado por el canal</td><td style="padding:6px 0;border-top:2px solid #e5e7eb;font-weight:bold;text-align:right;font-size:18px;color:#1a2b4c;">{total_amount}</td></tr>
      </table>
    </div>
    <p style="font-size:13px;color:#4b5563;">El cobro lo gestiona {channel_name} según las condiciones de la reserva: verificá en la extranet del canal si ya está cobrada o se paga en el hotel.</p>
    <div style="background:white;border-radius:8px;padding:14px;margin:16px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 6px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Notas</p>
      <p style="margin:0;font-size:13px;color:#4b5563;white-space:pre-line;">{details}</p>
    </div>
    <p style="text-align:center;margin:24px 0;"><a href="{panel_link}" style="background:#2563eb;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:bold;display:inline-block;">Abrir la reserva en el panel</a></p>
    <p style="font-size:12px;color:#6b7280;">Si el botón no funciona, copiá y pegá este enlace:<br>{panel_link}</p>
    <p style="font-size:12px;color:#9ca3af;text-align:center;margin-top:24px;">Enviado por {platform_name}</p>
  </div>
</body>
</html>`

const NEW_OTA_STAFF_EN = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:24px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">{title}</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">A booking came in from {channel_name}. Here are the details:</p>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <table style="width:100%;font-size:14px;">
        <tr><td colspan="2" style="padding:4px 0;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Guest</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Name</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{guest_name}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Email</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{guest_email}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Phone</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{guest_phone}</td></tr>
        <tr><td colspan="2" style="padding:12px 0 4px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Stay</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Channel</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{channel_name}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-in</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkin_date}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-out</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkout_date}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Room</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{room}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Adults / Children</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{adults} / {children}</td></tr>
        <tr><td style="padding:6px 0;border-top:2px solid #e5e7eb;color:#1a2b4c;font-weight:bold;">Total reported by the channel</td><td style="padding:6px 0;border-top:2px solid #e5e7eb;font-weight:bold;text-align:right;font-size:18px;color:#1a2b4c;">{total_amount}</td></tr>
      </table>
    </div>
    <p style="font-size:13px;color:#4b5563;">Payment is handled by {channel_name} under the booking's terms: check the channel extranet to see whether it is already collected or payable at the hotel.</p>
    <div style="background:white;border-radius:8px;padding:14px;margin:16px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 6px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Notes</p>
      <p style="margin:0;font-size:13px;color:#4b5563;white-space:pre-line;">{details}</p>
    </div>
    <p style="text-align:center;margin:24px 0;"><a href="{panel_link}" style="background:#2563eb;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:bold;display:inline-block;">Open the booking in the panel</a></p>
    <p style="font-size:12px;color:#6b7280;">If the button doesn't work, copy and paste this link:<br>{panel_link}</p>
    <p style="font-size:12px;color:#9ca3af;text-align:center;margin-top:24px;">Sent by {platform_name}</p>
  </div>
</body>
</html>`

const NEW_OTA_STAFF_PT = `<!DOCTYPE html>
<html lang="pt">
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:24px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">{title}</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Entrou uma reserva por {channel_name}. Estes são os dados:</p>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <table style="width:100%;font-size:14px;">
        <tr><td colspan="2" style="padding:4px 0;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Hóspede</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Nome</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{guest_name}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Email</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{guest_email}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Telefone</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{guest_phone}</td></tr>
        <tr><td colspan="2" style="padding:12px 0 4px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Estadia</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Canal</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{channel_name}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-in</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkin_date}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-out</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkout_date}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Quarto</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{room}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Adultos / Crianças</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{adults} / {children}</td></tr>
        <tr><td style="padding:6px 0;border-top:2px solid #e5e7eb;color:#1a2b4c;font-weight:bold;">Total informado pelo canal</td><td style="padding:6px 0;border-top:2px solid #e5e7eb;font-weight:bold;text-align:right;font-size:18px;color:#1a2b4c;">{total_amount}</td></tr>
      </table>
    </div>
    <p style="font-size:13px;color:#4b5563;">O pagamento é gerido por {channel_name} conforme as condições da reserva: verifique na extranet do canal se já está cobrada ou se paga no hotel.</p>
    <div style="background:white;border-radius:8px;padding:14px;margin:16px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 6px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Notas</p>
      <p style="margin:0;font-size:13px;color:#4b5563;white-space:pre-line;">{details}</p>
    </div>
    <p style="text-align:center;margin:24px 0;"><a href="{panel_link}" style="background:#2563eb;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:bold;display:inline-block;">Abrir a reserva no painel</a></p>
    <p style="font-size:12px;color:#6b7280;">Se o botão não funcionar, copie e cole este link:<br>{panel_link}</p>
    <p style="font-size:12px;color:#9ca3af;text-align:center;margin-top:24px;">Enviado por {platform_name}</p>
  </div>
</body>
</html>`

// ─── reservation_received_unpaid ────────────────────────────────────────────
// Al HUÉSPED cuando el motor web no tiene pasarela de pago (#267): recibimos el pedido, el hotel lo contacta
// para coordinar el pago. Variables: guest_name, hotel_name, hotel_phone, hotel_email, checkin_date, checkout_date,
// checkin_time, checkout_time, total_amount, locator, platform_name (resuelto por platformIdentity, NO hardcodear).

const RECEIVED_UNPAID_ES = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:24px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">Recibimos tu pedido de reserva</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Hola <strong>{guest_name}</strong>,</p>
    <p>Recibimos tu pedido de reserva; el hotel te contactará para coordinar el pago. Estos son los datos:</p>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <table style="width:100%;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;">Check-in</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkin_date} · {checkin_time}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-out</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkout_date} · {checkout_time}</td></tr>
        <tr><td style="padding:6px 0;border-top:2px solid #e5e7eb;color:#1a2b4c;font-weight:bold;">Total</td><td style="padding:6px 0;border-top:2px solid #e5e7eb;font-weight:bold;text-align:right;font-size:18px;color:#1a2b4c;">{total_amount}</td></tr>
      </table>
    </div>
    <div style="background:white;border-radius:8px;padding:14px;margin:16px 0;border:1px solid #e5e7eb;text-align:center;">
      <p style="margin:0 0 6px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Tu localizador</p>
      <p style="margin:0;font-size:22px;font-weight:bold;color:#1a2b4c;letter-spacing:1px;">{locator}</p>
    </div>
    <p style="font-size:13px;color:#6b7280;">Guardá el localizador: te lo van a pedir para cualquier gestión sobre tu reserva.</p>
    <p style="font-size:13px;color:#6b7280;">Si querés adelantarte, escribinos a <strong>{hotel_email}</strong> o llamá al <strong>{hotel_phone}</strong>.</p>
    <p style="font-size:12px;color:#9ca3af;text-align:center;margin-top:24px;">Enviado por {platform_name}</p>
  </div>
</body>
</html>`

const RECEIVED_UNPAID_EN = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:24px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">We received your booking request</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Hi <strong>{guest_name}</strong>,</p>
    <p>We received your booking request; the hotel will contact you to arrange the payment. Here are the details:</p>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <table style="width:100%;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;">Check-in</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkin_date} · {checkin_time}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-out</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkout_date} · {checkout_time}</td></tr>
        <tr><td style="padding:6px 0;border-top:2px solid #e5e7eb;color:#1a2b4c;font-weight:bold;">Total</td><td style="padding:6px 0;border-top:2px solid #e5e7eb;font-weight:bold;text-align:right;font-size:18px;color:#1a2b4c;">{total_amount}</td></tr>
      </table>
    </div>
    <div style="background:white;border-radius:8px;padding:14px;margin:16px 0;border:1px solid #e5e7eb;text-align:center;">
      <p style="margin:0 0 6px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Your booking ref</p>
      <p style="margin:0;font-size:22px;font-weight:bold;color:#1a2b4c;letter-spacing:1px;">{locator}</p>
    </div>
    <p style="font-size:13px;color:#6b7280;">Keep your booking ref: you'll be asked for it for anything related to your booking.</p>
    <p style="font-size:13px;color:#6b7280;">If you'd like to get ahead, write to <strong>{hotel_email}</strong> or call <strong>{hotel_phone}</strong>.</p>
    <p style="font-size:12px;color:#9ca3af;text-align:center;margin-top:24px;">Sent by {platform_name}</p>
  </div>
</body>
</html>`

const RECEIVED_UNPAID_PT = `<!DOCTYPE html>
<html lang="pt">
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:24px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">Recebemos o seu pedido de reserva</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Olá <strong>{guest_name}</strong>,</p>
    <p>Recebemos o seu pedido de reserva; o hotel entrará em contato para combinar o pagamento. Estes são os dados:</p>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <table style="width:100%;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;">Check-in</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkin_date} · {checkin_time}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-out</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkout_date} · {checkout_time}</td></tr>
        <tr><td style="padding:6px 0;border-top:2px solid #e5e7eb;color:#1a2b4c;font-weight:bold;">Total</td><td style="padding:6px 0;border-top:2px solid #e5e7eb;font-weight:bold;text-align:right;font-size:18px;color:#1a2b4c;">{total_amount}</td></tr>
      </table>
    </div>
    <div style="background:white;border-radius:8px;padding:14px;margin:16px 0;border:1px solid #e5e7eb;text-align:center;">
      <p style="margin:0 0 6px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">O seu localizador</p>
      <p style="margin:0;font-size:22px;font-weight:bold;color:#1a2b4c;letter-spacing:1px;">{locator}</p>
    </div>
    <p style="font-size:13px;color:#6b7280;">Guarde o localizador: vão pedi-lo para qualquer gestão da sua reserva.</p>
    <p style="font-size:13px;color:#6b7280;">Se quiser adiantar-se, escreva para <strong>{hotel_email}</strong> ou ligue para <strong>{hotel_phone}</strong>.</p>
    <p style="font-size:12px;color:#9ca3af;text-align:center;margin-top:24px;">Enviado por {platform_name}</p>
  </div>
</body>
</html>`

export const NOTIFICATION_DEFAULTS: Record<NotificationEvent, Partial<Record<NotificationLanguage, NotificationDefault>>> = {
  reservation_confirmed: {
    es: { subject: 'Su reserva en {hotel_name} está confirmada — {locator}', body: CONFIRMED_ES },
    en: { subject: 'Reservation confirmed at {hotel_name} — {locator}', body: CONFIRMED_EN },
    pt: { subject: 'A sua reserva em {hotel_name} está confirmada — {locator}', body: CONFIRMED_PT },
  },
  reservation_presale: {
    es: { subject: 'Reserva pendiente de pago — {hotel_name}', body: PRESALE_ES },
    en: { subject: 'Booking pending payment — {hotel_name}', body: PRESALE_EN },
    pt: { subject: 'Reserva pendente de pagamento — {hotel_name}', body: PRESALE_PT },
  },
  reservation_cancelled_guest: {
    es: { subject: 'Reserva cancelada — {hotel_name}', body: CANCELLED_GUEST_ES },
    en: { subject: 'Booking cancelled — {hotel_name}', body: CANCELLED_GUEST_EN },
    pt: { subject: 'Reserva cancelada — {hotel_name}', body: CANCELLED_GUEST_PT },
  },
  reservation_cancelled_staff: {
    es: { subject: 'Cancelación web · {guest_name} — {hotel_name}', body: CANCELLED_STAFF_ES },
    en: { subject: 'Web cancellation · {guest_name} — {hotel_name}', body: CANCELLED_STAFF_EN },
    pt: { subject: 'Cancelamento web · {guest_name} — {hotel_name}', body: CANCELLED_STAFF_PT },
  },
  checkin_welcome: {
    es: { subject: '¡Bienvenido a {hotel_name}, {guest_name}!', body: CHECKIN_ES },
    en: { subject: 'Welcome to {hotel_name}, {guest_name}!', body: CHECKIN_EN },
    pt: { subject: 'Bem-vindo a {hotel_name}, {guest_name}!', body: CHECKIN_PT },
  },
  no_show: {
    es: { subject: 'Tu reserva en {hotel_name} — no realizada', body: NOSHOW_ES },
    en: { subject: 'Your booking at {hotel_name} — no-show', body: NOSHOW_EN },
    pt: { subject: 'A sua reserva em {hotel_name} — no-show', body: NOSHOW_PT },
  },
  checkout: {
    es: { subject: '¡Gracias por tu estancia en {hotel_name}!', body: CHECKOUT_ES },
    en: { subject: 'Thank you for your stay at {hotel_name}!', body: CHECKOUT_EN },
    pt: { subject: 'Obrigado pela sua estadia em {hotel_name}!', body: CHECKOUT_PT },
  },
  invoice: {
    es: { subject: 'Tu factura — {hotel_name}', body: INVOICE_ES },
    en: { subject: 'Your invoice — {hotel_name}', body: INVOICE_EN },
    pt: { subject: 'A sua fatura — {hotel_name}', body: INVOICE_PT },
  },
  reminder: {
    es: { subject: 'Recordatorio de tu llegada — {hotel_name}', body: REMINDER_ES },
    en: { subject: 'Your arrival reminder — {hotel_name}', body: REMINDER_EN },
    pt: { subject: 'Lembrete da sua chegada — {hotel_name}', body: REMINDER_PT },
  },
  checkin_link: {
    es: { subject: 'Completá tu check-in digital — {hotel_name}', body: CHECKIN_LINK_ES },
    en: { subject: 'Complete your digital check-in — {hotel_name}', body: CHECKIN_LINK_EN },
    pt: { subject: 'Complete o seu check-in digital — {hotel_name}', body: CHECKIN_LINK_PT },
  },
  payment_link: {
    es: { subject: 'Pago pendiente — {hotel_name}', body: PAYMENT_LINK_ES },
    en: { subject: 'Payment pending — {hotel_name}', body: PAYMENT_LINK_EN },
    pt: { subject: 'Pagamento pendente — {hotel_name}', body: PAYMENT_LINK_PT },
  },
  review_request: {
    es: { subject: '¿Cómo fue tu estadía en {hotel_name}?', body: REVIEW_ES },
    en: { subject: 'How was your stay at {hotel_name}?', body: REVIEW_EN },
    pt: { subject: 'Como foi a sua estadia em {hotel_name}?', body: REVIEW_PT },
  },
  reservation_new_staff: {
    es: { subject: '[{platform_name}] {title}', body: NEW_STAFF_ES },
    en: { subject: '[{platform_name}] {title}', body: NEW_STAFF_EN },
    pt: { subject: '[{platform_name}] {title}', body: NEW_STAFF_PT },
  },
  reservation_new_ota_staff: {
    es: { subject: '[{platform_name}] {title}', body: NEW_OTA_STAFF_ES },
    en: { subject: '[{platform_name}] {title}', body: NEW_OTA_STAFF_EN },
    pt: { subject: '[{platform_name}] {title}', body: NEW_OTA_STAFF_PT },
  },
  reservation_received_unpaid: {
    es: { subject: 'Recibimos tu pedido de reserva — {hotel_name}', body: RECEIVED_UNPAID_ES },
    en: { subject: 'We received your booking request — {hotel_name}', body: RECEIVED_UNPAID_EN },
    pt: { subject: 'Recebemos o seu pedido de reserva — {hotel_name}', body: RECEIVED_UNPAID_PT },
  },
  reservation_approved: {
    es: { subject: 'El hotel confirmó su reserva — {hotel_name}', body: APPROVED_ES },
    en: { subject: 'The hotel confirmed your booking — {hotel_name}', body: APPROVED_EN },
    pt: { subject: 'O hotel confirmou a sua reserva — {hotel_name}', body: APPROVED_PT },
  },
  reservation_rejected: {
    es: { subject: 'El hotel no pudo confirmar su reserva — {hotel_name}', body: REJECTED_ES },
    en: { subject: 'The hotel could not confirm your booking — {hotel_name}', body: REJECTED_EN },
    pt: { subject: 'O hotel não pôde confirmar a sua reserva — {hotel_name}', body: REJECTED_PT },
  },
}

/**
 * Devuelve el default de código para (event, language), con fallback a 'es'.
 * Lanza si el evento no existe (mejor ruidoso que email vacío).
 */
export function getCodeDefault(event: NotificationEvent, language: NotificationLanguage): NotificationDefault {
  const ev = NOTIFICATION_DEFAULTS[event]
  if (!ev) throw new Error(`notification-defaults: evento desconocido "${event}"`)
  const tmpl = ev[language] ?? ev.es
  if (!tmpl) throw new Error(`notification-defaults: sin default ni fallback "es" para "${event}"`)
  return tmpl
}
