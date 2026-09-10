# Channex — Evidencia de la corrida de certificación

> Generado por `bun run scripts/e2e/channex-certification.e2e.ts` el 2026-09-09T19:45:11.157Z.
> Property de staging: `bddf7d23-83c5-437d-a2ff-c4e85ccaf412` · hotel del PMS: `a7c8d8e4-90a6-4431-862b-a09dff6bdc43`.
> Cada fila salió de apretar el MISMO endpoint que usa el panel; el valor se verificó con
> readback contra la API de Channex (no con el 200 del push).

| Test | Resultado | Llamadas | Task IDs | Detalle |
|---|:---:|:---:|---|---|
| Setup Mapping | ✅ | 0 | — | canal "SolmiOS Open" activo · 4 rate plans mapeados |
| T1 Full Sync | ✅ | 2 | `afd2ef9d-da11-4733-b710-de0471858289`<br>`2e900cc5-fecd-443e-952b-606387db71d3` | 500 días: 1 availability + 1 rates/restrictions · canal con 4 tarifas mapeadas después |
| T2 Single Date Single Rate | ✅ | 1 | `0513aae8-7aed-40b2-898d-7c3293ddfe66` | Twin BAR 2026-11-22 $333 |
| T3 Single Date Multiple Rates | ✅ | 1 | `2cc4e241-d9b1-4624-b05d-eecbce7510cf` | Twin BAR 333 · Double BAR 444 · Double B&B 456.23 |
| T4 Multiple Dates Multiple Rates | ✅ | 1 | `7efb780a-d974-4e67-8151-49fa70c37bf2` | Twin BAR 1-10 241 · Double BAR 10-16 312.66 · Double B&B 1-20 111 |
| T5 Min Stay | ✅ | 1 | `490ca9c9-5e92-42af-a147-16a0415cd839` | Twin BAR 3 · Double BAR 2 · Double B&B 5 |
| T6 Stop Sell | ✅ | 1 | `9183782a-cea7-47e9-be14-efbe52c1ad61` | Twin BAR 14/11 · Double BAR 16/11 · Double B&B 20/11 |
| T7 Multiple Restrictions | ✅ | 1 | `166d9e36-bb69-4231-a0c1-a4f29dee40e8` | CTA/CTD + max stay + min stay arrival (10) y through (7) sobre 4 rate plans |
| T8 Half-year Update | ✅ | 1 | `3ab547bc-1b02-41e6-81a9-a268627f2ad8` | Twin BAR 432 min 2 · Double BAR 342 min 3, 1/12/26 → 1/5/27 |
| T9 Single Date Availability | ✅ | 3 | `a76402c9-27f0-4e75-8aa6-35ecd6d4d53a`<br>`5a528592-4b35-403f-bf86-65d21b6a2412`<br>`86f7e186-05d4-45c1-98c6-f82bdde2ba6a` | 3 reservas de 1 noche = 1 llamada cada una; Double agotado = 0 |
| T10 Multiple Date Availability | ✅ | 2 | `9e583651-043f-435f-935e-0ea2917d2a88`<br>`e711c903-7288-4150-8bc3-c26ea51150a0` | 2 reservas de rango = 1 llamada cada una, rangos comprimidos |
| T11 Booking Receiving | ✅ | 0 | — | feed booking_revisions + ack; el booking de prueba lo dispara Channex |

**25 checks OK · 1 fallidos.**
