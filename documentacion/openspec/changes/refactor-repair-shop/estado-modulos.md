# Estado del refactor — RepairShop (Taller)

Tablero de estado de este cambio. Solo lleva el **estado**; cómo se organiza el código
(módulo vs share) está en la guía única: `docs/GUIA-DESARROLLO-Y-QA.md`, sección 3.

Recordatorio del modelo: **módulo** = funcionalidad con endpoint (`Features/<Modulo>/`).
**share** (`_Shared/`) = lo compartido; NO son módulos.

## Módulo

| Módulo | Ruta | Estado | Tests |
|--------|------|--------|-------|
| RepairShop (Taller) | `Features/RepairShop/` + `api/v2/RepairShop` | PUENTE (v2 vivo junto al legado) | SpVsEf: Create / Complete / Generate + list/detail/print |

## Servicios compartidos de share (`_Shared/`)

Aislados por interfaz; hoy solo los consume RepairShop, listos para reusar. "EF" =
reimplementado en C#/EF (ya no ejecuta el SP viejo). "Adapter" = todavía delega en el SP.

| Servicio | Impl | Tablas que toca | SP legado que reemplaza | Test |
|----------|------|-----------------|-------------------------|------|
| Operations | **EF** | Operacion, Operacion_Det | p_operacion_insert, p_operacion_det_insert, p_Operacion_recalcular, p_Operacion_validaciones | OperationWriter/DetailWriter/Recalculator/ValidatorTests |
| Fiscal | **EF** | ControlNcf, ControlNcf_Detalle | P_Ncf_Get_Set | NcfProviderTests |
| Stock | **EF** | Operacion_Mov_Stock(_Det), Producto_Stock_Historico | p_Operacion_Stock(_actualizar), P_Producto_Stock_Update | StockMovementWriterTests |
| Sequences | **EF** | Sequencias | p_Sequencias_Numero_company | SequenceNumberProviderTests |
| Dictionaries | **EF** | Diccionario | p_Diccionario_Create_o_Select | DictionaryResolverTests |
| Payments | **Adapter** | (vía SP) | p_Operacion_Aplicar_Pago | cubierto por Complete/Generate SpVsEf |

## Infra de share (`_Shared/`)

| Subcarpeta | Contiene |
|------------|----------|
| Tenancy | TenantConnectionFactory, TenantScope, ValidateTenantFilter |
| Identity | CurrentUserProvider, UserBranchesQuery |
| Data | SpRunner, DatabaseClock |

## Deuda declarada
- `Payments` es el único que sigue en SP. No se migró a EF porque el SP requiere caja
  abierta y no se puede validar byte-a-byte en el contexto del taller. Se migra a su turno.
- `OperationDetailWriter` (EF) usa un INSERT ADO explícito, no el change-tracker de EF,
  por drift de columnas en `Operacion_Det` (documentado en el archivo).
- Huecos de test dedicado: `OperationDetailWriter` y `Payments` se cubren solo de forma
  indirecta vía los SpVsEf de RepairShop.

## Deuda de calidad — RepairShop (auditoría de code smells)

Ya corregido (sin romper equivalencia byte-a-byte, tests verdes):
- Error handling: los 3 commands ya no filtran `ex.Message` al cliente; separan negocio
  (mensaje al usuario) de técnico (mensaje genérico + `ILogger.LogError`).
- N+1 en `CreateRepairShopCaseCommand.BuildPiecesAsync`: resuelto con 2 queries batch.
- Magic numbers residuales: extraídos a constantes nombradas.
- Test de autorización sin JWT (401): agregado.

Deuda que NO se toca hasta que el módulo pase a zona LIMPIO (o requiere trabajo aparte):
- **Silent failure / `return true` incondicional** (`ChangeStatus`, `UpdateHeading`): es
  el contrato HEREDADO del SP (retorna éxito aunque el caso no exista). Cambiarlo a 404
  rompería la equivalencia con el legado. Se corrige cuando muera el legado, con su test.
- **Props muertas en `RepairShopHeadingRequest`** (`PorcientoDescuento`, `MontoDescuento`,
  `Estado`): el SP nunca las usó, se ignoran a propósito. Se limpian en zona LIMPIO.
- **`LegacySqlFormat` / `LegacyJsonDetail`**: complejidad JUSTIFICADA (paridad exacta con
  el JSON del SP). Desaparecen cuando se apague el legado.
- **Validación de entrada** (`[Required]`/`[Range]` en Request DTOs): pendiente. Riesgo:
  validación estricta puede rechazar inputs que el SP aceptaba → romper equivalencia. Hacer
  con cuidado, contrastando contra los tests de equivalencia.
- **Tests de concurrencia** (2 usuarios sobre el mismo caso): requiere control optimista
  (rowversion) que hoy no existe en las entidades. Trabajo aparte, fuera de este alcance.
