# whatsapp-meta-templates — Design

## Auth flow (obligatorio documentar — integración externa)

No hay OAuth en este change (eso es REQ-META-01, fuera de scope). El "auth flow" acá es más simple:
credenciales estáticas por hotel, ya persistidas, leídas en el momento del submit/sync.

```
1. Hotel (o el equipo, en desarrollo) carga wabaId + accessToken vía
   PUT /api/ai/whatsapp/config   (endpoint YA existente, ai-recepcionista)
   → se guardan en ai_whatsapp_config.{wabaId, accessToken}, por hotelId único.

2. Admin abre Configuración → Mensajería → Plantillas WhatsApp, crea/edita una plantilla,
   click "Enviar a Meta".

3. Frontend → POST /api/whatsapp-templates/:id/submit  (marketing, nuevo)

4. marketing/service.ts:submitTemplateToMeta(id)
   → lee template (whatsapp_templates)
   → pide credenciales al connector:  metaCredsPort.getMetaCredentials(hotelId)
        → connectors/marketing-whatsapp-meta.ts → ai-recepcionista.getWhatsappConfig(hotelId)
        → si no hay wabaId/accessToken: throw ValidationError (409) "WhatsApp Business no conectado"
   → arma payload Meta (ver "Conversión de variables" abajo)
   → whatsapp-meta-template-client.ts:createTemplate(wabaId, accessToken, payload)
        POST https://graph.facebook.com/v26.0/{wabaId}/message_templates
        Headers: Authorization: Bearer {accessToken}
        Body: { name, language, category, components: [{ type: 'BODY', text, example? }] }
   → respuesta Meta: { id, status }  (status inicial siempre 'PENDING')
   → persist: metaTemplateId=id, approvalStatus='pending', metaSyncedAt=now

5. Admin click "Sincronizar estado" (o automático al reabrir la fila, ver Interacción)

6. Frontend → POST /api/whatsapp-templates/:id/sync-status

7. marketing/service.ts:syncTemplateStatus(id)
   → whatsapp-meta-template-client.ts:getTemplateStatus(wabaId, accessToken, metaTemplateId)
        GET https://graph.facebook.com/v26.0/{metaTemplateId}?fields=status,rejected_reason
   → persist: approvalStatus = map(status), metaRejectedReason (si REJECTED), metaSyncedAt=now
```

`accessToken` **nunca** se expone al frontend — mismo patrón que `redactWhatsappConfig`
(`ai-recepcionista/usecases/whatsapp-config.ts:45`): el connector lo lee server-side únicamente, el
cliente HTTP de Graph API vive en el backend, el frontend solo ve `approvalStatus`/`metaRejectedReason`.

## Connector: `marketing-whatsapp-meta.ts`

Mismo patrón que `marketing-auditlog.ts` (puerto declarado por `marketing`, implementación inyectada
por el connector, sin import directo entre módulos):

```ts
// marketing/service.ts
export interface MetaWhatsappCredentialsPort {
  getMetaCredentials(hotelId: string): Promise<{ wabaId: string; accessToken: string } | null>
}
// setMetaCredsDeps(port: MetaWhatsappCredentialsPort): void

// connectors/marketing-whatsapp-meta.ts
export function marketingWhatsappMetaConnector(ctx: ConnectorContext): void {
  const marketing = ctx.resolveModule<{ setMetaCredsDeps: (p: any) => void }>('marketing')
  const aiRecepcionista = ctx.resolveModule<{ getWhatsappConfig: (hotelId: string) => Promise<any> }>('ai-recepcionista')
  marketing.setMetaCredsDeps({
    getMetaCredentials: async (hotelId) => {
      const cfg = await aiRecepcionista.getWhatsappConfig(hotelId)
      if (!cfg?.wabaId || !cfg?.accessToken) return null
      return { wabaId: cfg.wabaId, accessToken: cfg.accessToken }
    },
  })
}
```

`ai-recepcionista`'s exported module contract necesita exponer `getWhatsappConfig` como método
resoluble del módulo (hoy es un método del controller/service interno — verificar en `apply` si hace
falta agregarlo al `contract.actions` del módulo o si ya es alcanzable vía el service exportado).

## Conversión de variables: nombradas → posicionales Meta

Meta exige `{{1}}`, `{{2}}`... en el body, con un `example.body_text` (array de arrays de strings) por
cada set de valores de ejemplo. El body local usa nombres (`{guest_name}`, `{hotel_name}`, etc. — mismo
set que `frontend/src/pages/whatsapp-templates/index.vue:242`).

```ts
// usecases/meta-variable-mapping.ts
function toMetaBody(localBody: string): { metaBody: string; variableOrder: string[] } {
  const seen: string[] = []
  const metaBody = localBody.replace(/\{(\w+)\}/g, (_, name) => {
    let idx = seen.indexOf(name)
    if (idx === -1) { seen.push(name); idx = seen.length - 1 }
    return `{{${idx + 1}}}`
  })
  return { metaBody, variableOrder: seen }
}
```

Los valores de ejemplo (`example.body_text`) se resuelven contra el mismo diccionario demo que ya usa
el preview del frontend (`preview` computed, `whatsapp-templates/index.vue:266-280` — `guest_name` →
"María García", etc.), replicado server-side para no depender del cliente al armar el payload.

`variableOrder` se persiste en `metaVariableOrder` (json) — necesario para que un envío en runtime
(fuera de scope, REQ-META-04) sepa en qué posición va cada variable real de la reserva.

## Estados y transición (`approvalStatus`)

```
none ──submit──> pending ──sync (status=APPROVED)──> approved
                     │
                     └──sync (status=REJECTED)──> rejected (+ metaRejectedReason)

approved/rejected/pending ──edit body/category/language──> none  (fuerza re-submit)
```

Mapeo Meta → local: `PENDING`→`pending`, `APPROVED`→`approved`, `REJECTED`→`rejected`. Cualquier otro
valor de Meta (`PAUSED`, `DISABLED`, futuros) cae a `rejected` con `metaRejectedReason` describiendo el
status crudo — no se inventa un estado nuevo en la UI sin necesidad real.

## Manejo de errores Graph API

- `401`/credencial inválida → `ValidationError` 409 con mensaje claro, no reintenta.
- `100` (nombre duplicado en el WABA) → mensaje "Ya existe una plantilla con ese nombre en Meta,
  cambiá el nombre e intentá de nuevo" — Meta expone el código en `error.error_subcode`/`message`.
- Timeout/red → 502 propagado, la plantilla queda en `approvalStatus='none'` (no se marca `pending` sin
  confirmación real de Meta).

## Fuera de diseño (deliberado)

- No se implementa reintento automático ni cola — el submit/sync son acciones síncronas disparadas por
  click, con el `saving`/loading state estándar del frontend (mismo patrón que `save()` en
  `whatsapp-templates/index.vue:322`).
