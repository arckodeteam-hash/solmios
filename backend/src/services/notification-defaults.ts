// services/notification-defaults.ts — Plantillas base de notificaciones por evento × idioma.
//
// Fuente de verdad de los defaults de email (NO se seedean en DB). El override del hotel
// vive en auto_messages; este archivo es el fallback. Versionado con git, testeable sin DB.
// Las variables {key} se interpolan con renderTemplate() de email-service (6.1.2).

export type NotificationEvent = 'reservation_confirmed' | 'reservation_presale' | 'checkin_welcome' | 'no_show' | 'checkout' | 'invoice' | 'reminder' | 'payment_link' | 'review_request'
export type NotificationLanguage = 'es' | 'en' | 'pt'

export interface NotificationDefault {
  /** Asunto del email (con placeholders {key}). */
  subject: string
  /** Cuerpo HTML del email (con placeholders {key}). */
  body: string
}

// ─── reservation_confirmed ──────────────────────────────────────────────────

const CONFIRMED_ES = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:24px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">Confirmación de Reserva</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Hola <strong>{guest_name}</strong>,</p>
    <p>Tu reserva ha sido confirmada. Aquí tienes los detalles:</p>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <table style="width:100%;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;">Precio por noche</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{room_base_price}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-in</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkin_date} · {checkin_time}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-out</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkout_date} · {checkout_time}</td></tr>
        <tr><td colspan="2" style="padding:12px 0 4px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Gestión del pago</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Forma de pago</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{payment_method}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Anticipo</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{deposit_amount}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Pendiente</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{pending_amount}</td></tr>
        <tr><td style="padding:6px 0;border-top:2px solid #e5e7eb;color:#1a2b4c;font-weight:bold;">Total</td><td style="padding:6px 0;border-top:2px solid #e5e7eb;font-weight:bold;text-align:right;font-size:18px;color:#1a2b4c;">{total_amount}</td></tr>
      </table>
    </div>
    <p style="font-size:13px;color:#6b7280;">Localizador: <strong>{locator}</strong></p>
    <div style="background:white;border-radius:8px;padding:14px;margin:16px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 6px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Política de cancelación</p>
      <p style="margin:0;font-size:13px;color:#4b5563;">{cancellation_policy}</p>
    </div>
    <div style="background:white;border-radius:8px;padding:14px;margin:16px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 6px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Cómo llegar</p>
      <p style="margin:0;font-size:13px;color:#4b5563;">{hotel_address}</p>
      <p style="margin:6px 0 0;font-size:13px;color:#4b5563;">Tel: <strong>{hotel_phone}</strong> · {hotel_email}</p>
    </div>
    <p style="font-size:13px;color:#6b7280;">Te mandamos tu habitación y el código de acceso el día antes de llegar.</p>
    <p style="font-size:13px;color:#6b7280;">¡Te esperamos!</p>
  </div>
</body>
</html>`

const CONFIRMED_EN = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:24px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">Booking Confirmation</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Hi <strong>{guest_name}</strong>,</p>
    <p>Your booking has been confirmed. Here are the details:</p>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <table style="width:100%;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;">Price per night</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{room_base_price}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-in</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkin_date} · {checkin_time}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-out</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkout_date} · {checkout_time}</td></tr>
        <tr><td colspan="2" style="padding:12px 0 4px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Payment</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Payment method</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{payment_method}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Deposit</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{deposit_amount}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Pending</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{pending_amount}</td></tr>
        <tr><td style="padding:6px 0;border-top:2px solid #e5e7eb;color:#1a2b4c;font-weight:bold;">Total</td><td style="padding:6px 0;border-top:2px solid #e5e7eb;font-weight:bold;text-align:right;font-size:18px;color:#1a2b4c;">{total_amount}</td></tr>
      </table>
    </div>
    <p style="font-size:13px;color:#6b7280;">Booking ref: <strong>{locator}</strong></p>
    <div style="background:white;border-radius:8px;padding:14px;margin:16px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 6px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Cancellation policy</p>
      <p style="margin:0;font-size:13px;color:#4b5563;">{cancellation_policy}</p>
    </div>
    <div style="background:white;border-radius:8px;padding:14px;margin:16px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 6px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Getting there</p>
      <p style="margin:0;font-size:13px;color:#4b5563;">{hotel_address}</p>
      <p style="margin:6px 0 0;font-size:13px;color:#4b5563;">Phone: <strong>{hotel_phone}</strong> · {hotel_email}</p>
    </div>
    <p style="font-size:13px;color:#6b7280;">We'll send your room number and access code the day before you arrive.</p>
    <p style="font-size:13px;color:#6b7280;">We look forward to welcoming you!</p>
  </div>
</body>
</html>`

const CONFIRMED_PT = `<!DOCTYPE html>
<html lang="pt">
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:24px;">🏨 {hotel_name}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">Confirmação de Reserva</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Olá <strong>{guest_name}</strong>,</p>
    <p>A sua reserva foi confirmada. Aqui estão os detalhes:</p>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <table style="width:100%;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;">Preço por noite</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{room_base_price}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-in</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkin_date} · {checkin_time}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-out</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{checkout_date} · {checkout_time}</td></tr>
        <tr><td colspan="2" style="padding:12px 0 4px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Gestão do pagamento</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Forma de pagamento</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{payment_method}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Sinal</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{deposit_amount}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Pendente</td><td style="padding:6px 0;font-weight:bold;text-align:right;">{pending_amount}</td></tr>
        <tr><td style="padding:6px 0;border-top:2px solid #e5e7eb;color:#1a2b4c;font-weight:bold;">Total</td><td style="padding:6px 0;border-top:2px solid #e5e7eb;font-weight:bold;text-align:right;font-size:18px;color:#1a2b4c;">{total_amount}</td></tr>
      </table>
    </div>
    <p style="font-size:13px;color:#6b7280;">Localizador: <strong>{locator}</strong></p>
    <div style="background:white;border-radius:8px;padding:14px;margin:16px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 6px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Política de cancelamento</p>
      <p style="margin:0;font-size:13px;color:#4b5563;">{cancellation_policy}</p>
    </div>
    <div style="background:white;border-radius:8px;padding:14px;margin:16px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 6px;color:#1a2b4c;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Como chegar</p>
      <p style="margin:0;font-size:13px;color:#4b5563;">{hotel_address}</p>
      <p style="margin:6px 0 0;font-size:13px;color:#4b5563;">Tel: <strong>{hotel_phone}</strong> · {hotel_email}</p>
    </div>
    <p style="font-size:13px;color:#6b7280;">Enviamos o seu quarto e o código de acesso no dia anterior à chegada.</p>
    <p style="font-size:13px;color:#6b7280;">Esperamos por si!</p>
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

export const NOTIFICATION_DEFAULTS: Record<NotificationEvent, Partial<Record<NotificationLanguage, NotificationDefault>>> = {
  reservation_confirmed: {
    es: { subject: 'Confirmación de reserva — {hotel_name}', body: CONFIRMED_ES },
    en: { subject: 'Booking confirmation — {hotel_name}', body: CONFIRMED_EN },
    pt: { subject: 'Confirmação de reserva — {hotel_name}', body: CONFIRMED_PT },
  },
  reservation_presale: {
    es: { subject: 'Reserva pendiente de pago — {hotel_name}', body: PRESALE_ES },
    en: { subject: 'Booking pending payment — {hotel_name}', body: PRESALE_EN },
    pt: { subject: 'Reserva pendente de pagamento — {hotel_name}', body: PRESALE_PT },
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
