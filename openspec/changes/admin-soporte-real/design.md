# Diseño — admin-soporte-real

## Decisión 1 — Los nombres los resuelve el servidor, en lote

**Contexto**: el ticket guarda `userId`, `hotelId` y `assignedTo` como ids. La regla del proyecto
("cualquier vista que muestre el nombre de un usuario del hotel resuelve por `/usuarios`") no
alcanza acá: el hotel necesita el nombre del **agente**, que no es usuario de su hotel y no aparece
en su `/api/usuarios`.

**Decisión**: `TicketsService.list/getById` devuelven el ticket **enriquecido** con `requester`,
`hotel` y `assignee`, resueltos en un usecase `usecases/enrich.ts` que hace, por página, una
consulta a `users` (`findMany({ id: { in: ids } })` o el equivalente que exponga el
`RepositoryAdapter`; si no hay `in`, `findMany({})` filtrado en memoria — hay pocos usuarios) y
una a `hotels`.

```
tickets (página)  ──► ids distintos de userId ∪ assignedTo ──► users  (1 consulta)
                  ──► ids distintos de hotelId              ──► hotels (1 consulta)
                  ──► mapa id→{name,…} ──► ticket + requester + hotel + assignee
```

**Alternativa descartada**: joins en el ORM. `OrmRepository` no expone joins y la regla del repo
prohíbe SQL crudo en módulos. Dos consultas por página cuestan nada.

**Alternativa descartada**: que el frontend resuelva por `/api/usuarios` y `/api/hoteles`. Funciona
para el agente (ve todo) pero no para el hotel (no ve al agente), y duplica la lógica en dos vistas.

## Decisión 2 — La conversación se escribe por un endpoint propio

Hoy `messages` es un JSON que el cliente reemplaza entero por `PUT`, con el autor que quiera. Eso
tiene dos problemas: cualquier usuario del hotel puede escribir un mensaje "de soporte", y dos
personas respondiendo a la vez se pisan la lista.

**Decisión**: `POST /api/tickets/:id/messages { message }`. El servidor lee el ticket, agrega el
mensaje con el autor tomado de `req.user`, aplica las reglas de atención (REQ-SOP-03) y persiste.
`messages` deja de ser escribible por `PUT` (se saca del schema y del DTO).

`authorKind` se deriva de `req.user.userType` — es el mismo claim que separa `/admin/*` de
`/panel/*` y el token de impersonación lo fija en `'merchant'`, así que un agente impersonando
**no** puede escribir como soporte desde adentro de la cuenta del cliente. Además, la ruta lleva
`denyImpersonation()` para que tampoco escriba como el cliente.

Forma persistida del mensaje:

```ts
interface TicketMessage {
  id: string            // uuid, para keys estables en la UI
  authorId: string
  authorName: string    // snapshot: si el usuario cambia de nombre, el historial no se reescribe
  authorKind: 'support' | 'hotel'
  message: string
  createdAt: string     // ISO
}
```

`authorName` es un snapshot a propósito: un historial de soporte es un registro; no debe cambiar
retroactivamente si el agente se renombra o se elimina.

**Compatibilidad**: los mensajes viejos `{ author, date, message }` se normalizan al leer
(`normalizeMessage`). No hay migración de datos: son pocos, la forma vieja se reconoce por la
ausencia de `authorKind`, y una migración sobre JSON en dos motores es más riesgo que valor.

## Decisión 3 — "Atender" es un efecto de responder, no un botón aparte

No hay un equipo de soporte con despacho: hay un agente que abre el ticket y contesta. Pedirle que
además pulse "Asignarme" es un paso que se olvida y deja `assignedTo` vacío, que es exactamente el
bug de hoy.

**Decisión**: la primera respuesta de un agente asigna el ticket (`assignedTo`) y lo pasa a
`in_progress`. Cambiar a `in_progress` a mano también asigna. Una vez asignado, otro agente puede
responder sin robar la asignación. `assignedTo` solo lo escribe un token `userType: 'admin'`.

Lo que ve el hotel: "Atendido por Ana" en la cabecera + "Ana · Soporte" en cada burbuja del agente.
Ambos salen de datos del servidor (`assignee.name`, `authorName`), nunca de un literal.

## Decisión 4 — "Entrar como" reutiliza la impersonación existente, sin atajos

`usuarios/usecases/impersonate.ts` ya resolvió lo difícil (rol real del cliente, `merchant`, 2 h,
sin refresh token, sin tocar `users.token`). El botón del ticket llama a `auth.loginAs(requester.id)`
igual que `users.vue` y `hotels.vue`.

Lo único que se agrega es **contexto**: el body opcional `{ ticketId }` en `POST /api/auth/impersonate/:id`
para que la fila del audit log diga *por qué* soporte entró a esa cuenta. Es lo primero que se va a
pedir cuando un hotel pregunte "quién entró a mi cuenta y para qué".

Aterrizaje: `/panel/support?ticket=<id>`. La vista del hotel ya carga la lista; solo abre el ticket
cuyo id coincide. Si no está (otro hotel, borrado), no hace nada y no rompe.

## Decisión 5 — Caché del listado por versión

`tickets:list:all` (super admin) nunca se invalida porque `create/update` borran `tickets:list:{hotelId}`.
Además la clave ignora filtros y paginación, así que dos consultas distintas comparten entrada.
Se adopta el patrón ya usado en `facturas/usecases/cache.ts`: la clave incluye un token de versión
por hotel **y** uno global, y cualquier escritura bumpea ambos. `CacheAdapter` no tiene borrado por
prefijo (`cache.delete('x:*')` no borra nada), así que el bump es la única forma correcta.

## Decisión 6 — Notificar por connector, con el nombre del agente

`modules/tickets` no importa `modules/notificaciones` (regla: nada de imports entre módulos). Se
agrega `connectors/tickets-notificaciones.ts` que engancha `onTicketsMessageAdded` y
`onTicketsUpdated` (sockets del módulo) y crea la notificación para el hotel del ticket. Se agrega
el socket `onTicketsMessageAdded` a `TicketsSockets` (interfaz append-only).

El texto lleva el nombre del agente porque es la respuesta directa al pedido: "el usuario tiene que
saber quién lo atendió" — no solo en el ticket, también cuando le avisan.

## Decisión 7 — Sacar el gate por plan de los tickets

`tickets/index.ts` gatea las 5 rutas por `operations.maintenance` con el argumento "los tickets son
incidencias de mantenimiento". Pero las dos únicas pantallas que consumen `/api/tickets` son
`/admin/support` y `/panel/support`: son el canal de soporte hacia la plataforma. Un hotel en un
plan sin mantenimiento hoy ve "Error al cargar tickets" en la pantalla de ayuda, que es la peor
pantalla posible para fallar.

**Decisión**: se retira el gate por módulo. Se mantiene el permiso `reports:*` (no ampliar el
alcance del sistema de permisos en este change; deuda anotada: crear `support:view/create`).
