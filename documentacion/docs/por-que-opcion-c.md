# Por qué la Opción C — y por qué es viable para el equipo

> Justificación ejecutiva. Server online de prueba (`173.249.31.75`) como destino de los tests.

---

## Por qué es mejor (vs A y B)

| # | Razón | Detalle |
|---|-------|---------|
| 1 | **Reutiliza lo ya hecho** | Las BDs `_test`, el reset automático y los 239 tests ya funcionan. No empezamos de cero. |
| 2 | **Menos trabajo** | No hay que extraer ni versionar el schema — el server lo tiene. Cero configuración de Testcontainers. |
| 3 | **Cero drift manual** | El schema lo mantiene el DBA en el server. No hay `.sql` que sincronizar a mano (a diferencia de la B). |
| 4 | **Detecta los cambios** | Si el DBA actualiza y rompe algo, el test falla y avisa. No da falsa confianza como un `.bak` viejo. |
| 5 | **Aislamiento real** | BDs `_test` dedicadas — las BDs reales (`kaptaswebdev`, `kw21`) nunca se tocan. |
| 6 | **Datos realistas** | El server de prueba tiene datos representativos → los tests prueban contra algo parecido a prod. |

---

## Por qué es viable para el equipo

| # | Razón | Detalle |
|---|-------|---------|
| 7 | **Compañeros: clonan y corren** | Solo cambian 1 variable de entorno. No instalan Docker SQL ni restauran `.bak`. |
| 8 | **CI autónomo** | El pipeline apunta al server, resetea, corre. No levanta infraestructura nueva por cada corrida. |
| 9 | **Equipo chico = sin fricción** | La contención se resuelve con 1 BD `_test` por persona (`kw21_test_joel`, etc.). |
| 10 | **Escalable** | Cuando entre más gente, nadie pide configurar nada — solo la variable. El día que crezca, ya está resuelto. |

---

## Veredicto en una línea

Es la única opción que da cobertura **hoy** (reutilizando lo armado), **mañana** (compañeros y CI sin fricción), y **detecta** cuando algo cambia en prod — **sin el costo de mantener schemas a mano**.

---

## Documentos relacionados

- [`solucion-tests.html`](./solucion-tests.html) — la propuesta visual (mapas mentales, arquitectura).
- [`implemementacion-opcion-c.html`](./implemementacion-opcion-c.html) — el paso a paso para implementarla.
