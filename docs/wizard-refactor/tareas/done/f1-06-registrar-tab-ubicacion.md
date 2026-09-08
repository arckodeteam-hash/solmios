# Tarea 1.6 — Registrar la pestaña Ubicación en el menú

> **Parcialmente hecho (2026-09-07)**: el core (entrada en `pagina-publica-tabs.ts` +
> wiring en `pagina-publica/index.vue`) ya se hizo como parte de las tareas 1.3-1.5
> del paquete-01 — hacía falta para poder verificar `ubicacion.vue` en el navegador.
> Verificado con `rg "tab=location"` que no hay ningún link legacy externo apuntando
> a `settings/index.vue?tab=location` (el único resultado es el link "Cambiar" que
> `ubicacion.vue` agrega a propósito, apuntando a Configuración mientras `country`
> siga viviendo ahí — ver doc 03). **Falta solo**: confirmar el criterio de
> aceptación de abajo con una revisión final cuando se cierre el resto de F1.

**Fase**: F1 — Mover Ubicación a Página pública
**Depende de**: 1.3 (la ruta ya tiene que existir)
**Bloquea**: nada, pero conviene antes de 1.8 (para no dejar el campo huérfano sin acceso)

## Qué hacer

Agregar la entrada `ubicacion` a `frontend/src/config/pagina-publica-tabs.ts`:

```ts
{ value: 'ubicacion', label: 'Ubicación', path: '/panel/pagina-publica/ubicacion', roles: ['hotel_admin'], group: 'Contenido' },
```

Revisar si hace falta un redirect legacy desde `settings/index.vue?tab=location`
— buscar referencias a esa URL:

```
rg "tab=location|settings.*location" frontend/src
```

en `OnboardingGuide.vue`, emails transaccionales, notificaciones, o cualquier
otro lugar que pudiera tener ese link guardado.

## Criterio de aceptación

La pestaña "Ubicación" aparece en el menú de Página pública, grupo
"Contenido", al lado de "General". Cualquier link viejo encontrado en el
`rg` de arriba redirige a la ruta nueva (o se confirma que no hacía falta
ninguno).

## Referencias

- `frontend/src/config/pagina-publica-tabs.ts`
- `../03-arquitectura-informacion.md`
