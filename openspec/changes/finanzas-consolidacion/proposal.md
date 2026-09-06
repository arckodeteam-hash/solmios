# finanzas-consolidacion

## Objetivo

Dejar **funcionando de verdad** el núcleo financiero básico —Facturación, Folios, Caja y Links de
Pago— corrigiendo los defectos reales detectados en la auditoría del 2026-09-06, y cosiendo las
cuatro vistas que hoy son islas sin navegación ni agregador común.

No es una feature nueva: es cerrar los huecos por los que hoy se ensucian datos de dinero.

## Contexto — auditoría 2026-09-06

Auditoría de código (`backend/src/modules/{facturas,folios,cash,payments,payment-requests}`,
`backend/src/connectors/*`, `frontend/src/pages/{billing,folios,caja,payments}`) contrastada contra
la base de **producción** (PostgreSQL `solmios`, 2026-09-06).

### Estado en producción

| Métrica | Valor |
|---|---|
| Reservas | 57 |
| Folios abiertos / cerrados | **9 / 1** |
| Facturas emitidas (total histórico) | **1** |
| Cargos en folios | 24 · 4 108,00 |
| Pagos aplicados a folios | 2 · 536,90 (13 % de lo cargado) |
| Cobros en `payments` | 14 (link 5 · efectivo 5 · tarjeta 4) |
| Filas en `payment_links` | **0** |
| Movimientos de caja sin turno | 0 |

Lectura: el ciclo **folio → cobro → factura casi nunca se completa**. Y el 64 % del dinero cobrado
(todo lo que no es efectivo) es invisible al cerrar el turno de caja.

### Lo que SÍ está bien y no se toca

`payments` es efectivamente la única fuente de verdad del dinero: `facturas.pay()`,
`folios.applyPayment()` y el webhook de Stripe escriben los tres ahí
(`facturas/usecases/payment-port.ts`, `payment-requests/usecases/payment-port.ts`). Esa
consolidación ya se hizo (`billing-money-consolidation`, 2026-07-28) y este change **no la revierte**.

### Los 9 hallazgos

| # | Hallazgo | Severidad | Tipo |
|---|---|---|---|
| 1 | La IA emite facturas inválidas, sin autenticación | Crítica | Defecto |
| 2 | La caja no ve nada que no sea efectivo | Crítica | Hueco operativo |
| 3 | Dos sistemas de links de pago; uno es código muerto con endpoint público | Crítica | Código muerto |
| 4 | La factura manual no se puede atar a reserva ni a folio | Alta | Defecto |
| 5 | El numerador de facturas dice ser atómico y no lo es | Alta | Defecto |
| 6 | La nota de crédito no pasa por el circuito fiscal y suma en vez de restar | Alta | Defecto |
| 7 | No existe el estado de cuenta del huésped | Alta | Ausencia |
| 8 | Las cuatro vistas son islas: cero navegación cruzada | Normal | Ausencia |
| 9 | Si el conector de pagos no está registrado, la factura se marca pagada igual | Normal | Defecto |

Detalle con `archivo:línea` en `tasks.md`, una tarea por hallazgo.

## Alcance

**Entra**: los 9 hallazgos, agrupados en 3 fases por riesgo.

**No entra** (deuda declarada, no se resuelve acá):
- Conector fiscal real contra DGII/DIAN/SAT. `facturas/usecases/fiscal.ts:54-61` usa
  `stubFiscalAdapter`, que siempre devuelve `sent:false`. Toda factura queda `fiscalSent:false`.
  Sigue siendo la fila "Facturación electrónica" de las deudas técnicas de `CLAUDE.md`.
- Depósitos de garantía desconectados del ledger (fila existente en deudas técnicas).
- Estado de pago de reservas de OTA (`canales/usecases/booking-ingestion.ts:83-99` no mapea nada
  de pago) — es un límite del payload de Channex, va en su propio change.

## Decisiones de diseño

### D1 — La IA factura por el usecase, no contra el repo

`ai-recepcionista/usecases/llm-pipeline.ts:570-614` escribe directo contra el repositorio `Invoices`.
Se reemplaza por una llamada al usecase real vía **connector** (`connectors/ai-facturas.ts`), no por
import directo — regla de arquitectura del proyecto (los módulos no se importan entre sí).

Con eso hereda gratis: enums válidos, impuestos de `configuration(key='taxes')`, numerador
correlativo, NCF si corresponde, `invoice_items` y el evento `onFacturasCreated` que devenga en
contabilidad.

**Decisión de seguridad**: el WebChat público (`/api/ai/chat/:slug`, sin auth) **NO** puede emitir
facturas. La herramienta queda disponible solo cuando la conversación tiene un huésped identificado
por un canal autenticado. Motivo: emitir un documento fiscal consume secuencia NCF; un endpoint
anónimo que la consume es un vector de agotamiento del numerador.

### D2 — La caja sigue siendo de efectivo, pero el cierre muestra todo

**No** se cambia el conector para meter tarjeta/link en `cash_movements`. El arqueo de billetes
cuenta efectivo y eso es correcto: `expected = fondo + ingresos_cash − egresos_cash`
(`cash/usecases/reconcile.ts:12,41`).

Lo que se agrega es **visibilidad**: el endpoint de reconciliación devuelve, además del esperado en
efectivo, un desglose de lo cobrado en el turno por los demás métodos (leído de `payments` por
ventana temporal del turno). La pantalla de cierre lo muestra como informativo, separado del arqueo,
y **no** entra en el cálculo de diferencia.

Alternativa descartada: meter todo en `cash_movements` con un flag. Rompería el arqueo de todos los
turnos históricos y obligaría a filtrar en cada consumidor.

### D3 — `payment_links` se elimina

Con 0 filas en producción, `markUsed()` sin ningún caller y ningún endpoint para pagar el link, es
código muerto con superficie pública. Se elimina la tabla del modelo, sus endpoints y su usecase.
El sistema vivo es `payment_requests`, que es el que usa la pantalla
(`frontend/src/services/Payments.service.ts:21-35`).

**Rollback**: la tabla física NO se dropea (`ormMigrate` no dropea, solo avisa de columnas huérfanas).
Queda vacía y sin código que la toque. Si hiciera falta revertir, es un `git revert` del commit.

### D4 — El estado de cuenta vive en `shared/usecases/`

Cruza folio + `payments` + facturas, o sea tres módulos. No puede vivir en ninguno de los tres sin
romper la regla de imports. Va en `backend/src/shared/usecases/guest-account-statement.ts` y se
expone desde `reservas` (que ya es el agregador natural de la reserva, `reservas/usecases/detail.ts`).

## Riesgos y rollback

| Riesgo | Mitigación | Rollback |
|---|---|---|
| Cambiar el numerador rompe la emisión | Test de concurrencia (2 emisiones simultáneas → 2 números distintos) antes de tocar prod | `git revert`; el índice único se dropea aparte |
| El índice único choca con datos existentes | Producción tiene **1 sola factura**: no hay duplicados posibles hoy | Dropear el índice |
| La nota de crédito con monto negativo rompe reportes que sumaban positivo | Auditar los consumidores de `type:'credit_note'` antes; hoy hay **0 notas de crédito en prod** | `git revert` |
| Quitarle la facturación a la IA rompe una demo | Es una tool del LLM, degrada a "no disponible" con mensaje claro | Reactivar la tool |

## Verificación (gate de cierre)

```bash
cd backend && bun run node_modules/arckode-framework/bin/arckode.js analyze   # 0 violaciones
cd backend && bun run typecheck && bun test
cd frontend && bun run typecheck && bun run build
```

Además, por tarea: **test que falle antes del fix y pase después**. Un cambio sin esa prueba no
cuenta como arreglado.
