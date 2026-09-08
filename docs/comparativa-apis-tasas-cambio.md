# Comparativa de APIs de tasas de cambio

SOLMI OS convertía importes con una **tasa cargada a mano** (un valor fijo guardado en configuración,
que nadie actualizaba). Este documento registra la evaluación de cinco proveedores de tasas de
cambio y la recomendación adoptada para reemplazar esa tasa manual por una fuente automática y
fiable.

Datos verificados el **2026-09-08** contra las páginas de precios de cada proveedor y con llamadas
reales a los endpoints públicos.

## Tabla comparativa

| Proveedor | Precio (gratuito / primer pago) | Requests | Actualización | Monedas | Limitaciones del plan gratuito |
| --- | --- | --- | --- | --- | --- |
| **Frankfurter** | Gratis (sin plan pago; open source y self-hosteable) | Sin cuota declarada; rate limiting genérico anti-abuso | 1 vez por día hábil (~16:00 CET), tasas de referencia del BCE | ~30 monedas de referencia del BCE | **No tiene DOP** (ni COP, ARS, CLP, PEN); sin API key |
| **ExchangeRate-API** | Free 0 USD / Pro 10 USD-mes (100 USD-año); Business 30 USD-mes (300 USD-año) | Free 1.500/mes; Pro 30.000/mes; Business 125.000/mes | Free 1 vez por día; planes pagos cada 60 min | 161-165, incluida **DOP** | Cuota mensual baja y actualización diaria. Tiene además un endpoint *Open Access* sin API key |
| **Open Exchange Rates** | Free 0 USD / Developer 12 USD-mes; Enterprise 47; Unlimited 97 | Free 1.000/mes; Developer 10.000/mes; Enterprise 100.000/mes; Unlimited sin límite | Horaria (Free y Developer); 30 min (Enterprise); 5 min (Unlimited) | Más de 200 | **Base fija en USD**; cambiar de base exige Developer (12 USD/mes). Requiere API key |
| **CurrencyAPI** | Free 0 USD / Small 9,99 USD-mes; Medium 39,99; Large 79,99 (20% dto. anual) | Free 300/mes; Small 15.000/mes; Medium 600.000/mes; Large 1.700.000/mes | Free diaria; Small horaria; Medium y Large cada 60 s | 170+, incluida DOP | **Free es "Private Use": prohíbe el uso comercial**; 10 req/min. Requiere API key |
| **Fixer** | Free 0 USD / Basic 14,99 USD-mes; Professional 59,99; Professional Plus 99,99; Enterprise a medida | Free 100/mes; Basic 10.000/mes; Professional 100.000/mes; Professional Plus 500.000/mes | Horaria (Free y Basic); 10 min (Professional); 60 s (Professional Plus) | 170 | **Base fija en EUR**; todas las bases desde Basic (14,99 USD/mes). Solo 100 req/mes. Requiere API key |

## Requisitos que impone SOLMI OS

1. **Cobertura de DOP.** El mercado principal es República Dominicana y la conversión típica es
   USD→DOP. Sin DOP el proveedor no sirve, por barato o rápido que sea.
2. **Catálogo completo del producto.** `backend/src/shared/currency.ts` define **22 monedas**: USD,
   EUR, DOP, MXN, COP, ARS, BRL, PEN, CLP, GBP, CAD, CHF, UYU, PYG, BOB, VES, CRC, GTQ, HNL, NIO,
   JPY y CNY. El proveedor tiene que cubrir las veintidós.
3. **Moneda base distinta por hotel.** Cada hotel opera en su moneda; la base no puede estar fija
   en USD ni en EUR.
4. **Uso comercial permitido.** SOLMI OS es un producto comercial: un plan "solo uso privado" queda
   descartado de entrada.
5. **Una actualización diaria alcanza.** Las tasas se usan para **conversión de display**, no para
   liquidar pagos. Un cron diario con la tasa cacheada cubre el caso de uso; no hace falta
   actualización por minuto ni por hora.

## Descartes

- **Frankfurter — no tiene DOP.** Probado con curl:

  ```
  GET https://api.frankfurter.dev/v1/latest?base=USD&symbols=DOP
  → {"message":"not found"}
  ```

  `GET /v1/currencies?scope=all` devuelve la misma lista corta de ~30 monedas del BCE (AUD, BRL,
  CAD, CHF, CNY, CZK, DKK, EUR, GBP, HKD, HUF, IDR, ILS, INR, ISK, JPY, KRW, MXN, MYR, NOK, NZD,
  PHP, PLN, RON, SEK, SGD, THB, TRY, ZAR, más USD como base). Tampoco tiene COP, ARS, CLP ni PEN.
  Su home publicita "201 monedas de 84 bancos centrales", pero **eso no aplica al endpoint público
  v1**. Incumple los requisitos 1 y 2.

- **CurrencyAPI — el plan gratuito prohíbe el uso comercial.** El Free es "Private Use" solamente;
  el uso comercial arranca en Small (9,99 USD/mes). Incumple el requisito 4.

- **Fixer — base fija y cuota inviable.** El plan gratuito restringe la moneda base a EUR y da solo
  **100 requests al mes**. Poder elegir base exige Basic (14,99 USD/mes). Incumple el requisito 3.

- **Open Exchange Rates — base USD fija en el plan gratuito.** Es el proveedor que usa hoy el repo.
  Cubre las monedas y actualiza cada hora, pero el Free fija la base en USD: soportar una base
  distinta por hotel costaría **12 USD/mes** (plan Developer). Incumple el requisito 3 sin pagar.

## Recomendación

**ExchangeRate-API**, a través de su endpoint *Open Access*:

```
GET https://open.er-api.com/v6/latest/{BASE}
```

Criterios que la dejan como única opción viable:

- **Es la única gratuita que cubre DOP y el resto del catálogo.** Verificado con curl sobre
  `GET /v6/latest/USD`: `result: "success"`, con DOP 59.193349, COP 3132.334419, ARS 1511.154,
  CLP 933.491386, PEN 3.355232, MXN 16.932921 y BRL 5.126189. Devuelve 166 monedas y se comprobó
  que **están las 22 del catálogo del producto**, sin faltar ninguna.
- **Acepta cualquier moneda base sin pagar.** `GET /v6/latest/DOP` también responde `success`, lo
  que resuelve el requisito de base por hotel sin costo. La respuesta incluye la propia base dentro
  de `rates` (`"USD":1` cuando la base es USD).
- **No pide API key.** No hay credencial que guardar, rotar, ni que se pueda filtrar en el repo o
  en el frontend.
- **Permite uso comercial explícitamente y recomienda cachear**, que es exactamente el patrón del
  cron diario de SOLMI OS.
- **Trae su propia fecha de actualización**: `time_last_update_utc`, `time_last_update_unix` y
  `time_next_update_unix`, así que la UI puede mostrar de cuándo es la tasa y el cron sabe cuándo
  vuelve a haber datos nuevos.

## Contras y obligaciones asumidas

- **Actualización una vez por día.** Suficiente para conversión de display; **no** es apta para
  liquidar pagos. Cualquier funcionalidad futura que mueva dinero real necesita otra fuente.
- **Atribución obligatoria.** Hay que mostrar de forma visible *"Rates By Exchange Rate API"* con
  enlace a exchangerate-api.com. Se muestra en la pantalla de ajustes.
- **Rate limit.** Responde HTTP 429 con una ventana de recuperación de 20 minutos. Pedir una vez
  cada 24 horas no la roza, pero el cron debe contemplar el 429.
- **Prohibida la redistribución de los datos.** Las tasas se usan dentro del producto; no se
  exponen como feed hacia terceros.
- **Salida si hace falta más frecuencia.** La misma cuenta de ExchangeRate-API tiene plan **Pro a
  10 USD/mes con actualización horaria** (30.000 req/mes), sin cambiar de proveedor ni de formato
  de respuesta: solo se agrega la API key.

## Nota sobre costos

**No se implementó ninguna API de pago.** La opción elegida es gratuita y sin credencial, así que
no hubo gasto que aprobar.
