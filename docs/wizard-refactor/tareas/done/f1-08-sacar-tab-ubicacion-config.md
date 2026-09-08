# Tarea 1.8 — Sacar la pestaña Ubicación de Configuración

**Fase**: F1 — Mover Ubicación a Página pública
**Depende de**: 1.4, 1.5, 1.6 (Ubicación ya tiene que funcionar del todo en Página pública), 1.7 (identidad pública ya movida)
**Bloquea**: 1.9, 1.10

## Qué hacer

Sacar la pestaña `location` completa de `frontend/src/pages/settings/index.vue`:

- Quitar el bloque `v-if="activeTab === 'location'"` del template.
- Quitar la entrada `location` de `tabGroups`.
- Quitar los campos de ubicación de `HOTEL_RULES` y `FIELD_TAB`.
- Quitar el código de mapa que ya no se usa ahí (ahora vive en el composable
  de la tarea 1.1 — `settings/index.vue` no necesita seguir importándolo si no
  le queda ningún campo de ubicación).

## Criterio de aceptación

`settings/index.vue` compila sin referencias muertas (`mapEl`, `mapsPaste`,
etc. si ya no se usan ahí). El tab "Ubicación" ya no aparece en Configuración.
`saveAll()` sigue guardando Hotel + Condiciones sin error (con `HOTEL_RULES`
reducido, ya no valida campos de ubicación).

## Referencias

- `../07-plan-fases-implementacion.md` Fase 1
- `../01-auditoria-estado-actual.md` sección 3.1
