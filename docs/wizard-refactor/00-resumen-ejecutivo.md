# Refactor de configuración inicial del hotel — Resumen ejecutivo

> **Actualizado 2026-09-07** — el usuario revisó la primera versión y resolvió 3
> de las decisiones abiertas directamente: (1) no hace falta un campo nuevo de
> "teléfono del dueño", el pedido era sobre `phone`/`phone2` que ya existen —
> `phone` pasa a requerido; (2) la franja del dashboard es una sola, combinando
> todo el progreso, con un solo botón; (3) ese botón manda a una pantalla que
> reusa el mismo sistema de acordeón que ya tiene `OnboardingGuide.vue` hoy, no
> a un wizard modal lineal — los pasos operativos (habitaciones, tarifas,
> canales, equipo) son botones hacia sus pantallas reales, no pasos con
> formulario propio. Este resumen y el resto de los documentos ya reflejan esas
> decisiones (ver el detalle y el porqué en
> [08-decisiones-abiertas-y-riesgos.md](./08-decisiones-abiertas-y-riesgos.md)).

## El problema, en una frase

El hotel recién registrado aterriza en un dashboard con un aviso de configuración
demasiado presente, que manda a una pantalla de Configuración (`settings/index.vue`,
1936 líneas, 9 pestañas) diseñada para edición administrativa continua, no para un
alta guiada de primera vez — y esa pantalla tiene bugs reales de guardado y de mapa
que la hacen más frustrante todavía.

## Qué se decidió (alcance de este refactor)

1. **Separar dato público de dato operativo.** Todo lo que el huésped ve en el motor
   de reservas (ubicación con mapa, tipo de alojamiento, estrellas, políticas de
   cancelación/depósito) pasa a vivir en **Página pública**, que es la sección que ya
   existe para eso — no se inventa una sección nueva. Ver
   [02-clasificacion-de-campos.md](./02-clasificacion-de-campos.md) y
   [03-arquitectura-informacion.md](./03-arquitectura-informacion.md).
2. **La guía intrusiva del dashboard se reemplaza por una sola barra de progreso
   discreta** (nombre + porcentaje, nada de desglose ahí mismo) con un botón
   "Completar" al lado — no una tarjeta gigante que ocupa media pantalla. Ver
   [04-ux-widget-dashboard.md](./04-ux-widget-dashboard.md).
3. **Ese botón manda a un "Centro de configuración"**, pantalla propia que reusa
   el mismo sistema de acordeón que ya tiene la guía actual (pasos expandibles,
   check verde, "cómo se hace") — no un wizard modal lineal forzado. Ahí conviven
   los pasos de perfil (se completan inline, con animaciones y copy amigable,
   reciclando lo que el usuario ya cargó en el registro: nombre del hotel, país,
   teléfono, nombre del dueño) y los pasos operativos existentes (habitaciones,
   tarifas, canales, equipo), que siguen siendo botones hacia sus pantallas
   reales. Ver [05-ux-wizard-onboarding.md](./05-ux-wizard-onboarding.md).
4. **Se corrigen 3 bugs concretos** encontrados durante la auditoría (no reportados
   a ciegas — verificados leyendo el código) que hoy hacen que la configuración
   actual se sienta rota: el guardado de Hotel/Ubicación/Condiciones está acoplado
   en una sola validación global, el mapa no reacciona al cambio de país, y el pin
   depende de una API key de Google Maps que puede no estar configurada. Ver
   [01-auditoria-estado-actual.md](./01-auditoria-estado-actual.md).

## Qué NO cambia (fuera de alcance)

- Los pasos operativos existentes del onboarding — habitaciones, tarifas, canales,
  equipo — **siguen siendo pantallas propias** (Habitaciones, Tarifas, Canal Manager,
  Equipo). Dentro del Centro de configuración aparecen como botones que navegan
  a esas pantallas, confirmado explícitamente por el usuario ("sería lo mejor
  poner botones hacia esas pantallas") — no se convierten en formularios
  inline. Justificación en
  [08-decisiones-abiertas-y-riesgos.md](./08-decisiones-abiertas-y-riesgos.md).
- No se toca el módulo `mobile-app` (Flutter, repo aparte — regla de CLAUDE.md).
- **`settings/index.vue` (Configuración) NO se elimina — es permanente.**
  Confirmado explícitamente por el usuario (2026-09-07): viven ahí demasiadas
  cosas nativas de esa vista (Condiciones, Niños, Tipos de habitación,
  Emergencias, RRHH, Amenities, Integraciones, y la identidad administrativa
  del Hotel) para pensar siquiera en vaciarla. Lo único que sale de ahí son los
  campos puntuales que la auditoría confirmó como públicos (la pestaña
  Ubicación completa + `accommodationType`/`starRating`/`logo`/`website`, ver
  doc 02) — el resto de Configuración queda intacto, para siempre, como
  pantalla de edición administrativa. Ninguna fase de este plan (ni F1 ni F5)
  contempla seguir "vaciándola" más allá de esos campos ya identificados.



## Documentos de este plan

| # | Documento | Contenido |
|---|-----------|-----------|
| 00 | `00-resumen-ejecutivo.md` | Este archivo |
| 01 | `01-auditoria-estado-actual.md` | Qué hay hoy, con líneas de código, y los 3 bugs confirmados |
| 02 | `02-clasificacion-de-campos.md` | Matriz campo por campo: reciclado / público / operativo / opcional / requerido |
| 03 | `03-arquitectura-informacion.md` | Dónde vive cada cosa después del refactor (Configuración vs Página pública vs Wizard) |
| 04 | `04-ux-widget-dashboard.md` | Diseño de la barra de progreso discreta + botón |
| 05 | `05-ux-wizard-onboarding.md` | Diseño paso a paso del wizard, copy, animaciones, estados |
| 06 | `06-arquitectura-tecnica.md` | Endpoints, modelo de datos de progreso, componentes a crear/mover |
| 07 | `07-plan-fases-implementacion.md` | Fases, orden, criterios de aceptación por fase |
| 08 | `08-decisiones-abiertas-y-riesgos.md` | Puntos que necesitan una decisión del usuario antes de implementar |
| — | `tareas/tareas.md` | Índice de tareas chicas (1 sesión c/u), **cada tarea en su propio archivo** dentro de `tareas/`, con checkbox y criterio de aceptación — es el punto de entrada para ir tildando durante la implementación |

## Cómo leer esto si tenés poco tiempo

Leé este resumen, después `02-clasificacion-de-campos.md` (es el corazón del pedido:
qué se recicla, qué es público, qué es opcional, qué es obligatorio) y
`08-decisiones-abiertas-y-riesgos.md` (las preguntas que solo el usuario puede
responder). El resto es el detalle de diseño y ejecución para cuando se apruebe.
