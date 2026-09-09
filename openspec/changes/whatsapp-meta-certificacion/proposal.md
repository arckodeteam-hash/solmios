# whatsapp-meta-certificacion

## Intent

Todo lo que **no es código** y sin lo cual Meta no aprueba la app: las credenciales que faltan en
producción, el saneamiento de la vía no oficial que hoy convive con la oficial, el entorno de prueba
para el revisor, los datos del formulario de Meta y la grabación del vídeo.

Es el cierre del documento del equipo de Meta (2026-09-02): *"Meta no aprueba la app sin ver un vídeo
del PMS usando WhatsApp de verdad. Ese es el único punto que falta"*.

Referencia MisterPlan: `archive/match-misterplan/tasks.md` 7.2.1 "Meta Business setup documentation"
(cerrada como documento) — acá se convierte en el trámite efectivo.

## Contexto (verificado, 2026-09-07)

- **`WHATSAPP_APP_SECRET` no existe en ningún `.env.example`** del repo (`rg` sobre `backend/.env.example`
  no lo encuentra), pero el webhook lo exige: sin él rechaza todo, con política de puerta cerrada
  (`ai-recepcionista/controller.ts:173-182`). O sea: el buzón está construido y apagado.
- **Baileys sigue vivo y alcanzable desde el panel**: Panel → Recepcionista IA → Configuración vincula
  WhatsApp escaneando un QR (`pages/ai-receptionist/config.vue`,
  `usecases/whatsapp-baileys-client.ts`). Es una vía **no oficial**, contraria a las condiciones de Meta.
  Si aparece en el vídeo o el revisor la encuentra navegando con el usuario de prueba, el rechazo es
  inmediato y queda como antecedente en la cuenta.
- **Faltan dos datos de Meta** que el documento del equipo no incluye ni menciona: el **WABA ID** de la
  cuenta de prueba y el **App Secret**. Los cuatro que sí figuran (App ID `1727869705161184`, config_id
  `1088480837040398`, portfolio `1011818668506772`, API `v26.0`) no alcanzan para llamar a la API.
- **Los proveedores externos ya están relevados** (van en la tarea 4.1): Contabo GmbH (VPS, datacenter
  en Francia), PostgreSQL en ese mismo servidor, SMTP por hotel con respaldo en Resend, y como terceros
  con acceso a datos: Stripe, Channex, TTLock, **DeepSeek/OpenAI**, Firebase, Google, Cloudflare, Open
  Exchange Rates y Meta Pixel. Falta confirmar únicamente dónde van los respaldos.

## Decisión

- **DeepSeek/OpenAI se declaran.** El contenido de los mensajes del huésped se manda a un modelo de
  lenguaje de un tercero (`ai-recepcionista/usecases/llm-provider.ts:27,29`). Meta lo pregunta de forma
  explícita; omitirlo y que lo detecten después es peor que declararlo.
- **El revisor entra a un hotel de prueba, no a uno real.** Datos ficticios, ninguna reserva ni huésped
  real a la vista. Las credenciales del revisor **no se guardan en el repositorio**.
- **Baileys se saca del camino antes de grabar.** Alcance mínimo aceptable: que no sea alcanzable desde
  el panel del hotel de prueba. Apagarlo del todo para los hoteles que hoy lo usan es una decisión
  aparte, con aviso previo, que no bloquea la certificación.
- **El vídeo se ensaya antes de grabarse.** Una toma sin cortes de 2 a 4 minutos con siete momentos en
  orden no sale a la primera; el ensayo es una tarea, no una improvisación.

## Scope

- Credenciales y variables de entorno en producción.
- Retiro de la vía no oficial del alcance del revisor.
- Hotel y usuario de prueba con datos ficticios.
- Formulario de Meta: proveedores externos y accesos.
- Guion, ensayo y grabación del vídeo; envío de la solicitud.

## Out of scope

- Todo el código de la integración: está en `whatsapp-meta-onboarding`, `whatsapp-meta-templates`,
  `whatsapp-meta-messaging` y `whatsapp-meta-inbox`. Este change **no escribe funcionalidad**.
- La migración de los hoteles que hoy usan Baileys a la vía oficial (change aparte, cuando la oficial
  esté probada).

## Riesgos

- **Un rechazo queda registrado.** Meta guarda el historial de solicitudes; mandar una solicitud a medias
  para "probar" encarece la siguiente. No se envía hasta que los siete pasos del vídeo se puedan hacer
  de corrido.
- **El vídeo muestra la pantalla completa.** Cualquier dato real que quede a la vista (un huésped, un
  teléfono, un correo) es una fuga hacia un tercero. De ahí el hotel de prueba.
- **El número de prueba de Meta caduca** y el token temporal de la consola dura 24 h: hay que grabar
  dentro de esa ventana o renovarlo.

## Rollback

No aplica en el sentido habitual: nada de esto cambia el comportamiento del producto salvo el retiro de
Baileys del panel, que se hace detrás de una condición y se revierte volviéndola a habilitar.
