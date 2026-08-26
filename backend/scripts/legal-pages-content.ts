// legal-pages-content.ts — Contenido de las 3 páginas legales del sitio público,
// transcripto de los documentos fuente en frontend/ (POLITICA DE PRIVACIDAD.docx,
// TERMINOS Y CONDICIONES.docx, ELIMINACION DE DATOS.docx — última actualización
// 10 de agosto de 2026). Fuente única: la importan tanto migrate-db.ts (seed
// insert-only del footer del sitio) como scripts/seed-legal-pages.ts (que
// reemplaza el contenido si la página ya existe). Editar el contenido legal
// ACÁ, no en los dos lugares.
export interface LegalPageSeed {
  slug: string
  title: string
  metaDescription: string
  category: 'legal'
  sortOrder: number
  contentHtml: string
}

export const LEGAL_PAGES_SEED: LegalPageSeed[] = [
  {
    slug: 'terminos', title: 'Términos y Condiciones de Uso', category: 'legal', sortOrder: 1,
    metaDescription: 'Términos y condiciones de SOLMI OS: qué es el servicio, el asistente automatizado, reservas y pagos, uso aceptable y responsabilidad.',
    contentHtml: `<p><em>SOLMI OS, S.R.L. · RNC 133-78277-4 · Santo Domingo Este, República Dominicana<br>Última actualización: 25 de agosto de 2026</em></p>
<h2>1. Aceptación</h2>
<p>Al usar SOLMI OS —ya sea escribiéndonos por WhatsApp, Instagram o Facebook, navegando nuestro sitio, o accediendo al panel de gestión— aceptas estos términos. Si no estás de acuerdo, por favor no uses el servicio.</p>
<h2>2. Quién presta el servicio</h2>
<p>SOLMI OS, S.R.L., sociedad de responsabilidad limitada dominicana, RNC 133-78277-4, inscrita en el Registro Mercantil de la Cámara de Comercio y Producción de Provincia Santo Domingo bajo el número 207146PSD, con domicilio social en Calle Carmelitas No. 9, Ensanche Ozama, Santo Domingo Este, Provincia Santo Domingo, República Dominicana.</p>
<p>Opera bajo el nombre comercial SOLMI OS, registrado ante ONAPI con el número 941808.</p>
<h2>3. Qué es SOLMI OS</h2>
<p>SOLMI OS es una plataforma de gestión hotelera que ofrece:</p>
<ul>
<li>Gestión de reservas, habitaciones, tarifas y disponibilidad</li>
<li>Conexión con canales de venta (Booking, Airbnb, Expedia y otros)</li>
<li>Gestión de restaurante, inventario, compras y finanzas</li>
<li>Módulo de operaciones: limpieza, mantenimiento, asistencia del personal y comunicación interna</li>
<li>Asistente de atención automatizada por WhatsApp, Instagram y Facebook</li>
</ul>
<h2>4. Dos tipos de usuario</h2>
<p>Estos términos aplican de forma distinta según quién seas:</p>
<h3>4.1 Establecimientos clientes</h3>
<p>Hoteles, restaurantes y negocios que contratan SOLMI OS para gestionar su operación. Su relación se rige además por el contrato de servicio firmado.</p>
<h3>4.2 Huéspedes y público general</h3>
<p>Personas que interactúan con el asistente automatizado o reservan a través de los canales de un establecimiento cliente.</p>
<p><strong>Importante para huéspedes:</strong> el contrato de hospedaje, consumo o servicio se celebra directamente con el establecimiento, no con SOLMI OS. SOLMI OS es la herramienta tecnológica que facilita la comunicación y la gestión.</p>
<h2>5. El asistente automatizado</h2>
<ul>
<li>Una parte de las respuestas se genera mediante inteligencia artificial.</li>
<li>El asistente puede tomar tus datos, crear reservas, enviarte confirmaciones, códigos de acceso y enlaces de pago.</li>
<li>Puede cometer errores. Ninguna respuesta automatizada constituye una oferta vinculante hasta que el establecimiento la confirme.</li>
<li>Ante cualquier discrepancia entre lo que dijo el asistente y lo que confirma el establecimiento, prevalece la confirmación del establecimiento.</li>
<li>Siempre puedes solicitar atención humana.</li>
</ul>
<h2>6. Reservas y pagos</h2>
<ul>
<li>Las tarifas, disponibilidad, políticas de cancelación y condiciones de cada reserva las define el establecimiento, no SOLMI OS.</li>
<li>Los pagos se procesan mediante pasarelas externas. SOLMI OS no almacena datos completos de tarjetas.</li>
<li>Los reclamos por cobros, reembolsos, cancelaciones o calidad del servicio deben dirigirse al establecimiento.</li>
</ul>
<h2>7. Uso aceptable</h2>
<p>Al usar SOLMI OS te comprometes a no:</p>
<ul>
<li>Suplantar la identidad de otra persona o entidad</li>
<li>Enviar contenido ilegal, ofensivo, difamatorio o que vulnere derechos de terceros</li>
<li>Usar el servicio para enviar spam o comunicaciones masivas no solicitadas</li>
<li>Intentar acceder sin autorización a cuentas, datos o sistemas</li>
<li>Realizar ingeniería inversa, copiar o revender la plataforma</li>
<li>Interferir con el funcionamiento del servicio mediante automatizaciones, sobrecarga o cualquier medio técnico</li>
</ul>
<p>El incumplimiento puede resultar en la suspensión inmediata del acceso.</p>
<h2>8. Reglas de las plataformas de Meta</h2>
<p>El uso de los canales de WhatsApp, Instagram y Facebook está sujeto además a las políticas de Meta Platforms, Inc., incluidas la Política Comercial de WhatsApp y las Condiciones de las Herramientas Empresariales de Meta. SOLMI OS puede suspender el servicio de mensajería si Meta restringe la cuenta.</p>
<h2>9. Propiedad intelectual</h2>
<p>El software, la marca SOLMI OS, su logotipo, diseño e identidad visual están protegidos por la Ley 20-00 sobre Propiedad Industrial. El nombre comercial figura registrado a nombre de Leonardo Batista Soliman y su uso corresponde a SOLMI OS, S.R.L. El registro del nombre comercial ante ONAPI (No. 941808) confiere protección por diez años desde el 13 de julio de 2026.</p>
<p>Los datos y contenidos que cada establecimiento carga en la plataforma siguen siendo propiedad del establecimiento.</p>
<h2>10. Disponibilidad del servicio</h2>
<p>Procuramos mantener el servicio disponible de forma continua, pero no garantizamos que esté libre de interrupciones. Pueden ocurrir cortes por mantenimiento programado, fallas de proveedores externos (incluidos Meta y las pasarelas de pago) o causas de fuerza mayor.</p>
<h2>11. Limitación de responsabilidad</h2>
<p>En la máxima medida permitida por la ley dominicana, SOLMI OS no responde por:</p>
<ul>
<li>Actos, omisiones, tarifas o incumplimientos del establecimiento</li>
<li>Interrupciones causadas por proveedores externos</li>
<li>Pérdidas indirectas, lucro cesante o daño reputacional</li>
<li>Errores derivados de datos incorrectos suministrados por el usuario</li>
</ul>
<p>Nada en esta cláusula limita la responsabilidad que por ley no puede excluirse, incluidos los derechos que otorga la Ley 358-05 de Protección de los Derechos del Consumidor.</p>
<h2>12. Privacidad</h2>
<p>El tratamiento de datos personales se rige por nuestra <a href="/p/privacidad">Política de Privacidad</a>, que forma parte integrante de estos términos.</p>
<h2>13. Modificaciones</h2>
<p>Podemos actualizar estos términos. La versión vigente será siempre la publicada en esta página, con su fecha de actualización. Los cambios sustanciales se notificarán con treinta (30) días de anticipación a los establecimientos clientes.</p>
<h2>14. Terminación</h2>
<p>Puedes dejar de usar el servicio cuando quieras. Los establecimientos clientes se rigen por los plazos de su contrato. Podemos suspender el acceso ante incumplimiento grave de estos términos.</p>
<h2>15. Ley aplicable y jurisdicción</h2>
<p>Estos términos se rigen por las leyes de la República Dominicana. Cualquier controversia se someterá a los tribunales competentes del Distrito Nacional, con renuncia expresa a cualquier otro fuero.</p>
<h2>16. Contacto</h2>
<p>SOLMI OS, S.R.L. — RNC 133-78277-4<br>Calle Carmelitas No. 9, Ensanche Ozama, Santo Domingo Este, Provincia Santo Domingo, República Dominicana<br>soporte@solmios.com · +1 809-448-1444<br>https://www.solmios.com</p>`,
  },
  {
    slug: 'privacidad', title: 'Política de Privacidad', category: 'legal', sortOrder: 2,
    metaDescription: 'Política de privacidad de SOLMI OS: qué datos recogemos por WhatsApp/Instagram/Facebook y reservas, para qué los usamos y tus derechos bajo la Ley 172-13.',
    contentHtml: `<p><em>SOLMI OS, S.R.L. · RNC 133-78277-4 · Santo Domingo Este, República Dominicana<br>Última actualización: 25 de agosto de 2026</em></p>
<h2>1. Quiénes somos</h2>
<p>SOLMI OS, S.R.L. es una sociedad de responsabilidad limitada constituida conforme a las leyes de la República Dominicana, que opera bajo el nombre comercial SOLMI OS, registrado ante la Oficina Nacional de la Propiedad Industrial (ONAPI) con el número 941808.</p>
<ul>
<li><strong>Responsable del tratamiento:</strong> SOLMI OS, S.R.L.</li>
<li><strong>RNC:</strong> 133-78277-4</li>
<li><strong>Registro Mercantil:</strong> 207146PSD — Cámara de Comercio y Producción de Provincia Santo Domingo</li>
<li><strong>Domicilio:</strong> Calle Carmelitas No. 9, Ensanche Ozama, Santo Domingo Este, Provincia Santo Domingo, República Dominicana</li>
<li><strong>Correo de contacto:</strong> privacidad@solmios.com</li>
<li><strong>Teléfono:</strong> +1 809-448-1444</li>
<li><strong>Sitio web:</strong> https://www.solmios.com</li>
</ul>
<p>SOLMI OS es una plataforma de gestión hotelera (PMS) que incluye un asistente de atención automatizada por WhatsApp, Instagram y Facebook Messenger.</p>
<h2>2. Qué es esta política</h2>
<p>Este documento explica qué datos personales recogemos, para qué los usamos, con quién los compartimos, cuánto tiempo los conservamos y qué derechos tienes sobre ellos. Aplica a todas las personas que interactúan con SOLMI OS: huéspedes de los hoteles que usan nuestra plataforma, personal de esos hoteles, y visitantes de nuestro sitio web.</p>
<p>Se rige por la Ley No. 172-13 sobre Protección de Datos Personales de la República Dominicana.</p>
<h2>3. Qué datos recogemos</h2>
<h3>3.1 Cuando nos escribes por WhatsApp, Instagram o Facebook</h3>
<ul>
<li>Tu número de teléfono o identificador de usuario de la red social</li>
<li>Tu nombre de perfil o el nombre que nos proporciones</li>
<li>El contenido de los mensajes que envías y que te enviamos, incluidas imágenes, audios y documentos adjuntos</li>
<li>La fecha y hora de cada mensaje y su estado de entrega y lectura</li>
</ul>
<h3>3.2 Cuando haces una reserva</h3>
<ul>
<li>Nombre completo y documento de identidad o pasaporte</li>
<li>Correo electrónico y teléfono</li>
<li>Fechas de estadía, tipo de habitación y preferencias declaradas</li>
<li>Datos de acompañantes, cuando los proporcionas</li>
<li>Historial de reservas y consumos en el establecimiento</li>
</ul>
<h3>3.3 Cuando pagas</h3>
<p>Los pagos se procesan a través de pasarelas de pago externas. SOLMI OS no almacena números completos de tarjeta, códigos de seguridad (CVV) ni credenciales bancarias. Solo conservamos la confirmación de la transacción, el monto, la fecha y los últimos cuatro dígitos del medio de pago.</p>
<h3>3.4 Datos técnicos</h3>
<p>Dirección IP, tipo de dispositivo y navegador, y páginas visitadas dentro de nuestro sitio.</p>
<h2>4. Para qué usamos tus datos</h2>
<ul>
<li><strong>Responder tus mensajes y consultas, incluso de forma automatizada</strong> — base legal: ejecución de la relación contractual y consentimiento.</li>
<li><strong>Crear, modificar y confirmar tus reservas de hotel y restaurante</strong> — base legal: ejecución del contrato.</li>
<li><strong>Enviarte confirmaciones, códigos de acceso, instrucciones de llegada y enlaces de pago</strong> — base legal: ejecución del contrato.</li>
<li><strong>Notificar al hotel sobre tu solicitud o cotización</strong> — base legal: interés legítimo del establecimiento.</li>
<li><strong>Enviarte ofertas y promociones</strong> — base legal: solo con tu consentimiento previo y expreso.</li>
<li><strong>Cumplir obligaciones legales, fiscales y de registro de huéspedes</strong> — base legal: obligación legal.</li>
<li><strong>Mejorar la calidad del servicio y del asistente automatizado</strong> — base legal: interés legítimo.</li>
</ul>
<h2>5. Uso de inteligencia artificial</h2>
<p>Una parte de nuestras respuestas es generada por sistemas automatizados de inteligencia artificial. Esto significa que:</p>
<ul>
<li>Es posible que la primera respuesta que recibas no provenga de una persona.</li>
<li>Siempre puedes pedir hablar con una persona real escribiendo "quiero hablar con una persona" o similar, y tu conversación será transferida al personal del establecimiento.</li>
<li>Ninguna decisión con efectos legales o económicos significativos sobre ti (como el cobro de una penalidad o el rechazo de una reserva confirmada) se toma de forma exclusivamente automatizada sin revisión humana.</li>
</ul>
<h2>6. Con quién compartimos tus datos</h2>
<p>Compartimos datos únicamente con quien es necesario para prestarte el servicio:</p>
<ul>
<li>El establecimiento hotelero donde te hospedas o al que consultas. Cada hotel accede solamente a los datos de sus propios huéspedes.</li>
<li>Meta Platforms, Inc. — al usar WhatsApp Business Platform, Instagram Messaging API y Messenger Platform, los mensajes transitan por la infraestructura de Meta y se rigen además por sus propias políticas.</li>
<li>Proveedores de pago para procesar transacciones.</li>
<li>Proveedores de infraestructura tecnológica (alojamiento en la nube y servicios de inteligencia artificial), bajo acuerdos de confidencialidad.</li>
<li>Autoridades competentes, cuando exista una obligación legal.</li>
</ul>
<p><strong>No vendemos tus datos personales a terceros. Nunca.</strong></p>
<h2>7. Transferencias internacionales</h2>
<p>Algunos de nuestros proveedores están ubicados fuera de la República Dominicana. En esos casos exigimos garantías contractuales de protección equivalentes a las que establece la Ley 172-13.</p>
<h2>8. Cuánto tiempo conservamos tus datos</h2>
<ul>
<li><strong>Conversaciones de mensajería:</strong> 24 meses desde el último mensaje.</li>
<li><strong>Datos de reserva y estadía:</strong> 10 años, por obligación fiscal y de registro hotelero.</li>
<li><strong>Datos de pago (comprobantes):</strong> 10 años, por obligación fiscal.</li>
<li><strong>Datos de marketing:</strong> hasta que retires tu consentimiento.</li>
<li><strong>Datos técnicos y de navegación:</strong> 12 meses.</li>
</ul>
<p>Cumplido el plazo, los datos se eliminan o se anonimizan de forma irreversible.</p>
<h2>9. Tus derechos</h2>
<p>Tienes derecho a:</p>
<ul>
<li>Acceder a los datos que tenemos sobre ti</li>
<li>Rectificar los datos inexactos o incompletos</li>
<li>Solicitar la eliminación de tus datos</li>
<li>Oponerte al tratamiento o limitarlo</li>
<li>Retirar tu consentimiento en cualquier momento</li>
<li>Portabilidad: recibir tus datos en un formato legible</li>
<li>Presentar una reclamación ante la autoridad competente</li>
</ul>
<p>Para ejercerlos, escríbenos a privacidad@solmios.com. Responderemos en un plazo máximo de quince (15) días hábiles.</p>
<p>Para eliminar tus datos, consulta también nuestra página de <a href="/p/eliminacion-datos">Eliminación de Datos</a>.</p>
<h2>10. Cómo protegemos tus datos</h2>
<ul>
<li>Cifrado en tránsito (HTTPS/TLS) y en reposo</li>
<li>Control de acceso por roles: cada persona del hotel ve únicamente lo que le corresponde a su función</li>
<li>Registro de auditoría de los accesos a datos sensibles</li>
<li>Copias de seguridad periódicas</li>
<li>Verificación en dos pasos para las cuentas administrativas</li>
</ul>
<h2>11. Menores de edad</h2>
<p>SOLMI OS no está dirigido a menores de 18 años. Los datos de menores que se hospedan solo se recogen a través de su padre, madre o tutor responsable de la reserva.</p>
<h2>12. Cambios a esta política</h2>
<p>Publicaremos cualquier modificación en esta misma página con su fecha de actualización. Si el cambio es sustancial, te lo notificaremos por los medios de contacto que tengamos registrados.</p>
<h2>13. Contacto</h2>
<p>SOLMI OS, S.R.L. — RNC 133-78277-4<br>Calle Carmelitas No. 9, Ensanche Ozama, Santo Domingo Este, Provincia Santo Domingo, República Dominicana<br>privacidad@solmios.com · +1 809-448-1444<br>https://www.solmios.com</p>`,
  },
  {
    slug: 'eliminacion-datos', title: 'Eliminación de Datos', category: 'legal', sortOrder: 3,
    metaDescription: 'Cómo pedir la eliminación de tus datos personales de SOLMI OS: tres formas de solicitarlo, plazos y qué información estamos obligados a conservar.',
    contentHtml: `<p><em>SOLMI OS, S.R.L. · RNC 133-78277-4 · Santo Domingo Este, República Dominicana<br>Última actualización: 25 de agosto de 2026</em></p>
<h2>Tienes derecho a que borremos tus datos</h2>
<p>Si alguna vez nos escribiste por WhatsApp, Instagram o Facebook, o hiciste una reserva a través de SOLMI OS, puedes pedirnos que eliminemos tu información personal. Es tu derecho bajo la Ley No. 172-13 de la República Dominicana y no tienes que dar explicaciones.</p>
<p>Para saber qué datos recogemos y para qué los usamos antes de pedir la eliminación, consulta nuestra <a href="/p/privacidad">Política de Privacidad</a> y nuestros <a href="/p/terminos">Términos y Condiciones</a>.</p>
<h2>Cómo pedirlo — tres formas</h2>
<h3>1. Por el formulario web (la más rápida)</h3>
<p>Llena el formulario que está al final de esta misma página (<a href="#formulario-eliminacion-datos">https://www.solmios.com/p/eliminacion-datos</a>) con:</p>
<ul>
<li>Tu nombre completo</li>
<li>El número de teléfono o usuario con el que nos escribiste</li>
<li>El hotel o establecimiento con el que interactuaste, si lo recuerdas</li>
</ul>
<h3>2. Por correo electrónico</h3>
<p>Escribe a privacidad@solmios.com con el asunto "Eliminación de datos" e incluye los mismos datos de arriba.</p>
<h3>3. Por WhatsApp</h3>
<p>Escribe la palabra <strong>ELIMINAR MIS DATOS</strong> al mismo número por el que nos contactaste. El sistema abrirá tu solicitud automáticamente.</p>
<h2>Qué pasa después</h2>
<ul>
<li><strong>1. Recibes un acuse de recibo con un número de solicitud</strong> — máximo 48 horas.</li>
<li><strong>2. Verificamos tu identidad para proteger tu cuenta</strong> — 1 a 3 días hábiles.</li>
<li><strong>3. Eliminamos tus datos y te confirmamos por escrito</strong> — máximo 15 días hábiles desde la verificación.</li>
</ul>
<p>Todo el proceso toma como máximo 30 días naturales.</p>
<h2>Qué se elimina</h2>
<ul>
<li>Todo el historial de conversaciones por WhatsApp, Instagram y Facebook</li>
<li>Tu nombre, teléfono, correo e identificadores de perfil</li>
<li>Tus preferencias y notas de huésped</li>
<li>Tu perfil de contacto en nuestra base de datos</li>
</ul>
<h2>Qué NO podemos eliminar, y por qué</h2>
<p>La ley dominicana nos obliga a conservar cierta información aunque tú pidas su eliminación:</p>
<ul>
<li><strong>Comprobantes fiscales y facturas</strong> — Código Tributario y normativa de la DGII — 10 años.</li>
<li><strong>Registro de huéspedes hospedados</strong> — normativa de registro hotelero — 10 años.</li>
<li><strong>Registros de transacciones de pago</strong> — prevención de fraude y obligación contable — 10 años.</li>
</ul>
<p>Estos datos quedan bloqueados: no se usan para ninguna otra finalidad, no se comparten y solo se conservan a disposición de las autoridades. Cumplido el plazo legal, se eliminan de forma definitiva.</p>
<h2>Datos que están en Meta</h2>
<p>Los mensajes que enviaste también pasaron por los servidores de Meta Platforms, Inc. (WhatsApp, Instagram, Facebook). Nosotros eliminamos nuestra copia, pero la copia que guarda Meta se rige por sus propias políticas. Para pedirle a Meta que elimine tus datos, debes hacerlo directamente en la configuración de tu cuenta de Facebook, Instagram o WhatsApp.</p>
<h2>Si eres un establecimiento cliente</h2>
<p>Si tu hotel o negocio deja de usar SOLMI OS y quieres que eliminemos toda la información de tu operación:</p>
<ol>
<li>Escribe a soporte@solmios.com desde el correo del administrador registrado.</li>
<li>Te entregamos una exportación completa de tus datos en formato legible antes de borrar nada.</li>
<li>Conservamos la información 90 días después de la baja, por si necesitas recuperarla o cambias de opinión.</li>
<li>Pasados esos 90 días, se elimina de forma irreversible, salvo lo que la ley obligue a conservar.</li>
</ol>
<h2>¿Problemas?</h2>
<p>Si no recibes respuesta en los plazos indicados, o no estás conforme con lo que hicimos, puedes presentar una reclamación ante la autoridad competente en materia de protección de datos de la República Dominicana.</p>
<h2>Contacto</h2>
<p>SOLMI OS, S.R.L. — RNC 133-78277-4<br>Calle Carmelitas No. 9, Ensanche Ozama, Santo Domingo Este, Provincia Santo Domingo, República Dominicana<br>privacidad@solmios.com · +1 809-448-1444</p>`,
  },
]
