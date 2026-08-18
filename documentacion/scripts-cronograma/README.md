# 📋 Cronograma Sheets → GitLab

## ¿Qué hace?

| Acción | Descripción |
|---|---|
| **Push** | Crea issues en GitLab desde el Sheets. Si ya tiene URL, actualiza. |
| **Pull** | Trae estados actualizados de GitLab al Sheets. |
| **Gantt** | Genera pestaña con barras semanales de estado. |
| **Resumen** | Genera pestaña con horas totales y avance por persona. |

## Setup (5 minutos)

### 1. Token en GitLab
- Settings → Access Tokens → `api` scope → copias `glpat-...`

### 2. Google Sheets
- https://sheets.new
- **Extensiones → Apps Script**
- Pegas `CronogramaSync.gs`
- Cambias las 3 constantes de arriba:
  ```js
  GITLAB_URL = "https://gitlab.com"  // tu instancia
  PROJECT_ID = "kaptas/kaptas-web-api"  // o ID numérico
  TOKEN      = "glpat-..."  // el token que copiaste
  ```
- Guardas, ejecutas `onOpen`, aceptas permisos

### 3. Usas
Aparece menú **📋 Cronograma** en la hoja.

## Estructura de columnas

| Col | Campo | Ejemplo | Como se usa |
|---|---|---|---|
| A | ID | M06-042 | Se genera solo si vacío |
| B | Módulo | Operaciones | Se convierte en label `Modulo::Operaciones` |
| C | Submódulo | Backend | Va en descripción |
| D | Tarea | Implementar CQRS Commands | Título del issue |
| E | Responsable | BE1 | Label `Responsable::BE1` |
| F | Horas | 16 | Va en descripción |
| G | Prioridad | Alta | Label `Prioridad::Alta` |
| H | Estado | Pendiente | Label `Estado::Pendiente` |
| I | Sprint | Sprint 3 | Label `Sprint::Sprint 3` |
| J | URL | https://gitlab.com/... | Se llena auto al hacer Push |

## Ciclo de trabajo diario

```
Lunes mañana:
  1. Abres el Sheets
  2. Asignas tareas de la semana (col E)
  3. Push a GitLab → se crean los issues

Todos los días:
  4. Los devs trabajan en GitLab (mueven issues)

Viernes:
  5. Pull desde GitLab → trae estados actualizados
  6. Resumen equipo → ves avance real
  7. Ajustas el plan para la siguiente semana
```

## Archivos

```
scripts-cronograma/
├── README.md          ← esto
├── CronogramaSync.gs  ← el script para Google Apps Script
└── Cronograma_GoogleSheets.md ← instrucciones detalladas
```
