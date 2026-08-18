---
name: kaptas-review-protocol
description: >
  Protocolo compartido por TODOS los agentes de revisión de Kaptas (backend, database, qa-tests,
  code-reviewer, docs, frontend-angular, observability, principal-reviewer). Define el contrato
  único: escala de severidad, formato de veredicto, regla de evidencia ejecutable, matriz de
  fronteras entre agentes y protocolo de traspaso. Se invoca al inicio de CUALQUIER revisión.
  Trigger: revisar código de Kaptas, emitir veredicto, traspasar un hallazgo a otro agente,
  coordinar revisión multi-agente, "pasa el gate?", cierre C1-C4.
license: Apache-2.0
metadata:
  author: phantom
  version: "1.0"
  scope: Kaptas-Epinosa (kaptas-web-api + RefactorKaptasWeb)
---

# Protocolo de Revisión Kaptas

> **Este archivo es la fuente única del contrato.** Ningún agente redefine severidades,
> formato de veredicto ni fronteras. Si algo acá contradice a un agente, gana este archivo.
> Cambios al protocolo se hacen ACÁ, una vez, no en ocho lugares.

---

## 0. La regla que domina a todas

> **Un hallazgo sin evidencia ejecutable no es un hallazgo: es una opinión.**

Cada afirmación de un agente debe venir con **una de estas tres** pruebas:

| Tipo | Forma | Ejemplo |
|---|---|---|
| **Comando** | El comando exacto + su salida real | `grep -rn "AsNoTracking" Features/RepairShop/Queries/ \| wc -l` → `3` |
| **Test** | Un test que falla hoy y pasa después del fix | `Post_InvalidBody_RespondsBadRequestWithResponseVmContract` |
| **Referencia** | `archivo.cs:línea` que se puede abrir | `Kaptas.DTO/Base/ResponseVM.cs:58` |

**Prohibido:** "podría fallar", "no parece seguro", "sería mejor", "generalmente se recomienda"
sin una de las tres. Si no lo podés probar, lo declarás como **hipótesis no verificada** y decís
qué comando la resolvería.

### El caso que justifica esta regla

En este proyecto, `ValidateModelFilter` pasó **7 tests unitarios en verde mientras estaba roto**.
`ServiceFilterAttribute` implementa `IOrderedFilter` con su propio `Order = 0` e ignora el de la
clase envuelta, así que el filtro corría *después* del `ModelStateInvalidFilter` de `[ApiController]`
(`Order = -2000`) y nunca actuaba. Solo lo detectó un test HTTP contra la app levantada.

**Lección de protocolo:** un test que prueba una unidad aislada no prueba que esa unidad *gane
la carrera* en el pipeline real. Cuando el comportamiento depende de orden, wiring, DI o
configuración, la evidencia válida es de integración, no unitaria.

### El error de medición que ya se cometió tres veces

Un comando que corre y devuelve un número **no es evidencia de lo que creés estar midiendo.**
Casos reales de este proyecto, todos con el mismo defecto:

| Se quiso medir | Se midió en realidad | Consecuencia |
|---|---|---|
| Uso de los atributos `Positive`/`NonNegative`/`Percentage` | El nombre del archivo `NumericValidationAttributes` | Se concluyó "0 usos, se borran". Real: **9 usos**. Casi se borra código vivo |
| Archivos de test | Archivos que se *llaman* `*Tests.cs` (25) | Real: **27** archivos contienen `[Fact]`/`[Theory]`. Dos no siguen la convención de nombre |
| Tests totales | Se citó CLAUDE.md (239) en vez de contar | Real: **104** atributos |
| Tests de la suite | Los **atributos** `[Fact]`/`[Theory]` (104) | El runner ejecuta **121**: cada `[Theory]` con N `InlineData` produce N casos. Un agente que cite 104 va a creer que faltan 17 |
| Controllers legado | `ls Controllers/*.cs` → **12** | El glob no entra en subcarpetas. Reales: **81**. Se subestimó el legado **7×**, y el error estaba en `REGISTRO-MODULOS.md` desde antes. Para contar archivos: `find`/`grep -r`, nunca `ls` con glob |

**Regla:** antes de reportar un número, respondé *"¿el comando mide la cosa o mide un proxy
de la cosa?"*. Nombres de archivo, convenciones de naming y documentación son **proxies**.
Contenido, símbolos y salida de compilador son **la cosa**.

**Corolario:** cuando un conteo respalda una acción destructiva (borrar, desactivar, declarar
muerto), es obligatorio verificarlo por un segundo camino independiente antes de actuar.

---

## 1. Escala de severidad (única, no negociable)

| Nivel | Significado | Efecto sobre el merge | Quién puede levantarlo |
|---|---|---|---|
| **BLOCKER** | Rompe producción, filtra datos entre tenants, pierde información, o viola una regla NUNCA de CLAUDE.md §6 | **Bloquea.** No hay merge, no hay excepción, no hay "lo arreglo después" | Cualquier agente |
| **MAJOR** | Deuda que se vuelve cara: viola un principio de §1, sin test, acopla módulos, N+1 en camino caliente | Bloquea salvo **waiver escrito** del principal-reviewer con fecha de vencimiento y entrada en `REGISTRO-MODULOS.md` | Cualquier agente |
| **MINOR** | Legibilidad, naming, duplicación tolerable, comentario que miente | No bloquea. Se anota | Cualquier agente |
| **NIT** | Preferencia de estilo sin impacto medible | No bloquea. **El autor puede ignorarlo sin justificar** | Cualquier agente |

**Antipatrón prohibido — inflar severidad para forzar atención.** Si todo es BLOCKER, nada lo es;
el autor aprende a ignorar el gate entero. Un agente que marca BLOCKER algo que no cumple la
definición **pierde credibilidad y el principal-reviewer debe degradarlo explícitamente**.

**Antipatrón inverso, igual de grave — degradar para no frenar la entrega.** Un IDOR entre tenants
es BLOCKER aunque el sprint cierre mañana.

### Prueba de BLOCKER
Antes de marcar BLOCKER respondé por escrito:
> *"¿Qué pasa concretamente en producción si esto sale así?"*

Si la respuesta es "nada inmediato, pero es deuda" → es MAJOR, no BLOCKER.

---

## 2. Formato de veredicto (obligatorio, idéntico en los 8 agentes)

Todo agente cierra su revisión con **exactamente** este bloque:

```markdown
## Veredicto — <nombre-del-agente>

**Estado:** APROBADO | RECHAZADO | APROBADO CON RESERVAS | FUERA DE MI ALCANCE

**Alcance revisado:** <archivos/rutas concretas que abrí>
**Alcance NO revisado:** <lo que quedó fuera y por qué>

### Hallazgos

| # | Sev | Archivo:línea | Hallazgo | Evidencia | Fix propuesto |
|---|-----|---------------|----------|-----------|---------------|
| 1 | BLOCKER | `X.cs:42` | ... | `<comando + salida>` | ... |

### Traspasos
| Hallazgo | Agente destino | Por qué no es mío |
|---|---|---|
| ... | `kaptas-database` | Es plan de ejecución SQL, no diseño de módulo |

### Verificado en verde
- [x] <check> — evidencia: `<comando>` → `<salida>`
- [ ] <check no verificable> — **por qué no**: <razón>

**Firma:** <agente> · <fecha> · commit/rama: <ref>
```

**Reglas del formato:**
- `APROBADO` exige **cero** BLOCKER y **cero** MAJOR sin waiver.
- `APROBADO CON RESERVAS` exige listar cada reserva con fecha de vencimiento.
- Un check sin evidencia **no se marca**. Se deja vacío con la razón. Marcar un check que no
  verificaste es la falta más grave del protocolo: envenena todo el gate.
- **Nunca** se firma sobre archivos que no se abrieron.

---

## 3. Matriz de fronteras — quién es dueño de qué

> **Un archivo puede ser leído por varios agentes. Un *tipo de hallazgo* tiene UN solo dueño.**
> Esto es lo que evita que 8 agentes opinen de SOLID sobre el mismo `Service.cs`.

| Tipo de hallazgo | Dueño único | Los demás deben |
|---|---|---|
| Estructura del módulo, zonas, ciclos, acoplamiento entre módulos, **ubicación de un archivo (módulo vs `_Shared/`, ver §7.1)** | `kaptas-clean-arch` (skill) | Traspasar |
| Tenant, IDOR, SQLi, authz, secretos, exposición de datos | `kaptas-security-gate` (skill) | Traspasar |
| .NET/EF/CQRS, Commands/Queries, DI, contrato HTTP, `ResponseVM`, filtros, versionado | `kaptas-backend` | Traspasar |
| Plan SQL, índices, N+1, transacciones, deadlocks, SPs, normalización | `kaptas-database` | Traspasar |
| Cobertura, diseño de test, test que miente, falta de test de integración | `kaptas-qa-tests` | Traspasar |
| SOLID, Clean Code, DRY/KISS/YAGNI, naming, complejidad, código muerto | `kaptas-code-reviewer` | Traspasar |
| `REGISTRO-MODULOS.md`, ADR, cabeceras §9, changelog, API docs | `kaptas-docs` | Traspasar |
| Angular, componentes, RxJS/signals, estado, bundle, accesibilidad | `kaptas-frontend-angular` | Traspasar |
| Logging, correlación, métricas, PII en logs, qué se traga y qué se propaga | `kaptas-observability` | Traspasar |
| Coordinación, veredicto final, resolución de conflictos, waivers | `kaptas-principal-reviewer` | Obedecer |

### Zona gris — resolución determinista

Cuando dos agentes reclaman el mismo hallazgo, gana el de la **columna izquierda**:

| Conflicto | Gana | Razón |
|---|---|---|
| `backend` vs `database` sobre una consulta LINQ | `backend` si es *diseño* (Query mal ubicada), `database` si es *ejecución* (falta índice, N+1) | Diseño precede a plan |
| `code-reviewer` vs `clean-arch` sobre SOLID | `clean-arch` si es estructura de módulo, `code-reviewer` si es dentro de una clase | Macro vs micro |
| `qa-tests` vs cualquiera sobre "falta un test" | `qa-tests` **siempre** | Es su dominio exclusivo |
| `security-gate` vs cualquiera | `security-gate` **siempre** | Seguridad no se negocia por comodidad |
| `observability` vs `backend` sobre un `catch` | `backend` decide si propaga; `observability` decide qué se loguea | Flujo vs registro |

**Si la matriz no resuelve el conflicto:** ambos agentes escriben su posición en 3 líneas y el
`principal-reviewer` decide. Esa decisión se registra como ADR (tarea de `kaptas-docs`).

---

## 4. Protocolo de traspaso

Cuando un agente encuentra algo fuera de su alcance:

1. **NO lo arregla.** Ni "de paso". Ni "es una línea".
2. **NO lo ignora.** Ignorarlo es tan grave como invadir.
3. Lo registra en la tabla `### Traspasos` con agente destino y razón.
4. Sigue revisando lo suyo. Un traspaso **no interrumpe** la revisión propia.
5. El `principal-reviewer` enruta el traspaso y **no cierra hasta que el destino firme**.

**Por qué no lo arregla:** un agente que toca fuera de su dominio produce cambios que nadie
revisó bajo el criterio correcto. El fix "obvio" de un `catch` hecho por el agente de docs es
exactamente cómo se cuela un bug de flujo de errores.

---

## 5. Reglas heredadas de CLAUDE.md que TODO agente verifica

Estas son transversales. Cada agente las chequea **dentro de su alcance**, sin invadir.

**SIEMPRE**
- Controller ~30 líneas, solo recibe y delega
- Interfaz antes que implementación
- Filtro de tenant en TODA query
- `AsNoTracking()` en toda lectura
- `UtcNow` para fechas
- Al menos 1 test antes de cerrar; tests ANTES de tocar código
- Cabecera §9 en archivo nuevo/limpio

**NUNCA**
- Importar `Kaptas.Services` desde `Features/`
- Heredar de `BaseService` · usar `IBaseService` · `ISpExecute` / `IDbService`
- Lógica de negocio en el Controller
- `DateTime.UtcNow.AddHours(-4)`
- Código comentado · `SaveChanges` en loop · `catch(Exception){}` que traga
- Desactivar o borrar tests para avanzar
- **Devolver 200 para ocultar un 500**
- "Ya que estoy, refactorizo" en un hotfix a LEGADO
- Arreglar un bug sin reproducirlo primero

### Comandos de verificación transversal

```bash
cd kaptas-web-api

# Acoplamiento al legado (debe dar 0)
grep -rn "using Kaptas.Services" --include=*.cs Kaptas.API/Features/ | wc -l
grep -rn "BaseService\|IBaseService\|ISpExecute\|IDbService" --include=*.cs Kaptas.API/Features/ | wc -l

# Fechas con offset hardcodeado (debe dar 0)
grep -rn "AddHours(-4)\|DateTime.Now" --include=*.cs Kaptas.API/Features/

# Excepción tragada (revisar cada hit a mano)
grep -rn -A2 "catch (Exception" --include=*.cs Kaptas.API/Features/

# SaveChanges dentro de un loop (revisar cada hit)
grep -rn -B5 "SaveChangesAsync" --include=*.cs Kaptas.API/Features/ | grep -i "foreach\|for (\|while"

# Tamaño de controllers (~30 líneas)
find Kaptas.API/Features -name "*Controller.cs" -exec wc -l {} \;

# Cabecera §9 en archivos de Features/
find Kaptas.API/Features -name "*.cs" -exec sh -c 'head -1 "$1" | grep -q "^// \(LIMPIO\|NUEVO\|PUENTE\)" || echo "sin cabecera: $1"' _ {} \;
```

---

## 6. Contexto verificado del proyecto

> Estos números fueron medidos, no estimados. **Si un agente los cita, debe re-medirlos** —
> el proyecto se mueve.

| Dato | Valor al 2026-07-18 | Cómo se re-mide |
|---|---|---|
| Módulos en `Features/` | 1 (`RepairShop`) + `_Shared` | `ls Kaptas.API/Features/` |
| Áreas de `_Shared/` | 10 | `ls Kaptas.API/Features/_Shared/` |
| Controllers legado | **81 clases** en 82 archivos | `grep -rl ": Controller\b\|: ControllerBase" --include=*.cs Kaptas.API/Controllers/ \| wc -l` — **NO** uses `ls Controllers/*.cs`: el glob ignora las 4 subcarpetas (`Invoices/`, `Kaptas/`, `KaptasCore/`, `Restaurant/`) y devuelve 12 |
| Archivos en `Kaptas.Services/` | 194 | `find Kaptas.Services -name "*.cs" \| wc -l` |
| **Tests ejecutados** — el único número que vale para "¿está verde?" | **121** (0 fallados, ~3m 30s) | `dotnet test --nologo` |
| Atributos `[Fact]`/`[Theory]` en el código | 104 en 27 archivos | `grep -rc "\[Fact\]\|\[Theory\]" --include=*.cs Kaptas.Tests/ \| awk -F: '{s+=$2} END {print s}'` |
| Target framework | `net7.0` en los **7** `.csproj` | `grep -h "TargetFramework" */*.csproj \| sort \| uniq -c` |
| Tests según CLAUDE.md §2 | 239 (43+196) — **desactualizado** | — |
| Angular | 20.3, RxJS 7.8, TS 5.8 | `grep '"@angular/core"' RefactorKaptasWeb/package.json` |
| Archivos con `signal()` | 1 | `grep -rl "signal(" RefactorKaptasWeb/src/ \| wc -l` |

**La discrepancia de tests (104 real vs 239 documentado) es un hallazgo abierto**, propiedad de
`kaptas-docs`. No lo re-reporte cada agente.

### Hechos técnicos que ya costaron caro

| Hecho | Dónde | Consecuencia si se olvida |
|---|---|---|
| `[ServiceFilter]` trae su propio `Order = 0` e ignora el de la clase | `RepairShopController.cs:23` | El filtro no corre. Tests unitarios verdes, feature rota |
| `ApiBehaviorOptions` es **global**: afecta los 12 controllers legado | `Program.cs` | Cambiar el contrato de error del legado sin querer |
| `ICurrentUserProvider.GetScopeAsync()` valida acceso a la empresa | `_Shared/Identity/` | Confiar en el header `company` = IDOR entre tenants (era el D2 del legado) |
| `ResponseVM<T>` tiene `else` sin llaves en `REQUIRED_ACTION` | `Kaptas.DTO/Base/ResponseVM.cs:58` | Las 2 líneas post-`else` se ejecutan siempre. **LEGADO: requiere characterization test antes de tocar** |
| El módulo v2 convive con el legado por ruta (`api/v2/[controller]`) | `RepairShopController.cs:25` | Colisión de rutas |

---

## 7. Zonas — qué se puede tocar

| Zona | Dónde | Regla |
|---|---|---|
| **LEGADO** | `Kaptas.Services/`, `Kaptas.API/Controllers/`, `Kaptas.DTO/Base/` | **NO se toca sin characterization test.** Hallazgos se registran como deuda, no se arreglan |
| **PUENTE** | `Features/[Modulo]/` con el viejo aún vivo | Solo el Feature nuevo |
| **NUEVO / LIMPIO** | `Features/[Modulo]/` | Refactor libre, con test |

> Un agente que propone un fix en LEGADO sin test de caracterización está **violando el protocolo**,
> por más correcto que sea el fix. El veredicto correcto ahí es: registrar deuda + proponer ciclo RECICLADO.

### 7.1 — Criterio de ubicación: módulo vs `_Shared/`

> **Dueño del veredicto: `kaptas-clean-arch`.** Esta sección está acá porque `backend`
> (define DTOs), `code-reviewer` (juzga duplicación) y `clean-arch` (dictamina ubicación)
> necesitan la misma regla. Escribirla en tres lugares sería la duplicación que este diseño evita.

**La pregunta correcta NO es "¿cuántos módulos lo usan?".**

Es: **"si el módulo cambia, ¿esto tiene que cambiar?"**

| Respuesta | Ubicación | Por qué |
|---|---|---|
| **No, nunca** | `_Shared/<Area>/` | No le pertenece al dominio. Da igual que hoy lo use un solo módulo |
| **Sí** | dentro del módulo | Es una regla del negocio de ese módulo |

**Propiedad de dominio manda sobre cantidad de consumidores.** El conteo de consumidores sirve
para frenar la generalización prematura de **lógica de negocio**, no para ubicar vocabulario
neutro. Un consumidor no prueba que algo sea del módulo; prueba que hay un módulo solo.

#### Separá el mecanismo de los valores

El caso canónico, tal como quedó en el repo:

```csharp
// _Shared/Http/Validation/  →  MECANISMO, neutro respecto al dominio
[MaxText(n)]        [RequiredId]        [Positive]        [RequiredDate]

// Features/RepairShop/DTOs/  →  VALOR, puro dominio taller
public static class RepairShopFieldLengths
{
    public const int Observacion = 1000;   // Operacion.Observacion, columna real de la BD
}

// uso — cada mitad en su lugar:
[MaxText(RepairShopFieldLengths.Observacion)] public string Nota { get; set; }
```

`[MaxText]` no sabe qué es un taller: sabe truncar texto. Que la observación mida 1000 **sí** es
una regla de taller. Mecanismo compartido, valores del dominio.

#### El error que ya se cometió

Los atributos se movieron de `_Shared/` al módulo con este razonamiento: *"solo hay 1 consumidor,
entonces le pertenece a RepairShop"*. **Mal.** Se aplicó conteo de consumidores donde correspondía
propiedad de dominio. Hubo que revertirlo (`9aad5182` → `a3aca1ef`).

Dos cosas que el error hizo evidentes:

1. **El acoplamiento que se temía no existía.** Son atributos declarativos: sin estado, sin
   dependencias, sin dominio. Importar `[Positive]` no acopla el módulo a nada.
2. **Partió una unidad cohesiva.** Los atributos producen errores de `ModelState`; `ValidateModelFilter`
   los convierte en `ResponseVM`. Son dos mitades de un mismo mecanismo — el contrato de entrada
   HTTP — y por eso conviven en `_Shared/Http/`. Separarlos fue peor que cualquiera de las
   dos ubicaciones discutidas.

#### Prueba antes de mover algo a `_Shared/` o sacarlo de ahí

Respondé las cuatro por escrito:

1. Si el módulo cambia, ¿esto cambia? → **Sí** = módulo · **No** = `_Shared/`
2. ¿Tiene dependencias inyectables o hace falta mockearlo? → Sí = servicio de `_Shared/` con interfaz
3. ¿Estoy separando algo de la pieza que lo consume directamente? → Si sí, **frená**: probablemente
   estés rompiendo cohesión
4. ¿Mi argumento es "solo lo usa un módulo"? → Ese argumento **no decide nada** por sí solo

**Y no muevas archivos "de paso" en un diff que trata de otra cosa.** Un movimiento de ubicación
es un cambio de arquitectura: va solo, con su razón escrita.

---

## 8. Orden de ejecución del gate

```
                    ┌──────────────────────────┐
                    │  principal-reviewer      │  ← recibe el diff, reparte
                    └────────────┬─────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        │  OLA 1 — en paralelo (independientes)           │
        │  clean-arch · security-gate · backend ·         │
        │  database · frontend-angular                    │
        └────────────────────────┬────────────────────────┘
                                 │  (si hay BLOCKER → corta acá)
        ┌────────────────────────┼────────────────────────┐
        │  OLA 2 — dependen de que el diseño esté firme    │
        │  code-reviewer · observability                  │
        └────────────────────────┬────────────────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        │  OLA 3 — necesitan el código final              │
        │  qa-tests → docs                                │
        └────────────────────────┬────────────────────────┘
                                 │
                    ┌────────────┴─────────────┐
                    │  principal-reviewer      │  ← veredicto final
                    └──────────────────────────┘
```

**Por qué este orden:** correr `qa-tests` antes de que el diseño esté firme produce tests sobre
código que va a cambiar — trabajo tirado. Correr `docs` antes del final documenta algo que no existe.
Un BLOCKER en OLA 1 **corta**: no se gastan las olas 2 y 3 sobre un diseño que se va a rehacer.

---

## 9. Fail fast del gate

El gate se detiene inmediatamente si:

- Cualquier agente devuelve **BLOCKER** → vuelve al autor, no se corren las olas siguientes
- El build no compila → `dotnet build` es precondición, no un check
- Hay tests en rojo antes de empezar → no se revisa sobre una base rota
- El diff toca LEGADO sin characterization test → rechazo inmediato

```bash
# Precondición del gate — si esto falla, no se revisa nada
cd kaptas-web-api && dotnet build --nologo -warnaserror && dotnet test --nologo
```
