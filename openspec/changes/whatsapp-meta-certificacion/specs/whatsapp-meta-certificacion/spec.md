# SPEC: Certificación de la app de WhatsApp ante Meta

Cubre la parte no funcional de la aprobación. No agrega funcionalidad: fija el estado que el sistema y
el entorno **deben** tener para poder solicitar la revisión.

## REQ-1: El servidor de producción tiene el secreto de la app

El sistema **MUST** poder validar la firma de los webhooks de Meta en producción.

### Scenarios

#### Scenario: Webhook con el secreto cargado
- **Given** `WHATSAPP_APP_SECRET` definido en el entorno de producción
- **When** Meta entrega un webhook firmado
- **Then** **MUST** validarse la firma y procesarse el mensaje

#### Scenario: Secreto ausente
- **Given** el entorno sin el secreto
- **When** llega un webhook
- **Then** **MUST** rechazarse (comportamiento actual: puerta cerrada)
- **And** el arranque del servidor **MUST** advertirlo por log, del mismo modo que hoy advierte que el
  captcha del alta está desactivado

#### Scenario: Documentación del entorno
- **Given** un despliegue nuevo desde el repositorio
- **When** se lee `backend/.env.example`
- **Then** **MUST** figurar `META_APP_ID`, `META_APP_SECRET`, `META_GRAPH_VERSION` y
  `WHATSAPP_APP_SECRET` con una nota de dónde se obtienen

---

## REQ-2: La vía no oficial no es alcanzable durante la revisión

El sistema **MUST NOT** ofrecer la vinculación por código QR (Baileys) en el hotel que va a revisar Meta.

#### Scenario: Hotel con conexión oficial
- **Given** un hotel con `connectionMode='meta'`
- **When** un usuario abre Recepcionista IA → Configuración
- **Then** la pestaña de vinculación por QR **MUST NOT** mostrarse
- **And** **MUST** verse, en su lugar, el estado de la conexión oficial

#### Scenario: Hotel de prueba del revisor
- **Given** el hotel creado para la revisión de Meta
- **When** el revisor navega por todo el panel
- **Then** **MUST NOT** encontrar ningún punto de entrada a la vinculación por QR

#### Scenario: Hoteles que ya la usan
- **Given** un hotel con `connectionMode='baileys'` y credenciales vigentes
- **When** se aplica este change
- **Then** su conexión **MUST** seguir funcionando — este change no los desconecta

---

## REQ-3: Entorno de prueba sin datos reales

El sistema **MUST** ofrecerle al revisor un hotel con datos ficticios.

#### Scenario: El revisor entra
- **Given** las credenciales entregadas a Meta
- **When** el revisor inicia sesión
- **Then** **MUST** ver un hotel de prueba con reservas y huéspedes inventados
- **And** **MUST NOT** poder alcanzar datos de otro hotel (multi-tenancy por `hotelId`, ya vigente)

#### Scenario: Credenciales fuera del repositorio
- **Given** el usuario creado para la revisión
- **When** se busca su contraseña en el repositorio
- **Then** **MUST NOT** aparecer en ningún archivo versionado
