# whatsapp-meta-messaging — Tasks

> **Depende de** `whatsapp-meta-onboarding` (fases 1-3: sin conexión no hay `phoneNumberId` ni token) y
> de `whatsapp-meta-templates` (una plantilla `APPROVED` para poder mandar fuera de las 24 h).

## 1. Normalización del teléfono
- [ ] 1.1 `backend/src/shared/utils/phone-e164.ts`: `toE164(phone, defaultCountry)`.
      **Aceptación**: tests con `809-555-0000` + país RD → `18095550000`; `+1 809 555 0000` → igual;
      basura → `null`.
- [ ] 1.2 Resolver el país por defecto desde el hotel, no por constante.
      **Aceptación**: dos hoteles de países distintos normalizan el mismo número local distinto.

## 2. Cliente de envío
- [ ] 2.1 `services/whatsapp-cloud-client.ts`: `sendTemplateMessage(creds, {to, name, language,
      parameters})` → `POST /{phoneNumberId}/messages`.
      **Aceptación**: test con `fetch` mockeado devuelve el `wamid`; el body enviado tiene
      `messaging_product:'whatsapp'`.
- [ ] 2.2 `sendTextMessage(creds, {to, text})` para la ventana abierta.
      **Aceptación**: test de éxito y del error de ventana cerrada que devuelve Meta (código 131047).
- [ ] 2.3 Traducción de los errores de envío más comunes (número sin WhatsApp, ventana cerrada,
      plantilla no aprobada, límite diario alcanzado).
      **Aceptación**: un test por caso, con el texto en castellano.

## 3. Modelo — `message_logs`
- [ ] 3.1 Agregar `providerMessageId` (indexado), `channel`, `templateId`, `errorMessage`.
      **Aceptación**: `RUN_MIGRATE=1` agrega las columnas; los logs viejos siguen leyéndose.
- [ ] 3.2 Declarar los cuatro campos en el `orm.define` y en los DTOs.
      **Aceptación**: test que escribe y relee los cuatro (anti-patrón ORM).
- [ ] 3.3 Verificar que `auto-message-dedupe` y la proyección del detalle de reserva siguen andando:
      `response` NO cambia de significado.
      **Aceptación**: los tests existentes de `marketing` y `reservas` pasan sin tocarlos.

## 4. Backend — envío desde la reserva
- [ ] 4.1 `reservas/usecases/send-whatsapp.ts`: orquesta conexión → ventana → plantilla → log `queued` →
      envío → log `sent`. **Aceptación**: si Meta falla, la fila queda `failed` con motivo, nunca `sent`.
- [ ] 4.2 Cálculo de la ventana de 24 h con el último entrante; sin datos, cerrada.
      **Aceptación**: los tres escenarios del REQ-2.
- [ ] 4.3 Dedupe `(reservationId, templateId, día)` reusando `auto-message-dedupe`.
      **Aceptación**: dos envíos seguidos generan una sola llamada a Meta.
- [ ] 4.4 Connector `reservas-whatsapp` para las credenciales (regla: nada de imports entre módulos).
      **Aceptación**: `arckode analyze` en 0 violaciones.
- [ ] 4.5 Ruta `POST /api/reservas/:id/whatsapp` con `guard('reservations','edit')` +
      `assertReservationOwned`. **Aceptación**: test cross-tenant.

## 5. Webhook de estados de entrega
- [ ] 5.1 Extender el webhook existente (`ai-recepcionista/controller.ts:164`) para procesar el array
      `statuses` además de `messages`.
      **Aceptación**: un payload real de Meta con `statuses` actualiza la fila correspondiente.
- [ ] 5.2 Emparejar por `providerMessageId`; `wamid` desconocido se ignora sin error.
      **Aceptación**: test de webhook con un id que no existe → 200 y ninguna escritura.
- [ ] 5.3 No retroceder el estado (`read` no vuelve a `delivered`).
      **Aceptación**: test de webhook fuera de orden.
- [ ] 5.4 Connector para que `ai-recepcionista` pueda actualizar `message_logs`, que es de `marketing`.
      **Aceptación**: sin import directo entre módulos.

## 6. Frontend
- [ ] 6.1 `Reservation.service.ts`: `sendWhatsapp(id, payload)`.
      **Aceptación**: tipado sin `any`.
- [ ] 6.2 `ReservationModal.vue`: el botón envía por API cuando hay conexión; si no, cae al enlace
      `wa.me` actual. **Aceptación**: los dos caminos se pueden ver; el estado de carga bloquea el botón.
- [ ] 6.3 Confirmación previa con el número destino completo a la vista.
      **Aceptación**: no se puede enviar sin ver a qué número va.
- [ ] 6.4 Selector de plantilla aprobada cuando la ventana está cerrada.
      **Aceptación**: solo aparecen plantillas `APPROVED`.
- [ ] 6.5 Historial de Envíos: columna de canal y estado real, con el motivo del fallo.
      **Aceptación**: se distingue a simple vista un envío por API de uno manual.
- [ ] 6.6 Unificar los otros dos puntos con `wa.me` (`ReservationCalendar.vue`,
      `ReservationWizardModal.vue`) para que usen el mismo camino.
      **Aceptación**: no queda normalización de teléfono duplicada en el frontend.

## 7. Verificación
- [ ] 7.1 `cd backend && bun run node_modules/arckode-framework/bin/arckode.js analyze` → 0 violaciones.
- [ ] 7.2 `cd backend && bun run typecheck && bun test`.
- [ ] 7.3 `cd frontend && bun run typecheck && bun run build`.
- [ ] 7.4 Prueba real contra la cuenta de prueba: enviar plantilla a un número registrado, ver el
      mensaje en el celular, ver `sent` y después `delivered` en el historial.
      **Aceptación**: capturas de las dos pantallas y del teléfono.
