# Channex — Evidencia de la corrida de certificación

> Generado por `bun run scripts/e2e/channex-certification.e2e.ts` el 2026-09-12T19:28:23.050Z.
> Property de staging: `bddf7d23-83c5-437d-a2ff-c4e85ccaf412` · hotel del PMS: `a7c8d8e4-90a6-4431-862b-a09dff6bdc43`.
> Cada fila salió de apretar el MISMO endpoint que usa el panel; el valor se verificó con
> readback contra la API de Channex (no con el 200 del push).

| Test | Resultado | Llamadas | Task IDs | Detalle |
|---|:---:|:---:|---|---|
| Setup Mapping | ✅ | 0 | — | canal "SolmiOS Open" activo · 4 rate plans mapeados |
| T1 Full Sync | ✅ | 2 | `e8d6398a-2ded-4daf-9620-0d9101825b2b`<br>`5f7d64da-850c-4237-abba-a1b794a7b02a` | 500 días: 1 availability + 1 rates/restrictions · canal con 4 tarifas mapeadas después |
| T2 Single Date Single Rate | ✅ | 1 | `0ebf1d92-6266-419f-84c4-cde12b610728` | Twin BAR 2026-11-22 $333 |
| T3 Single Date Multiple Rates | ✅ | 1 | `573b4950-a55d-49c7-b168-317a449239d3` | Twin BAR 333 · Double BAR 444 · Double B&B 456.23 |
| T4 Multiple Dates Multiple Rates | ✅ | 1 | `94800985-f45b-44f3-a1d7-99b9331939d3` | Twin BAR 1-10 241 · Double BAR 10-16 312.66 · Double B&B 1-20 111 |
| T5 Min Stay | ✅ | 1 | `38b817e9-5a26-4ed8-850c-f4868773f69f` | Twin BAR 3 · Double BAR 2 · Double B&B 5 |
| T6 Stop Sell | ✅ | 1 | `59925b4d-e00d-4129-bc9b-2ca26276a0d4` | Twin BAR 14/11 · Double BAR 16/11 · Double B&B 20/11 |
| T7 Multiple Restrictions | ✅ | 1 | `9fa6b63c-e9d6-455e-ad38-408fb831200b` | CTA/CTD + max stay + min stay arrival (10) y through (7) sobre 4 rate plans |
| T8 Half-year Update | ✅ | 1 | `a8ee2ae4-068c-43dd-8ba8-876ad590372e` | Twin BAR 432 min 2 · Double BAR 342 min 3, 1/12/26 → 1/5/27 |
| T9 Single Date Availability | ✅ | 3 | `52fc0fce-9001-4f61-98be-b15f63774a93`<br>`7b0c3b09-23d1-4b93-baaf-2325e1c66908`<br>`08441c42-24c4-467a-8eaa-f961d423dc00` | 3 reservas de 1 noche = 1 llamada cada una; Double agotado = 0 |
| T10 Multiple Date Availability | ✅ | 2 | `e0874069-3a50-4c04-8d06-e46dd33ff4ca`<br>`46e4fd13-0da7-4950-bd63-451104bc7287` | 2 reservas de rango = 1 llamada cada una, rangos comprimidos |
| T11 Booking Receiving | ✅ | 0 | — | feed booking_revisions + ack; el booking de prueba lo dispara Channex |

**26 checks OK · 0 fallidos.**
