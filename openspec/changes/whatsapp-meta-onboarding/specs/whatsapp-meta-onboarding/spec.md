# SPEC: Conexión de WhatsApp del hotel (Embedded Signup)

Cubre REQ-META-01 y REQ-META-02 del documento del equipo de Meta (2026-09-02). Es requisito previo de
`whatsapp-meta-templates`, `whatsapp-meta-messaging` y `whatsapp-meta-inbox`.

## REQ-1: Conectar el WhatsApp del hotel desde el panel

El sistema **MUST** permitir que un hotel conecte su propia cuenta de WhatsApp Business mediante el
flujo Embedded Signup de Meta, sin que ningún dato secreto pase por el navegador.

### Database

Columnas nuevas en `ai_whatsapp_config` (`backend/src/modules/ai-recepcionista/model.ts`):

| Columna | Tipo | Notas |
|---|---|---|
| `displayPhoneNumber` | TEXT | nullable; número legible que devuelve Meta |
| `verifiedName` | TEXT | nullable; nombre del negocio aprobado por Meta |
| `businessName` | TEXT | nullable; portfolio comercial dueño del WABA |
| `qualityRating` | TEXT | nullable; `GREEN`\|`YELLOW`\|`RED` |
| `messagingLimit` | TEXT | nullable; tope de conversaciones/día informado por Meta |
| `accountReviewStatus` | TEXT | nullable; verificación del negocio ante Meta |
| `connectedAt` | TEXT | nullable; timestamp ISO |
| `connectedByUserId` | TEXT | nullable; `users.id` de quien conectó |
| `connectionError` | TEXT | nullable; último error de Meta, ya traducido |

`connectionMode` (ya existente) **MUST** quedar en `'meta'` tras una conexión exitosa.

### API endpoints

| Método | Ruta | Auth/Permiso |
|---|---|---|
| POST | `/api/ai/whatsapp/connect` | `guard('settings','edit')` |
| GET | `/api/ai/whatsapp/connection` | `guard('settings','view')` |
| DELETE | `/api/ai/whatsapp/connection` | `guard('settings','edit')` |

### UI

`/panel/config` → pestaña Integraciones → tarjeta "WhatsApp Business". Texto en castellano. La
advertencia previa **MUST** ser visible antes de que el botón abra la ventana de Meta.

### Scenarios

#### Scenario: Conexión exitosa
- **Given** un hotel sin conexión (`connectionMode != 'meta'`, `accessToken` vacío)
- **And** un usuario con permiso `settings:edit`
- **When** el usuario acepta la advertencia, completa la ventana de Meta y el navegador hace
  POST `/api/ai/whatsapp/connect` con `{ code, phoneNumberId, wabaId }`
- **Then** el servidor **MUST** canjear el código contra `GET /v26.0/oauth/access_token` usando el
  `app_secret` del entorno
- **And** **MUST** suscribir la app al WABA (`POST /v26.0/{wabaId}/subscribed_apps`)
- **And** **MUST** leer los datos del número y del WABA y persistirlos junto a `connectionMode='meta'`,
  `connectedAt`, `connectedByUserId`
- **And** la respuesta **MUST NOT** incluir `accessToken` ni ningún secreto (proyección de
  `redactWhatsappConfig`)

#### Scenario: El código ya fue usado o expiró
- **Given** un `code` vencido (Meta los invalida en segundos)
- **When** POST `/api/ai/whatsapp/connect`
- **Then** **MUST** responder 400 con "El permiso de Meta venció. Volvé a pulsar Conectar WhatsApp."
- **And** **MUST NOT** dejar la fila a medio escribir: sin token válido, `connectionMode` **MUST**
  permanecer como estaba

#### Scenario: Falta el secreto de la app en el servidor
- **Given** `META_APP_SECRET` no está definido
- **When** POST `/api/ai/whatsapp/connect`
- **Then** **MUST** responder 503 con un mensaje que distinga la falla de configuración del servidor de
  un error del hotel
- **And** **MUST** registrar un `logger.error` — es un problema de despliegue, no del usuario

#### Scenario: Ownership multi-tenant
- **Given** un usuario del hotel B
- **When** intenta conectar apuntando al `hotelId` del hotel A
- **Then** el `hotelId` **MUST** salir del token, nunca del body, y la operación **MUST** aplicarse
  al hotel B (mismo criterio que `hotelIdFor` en `marketing/controller.ts`)

#### Scenario: super_admin operando sobre un hotel
- **Given** un usuario `super_admin` con `?hotelId=` en la query
- **When** conecta
- **Then** **MUST** poder hacerlo sobre ese hotel, y `connectedByUserId` **MUST** registrar al
  super_admin, no al dueño del hotel

---

## REQ-2: Ver el estado de la conexión

El sistema **MUST** mostrar, sin recargar credenciales, si el WhatsApp del hotel está conectado y con
qué número.

### Scenarios

#### Scenario: Hotel conectado
- **Given** `connectionMode='meta'` con datos de Meta persistidos
- **When** se abre la tarjeta
- **Then** **MUST** mostrar `displayPhoneNumber`, `verifiedName`, la calidad y el límite diario
- **And** **MUST** ofrecer "Desconectar"

#### Scenario: Hotel con la vía vieja (Baileys)
- **Given** `connectionMode='baileys'` con `baileysCredentials` presentes
- **When** se abre la tarjeta
- **Then** **MUST** indicar que la conexión es la anterior (no oficial) y ofrecer migrar
- **And** **MUST NOT** presentarla como una conexión de Meta válida

#### Scenario: Nunca conectado
- **Given** un hotel sin credenciales de ningún tipo
- **When** se abre la tarjeta
- **Then** **MUST** mostrar la advertencia sobre el número y el botón "Conectar WhatsApp"

---

## REQ-3: Advertir antes de conectar

El sistema **MUST** informar, antes de abrir la ventana de Meta, que el número conectado **deja de
funcionar en la app de WhatsApp del celular**.

#### Scenario: El hotel no puede saltear la advertencia
- **Given** la tarjeta en estado `disconnected`
- **When** el usuario pulsa "Conectar WhatsApp"
- **Then** **MUST** verse la advertencia y la alternativa (usar un número nuevo) antes de que se
  cargue el SDK de Meta
- **And** el flujo **MUST** requerir una confirmación explícita para continuar

---

## REQ-4: Desconectar

El sistema **MUST** permitir dar de baja la conexión, dejando el número liberado del lado de Meta.

#### Scenario: Baja correcta
- **Given** un hotel conectado
- **When** DELETE `/api/ai/whatsapp/connection`
- **Then** **MUST** desuscribir la app del WABA en Meta **antes** de limpiar los datos locales
- **And** **MUST** limpiar `accessToken`, `phoneNumberId`, `wabaId` y volver `connectionMode` a `'none'`
- **And** **MUST NOT** borrar `baileysCredentials` (no es lo que se está dando de baja)

#### Scenario: Meta rechaza la baja
- **Given** Meta responde con error al desuscribir
- **When** DELETE `/api/ai/whatsapp/connection`
- **Then** los datos locales **MUST** permanecer intactos
- **And** **MUST** responder un error que permita reintentar — un hotel "desconectado" localmente pero
  suscripto en Meta seguiría recibiendo webhooks que nadie atiende

---

## REQ-5: Retirar la tarjeta muerta de `/admin/settings`

El sistema **MUST** dejar de ofrecer una configuración de WhatsApp que no guarda nada.

#### Scenario: super-admin abre Integraciones
- **Given** `frontend/src/pages/super-admin/settings.vue` con la tarjeta actual (inputs `:value` sin
  `v-model`, clave `configuration('integraciones')` sin lectores)
- **When** se aplica este change
- **Then** la tarjeta editable de WhatsApp **MUST** desaparecer de esa vista
- **And** **MAY** reemplazarse por una lista de solo lectura de hoteles con WhatsApp conectado
- **And** **MUST NOT** quedar ningún control que aparente guardar credenciales de WhatsApp de plataforma
