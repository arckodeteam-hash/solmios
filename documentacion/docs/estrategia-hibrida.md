# Estrategia: Planta en operacion — 3 ciclos, 4 zonas, 1 bucle infinito

**Fecha:** 26 junio 2026 · **Revision:** 28 junio 2026 (v3 — simplificada)
**Principio:** el sistema es una planta que no puede parar. No apagamos nada: **derivamos, migramos, desmontamos**.

---

## GLOSARIO (una linea cada uno)

| Tipo | Que es | Commit |
|------|--------|--------|
| **Refactor** | Cambio interno sin alterar el contrato publico | `refactor:` |
| **Nuevo** | Funcionalidad que no existia | `feat:` |
| **Bug fix** | Corrige comportamiento incorrecto | `fix:` |
| **Hotfix** | Fix urgente, primero en pre-produccion | `hotfix:` |

> Para distinguir: existe un controller viejo marcado `[Obsolete]`? Si → refactor. No → nuevo.

---

## LAS 4 ZONAS (donde esta cada cosa)

```
  ZONA 1 — LEGADO          ZONA 3 — NUEVO
  Kaptas.Services/         Kaptas.API/Features/
  Kaptas.API/Controllers/  (nace de cero)
  (vivo, no se toca)            |
       |                        | nace aqui
       | tests primero          |
       v                        v
  ZONA 2 — PUENTE          ZONA 4 — LIMPIO
  (Feature creado,         (Feature terminado + tests
   viejo sigue vivo,        + viejo Obsolete o eliminado)
   migrando clientes)

  Movimiento: LEGADO -> PUENTE -> LIMPIO. Nunca vuelve atras.
```

| Zona | Donde | Se puede tocar? |
|------|-------|-----------------|
| LEGADO | `Kaptas.Services/` + `Controllers/` | NO, hasta tener tests |
| PUENTE | `Features/[Modulo]/` + viejo vivo | Solo el Feature nuevo |
| NUEVO | `Features/[Modulo]/` | Es lo que creas |
| LIMPIO | `Features/[Modulo]/` + viejo eliminado | Refactor libre con tests |

---

## LOS 3 CICLOS (que hacer en cada iteracion)

```
  RECICLADO          VERDE             PARCHE
  (refactor)         (modulo nuevo)    (resolver bug)
       |                 |                 |
  R1 char.tests      N1 alcance        B1 detectar
  R2 seam+Feature    N2 carpeta        B2 reproducir
  R3 migrar tenant   N3 contrato       B3 localizar zona
  R4 obsolete        N4 implementar    B4 root cause
  R5 desmontar       N5 tests          B5 fix segun zona
                                        B6 regresion
                                        B7 postmortem
       |                 |                 |
       +--------+--------+---------+
                v
      CIERRE DE TURNO (C1-C4)
                |
                v
      (siguiente iteracion)
```

**Como decidir por cual entrar:**
- Llega un **bug** → PARCHE
- Llega un **requerimiento nuevo** → VERDE
- Quieres **limpiar proactivamente** → RECICLADO

> Los ciclos se alimentan: cada bug en LEGADO sube la prioridad de RECICLADO.
> Cada char.test del PARCHE es el primer paso del RECICLADO futuro.

---

## RECICLADO en detalle (LEGADO -> LIMPIO)

```
[R1] TESTS de caracterizacion del viejo
     Probar lo que HOY hace, no lo que deberia.
     Sin esto, no empiezas R2.

[R2] CREAR FEATURE + SEAM
     Interfaz con dos adapters: LegacyAdapter (viejo) + FeatureAdapter (nuevo).
     Un flag por tenant elige cual usar.

[R3] MIGRAR CLIENTES uno por uno (feature flag por tenant)
     El endpoint viejo sigue vivo. El nuevo vive en paralelo.

[R4] MARCAR VIEJO [Obsolete("Reemplazado por Features/X")]
     Compilar produce warnings -> el equipo lo ve.

[R5] DESMONTAR VIEJO cuando tenga 0 trafico confirmado.
```

---

## PARCHE: fix segun zona (la tabla critica)

| Zona del bug | Fix | Test |
|---|---|---|
| **LEGADO** | Hotfix minimo, no refactor. Registrar deuda. | Char. test (semilla de R1) |
| **PUENTE** | Bug en logica compartida → fix en Feature. Bug de cliente no migrado → fix en viejo. | Regresion en Feature |
| **NUEVO/LIMPIO** | Fix libre + TDD: repro rojo → fix → verde | Obligatorio |

**3 bugs en el mismo LEGADO** (o 1 critico de seguridad/IDOR) → ese modulo sube al tope de RECICLADO.

### Anti-patrones PROHIBIDOS
- `catch (Exception) { }` — nunca tragar errores
- `DateTime.UtcNow.AddHours(-4)` — mentir zona horaria
- Parchear sintoma sin root cause
- Borrar test para que pase
- `SaveChanges` dentro de un loop
- Devolver 200 para ocultar un 500
- "Ya que estoy, refactorizo" en un hotfix a LEGADO

---

## CIERRE DE TURNO (comun a los 3 ciclos)

```
[C1] VERIFICAR
     [ ] build: 0 errores, 0 warnings nuevos
     [ ] tests verdes
     [ ] Controller ~30 lineas (solo recibe y delega)
     [ ] AsNoTracking() en toda lectura
     [ ] Filtro tenant en toda query
     [ ] HTTP correctos: 200/201/400/401/403/404/500
     [ ] Cero codigo comentado, cero AddHours(-4)

[C2] ACOPLAMIENTO (la mas critica)
     [ ] NO importa Kaptas.Services.Implementations
     [ ] NO hereda de BaseService
     [ ] NO llama a servicios viejos

[C3] ACTUALIZAR REGISTRO-MODULOS.md

[C4] EXTRAER PATRONES a Features/_Shared/ si aparecio codigo reusable
```

---

## COMO SABER QUE FUE REFACTORIZADO

### Marcador A — REGISTRO-MODULOS.md (el tablero)
```markdown
| Modulo     | Zona    | Feature nuevo       | Controller viejo      | Tests | Deuda       |
|------------|---------|---------------------|-----------------------|-------|-------------|
| Auth       | LEGADO  | —                   | AuthController        | 0     | —           |
| Contactos  | PUENTE  | Features/Contactos/ | ContactController     | 12    | —           |
| Reportes   | LIMPIO  | Features/Reportes/  | (no existia)          | 8     | —           |
| Ventas     | LEGADO  | —                   | SalesController       | 0     | [BUG] x2   |
```

### Marcador B — Cabecera en codigo
```csharp
// LIMPIO Features/Reportes — nuevo — tests: 8 — 2026-06-28
public class ReportesService { ... }
```

### Marcador C — Git (la verdad real)
- `refactor:` / `feat:` / `fix:` en commits
- `git tag zona/limpio-contactos-2026-09`
- Si el REGISTRO dice LIMPIO pero git muestra commits recientes en el viejo → el REGISTRO miente

### Marcador D — Namespace
`Kaptas.API.Features.*` = nuevo/limpio · `Kaptas.Services.Implementations.*` = legado

---

## ESTRUCTURA DEL PROYECTO

```
Kaptas.API/
  Controllers/              ← LEGADO (no tocar sin tests)
  Features/                 ← NUEVO + LIMPIO
    _Shared/                ← patrones extraidos del ciclo
      ICurrentUserProvider.cs
      WorkspaceDTO.cs
      ReadModels/           ← queries de lectura al mundo viejo
      PATTERNS.md
    REGISTRO-MODULOS.md     ← el tablero (fuente de la verdad)
    [Modulo]/
      DTOs/
      I[Modulo]Service.cs   ← contrato primero
      [Modulo]Service.cs
      I[Modulo]Repository.cs
      [Modulo]Repository.cs
      [Modulo]Controller.cs ← ~30 lineas, solo recibe y delega

Kaptas.Services/            ← LEGADO (no se importa desde Features/)
Kaptas.Context/             ← se consume, no se toca
Kaptas.Tests/               ← tests de ambos mundos
```

### Registro automatico en Program.cs (una sola vez)
```csharp
builder.Services.Scan(scan => scan
    .FromAssemblies(typeof(Program).Assembly)
    .AddClasses(c => c.InNamespaces("Kaptas.API.Features"))
    .AsMatchingInterface()
    .WithScopedLifetime());
```

---

## REGLAS NO NEGOCIABLES

### SIEMPRE:
- Controller ~30 lineas — solo recibe y delega
- Interfaz antes que implementacion
- Filtro tenant en TODAS las queries
- Al menos 1 test antes de terminar
- AsNoTracking() en toda lectura
- Cabecera de estado + entrada en REGISTRO + commit tagueado

### NUNCA:
- Importar Kaptas.Services desde Features/
- Heredar de BaseService
- Logica de negocio en el controller
- DateTime.UtcNow.AddHours(-4)
- Codigo comentado
- SaveChanges en loop
- Tragar excepciones
- Desactivar tests para avanzar

---

# POR DONDE EMPEZAR (basado en lo que vimos hoy)

> Lo que aprendimos en la sesion de hoy define las prioridades reales.

## FASE 0 — Fundamentos (antes de tocar cualquier modulo)

Estas son las cosas que **ya sabemos que estan rotas** y bloquean todo lo demas:

| # | Que | Por que es critico | Donde |
|---|-----|-------------------|-------|
| 1 | **Crear `ICurrentUserProvider`** | Todos los Features lo necesitan. Reemplaza a `BaseService.GetCurrentSpaceWork()` que usa `IHttpContextAccessor` directo. | `Features/_Shared/` |
| 2 | **Crear `Kaptas.Tests`** | Sin tests no hay RECICLADO. Minimo: proyecto vacio + 1 test de humo. | nuevo proyecto |
| 3 | **Query filter global en `KaptasCoreContext`** | `OnModelCreating` → `HasQueryFilter(e => e.IdCompany == companyId)`. Una linea por entidad. Protege contra IDOR. | `Kaptas.Context/` |
| 4 | **Crear `Features/_Shared/`** | Carpeta base con contratos compartidos. | `Kaptas.API/Features/` |
| 5 | **Registro por convolucion en `Program.cs`** | Una sola vez, los modulos nuevos se registran solos. | `Program.cs` |

## FASE 1 — El modulo piloto (el primer RECICLADO)

**Elegir el modulo mas simple del LEGADO para ser el primer Feature.**

Criterios para elegirlo:
- Pocos endpoints (1-3)
- Poca logica de negocio
- Que NO dependa de `BaseService` (o dependa minimamente)
- Que tenga bugs recientes (asi el char.test sirve de verdad)

**Candidatos sugeridos** (en orden de menor a mayor riesgo):

| Modulo | Endpoints | Complejidad | Depende de BaseService? | Por que |
|--------|-----------|-------------|-------------------------|---------|
| **Reportes** (si no existe) | 1-2 | Baja | No | Si es nuevo, es ciclo VERDE no RECICLADO. Perfecto para practicar la estructura |
| **Caja Chica** (lista) | 2-3 | Media-Baja | Si (`GetCurrentSpaceWork`) | Ya lo exploramos hoy. Conocemos el SP, el flujo, los permisos |
| **Contactos** (lista) | 3-5 | Media | Si | Modulo central que muchos otros leen. Alto valor |
| **Auth** | 5-10 | Alta | Mucho | El mas critico. Dejar para cuando tengamos 2-3 modulos limpios como ejemplo |

**Recomendacion:** empezar con **Caja Chica** como primer RECICLADO porque:
1. Ya lo conocemos (vimos el SP, el service, el controller, los permisos)
2. Tiene 2-3 endpoints (listar, abrir, cerrar)
3. Depende de `BaseService` solo para `GetCurrentSpaceWork` (fácil de reemplazar con `ICurrentUserProvider`)
4. Ya encontramos bugs hoy (permisos faltantes) → hay material para char. tests

### Plan para Caja Chica como modulo piloto:

```
SEMANA 1:  FASE 0 (fundamentos) + char. tests de Caja Chica actual
SEMANA 2:  Crear Features/CajaChica/ con la estructura nueva
SEMANA 3:  Seam + migrar 1 tenant de prueba (dark launch)
SEMANA 4:  Migrar resto de tenants + marcar viejo [Obsolete]
```

## FASE 2 — Lo que vimos hoy que HAY que arreglar (deuda tecnica urgente)

Estos no son "refactor bonito", son cosas rotas que encontramos hoy:

| # | Problema | Solucion | Ciclo |
|---|----------|----------|-------|
| 1 | **SP `usp_generar_menu`** tenia `1 AS IsTitle` (menu no clickeable) | Ya arreglado, pero falta test que verifique | PARCHE |
| 2 | **SP `usp_generar_menu`** ordenaba por `id` no por `orden` | Ya arreglado | PARCHE |
| 3 | **`Permissions` table** tenia 4 entradas, faltaban 65 | Ya arreglado, pero el sistema de permisos es fragil | RECICLADO futuro |
| 4 | **`Master_Databases`** apuntaba a BD equivocada | Ya arreglado, pero no hay validacion | PARCHE |
| 5 | **`Users_Roles.IdCompany`** apuntaba a empresa equivocada | Ya arreglado | PARCHE |
| 6 | **CSS global** fuerza uppercase en todos los inputs | Arreglado en login, pero afecta a TODA la app | RECICLADO |
| 7 | **Email case-sensitive** en login | Arreglado con `.ToLower()`, pero no hay test | PARCHE |
| 8 | **`ResponseVM` traga errores** — `codresp` desconocido → mensaje generico | Falta fix real + logging | PARCHE |

> **Estos 8 items son la prueba de que el sistema necesita el ciclo.** Cada uno es un bug que un test hubiera prevenido. Empezar por Caja Chica nos da el primer modulo limpio como ejemplo vivo.

---

## POR QUE FUNCIONA EN ESTE PROYECTO

| Problema | Solucion |
|----------|----------|
| Multi-tenant complejo (1 BD por suscripcion) | Features/ usa el mismo DbContext; flag por tenant = rollback barato |
| Sin tests | Kaptas.Tests nace con FASE 0; char. tests de PARCHE alimentan RECICLADO |
| `BaseService` monolitico | No se toca hasta RECICLADO con R1 |
| IDOR en modulos viejos | Query filter global protege Features/ |
| "No sabemos que fue refactorizado" | REGISTRO + cabeceras + namespace + git tags |
| Bugs que vuelven | Regression test obligatorio en LIMPIO; loop PARCHE -> RECICLADO |

---

## CONCLUSION

El bucle es infinito a proposito. Cada vuelta entra por **uno** de los tres ciclos:

- **RECICLADO** — reemplaza al viejo sin cortar corriente (seam + flag por tenant)
- **VERDE** — entrega capacidad nueva, bien hecha desde el contrato
- **PARCHE** — repara lo roto segun la zona, captura el bug como test, alimenta al RECICLADO

**Empezar por:** FASE 0 (fundamentos) → Caja Chica como modulo piloto → iterar.
