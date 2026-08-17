# QA-DEV (Quality Assurance Development)

## Descripción General

El rol de **QA-DEV** actúa como un filtro técnico entre el desarrollo y la pre-implementación.

Su responsabilidad principal es garantizar que todo código desarrollado cumpla con los estándares técnicos, arquitectónicos y de calidad antes de avanzar hacia pruebas funcionales o despliegue.

QA-DEV NO se enfoca en validar la interfaz visual ni la experiencia del usuario.

Su enfoque está en:

- Calidad del código
- Arquitectura
- Seguridad
- Integración
- Rendimiento técnico
- Estabilidad del sistema

---

# Objetivo del Rol

Evitar que código técnicamente defectuoso avance en el pipeline.

QA-DEV busca detectar problemas como:

- Mala arquitectura
- Código difícil de mantener
- Vulnerabilidades de seguridad
- Problemas de performance
- Errores de integración
- Bugs silenciosos

Este rol reduce:

- Deuda técnica
- Bugs en producción
- Cuellos de botella futuros
- Costos de mantenimiento

---

# Responsabilidades Principales

## 1. Validación Arquitectónica

Debe verificar que el código respete la arquitectura establecida.

Ejemplo:

Si el sistema usa:

- Clean Architecture
- Hexagonal Architecture
- Microservices
- Modular Monolith

QA-DEV debe asegurar que se respeten esas reglas.

### Debe revisar:

- Dependencias entre capas
- Separación de responsabilidades
- Acoplamiento innecesario
- Violaciones arquitectónicas

---

### Ejemplo Incorrecto

```csharp
Controller -> Database Directo
```

Esto rompe la arquitectura si debería pasar por:

```csharp
Controller -> Application -> Domain -> Infrastructure
```

---

### Checklist Arquitectura

- [ ] Respeta la arquitectura definida
- [ ] No rompe boundaries entre capas
- [ ] No introduce dependencias innecesarias
- [ ] Mantiene bajo acoplamiento
- [ ] Mantiene alta cohesión

---

# 2. Code Quality

Evalúa la calidad técnica del código.

No se trata solo de que "funcione".

Se trata de que sea:

- Limpio
- Legible
- Escalable
- Mantenible

---

### Revisa:

- Naming
- Legibilidad
- Complejidad
- Duplicación
- Funciones enormes
- Clases gigantes

---

### Mal Ejemplo

```csharp
public void Process()
{
   // 400 líneas
}
```

---

### Buen Ejemplo

```csharp
public void Process()
{
   Validate();
   Calculate();
   Persist();
}
```

---

### Checklist Code Quality

- [ ] Código legible
- [ ] Métodos pequeños y claros
- [ ] Clases con responsabilidad clara
- [ ] Bajo nivel de duplicación
- [ ] Naming consistente

---

# 3. Validación SOLID

Uno de los puntos más importantes.

---

## S — Single Responsibility Principle

Cada clase debe tener una sola razón para cambiar.

---

### Malo

```csharp
AuthService
- Login
- Registro
- Email
- Permisos
- Tokens
```

---

### Bueno

```text
AuthService
PermissionService
EmailService
TokenService
```

---

## O — Open/Closed Principle

Debe permitir extender sin modificar demasiado.

---

## L — Liskov Substitution Principle

Subclases deben comportarse correctamente.

---

## I — Interface Segregation Principle

No obligar a implementar métodos innecesarios.

---

## D — Dependency Inversion Principle

Depender de abstracciones.

---

### Checklist SOLID

- [ ] Respeta SRP
- [ ] Respeta OCP
- [ ] Respeta LSP
- [ ] Respeta ISP
- [ ] Respeta DIP

---

# 4. Seguridad

QA-DEV es el primer filtro de seguridad.

Debe identificar vulnerabilidades técnicas.

---

## Revisa

- SQL Injection
- XSS
- CSRF
- Exposición de secretos
- JWT mal configurado
- Permisos débiles

---

### Ejemplo Malo

```csharp
var query = $"SELECT * FROM Users WHERE Name='{username}'";
```

---

### Ejemplo Bueno

```csharp
Parameterized Query
```

---

### Checklist Seguridad

- [ ] No hay SQL Injection
- [ ] No hay secretos hardcodeados
- [ ] Manejo correcto de tokens
- [ ] Validación de inputs
- [ ] Permisos correctamente implementados

---

# 5. Integración

Valida que el código funcione bien con el resto del sistema.

---

## Ejemplos

- APIs
- Servicios externos
- Base de datos
- Cache
- Colas
- Microservicios

---

### Revisa

- Contratos API
- Serialización
- Manejo de errores externos
- Retries
- Timeouts

---

### Checklist Integración

- [ ] APIs responden correctamente
- [ ] Maneja errores externos
- [ ] Tiene retries si aplica
- [ ] Tiene timeout
- [ ] Mantiene compatibilidad

---

# 6. Performance Básica

No busca optimización extrema.

Busca detectar problemas graves.

---

## Revisa

- Queries pesadas
- Loops costosos
- Memory leaks
- Operaciones bloqueantes

---

---

## N+1 Query Problem

Ejemplo:

```csharp
foreach(var user in users)
{
   LoadOrders(user.Id);
}
```

Esto puede matar performance.

---

### Checklist Performance

- [ ] No hay N+1 queries
- [ ] Queries optimizadas
- [ ] No hay loops innecesarios
- [ ] Manejo correcto de memoria
- [ ] No bloquea recursos

---

# 7. Error Handling

El sistema debe fallar correctamente.

No debe romper silenciosamente.

---

### Malo

```csharp
catch(Exception)
{
}
```

---

### Bueno

```csharp
catch(Exception ex)
{
   logger.LogError(ex.Message);
   throw;
}
```

---

### Checklist Error Handling

- [ ] Maneja excepciones
- [ ] No silencia errores
- [ ] Tiene logs de errores
- [ ] Retorna mensajes controlados

---

# 8. Logging & Observabilidad

Si algo falla en producción, debe poder diagnosticarse.

---

### Debe existir logging en:

- Errores críticos
- Integraciones
- Procesos importantes

---

### Ejemplo

```csharp
logger.LogInformation("Payment started");
logger.LogError("Payment failed");
```

---

### Checklist Logging

- [ ] Logs en procesos críticos
- [ ] Logs de errores
- [ ] Logs útiles para debugging
- [ ] No expone información sensible

---

# Flujo de Trabajo del QA-DEV

```text
DEV termina tarea
      ↓
Pull Request
      ↓
QA-DEV revisa
      ↓
Aprobado / Rechazado
      ↓
PreImplementación
```

---

# Resultado de Revisión

QA-DEV puede emitir 3 estados:

---

## Approved

El código cumple con estándares.

```text
READY FOR PRE-IMPLEMENTATION
```

---

## Approved with Observations

Puede avanzar pero tiene mejoras pendientes.

Ejemplo:

- Mejorar naming
- Reducir complejidad

---

## Rejected

Debe regresar al DEV.

Razones:

- Rompe arquitectura
- Mala seguridad
- Performance mala
- Bugs de integración

---

# Perfil Recomendado para QA-DEV

Idealmente debe ser:

- Senior Developer
  o
- Tech Lead
  o
- Software Architect

---

# Skills Necesarios

- Arquitectura de software
- Diseño de sistemas
- Seguridad
- Performance
- Bases de datos
- DevOps básico

---

# KPI del QA-DEV

Métricas útiles:

- Bugs detectados antes de producción
- Issues arquitectónicos detectados
- Vulnerabilidades detectadas
- Tiempo promedio de revisión
- Incidentes evitados

---

# Regla de Oro

QA-DEV no pregunta:

> ¿Funciona?

QA-DEV pregunta:

> ¿Funciona correctamente a nivel técnico y seguirá funcionando a escala?
