# Tarea 4.1 — `ProfileProgressBar.vue`

**Fase**: F4 — Reemplazar el widget del dashboard
**Depende de**: F2 completa (necesita el endpoint con el shape nuevo), 0.5 (D5 cerrada — si se permite descarte o no)
**Bloquea**: 4.2

## Qué hacer

Crear `frontend/src/components/features/dashboard/ProfileProgressBar.vue`:
franja de una línea, consume `doneCount`/`totalCount`/`completed` de
`GET /api/onboarding/status`, texto "Configuración: {pct}% completa" (o
"Empezá por acá" en 0%), barra fina, botón "Completar" que navega a
`/panel/configuracion-inicial`.

## Criterio de aceptación

Componente aislado con test propio — 3 estados (0%, parcial, 100%) renderizan
lo esperado; en 100% el componente no renderiza nada (`v-if` apagado, sin
resabio visual).

## Referencias

- `../04-ux-widget-dashboard.md`
