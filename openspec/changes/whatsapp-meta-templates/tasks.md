# whatsapp-meta-templates — Tasks

## 1. Modelo + migración (`backend/src/modules/marketing/model.ts`)
- [x] 1.1 Agregar campos a `WhatsappTemplateModel`: `language` (string, default `'es'`), `metaCategory`
      (string, default `'UTILITY'`), `metaTemplateId` (string, nullable), `approvalStatus` (string,
      default `'none'`), `metaRejectedReason` (string, nullable), `metaVariableOrder` (json, nullable),
      `metaSyncedAt` (string, nullable).
- [x] 1.2 `RUN_MIGRATE=1 bun run src/composition-root.ts` en dev (SQLite) para aplicar `ADD COLUMN`.
- [x] 1.3 Actualizar `WhatsappTemplateDTO`/`CreateWhatsappTemplateDTO` (`types.ts`) con los campos nuevos.

## 2. Connector — credenciales Meta desde `ai-recepcionista`
- [x] 2.1 `marketing/service.ts`: declarar `MetaWhatsappCredentialsPort` + `setMetaCredsDeps()` (mismo
      patrón que `setAuditDeps`).
- [x] 2.2 Verificar que `ai-recepcionista` expone `getWhatsappConfig(hotelId)` en el objeto que retorna
      su `create()` (contrato del módulo) — si no está expuesto, agregarlo sin romper lo existente.
- [x] 2.3 Nuevo `backend/src/connectors/marketing-whatsapp-meta.ts`: resuelve ambos módulos, inyecta el
      puerto. Registrar en `composition-root.ts`.
- [x] 2.4 Test del connector: credenciales presentes → `{wabaId, accessToken}`; ausentes → `null`.

## 3. Cliente Graph API de plantillas

> **Desviación del design (2026-09-07)**: el cliente quedó en `backend/src/services/whatsapp-cloud-client.ts`,
> no dentro de `marketing/usecases/`. Motivo: `whatsapp-meta-onboarding` necesita el MISMO cliente para el
> canje del código y la lectura del número; tenerlo en el módulo obligaría a duplicarlo o a que
> onboarding importe de marketing. Sigue el patrón de `stripe-service.ts` y `ttlock-client.ts`.
> El método de estado es `getMetaTemplateStatus(creds, metaTemplateId)`.

- [x] 3.1 `backend/src/services/whatsapp-cloud-client.ts`:
      `createTemplate(wabaId, accessToken, payload)` → `POST /{wabaId}/message_templates`.
      `getTemplateStatus(accessToken, metaTemplateId)` → `GET /{metaTemplateId}?fields=status,rejected_reason`.
- [x] 3.2 Versión de API desde constante (`v26.0`, dato del documento) — no hardcodear en múltiples lugares.
- [x] 3.3 Manejo de errores: mapear `401`/credencial inválida y nombre duplicado a mensajes claros (ver
      design.md "Manejo de errores Graph API"); timeout/red → error genérico sin marcar `pending`.
- [x] 3.4 Tests del cliente con `fetch` mockeado (éxito, 401, nombre duplicado, timeout).

## 4. Conversión de variables nombradas → posicionales
- [x] 4.1 `backend/src/modules/marketing/usecases/meta-variable-mapping.ts`: `toMetaBody(localBody)` →
      `{ metaBody, variableOrder }` (ver algoritmo en design.md).
- [x] 4.2 Diccionario de valores demo para `example.body_text` — mismo set que
      `frontend/.../whatsapp-templates/index.vue:266-280`, replicado server-side.
- [x] 4.3 Tests: body sin variables, con variables repetidas (`{guest_name}` dos veces → misma posición),
      con variables desconocidas (fuera de la lista demo → placeholder genérico "valor" en el example).

## 5. Endpoints + servicio
- [x] 5.1 `marketing/service.ts`: `submitTemplateToMeta(id, user)` — orquesta credenciales → conversión →
      cliente Graph API → persistencia (`approvalStatus='pending'`, `metaTemplateId`, `metaVariableOrder`).
      `ValidationError` 409 si no hay credenciales.
- [x] 5.2 `marketing/service.ts`: `syncTemplateStatus(id, user)` — llama `getTemplateStatus`, mapea
      status Meta → local, persiste. 409 si `metaTemplateId` es null.
- [x] 5.3 `updateTemplate()`: si el patch toca `body`/`metaCategory`/`language` Y `approvalStatus !==
      'none'` → resetear `approvalStatus='none'`, `metaTemplateId=null`, `metaRejectedReason=null` (REQ-3).
- [x] 5.4 `marketing/controller.ts`: `submitTemplate(req)`, `syncTemplateStatus(req)` — mismo patrón
      ownership que `updateTemplate`/`deleteTemplate` (`auth.assertOwnership` vía service).
- [x] 5.5 `marketing/index.ts`: rutas `POST /api/whatsapp-templates/:id/submit` y
      `POST /api/whatsapp-templates/:id/sync-status`, `guard('settings','edit')`.
- [x] 5.6 Tests de servicio: submit exitoso, submit sin credenciales, sync approved/rejected, edit
      invalida aprobación, ownership cross-hotel (403/404).

## 6. Frontend
- [x] 6.1 `frontend/src/services/Whatsapp.service.ts`: extender `WhatsappTemplate`/`WhatsappTemplateInput`
      con los campos nuevos; agregar `submit(id)` y `syncStatus(id)`.
- [x] 6.2 `frontend/src/pages/whatsapp-templates/index.vue`: select Idioma + select Categoría Meta en el
      modal; columna/badge "Estado Meta" en la tabla; botones "Enviar a Meta"/"Sincronizar estado";
      mostrar `metaRejectedReason` cuando `rejected`.
- [x] 6.3 Estados de loading independientes para submit/sync (no reusar `saving` del guardado normal, para
      no bloquear el modal si el submit tarda).
- [x] 6.4 Mensaje explícito cuando el submit falla por "no conectado" — link a
      Configuración → Integraciones (REQ-META-01, aunque esa pantalla siga sin terminar, el mensaje debe
      decir dónde ir).

## 7. Verificación (antes de cerrar el change)
- [x] 7.1 `cd backend && bun run node_modules/arckode-framework/bin/arckode.js analyze` → 0 violaciones.
- [x] 7.2 `cd backend && bun run typecheck && bun test` (marketing + connector nuevo).
- [x] 7.3 `cd frontend && bun run typecheck && bun run build`.
- [x] 7.4 QA manual con un WABA de prueba real (requiere `wabaId`/`accessToken` de prueba cargados a
      mano vía `PUT /api/ai/whatsapp/config`): crear plantilla → enviar → ver "Pendiente" → sincronizar
      → ver estado real de Meta. **Hecho 2026-09-07** contra la cuenta de prueba
      (WABA `2631160424009333`, número `+1 555-678-1103`): dos plantillas creadas y aceptadas por Meta,
      `sync-status` devolviendo el estado real. Encontró dos bugs, ver abajo.

## Dependencias externas
- `wabaId` + `accessToken` de una cuenta de WhatsApp Business de prueba (mismo dato que necesita
  REQ-META-01) — sin esto, solo se puede probar el camino de error "no conectado" (tarea 5.1/6.4).
- Ninguna variable de entorno nueva obligatoria — la versión de API (`v26.0`) es una constante de código,
  no config por hotel.

---

## Estado (2026-09-07, rama `meta-config`)

**27 de 27 tareas hechas.** La 7.4 se completó contra la cuenta de prueba real de Meta.

### Datos de la cuenta de prueba (no son secretos; el token sí y no va acá)

| Dato | Valor |
|---|---|
| WABA ID | `2631160424009333` ("Test WhatsApp Business Account") |
| Phone Number ID | `1194399700434439` |
| Número | `+1 555-678-1103` — calidad GREEN, revisión APPROVED |

El usuario del sistema `SOL` necesitó **Full access** sobre la WABA: con el "Partial access (Phone
numbers view only + Messages)" que traía, Meta responde `(#200) Need either permission on WhatsApp
Business Account or owner business to view templates` y no se puede ni listar ni crear plantillas.

### Dos bugs que solo aparecieron con la API real

1. **La validación de "no termina con variable" era demasiado permisiva.** Un cuerpo como
   `"…tu habitación es la {room_number}."` pasaba nuestro chequeo (mira el final literal) y Meta lo
   rechazaba igual: la puntuación posterior no salva la regla. Corregido en `meta-variable-mapping.ts`
   con test de regresión.
2. **El error de Meta llegaba al panel como 500 "Error interno del servidor".** `WhatsappCloudError`
   no es un tipo que el framework reconozca, así que el handler global lo trataba como excepción no
   controlada y el hotel perdía lo único accionable: qué le molestó a Meta. Ahora se traduce a
   `ValidationError` (contenido) o `ConflictError` (credenciales / Meta caído) en `meta-templates.ts`,
   con tests de los tres casos.

Los tests con `fetch` simulado NO encontraron ninguno de los dos: el primero porque yo elegía los
cuerpos de prueba, el segundo porque nunca pasaba por el handler HTTP.

Gates ejecutados en esta rama:

| Gate | Resultado |
|---|---|
| `arckode analyze` | ✅ VÁLIDO, 0 violaciones |
| `bun test` (backend, completo) | ✅ 4822 pass, 0 fail |
| `bun run typecheck` (backend) | ✅ limpio |
| `vitest` (plantillas + a11y) | ✅ 336 pass |
| `vue-tsc -b` + `vite build` | ✅ limpio, `✓ built` |
| Prueba end-to-end contra Meta | ✅ crear → enviar → estado, por HTTP |

Deuda que dejó este change, no prevista en el plan original: `marketing/service.ts` había quedado en
249 líneas (el analyzer corta en 200). Se extrajeron a `usecases/` el CRUD de plantillas
(`templates-crud.ts`) y el disparador de auto-mensajes (`trigger-auto-messages.ts`, movido tal cual,
sin cambiar la lógica). El service quedó en 139 líneas.

---

## Plantillas recomendadas (agregado 2026-09-07)

Escribir una plantilla que Meta apruebe tiene trampas que un recepcionista no tiene por qué conocer.
Se agregó un catálogo de 6 plantillas ya redactadas (`usecases/plantillas-base.ts`) y el endpoint
`POST /api/whatsapp-templates/recomendadas`, idempotente por nombre. En el panel es un botón:
**"Usar plantillas recomendadas"**.

### Lo que enseñó probarlas contra Meta

| Plantilla | Resultado |
|---|---|
| Confirmación de reserva | ✅ PENDING |
| Recordatorio de llegada | ✅ PENDING |
| Saldo pendiente | ✅ PENDING |
| Gracias por la estadía | ✅ PENDING |
| Bienvenida al llegar (con clave de wifi) | ❌ `INCORRECT_CATEGORY` |
| Código de la puerta | ❌ `INCORRECT_CATEGORY` |

**Una plantilla UTILITY que entrega una credencial se rechaza al instante.** Meta la quiere
`AUTHENTICATION`, y esa categoría solo admite un formato fijo de código de verificación que no sirve
para "el código de tu habitación es X".

Y no alcanza con no mandar el dato: **mencionarlo basta**. La versión corregida que decía
*"respondé y te pasamos el código de acceso"* fue rechazada igual.

La regla es sobre credenciales de ACCESO, no sobre la palabra "código": *"tu código de reserva es
{locator}"* pasó sin problema. Hay dos tests que fijan exactamente eso, ni más ni menos.

**Corolario operativo**: borrar una plantilla en Meta NO libera el nombre enseguida. Para corregir
una rechazada conviene mandarla con otro nombre, no borrar y recrear.
