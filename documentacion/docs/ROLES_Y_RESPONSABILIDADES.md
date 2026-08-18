# Definición de Roles y Responsabilidades - Kaptas ERP

## Resumen Ejecutivo

| Rol | Responsable | Nivel | Enfoque Principal |
|-----|-------------|-------|-------------------|
| Master Arquitecto | Tú | Estratégico | Visión global, estándares, dirección |
| DEV 01/02/03 | Desarrolladores | Táctico | Implementar, crear, corregir |
| QA-DEV | Joel | Técnico | Calidad técnica, seguridad, arquitectura |
| Pre-Implementación | Ricardo | Operativo | Deploy, configuración, migraciones |
| QA-UI | Equipo Kaptas | Funcional | Negocio, UX/UI, validación real |
| Implementación | José y Ricardo | Operativo | Producción, liberación, monitoreo |

---

## 1. Master Arquitecto del Software

### Definición Corta
**Define QUÉ se construye y CÓMO se construye a nivel estratégico.**

### Responsabilidades
- Define la arquitectura global del sistema
- Establece estándares técnicos y patrones de diseño
- Toma decisiones de tecnología y framework
- Prioriza tareas del backlog
- Asigna trabajo a desarrolladores
- Resuelve dudas de arquitectura
- Revisa decisiones de alto nivel

### Qué NO hace
- No escribe código diario
- No hace deploy
- No testea UI
- No revisa Pull Requests (eso es QA-DEV)

### Preguntas clave que responde
- ¿Esta arquitectura escala?
- ¿Esta tecnología es la correcta?
- ¿Cómo afecta este cambio al resto del sistema?
- ¿Es mejor construir o comprar?

---

## 2. Desarrollador (DEV 01/02/03)

### Definición Corta
**Implementa la funcionalidad según lo definido por el Arquitecto.**

### Responsabilidades
- Crea código que funcione
- Implementa endpoints, lógica de negocio, UI
- Corrige bugs asignados
- Escribe tests básicos
- Documenta código complejo
- Hace PR para revisión de QA-DEV

### Qué NO hace
- No define arquitectura
- No decide tecnología
- No hace deploy a producción
- No valida funcionalidad de negocio (eso es QA-UI)

### Flujo de trabajo
```
1. Recibe tarea del Arquitecto
2. Crea rama (feature/fix/refactor)
3. Implementa la funcionalidad
4. Hace push y crea PR
5. Espera revisión de QA-DEV
6. Corrige si es necesario
7. Merge cuando apruebe
```

### Comandos Git que usa
```bash
git checkout pre-produccion
git pull
git checkout -b feature/nombre-tarea
# ... trabaja ...
git add .
git commit -m "feat: descripción"
git push origin feature/nombre-tarea
# Crea PR → rama qa
```

---

## 3. QA-DEV (Joel)

### Definición Corta
**Valida que el CÓDIGO sea técnicamente correcto, seguro y escalable.**

### Responsabilidades Principales

#### Arquitectura
- ¿Rompe principios SOLID?
- ¿Siguen el patrón de diseño establecido?
- ¿Las dependencias están bien inyectadas?
- ¿La estructura de carpetas es correcta?

#### Code Quality
- ¿El código es legible y mantenible?
- ¿Hay código duplicado?
- ¿Los nombres son descriptivos?
- ¿Está bien documentado?

#### Seguridad
- ¿Hay inyección SQL?
- ¿Están sanitizadas las entradas?
- ¿Se exponen datos sensibles?
- ¿Las autenticaciones son seguras?

#### Performance
- ¿Hay queries N+1?
- ¿Hay memory leaks?
- ¿Las consultas son eficientes?
- ¿Hay índices en la BD?

#### Integración
- ¿Los endpoints son consistentes?
- ¿Los DTOs están bien definidos?
- ¿Los errores se manejan correctamente?
- ¿Hay logs suficientes?

### Checklist de Revisión

```markdown
## Checklist QA-DEV

### Arquitectura
- [ ] Respeta patrón de diseño establecido
- [ ] Dependencias inyectadas correctamente
- [ ] Separación de concerns
- [ ] Principios SOLID

### Code Quality
- [ ] Código legible y mantenible
- [ ] Sin código duplicado
- [ ] Nombres descriptivos
- [ ] Documentación completa

### Seguridad
- [ ] Sin inyección SQL
- [ ] Entradas sanitizadas
- [ ] Sin exposición de datos sensibles
- [ ] Autenticación correcta

### Performance
- [ ] Sin queries N+1
- [ ] Sin memory leaks
- [ ] Consultas eficientes
- [ ] Índices en BD

### Error Handling
- [ ] Errores manejados
- [ ] Mensajes claros
- [ ] Logs suficientes
- [ ] No se exponen errores internos
```

### Decisiones que toma
- **Aprueba** → merge a pre-produccion
- **Aprueba con observaciones** → merge con notas
- **Rechaza** → DEV corrige y vuelve a enviar

### Qué NO revisa
- No valida funcionalidad de negocio
- No testea UI/UX
- No hace deploy
- No verifica edge cases de negocio (eso es QA-UI)

### Fórmulas de Revisión
```markdown
## Revisión típica (15-30 min por PR)

1. Archivos modificados (2 min)
2. Revisar cambios lógicos (5-10 min)
3. Verificar seguridad (3-5 min)
4. Check performance (3-5 min)
5. Verificar integración (2-3 min)
6. Decidir: Approve / Request Changes
```

---

## 4. Pre-Implementación (Ricardo)

### Definición Corta
**Prepara el código para ser testeado funcionalmente.**

### Responsabilidades
- Merge de feature a pre-produccion
- Deploy a entorno de pruebas
- Verificar migraciones de BD
- Validar configuración
- Confirmar que el sistema corre
- Preparar para QA-UI

### Qué NO hace
- No escribe código
- No valida funcionalidad (eso es QA-UI)
- No deploya a producción (eso es Implementación)
- No revisa calidad técnica (eso es QA-DEV)

### Flujo de trabajo
```
1. QA-DEV aprueba el PR
2. Ricardo merge a pre-produccion
3. Hace deploy a entorno de pruebas
4. Verifica que el sistema inicia
5. Revisa migraciones de BD
6. Confirma configuración
7. Notifica a QA-UI que está listo
```

### Checklist de Pre-Implementación
```markdown
## Checklist Pre-Implementación

### Deploy
- [ ] Deploy exitoso a pruebas
- [ ] Sistema inicia sin errores
- [ ] Endpoints responden

### Base de Datos
- [ ] Migraciones ejecutadas
- [ ] Datos de prueba disponibles
- [ ] Sin errores de integridad

### Configuración
- [ ] Variables de entorno correctas
- [ ] Conexiones a BD activas
- [ ] Servicios externos configurados

### Verificación
- [ ] Swagger funcional
- [ ] Login funciona
- [ ] Módulos principales accesibles
```

---

## 5. QA-UI (Equipo Kaptas)

### Definición Corta
**Valida que el SISTEMA haga lo que el negocio necesita.**

### Responsabilidades
- Validar flujos completos del negocio
- Verificar reglas de negocio
- Probar UI/UX
- Encontrar edge cases
- Detectar errores funcionales
- Confirmar comportamiento esperado

### Qué NO revisa
- No valida calidad técnica (eso es QA-DEV)
- No hace deploy (eso es Pre-Implementación)
- No escribe código (eso es DEV)

### Preguntas clave que responde
- ¿La funcionalidad hace lo correcto?
- ¿Cumple con lo esperado por negocio?
- ¿La UI responde bien?
- ¿Qué pasa si el usuario hace X?
- ¿Los edge cases están manejados?

### Checklist de QA-UI
```markdown
## Checklist QA-UI

### Funcionalidad
- [ ] Flujo principal funciona
- [ ] Reglas de negocio correctas
- [ ] Cálculos precisos
- [ ] Datos se guardan correctamente

### UI/UX
- [ ] Formularios funcionan
- [ ] Botones responden
- [ ] Mensajes claros
- [ ] Loading states

### Edge Cases
- [ ] Campos vacíos
- [ ] Datos inválidos
- [ ] Permisos de usuario
- [ ] Conexión lenta

### Integración
- [ ] Comunica con otros módulos
- [ ] Datos consistentes
- [ ] Real-time funciona
- [ ] Reportes correctos
```

### Decisiones que toma
- **Aprueba** → listo para producción
- **Aprueba con observaciones** → puede pasar con notas
- **Rechaza** → vuelve a Pre-Implementación o DEV

---

## 6. Implementación (José y Ricardo)

### Definición Corta
**Lleva el código a producción de forma segura.**

### Responsabilidades
- Deploy a producción
- Crear release vX.X.X
- Merge a main
- Monitoreo post-release
- Comunicar cambios
- Rollback si es necesario

### Qué NO hace
- No escribe código
- No valida funcionalidad
- No revisa calidad técnica
- No testing

### Flujo de trabajo
```
1. QA-UI aprueba
2. Crea rama release/vX.X.X
3. Merge a main
4. Deploy a producción
5. Monitorea 15-30 min
6. Confirma que todo funciona
7. Notifica al equipo
```

### Checklist de Implementación
```markdown
## Checklist Implementación

### Pre-Deploy
- [ ] QA-UI aprobó
- [ ] Release notes preparadas
- [ ] Rollback plan listo

### Deploy
- [ ] Rama release creada
- [ ] Merge a main exitoso
- [ ] Deploy a producción
- [ ] Variables de entorno

### Post-Deploy
- [ ] Sistema funciona
- [ ] Endpoints responden
- [ ] Sin errores críticos
- [ ] Monitoreo activo

### Comunicación
- [ ] Equipo notificado
- [ ] Cambios documentados
- [ ] Versión actualizada
```

---

## Flujo Completo Resumido

```
┌─────────────────────────────────────────────────────────────┐
│                    MASTER ARQUITECTO                         │
│         Define QUÉ y CÓMO (estratégico)                     │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              DEV 01 / DEV 02 / DEV 03                       │
│         Implementan (táctico)                                │
│         Crea: feature/* | fix/* | refactor/*                 │
└─────────────────────────┬───────────────────────────────────┘
                          │ PR
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    QA-DEV (Joel)                             │
│         Valida CÓDIGO (técnico)                              │
│         Revisa: arquitectura, seguridad, performance        │
│         Decide: Approved / Rejected                          │
└─────────────────────────┬───────────────────────────────────┘
                          │ Merge
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              PRE-IMPLEMENTACIÓN (Ricardo)                   │
│         Prepara entorno (operativo)                          │
│         Deploy a pruebas, verifica migraciones              │
└─────────────────────────┬───────────────────────────────────┘
                          │ Listo
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    QA-UI (Equipo Kaptas)                    │
│         Valida NEGOCIO (funcional)                           │
│         Prueba: flujos, reglas, UI/UX, edge cases           │
│         Decide: Approved / Rejected                          │
└─────────────────────────┬───────────────────────────────────┘
                          │ Aprobado
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              IMPLEMENTACIÓN (José y Ricardo)                │
│         Lleva a producción (operativo)                       │
│         Crea release, merge a main, deploy                  │
└─────────────────────────────────────────────────────────────┘
```

---

## Matriz de Responsabilidades (RACI)

| Actividad | Arquitecto | DEV | QA-DEV | Pre-Impl | QA-UI | Implementación |
|-----------|------------|-----|--------|----------|-------|----------------|
| Definir arquitectura | **R** | C | C | I | I | I |
| Escribir código | A | **R** | I | I | I | I |
| Crear PR | I | **R** | I | I | I | I |
| Revisar calidad técnica | I | C | **R** | I | I | I |
| Aprobar/Rechazar PR | I | I | **R** | I | I | I |
| Deploy a pruebas | I | I | C | **R** | I | I |
| Validar funcionalidad | I | I | I | C | **R** | I |
| Deploy a producción | I | I | I | I | C | **R** |
| Monitoreo post-release | I | I | I | I | I | **R** |

**R** = Responsible (Responsable)  
**A** = Accountable (Aprueba)  
**C** = Consulted (Consultado)  
**I** = Informed (Informado)

---

## Reglas de Comunicación

### Cuándo comunicar
- **DEV → QA-DEV:** Cuando crea un PR
- **QA-DEV → DEV:** Cuando aprueba o rechaza
- **QA-DEV → Pre-Impl:** Cuando aprueba
- **Pre-Impl → QA-UI:** Cuando deploya a pruebas
- **QA-UI → Implementación:** Cuando aprueba
- **Implementación → Todos:** Cuando deploya a producción

### Herramientas de comunicación
- **Pull Requests:** GitHub/GitLab
- **Issues:** Seguimiento de tareas
- **Chat:** Slack/Discord/Teams (para dudas rápidas)
- **Reuniones:** Sprint planning, daily, retrospective

---

*Documento actualizado: Junio 2026*  
*Proyecto: Kaptas ERP*
