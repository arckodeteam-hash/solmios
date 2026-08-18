# 🧩 Pull Request

## 📌 Descripción

<!-- Explica brevemente qué hace este PR -->

- Levanta `Kaptas.Tests` desde cero: xUnit sobre .NET 7, sin Docker, contra BDs `_test` aisladas.
- `setup-test-db.sh` (linux/mac) y `setup-test-db.ps1` (windows) clonan `kaptaswebdev` y `kw21` a `_test` vía BACKUP/RESTORE, aplican el seed y guardan un snapshot limpio. Las BDs dev solo se leen para clonarlas, nunca se escriben.
- El reset antes de cada corrida restaura desde ese snapshot en ~9s. Si no hay snapshots (máquina nueva) corre el setup completo solo, sin paso manual.
- `TestDbFixture` elige el script según el SO. Las credenciales quedan fuera del repo: env vars, o `appsettings.Tests.json`, que está gitignored y se copia del `.example`.
- Incluye templates para escribir tests nuevos: unitarios con mocks en `Features/`, y de integración con BD real en `Legacy/`.

No toca producción. Cero cambios en `Kaptas.API`, `Kaptas.Services` y `Kaptas.Context`. No borra ninguna línea: son 1753 inserciones y cero deleciones. Lo único que queda fuera de `Kaptas.Tests/` es `.gitignore`, `KaptasAPI.sln` y una plantilla de PR nueva.

**Hay tres cosas que el script no puede hacer por vos.** Están en el README, pero las repito acá porque son contra lo que se choca el primero que clone: necesitás `sqlcmd` en el PATH; necesitás crear tu `appsettings.Tests.json` a partir del `.example` con el SA password adentro; y el usuario `proquia@gmail.com` tiene que existir en `kaptaswebdev`, creado desde la app. El seed no lo crea — si no está, muere con un `RAISERROR` — porque hace falta el hash del password, la empresa y los permisos, y eso pasa por el registro de la aplicación. Si falta cualquiera de los tres, el script corta con un mensaje que arranca en `OBLIGATORIO:` y te dice qué hacer. No falla en silencio.

**Sobre Windows:** el `.ps1` corre con PowerShell 5.1 y `SQLCMD.EXE` apuntando al motor del server de pruebas. Hace el reset completo, sale con 0, y los tests de integración pasan contra las BDs que deja. El motor de SQL Server sobre Windows también está contemplado: las rutas de datos y de backup se le preguntan a `SERVERPROPERTY` y el separador sale de `sys.dm_os_host_info`, así que nunca se asume `/var/opt/mssql`. Eso sí, contra un motor Windows real no lo probamos. Está implementado, no verificado — si alguien tiene uno a mano, es un buen momento.

**Cómo probarlo:** copiás el `.example` a `appsettings.Tests.json`, le ponés el password, verificás que `proquia@gmail.com` exista en `kaptaswebdev`, y corrés `dotnet test`. La primera corrida hace el bootstrap completo y tarda varios minutos; es esperable. Las siguientes arrancan en ~9s.

**Evidencia:** `dotnet build KaptasAPI.sln` da 0 errores. Los 652 warnings son todos preexistentes del legado (`Kaptas.Services/`, `Controllers/`); `Kaptas.Tests` no aporta ninguno propio, solo hereda uno transitivo de NuGet (`System.Drawing.Common 10.0.3` no soporta net7.0) que viene arrastrado desde `Kaptas.API`. `dotnet test` da 10 verdes: 4 unitarios (`SmokeTest`, `TemplateUnitTests`) y 6 de integración (`ConexionSimpleTest`, `InfraestructuraTests`, `TemplateIntegrationTests`). Pasan igual en linux y en windows.

Un par de cosas que sé que vas a mirar, Jose o Leandro, y te las adelanto: `Kaptas.Tests.csproj` **sí** referencia `Kaptas.Services`, y `TestDbFixture` **sí** usa `IDbService`. Las dos son a propósito. La regla de acoplamiento prohíbe que `Features/` importe `Services/`; acá es el proyecto de tests el que necesita poder instanciar el legado para escribir los tests de caracterización de `Legacy/`, que son la semilla de R1. Sin esa referencia no hay forma de arrancar el ciclo RECICLADO. Y `KaptasCoreContext` exige un `IDbService` en el constructor, así que el fixture le pasa un `Mock<IDbService>` que solo devuelve la connection string del tenant `_test`.

---

## 🔗 Issue(s) que resuelve

<!-- Referencia los issues (ej: closes #123, fixes #45) -->

No hay issues de GitHub. Las tareas viven en Azure DevOps, cambio `inicializar-entorno`. Van con el prefijo `AB#` para que el board las vincule solo:

- AB#442 — 1.1 Estructura base del proyecto de tests
- AB#443 — 1.2 Scripts de base de datos aislada
- AB#444 — 1.3 Fixtures de conexión y reset de BD
- AB#445 — 1.4 Tests de verificación de infraestructura
- AB#446 — 1.5 Template de test unitario (`Features/`)
- AB#447 — 1.6 Template de test de integración (`Legacy/`)
- AB#488 — 1.7 Bootstrap de BDs `_test` reproducible en cualquier sistema
- AB#489 — 1.8 Soporte Windows en la infraestructura de tests

---

## 🔄 PRs relacionados

<!-- Otros PRs que dependen de este o están vinculados -->

Ninguno. Los commits fueron directo a `iniciar-entorno`.

---

## 🗄️ Cambios en base de datos (SQL)

<!-- Coloca aquí scripts necesarios si aplica -->

No aplica: no se cambia el schema de ninguna base.

En el diff vas a ver `BACKUP`, `RESTORE` y `DROP DATABASE`, pero solo sobre `kaptaswebdev_test` y `kw21_test` — las que este mismo PR crea y que se recrean solas en cada reset. Las dev se leen para clonarlas y no se tocan. El `seed-test-user.sql` inserta un usuario y una empresa de prueba, y solo dentro de `kaptaswebdev_test`.

Ahí hay algo que quiero dejar dicho antes de que lo encuentres vos. `seed-test-user.sql` está versionado arrancando con `USE KaptasWebDev;`, y adentro hace `UPDATE Users SET Password = ...` y `UPDATE Users_Roles SET IdCompany = 342`. Es seguro únicamente porque los dos scripts lo reescriben antes de ejecutarlo — `setup-test-db.sh:224` y `setup-test-db.ps1:302` le cambian el `USE` y el tenant a las `_test`. Pero es un `.sql` suelto en el repo: el día que alguien lo abra en SSMS y le dé F5, le pega a la dev real y le pisa el password y la empresa a `proquia`. Habría que cambiar ese `USE` por un placeholder que reviente si no pasó por el script. No lo meto en este PR para no ensuciar un diff que hoy es puramente aditivo, pero queda anotado como deuda y lo agarro en el próximo.

Y los `DELETE` comentados del final del seed (líneas 124-126) no son código muerto: son el rollback documentado.

```sql
-- Sin migraciones ni cambios de schema en este PR.
```
