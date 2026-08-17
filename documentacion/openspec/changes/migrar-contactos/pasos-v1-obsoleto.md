> # ⛔ OBSOLETO — NO SEGUIR ESTE PLAN
>
> **Reemplazado el 2026-07-19 por `pasos.md` (v2).** Se conserva solo como registro histórico.
>
> **Por qué se reemplazó:** la radiografía del legado estaba mal medida y la premisa central
> del plan era falsa. Errores de medición confirmados por comando:
>
> | Dato | v1 decía | Real (medido) | Comando |
> |---|---|---|---|
> | Stored procedures | 1 | **14** | `grep -c "P_Contactos\|p_Contactos" Kaptas.Services/Implementations/ContactService.cs` |
> | Endpoints | ~15 | **21** | `grep -c "\[Http" Kaptas.API/Controllers/ContactController.cs` |
> | Métodos de interfaz | 22 | **19** | `grep -c "Task\|List<\|bool \|int " Kaptas.Services/Interfaces/IContactService.cs` |
> | DbContexts en uso | 1 | **3** | ver `pasos.md` §1 |
>
> La frase *"casi no hay SPs que replicar"* (línea 17) es falsa: hay 14, uno de ellos
> (`P_Contactos_Insert_Update_Grabar`) usa 4 TVPs y escribe 5 tablas.
>
> Además contenía dos reglas dañinas: (a) el paso 12 exigía equivalencia byte-a-byte sin
> excepciones, lo que habría certificado en verde 4 IDOR vivos del legado; (b) la línea 78
> ("nada nuevo entra a share salvo que lo usen ≥2 módulos") aplica conteo de consumidores
> donde corresponde propiedad de dominio — ese criterio ya costó un revert en este repo
> (`9aad5182` → `a3aca1ef`).

# Migrar Contactos a Features/ — pasos a seguir

Ciclo: **RECICLADO** (el módulo ya existe en LEGADO). Modelo: **módulo o share** (guía única,
`docs/GUIA-DESARROLLO-Y-QA.md` sección 3). Patrón de referencia: RepairShop v2 (ya validado).

## Radiografía del legado (medida, no supuesta)

| Qué | Valor |
|-----|-------|
| Controller | `Controllers/ContactController.cs` — ~15 endpoints |
| Service | `Kaptas.Services/Implementations/ContactService.cs` — 734 líneas, 22 métodos públicos |
| Acceso a datos | **Ya es EF casi todo** (usa los DbSet directo). Solo **1 SP**: `P_Contactos_Ubicacion_Insert_Upd_Grabar` |
| Dependencias legado | `IDbService`, `IBaseService`, `ISpExecute`, AutoMapper, `IDiccionarioService`, `IHttpClientFactory` (consulta RNC a DGII) |
| Entidades EF (ya existen) | `Contacto`, `ContactoNumero`, `ContactosRelacionado`, `ContactoPrecioPermitido`, `ContactosTipo`, `ContactoBitacora` |
| Endpoints que usa el frontend v2 | Create, Get, GetById, GetLookups, LoadData, types, Delete, UpdateSigaData, GetRncData, GetPreciosPermitidos |

**Ventaja vs Taller:** casi no hay SPs que replicar byte-a-byte. El grueso es reescribir el
service EF sucio (acoplado a BaseService/IDbService) como Feature limpio.

**Cruce con Taller:** el frontend del taller usa `Contact/GetLookups` (clientes y técnicos son
contactos). Cuando Contactos v2 esté validado, ese consumo se cambia de ruta. Nada de Taller
se toca en esta migración.

## Pasos

### FASE 0 — Análisis y tests de caracterización (R1) — NO se toca código productivo
1. Listar los 22 métodos del service y clasificar: cuáles usa el frontend (los 10 de arriba
   primero), cuáles usan otros módulos, cuáles están muertos (candidatos a NO migrar).
2. Escribir **tests de caracterización** del legado contra las BDs `_test`: lo que HOY hace,
   no lo que debería. Mínimo: Get (paginado + filtros), GetById, Create, Update, Delete,
   GetLookups, tipos. Son la red para comparar el v2.
3. Registrar en este tracking qué métodos quedan FUERA del alcance y por qué.

### FASE 1 — Estructura del módulo (aislado, según la guía)
4. Rama: `feature/contactos-v2` desde `pre-produccion`.
5. Crear `Features/Contacts/` con **su propio todo** (aislamiento):
   ```
   Features/Contacts/
   ├── DTOs/                  ← contratos PROPIOS (no reusar Kaptas.DTO: superficie legada congelada)
   ├── IContactsService.cs    ← interfaz primero
   ├── ContactsService.cs
   ├── Queries/  Commands/    ← si el tamaño lo pide (patrón RepairShop)
   ├── ContactsController.cs  ← ~30 líneas, ruta api/v2/Contacts
   └── ContactsServiceCollectionExtensions.cs  ← AddContacts(): el módulo registra LO SUYO
   ```
6. `Program.cs`: `AddSharedServices().AddRepairShop().AddContacts()`. Share NO se entera.
7. Dependencias permitidas: `KaptasCoreContext`, `ICurrentUserProvider`, `IDatabaseClock`,
   `IDictionaryResolver` (share, para tipos de contacto). **Prohibido**: `Kaptas.Services`,
   `IBaseService`, `IDbService`, `ISpExecute`, AutoMapper del legado.

### FASE 2 — Migrar por tandas (lecturas primero, escrituras después)
8. **Tanda 1 — lecturas** (bajo riesgo): Get paginado, GetById, GetLookups, LoadData, types.
   EF + `AsNoTracking()` + **filtro tenant en TODAS las queries**.
9. **Tanda 2 — escrituras**: Create, Update, Delete, relacionados, precios permitidos.
   Transacción por comando; `SaveChanges` una vez, nunca en loop.
10. **El único SP** (`P_Contactos_Ubicacion_Insert_Upd_Grabar`): replicarlo en EF dentro del
    módulo (es lógica propia de contactos, NO va a share — solo lo usa este módulo).
11. **Consulta RNC (DGII)**: helper propio del módulo con `IHttpClientFactory`. Si mañana otro
    módulo lo necesita, AHÍ se evalúa moverlo a share — no antes.

### FASE 3 — Validación (el juez)
12. Tests de equivalencia legacy-vs-v2 **byte a byte** por endpoint (patrón
    `RepairShopApiComparisonTests`): mismo request → mismo JSON. Las escrituras comparan
    el estado de las tablas después (patrón SpVsEf de Taller).
13. Suite completa verde + build 0 errores 0 warnings nuevos.

### FASE 4 — Convivencia y cierre (R3–R5)
14. El v2 sale por `api/v2/Contacts`; el legado sigue vivo en `api/Contact`. El frontend
    migra por feature flag / tenant (como Taller). Primero lecturas, después escrituras.
15. Actualizar el tracking del cambio (openspec) — nunca un .md dentro de `Features/`.
16. Con 0 tráfico confirmado en el viejo: `[Obsolete("Reemplazado por Features/Contacts")]`
    y desmontar (R4–R5). Recién ahí muere `ContactService`.

## Reglas que NO se negocian en esta migración
- El módulo trae **su propio DTO/enum** aunque el legado tenga uno igual (deuda transicional
  declarada, no acoplamiento).
- Dependencia siempre **módulo → share**, nunca al revés. Nada nuevo entra a share salvo que
  lo usen ≥2 módulos.
- Controller ~30 líneas; interfaz antes que implementación; 1 test mínimo por método migrado.
- El legado NO se toca (ni "de paso") hasta la FASE 4.
- Commits: `feat:`/`refactor:` cortos; PR a `qa`.

## Definición de Done
- [ ] Tests de caracterización del legado escritos ANTES de tocar nada
- [ ] `Features/Contacts/` completo y aislado (DTOs, registro y contratos propios)
- [ ] Equivalencia legacy-vs-v2 verde en los 10 endpoints que usa el frontend
- [ ] Cero imports de `Kaptas.Services` / `IBaseService` / `ISpExecute` en el módulo
- [ ] Build 0/0 + suite completa verde
- [ ] Tracking actualizado en openspec
