# Plan de Tests — Kaptas

**Basado en:** `estrategia-hibrida.html` (estructura + 3 ciclos)
**Modulo piloto:** Auth (el que mas bugs tenia — 7 encontrados hoy)
**Enfoque:** integration tests contra el SQL Server real (no mocks)
**Skills a usar:** `kaptas-clean-arch` (creación: ciclos, SOLID, plantillas de test, fixtures BD `_test`) · `test-coverage` (trackeo de coverage una vez existan los tests)

> Infraestructura OBLIGATORIA (ver `kaptas-clean-arch` › Testing): correr contra BDs `_test` (`kaptaswebdev_test` / `kw21_test`) con seed propio, **no** contra `kaptaswebdev` ni con usuarios reales.

---

## Por que Auth primero

Auth es la **puerta de entrada**. Si Auth falla, todo falla. Y hoy encontramos **7 bugs** en un solo modulo:

| Bug que arreglamos hoy | Que hubiera pasado con test |
|------------------------|----------------------------|
| Email case-sensitive (`PROQUIA@...` fallaba) | Test lo detecta antes de produccion |
| BD del tenant equivocada (`kw58` vs `kw21`) | Test verifica resolucion de tenant |
| `Users_Roles.IdCompany` apuntaba a empresa ajena | Test verifica companies del usuario |
| `Permissions` con 4 entradas en vez de 69 | Test verifica roles completos |
| `usp_generar_menu` con `IsTitle=1` (menu muerto) | Test verifica estructura del menu |
| `usp_generar_menu` ordenado por `id` no por `orden` | Test verifica orden |
| `ResponseVM` traga error real con mensaje generico | Test verifica mensaje real |

**7 bugs = 7 tests que faltan.** Cada uno es una red de seguridad.

---

## Los 3 tipos de test (segun los 3 ciclos del HTML)

```
  ♻️ CHAR. TESTS              ✨ TESTS DE MODULO NUEVO        🐛 TESTS DE REGRESSION
  (Ciclo RECICLADO)           (Ciclo VERDE)                   (Ciclo PARCHE)
  ──────────────────          ────────────────────            ──────────────────────
  Probar lo que HOY hace      Probar lo nuevo que creas       Probar que el bug no
  Sin saber si esta bien      TDD: test primero,              vuelve a pasar
  o mal — solo anotar         despues codigo
  ──────────────────          ────────────────────            ──────────────────────
  Para Auth: SI, ya           Para Auth: despues de           Para Auth: los 7 bugs
  sabemos los bugs, asi que   migrar a Features/              de hoy son 7 regression
  son char. tests + regression                                 tests
```

**Para Auth ahora mismo:** char. tests + regression tests (los 7 bugs de hoy).

---

## Estructura del proyecto de tests

```
Kaptas.Tests/                         ← NUEVO proyecto
├── Kaptas.Tests.csproj               ← .NET 7 + xUnit
├── Fixtures/
│   ├── TestDatabase.cs               ← connection al kaptas-sql local
│   ├── AuthTestSeed.cs               ← crea usuario de prueba, tenant, permisos
│   └── HttpContextMock.cs            ← simula headers company/branch/store
├── Auth/
│   ├── LoginTests.cs                 ← BLOQUE 1 (10 tests)
│   ├── RefreshTokenTests.cs          ← BLOQUE 2 (5 tests)
│   ├── MenuTests.cs                  ← BLOQUE 3 (4 tests)
│   └── PermissionTests.cs            ← BLOQUE 4 (4 tests)
└── Tenant/
    └── DbServiceTests.cs             ← BLOQUE 5 (3 tests)
```

---

## BLOQUE 1 — Login (10 tests)

Los tests mas importantes. Login es donde encontramos mas bugs.

```
TEST 1: Login_ConCredencialesValidas_DevuelveToken
        proquia@gmail.com / proquia → success=true + access_token no vacio

TEST 2: Login_ConEmailEnMayusculas_DevuelveToken          ← BUG DE HOY
        PROQUIA@GMAIL.COM / proquia → success=true
        (antes fallaba porque comparaba case-sensitive)

TEST 3: Login_ConEmailConEspacios_DevuelveToken           ← BUG DE HOY
        "  proquia@gmail.com  " / proquia → success=true
        (el .Trim() que agregamos)

TEST 4: Login_ConPasswordIncorrecta_DevuelveCredencialesInvalidas
        proquia@gmail.com / clave-equivocada → success=false + "Credenciales invalidas"

TEST 5: Login_ConEmailInexistente_DevuelveCredencialesInvalidas
        noexiste@gmail.com / loquesea → success=false

TEST 6: Login_ConUsuarioEliminado_DevuelveError
        usuario con IsDeleted=true → success=false

TEST 7: Login_ConCuentaNoVerificada_DevuelvePendiente
        usuario sin EmailConfirmedDate → mensaje de verificacion

TEST 8: Login_DevuelveCompanies_DelTenantCorrecto        ← BUG DE HOY
        proquia@gmail.com → companys NO es null
        (antes devolvia null porque Users_Roles.IdCompany=389 en vez de 342)

TEST 9: Login_ConPasswordVerificadoPorBCrypt
        verificar que el hash BCrypt coincide con "proquia"
        (antes el hash no coincidia con ningun password)

TEST 10: Login_GeneraRefreshToken_Valido
         success=true → refresh_Token no es null ni vacio
         (el refresh token se guarda en la BD para el siguiente paso)
```

## BLOQUE 2 — RefreshToken (5 tests)

Despues del login, el frontend llama RefreshToken para obtener el token final con menu y roles.

```
TEST 11: RefreshToken_ConTokenValido_DevuelveNuevoTokenConMenu
         login → refresh → success=true + menu no vacio + userId > 0

TEST 12: RefreshToken_ConTokenUsado_LanzaExcepcion
         refresh token ya usado → "Invalid refresh token, try login"

TEST 13: RefreshToken_ConTokenRevocado_LanzaExcepcion
         refresh token revocado → "Invalid refresh token, try login"

TEST 14: RefreshToken_SinHeaderCompany_LanzaExcepcion    ← BUG DE HOY
         sin header company → int.Parse(null) → excepcion
         (antes explotaba con "Value cannot be null (Parameter 's')")

TEST 15: RefreshToken_DevuelveRoles_Completos             ← BUG DE HOY
         refresh → el JWT incluye SYSTEMALL, FACTURACION, ENTRADAS...
         (antes el JWT solo tenia 4 permisos porque Permissions tenia 4 entradas)
```

## BLOQUE 3 — Menu (4 tests)

El menu se genera con el SP `usp_generar_menu`. Lo rompimos y arreglamos 2 veces hoy.

```
TEST 16: Menu_DevuelveItems_NoVacio                       ← BUG DE HOY
         usp_generar_menu(proquia, 342) → devuelve 16 items
         (antes devolvia vacio porque Users_Roles.IdCompany=389)

TEST 17: Menu_TodosLosItems_TienenIsTitleFalso            ← BUG DE HOY
         todos los items tienen IsTitle = 0
         (antes tenian IsTitle = 1 → el menu no era clickeable)

TEST 18: Menu_DevuelveItems_OrdenadosPorColumnaOrden      ← BUG DE HOY
         Dashboard(orden=2) aparece antes que General(orden=251)
         (antes ordenaba por id → General aparecia primero)

TEST 19: Menu_SubItems_TienenRuta_NoVacia
         todos los subitems tienen Link con valor
         (los que tienen Link vacio se filtran en el frontend)
```

## BLOQUE 4 — Permisos (4 tests)

Los permisos se generan con `usp_buscar_permiso_usuario` y alimentan los claims del JWT.

```
TEST 20: Permisos_DevuelveSistema_ALL                     ← BUG DE HOY
         usp_buscar_permiso_usuario(proquia, 342) → incluye "SYSTEMALL"
         (antes no lo incluia porque Permissions tenia 4 entradas)

TEST 21: Permisos_DevuelveFACTURACION                     ← BUG DE HOY
         incluye "FACTURACION" (necesario para Caja Chica y Ventas)

TEST 22: Permisos_DevuelveCantidad_MinimaEsperada
         devuelve al menos 60 permisos
         (antes devolvia solo 4)

TEST 23: Permisos_EndpointPaymentDocuments_Responde200    ← BUG DE HOY
         GET /api/Operations/PaymentDocuments con token → 200 OK
         (antes devolvia 403 Forbidden)
```

## BLOQUE 5 — DbService / Tenant (3 tests)

El resolver de tenant decide a que BD conectarse. Es lo mas critico del multi-tenant.

```
TEST 24: DbService_DevuelveBD_CorrectaDelTenant           ← BUG DE HOY
         usuario proquia → connection string apunta a kw21
         (antes apuntaba a kw58 = BD de otro cliente)

TEST 25: DbService_CachaConexion_8horas
         segunda llamada → devuelve del cache (no consulta la BD otra vez)

TEST 26: DbService_ConUsuarioInvalido_LanzaExcepcion
         usuario inexistente → "Unable to determine user ID"
```

---

## Como empezamos (paso a paso)

```
PASO 1: Crear proyecto Kaptas.Tests
        ─────────────────────────
        dotnet new xunit -n Kaptas.Tests
        cd Kaptas.Tests
        dotnet add reference ../Kaptas.Services/Kaptas.Services.csproj
        dotnet add reference ../Kaptas.Context/Kaptas.Context.csproj
        dotnet add package Moq
        dotnet add package Microsoft.AspNetCore.Http
        
        Agregar Kaptas.Tests al .sln

PASO 2: Crear Fixtures (preparacion de datos)
        ─────────────────────────────────────
        TestDatabase.cs → connection string a kaptas-sql (localhost,1433)
        AuthTestSeed.cs → asegura que proquia@gmail.com existe con:
                          - password "proquia" (BCrypt)
                          - IdSubscription correcta apuntando a kw21
                          - Users_Roles con IdCompany=342
                          - Permissions completos (69)
        HttpContextMock.cs → simula headers company=1, branch=1, store=1

PASO 3: Escribir BLOQUE 1 (Login) — los 10 tests
        ────────────────────────────────────────
        Cada test:
        1. Prepara el estado (seed)
        2. Llama AuthService.Login(email, password)
        3. Verifica el resultado (assert)
        4. Limpia (si modifico algo)

PASO 4: Correr los 10 tests
        ────────────────────
        dotnet test --filter "LoginTests"
        
        Resultado esperado: 10 verdes
        Si alguno falla → encontramos OTRO bug que no sabiamos

PASO 5: Continuar con BLOQUES 2-5
        ──────────────────────────
        Un bloque por dia. Total: ~5 dias para los 26 tests.
```

---

## Que NO testear por ahora

```
✗ SendGrid (envio de emails)           → mockear o saltar
✗ Hangfire (jobs en background)        → fuera de scope
✗ SignalR (hubs)                       → fuera de scope
✗ OTP (twilio/sms)                     → mockear
✗ CreateUser (registro de empresas)    → despues, es mas complejo
✗ ForgotPassword / ResetPassword       → despues, depende de email
```

**Foco:** Login + RefreshToken + Menu + Permisos + Tenant. Es lo que rompimos hoy. Es lo que mas duele si falla.

---

## Como correr los tests

```bash
# Todos
dotnet test

# Solo Login
dotnet test --filter "FullyQualifiedName~LoginTests"

# Solo Menu
dotnet test --filter "FullyQualifiedName~MenuTests"

# Un test especifico
dotnet test --filter "Login_ConEmailEnMayusculas_DevuelveToken"
```

---

## Regla: cada bug nuevo = un test nuevo

Cada vez que encontremos un bug (ciclo PARCHE), antes de arreglarlo:

1. Escribir el test que lo reproduce (rojo)
2. Arreglar el bug
3. El test pasa (verde)
4. Ese test queda para siempre

Asi, los bugs **nunca vuelven**.
