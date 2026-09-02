# Channex — Evidencia de la corrida de certificación

> Generado por `bun run scripts/e2e/channex-certification.e2e.ts` el 2026-09-01T23:58:34.981Z.
> Property de staging: `f1f563dd-1e27-41e2-816b-947ab4b050dc` · hotel del PMS: `bbd91ff0-aa96-4d8f-a505-74300e5b01e4`.
> Cada fila salió de apretar el MISMO endpoint que usa el panel; el valor se verificó con
> readback contra la API de Channex (no con el 200 del push).

| Test | Resultado | Llamadas | Task IDs | Detalle |
|---|:---:|:---:|---|---|
| T1 Full Sync | ✅ | 2 | `9db8c388-d87f-4fc9-b9f1-daefe7391ebb`<br>`d192ce0a-332f-4c1d-878c-c88613f15105` | 500 días: 1 availability + 1 rates/restrictions |
| T2 Single Date Single Rate | ✅ | 1 | `03b4c420-46d9-4d79-b76f-7d93ac470830` | Twin BAR 2026-11-22 $333 |
| T3 Single Date Multiple Rates | ✅ | 1 | `2165dcb9-87da-4232-a4e2-599ce8bc9b30` | Twin BAR 333 · Double BAR 444 · Double B&B 456.23 |
| T4 Multiple Dates Multiple Rates | ✅ | 1 | `ab8d96cb-092b-4272-a4ea-8fe02ec69cf7` | Twin BAR 1-10 241 · Double BAR 10-16 312.66 · Double B&B 1-20 111 |
| T5 Min Stay | ✅ | 1 | `514f9eca-04df-4320-bd2f-7cb3e34f0975` | Twin BAR 3 · Double BAR 2 · Double B&B 5 |
| T6 Stop Sell | ✅ | 1 | `26894bd9-3b73-48c8-bdba-9dcd5f0b5ddd` | Twin BAR 14/11 · Double BAR 16/11 · Double B&B 20/11 |
| T7 Multiple Restrictions | ✅ | 1 | `b81731da-48f9-4df9-8a56-948ed927374b` | CTA/CTD + max stay + min stay sobre 4 rate plans |
| T8 Half-year Update | ✅ | 1 | `1b096e34-6fdc-45e1-8b33-18b5ae7a8a1f` | Twin BAR 432 min 2 · Double BAR 342 min 3, 1/12/26 → 1/5/27 |
| T9 Single Date Availability | ✅ | 3 | `e26cacfb-fa70-4e49-9d20-cfee1bbd7365`<br>`16d4b03c-99a7-4c74-ae10-0f18adb868a4`<br>`aef28bd2-5d53-4a66-9f28-9513693cceb0` | 3 reservas de 1 noche = 1 llamada cada una; Double agotado = 0 |
| T10 Multiple Date Availability | ✅ | 2 | `af8aa5bf-987a-40e4-923b-c32d5df68666`<br>`2a77a78e-fe1a-417c-8216-daad2256b07d` | 2 reservas de rango = 1 llamada cada una, rangos comprimidos |
| T11 Booking Receiving | ✅ | 0 | — | feed booking_revisions + ack; el booking de prueba lo dispara Channex |

**24 checks OK · 0 fallidos.**
