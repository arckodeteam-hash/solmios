# Tracking de la refactorización — índice

> **Nada de esto vive dentro de un repositorio git.** `Kaptas-Epinosa/` no es un repo:
> los dos repos son `kaptas-web-api/` y `RefactorKaptasWeb/`, y este directorio está
> por fuera de ambos. Los planes, auditorías y agentes **no se pushean nunca**.

---

## Dónde va cada cosa

| Qué | Dónde | Por qué ahí |
|---|---|---|
| Plan, spec, tareas y PR **de un módulo** | `openspec/changes/<módulo>/` | Todo lo del módulo junto, en una sola carpeta |
| Tablero global de la migración | `REGISTRO-MODULOS.md` (raíz) | Lo referencia `CLAUDE.md` §9; se actualiza en cada cierre C3 |
| Reglas de arquitectura | `CLAUDE.md` (raíz) | Fuente de verdad. Debe estar en la raíz para que las herramientas lo lean |
| Auditoría transversal (no de un módulo) | `AUDITORIA-ARQUITECTURA.md` (raíz) | Cruza todos los módulos; no pertenece a ninguno |
| Agentes y skills de revisión | `.claude/` | Herramienta local, no producto |
| Documentación **del código** | `kaptas-web-api/docs/` | Esa sí va versionada: viaja con el código |

**Regla:** si un documento habla de **un** módulo, va en su carpeta de `changes/`.
Si habla de **todos**, va en la raíz. Nada suelto en la raíz que pertenezca a un módulo.

---

## Estado por módulo

| Módulo | Carpeta | Estado | Documentos |
|---|---|---|---|
| **Taller** (RepairShop) | `changes/refactor-repair-shop/` | PR abierto, esperando merge a `qa` | `proposal` · `design` · `tasks` · `specs/` · `estado-modulos` · `plan.html` · `PR-taller-v2` |
| **Contactos** | `changes/migrar-contactos/` | Plan v2 listo · **bloqueado por 3 precondiciones** | `pasos.md` · `pasos.html` · `pasos-v1-obsoleto` |
| **Entorno de tests** | `changes/inicializar-entorno/` | Cerrado | `proposal` · `tasks` · `PR-iniciar-entorno` |

---

## Contactos — no arranca todavía

El plan v2 (`changes/migrar-contactos/pasos.md`) está completo, pero **tres preguntas
solo se responden con acceso a la base** y bloquean la FASE 0:

1. **¿Quién escribe `ContactoBitacora`** — el SP o un trigger? Si es el SP y v2 lo reemplaza
   por EF, la auditoría desaparece en silencio y ningún test lo detecta.
2. **¿Cómo numera `P_Contactos_Insert_Update_Grabar`?** Define si `Create` necesita
   `sp_getapplock` o `SEQUENCE` nativa.
3. **¿`dbo.Log` ya tiene PII de contactos?** Si devuelve filas, la fuga ya ocurrió.

Los comandos están en la §2 del plan.

---

## Por qué la v1 del plan de Contactos se cayó

Declaraba **1 stored procedure**. Hay **14**. Buscó el SP por el nombre que ya conocía;
los otros 13 están embebidos en cadenas `"exec …"` concatenadas y el grep no los veía.

Es el mismo error que apareció cinco veces en este proyecto: **medir un proxy en vez de
la cosa**. Por eso el plan v2 exige que **todo número lleve al lado el comando que lo
re-mide**, y que cada bloque diga si es `VERIFICADO` o `HIPÓTESIS`.

| Se quiso medir | Se midió | Real |
|---|---|---|
| SPs de Contactos | el SP conocido | **14** |
| Archivos de test | archivos `*Tests.cs` (25) | **27** |
| Tests de la suite | atributos `[Fact]`/`[Theory]` (104) | **121** ejecutados |
| Controllers legado | `ls Controllers/*.cs` (12) | **81** — el glob no entra en subcarpetas |
| Uso de unos atributos | el nombre del archivo | 9 usos, casi se borran |

---

## Números verificados (2026-07-19)

Re-medirlos antes de citarlos. El proyecto se mueve.

| Dato | Valor | Comando |
|---|---|---|
| Tests ejecutados | **121**, 0 fallados | `dotnet test --nologo` |
| Controllers legado | **81** | `grep -rl ": Controller\b\|: ControllerBase" --include=*.cs Kaptas.API/Controllers/ \| wc -l` |
| Archivos en `Kaptas.Services/` | 194 | `find Kaptas.Services -name "*.cs" \| wc -l` |
| Módulos en `Features/` | 1 (`RepairShop`) + `_Shared` | `ls Kaptas.API/Features/` |
| `_Shared/` | 10 áreas, 1.942 LOC | `find Kaptas.API/Features/_Shared -name "*.cs" \| xargs wc -l \| tail -1` |
| Target framework | `net7.0` en los 7 `.csproj` | `grep -h "TargetFramework" */*.csproj \| sort \| uniq -c` |

---

## Deudas abiertas, fuera de cualquier módulo

| # | Deuda | Dónde | Estado |
|---|---|---|---|
| 1 | Secretos versionados en el frontend (88 commits) | `RefactorKaptasWeb/src/environments/environment.ts` | **sin resolver** — requiere rotar claves |
| 2 | Carrera en la numeración de documentos | `_Shared/Sequences/SequenceNumberProvider.cs` | sin resolver — riesgo fiscal |
| 3 | `ValidateTenantFilter` sin un solo test | `_Shared/Tenancy/` | sin resolver — Contactos lo paga en su FASE 1 |
| 4 | `ExceptionMiddleware` sin logger | `Kaptas.API/Middlewares/` | LEGADO — requiere characterization test |
| 5 | `CLAUDE.md` §2 declara Scrutor, que no existe | `CLAUDE.md:34,48` | sin corregir |
| 6 | `ResponseVM` — `else` sin llaves | `Kaptas.DTO/Base/ResponseVM.cs:58` | LEGADO — ciclo PARCHE |
