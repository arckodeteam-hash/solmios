# whatsapp-meta-templates

## Intent

Integrar el módulo de Plantillas WhatsApp (`Configuración → Mensajería → Plantillas WhatsApp`) con la
**API de Plantillas de Meta** (WhatsApp Business Message Templates), para que una plantilla creada en
SOLMI se pueda **enviar a aprobación de Meta** y su **estado** (pendiente/aprobada/rechazada) se vea y
se pueda sincronizar desde el panel. Es el REQ-META-03 / META-TECH-05 de
`Requerimientos_Meta_WhatsApp_SOLMI_OS.md` (documento fuente, 2026-09-02).

Referencia MisterPlan: `openspec/changes/archive/match-misterplan/tasks.md` 7.2.2 "Template approval
flow" — **GitLab #409**, marcada `⛔ bloqueada por creds WhatsApp Business Meta`. Las credenciales ya
están disponibles (ver Contexto), así que este change la desbloquea.

## Por qué empezar por acá (y no por Embedded Signup)

El documento de requisitos marca "Embedded Signup" como el primer paso bloqueante para la
**grabación de evidencia**, pero el trabajo de **hoy** es Plantillas: es la pieza que se puede construir
y probar de punta a punta ahora mismo sin depender de que el flujo de conexión OAuth esté automatizado.
Motivo: la API de Plantillas de Meta solo necesita `wabaId` + `accessToken` — y esos dos datos **ya se
pueden cargar a mano** hoy vía `PUT /api/ai/whatsapp/config` (el acceso al panel de Meta del documento
ya fue concedido, ver tabla de datos disponibles). Cuando el change de Embedded Signup (REQ-META-01)
esté implementado, va a poblar esos mismos dos campos automáticamente — sin tocar nada de este change.

## Contexto (verificado en código, 2026-09-05)

- **`whatsapp_templates`** (`backend/src/modules/marketing/model.ts:44-54`): `hotelId, name, body,
  category, isActive`. 100% local — sin `metaTemplateId`, sin estado de aprobación, sin idioma. El
  botón "Probar en WhatsApp" (`frontend/src/pages/whatsapp-templates/index.vue:100-103`) solo abre un
  link `wa.me/...` — no hay ninguna llamada a Graph API en todo el repo para plantillas.
- **`ai_whatsapp_config`** (`backend/src/modules/ai-recepcionista/model.ts:88-116`), una fila por hotel
  (`hotelId unique`): **ya tiene** `wabaId` y `accessToken` en el modelo, en el DTO
  (`types.ts:92-95,382-385,402-405`) y en el schema de escritura (`validators/schema.ts:104-107`) de
  `PUT /api/ai/whatsapp/config`. Hoy nadie los usa para llamar a Meta (el envío de mensajes del bot va
  100% por Baileys) — pero para Plantillas alcanza con **leerlos**, no hace falta que el resto del
  sistema los use.
- El módulo `marketing` declara en su contrato `rules: ['No importar de otros módulos']` — leer
  `wabaId`/`accessToken` de `ai-recepcionista` requiere un **connector** nuevo (patrón ya usado:
  `connectors/marketing-auditlog.ts`), no un import directo.
- Datos de Meta disponibles (documento fuente): App ID `1727869705161184`, config_id
  `1088480837040398`, API version `v26.0`.

## Decisión

- **Reusar `ai_whatsapp_config`** como única fuente de credenciales Meta por hotel — no crear una tabla
  de "conexión WhatsApp" separada para Plantillas. Evita duplicar `wabaId`/`accessToken` en dos lugares
  que podrían desincronizarse.
- **Variables**: hoy las plantillas usan placeholders libres con nombre (`{guest_name}`, `{room_number}`,
  etc.), pero Meta exige variables **posicionales** `{{1}}`, `{{2}}`... en el body, más un `example` de
  cada una para que el revisor de Meta las vea resueltas. Al enviar a Meta, el backend traduce el body
  local a formato Meta: detecta los placeholders en orden de aparición, los renumera, arma el `example`
  con los mismos valores demo que ya usa el preview del frontend, y **guarda el orden** (`metaVariableOrder`)
  para que un futuro envío en runtime (REQ-META-04, fuera de este change) sepa mapear valores reales a
  posiciones.
- **Categoría de Meta**: el `category` local (general/reservation/checkin/checkout/payment/marketing) es
  para agrupar/iconografía en la UI y **no** es la taxonomía de Meta (`MARKETING`/`UTILITY`/
  `AUTHENTICATION`, obligatoria en el submit). Se agrega un campo nuevo `metaCategory` independiente,
  con default `UTILITY` (transaccional — la mayoría de las plantillas del hotel son de este tipo) y
  `MARKETING` cuando `category === 'marketing'`.
- **Sync de estado**: v1 es **manual** (botón "Sincronizar estado" que hace `GET` a Meta bajo demanda).
  No se implementa un webhook de `message_template_status_update` en este change — cumple igual el
  criterio de aceptación del documento ("el estado puede actualizarse cuando cambie en Meta") sin el
  costo de un endpoint público nuevo. Puede añadirse después como mejora incremental.
- **Editar una plantilla ya enviada**: si se edita `body`/`metaCategory`/`language` de una plantilla con
  `approvalStatus` en `pending`/`approved`/`rejected`, se resetea a `none` y se limpia `metaTemplateId` —
  obliga a reenviar. Evita mostrar "Aprobada" sobre un texto que Meta nunca vio.

## Scope (v1)

- Nuevos campos en `whatsapp_templates`: `language`, `metaCategory`, `metaTemplateId`, `approvalStatus`,
  `metaRejectedReason`, `metaVariableOrder`, `metaSyncedAt`.
- Connector `marketing-whatsapp-meta.ts`: expone `getMetaCredentials(hotelId)` desde `ai-recepcionista`.
- Cliente Graph API de plantillas (`POST/GET /{wabaId}/message_templates`).
- Endpoints nuevos: `POST /api/whatsapp-templates/:id/submit`, `POST /api/whatsapp-templates/:id/sync-status`.
- UI: selects de idioma/categoría Meta, badge de estado de aprobación, botones "Enviar a Meta" /
  "Sincronizar estado", motivo de rechazo visible.

## Out of scope (queda para otros changes)

- **REQ-META-01** Embedded Signup (flujo OAuth de conexión) — hoy el `accessToken`/`wabaId` se cargan a
  mano vía el endpoint ya existente `PUT /api/ai/whatsapp/config`.
- **REQ-META-04** Envío real de un mensaje (plantilla aprobada) desde una reserva vía Cloud API —
  depende de `whatsapp-meta-client.ts` para *envío de mensajes*, que es un cliente distinto al de
  *gestión de plantillas* de este change.
- **REQ-META-05** Webhooks de recepción/conversación (ya existen y están fuera de este scope).
- Componentes avanzados de plantilla Meta (headers con media, botones de call-to-action/quick-reply) —
  v1 es solo `BODY` de texto, igual que hoy.
- Webhook de `message_template_status_update` (sync automático) — v1 es sync manual.

## Riesgos a vigilar

- **Rate limits de Meta** en la API de plantillas — el botón de submit/sync no debe permitir doble click
  (loading state ya es el patrón estándar del frontend).
- **`accessToken` ausente o inválido**: si el hotel no cargó credenciales Meta todavía, `submit`/`sync`
  deben devolver un error claro ("Conectá WhatsApp Business primero en Configuración → Integraciones"),
  no un 500 crudo de Graph API.
- **Nombre de plantilla**: Meta exige nombres únicos por WABA en `lowercase_snake_case` sin espacios —
  hay que normalizar `name` (o pedir un `metaTemplateName` separado) antes del POST; el `name` local hoy
  es texto libre ("Bienvenida", "Confirmación").
