# Proposal: Refactorizar modulo RepairShop (Taller) — LEGADO a LIMPIO

## Intent

Sacar `RepairShopService` de la zona LEGADO y llevarlo a `Features/RepairShop/` siguiendo el ciclo RECICLADO (R1 a R5). Es el **primer RECICLADO del proyecto**: ademas de migrar el modulo, crea por primera vez la carpeta `Features/`, su carpeta `_Shared/`, el seam con feature flag por tenant y el registro de servicios por convencion. Ese andamiaje se paga una sola vez y lo reutilizan los otros 23 modulos.

## Por que este modulo

Medido sobre el repositorio y confirmado contra el servidor de pruebas:

| Criterio | Valor | Por que importa |
|---|---|---|
| Lineas de codigo | 346 | El mas chico que todavia tiene acoplamiento real al legado |
| Metodos publicos | 9 | Superficie acotada y entendible |
| Consumidores del servicio | 1 (`RepairShopController`) | La etapa de migracion de clientes es casi trivial |
| Acoplamiento a `BaseService` | 14 usos | Ensena a cortar la dependencia mas dificil del legado |
| Acoplamiento al ejecutor de SPs | 9 usos | Ensena a cortar `ISpExecute` / `IDbService` |
| Ultimo cambio | 2025-03 | Nadie lo toca hace mas de un ano: cero conflictos de merge |
| Impacto si falla | Solo el taller de reparaciones | La facturacion, ventas, compras y caja siguen andando |

Contraste: `KSalesServices` (158 commits, ultimo en 2026-06) y `AuthService` (96 commits, ultimo en 2026-06) se tocan este mes. Migrarlos ahora seria pelear conflictos de merge todos los dias.

## Condicion de arranque (GATE) — verificar uso en produccion

**No empezar R1 hasta resolver esto.**

Se verifico el modulo contra el servidor de pruebas (173.249.31.75). Resultado:

- El modulo **funciona**: los 9 stored procedures existen, las tablas `Operacion_taller` y `Operacion_det_taller` existen, el endpoint esta registrado y responde.
- El **uso es casi nulo**: cuatro bases (kw0, kw6, kw141, Kw21_ult) tienen exactamente 16 casos cada una, todos en la misma ventana de 3 dias (2025-12-16 a 2025-12-18). Ese patron identico es data de demostracion sembrada, no uso real. El tenant kw21 tiene 1 caso. El resto de los tenants tiene 0.

**Pero el servidor de pruebas no es produccion.** Que en pruebas este vacio no prueba que este muerto en produccion. Antes de invertir en la migracion hay que correr el mismo conteo (cantidad de casos y ultima fecha, por tenant) contra la base de **produccion**. Segun el resultado:

| Resultado en produccion | Decision |
|---|---|
| Trafico bajo pero real | Sigue siendo el candidato ideal. Continuar con R1. |
| Practicamente muerto (0 casos nuevos en meses) | **No migrar.** Dejar morir en LEGADO o planificar su baja. |
| Mucho mas trafico del estimado | Reevaluar: quiza convenga un modulo mas tranquilo para el primer RECICLADO. |

Responsable de resolver el gate: quien tenga acceso a produccion. Query listo en `design.md`.

## Scope

**Dentro:**
- `RepairShopService`, su interfaz `IRepairShopService` y `RepairShopController`
- Los 14 DTOs del modulo (hoy en `Kaptas.DTO/KaptasCore/RepairShop/`)
- Creacion de `Features/_Shared/` con los cuatro contratos base (ver design.md)
- Creacion de `Features/RepairShop/`

**Fuera (explicito):**
- Los 9 stored procedures `P_Taller_*`. **La logica de negocio vive en SQL Server, no en C#.** Este cambio migra el borde (resolucion de tenant, mapeo, manejo de errores, HTTP), no la logica. Los SPs no se tocan.
- Los defectos de seguridad D1, D2 y D3. Se documentan aca pero se arreglan por ciclo PARCHE aparte (ver seccion siguiente).
- Los otros modulos que consumen `IBranchService`.

## Relacion con el ciclo PARCHE

Durante el analisis aparecieron 3 defectos de seguridad y 4 de robustez (detalle en `design.md`). **No se arreglan en este cambio.**

Los tests de caracterizacion de R1 documentan el comportamiento actual, incluido el defectuoso. Los defectos de seguridad se atacan por ciclo PARCHE en un cambio separado, con test que reproduce el problema primero. Mezclar RECICLADO con PARCHE es exactamente el "ya que estoy, arreglo esto tambien" que las reglas del proyecto prohiben.

Dos de esos defectos (el tenant que se define por header HTTP, y el que se define por el body) **exceden el modulo Taller**: viven en `BaseService`, que usa todo el sistema. Tratar por canal privado con QA-DEV, no en un work item publico del board.

## Rollback plan

El seam hace el rollback trivial en cualquier punto posterior a R2:

1. **R2 a R3 (flag activo en pocos tenants):** poner el flag en `false` para el tenant afectado. El router vuelve al codigo viejo sin necesidad de deploy.
2. **R4 (viejo marcado obsoleto pero vivo):** igual que arriba. El codigo viejo sigue compilando y funcionando.
3. **R5 (viejo desmontado):** revertir el commit de desmontaje con git. Por eso R5 exige 0 trafico confirmado por metricas, no por intuicion.

El unico punto de no retorno es R5. Antes de eso, todo se apaga con un flag.

## Modulos afectados

| Modulo | Zona antes | Zona despues |
|---|---|---|
| RepairShop | LEGADO | PUENTE (R2 a R4) y luego LIMPIO (R5) |
| `_Shared` | no existe | NUEVO |
| Branch | LEGADO | LEGADO (sin cambios; se consume a traves de un puerto) |

## Riesgos

| Riesgo | Mitigacion |
|---|---|
| Los SPs no estan versionados en el repositorio | R1 los caracteriza como caja negra. No se tocan. Registrar como deuda. |
| `InitialData` depende de `IBranchService`, que es legado y esta prohibido | Puerto nuevo en `_Shared/` que reimplementa la consulta. Ver design.md, decision D-4. |
| Los table-valued parameters atan el codigo al esquema de la base | Se replican tal cual en el codigo nuevo, sin cambiar su forma. |
| Es el primer RECICLADO: el andamiaje no existe | Por eso se eligio el modulo mas barato. El costo se paga una sola vez. |
| El modulo podria estar muerto tambien en produccion | El GATE de arriba lo resuelve antes de invertir esfuerzo. |
