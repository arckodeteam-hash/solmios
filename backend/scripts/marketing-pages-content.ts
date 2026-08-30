// marketing-pages-content.ts — Contenido de las páginas "producto"/"empresa" del sitio
// público (que-es-solmios, integraciones, sobre-nosotros, contacto). Fuente única: la
// importan tanto migrate-db.ts (seed insert-only del footer del sitio) como
// scripts/seed-marketing-pages.ts (que reemplaza el contenido si la página ya existe —
// mismo patrón que legal-pages-content.ts/seed-legal-pages.ts). Editar el contenido ACÁ,
// no en los dos lugares.
export interface MarketingPageSeed {
  slug: string
  title: string
  metaDescription: string
  category: 'producto' | 'empresa'
  sortOrder: number
  contentHtml: string
}

export const MARKETING_PAGES_SEED: MarketingPageSeed[] = [
  {
    slug: 'que-es-solmios', title: 'Qué es SolmiOS', category: 'producto', sortOrder: 1,
    metaDescription: 'SolmiOS es el sistema operativo hotelero para hoteles de LATAM: reservas, planning, canal de ventas, limpieza y facturación en una sola plataforma.',
    contentHtml: `<h2>El sistema operativo de tu hotel</h2>
<p>SolmiOS reúne en una sola plataforma todo lo que un hotel necesita para operar cada día: reservas, calendario de ocupación, ventas por canales, housekeeping, mantenimiento, facturación y reportes. Sin hojas de cálculos paralelas ni sistemas que no se hablan entre sí.</p>
<h2>Pensado para hoteles de Latinoamérica</h2>
<p>Nace de la operación real de hoteles de la región: temporadas de precio, walk-ins por WhatsApp, equipos de limpieza con evidencia fotográfica y control de presencia del supervisor. Todo en español y con los impuestos y monedas con los que trabajas a diario.</p>
<h2>Un solo panel, todo el hotel</h2>
<ul>
<li><strong>Planning y reservas:</strong> calendario visual por habitación con arrastrar y soltar, reagendado con recotización automática.</li>
<li><strong>Precios por temporada:</strong> tabla por tipo de habitación y ocupación, asignación de temporadas por fecha desde el planning.</li>
<li><strong>Operación:</strong> limpieza con evidencia y aprobación del supervisor, mantenimiento con proveedores y chat del equipo.</li>
<li><strong>Dinero:</strong> folios, facturas, caja, conciliación y reportes — una sola fuente de verdad para lo que entra y sale.</li>
</ul>
<h2>Empieza hoy</h2>
<p>Crea tu hotel en minutos y prueba el panel completo con datos de demostración. Cuando estés listo, conectas tus canales y empiezas a vender.</p>`,
  },
  {
    slug: 'integraciones', title: 'Integraciones', category: 'producto', sortOrder: 2,
    metaDescription: 'SolmiOS se conecta con Channex, TTLock, Stripe, WhatsApp y más: tu hotel sincronizado con los canales donde vendes.',
    contentHtml: `<h2>Conectado con tu ecosistema</h2>
<p>SolmiOS no es una isla: se integra con los servicios que tu hotel ya usa, para que cada reserva, pago y puerta trabajen solos.</p>
<h2>Canal de ventas</h2>
<p><strong>Channex</strong> sincroniza disponibilidad, precios y restricciones con Booking.com, Airbnb, Expedia y más. Cuando cambia una tarifa en tu tabla, se publica; cuando entra una reserva OTA, baja el inventario automáticamente.</p>
<h2>Cerraduras inteligentes</h2>
<p><strong>TTLock</strong> genera y envía códigos de acceso por habitación y reserva. El huésped recibe su código al confirmar, y el código expira al hacer el check-out — sin llaves físicas ni recepción 24/7.</p>
<h2>Pagos</h2>
<p><strong>Stripe</strong> para links de pago, señas y checkout del motor de reservas propio, con conciliación automática contra folios y facturas.</p>
<h2>Mensajería</h2>
<p><strong>WhatsApp Business</strong> y email transaccional para confirmaciones, códigos de acceso y mensajes automáticos de bienvenida.</p>
<p>¿Usas otro proveedor? La plataforma es API-first: hablamos con tu stack actual.</p>`,
  },
  {
    slug: 'sobre-nosotros', title: 'Sobre nosotros', category: 'empresa', sortOrder: 1,
    metaDescription: 'Conoce el equipo detrás de SolmiOS: construimos software hotelero simple y honesto para Latinoamérica.',
    contentHtml: `<h2>Software hotelero sin vueltas</h2>
<p>Construimos SolmiOS porque los hoteles de la región estaban atrapados entre sistemas corporativos carísimos y planillas de cálculo frágiles. Creemos que la tecnología de un hotel debería ser tan simple de operar como su recepción.</p>
<h2>Cómo trabajamos</h2>
<ul>
<li><strong>Cerca del usuario:</strong> cada funcionalidad nace de la operación diaria de hoteles reales, no de un paper.</li>
<li><strong>Producto antes que proyecto:</strong> lanzamos, medimos y corregimos. El sistema que usas hoy mejora todas las semanas.</li>
<li><strong>Datos de los dueños:</strong> tu información es tuya: exportable, respaldada y bajo tu control.</li>
</ul>
<h2>Nuestra promesa</h2>
<p>Un sistema que el equipo del hotel entienda en una tarde, que le ahorre horas todos los días y que no esconda la plata detrás de reportes ilegibles.</p>`,
  },
  {
    slug: 'contacto', title: 'Contacto', category: 'empresa', sortOrder: 2,
    metaDescription: 'Cómo contactar al equipo de SolmiOS: correo, teléfono, soporte desde el panel, ventas y demostraciones.',
    contentHtml: `<h2>Estamos a un mensaje de distancia</h2>
<h3>Escríbenos directamente</h3>
<p>Para ventas y demostraciones: <a href="mailto:ventas@solmios.com">ventas@solmios.com</a>. Para soporte técnico: <a href="mailto:soporte@solmios.com">soporte@solmios.com</a>. También puedes llamarnos al <a href="tel:+18094481444">+1 809-448-1444</a>.</p>
<h3>Ya eres cliente</h3>
<p>El camino más rápido es el soporte integrado: desde tu panel, sección <strong>Soporte</strong>, creas un ticket y lo sigue el mismo equipo que construye el producto. Respuesta prioritaria según tu plan.</p>
<h3>Quieres ver el sistema</h3>
<p>Regístrate desde la página principal y prueba el panel completo con el hotel de demostración: reservas, planning, limpieza y facturación con datos de ejemplo. Si quieres una recorrida guiada con alguien del equipo, solicítala escribiendo a <a href="mailto:ventas@solmios.com">ventas@solmios.com</a>.</p>
<h3>Alianzas e integraciones</h3>
<p>¿Operas un canal, un PMS legacy o un servicio para hoteles? Escríbenos a <a href="mailto:soporte@solmios.com">soporte@solmios.com</a> para conversar sobre integraciones.</p>`,
  },
]
