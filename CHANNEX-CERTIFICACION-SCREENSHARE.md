# Certificación Channex — guion de la screenshare: dónde miro y qué muestro

> Para el **Stage 4**: vos tocás la UI del PMS y el revisor de Channex ve salir las llamadas en su lado.
> Este guion dice, test por test, **(1) qué pantalla abrir, (2) qué hacer, (3) qué mostrar para probar que salió**.
> Regla: cada test se cierra mostrando **la fila del Registro con su task id** y **el valor en Channex**. Un "200" no prueba nada; el task id + el readback sí.

## 0. Pestañas que tenés que tener abiertas ANTES de empezar

| # | Pestaña | Para qué |
|---|---|---|
| A | https://solmios.com/login → entrar como `cert@solmios.com` (o `cert-runner@solmios.com`) | La UI del hotel de examen |
| B | https://solmios.com/panel/config/tarifas-fecha | Tests 2–8 (precios y restricciones por fecha) |
| C | https://solmios.com/panel/reservations | Tests 9–10 (reservas → disponibilidad) |
| D | https://solmios.com/panel/channel-manager | Test 1 (Sincronizar), Test 11 (Recibir Reservas), Historial del hotel |
| E | https://solmios.com/admin/channex-queue?tab=registro — **otra ventana, como `admin@solmios.com`** | **La prueba de cada test**: fila con hora, evento, estado y task id |
| F | https://staging.channex.io → property "Test Property - SolmiOS" → Inventory | El readback: el valor que Channex tiene guardado |

Antes de compartir pantalla, en la pestaña E filtrá **Hotel = Test Property - SolmiOS** para que solo se vean las filas del examen.

Frases que conviene tener a mano (EN):
- *"This is our audit log: every call to Channex, with the task id you can look up on your side."*
- *"One batched call — here's the single task id."*
- *"Here's the readback on your Inventory page."*

---

## 1. Chequeo de 60 segundos antes de arrancar

| Qué | Dónde | Tiene que verse |
|---|---|---|
| Canal activo y 4/4 mapeado | D → tarjeta **SolmiOS Open** → "Configurar tarifas" → "Mapeo con el canal" | **4 de 4 tarifas mapeadas** |
| Cola limpia | E → pestaña **Cola** | 0 pendientes / 0 fallidas |
| Registro sin errores recientes | E → Registro → Estado = **Error** | vacío (o solo cosas viejas y explicadas) |
| Webhook registrado con ids | https://solmios.com/admin/channels → tarjeta de cuenta → Webhook | "Registrado", eventos `booking_new;booking_modification;booking_cancellation` |
| Sesión de Channex viva | F | te deja entrar a Inventory sin login |

---

## 2. Test por test

### Test 1 — Full sync (2 llamadas)
| Paso | Dónde | Qué |
|---|---|---|
| Hacer | D | Botón **"Forzar Sync Ahora"** |
| Mostrar | E (Registro) | Dos filas nuevas: **"Disponibilidad enviada"** (1 llamada) y **"Tarifas enviadas"** (1 llamada), cada una con su task id → copiarlo con el botón |
| Mostrar | D → canal → Mapeo | Sigue **4 de 4** después del sync (Channex mira esto) |
| Decir | | *"Full sync is two calls: one availability for 500 days, one restrictions for all four rate plans. Values vary by season and rate plan."* |

### Test 2 — Un precio, una fecha (Twin · BAR · 22-nov-2026 · $333)
| Paso | Dónde | Qué |
|---|---|---|
| Hacer | B | Ir a noviembre 2026 (flechas ‹ ›) → fila **Twin Room / BAR** → celda **22** → escribir `333` → **Guardar y publicar** |
| Mostrar | E | Fila **"Tarifas por fecha enviadas"** · `entradas: 1 · llamadas: 1` · task id |
| Mostrar | F | Inventory → Twin BAR → 22 Nov = **333** |

### Test 3 — Tres precios, tres fechas, UNA llamada
| Paso | Dónde | Qué |
|---|---|---|
| Hacer | B | En la misma pantalla, sin guardar entre medio: Twin/BAR **21** = `333` · Double/BAR **25** = `444` · Double/B&B **29** = `456.23` → **un solo** "Guardar y publicar" |
| Mostrar | E | **Una** fila · `entradas: 3 · llamadas: 1` · **un** task id |
| Mostrar | F | Los tres valores en Inventory |
| Decir | | *"Three edits, one call — the outbox batches the burst."* |

### Test 4 — Tres rangos, UNA llamada
| Paso | Dónde | Qué |
|---|---|---|
| Hacer | B | **"Editar un rango"** ×3: Twin/BAR 1→10 nov `241` · Double/BAR 10→16 nov `312.66` · Double/B&B 1→20 nov `111` → Aplicar cada uno → **un** "Guardar y publicar" |
| Mostrar | E | Una fila · `entradas: 3 · llamadas: 1` |
| Mostrar | F | Un día del medio de cada rango (ej. 5, 13 y 15 nov) |

### Test 5 — Min stay (3 / 2 / 5)
| Paso | Dónde | Qué |
|---|---|---|
| Hacer | B | "Editar un rango" con fecha desde = hasta: Twin/BAR **23 nov** **Estadía mín.** `3` · Double/BAR **25 nov** `2` · Double/B&B **15 nov** `5` → Aplicar → **un** "Guardar y publicar" |
| Mostrar | E | Una fila · 1 llamada |
| Mostrar | F | Inventory → restricción Min Stay en esas fechas |
| Decir | | *"We support both min_stay_arrival and min_stay_through."* — **Estadía mín.** = arrival · **Mín. pasante** = through (los dos están en el mismo modal) |

### Test 6 — Stop sell
| Paso | Dónde | Qué |
|---|---|---|
| Hacer | B | "Editar un rango": Twin/BAR **14 nov** · Double/BAR **16 nov** · Double/B&B **20 nov**, tildar **Cerrar ventas** → **un** "Guardar y publicar" |
| Mostrar | E | Una fila · 1 llamada |
| Mostrar | F | Stop sell activo en las tres |

### Test 7 — Restricciones combinadas
| Paso | Dónde | Qué |
|---|---|---|
| Hacer | B | "Editar un rango" ×4: Twin/BAR 1→10 **Sin llegadas (CTA)** + **Estadía máx.** 4 + **Estadía mín.** 1 · Twin/B&B 12→16 **Sin salidas (CTD)** + mín 6 · Double/BAR 10→16 **Sin llegadas (CTA)** + mín 2 · Double/B&B 1→20 mín 10 → **un** "Guardar y publicar" |
| Mostrar | E | Una fila · `entradas: 4 · llamadas: 1` |
| Mostrar | F | CTA / CTD / max stay / min stay en un día de cada rango |

### Test 8 — Medio año
| Paso | Dónde | Qué |
|---|---|---|
| Hacer | B | "Editar un rango": Habitación Twin · Plan BAR · **1-dic-2026 → 1-may-2027** · Tarifa `432` · Estadía mín. `2`; ídem Double/BAR `342` / `3` → Aplicar ×2 → **un** "Guardar y publicar" |
| Mostrar | E | Una fila · 1 llamada |
| Mostrar | F | Un día de febrero 2027 con 432 / 342 |

### Test 9 — Disponibilidad por reserva (una fecha)
| Paso | Dónde | Qué |
|---|---|---|
| Hacer | C | **Nueva Reserva**: Twin Room, 21→22 nov 2026, confirmar. Después otra: Double Room, 25→26 nov |
| Mostrar | E | Dos filas **"Disponibilidad enviada"** (una por reserva), cada una con task id |
| Mostrar | F | Inventory → Twin 21 nov **2→1** · Double 25 nov **2→1** |
| Decir | | *"Each reservation triggers one availability push for its dates."* (el guion dice 8→7 y 1→0; nuestra property tiene 2 unidades de cada tipo: escalamos) |

### Test 10 — Disponibilidad por reserva (rangos)
| Paso | Dónde | Qué |
|---|---|---|
| Hacer | C | Nueva Reserva Twin **10→16 nov** · Nueva Reserva Double **17→24 nov** |
| Mostrar | E | Dos filas · 1 llamada cada una · task ids |
| Mostrar | F | Un día de cada rango con la disponibilidad bajada |

> Si en el Registro aparece **"Channex: push en espera por límite de peticiones"** con `espera (s): NN`, **mostralo y decilo**: *"That's our rate limiter holding the call — we stay under 10 per property per minute; it goes out when the window frees."* Es un punto a favor (Test 12), no un fallo. El push sale igual: la fila "Disponibilidad enviada" aparece cuando termina la espera.

### Test 11 — Recepción de reservas
| Paso | Dónde | Qué |
|---|---|---|
| Hacer | F / ellos | Channex crea una reserva de prueba en la property (o la crean ellos) |
| Mostrar | E | Fila **"Webhook: reserva recibida e ingestada"** con `revisión: …` — en segundos, sin tocar nada |
| Mostrar | C | La reserva aparece en el listado con el nombre del huésped de Channex |
| Si no llega en 30 s | D | Botón **"Recibir Reservas"** → fila "Recepción de reservas" con `ingestadas: 1 · confirmadas: 1` |
| Modificar / cancelar | ellos | Modificación: fila del webhook + se ve en la reserva (no se auto-aplica, lo declaramos). Cancelación: la reserva pasa a cancelada |
| Decir | | *"Received via webhook, ingested and acknowledged. We use GET /booking_revisions, not /bookings."* |

### Test 12 — Rate limits (hablado)
| Mostrar | Dónde | Qué |
|---|---|---|
| Config | E → **Cola** → botón **Configuración** | "Peticiones por minuto a Channex: 18" |
| Prueba viva | E → Registro → Evento = "push en espera por límite" | Cualquier fila con `espera (s)` y `motivo` |
| Decir | | *"18 per minute globally, 9 per property per endpoint, Retry-After honoured, 60-second property pause on 429. Everything goes through one shared transport."* |

### Test 13 — Solo deltas (hablado)
| Mostrar | Dónde | Qué |
|---|---|---|
| | E → Registro | Las filas de los tests 2–10: cada una con `entradas: N` = exactamente lo que se tocó, nada más |
| Decir | | *"Event-driven deltas. Full sync only on the manual button — no timer."* |

### Test 14 — Cuestionario
Ya redactado: `CHANNEX-CERTIFICACION-RESPUESTAS.md` → sección "Test 14". Se manda por el formulario, no en la screenshare.

---

## 3. Si te preguntan por el código (pre-flight P1–P5)

| Pregunta | Mostrar (GitHub) |
|---|---|
| Detección por eventos, no polling | https://github.com/arckodeteam-hash/solmios/tree/main/backend/src/connectors → `reservas-canales.ts`, `pricing-canales.ts`, `habitaciones-canales.ts` |
| Cola / outbox | https://github.com/arckodeteam-hash/solmios/tree/main/backend/src/modules/ari-outbox |
| Rate limit + backoff | https://github.com/arckodeteam-hash/solmios/blob/main/backend/src/modules/canales/usecases/channex-http.ts |
| Webhook + ack | https://github.com/arckodeteam-hash/solmios/blob/main/backend/src/modules/canales/usecases/channex-webhook.ts |
| Mapping IDs ↔ UUIDs | https://github.com/arckodeteam-hash/solmios/blob/main/backend/src/modules/canales/usecases/channex.ts |

---

## 4. Lo que NO hay que hacer en vivo

- No correr `bun run doctor` con `CHANNEX_PROPERTY_ID` ni el runner e2e: pisan ARI de la property con valores de prueba.
- No usar Postman/curl: el examen es la UI.
- No tocar la property vieja ni otras properties de la cuenta.
- Si algo da **Error** en el Registro (rojo), leer el `detalle` en voz alta y seguir: el error de Channex viene en la fila. Un aviso (naranja) es normal.

## 5. Al terminar

1. Copiar los task ids de la sesión desde el Registro (botón en cada fila) por si los piden aparte.
2. Cerrar el issue del trámite cuando llegue el certificado.
3. Con las credenciales de producción: `CHANNEX_BASE_URL` → `https://api.channex.io/api/v1`, registrar el webhook de nuevo desde `/admin/channels`, cargar `planExpiresAt`.
