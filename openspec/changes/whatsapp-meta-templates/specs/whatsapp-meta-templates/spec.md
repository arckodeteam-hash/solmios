# SPEC: Plantillas WhatsApp — integración con Meta

Cubre REQ-META-03 / META-TECH-05 de `Requerimientos_Meta_WhatsApp_SOLMI_OS.md`. Extiende (no reemplaza)
el REQ-2 "WhatsApp Templates CRUD" de `openspec/changes/archive/match-misterplan/specs/whatsapp/spec.md`.

## REQ-1: Enviar una plantilla a aprobación de Meta

El sistema **MUST** permitir enviar una plantilla local a la API de Plantillas de Meta para su proceso
de aprobación, sin salir de la pantalla de Plantillas WhatsApp.

### Database

Columnas nuevas en `whatsapp_templates` (`backend/src/modules/marketing/model.ts`):

| Columna | Tipo | Notas |
|---|---|---|
| `language` | TEXT | default `'es'`; `es`\|`en`\|`pt` |
| `metaCategory` | TEXT | default `'UTILITY'`; `MARKETING`\|`UTILITY`\|`AUTHENTICATION` (taxonomía de Meta, **no** confundir con `category` local) |
| `metaTemplateId` | TEXT | nullable; id devuelto por Meta al crear |
| `approvalStatus` | TEXT | default `'none'`; `none`\|`pending`\|`approved`\|`rejected` |
| `metaRejectedReason` | TEXT | nullable |
| `metaVariableOrder` | JSON | nullable; array de nombres en el orden posicional enviado a Meta |
| `metaSyncedAt` | TEXT (timestamp) | nullable; última sincronización de estado |

### API endpoints

| Método | Ruta | Auth/Permiso |
|---|---|---|
| POST | `/api/whatsapp-templates/:id/submit` | `guard('settings','edit')` |

### Scenarios

#### Scenario: Enviar plantilla nueva a Meta
- **Given** plantilla `id=t1`, `body="Hola {guest_name}, tu check-in es el {checkin_date}"`, `approvalStatus='none'`
- **And** el hotel tiene `wabaId`/`accessToken` cargados en `ai_whatsapp_config`
- **When** POST `/api/whatsapp-templates/t1/submit`
- **Then** el backend MUST convertir el body a formato Meta (`{{1}}`, `{{2}}`) y guardar
  `metaVariableOrder=['guest_name','checkin_date']`
- **And** MUST llamar `POST https://graph.facebook.com/v26.0/{wabaId}/message_templates` con
  `category=metaCategory`, `language`, `components=[{type:'BODY', text, example}]`
- **And** al recibir `{id, status}` de Meta MUST persistir `metaTemplateId=id`, `approvalStatus='pending'`, `metaSyncedAt=now`
- **And** response MUST devolver 200 con la plantilla actualizada

#### Scenario: Enviar sin credenciales Meta configuradas
- **Given** el hotel NO tiene `wabaId`/`accessToken` en `ai_whatsapp_config`
- **When** POST `/api/whatsapp-templates/:id/submit`
- **Then** MUST responder 409 con mensaje "WhatsApp Business no está conectado — configurá la conexión primero"
- **And** MUST NOT llamar a Graph API
- **And** `approvalStatus` MUST permanecer sin cambios

#### Scenario: Meta rechaza por nombre duplicado
- **Given** ya existe una plantilla con el mismo `name` en el WABA del hotel
- **When** POST `/api/whatsapp-templates/:id/submit`
- **Then** Graph API responde error de nombre duplicado
- **And** el backend MUST propagar un mensaje claro (no el error crudo de Meta)
- **And** `approvalStatus` MUST permanecer `'none'` (no se marca `pending` sin confirmación real)

#### Scenario: Ownership multi-tenant
- **Given** plantilla `t1` pertenece al hotel A
- **When** un usuario del hotel B hace POST `/api/whatsapp-templates/t1/submit`
- **Then** MUST responder 403/404 vía `auth.assertOwnership` (mismo patrón que `updateTemplate`/`deleteTemplate`)

---

## REQ-2: Consultar y sincronizar el estado de aprobación

El sistema **MUST** permitir consultar el estado actual de una plantilla ya enviada y reflejarlo en la
pantalla.

### API endpoints

| Método | Ruta | Auth/Permiso |
|---|---|---|
| POST | `/api/whatsapp-templates/:id/sync-status` | `guard('settings','edit')` |

### Scenarios

#### Scenario: Sincronizar plantilla pendiente que ya fue aprobada en Meta
- **Given** plantilla `t1` con `approvalStatus='pending'`, `metaTemplateId='meta123'`
- **And** en Meta el status real es `APPROVED`
- **When** POST `/api/whatsapp-templates/t1/sync-status`
- **Then** MUST llamar `GET https://graph.facebook.com/v26.0/meta123?fields=status,rejected_reason`
- **And** MUST actualizar `approvalStatus='approved'`, `metaSyncedAt=now`
- **And** response MUST devolver la plantilla con el nuevo estado

#### Scenario: Sincronizar plantilla rechazada
- **Given** plantilla `t1` con `approvalStatus='pending'`
- **And** en Meta el status real es `REJECTED` con `rejected_reason='INVALID_FORMAT'`
- **When** POST `/api/whatsapp-templates/t1/sync-status`
- **Then** MUST actualizar `approvalStatus='rejected'`, `metaRejectedReason='INVALID_FORMAT'`

#### Scenario: Sincronizar plantilla sin `metaTemplateId`
- **Given** plantilla `t1` con `approvalStatus='none'` (nunca enviada)
- **When** POST `/api/whatsapp-templates/t1/sync-status`
- **Then** MUST responder 409 "La plantilla todavía no fue enviada a Meta"
- **And** MUST NOT llamar a Graph API

---

## REQ-3: Editar una plantilla enviada invalida su aprobación

Editar el contenido relevante para Meta de una plantilla ya enviada **MUST** invalidar su estado de
aprobación — nunca debe mostrarse "Aprobada" sobre un texto que Meta no vio.

### Scenarios

#### Scenario: Editar el body de una plantilla aprobada
- **Given** plantilla `t1` con `approvalStatus='approved'`
- **When** PUT `/api/whatsapp-templates/t1` cambia `body`
- **Then** MUST resetear `approvalStatus='none'`, `metaTemplateId=null`, `metaRejectedReason=null`
- **And** el admin MUST volver a hacer submit para re-aprobarla

#### Scenario: Editar solo `isActive` no invalida la aprobación
- **Given** plantilla `t1` con `approvalStatus='approved'`
- **When** PUT `/api/whatsapp-templates/t1` cambia únicamente `isActive`
- **Then** `approvalStatus` MUST permanecer `'approved'` (no se tocó body/category/language)

#### Scenario: Editar `metaCategory` o `language` también invalida
- **Given** plantilla `t1` con `approvalStatus='approved'`
- **When** PUT cambia `metaCategory` o `language`
- **Then** MUST resetear `approvalStatus='none'` (mismo motivo: Meta aprobó la combinación anterior)

---

## UI requirements

- `frontend/src/pages/whatsapp-templates/index.vue`: agregar al formulario modal (junto a Categoría):
  - Select **Idioma** (es/en/pt), default `es`.
  - Select **Categoría Meta** (Marketing/Utilidad/Autenticación), default Utilidad — con tooltip corto
    explicando que es distinto de la categoría de arriba (agrupación interna).
- Columna/badge nuevo en la tabla: **Estado Meta** — "Sin enviar" (gris) / "Pendiente" (dorado) /
  "Aprobada" (teal) / "Rechazada" (coral, con el motivo en tooltip).
- Botón **"Enviar a Meta"** visible cuando `approvalStatus === 'none'`.
- Botón **"Sincronizar estado"** visible cuando `approvalStatus === 'pending'` (y también disponible en
  `rejected` para reintentar consulta tras corregir en el panel de Meta directamente).
- Si `approvalStatus === 'rejected'`, mostrar `metaRejectedReason` visible (no solo en tooltip) para que
  el staff sepa qué corregir.
- `accessToken` **MUST NOT** llegar nunca al frontend en ningún payload (mismo criterio que
  `redactWhatsappConfig`).
- No se crean pantallas nuevas — todo vive dentro del modal/tabla existente de
  `whatsapp-templates/index.vue`.
