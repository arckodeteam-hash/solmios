// shared/usecases/channel-request-email-templates.ts — Los 3 correos que el hotel recibe por su
// pedido de conexión de una OTA (REQ-CAN-07).
//
// El texto vive acá y NO adentro del seeder porque lo consumen dos lados: el seeder
// (`scripts/seed-platform-email-templates.ts`, que los inserta en `platform_email_templates` para
// que el super-admin pueda editarlos) y el test que verifica que renderizan sin dejar un
// `{placeholder}` colgado.
//
// El nombre de la plataforma NO se escribe: es `{platform_name}` y lo resuelve el envío desde
// Configuración → Plataforma (`shared/utils/platform-identity.ts`). Una plantilla con "SolmiOS"
// adentro convierte el campo "Nombre de la Plataforma" del panel en decoración.

export interface ChannelRequestEmailTemplate {
  event: string
  subject: string
  body: string
  variables: string[]
}

// Mismo botón que el resto de los correos de plataforma (fondo #0a1322): que se vean parte de un
// mismo producto y no tres correos de tres sistemas distintos.
function ctaButton(link: string, label: string): string {
  return `<p><a href="${link}" style="background:#0a1322;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold">${label}</a></p>`
}

export const CHANNEL_REQUEST_EMAIL_TEMPLATES: ChannelRequestEmailTemplate[] = [
  {
    event: 'channel_request_scheduled',
    subject: 'Coordinamos la conexión de {channel_name}: {appointment_date}',
    body: `<p>Hola,</p>
<p>Recibimos el pedido de <strong>{hotel_name}</strong> para conectar <strong>{channel_name}</strong>.</p>
<p>Te vamos a contactar el <strong>{appointment_date}</strong> a las <strong>{appointment_time}</strong>
por <strong>{appointment_medium}</strong>. Del lado nuestro te atiende {contact_name}.</p>
<p>Tené a mano el usuario y la contraseña de tu extranet de {channel_name}: sin eso no se puede
completar la conexión en la llamada.</p>
${ctaButton('{link}', 'Ver mis canales')}
<p>Si esa fecha no te sirve, respondé este correo o escribinos a {support_email} y la movemos.</p>
<p>{platform_name}</p>`,
    variables: ['hotel_name', 'channel_name', 'appointment_date', 'appointment_time', 'appointment_medium', 'contact_name', 'link'],
  },
  {
    event: 'channel_request_connected',
    subject: '{channel_name} ya está conectado a {hotel_name}',
    body: `<p>Hola,</p>
<p>Listo: <strong>{channel_name}</strong> quedó conectado a <strong>{hotel_name}</strong>.</p>
<p>Desde ahora tus precios y tu disponibilidad se publican solos en ese canal, y las reservas que
entren por ahí van a aparecer en tu panel sin que tengas que cargarlas a mano.</p>
${ctaButton('{link}', 'Ver mis canales')}
<p>Revisá los primeros días que las tarifas se vean como esperás. Ante cualquier duda escribinos a
{support_email}.</p>
<p>{platform_name}</p>`,
    variables: ['hotel_name', 'channel_name', 'link'],
  },
  {
    event: 'channel_request_rejected',
    subject: 'Sobre tu pedido para conectar {channel_name}',
    body: `<p>Hola,</p>
<p>Revisamos el pedido de <strong>{hotel_name}</strong> para conectar <strong>{channel_name}</strong> y por
ahora no lo pudimos completar.</p>
<p><strong>Motivo:</strong> {reason}</p>
<p>Esto no cierra la puerta: apenas se resuelva, volvé a pedir la conexión desde tu panel y lo
retomamos.</p>
${ctaButton('{link}', 'Ir a mis canales')}
<p>Si querés que lo veamos juntos, escribinos a {support_email}.</p>
<p>{platform_name}</p>`,
    variables: ['hotel_name', 'channel_name', 'reason', 'link'],
  },
]
