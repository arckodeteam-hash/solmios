# whatsapp-meta-onboarding — Tasks

> Bloquea a `whatsapp-meta-templates` (necesita `wabaId`+`accessToken` reales),
> `whatsapp-meta-messaging` y `whatsapp-meta-inbox`.
> **Dependencia externa que hay que tener antes de la fase 2**: `META_APP_SECRET` (lo saca el equipo del
> panel de Meta → Configuración → Básica → Mostrar) y el WABA ID de la cuenta de prueba.

## 1. Modelo y configuración del entorno
- [ ] 1.1 Agregar a `AiWhatsappConfigModel` (`ai-recepcionista/model.ts`) los campos de identidad y
      estado: `displayPhoneNumber`, `verifiedName`, `businessName`, `qualityRating`, `messagingLimit`,
      `accountReviewStatus`, `connectedAt`, `connectedByUserId`, `connectionError`.
      **Aceptación**: `RUN_MIGRATE=1 bun run src/composition-root.ts` agrega las columnas en SQLite y en
      Postgres sin tocar las existentes; un `PUT` de la config vieja sigue funcionando igual.
- [ ] 1.2 Extender `AiWhatsappConfigDTO` (`types.ts`) y comprobar que **cada campo nuevo está declarado
      en el `orm.define`** (anti-patrón ORM: lo no declarado se descarta sin avisar).
      **Aceptación**: un test guarda los 9 campos, relee la fila y los recupera todos.
- [ ] 1.3 Agregar `META_APP_ID`, `META_APP_SECRET` y `META_GRAPH_VERSION` a `backend/.env.example` con
      comentario de dónde se obtienen. **Aceptación**: `.env.example` documenta las tres; el arranque
      avisa por log si falta el secreto, igual que hace hoy el captcha.

## 2. Cliente de Graph API — conexión
- [ ] 2.1 `backend/src/services/whatsapp-cloud-client.ts`: `exchangeCode(code)` →
      `GET /oauth/access_token`. **Aceptación**: test con `fetch` mockeado devuelve el token; un código
      vencido produce un error tipado, no una excepción cruda.
- [ ] 2.2 `subscribeApp(creds)` → `POST /{wabaId}/subscribed_apps` y `unsubscribeApp(creds)` → `DELETE`.
      **Aceptación**: tests de ambos caminos, incluido el error de permisos.
- [ ] 2.3 `getPhoneNumber(creds)` y `getWabaInfo(creds)` con los campos del spec.
      **Aceptación**: test que mapea la respuesta de Meta a los campos de la tabla.
- [ ] 2.4 `registerPhoneNumber(creds, pin)` → `POST /{phoneNumberId}/register`.
      **Aceptación**: test de éxito y del error "ya registrado" (que NO debe abortar la conexión).
- [ ] 2.5 Traducción de errores de Meta a castellano en un solo lugar (código vencido, secreto ausente,
      permisos insuficientes, número ya en uso). **Aceptación**: tabla de mapeo con test por caso.

## 3. Backend — endpoints de conexión
- [ ] 3.1 `ai-recepcionista/usecases/whatsapp-connection.ts`: `connectWhatsapp(deps, {code,
      phoneNumberId, wabaId}, hotelId, userId)` orquestando canje → suscripción → registro → lectura de
      datos → persistencia. **Aceptación**: si falla cualquier paso previo a la persistencia, la fila
      queda como estaba (test de fallo a mitad).
- [ ] 3.2 `disconnectWhatsapp(deps, hotelId)`: desuscribe en Meta ANTES de limpiar local; si Meta falla,
      no limpia. **Aceptación**: test del caso "Meta rechaza la baja" del spec.
- [ ] 3.3 Rutas en `ai-recepcionista/index.ts`: `POST /api/ai/whatsapp/connect`,
      `GET|DELETE /api/ai/whatsapp/connection`, con `guard('settings', …)`.
      **Aceptación**: `arckode analyze` en 0 violaciones; ninguna ruta sin guard.
- [ ] 3.4 La respuesta pasa por `redactWhatsappConfig`. **Aceptación**: test que afirma que
      `accessToken` no aparece en ninguna respuesta de los tres endpoints.
- [ ] 3.5 `hotelId` siempre del token; `super_admin` puede apuntar con `?hotelId=`.
      **Aceptación**: test cross-tenant (hotel B no puede conectar el hotel A).

## 4. Frontend — tarjeta de conexión en el panel del hotel
- [ ] 4.1 `frontend/src/services/AiReceptionist.service.ts`: `connect(payload)`, `getConnection()`,
      `disconnect()`. **Aceptación**: tipados sin `any`; `bun run typecheck` limpio.
- [ ] 4.2 Cargar el SDK de Facebook solo cuando el usuario acepta la advertencia (no en el arranque de
      la app). **Aceptación**: sin aceptar, la red no pide nada a `connect.facebook.net`.
- [ ] 4.3 Componente `WhatsappConnectionCard.vue` con los 5 estados del design.
      **Aceptación**: los cinco se pueden ver; ninguno muestra credenciales.
- [ ] 4.4 Advertencia previa con la alternativa del número nuevo y confirmación explícita (REQ-3).
      **Aceptación**: no hay forma de llegar a la ventana de Meta sin pasar por ahí.
- [ ] 4.5 Montar la tarjeta en `/panel/config` → Integraciones.
      **Aceptación**: visible para `settings:view`, editable solo con `settings:edit`.
- [ ] 4.6 Confirmación de desconexión que explique que recuperar el número en el celular es un trámite
      de Meta. **Aceptación**: el texto lo dice; el botón queda en estado de carga durante la baja.

## 5. Retirar la tarjeta muerta de super-admin
- [ ] 5.1 Sacar la tarjeta editable de WhatsApp de `super-admin/settings.vue` (array `integrations`,
      línea ~232). **Aceptación**: no queda ningún input de credenciales de WhatsApp en `/admin/settings`.
- [ ] 5.2 (Opcional) Lista de solo lectura de hoteles con WhatsApp conectado.
      **Aceptación**: no permite editar nada; sale de los datos ya persistidos por hotel.
- [ ] 5.3 Revisar si `configuration('integraciones')` queda sin uso y documentarlo o limpiarlo.
      **Aceptación**: si se conserva para Stripe, se aclara en un comentario qué lo lee.

## 6. Verificación
- [ ] 6.1 `cd backend && bun run node_modules/arckode-framework/bin/arckode.js analyze` → 0 violaciones.
      **Ojo**: `ai-recepcionista/service.ts` está a 197 líneas y el límite del analyzer es 200 — lo que
      se agregue va a `usecases/`, no al service.
- [ ] 6.2 `cd backend && bun run typecheck && bun test`.
- [ ] 6.3 `cd frontend && bun run typecheck && bun run build`.
- [ ] 6.4 Prueba de punta a punta con la cuenta de prueba de Meta: conectar → ver el número → enviarse
      un mensaje de prueba → desconectar. **Aceptación**: los cuatro pasos, con capturas.
