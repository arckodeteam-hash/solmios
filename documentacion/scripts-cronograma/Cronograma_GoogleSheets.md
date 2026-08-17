# Google Sheets → GitLab Sync

## 1. Crear la hoja

1. Ve a https://sheets.new
2. Copia esta estructura en la **primera fila** (A1:J1):

| ID | Módulo | Submódulo | Tarea | Responsable | Horas | Prioridad | Estado | Sprint | GitLab Issue URL |
|---|---|---|---|---|---|---|---|---|---|

3. En la **segunda fila** (A2:J2) pega datos de ejemplo:

```
M05 | Productos | Backend | Implementar ProductController v2 | BE1 | 16 | Alta | Pendiente | Sprint 2 |
```

## 2. Abrir Apps Script

1. En el menú: **Extensiones → Apps Script**
2. Borra todo y pega el código de abajo
3. Reemplaza las constantes `GITLAB_URL`, `PROJECT_ID`, `TOKEN`
4. Guarda (💾) y da nombre "Cronograma Sync"
5. Primera ejecución: **Ejecutar → onOpen** y acepta permisos

## 3. Usar

Aparecerá un menú nuevo **📋 Cronograma** en la hoja con:

| Opción | Qué hace |
|---|---|
| **Push a GitLab** | Crea/actualiza issues en GitLab desde el Sheets |
| **Pull desde GitLab** | Trae estado actualizado desde GitLab al Sheets |
| **Limpiar todo** | Borra todas las filas (menos encabezado) |
| **Generar Gantt** | Crea pestaña "Gantt" con barras de semanas |
| **Resumen equipo** | Crea pestaña "Equipo" con carga por persona |
| **Ayuda** | Muestra este instructivo |

## 4. Reglas

- **Columna A (ID)**: Si está vacía, se asigna `MXX-XXX` auto
- **Columna J (URL)**: Si tiene URL, el push hace **UPDATE**; si no, hace **CREATE**
- **Columna H (Estado)**: `Pendiente`, `En Progreso`, `En QA`, `Completado`, `Bloqueado`
- **Responsable**: Usa los username de GitLab (ej: `BE1`, `ARQ`, etc.)
- Una fila vacía en A-F → se salta (no se sincroniza)

## 5. Script completo

```
