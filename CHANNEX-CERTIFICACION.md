# Certificación PMS de Channex — estado y qué falta

> Guion oficial: https://docs.channex.io/api-v.1-documentation/pms-certification-tests
> Formulario: https://forms.gle/xA8F3eSYBPBd8apYA
> Última corrida: **2026-09-02**, contra **producción** (`solmios.com` → `staging.channex.io`).
> Detalle por test y task ids: `CHANNEX-CERTIFICACION-EVIDENCIA.md`. Historial del gap y las
> decisiones de diseño: `CHANNEX-CERTIFICACION-GAPS.md`.

## Veredicto

**Los 11 escenarios técnicos pasan, con el canal conectado y en el entorno público.**
26 checks OK · 0 fallidos. Lo que queda es administrativo (formulario + screenshare) y una
decisión de negocio (que la cuenta del examen no se quede sin plan a mitad de camino).

La corrida anterior (2026-09-01) valía menos de lo que parecía: corría contra un backend local y
contra una property **sin ningún canal conectado**. El examen no es eso — Channex dispara acciones
sobre la UI y mira lo que sale hacia **un canal mapeado**, y prueba la conexión de ese canal contra
un endpoint público antes de dejar activarlo. `localhost` no le llega.

## El entorno del examen

| Qué | Valor |
|---|---|
| Panel | https://solmios.com/panel/channel-manager (producción, apuntando a `staging.channex.io`) |
| Usuario | `cert@solmios.com` — dado de alta por el **registro público**, como cualquier hotel |
| Hotel del PMS | `a7c8d8e4-90a6-4431-862b-a09dff6bdc43` — "Test Property - SolmiOS" |
| Property en Channex | `bddf7d23-83c5-437d-a2ff-c4e85ccaf412` |
| Estructura | Twin Room (2 unidades, occ 2) · Double Room (2, occ 2) · BAR $100 + Bed & Breakfast $120 por tipo — el setup exacto que pide la doc |
| Canal | **SolmiOS Open** (`ef9481b7-…`), activo, **4 de 4 tarifas mapeadas** (`twin/twin-bar`, `twin/twin-bb`, `double/double-bar`, `double/double-bb`) |

La property **`f1f563dd-…`**, creada a mano para la corrida del 2026-09-01, quedó renombrada
"Test Property - SolmiOS (vieja, reemplazada 2026-09-02)" y ya no la usa nadie. La nueva la creó
el PMS solo, que es lo que Channex quiere ver.

### Cómo se reproduce desde la UI (lo que se muestra en la screenshare)

1. `/panel/channel-manager` → tarjeta **"Conectado a Channex"** (property, última sync, tipos y
   tarifas publicados) y la tarjeta del canal **"SolmiOS Open · Conectado"**.
2. **"Configurar tarifas"** (`channel-manager` → `channel-detail`, monta `ChannelRatesEditor.vue`) →
   precio base + ajuste por temporada por ocupación, **"Mín. al llegar"** (min stay arrival, por
   habitación), y por temporada los toggles **CTA/CTD**, **"Mín. en estadía"** (min stay through) y
   **"Cerrar ventas"** (stop sell); arriba, **"Enviar a canales"**. Al pie, **"Mapeo con el canal"**
   (4 de 4).
3. Planning / grilla de tarifas / reservas: cada acción dispara su push por evento.

## Los tests — corrida del 2026-09-02

Todos verificados con **readback contra la API de Channex**, nunca con el 200 del push, y contando
las llamadas en el rastro de `sync_log` (solo las salientes).

| Test | Llamadas | Estado |
|---|:--:|:--:|
| Setup Mapping (canal activo y mapeado) | — | ✅ |
| T1 Full sync 500 días | 2 (1 availability + 1 rates) | ✅ |
| T2 · T3 · T4 precios | 1 c/u | ✅ |
| T5 min stay · T6 stop sell · T7 CTA/CTD/max/min stay (arrival **y** through) | 1 c/u | ✅ |
| T8 medio año (dic 2026 → may 2027) | 1 | ✅ |
| T9 · T10 disponibilidad por reserva | 1 por reserva | ✅ |
| T11 recepción de reservas (feed + ack) | — | ✅ |
| T12 rate limits (18/min + backoff 429/5xx) | — | ✅ (`usecases/channex-http.ts`) |
| T13 update logic (por evento, sin full sync por timer) | — | ✅ |
| T14 cuestionario | — | redactado en `CHANNEX-CERTIFICACION-GAPS.md` §8 |

Reproducir la corrida:

```bash
cd backend && set -a && source .env && set +a
BASE_URL=https://solmios.com \
CERT_HOTEL_ID=a7c8d8e4-90a6-4431-862b-a09dff6bdc43 \
CERT_PROPERTY_ID=bddf7d23-83c5-437d-a2ff-c4e85ccaf412 \
CERT_EMAIL=cert@solmios.com CERT_PASSWORD='<la del alta>' \
bun run scripts/e2e/channex-certification.e2e.ts
```

## Lo que se arregló para llegar hasta acá (2026-09-02)

1. **Sincronizar dejaba al canal sin ningún mapeo.** El sync de estructura borraba y recreaba todos
   los room types y rate plans de una property que ya existía; los UUIDs cambiaban y el mapeo del
   canal —lo único que los referencia del otro lado— quedaba en **cero**, con la tarjeta todavía
   verde. Verificado en vivo: 4 mapeos → un `POST /api/channels/sync` → 0. Veto directo para la
   certificación, porque **el test 1 ES un full sync**. Ahora el sync es idempotente (update por
   título, mismo UUID) y no toca las copias derivadas que Channex crea para el canal.
   (`usecases/sync-structure.ts`)
2. **"Conectar" sobre un canal que ya existía fallaba** con "Validation Error" — Channex no acepta
   dos canales del mismo tipo en una property. Ahora re-mapea y reactiva el que está, que es lo que
   hay que hacer después de que un sync viejo dejara el mapeo en cero.
3. **El runner de evidencia corre contra el entorno público** (`CERT_HOTEL_ID`) sin tocar ninguna
   base, y verifica dos cosas nuevas: que el canal esté activo y mapeado, y que el mapeo **siga ahí
   después del full sync**.

## Lo que falta

| # | Qué | De quién depende |
|---|---|---|
| 1 | **El plan de la cuenta del examen**: el alta entró como prueba gratis y vence el **2026-09-09**. Si la screenshare cae después, el panel puede bloquearse a mitad del examen. Hay que asignarle un plan desde el admin (o mover la fecha). | Decisión del dueño |
| 2 | Screenshots de la pantalla de mapeo para adjuntar al formulario | Se pueden sacar del panel tal como está |
| 3 | Enviar el formulario con los task ids de `CHANNEX-CERTIFICACION-EVIDENCIA.md` y las respuestas del cuestionario (§8 de `-GAPS.md`) | Trámite |
| 4 | ~~`bun run doctor` escribe ARI sobre la primera property de la cuenta~~ **Resuelto el 2026-09-04**: el doctor sólo escribe si se le pasa `CHANNEX_PROPERTY_ID`; sin esa variable es **solo lectura**. Corrido así: **16 ✓ / 0 ✗**. Para ejercitar push+readback: `CHANNEX_PROPERTY_ID=bddf7d23-… bun run doctor` (pisa ARI de esa property con valores de prueba — no correrlo con el examen en curso). | — |

### Lo que se declara como NO soportado en el formulario

> Ojo con `-GAPS.md`: su cuerpo (congelado el 2026-09-01) declara **CTA/CTD** y **multi rate plan
> por tipo de habitación** como no soportados. Es falso desde P4/P5 — las dos cosas funcionan y
> están verificadas con readback. La §8 de ese documento ya está corregida; el resto no.

Channex lo permite si se anota. Sigue vigente lo de `-GAPS.md` §8:

- **`min_stay_through` sí se soporta**, igual que `min_stay_arrival`, y los dos tienen control en
  la UI (`push-overrides.ts:93`, `channex.ts:517`). La corrida los verifica con readback distinto
  (arrival 10 · through 7, T7). La salvedad real es que se editan en **dos lugares distintos** del
  editor de tarifas del canal (`ChannelRatesEditor.vue`): **"Mín. al llegar"** es por habitación
  (arrival, `:61`) y **"Mín. en estadía"** es por temporada (through, `:93`) — no hay una grilla
  única que muestre los dos por fecha. Hasta el 2026-09-04 los rótulos eran "Días mín." y "Mín.
  estancia", que no dejaban ver cuál era cuál.
- **Reservas modificadas por la OTA**: se reciben, se registran y se ackean, pero **no se
  auto-aplican** sobre la reserva local (aplicar una modificación sobre el calendario necesita una
  UX de reconciliación que todavía no existe).
- **Tarjetas de crédito**: el PMS no procesa datos de tarjeta — los cobros van por Stripe
  (Links/Checkout), sin PAN/CVV en nuestro lado.
- **Webhooks de bookings**: se usa el feed `booking_revisions` cada 15 min + ack, más el botón
  manual de ingesta. No hay webhook HTTP.
