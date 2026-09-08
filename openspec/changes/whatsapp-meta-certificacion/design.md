# whatsapp-meta-certificacion — Design

## Qué pide Meta y quién lo tiene

| Lo que Meta exige | Dónde está hoy | Quién lo resuelve |
|---|---|---|
| App verificada y configurada | Listo (documento del equipo) | — |
| Vídeo del PMS usando WhatsApp de verdad | No existe | Nosotros, al final |
| Lista de proveedores externos | Relevada, falta 1 fila | Equipo |
| Usuario de prueba para el revisor | No existe | Nosotros |
| App Secret en el servidor | Falta | Equipo → despliegue |
| WABA ID de prueba | Falta | Equipo |

## Variables de entorno que faltan en producción

```
META_APP_ID=1727869705161184        # público, ya conocido
META_APP_SECRET=…                   # Meta → Configuración → Básica → Mostrar
META_GRAPH_VERSION=v26.0            # la registrada para esta app
WHATSAPP_APP_SECRET=…               # el mismo secreto; lo lee el webhook desde antes
```

`WHATSAPP_APP_SECRET` ya lo consume el código (`ai-recepcionista/controller.ts:173`) pero **no está
documentado en `.env.example`**, así que un despliegue limpio arranca con el webhook mudo y sin que nada
lo advierta más allá de un warning. Documentarlo es parte de este change.

## El problema de Baileys, en concreto

```
Panel del hotel
 └── Recepcionista IA
      └── Configuración
           └── pestaña WhatsApp  ← acá se ve un QR para vincular WhatsApp Web
                                    (vía NO oficial, contra las condiciones de Meta)
```

Tres niveles de solución, de menor a mayor costo:

1. **Ocultar la pestaña** cuando el hotel tiene conexión oficial (`connectionMode='meta'`) o cuando es
   el hotel de prueba. Barato, suficiente para certificar.
2. **Ocultarla siempre** y dejar el código para los hoteles que ya la usan, sin punto de entrada nuevo.
3. **Quitar Baileys del todo**. Rompe a los hoteles que hoy dependen de él: exige avisarles y migrarlos.

Este change hace el nivel 1 y deja documentado el 2 y el 3. Lo que **no** es aceptable es dejarlo
visible y esperar que el revisor no lo abra.

## Los siete momentos del vídeo

En este orden, sin cortes, entre 2 y 4 minutos:

1. Entrar al PMS como un hotel.
2. Configuración → Integraciones → **Conectar WhatsApp**, con la ventana de Meta apareciendo y la
   autorización completándose. *(obligatorio: sin esto, rechazo)*
3. La tarjeta mostrando el número ya conectado.
4. Abrir una reserva y enviar la confirmación por WhatsApp.
5. El teléfono del huésped recibiendo el mensaje.
6. El huésped responde y esa respuesta entrando al PMS.
7. La pantalla de plantillas con una creada y su estado.

Cada momento depende de un change distinto:

| Momento | Depende de |
|---|---|
| 2 y 3 | `whatsapp-meta-onboarding` |
| 4 y 5 | `whatsapp-meta-messaging` |
| 6 | `whatsapp-meta-inbox` |
| 7 | `whatsapp-meta-templates` |

Por eso el vídeo es lo último: **no se puede grabar por partes**.

## El hotel de prueba

Un hotel con nombre inventado, tres o cuatro habitaciones, dos reservas con huéspedes ficticios cuyos
teléfonos sean números de prueba registrados en la consola de Meta. Un usuario dedicado para el revisor,
con permisos suficientes para recorrer el flujo y nada más. Las credenciales se le pasan a Meta por el
formulario, **no se escriben en el repositorio**.
