# whatsapp-meta-onboarding

## Intent

Que **cada hotel conecte su propio número de WhatsApp** a SOLMI OS desde el panel, con el flujo oficial
de Meta (**Embedded Signup**), y que la conexión se vea y se pueda deshacer. Es REQ-META-01 y
REQ-META-02 de `PARA EL EQUIPO - LO QUE FALTA EN EL PMS PARA META` (documento del equipo de Meta,
2026-09-02).

Referencia MisterPlan: `archive/match-misterplan/tasks.md` 7.2.1 "Meta Business setup" — quedó cerrada
como *documentación*; este change la convierte en producto. Es la pieza **bloqueante** para todo lo
demás: sin conexión no hay plantillas propias, ni envío, ni recepción. Y es el momento que
**Meta exige ver grabado** para aprobar la app.

## El modelo de uso que estamos implementando

SOLMI OS actúa como **Proveedor de Tecnología** ante Meta: una sola app (`1727869705161184`) que
opera **en nombre de** muchas cuentas de WhatsApp, una por hotel.

```
        SOLMI OS — App de Meta (Tech Provider)
                     │
     ┌───────────────┼───────────────┐
     ▼               ▼               ▼
  Hotel A         Hotel B         Hotel C
  su WABA         su WABA         su WABA
  su número       su número       su número
```

Consecuencias que definen el diseño y que NO son negociables (son reglas de Meta):

1. **El número se muda a la nube.** Un número conectado a la Cloud API **deja de funcionar en la app de
   WhatsApp del celular**. El hotel pasa a responder desde el PMS. Hay que decírselo ANTES de conectar,
   dentro del propio flujo — si se entera después, perdió su WhatsApp sin saberlo.
2. **La ventana de 24 horas.** Fuera de las 24 h desde el último mensaje del huésped, solo se puede
   iniciar con una plantilla aprobada. Esto condiciona `whatsapp-meta-messaging` y `whatsapp-meta-inbox`.
3. **Límites por verificación.** Un hotel sin su Business Manager verificado arranca en 250
   conversaciones/día. Es trámite del hotel, pero el panel debe mostrar en qué nivel está para que no
   parezca un fallo del PMS.

## Contexto (verificado en código, 2026-09-07)

- **La tarjeta actual no conecta nada.** `frontend/src/pages/super-admin/settings.vue:232` declara la
  tarjeta "WhatsApp Business" con dos campos en un array hardcodeado; los inputs usan `:value` sin
  `v-model` (`:142`) así que **lo tipeado nunca se guarda**, y la clave `configuration('integraciones')`
  que persiste (`:282`) **no la lee ningún consumidor** (`rg "'integraciones'"` → solo esa vista).
  Además está en `/admin/settings`, que es configuración **de plataforma**: el modelo real es por hotel.
- **La tabla destino ya existe**: `ai_whatsapp_config` (`ai-recepcionista/model.ts`), una fila por hotel,
  con `phoneNumberId`, `wabaId`, `accessToken`, `verifyToken`, `connectionMode ('baileys'|'meta')`.
  Faltan los datos de identidad que el hotel necesita VER (nombre del negocio, número legible,
  calidad, límite) y los de auditoría de la conexión.
- **No hay SDK de Facebook en el frontend**: `rg "connect.facebook.net"` solo encuentra el pixel
  (`useTracking.ts`), no el SDK de login.
- **Baileys sigue activo** (`ai-recepcionista/usecases/whatsapp-baileys-client.ts`, vinculación por QR
  desde `pages/ai-receptionist/config.vue`). Es una vía **no oficial**: convive hoy con lo que vamos a
  construir y es un riesgo de rechazo — se trata en `whatsapp-meta-certificacion`.
- Datos de Meta disponibles: App ID `1727869705161184`, config_id `1088480837040398`, portfolio
  comercial `1011818668506772`, API `v26.0`. **Falta el WABA ID de prueba y el App Secret** (los saca
  el equipo del panel de Meta; ver `whatsapp-meta-certificacion`).

## Decisión

- **La conexión vive en el panel del hotel** (`/panel/config` → Integraciones), no en `/admin/settings`.
  La tarjeta de super-admin se reemplaza por un estado de solo lectura por hotel (o se elimina).
- **Reusar `ai_whatsapp_config`** como única fila de conexión por hotel, extendida. No se crea una tabla
  nueva: duplicar `wabaId`/`accessToken` en dos lugares es garantía de desincronización.
  `connectionMode` pasa a ser el discriminador real entre `'meta'` (oficial) y `'baileys'` (legacy).
- **El canje del código lo hace el SERVIDOR.** El navegador recibe de Meta un código de un solo uso y lo
  manda al backend; el `app_secret` y el token permanente NUNCA tocan el frontend. Es el mismo criterio
  que ya aplica `redactWhatsappConfig` (`ai-recepcionista/usecases/whatsapp-config.ts:47`).
- **Advertencia previa obligatoria**: el flujo muestra, antes de abrir la ventana de Meta, qué implica
  conectar (el número deja de andar en el celular) y ofrece la alternativa del número nuevo. No es
  cortesía: evita el reclamo de un hotel que perdió su WhatsApp.
- **Desconectar es reversible pero no silencioso**: borra el token local y desuscribe la app del WABA;
  el número queda liberado en Meta para volver a la app del celular con el proceso de Meta.

## Scope

- Campos nuevos en `ai_whatsapp_config` para la identidad y el estado de la conexión.
- Endpoint de canje de código (`POST /api/ai/whatsapp/connect`) + lectura de estado + desconexión.
- Cliente de Graph API para: canjear código, leer datos del número y del WABA, suscribir la app.
- UI de conexión en el panel del hotel: advertencia → botón → ventana de Meta → estado conectado.
- Retiro/reemplazo de la tarjeta muerta de `/admin/settings`.

## Out of scope

- Envío de mensajes (`whatsapp-meta-messaging`) y bandeja de entrada (`whatsapp-meta-inbox`).
- Plantillas (`whatsapp-meta-templates`, ya especificado).
- Registro de un número **nuevo** desde cero con verificación por SMS dentro del PMS: eso lo resuelve la
  propia ventana de Meta.
- Migración de los hoteles que hoy usan Baileys: se trata en `whatsapp-meta-certificacion`.

## Pregunta abierta (bloquea 4.x, no el resto)

**¿Quién le paga las conversaciones a Meta?** Si cada hotel pone su propia tarjeta, alcanza con lo de
acá. Si SOLMI OS las factura (línea de crédito compartida del partner), hay que agregar la asignación de
crédito al flujo de conexión y medir el consumo por hotel. **Decisión de negocio, pendiente.**

## Riesgos y rollback

- **Riesgo alto**: un token mal guardado deja al hotel sin WhatsApp y sin poder volver atrás solo.
  Mitigación: no se borra `baileysCredentials` al conectar por Meta; `connectionMode` decide cuál se usa.
- **Riesgo**: la ventana de Meta cambia de comportamiento entre versiones del SDK. Mitigación: versión
  del SDK y `config_id` en constantes, no repartidos por el código.
- **Rollback**: `connectionMode` vuelve a `'baileys'` y la UI nueva queda detrás de un flag; nada de lo
  agregado es destructivo (solo columnas nuevas, `ADD COLUMN`). Ninguna columna existente cambia de
  nombre ni de tipo.
