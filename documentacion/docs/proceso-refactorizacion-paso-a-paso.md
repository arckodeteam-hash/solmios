# Proceso de Refactorización — Paso a Paso

**Tipo de ciclo:** RECICLADO (LEGADO → LIMPIO)
**Fecha:** 2026-06-29
**Propósito:** Guía conceptual de cómo migrar un módulo viejo a la nueva estructura

---

## ¿QUÉ ES EL RECICLADO?

Es el proceso de **reemplazar un módulo viejo por uno nuevo SIN APAGAR EL SISTEMA**.

El usuario no nota el cambio. El endpoint viejo sigue funcionando. El nuevo vive en paralelo. Se migra cliente por cliente. Cuando todos están en el nuevo, se apaga el viejo.

**Analogía:** Es como cambiar el motor de un avión while está volando. No lo apagas. Conectas el nuevo al lado. Cuando el nuevo funciona, desconectas el viejo.

---

## LAS 5 FASES (R1 a R5)

```
R1 → R2 → R3 → R4 → R5
 │    │    │    │    │
 │    │    │    │    └── DESMONTAR: borrar el código viejo
 │    │    │    └─────── OBSOLETO: marcar el viejo como deprecated
 │    │    └──────────── MIGRAR: mover clientes al nuevo uno por uno
 │    └───────────────── CREAR: construir el nuevo módulo
 └────────────────────── PROBAR: tests del código viejo tal como está
```

---

## ANTES DE EMPEZAR: ¿QUÉ NECESITAS?

### Checklist pre-refactorización

```
[ ] ¿El módulo tiene bugs conocidos?
    → Si sí, el refactor los arregla
    → Si no, igual vale la pena limpiar

[ ] ¿Cuántos endpoints tiene?
    → 1-3: módulo simple, 2-4 semanas
    → 4-8: módulo mediano, 4-6 semanas
    → 9+: módulo complejo, dividir en sub-modulos

[ ] ¿Depende de BaseService?
    → Si sí, necesitas ICurrentUserProvider primero (FASE 0)
    → Si no, puedes empezar directo

[ ] ¿Hay otros módulos que LEEN de este?
    → Si sí, el cambio los afecta — testear también esos
    → Si no, el cambio es aislado

[ ] ¿Tienes tests?
    → Si sí, correrlos antes de empezar
    → Si no, CREAR tests primero (R1)
```

---

## FASE 0 — FUNDAMENTOS (antes de tocar el módulo)

Esta fase **no es parte del módulo**. Son cosas que el sistema necesita para que cualquier refactor funcione.

### Paso 0.1: Crear ICurrentUserProvider

**Qué es:** Una forma de obtener el tenant (empresa, sucursal) y el usuario actual SIN usar BaseService.

**Por qué:** Todos los módulos nuevos lo necesitan. Si no existe, el módulo nuevo no puede funcionar.

**De dónde sale:** Del `IHttpContextAccessor` que ya existe en ASP.NET Core. Los headers `company`, `branch`, `store` que el frontend envía.

### Paso 0.2: Crear proyecto de tests (Kaptas.Tests)

**Qué es:** Un proyecto separado donde viven los tests de integración.

**Por qué:** Sin tests no hay forma segura de refactorizar. Si rompes algo, no te enteras.

### Paso 0.3: Registro por convención en Program.cs

**Qué es:** Una línea en Program.cs que registra automáticamente todos los servicios de Features/.

**Por qué:** Para que no tengas que agregar cada módulo manualmente. El módulo nuevo se registra solo.

### Paso 0.4: Crear Features/_Shared/

**Qué es:** La carpeta con los contratos compartidos (ICurrentUserProvider, WorkspaceDto, ResponseVm).

**Por qué:** Todos los módulos nuevos los usan. Van aquí una sola vez.

---

## R1 — TESTS DE CARACTERIZACIÓN

### ¿Qué es?

Probar lo que el módulo viejo **HOY hace**, sin juzgar si está bien o mal. Solo anotar qué devuelve.

### ¿Por qué primero?

Si no sabes qué hace el viejo, no puedes crear el nuevo. Si el nuevo hace algo diferente, estás rompiendo el sistema.

### ¿Qué se hace?

1. **Listar todos los endpoints del módulo viejo**
   - Cada endpoint es un test
   - Ejemplo: `GET /api/Contacto` → 1 test

2. **Para cada endpoint, probar:**
   - ¿Qué HTTP status devuelve? (200, 400, 401, 404)
   - ¿Qué datos devuelve? (estructura, campos)
   - ¿Qué pasa con datos inválidos?
   - ¿Qué pasa sin autenticación?

3. **Escribir el test tal como está el código viejo**
   - NO arreglar bugs todavía
   - NO cambiar comportamiento
   - Solo documentar qué hace

### Ejemplo conceptual

```
Test: "Listar contactos retorna paginación"
  → Llamar GET /api/Contacto?page=1&size=10
  → Esperar 200 OK
  → Verificar que tiene campo "items"
  → Verificar que tiene campo "totalResults"
  → NO verificar si los datos están correctos (eso es otro test)

Test: "Crear contacto sin nombre retorna error"
  → Llamar POST /api/Contacto con nombre vacío
  → Esperar 400 o mensaje de error
  → Documentar qué mensaje devuelve
```

### ¿Cuántos tests?

| Módulo | Endpoints | Tests mínimo |
|--------|-----------|--------------|
| Simple (1-3 endpoints) | 3 | 5-8 tests |
| Mediano (4-8 endpoints) | 8 | 12-15 tests |
| Complejo (9+ endpoints) | 15+ | 20+ tests |

### Output de R1

Al terminar R1 tienes:
- Un proyecto de tests que PASSA contra el código viejo
- Un documento de "qué hace el módulo hoy"
- Una base para comparar con el nuevo

### ⚠ IMPORTANTE

Si los tests de R1 FALLAN, eso significa que el código viejo ya tiene bugs. **No los arregles todavía.** Anota el bug como "conocido" y sigue. Los arreglarás en R2 o en el ciclo PARCHE.

---

## R2 — CREAR FEATURE + SEAM

### ¿Qué es?

Crear el nuevo módulo al lado del viejo, con una **interfaz común** que los dos implementan. El sistema elige cuál usar.

### ¿Qué es un "Seam"?

Un seam (costura) es un punto donde puedes **cambiar el comportamiento sin modificar el código circundante**.

En la práctica: una interfaz con dos implementaciones:
- **LegacyAdapter:** Envuelve al código viejo (no lo cambia)
- **FeatureAdapter:** Es el código nuevo

El sistema decide cuál usar basándose en un **feature flag** (una configuración por tenant).

### ¿Cómo se ve conceptualmente?

```
ANTES (sin seam):
  Controller → ContactService (viejo)

DESPUÉS (con seam):
  Controller → IContactoService
                    │
                    ├── ContactoLegacyAdapter (envuelve al viejo)
                    └── ContactoFeatureAdapter (el nuevo)
```

### Pasos de R2

#### Paso 2.1: Crear la interfaz

Definir qué métodos tiene el módulo. Ejemplo:

```
IContactoService:
  - GetPorId(int id) → ContactoDetailDto
  - Listar(filtros) → PaginatedResult
  - Crear(request) → int
  - Actualizar(request) → bool
  - Eliminar(id) → bool
```

Esta interfaz es el **contrato**. Ambos adapters la implementan.

#### Paso 2.2: Crear el LegacyAdapter

Es un **wrapper** del código viejo. No cambia nada. Solo implementa la interfaz llamando al servicio viejo.

```
ContactoLegacyAdapter:
  - Recibe IContactService (el viejo)
  - En GetPorId() → llama a _viejo.GetContact(id)
  - En Crear() → llama a _viejo.Create(contact)
  - NO cambia lógica
  - NO arregla bugs
```

**Propósito:** El sistema puede seguir usando el código viejo pero a través de la nueva interfaz.

#### Paso 2.3: Crear el FeatureAdapter

Es el **código nuevo**. Implementa la interfaz con la lógica limpia.

```
ContactoFeatureAdapter:
  - Recibe KaptasCoreContext + ICurrentUserProvider
  - En GetPorId() → query EF Core con filtro tenant
  - En Crear() → validaciones + EF Core
  - SÍ tiene AsNoTracking, DateTime.UtcNow, etc.
```

**Propósito:** Es el módulo limpio que eventualmente reemplazará al viejo.

#### Paso 2.4: Crear el feature flag

Una configuración por tenant que dice cuál adapter usar.

```
En la BD (o appsettings.json por tenant):
  "UseNewContactos": false   ← por defecto usa el viejo

En Program.cs:
  Si tenant.UseNewContactos == true
    → usar ContactoFeatureAdapter
  Si no
    → usar ContactoLegacyAdapter
```

#### Paso 2.5: Tests del nuevo módulo

Escribir tests que prueben el **FeatureAdapter** (el nuevo). Son los mismos tests de R1 pero corriendo contra el código nuevo.

```
Test R1 (viejo): "Listar contactos retorna paginación" → PASS
Test R2 (nuevo): "Listar contactos retorna paginación" → PASS (debe pasar igual)
```

Si el test de R2 FALLA pero el de R1 PASSA, significa que el nuevo hace algo diferente. **Ajustar el nuevo para que sea igual al viejo** (a menos que el viejo esté claramente mal).

### Output de R2

Al terminar R2 tienes:
- Una interfaz IContactoService
- Un LegacyAdapter que envuelve al viejo
- Un FeatureAdapter con el código nuevo
- Un feature flag por tenant
- Tests que pasan para ambos adapters

---

## R3 — MIGRAR CLIENTES UNO POR UNO

### ¿Qué es?

Mover cada tenant (cliente) del adapter viejo al nuevo, **uno a la vez**, sin apagar nada.

### ¿Cómo se hace?

#### Paso 3.1: Elegir el primer tenant de prueba

generalmente es el tuyo propio (el de desarrollo) o un cliente de confianza.

```
Tenant: "Mi Empresa" (IdCompany = 1)
Feature flag: UseNewContactos = false (todavía usa el viejo)
```

#### Paso 3.2: Activar el flag para ese tenant

```
Tenant: "Mi Empresa" (IdCompany = 1)
Feature flag: UseNewContactos = true (ahora usa el nuevo)
```

#### Paso 3.3: Observar

- ¿El frontend funciona igual?
- ¿Los endpoints devuelven lo mismo?
- ¿Hay errores en los logs?
- ¿El usuario se queja de algo?

**Si todo está bien → siguiente tenant.**
**Si algo falla → desactivar el flag y arreglar.**

#### Paso 3.4: Repetir

```
Semana 1: Activar para tenant de desarrollo
Semana 2: Activar para 2-3 clientes de prueba
Semana 3: Activar para todos los clientes pequeños
Semana 4: Activar para clientes grandes
```

### ¿Por qué uno por uno?

- Si el nuevo tiene un bug, solo afecta a 1 cliente
- Puedes hacer rollback instantáneo (apagar el flag)
- Si algo sale mal, el daño es controlado

### Output de R3

Al terminar R3 tienes:
- Todos los tenants usando el FeatureAdapter
- El LegacyAdapter ya no se usa por nadie
- Confirmación de que el nuevo funciona en producción

---

## R4 — MARCAR VIEJO COMO OBSOLETO

### ¿Qué es?

Ponerle un aviso al código viejo de que ya no se debe usar. Cuando alguien compile, verá un warning.

### ¿Cómo se hace?

El compilador de C# tiene un atributo `[Obsolete]` que genera un warning cuando el código se usa.

### ¿Qué pasa cuando marcas algo como [Obsolete]?

1. **Si alguien usa el servicio viejo** → el compilador muestra un warning
2. **El sistema sigue funcionando** — no es un error, es un aviso
3. **El equipo ve el warning** y sabe que debe usar el nuevo

### Output de R4

Al terminar R4 tienes:
- El código viejo marcado con `[Obsolete]`
- Warnings en el compilador que indican "este código debe cambiarse"
- El sistema funcionando con el código nuevo

---

## R5 — DESMONTAR EL VIEJO

### ¿Qué es?

Eliminar el código viejo del proyecto. Solo se hace cuando **nadie lo usa**.

### ¿Cuándo puedes desmontar?

```
[ ] Todos los tenants tienen el flag activado
[ ] Han pasado al menos 2 semanas sin problemas
[ ] No hay llamadas al LegacyAdapter en los logs
[ ] El compilador no muestra warnings de uso del viejo
[ ] El equipo confirma que nadie necesita el viejo
```

### ¿Qué se elimina?

```
Kaptas.Services/Implementations/
  ContactService.cs              ← ELIMINAR (o mover a carpeta Legacy/)

Kaptas.API/Controllers/
  ContactController.cs viejo     ← ELIMINAR (el nuevo ya tiene su controller)

Features/Contactos/
  ContactoLegacyAdapter.cs       ← ELIMINAR (ya no se usa)
```

### ¿Qué NO se elimina?

```
[ ] Los tests de R1 (son la documentación de qué hacía el viejo)
[ ] Los SPs de la BD (otros módulos pueden usarlos)
[ ] Los DTOs viejos (otros módulos pueden referenciarlos)
```

### Output de R5

Al terminar R5 tienes:
- El módulo viejo eliminado
- Solo queda el Features/Contactos/
- El sistema es más limpio y fácil de mantener

---

## RESUMEN DEL PROCESO

```
FASE 0: Preparar el sistema (ICurrentUserProvider, tests, _Shared)
   │
   ▼
R1: Probar el viejo tal como está (tests de caracterización)
   │
   ▼
R2: Crear el nuevo al lado del viejo (seam + adapters)
   │
   ▼
R3: Migrar clientes uno por uno (feature flags)
   │
   ▼
R4: Marcar el viejo como obsoleto (warnings)
   │
   ▼
R5: Eliminar el viejo (cuando 0 tráfico)
```

### Tiempo estimado por módulo

| Complejidad | R1 | R2 | R3 | R4 | R5 | Total |
|-------------|----|----|----|----|-----|-------|
| Simple (1-3 endpoints) | 2 días | 3 días | 1 semana | 1 día | 1 día | 2 semanas |
| Mediano (4-8 endpoints) | 3 días | 5 días | 2 semanas | 1 día | 1 día | 3-4 semanas |
| Complejo (9+ endpoints) | 5 días | 1 semana | 2-3 semanas | 2 días | 2 días | 5-7 semanas |

---

## ERRORES COMUNES

### Error 1: Saltarse R1
**Qué pasa:** Creas el nuevo sin probar el viejo. El nuevo hace algo diferente. Los usuarios se quejan.
**Solución:** Siempre hacer R1 primero. Sin tests no hay refactor seguro.

### Error 2: Arreglar bugs en R2
**Qué pasa:** Mientras creas el nuevo, "arreglas" cosas del viejo. Ahora no sabes si el test passa por el fix o por el cambio.
**Solución:** R2 es solo crear el seam. Los bugs se arreglan en PARCHE o en el FeatureAdapter.

### Error 3: Migrar todos los tenants de golpe (R3)
**Qué pasa:** Activas el flag para todos. Si hay un bug, todos los clientes se afectan.
**Solución:** Siempre uno por uno. Primero tú, luego clientes de prueba, luego el resto.

### Error 4: No marcar [Obsolete] (R4)
**Qué pasa:** El equipo no sabe que el viejo debe cambiarse. Sigue usando el código viejo.
**Solución:** Siempre marcar [Obsolete] antes de desmontar.

### Error 5: Desmontar muy rápido (R5)
**Qué pasa:** Eliminas el viejo antes de que todos migren. Algunos clientes se quedan sin servicio.
**Solución:** Esperar 2 semanas con 0 tráfico antes de eliminar.

---

## ¿CÓMO SABES QUE TERMINASTE?

### Checklist final

```
[ ] El módulo viejo ya no existe en el proyecto
[ ] Solo existe Features/[Modulo]/
[ ] Todos los tests pasan
[ ] El compilador no muestra warnings
[ ] Ningún otro módulo importa del viejo
[ ] El REGISTRO-MODULOS.md dice "LIMPIO"
[ ] Los commits dicen "refactor:" o "feat:"
[ ] No hay código comentado
[ ] No hay DateTime.Now (solo DateTime.UtcNow)
[ ] No hay IBaseService (solo ICurrentUserProvider)
```

### Las 4 zonas del módulo

```
ANTES:  LEGADO (Kaptas.Services/ + Controllers/)
        → El módulo vive aquí

DURANTE: PUENTE (Features/[Modulo]/ + viejo vivo)
         → Los dos existen en paralelo

DESPUÉS: LIMPIO (Features/[Modulo]/)
         → Solo vive aquí
```

---

## CÓMO APLICAR ESTO A CUALQUIER MÓDULO

| Módulo | Endpoints | Dependencias | Prioridad |
|--------|-----------|-------------|-----------|
| Auth | 5-10 | BaseService (mucho) | Alta — es la puerta de entrada |
| Contactos | 16 | BaseService (poco) | Media — muchos lo leen |
| Caja Chica | 2-3 | BaseService (solo GetCurrentSpaceWork) | Baja — simple, buen piloto |
| Ventas | 10+ | BaseService, Contactos, Productos | Alta — core del negocio |
| Productos | 5-8 | BaseService | Media — depende de Contactos |
| Reportes | 1-2 | Ninguno | Baja — nuevo, ciclo VERDE |

### Regla para elegir por dónde empezar

1. **Empezar por el más simple** (Caja Chica) para practicar el proceso
2. **Después el más crítico** (Auth) cuando tengas experiencia
3. **Los que tienen bugs** suben de prioridad automáticamente
