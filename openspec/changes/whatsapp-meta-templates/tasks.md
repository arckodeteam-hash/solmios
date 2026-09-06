# whatsapp-meta-templates — Tasks

## 1. Modelo + migración (`backend/src/modules/marketing/model.ts`)
- [ ] 1.1 Agregar campos a `WhatsappTemplateModel`: `language` (string, default `'es'`), `metaCategory`
      (string, default `'UTILITY'`), `metaTemplateId` (string, nullable), `approvalStatus` (string,
      default `'none'`), `metaRejectedReason` (string, nullable), `metaVariableOrder` (json, nullable),
      `metaSyncedAt` (string, nullable).
- [ ] 1.2 `RUN_MIGRATE=1 bun run src/composition-root.ts` en dev (SQLite) para aplicar `ADD COLUMN`.
- [ ] 1.3 Actualizar `WhatsappTemplateDTO`/`CreateWhatsappTemplateDTO` (`types.ts`) con los campos nuevos.

## 2. Connector — credenciales Meta desde `ai-recepcionista`
- [ ] 2.1 `marketing/service.ts`: declarar `MetaWhatsappCredentialsPort` + `setMetaCredsDeps()` (mismo
      patrón que `setAuditDeps`).
- [ ] 2.2 Verificar que `ai-recepcionista` expone `getWhatsappConfig(hotelId)` en el objeto que retorna
      su `create()` (contrato del módulo) — si no está expuesto, agregarlo sin romper lo existente.
- [ ] 2.3 Nuevo `backend/src/connectors/marketing-whatsapp-meta.ts`: resuelve ambos módulos, inyecta el
      puerto. Registrar en `composition-root.ts`.
- [ ] 2.4 Test del connector: credenciales presentes → `{wabaId, accessToken}`; ausentes → `null`.

## 3. Cliente Graph API de plantillas
- [ ] 3.1 `backend/src/modules/marketing/usecases/whatsapp-meta-template-client.ts`:
      `createTemplate(wabaId, accessToken, payload)` → `POST /{wabaId}/message_templates`.
      `getTemplateStatus(accessToken, metaTemplateId)` → `GET /{metaTemplateId}?fields=status,rejected_reason`.
- [ ] 3.2 Versión de API desde constante (`v26.0`, dato del documento) — no hardcodear en múltiples lugares.
- [ ] 3.3 Manejo de errores: mapear `401`/credencial inválida y nombre duplicado a mensajes claros (ver
      design.md "Manejo de errores Graph API"); timeout/red → error genérico sin marcar `pending`.
- [ ] 3.4 Tests del cliente con `fetch` mockeado (éxito, 401, nombre duplicado, timeout).

## 4. Conversión de variables nombradas → posicionales
- [ ] 4.1 `backend/src/modules/marketing/usecases/meta-variable-mapping.ts`: `toMetaBody(localBody)` →
      `{ metaBody, variableOrder }` (ver algoritmo en design.md).
- [ ] 4.2 Diccionario de valores demo para `example.body_text` — mismo set que
      `frontend/.../whatsapp-templates/index.vue:266-280`, replicado server-side.
- [ ] 4.3 Tests: body sin variables, con variables repetidas (`{guest_name}` dos veces → misma posición),
      con variables desconocidas (fuera de la lista demo → placeholder genérico "valor" en el example).

## 5. Endpoints + servicio
- [ ] 5.1 `marketing/service.ts`: `submitTemplateToMeta(id, user)` — orquesta credenciales → conversión →
      cliente Graph API → persistencia (`approvalStatus='pending'`, `metaTemplateId`, `metaVariableOrder`).
      `ValidationError` 409 si no hay credenciales.
- [ ] 5.2 `marketing/service.ts`: `syncTemplateStatus(id, user)` — llama `getTemplateStatus`, mapea
      status Meta → local, persiste. 409 si `metaTemplateId` es null.
- [ ] 5.3 `updateTemplate()`: si el patch toca `body`/`metaCategory`/`language` Y `approvalStatus !==
      'none'` → resetear `approvalStatus='none'`, `metaTemplateId=null`, `metaRejectedReason=null` (REQ-3).
- [ ] 5.4 `marketing/controller.ts`: `submitTemplate(req)`, `syncTemplateStatus(req)` — mismo patrón
      ownership que `updateTemplate`/`deleteTemplate` (`auth.assertOwnership` vía service).
- [ ] 5.5 `marketing/index.ts`: rutas `POST /api/whatsapp-templates/:id/submit` y
      `POST /api/whatsapp-templates/:id/sync-status`, `guard('settings','edit')`.
- [ ] 5.6 Tests de servicio: submit exitoso, submit sin credenciales, sync approved/rejected, edit
      invalida aprobación, ownership cross-hotel (403/404).

## 6. Frontend
- [ ] 6.1 `frontend/src/services/Whatsapp.service.ts`: extender `WhatsappTemplate`/`WhatsappTemplateInput`
      con los campos nuevos; agregar `submit(id)` y `syncStatus(id)`.
- [ ] 6.2 `frontend/src/pages/whatsapp-templates/index.vue`: select Idioma + select Categoría Meta en el
      modal; columna/badge "Estado Meta" en la tabla; botones "Enviar a Meta"/"Sincronizar estado";
      mostrar `metaRejectedReason` cuando `rejected`.
- [ ] 6.3 Estados de loading independientes para submit/sync (no reusar `saving` del guardado normal, para
      no bloquear el modal si el submit tarda).
- [ ] 6.4 Mensaje explícito cuando el submit falla por "no conectado" — link a
      Configuración → Integraciones (REQ-META-01, aunque esa pantalla siga sin terminar, el mensaje debe
      decir dónde ir).

## 7. Verificación (antes de cerrar el change)
- [ ] 7.1 `cd backend && bun run node_modules/arckode-framework/bin/arckode.js analyze` → 0 violaciones.
- [ ] 7.2 `cd backend && bun run typecheck && bun test` (marketing + connector nuevo).
- [ ] 7.3 `cd frontend && bun run typecheck && bun run build`.
- [ ] 7.4 QA manual con un WABA de prueba real (requiere `wabaId`/`accessToken` de prueba cargados a
      mano vía `PUT /api/ai/whatsapp/config`): crear plantilla → enviar → ver "Pendiente" → sincronizar
      → ver estado real de Meta.

## Dependencias externas
- `wabaId` + `accessToken` de una cuenta de WhatsApp Business de prueba (mismo dato que necesita
  REQ-META-01) — sin esto, solo se puede probar el camino de error "no conectado" (tarea 5.1/6.4).
- Ninguna variable de entorno nueva obligatoria — la versión de API (`v26.0`) es una constante de código,
  no config por hotel.
