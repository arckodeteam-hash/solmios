# Channex — Evidencia de la corrida de certificación

> Generado por `bun run scripts/e2e/channex-certification.e2e.ts` el 2026-09-02T17:39:06.329Z.
> Property de staging: `bddf7d23-83c5-437d-a2ff-c4e85ccaf412` · hotel del PMS: `a7c8d8e4-90a6-4431-862b-a09dff6bdc43`.
> Cada fila salió de apretar el MISMO endpoint que usa el panel; el valor se verificó con
> readback contra la API de Channex (no con el 200 del push).

| Test | Resultado | Llamadas | Task IDs | Detalle |
|---|:---:|:---:|---|---|
| Setup Mapping | ✅ | 0 | — | canal "SolmiOS Open" activo · 4 rate plans mapeados |
| T1 Full Sync | ✅ | 2 | `63b49220-50c5-4ce7-8f85-1dc6cfdf0e8e`<br>`938099bf-2408-4b96-ae10-3bd4979460bb` | 500 días: 1 availability + 1 rates/restrictions · canal con 4 tarifas mapeadas después |
| T2 Single Date Single Rate | ✅ | 1 | `cf1fa021-760c-4709-b037-226bde8bd45c` | Twin BAR 2026-11-22 $333 |
| T3 Single Date Multiple Rates | ✅ | 1 | `c8bb7b2b-58f8-4897-baf2-f1740c2e32ce` | Twin BAR 333 · Double BAR 444 · Double B&B 456.23 |
| T4 Multiple Dates Multiple Rates | ✅ | 1 | `1cf76548-213b-46b5-8e92-381f1860729f` | Twin BAR 1-10 241 · Double BAR 10-16 312.66 · Double B&B 1-20 111 |
| T5 Min Stay | ✅ | 1 | `7c607092-553b-40e6-a355-4b3107702b12` | Twin BAR 3 · Double BAR 2 · Double B&B 5 |
| T6 Stop Sell | ✅ | 1 | `3b76b07d-1acc-4186-b045-17782b58541a` | Twin BAR 14/11 · Double BAR 16/11 · Double B&B 20/11 |
| T7 Multiple Restrictions | ✅ | 1 | `e3ea7f11-580b-4d0d-a937-23c91e5197be` | CTA/CTD + max stay + min stay arrival (10) y through (7) sobre 4 rate plans |
| T8 Half-year Update | ✅ | 1 | `15697ecd-7102-4ea0-96c4-39c5b0488736` | Twin BAR 432 min 2 · Double BAR 342 min 3, 1/12/26 → 1/5/27 |
| T9 Single Date Availability | ✅ | 3 | `5b28f475-66f6-4b58-bda2-9493d65e07da`<br>`a19e3318-e7aa-49a4-9936-a67314af6539`<br>`030cb667-e815-47a3-a266-d6a3b8b4523d` | 3 reservas de 1 noche = 1 llamada cada una; Double agotado = 0 |
| T10 Multiple Date Availability | ✅ | 2 | `0c9a9e92-b6b4-4e8f-88f8-e3e09fbf6947`<br>`472b3d69-4ebd-4824-9050-c0d0054e2d5e` | 2 reservas de rango = 1 llamada cada una, rangos comprimidos |
| T11 Booking Receiving | ✅ | 0 | — | feed booking_revisions + ack; el booking de prueba lo dispara Channex |

**26 checks OK · 0 fallidos.**
