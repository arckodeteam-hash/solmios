# Evidencia — Reserva web con pago confirmado (epic #243, cierre #250)

Recorrido hecho el 2026-09-12 (≈05:05–05:20 UTC) **en producción** — `https://hotel.zx89.site`,
hotel demo *Hotel Boutique Palma* (`bca45933-075b-4f0b-bed2-322c3cd7a216`, slug
`hotel-boutique-palma`), Stripe en **modo TEST** — con Chromium headless vía Playwright 1.61.1
(viewport 1280×800). Sin SSH al servidor: todo lo que no se ve en pantalla se verificó por la API
pública/autenticada del panel (Bearer del usuario demo `hotel@solmios.com`).

Script reproducible: [`recorrido-prod.mjs`](./recorrido-prod.mjs) (constantes públicas, sin
secretos; se corre por pasos con `--only=N` / `--from=N` y guarda el estado en `$TMPDIR`).

| # | Captura | Qué muestra |
|---|---|---|
| 01 | `01-reserva-web.png` | Widget público `/book/hotel-boutique-palma`, paso 5/6 "Revisá y reservá": 2026-10-12 → 2026-10-14 (2 noches), Double · 2 adultos, huésped *Autowork Recorrido 250*, condiciones aceptadas. Al tocar **Pagar** el widget hizo `POST /api/public/booking` → **201** con `reservation.id = 21adf2fd-2fab-4d17-b947-65a87cbaa358` y `checkoutUrl` de Stripe, y redirigió solo |
| 01b | `01b-stripe-checkout.png` | Stripe Checkout hosted ("Entorno de prueba") para esa reserva: *Reserva 21adf2fd… \| Check-in: 2026-10-12* por 200,60 US$ (Stripe ofrece además 179,85 € por *adaptive pricing*) |
| 02 | `02-campanita.png` | Campanita del panel: **"Nueva reserva web — Autowork Recorrido 250"** (hab. 202, 2026-10-12 → 2026-10-14, 200.60 USD), debajo el aviso de OpenChannel |
| 03a | `03a-stripe-rechazada.png` | Stripe Checkout con `4000 0000 0000 0002`: "Se ha rechazado tu tarjeta de crédito. Intenta pagar con una tarjeta de débito." |
| 03 | `03-rechazado.png` | Modal de la reserva tras el rechazo: "Importe y Pago" **Pendiente**, "Pasarela de pago (1)" con la fila **Checkout abierto** (Stripe · TEST · `cs_test_…`). **La fila "Rechazado" NO apareció** — ver Hallazgos |
| 04a | `04a-confirmacion-huesped.png` | Tras pagar con `4242 4242 4242 4242`, Stripe volvió a `/h/hotel-boutique-palma/confirm?booking=21adf2fd…&token=…`: "¡Reserva confirmada!", Pagado 200.60 USD, "Pago recibido — no queda nada por pagar." |
| 04 | `04-pago-confirmado.png` | Modal de la reserva: cabecera **Confirmada**, badge **Pagada**, Pendiente de cobro US$0,00, "Historial de cobros (1)" +US$200,60 **Cobrado** (Link de pago, ref `cs_test_…`), "Pasarela de pago (2)": **Pagado** · Stripe · visa ····4242 · TEST (con "Ver en Stripe" y "Recibo") + Checkout abierto |
| 05 | `05-listado-pagada.png` | `/panel/reservas` filtrado por "Autowork Recorrido 250": fila hab. 202 **Confirmada / Pagada / Web / $200.6 USD**. La segunda fila (hab. 205, Pendiente) es un primer intento del script que no capturó el `checkoutUrl` — se anuló por API al final (ver Hallazgos) |
| 06 | `06-ota.png` | Campanita con **"Nueva reserva de OpenChannel — Huésped sin nombre"** (hab. 205, 2026-10-20 → 2026-10-22, 240.00 USD), arriba los avisos web y "Pago confirmado — Autowork Recorrido 250" |
| 06a | `06a-ota-modal.png` | Modal de la reserva OTA `AW250-1789189127` (badge **ota**, Confirmada): 2 noches × US$120, **Pendiente**, "Esta reserva no pasó por la pasarela." |
| 07a | `07a-registrar-pago-form.png` | Modal "Registrar pago" (`data-testid=mark-paid-button`): método **Transferencia**, monto 240 (saldo pendiente US$240,00), referencia `AW-250-TRANSFER` |
| 07 | `07-registrar-pago.png` | Toast "Pago registrado"; badge **Pagada**, Pendiente de cobro US$0,00, "Historial de cobros (1)": +US$240,00 **Cobrado** · Transferencia · *Registró: Hotel Admin Demo* · Ref `AW-250-TRANSFER`; "Pasarela de pago" sigue vacía (no pasó por la pasarela) |

## Verificación por API

Todas las lecturas con `Authorization: Bearer` del usuario demo (`POST /api/auth/login`).

### Reserva web `21adf2fd-2fab-4d17-b947-65a87cbaa358`

| Momento | Fuente | `status` | `paymentState` | `paidAmount` |
|---|---|---|---|---|
| Creada (05:07:52Z) | `GET /api/reservations/:id` | `pending` | `pending` | 0 |
| Tras el rechazo (05:11Z, +80 s de sondeo) | `GET /api/reservations/:id` | `pending` | `pending` | 0 |
| Tras el pago 4242 (05:13:24Z) | `GET /api/reservations/:id` | `confirmed` | `paid` | 200.6 (`chargeableTotal` 200.6) |
| Tras el pago 4242 | `GET /api/reservas?limit=200` (fila) | `pending` → `confirmed` | `pending` → `paid` | 0 → 200.6 (la fila tardó **≈4 min** en reflejarlo: caché del listado, ver Hallazgos) |

`paymentAttempts` del detalle (bloque *Pasarela de pago*, más reciente primero):

| kind | provider / mode | amount | card | providerRef | occurredAt | failure |
|---|---|---|---|---|---|---|
| `paid` | stripe / test | 200.6 usd | visa ····4242 | `cs_test_a1Hh4JiU…` (mismo checkout) · `receiptUrl` pay.stripe.com/receipts/… | 2026-09-12T05:13:24Z | — |
| `checkout_created` | stripe / test | 200.6 USD | — | `cs_test_a1Hh4JiU…` · `dashboardUrl` dashboard.stripe.com/test/payments/… | 2026-09-12T05:07:52Z | — |

**No hay fila `failed`** para el rechazo de las 05:11Z (sondeado hasta 80 s después y de nuevo a
las 05:18Z y 05:19Z, 7–8 min después).

`paymentHistory` del detalle tras el pago: 1 fila `charge` · `method: link` · `completed` ·
200.6 USD · "Reserva web · huésped · 2026-10-12" · `reference: cs_test_a1Hh4JiU…` · `registeredBy: ''`.

### Notificaciones (`GET /api/notificaciones`, `type: 'reservation'`)

| createdAt | title | message |
|---|---|---|
| 2026-09-12T05:13:26.413Z | Pago confirmado — Autowork Recorrido 250 | Autowork Recorrido 250, 200.60 usd por stripe |
| 2026-09-12T05:07:52.271Z | Nueva reserva web — Autowork Recorrido 250 | Autowork Recorrido 250, hab. 202, 2026-10-12 → 2026-10-14, 200.60 USD |
| 2026-09-12T05:06:44.104Z | Nueva reserva web — Autowork Recorrido 250 | (primer intento, hab. 205 — anulado después) |
| 2026-09-12T04:58:54.465Z | Nueva reserva de OpenChannel — Huésped sin nombre | Huésped sin nombre, hab. 205, 2026-10-20 → 2026-10-22, 240.00 USD |

### Cola de correo (`GET /api/email-queue`, guard `settings:view`)

| createdAt | recipient | subject | status |
|---|---|---|---|
| 2026-09-12T05:13:26.725Z | autowork+250@bot.zx89.site | Confirmación de reserva — Hotel Boutique Palma | sent |
| 2026-09-12T05:13:26.447Z | hotel@solmios.com | [SolmiOs] Pago confirmado — Autowork Recorrido 250 | sent |
| 2026-09-12T05:07:52.295Z | hotel@solmios.com | [SolmiOs] Nueva reserva web — Autowork Recorrido 250 | sent |
| 2026-09-12T05:06:44.229Z | hotel@solmios.com | [SolmiOs] Nueva reserva web — Autowork Recorrido 250 | sent (primer intento) |
| 2026-09-12T04:58:54.588Z | hotel@solmios.com | [SolmiOs] Nueva reserva de OpenChannel — Huésped sin nombre | sent |

### Reserva OTA simulada `5f4a6d57-18c4-490f-bb62-b24ac8abc881`

Creada antes del recorrido por la **Open Channel API de Channex staging** y la ingesta de SolmiOs
(receta abajo): booking Channex `7bd61f34-400b-4608-bb87-73b73ad87415`, `unique_id
OPN-AW250-1789189127`, `externalLocator AW250-1789189127`, `source: 'ota'`, `channel:
'OpenChannel'`, `status: 'confirmed'`, 2026-10-20 → 2026-10-22, 240 USD, `guest: null`,
`otaNotes: "Guest: Autowork OTA Simulada <autowork+250@bot.zx89.site> +18095550250 | revision
e43b3038… | booking 7bd61f34…"`, `paymentAttempts: []`.

`POST /api/reservas/5f4a6d57…/mark-paid` (desde el modal, método `transfer`, referencia
`AW-250-TRANSFER`) → **201**:

| | `paymentState` | `paidAmount` | `status` |
|---|---|---|---|
| antes | `pending` | 0 | `confirmed` |
| después | `paid` | 240 | `confirmed` |

`paymentHistory` después: 1 fila `charge` · `method: transfer` · `completed` · 240 USD · "Cobro
manual · transfer" · `reference: AW-250-TRANSFER` · `registeredBy: Hotel Admin Demo` ·
2026-09-12T05:19:32Z. El pago manual **no** generó aviso en campanita ni correo (la última
notificación sigue siendo la de 05:13:26Z) — el aviso "Pago confirmado" es de la pasarela.

Receta de la OTA simulada (está como `crearReservaOtaSimulada()` en el script):

1. `POST https://secure-staging.channex.io/api/v1/channel_webhooks/open_channel/new_booking`,
   header `api-key: open_channel_api_key` (literal público del sandbox), body
   `{"booking":{"status":"new","provider_code":"OpenChannel","ota_name":"OpenChannel","hotel_code":"<hotelId>","reservation_id":"AW250-<ts>","arrival_date":"…","departure_date":"…","currency":"USD","customer":{"name","surname","mail","phone"},"rooms":[{"room_type_code":"double","occupancy":{"adults":2,"children":0,"infants":0},"days":[{"date":"…","price":"120.00","rate_plan_code":"double-bar"},…]}]}}`.
2. `POST https://hotel.zx89.site/api/channels/bookings/ingest` (Bearer, body `{}`) → "1 reservas creadas".

## 7.3 Deploy

- **`source='web'` en prod**: `GET /api/reservas?limit=200` del hotel demo devolvía **56 filas,
  22 con `source: 'web'`** antes del recorrido (`sources` presentes: `direct`, `ota`, `web`,
  `null`); después quedan 24 (las dos del recorrido). El `SELECT` directo sobre la base **no se
  pudo correr**: no hay SSH al servidor desde este puesto.
- **`payment_attempts` existe y se escribe**: el bloque *Pasarela de pago* del detalle
  (`GET /api/reservations/:id` → `paymentAttempts`) devolvió las filas `checkout_created` y `paid`
  de la reserva web con `providerRef`, `mode: test`, tarjeta y `receiptUrl` (capturas 03 y 04).
- Webhook de Stripe en prod: `checkout.session.completed` llegó y movió la reserva a
  `confirmed`/`paid`, con historial de cobro, aviso, correo al hotel y correo de confirmación al
  huésped, todo dentro de los 2 s posteriores al pago (05:13:24Z → 05:13:26Z).

## 7.1 Gates

- backend `bun run typecheck` OK
- backend `bun test --env-file .env.test` **6918 pass / 0 fail** (6921 tests, 621 archivos, 131 s)
- backend `bun run analyze` ✅ VÁLIDO sin violaciones
- frontend `bun run typecheck` OK
- frontend `bun run build` OK

## Hallazgos

Lo que **no** salió como dice el issue, o que conviene saber:

1. **El rechazo de tarjeta no dejó rastro en `payment_attempts` (prod).** Stripe Checkout mostró
   "Se ha rechazado tu tarjeta" con `4000 0000 0000 0002` (03a), pero la reserva nunca recibió una
   fila `kind: 'failed'`: se sondeó `GET /api/reservations/:id` 80 s tras el rechazo y de nuevo
   7–8 min después; el modal sigue mostrando sólo "Checkout abierto" (03) y el aviso ámbar "El
   último intento de cobro no se completó" no aparece. El código sí contempla
   `payment_intent.payment_failed` (`services/payment-gateway/stripe-gateway.ts`,
   `payments/usecases/settle-webhook.ts`). Lo que hay que mirar, con acceso al Dashboard de
   Stripe (test) del hotel demo: (a) qué eventos tiene habilitados el endpoint
   `/api/public/webhook/stripe/<hotelId>` — si sólo `checkout.session.completed`, el rechazo no
   viaja; (b) el log de eventos alrededor de las 05:11Z UTC del 2026-09-12 (PI del checkout
   `cs_test_a1Hh4JiU…`). No se inventó la captura "Rechazado": 03 muestra lo que hay.
2. **El listado tarda hasta 5 min en reflejar el pago.** `GET /api/reservas` seguía devolviendo
   la fila con `status: 'pending'`, `paymentState: 'pending'`, `paidAmount: 0` mientras el detalle
   ya decía `confirmed`/`paid` (1 min después del webhook); recién ≈4 min después cambió. Es el
   caché por versión de `reservas/usecases/cache.ts` (TTL 300 s): el camino del webhook de Stripe
   no bumpea la versión del listado. Un recepcionista que mira la lista ve "Pendiente" un rato
   después de que el huésped ya pagó.
3. **El aviso OTA dice "Huésped sin nombre"** aunque `otaNotes` trae "Guest: Autowork OTA
   Simulada <autowork+250@bot.zx89.site> +18095550250": la reserva OTA se creó con
   `guestId: null` / `guest: null` (el nombre quedó sólo en `otaNotes`), así que
   `notify-reservation-received.ts` cae al `GUEST_FALLBACK`. Mismo efecto en el subject del correo
   y en el modal (cabecera sin huésped).
4. **Moneda del widget vs. Stripe.** Por geo-IP el widget mostró el total en EUR (172,92 €) con la
   leyenda "Es exactamente el importe que se cobra en la pasarela", pero Stripe Checkout cobra
   200,60 US$ y ofrece, por *adaptive pricing*, 179,85 € (1 USD = 0,8966 EUR) — dos cifras en
   euros distintas para la misma reserva. El script eligió US$ en Stripe para que el intento quede
   en la moneda del hotel.
5. **Primer intento del script dejó una reserva huérfana.** El widget redirige a Stripe apenas
   recibe el 201 y el body se perdió con la navegación; esa reserva
   (`3f00799c-c76e-46d6-8a60-1c3d40072f35`, hab. 205, fila "Pendiente" en 05) quedó `pending` con
   su `checkout_created` y sin manera de recuperar el `checkoutUrl` (no hay endpoint que lo
   devuelva de nuevo: `POST /api/public/bookings/:id/checkout` responde 410 apuntando a
   `/api/public/reservations/:id/checkout`, que no existe en el router). Se anuló al final con
   `POST /api/reservas/:id/cancel` (motivo "Recorrido #250: primer intento…"). El script ahora
   captura el 201 con `page.route` (fetch + fulfill).
6. **Stripe Checkout nunca llega a `networkidle`** en headless: hay que esperar por
   `domcontentloaded` + el `#cardNumber`. El país por defecto salió *Francia* (geo-IP del puesto)
   y se cambió a República Dominicana.
