# finanzas-consolidacion — Tasks

> Auditoría de origen: 2026-09-06, código en `main` @ `5ada649c` + datos de producción.
> Cada tarea es autocontenida: incluye el problema con `archivo:línea`, qué hacer, criterios de
> aceptación en Given/When/Then y el comando exacto para verificarla.
>
> Regla transversal: **ninguna tarea se marca `[x]` sin un test que falle antes del fix y pase
> después.** Debilitar un assert, mockear el bug o apagar la funcionalidad no cuenta.

## Phase 1 — Parar el daño

### 1.1 Facturación desde la IA

**Acceptance:** Toda factura del sistema nace por `facturas.create`, con enums válidos, impuestos del hotel y numerador correlativo.

- [ ] 1.1 La IA emite facturas inválidas y sin autenticación
> **Severidad:** crítica · **Tipo:** bug · **Módulos:** `ai-recepcionista`, `facturas`, `connectors`
>
> **Problema**
> La tool `generate_invoice` del recepcionista IA escribe **directo contra el repositorio**
> `Invoices` (`backend/src/modules/ai-recepcionista/usecases/llm-pipeline.ts:570-614`, repo
> inyectado en `ai-recepcionista/index.ts:86,101`), salteándose el usecase de creación
> `facturas/usecases/create-invoice.ts`. Lo que graba está mal en cinco puntos:
>
> | Qué graba | Por qué está mal |
> |---|---|
> | `type: 'stay'` | No existe en `TYPE_ENUM` (`facturas/validators/schema.ts:5`), que solo admite `invoice` y `credit_note` |
> | `status: 'issued'` | No existe en `STATUS_ENUM` (`schema.ts:6`): `pending·paid·overdue·cancelled·draft` |
> | `taxRate` fijo `0.16` (`llm-pipeline.ts:584`) | Ignora `configuration(key='taxes')` y `hotels.taxRate` |
> | `invoiceNumber` con `Date.now().toString(36)` | No consume `invoice_counter_{hotelId}_{year}` → rompe la correlatividad |
> | `amount` sin impuestos | El resto del sistema define `amount` = TOTAL (`facturas/types.ts:4,32`) |
>
> Además **no emite `onFacturasCreated`**, así que la factura no devenga en contabilidad ni
> invalida la caché de listados. Y la ruta `/api/ai/chat/:slug` (`ai-recepcionista/index.ts:147-150`)
> **es pública, sin auth** — un visitante anónimo puede dispararla.
>
> **Qué hacer**
> 1. Crear `backend/src/connectors/ai-facturas.ts` que exponga a `ai-recepcionista` un puerto
>    `createInvoice(dto, user)` delegando en `facturas.create`. **NO** importar `facturas` desde
>    `ai-recepcionista` (regla: los módulos no se importan entre sí, solo por connector).
> 2. Reemplazar el `invoiceRepo.create(...)` de `llm-pipeline.ts:570-614` por la llamada al puerto.
> 3. Quitar el repo `Invoices` de las dependencias de `ai-recepcionista` si no queda otro uso.
> 4. **Gate de seguridad**: la tool solo está disponible si la conversación llegó por un canal
>    autenticado. En el WebChat público debe responder que no puede emitir facturas y ofrecer
>    contactar a recepción. Motivo: emitir una factura consume secuencia NCF; un endpoint anónimo
>    que la consume permite agotar el numerador fiscal.
>
> **Criterios de aceptación**
> - [ ] **Dado** una conversación autenticada con un huésped del hotel H,
>       **cuando** la IA ejecuta `generate_invoice`,
>       **entonces** la factura resultante tiene `type='invoice'`, `status` ∈ `{pending,paid}`,
>       `invoiceNumber` con formato `INV-{año}-{4 dígitos}` y el contador del hotel incrementado en 1.
> - [ ] **Dado** un hotel con `configuration(key='taxes')` al 18 %,
>       **cuando** la IA factura 100,00 de neto,
>       **entonces** `amount` = 118,00 y `taxes` = 18,00 (nunca 0,16 hardcodeado).
> - [ ] **Dado** una conversación del WebChat **público** (`/api/ai/chat/:slug` sin token),
>       **cuando** el usuario pide una factura,
>       **entonces** no se crea ninguna fila en `invoices` y la IA responde que debe pedirla en recepción.
> - [ ] **Dado** que la IA emitió una factura,
>       **cuando** se consulta `GET /api/facturas/stats`,
>       **entonces** esa factura aparece en el total (hoy no aparece: `stats.ts:27` filtra `type:'invoice'`).
> - [ ] `arckode analyze` sigue en 0 violaciones (el connector es la forma válida; un import directo
>       lo haría fallar).
>
> **Verificación**
> ```bash
> cd backend && bun test src/modules/ai-recepcionista
> cd backend && bun run node_modules/arckode-framework/bin/arckode.js analyze
> ```

### 1.2 Código muerto de links de pago

**Acceptance:** Existe un solo sistema de links de pago en el código y es el que la UI usa.

- [ ] 1.2 Eliminar el sistema muerto `payment_links`
> **Severidad:** crítica · **Tipo:** refactor · **Módulos:** `payments`
>
> **Problema**
> Hay **dos** sistemas de links de pago con el mismo nombre:
>
> - **`payment_links`** (`backend/src/modules/payments/model.ts:42-60`) — endpoints vivos
>   `GET/POST /api/payment-links`, `DELETE /api/payment-links/:id` y **`GET /api/public/payment-links/:token`
>   (público)** en `payments/index.ts:85-87,101`. Pero **no hay ningún endpoint para pagar el link**, y
>   `PaymentLinksUseCase.markUsed()` (`payments/usecases/payment-links.ts:63-76`) —lo único que
>   escribiría `useCount`, `status:'used'` y `paymentId`— **no se invoca desde ningún lado**
>   (verificado con `rg` en todo `backend/src`: solo la definición). El socket `onLinkUsed`
>   (`payments/sockets.ts:17`) nunca se emite. En producción: **0 filas**.
> - **`payment_requests`** (`backend/src/shared/models.ts:291-308`) — el que la UI realmente usa
>   (`frontend/src/services/Payments.service.ts:21-35`), con checkout de Stripe y webhook que cierra
>   el ciclo (`payment-requests/usecases/stripe-webhook.ts`).
>
> **Qué hacer**
> 1. Eliminar del modelo `payments/model.ts:42-60` la definición `payment_links`.
> 2. Eliminar `payments/usecases/payment-links.ts` y sus rutas de `payments/index.ts:85-87,101`
>    (⚠️ `index.ts` es APPEND-ONLY para *agregar*; quitar rutas de código muerto es la excepción y
>    debe quedar registrada en el commit).
> 3. Eliminar `onLinkUsed` de `payments/sockets.ts:17` y sus referencias.
> 4. **NO dropear la tabla física.** `ormMigrate` no dropea; la tabla queda vacía y sin código que
>    la toque. Documentarlo en el commit.
>
> **Criterios de aceptación**
> - [ ] **Dado** el código después del cambio,
>       **cuando** se corre `rg "payment-links|payment_links|PaymentLinks" backend/src`,
>       **entonces** no hay resultados fuera de comentarios de migración.
> - [ ] **Dado** un cliente que llama `GET /api/public/payment-links/{cualquier-token}`,
>       **cuando** el endpoint ya no existe,
>       **entonces** responde 404 (no 200 con un link inservible).
> - [ ] **Dado** la pantalla `/panel/finanzas/links-pago`,
>       **cuando** se crea, se cobra y se cancela un link,
>       **entonces** funciona igual que antes (usa `payment_requests`, no se toca).
> - [ ] Backend arranca sin error y `bun test` pasa al 100 %.
>
> **Verificación**
> ```bash
> cd backend && rg -n "payment-links|payment_links|PaymentLinks|onLinkUsed" src/ ; bun test
> ```

### 1.3 Numerador de facturas

**Acceptance:** Dos facturas emitidas simultáneamente nunca comparten número.

- [ ] 1.3 El numerador dice ser atómico y es read-modify-write
> **Severidad:** alta · **Tipo:** bug · **Módulos:** `facturas`
>
> **Problema**
> `backend/src/modules/facturas/usecases/invoice-number.ts:104-131`: el comentario promete
> atomicidad, la implementación es `findOne` → `+1` → `update|create` **sin transacción, sin lock,
> sin `UPDATE ... RETURNING`**. Dos emisiones concurrentes leen el mismo `currentSeq` y producen el
> mismo `invoiceNumber`. No hay nada que lo frene: `facturas/model.ts:12` declara `invoiceNumber`
> **sin unique y sin índice** (solo `hotelId` está `indexed`, `model.ts:10`).
>
> Segundo defecto en el mismo archivo: ante cualquier excepción cae a
> `` `${prefix}-${year}-${Date.now()}` `` (`:127-130`), que rompe el formato de 4 dígitos y deja un
> agujero en la secuencia sin avisar.
>
> Tercero, menor: el parámetro `repo` de `nextInvoiceNumber` se recibe y nunca se usa (`:98`).
>
> **Qué hacer**
> 1. Índice único compuesto sobre `(hotelId, invoiceNumber)` — con `CREATE UNIQUE INDEX` explícito
>    en el script de migración, porque el ORM no crea unique compuesto (mismo patrón que
>    `idx_configuration_hotel_key`, ver `CLAUDE.md` → Portabilidad Postgres).
> 2. Numerador atómico: incremento condicional con reintento acotado (leer → intentar update con
>    `where` sobre el valor leído → si no afectó filas, releer y reintentar, máx. N veces). Debe
>    funcionar en **SQLite y Postgres** — nada de SQL específico de un motor.
> 3. El fallback por `Date.now()` **se elimina**: si no se puede numerar, la emisión **falla** con
>    error claro. Una factura sin número correlativo es peor que una factura no emitida.
> 4. Limpiar el parámetro `repo` no usado.
>
> **Criterios de aceptación**
> - [ ] **Dado** un hotel con contador en 7,
>       **cuando** se emiten 2 facturas en paralelo (`Promise.all`),
>       **entonces** los números son `INV-{año}-0008` y `INV-{año}-0009`, distintos, y el contador
>       queda en 9. **Este test debe fallar contra el código actual.**
> - [ ] **Dado** dos hoteles distintos,
>       **cuando** ambos emiten su primera factura del año,
>       **entonces** ambos obtienen `-0001` sin chocar (el unique es por `hotelId`).
> - [ ] **Dado** que el acceso a `configuration` falla,
>       **cuando** se intenta emitir,
>       **entonces** la operación tira error y **no** se crea la factura (hoy crea una con número
>       `INV-2026-1757...`).
> - [ ] **Dado** un DTO que ya trae `invoiceNumber`,
>       **cuando** se crea la factura,
>       **entonces** se respeta ese número y **no** se consume el contador (comportamiento actual,
>       `create-invoice.ts:44,54` — no debe cambiar).
> - [ ] El índice único se crea igual en SQLite y en Postgres.
>
> **Verificación**
> ```bash
> cd backend && bun test src/modules/facturas
> DB_PATH=/tmp/t.db RUN_MIGRATE=1 bun run src/composition-root.ts && bun run migrate
> ```

### 1.4 Puerto de pagos silencioso

**Acceptance:** Ninguna factura queda en `paid` sin su fila correspondiente en `payments`.

- [ ] 1.4 El puerto de pagos devuelve null y la factura se marca pagada igual
> **Severidad:** normal · **Tipo:** bug · **Módulos:** `facturas`, `connectors`
>
> **Problema**
> `backend/src/modules/facturas/usecases/payment-port.ts:66-71`: si el conector
> `facturas-payments` no está registrado, `recordInvoicePayment` **loguea un warning y devuelve
> `null`**. `pay-invoice.ts` sigue adelante y marca la factura `amountPaid += applied` /
> `status:'paid'` (`pay-invoice.ts:47-73`) **sin ninguna fila en `payments`**.
>
> Como `payments` es la única fuente de verdad del dinero, eso produce plata cobrada en el papel que
> no existe en el ledger: no entra al arqueo, no entra a la conciliación y no se puede devolver.
> Falla en silencio.
>
> **Qué hacer**
> Que `recordInvoicePayment` **tire error** cuando no hay conector, en vez de devolver `null`. El
> cobro entero debe fallar y la factura quedar intacta — que es exactamente lo que ya pasa cuando el
> conector existe pero el asiento falla (`pay-invoice.ts:11-12,56-67` asienta primero y factura
> después, por diseño).
>
> Revisar el mismo patrón en `payment-requests/usecases/payment-port.ts` y aplicar el criterio si
> se repite.
>
> **Criterios de aceptación**
> - [ ] **Dado** un sistema sin el conector `facturas-payments` registrado,
>       **cuando** se llama `POST /api/facturas/:id/pay`,
>       **entonces** responde error (no 200), **no** se modifica `amountPaid` ni `status` de la
>       factura, y no se crea fila en `payments`. **Este test debe fallar contra el código actual.**
> - [ ] **Dado** el conector registrado normalmente,
>       **cuando** se cobra una factura,
>       **entonces** el comportamiento es idéntico al actual (fila en `payments` + factura `paid`).
> - [ ] El mensaje de error nombra la causa real ("conector de pagos no registrado"), no un error
>       genérico.
>
> **Verificación**
> ```bash
> cd backend && bun test src/modules/facturas/tests
> ```

### 1.5 Datos de caja inconsistentes

**Acceptance:** Se sabe por qué hay 9 movimientos de caja con origen `payment_connector` y solo 5 cobros en efectivo.

- [ ] 1.5 Investigar la discrepancia de movimientos de caja en producción
> **Severidad:** normal · **Tipo:** bug · **Módulos:** `cash`, `connectors`
>
> **Problema**
> En producción (2026-09-06): `cash_movements` tiene **9 filas con `source='payment_connector'`**,
> pero `payments` tiene **solo 5 cobros en efectivo completados**.
>
> `backend/src/connectors/payments-caja.ts:19` corta con `if (payment.method !== 'cash') return`, y
> `cash/usecases/auto-movements.ts:39-62` deduplica por `paymentId`. Con esas dos reglas, deberían
> ser 5. **No pude explicar las otras 4 desde el código** — es un hallazgo abierto, no un diagnóstico.
>
> Hipótesis a descartar, en orden: (a) el `method` del payment se editó después de crear el
> movimiento; (b) hay payments borrados que dejaron el movimiento huérfano; (c) los movimientos
> vienen del POS de restaurante por otra ruta; (d) la dedup por `paymentId` no cubre algún camino.
>
> **Qué hacer**
> 1. Consultar producción cruzando `cash_movements.paymentId` contra `payments.id` y `payments.method`
>    para las 9 filas. Identificar cuáles no tienen contraparte en efectivo.
> 2. Determinar la causa real. **No corregir datos hasta saber la causa** — si es un bug de código,
>    corregir el código primero o los datos se vuelven a ensuciar.
> 3. Si aparece un bug, abrir la tarea de corrección enlazada a esta.
>
> **Criterios de aceptación**
> - [ ] Está documentado, con la consulta SQL y su salida, a qué corresponde cada una de las 9 filas.
> - [ ] Se concluye una de dos cosas, por escrito: (a) es dato legítimo y por qué, o (b) es un bug,
>       con `archivo:línea`.
> - [ ] Si es un bug, existe un test que lo reproduce.
> - [ ] **No se modificó ninguna fila de producción** como parte de esta tarea de diagnóstico.
>
> **Verificación**
> Consulta documentada en el comentario del issue, ejecutada contra la base de producción en modo
> lectura.

## Phase 2 — Coser las islas

### 2.1 Estado de cuenta del huésped

**Acceptance:** Una sola llamada contesta "cuánto debe este huésped y por qué".

- [ ] 2.1 Crear el estado de cuenta del huésped
> **Severidad:** alta · **Tipo:** feature · **Módulos:** `shared`, `reservas`
>
> **Problema**
> No existe. Verificado por búsqueda en todo `backend/src`: `estado de cuenta`, `statement`,
> `account-statement` → **0 resultados**. Hay tres agregadores parciales y ninguno completo:
>
> | Endpoint | Qué trae | Qué le falta |
> |---|---|---|
> | `GET /api/folios/:id` (`folios/usecases/enrich-folio.ts:15-32`) | cargos + totales + balance **de ese folio** | pagos sin folio, facturas, la reserva |
> | `GET /api/reservations/:id` (`reservas/usecases/detail.ts:9-90`) | `paidAmount`, `pendingAmount`, `payments`, `paymentHistory` | **no lee `folio_charges`** — no sabe qué consumió |
> | `GET /api/facturas/:id` | ítems de esa factura | todo lo demás |
>
> Si un huésped pregunta "¿cuánto debo y por qué?", hay que sumar a mano entre tres pantallas.
>
> **Qué hacer**
> 1. `backend/src/shared/usecases/guest-account-statement.ts` — cruza folio + `payments` + facturas
>    por reserva. Va en `shared/` porque toca tres módulos y no puede vivir en ninguno sin romper
>    la regla de imports (decisión D4 del `proposal.md`).
> 2. Exponerlo como `GET /api/reservas/:id/estado-cuenta`, permiso `billing:view`, con
>    `auth.assertOwnership()` sobre el `hotelId` de la reserva.
> 3. Respuesta: `{ charges[], payments[], invoices[], totals: { charged, paid, refunded, balance } }`.
>    Montos con `round2` importado de `shared/utils/money.ts` (regla STR-7 de `CLAUDE.md`: nada de
>    `round2` local).
> 4. El `balance` debe coincidir con el que ya calcula `shared/usecases/reservation-paid.ts` — si no
>    coincide, es que uno de los dos está mal y hay que resolverlo antes de cerrar la tarea.
>
> **Criterios de aceptación**
> - [ ] **Dado** una reserva con folio abierto, 3 cargos y 1 pago parcial,
>       **cuando** se llama `GET /api/reservas/:id/estado-cuenta`,
>       **entonces** devuelve los 3 cargos, el pago, y `balance = charged − paid` al centavo.
> - [ ] **Dado** una reserva con una seña cobrada por link de Stripe **y** un cobro en efectivo,
>       **cuando** se consulta el estado de cuenta,
>       **entonces** `paid` no cuenta la seña dos veces (respeta la fórmula de
>       `reservation-paid.ts:160-191`, que discrimina por `stripeSessionId`).
> - [ ] **Dado** un usuario de otro hotel,
>       **cuando** consulta la reserva,
>       **entonces** responde 403/404 y no filtra datos (multi-tenancy).
> - [ ] **Dado** una reserva sin folio,
>       **cuando** se consulta,
>       **entonces** responde 200 con listas vacías y `balance` correcto, no un error.
> - [ ] `totals.balance` coincide con `pendingAmount` de `GET /api/reservations/:id` para las mismas
>       reservas de prueba.
>
> **Verificación**
> ```bash
> cd backend && bun test src/shared && bun run node_modules/arckode-framework/bin/arckode.js analyze
> ```

### 2.2 Visibilidad del cobro en el cierre de turno

**Acceptance:** Al cerrar el turno, el recepcionista ve todo lo cobrado, no solo el efectivo.

- [ ] 2.2 Mostrar tarjeta y link en el cierre de turno (sin tocar el arqueo)
> **Severidad:** crítica · **Tipo:** improvement · **Módulos:** `cash`, `payments`, frontend
>
> **Problema**
> `backend/src/connectors/payments-caja.ts:19` descarta todo lo que no sea efectivo, así que un
> cobro con tarjeta, transferencia o link **nunca genera `cash_movements`**. Y el arqueo vuelve a
> filtrar por efectivo al calcular el esperado (`cash/usecases/reconcile.ts:12,41`).
>
> Para el **arqueo de billetes eso es correcto** y no se cambia. El problema es que **no hay ninguna
> otra pantalla que muestre el total cobrado del turno**: el recepcionista cierra sin ver los
> 1 616,60 que entraron por Stripe. En producción eso es el **64 % del dinero cobrado**.
>
> **Qué hacer**
> 1. `GET /api/caja/shifts/:id/reconcile` devuelve, además de lo actual, un bloque
>    `otherMethods: { card, transfer, link, other }` con lo cobrado en la ventana temporal del turno
>    (`openedAt` → `closedAt ?? now`), leído de `payments` con `status='completed'`.
> 2. Se lee vía connector (`cash` no puede importar `payments`). Reusar `connectors/payments-caja.ts`
>    agregándole un puerto de lectura, o crear uno nuevo si queda más limpio.
> 3. Frontend `components/features/CashRegisterView.vue`, modal "Cerrar turno — arqueo" (`:879`):
>    mostrar el desglose **en una sección separada, claramente marcada como informativa**, que
>    **no** entra en el cálculo de diferencia.
> 4. **No** modificar `expected` ni `difference`. El arqueo cuenta billetes.
>
> **Criterios de aceptación**
> - [ ] **Dado** un turno con 100 en efectivo y 500 por link,
>       **cuando** se pide la reconciliación,
>       **entonces** `expected` = fondo + 100 (sin el 500) y `otherMethods.link` = 500.
> - [ ] **Dado** el mismo turno,
>       **cuando** el cajero cuenta 100 exactos,
>       **entonces** `difference` = 0 (el link no genera un faltante falso).
> - [ ] **Dado** un cobro registrado **después** del cierre del turno,
>       **cuando** se recalcula,
>       **entonces** no se incluye en ese turno.
> - [ ] La pantalla de cierre distingue visualmente "Arqueo de efectivo" de "Otros cobros del turno
>       (informativo)". Un cajero no debe poder confundirlos.
> - [ ] Los turnos ya cerrados en producción siguen mostrando el mismo `expected`, `countedAmount` y
>       `difference` que antes del cambio.
>
> **Verificación**
> ```bash
> cd backend && bun test src/modules/cash
> cd frontend && bun run typecheck
> ```

### 2.3 Navegación entre las vistas de finanzas

**Acceptance:** Desde cualquier documento de dinero se llega a los relacionados en un clic.

- [ ] 2.3 Cablear la navegación cruzada factura ↔ folio ↔ reserva
> **Severidad:** normal · **Tipo:** improvement · **Módulos:** frontend
>
> **Problema**
> `rg "RouterLink|router-link|router.push"` sobre `pages/billing/index.vue`, `pages/folios/index.vue`,
> `pages/payments/index.vue`, `components/features/CashRegisterView.vue` y `pages/gastos/index.vue`
> → **cero coincidencias**. Son islas. Desde una factura no se llega al folio que la originó; desde
> un folio no se llega a su factura — **aunque el vínculo ya existe en la base**:
> `folios/model.ts:14` (`folio.invoiceId`) ↔ `facturas/model.ts:9` (`invoice.folioId`).
>
> Agravantes de menú (`frontend/src/layouts/AdminLayout.vue:303-311`): hay **dos "Caja"** distintas
> (Finanzas y Restaurante `:287`) y la conciliación bancaria vive en Tesorería, lejos del resto.
>
> **Qué hacer**
> 1. En el modal de factura (`pages/billing/index.vue:279`): si `invoice.folioId`, enlace al folio.
>    Si `invoice.reservationId`, enlace a la reserva.
> 2. En el detalle de folio (`pages/folios/index.vue:130`): si `folio.invoiceId`, enlace a la
>    factura. Enlace a la reserva y al estado de cuenta (tarea 2.1).
> 3. En la fila de cobro (tab Pagos de facturación): enlace a la reserva o factura de origen.
> 4. Usar `<router-link>`, **nunca** `<a href>` interno (regla del proyecto).
> 5. Desambiguar las dos "Caja" del menú: nombrarlas por su ámbito (p. ej. "Caja recepción" y
>    "Caja restaurante").
>
> **Criterios de aceptación**
> - [ ] **Dado** una factura nacida del cierre de un folio,
>       **cuando** se abre su modal,
>       **entonces** hay un enlace visible al folio y navega ahí sin recargar la página.
> - [ ] **Dado** un folio ya facturado,
>       **cuando** se abre su detalle,
>       **entonces** hay un enlace a la factura.
> - [ ] **Dado** una factura suelta (sin `folioId` ni `reservationId`),
>       **cuando** se abre,
>       **entonces** no se pintan enlaces rotos ni guiones vacíos (regla: los campos vacíos no se
>       pintan, ver skill `solmios-ui`).
> - [ ] `rg "<a href=\"/" frontend/src/pages/{billing,folios,payments}` → 0 resultados.
> - [ ] El menú ya no tiene dos entradas llamadas exactamente "Caja".
>
> **Verificación**
> ```bash
> cd frontend && bun run typecheck && bun run build
> ```
> Más comprobación en el navegador: recorrer factura → folio → reserva → estado de cuenta.

### 2.4 Factura manual desconectada

**Acceptance:** Una factura creada a mano queda ligada a su reserva y a su folio como cualquier otra.

- [ ] 2.4 La factura manual no se puede atar a reserva ni a folio
> **Severidad:** alta · **Tipo:** bug · **Módulos:** frontend `billing`, `facturas`
>
> **Problema**
> El modal "Nueva Factura" manda **`reservationId: null` clavado en el código**
> (`frontend/src/pages/billing/index.vue:1161`) y no tiene campo de folio. La habitación y el
> huésped se guardan como **texto suelto dentro de `notes`** (`:1156-1157,1165`); solo `guestId`
> viaja estructurado (`:1160`). El `roomId` ni se envía.
>
> Consecuencia: una factura hecha a mano no aparece en el historial de pagos de la reserva, no
> descuenta el saldo del folio y no se puede navegar hacia ella. Queda flotando.
>
> El modelo **ya soporta** el vínculo: `facturas/model.ts:8-9` tiene `reservationId` y `folioId`.
> Es solo que el formulario no los llena.
>
> **Qué hacer**
> 1. El autocomplete de habitación ya resuelve el huésped (`:1105,1125-1131`). Extenderlo para
>    resolver también la **reserva en curso** y el **folio abierto** de esa habitación.
> 2. Enviar `reservationId` y `folioId` en el payload en vez de `null`.
> 3. Verificar que `POST /api/facturas` los acepta y persiste (revisar
>    `facturas/validators/schema.ts` y `usecases/create-invoice.ts`); si el schema los descarta,
>    agregarlos — ojo con el anti-patrón ORM: **todo campo del DTO debe estar declarado en
>    `orm.define`** o se pierde en silencio (`CLAUDE.md` → Anti-patrón ORM).
> 4. Dejar de meter la habitación dentro de `notes` como texto.
>
> **Criterios de aceptación**
> - [ ] **Dado** una habitación ocupada con reserva y folio abierto,
>       **cuando** se crea una factura manual para esa habitación,
>       **entonces** la fila en `invoices` tiene `reservationId` y `folioId` poblados (verificable en
>       la base, no solo en la respuesta HTTP). **Este test debe fallar contra el código actual.**
> - [ ] **Dado** esa factura,
>       **cuando** se abre el detalle de la reserva,
>       **entonces** aparece en su historial.
> - [ ] **Dado** una habitación libre (sin reserva),
>       **cuando** se crea la factura,
>       **entonces** se crea igual con `reservationId` nulo, sin error.
> - [ ] `notes` ya no contiene la habitación como texto generado por el frontend.
>
> **Verificación**
> ```bash
> cd backend && bun test src/modules/facturas
> cd frontend && bun run typecheck
> ```

## Phase 3 — Cerrar el ciclo

### 3.1 Nota de crédito

**Acceptance:** Anular una factura produce un documento que resta y consume secuencia fiscal real.

- [ ] 3.1 La nota de crédito no pasa por el circuito fiscal y suma en vez de restar
> **Severidad:** alta · **Tipo:** bug · **Módulos:** `facturas`
>
> **Problema**
> `backend/src/modules/facturas/usecases/credit-note.ts:24-40` escribe **directo al repositorio**,
> salteándose `create-invoice.ts`. Cuatro defectos:
>
> | Qué hace | Qué debería |
> |---|---|
> | `amount` **positivo** (`:13,30`) pese a que su propio comentario dice "monto negativo" | Restar |
> | NCF sintético `NCF-CN-{invoiceNumber}` (`:35`) sin consumir la secuencia fiscal | Pasar por `issueNcf` (`fiscal.ts:84-118`) |
> | No copia `folioId` ni setea `fiscalSent` | Heredar el vínculo de la factura anulada |
> | No crea `invoice_items` | Espejar los ítems de la original |
>
> Con monto positivo, cualquier reporte que no filtre explícitamente por `type` **suma la anulación
> en vez de restarla**.
>
> **Precondición favorable**: producción tiene **0 notas de crédito**, así que no hay datos viejos
> que migrar.
>
> **Qué hacer**
> Hacer que la nota de crédito pase por el mismo camino que la factura (`create-invoice.ts`), con
> `type='credit_note'`, monto negativo, NCF de la secuencia real e ítems espejados.
>
> **Antes de cambiar el signo**: auditar todos los consumidores de `invoices` que suman `amount`
> (`usecases/stats.ts`, `tax-report.ts`, `dashboard/usecases/dashboard-queries.ts:19,97`,
> `treasury/index.ts:38`, `bookingengine/usecases/public-reservation.ts:104`) y confirmar que cada
> uno filtra por `type` o tolera negativos. Listar el resultado en el issue.
>
> **Criterios de aceptación**
> - [ ] **Dado** una factura de 118,00 con NCF emitido,
>       **cuando** se anula con `POST /api/facturas/:id/credit-note`,
>       **entonces** la nota tiene `amount = -118.00`, `type='credit_note'`, NCF de la secuencia
>       fiscal (contador incrementado) y `folioId` igual al de la original.
> - [ ] **Dado** esa nota,
>       **cuando** se consulta `GET /api/facturas/stats`,
>       **entonces** el total facturado **bajó** en 118,00 respecto de antes de anular.
> - [ ] **Dado** una factura con 3 ítems,
>       **cuando** se anula,
>       **entonces** la nota tiene los mismos 3 ítems con importes negativos.
> - [ ] **Dado** un hotel **sin** `electronic_invoicing.enabled`,
>       **cuando** se anula una factura,
>       **entonces** la nota se crea con `ncf = null` (no con un NCF inventado).
> - [ ] La factura original queda `cancelled`, igual que hoy.
> - [ ] Está documentado en el issue qué consumidores de `invoices` se auditaron y cuál fue el
>       veredicto de cada uno.
>
> **Verificación**
> ```bash
> cd backend && bun test src/modules/facturas
> ```

### 3.2 Política de facturación

**Acceptance:** El sistema deja de depender de qué botón se apretó para decidir si emite factura.

- [ ] 3.2 Definir y aplicar la política de facturación al cerrar
> **Severidad:** alta · **Tipo:** improvement · **Módulos:** `reservas`, `folios`, `facturas`, frontend
>
> **Problema**
> Hoy el checkout emite factura **solo si** el body trae `settle != null` **y** el folio tiene
> cargos (`shared/usecases/settle-folio-at-checkout.ts:92-107`,
> `reservas/controller.ts:243-246`). Un checkout con deuda manda `{settle:null}` y el folio **queda
> abierto para siempre**.
>
> El resultado en producción: **9 folios abiertos, 1 cerrado, 1 factura** sobre 57 reservas. La
> política de hecho es "casi nunca se factura", y es un efecto colateral del flujo, no una decisión.
>
> **Decisión requerida del dueño de producto** (no la puede tomar el dev):
> - **(a) Facturar siempre al cerrar el folio**, aunque quede saldo — la factura nace `pending` y el
>   saldo se persigue como cuenta por cobrar. Es lo que hace un PMS de hotel estándar.
> - **(b) Facturar a pedido**, pero entonces el folio **debe cerrarse igual** al hacer checkout, y la
>   deuda pasa a un estado explícito de cuenta por cobrar (no un folio abierto de un huésped que ya
>   se fue).
>
> En ambos casos el estado actual —folio abierto indefinidamente— deja de ser posible.
>
> **Qué hacer**
> 1. Registrar la decisión (a o b) en este issue **antes** de escribir código.
> 2. Implementarla en `settle-folio-at-checkout.ts`.
> 3. Los 9 folios abiertos de producción: decidir si se cierran con un script de migración o se
>    resuelven a mano desde el panel. **No** correr nada destructivo sin backup (`pg_dump`).
>
> **Criterios de aceptación**
> - [ ] La decisión (a) o (b) está escrita en el issue, con fecha y quién la tomó.
> - [ ] **Dado** un checkout con saldo pendiente y deuda reconocida,
>       **cuando** se confirma,
>       **entonces** el folio **no** queda `open` (queda `closed` con factura, o `closed` con cuenta
>       por cobrar, según la decisión).
> - [ ] **Dado** un folio sin cargos,
>       **cuando** se hace checkout,
>       **entonces** el folio se cierra sin emitir factura (comportamiento actual válido,
>       `settle-folio-at-checkout.ts:92-101`).
> - [ ] Existe un plan escrito para los 9 folios abiertos de producción, con backup previo.
> - [ ] La guarda de deuda del checkout (`reservas/usecases/checkout-debt-guard.ts`) sigue
>       funcionando: no se puede cerrar con saldo sin confirmarlo explícitamente.
>
> **Verificación**
> ```bash
> cd backend && bun test src/shared src/modules/reservas
> ```

### 3.3 Conector fiscal — deuda declarada

**Acceptance:** Queda registrado, con alcance, que el NCF hoy no llega a ninguna autoridad fiscal.

- [ ] 3.3 Conector fiscal real (fuera del alcance de este change)
> **Severidad:** alta · **Tipo:** documentation · **Módulos:** `facturas`
>
> **Problema**
> `backend/src/modules/facturas/usecases/fiscal.ts:54-61` usa `stubFiscalAdapter`, que **siempre**
> devuelve `sent:false`. Toda factura queda `fiscalSent:false` con el mensaje "Pendiente de envío…
> (configurar credenciales)". El NCF se genera y se numera correctamente, pero **no se transmite a
> ninguna autoridad**.
>
> Sin esto, el NCF es un número bien formado que no llegó a la DGII.
>
> **Qué hacer**
> Esta tarea **no implementa** el conector. Su entregable es dejar el alcance escrito para
> planificarlo aparte:
> 1. Confirmar la autoridad objetivo (DGII República Dominicana, por el uso de NCF).
> 2. Documentar qué credenciales, certificados y ambiente de pruebas hacen falta.
> 3. Estimar el trabajo y abrir el change propio.
>
> **Criterios de aceptación**
> - [ ] El issue documenta autoridad, credenciales necesarias y ambiente de prueba.
> - [ ] La fila "Facturación electrónica" de las deudas técnicas de `CLAUDE.md` apunta a este issue.
> - [ ] No se marca `[x]` como "arreglado": se cierra como documentado, con el change sucesor creado.
>
> **Verificación**
> No aplica — entregable documental.
