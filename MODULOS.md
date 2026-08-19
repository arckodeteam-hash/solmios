# Estado de los módulos — SOLMI OS

> Relevado 2026-08-19 contra `backend/src/composition-root.ts` (69 módulos registrados = 69
> carpetas en `src/modules/`, sin huérfanos). Clasificación por madurez verificada en
> producción y deudas documentadas (CLAUDE.md + QA de las sesiones 2026-07/08).

**Criterio**: ✅ plena = flujo completo de punta a punta, sin deuda conocida en su camino,
verificado en prod · 🟡 funcional con deuda o poco rodaje · 🔴 parcial o bloqueado por
credenciales/decisión de negocio (no por código).

## ✅ Operación plena (~30)

| Dominio | Módulos | Notas |
|---|---|---|
| Reservas y estadía | `Reservas` · `Huespedes` · `Habitaciones` · `Bookingengine` · `PromoCodes` · `Cancellation` · `AbandonRecovery` | Motor público con tarifas por ocupación y temporada; anulación con política/penalidad; recuperación de abandonos |
| Finanzas | `Facturas` · `Folios` · `Payments` · `PaymentRequests` · `Cash` · `Reembolsos` · `Gastos` · `Pricing` · `Webhooks` | `payments` es la única fuente de verdad del dinero; webhook Stripe verificado end-to-end (seña → código TTLock) |
| Operación | `Housekeeping` · `Mantenimiento` · `Messages` · `Notificaciones` · `PushTokens` · `Feedback` · `Opiniones` | Aprobación de limpieza con presencia; proveedores con baja reversible; chat con monitor en vivo |
| Infra/seguridad | `StaffAuth` · `Roles` · `Usuarios` · `Auditlog` · `Apikeys` · `Admin` · `Hoteles` · `Publicapi` · `Dashboard` · `Reports` | Permisos module:action + userType; ownership anti-IDOR en todo findById |
| Conectados 2026-08 | `Crm` · `EmailQueue` · `PlatformEmails` · `SitePages` · `Ttlock` · `Canales` · `Marketing` · `PaymentGateways` | CRM con ciclo completo (ganar/canjear→promo/campañas/triggers); auto-messages con journey + birthday/win-back; TTLock un código vigente por reserva |

## 🟡 Funcionales con deuda o menor rodaje (~25)

| Dominio | Módulos | Deuda conocida |
|---|---|---|
| Contabilidad | `Accounting` · `Treasury` · `CajaChica` | Nuevos (2026-08), en rodaje |
| Gastronomía/logística | `Restaurant` · `Inventario` · `Compras` | POS operativo; menor cobertura de tests |
| RRHH | `Payroll` · `Attendance` · `Empleados` · `Reclutamiento` · `Capacitacion` · `Activos` | Funcionales, poco uso real |
| Venta directa | `Grupos` · `Paquetes` · `Amenities` · `Anuncios` · `Landing` · `HotelMedia` | Editor público operativo; features satélite |
| SaaS | `Referrals` · `Aliados` · `Subscriptions` | ⚠️ Programa Aliados sin puerta de conversión en UI (falta botón admin) |
| Otros | `Gastos` · `Tickets` · `Dispositivos` · `ServerTracking` · `WalletPass` · `AiGerente` · `AiRecepcionista` · `ExternalReviews` | IA depende de proveedor externo; ExternalReviews con spec F3 listo sin implementar |

## 🔴 Parciales / bloqueados (4)

| Módulo/feature | Qué falta | Issue |
|---|---|---|
| WhatsApp Business | Creds de Meta (afecta chat de huésped y campañas WA) | deuda conocida |
| Facturación electrónica | Conector fiscal real (DGII/DIAN/SAT) — hoy stub | deuda conocida |
| Captcha del alta pública | Claves Cloudflare Turnstile (`TURNSTILE_SECRET` + site key) | #422 |
| Verificación de email | Confirmación de correo al registrarse (hoy solo formato) | #421 |

## Mapa rápido de dependencias críticas

```
Reservas ── Folios ── Facturas ── Cash ── Reports        (dinero)
   │            │
   │            └── Payments ── Webhooks(Stripe) ── TTLock   (pago → seña → código auto)
   ├── Huespedes ── Crm (puntos/campañas) ── Marketing (auto-messages) ── EmailQueue
   ├── Habitaciones ── Pricing (temporadas) ── Canales (Channex → OTAs)
   └── Bookingengine (motor público) ── PromoCodes ── Cancellation
        Bookingengine ── TTLock   (cancelar desde el widget expira el PIN — connectors/bookingengine-ttlock.ts)
```

## Cómo mantener este archivo

- Al cerrar un change openspec que cambie la madurez de un módulo, mover la fila de tabla.
- La fuente de verdad de "qué hay" es `composition-root.ts`; la de "qué debe hacer" son los
  specs en `openspec/`.
