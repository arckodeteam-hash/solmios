# Spec: Sistema de Permisos — Inventario

**Estado:** borrador para planificacion
**Fuente:** requisito de la empresa (punto 10.1 del documento de estabilizacion)
**Modulo afectado:** Inventario (Productos), Facturacion, Compras

---

## Contexto

El sistema de permisos debe controlar el acceso a cada operacion, replicando el
comportamiento de Kaptas Escritorio y mejorandolo.

**Principio general:** si el usuario no tiene el permiso, la opcion correspondiente
no debe aparecer (o debe solicitar autorizacion de un administrador).

---

## Permisos de Inventario (10.1)

### 1. Unificar articulo (`UNIARTIC`)

| Aspecto | Detalle |
|---------|---------|
| **Que hace** | Permite unir un articulo a otro al abrir el articulo |
| **Como se controla** | La opcion "Unificar" solo aparece si el usuario tiene el permiso |
| **Modulos afectados** | Inventario (producto detalle) |
| **Donde verificar** | Boton/opcion de unificar en la pantalla de producto |

### 2. Ver precios (`verprecios`)

| Aspecto | Detalle |
|---------|---------|
| **Que hace** | Controla la visibilidad de los precios de venta |
| **Con permiso** | Se ven los precios de venta en inventario (lista y al abrir) |
| **Sin permiso** | No se muestran precios de venta en inventario. En facturacion, no muestra el listado de precios al colocar el puntero en el campo precio |
| **Modulos afectados** | Inventario, Facturacion |
| **Donde verificar** | Columna de precio en lista de productos + tooltip de precios en facturacion |

### 3. Reportes de inventario (`repinvent`)

| Aspecto | Detalle |
|---------|---------|
| **Que hace** | Permite generar reportes de inventario a traves de reporteria |
| **Con permiso** | Acceso a reportes de inventario |
| **Sin permiso** | La seccion de reportes de inventario no aparece |
| **Modulos afectados** | Reportes |

### 4. Ver panel de conteo (`verpanelcont`)

| Aspecto | Detalle |
|---------|---------|
| **Que hace** | Acceso al panel de conteo de inventario |
| **Con permiso** | Puede abrir el panel de conteo |
| **Sin permiso** | El panel no esta accesible |
| **Modulos afectados** | Inventario (panel de conteo) |

### 5. Modificar precios de venta (`modpventa`)

| Aspecto | Detalle |
|---------|---------|
| **Que hace** | Cambiar el precio de venta por inventario, facturacion y compra |
| **Alcance** | Permite modificar precios bajos o superiores al asignado |
| **Modulos afectados** | Inventario, Facturacion, Compras |
| **Donde verificar** | Campo de precio de venta editable en producto, factura y compra |

### 6. Modificar articulos (`MODARTIC`)

| Aspecto | Detalle |
|---------|---------|
| **Que hace** | Permite modificar las descripciones del articulo |
| **Limite** | NO permite modificar precios de costo y venta (esos son permisos separados: `vercosto` y `modpventa`) |
| **Modulos afectados** | Inventario (producto detalle) |
| **Donde verificar** | Campos de descripcion editables; campos de precio NO editables sin permiso adicional |

### 7. Agregar articulo (`CREAARTIC`)

| Aspecto | Detalle |
|---------|---------|
| **Que hace** | Permite crear nuevos articulos |
| **Como se controla** | El boton "+" se habilita solo con el permiso |
| **Tambien aplica** | Crear articulos desde compras + agregar categorias |
| **Modulos afectados** | Inventario, Compras, Categorias |
| **Donde verificar** | Boton "+" visible/habilitado en lista de productos, en compras, y en categorias |

### 8. Foto (agregar/modificar/eliminar)

| Aspecto | Detalle |
|---------|---------|
| **Que hace** | Controla si el usuario puede gestionar la foto del articulo |
| **Con permiso** | Puede agregar, modificar y eliminar la foto |
| **Sin permiso** | Solo visualiza la imagen con un mensaje de "solo visualizacion" |
| **Modulos afectados** | Inventario (producto detalle) |

### 9. Historico de precios (`VERHISTPREC`)

| Aspecto | Detalle |
|---------|---------|
| **Que hace** | Permite ver el tracking de modificaciones de precios (costo y venta) |
| **Con permiso** | Aparece el boton de historico de precios |
| **Sin permiso** | No aparece el boton |
| **Modulos afectados** | Inventario (producto detalle) |

### 10. Ver total en inventario (`VERTOTCOSTO`)

| Aspecto | Detalle |
|---------|---------|
| **Que hace** | Controla la visibilidad de los totales de costo y venta |
| **Con permiso** | Se muestran los totales de costo y venta en inventario, facturacion, gasto y compras |
| **Sin permiso** | No se muestran los totales |
| **Modulos afectados** | Inventario, Facturacion, Gastos, Compras |
| **Donde verificar** | Filas/Columnas de totales en listados y formularios |

### 11. Ver movimiento de stock (`VERMOVART`)

| Aspecto | Detalle |
|---------|---------|
| **Que hace** | Ver el movimiento de stock del articulo |
| **Con permiso** | Aparece la opcion de movimiento de stock |
| **Sin permiso** | No aparece la opcion |
| **Modulos afectados** | Inventario (producto detalle) |

### 12. Reactivar articulo

| Aspecto | Detalle |
|---------|---------|
| **Que hace** | Permiso para reactivar un articulo inactivo |
| **Nota** | Web solo tiene estatus activo/inactivo (no "anulado") |
| **Modulos afectados** | Inventario (producto detalle) |

### 13. Disponible sucursales (`VERDISPSUCF`)

| Aspecto | Detalle |
|---------|---------|
| **Que hace** | Ver las cantidades disponibles en otras sucursales |
| **Con permiso** | Muestra stock disponible en otras sucursales |
| **Sin permiso** | No muestra las cantidades de otras sucursales |
| **Modulos afectados** | Inventario |
| **Donde verificar** | Columna/seccion de disponible por sucursal en producto |

### 14. Utilidad por productos (`UTILIDAD`)

| Aspecto | Detalle |
|---------|---------|
| **Que hace** | Mostrar la utilidad por monto y porcentaje |
| **Con permiso** | Trae la utilidad por monto y porcentaje en el producto |
| **Sin permiso** | No muestra la utilidad |
| **Modulos afectados** | Inventario (producto detalle) |

### 15. Nota de garantia + Carga de Excel

| Aspecto | Detalle |
|---------|---------|
| **Que hace** | Limitar la nota de garantia y la carga de Excel (puede afectar la informacion) |
| **Pendiente** | Dividir en 2 permisos separados: uno para nota de garantia, otro para carga de Excel |
| **Modulos afectados** | Inventario (producto detalle) |

### 16. Ver costo (`vercosto`)

| Aspecto | Detalle |
|---------|---------|
| **Que hace** | Controla la visibilidad de los costos |
| **Con permiso** | Se ven los costos en inventario y al modificar el articulo en facturacion |
| **Sin permiso** | No se muestran los costos |
| **Modulos afectados** | Inventario, Facturacion |
| **Donde verificar** | Campo/columna de costo en lista y detalle de producto + en facturacion |

### 17. Anular/inactivar articulos (`ELIMART`)

| Aspecto | Detalle |
|---------|---------|
| **Que hace** | Permite inactivar un articulo |
| **Comportamiento** | En Web se inactiva, no se anula. Al inactivar, no sale en facturacion |
| **UX** | El boton de basura debe indicar "inactivar" (no "eliminar") |
| **Modulos afectados** | Inventario (lista de productos) |

---

## Resumen de permisos

| Codigo | Nombre | Modulos |
|--------|--------|---------|
| `UNIARTIC` | Unificar articulo | Inventario |
| `verprecios` | Ver precios de venta | Inventario, Facturacion |
| `repinvent` | Reportes de inventario | Reportes |
| `verpanelcont` | Panel de conteo | Inventario |
| `modpventa` | Modificar precios de venta | Inventario, Facturacion, Compras |
| `MODARTIC` | Modificar articulos (solo descripciones) | Inventario |
| `CREAARTIC` | Agregar articulo | Inventario, Compras, Categorias |
| (foto) | Gestionar foto del articulo | Inventario |
| `VERHISTPREC` | Historico de precios | Inventario |
| `VERTOTCOSTO` | Ver totales de costo y venta | Inventario, Facturacion, Gastos, Compras |
| `VERMOVART` | Movimiento de stock | Inventario |
| (reactivar) | Reactivar articulo inactivo | Inventario |
| `VERDISPSUCF` | Disponible en sucursales | Inventario |
| `UTILIDAD` | Utilidad por productos | Inventario |
| (dividir) | Nota de garantia + Carga Excel | Inventario |
| `vercosto` | Ver costo | Inventario, Facturacion |
| `ELIMART` | Inactivar articulo | Inventario |

---

## Verificacion contra la BD (2026-06-28)

### Permisos que YA existen en Modules_Options

| Codigo en BD | ID | Existe? |
|--------------|----|---------|
| `CREAARTIC` | 101 | ✓ |
| `ELIMART` | 103 | ✓ |
| `MODPVENTA` | 49 | ✓ |
| `UNIARTIC` | 107, 108 | ✓ (duplicado) |
| `VERCOSTO` | 71, 208 | ✓ (duplicado) |
| `VERDISPSUCF` | 77 | ✓ |
| `VERHISTPREC` | 105 | ✓ |
| `VERMOVART` | 104 | ✓ |
| `VERPRECIOS` | 109 | ✓ |

### Permisos que FALTAN en Modules_Options (6)

| Codigo propuesto | Razon |
|------------------|-------|
| `repinvent` | Reportes de inventario — no existe |
| `verpanelcont` | Panel de conteo — no existe |
| `MODARTIC` | Modificar articulos (solo descripciones) — no existe |
| `VERTOTCOSTO` | Ver totales de costo y venta — no existe |
| `UTILIDAD` | Utilidad por productos — no existe |
| `REACTARTIC` | Reactivar articulo inactivo — no existe (propuesto) |

### Permisos que hay que DIVIDIR

| Permiso actual | Dividir en |
|----------------|------------|
| (no existe) | `NOTAGARANTIA` (nota de garantia) + `CARGAEXCEL` (carga de Excel) |

### Duplicados a limpiar

| Codigo | IDs | Accion |
|--------|-----|--------|
| `UNIARTIC` | 107, 108 | Unificar en uno solo |
| `VERCOSTO` | 71, 208 | Unificar en uno solo |

---

## Plan de accion sugerido

```
FASE 1: Crear los 6 permisos faltantes en Modules_Options
FASE 2: Limpiar duplicados (UNIARTIC y VERCOSTO)
FASE 3: Agregar [Authorize] en los controllers correspondientes
FASE 4: Implementar el control en el frontend (mostrar/ocultar opciones)
FASE 5: Tests para cada permiso (similar a los de Auth)
```
