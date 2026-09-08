#!/usr/bin/env bun
// scripts/verificar-whatsapp.ts — ¿Está todo listo para que WhatsApp funcione?
//
// Responde la pregunta que se hace cualquiera antes de grabar el vídeo para Meta o de dejar entrar
// al primer hotel: qué falta, exactamente, y quién lo tiene que hacer. Revisa el entorno, la base y
// —si el hotel ya conectó— la cuenta real en Meta.
//
//   bun run scripts/verificar-whatsapp.ts                 # todos los hoteles
//   bun run scripts/verificar-whatsapp.ts <hotelId>       # uno solo
//
// Es de SOLO LECTURA: no crea, no modifica, no envía nada.

import { Database } from 'bun:sqlite'

const GRAPH = 'https://graph.facebook.com'
const VERSION = process.env.META_GRAPH_VERSION || 'v26.0'

type Estado = 'ok' | 'falta' | 'aviso'
const MARCA: Record<Estado, string> = { ok: '  ✅', falta: '  ❌', aviso: '  ⚠️ ' }

interface Chequeo { estado: Estado; texto: string; comoSeArregla?: string }
const resultados: Chequeo[] = []

function anotar(estado: Estado, texto: string, comoSeArregla?: string): void {
  resultados.push({ estado, texto, comoSeArregla })
}

function titulo(t: string): void {
  console.log(`\n${t}\n${'─'.repeat(t.length)}`)
}

// ── 1. Entorno ───────────────────────────────────────────────────────────────
titulo('1. Variables del servidor')

const APP_ID = process.env.META_APP_ID
const APP_SECRET = process.env.META_APP_SECRET
const WEBHOOK_SECRET = process.env.WHATSAPP_APP_SECRET

anotar(APP_ID ? 'ok' : 'falta', `META_APP_ID${APP_ID ? ` = ${APP_ID}` : ''}`,
  'Es público. El de SOLMI OS es 1727869705161184.')
anotar(APP_SECRET ? 'ok' : 'falta', 'META_APP_SECRET',
  'developers.facebook.com/apps/<APP_ID>/settings/basic/ → "Mostrar". Sin esto, el botón "Conectar WhatsApp" responde 503.')
anotar(WEBHOOK_SECRET ? 'ok' : 'falta', 'WHATSAPP_APP_SECRET',
  'Es el MISMO valor que META_APP_SECRET. Sin esto el webhook RECHAZA TODO y ningún mensaje de huésped entra al PMS.')
if (APP_SECRET && WEBHOOK_SECRET && APP_SECRET !== WEBHOOK_SECRET) {
  anotar('aviso', 'META_APP_SECRET y WHATSAPP_APP_SECRET son distintos',
    'Deberían ser el mismo secreto de la misma app. Si difieren, uno de los dos está mal.')
}
console.log(resultados.map(r => `${MARCA[r.estado]} ${r.texto}`).join('\n'))

// ── 2. Base de datos ─────────────────────────────────────────────────────────
titulo('2. Conexión de los hoteles')

const dbPath = process.env.DB_PATH || 'data/managerhotel.db'
let db: Database
try {
  db = new Database(dbPath, { readonly: true })
} catch (e) {
  console.log(`  ❌ No se pudo abrir la base (${dbPath}): ${String(e)}`)
  console.log('\n     Este script lee SQLite. En producción (Postgres) hay que consultar a mano.')
  process.exit(1)
}

const hotelIdArg = process.argv[2]
const filtro = hotelIdArg ? ' WHERE c.hotelId = ?' : ''
const conexiones = db.query(`
  SELECT c.hotelId, h.name AS hotelName, c.connectionMode, c.wabaId, c.phoneNumberId,
         c.accessToken, c.displayPhoneNumber, c.verifiedName, c.qualityRating, c.messagingLimit
  FROM ai_whatsapp_config c LEFT JOIN hotels h ON h.id = c.hotelId${filtro}
`).all(...(hotelIdArg ? [hotelIdArg] : [])) as any[]

if (conexiones.length === 0) {
  console.log('  ❌ Ningún hotel tiene configuración de WhatsApp.')
  console.log('     El hotel la crea solo desde Configuración → Integraciones → Conectar WhatsApp.')
}

const conectados = conexiones.filter(c => c.connectionMode === 'meta' && c.accessToken)
const legacy = conexiones.filter(c => c.connectionMode === 'baileys')

for (const c of conexiones) {
  const nombre = c.hotelName || c.hotelId
  if (c.connectionMode === 'meta' && c.accessToken) {
    console.log(`  ✅ ${nombre}: conectado · ${c.displayPhoneNumber || 'sin número legible'} · calidad ${c.qualityRating || '?'}`)
  } else if (c.connectionMode === 'baileys') {
    console.log(`  ⚠️  ${nombre}: usa la vinculación por QR (vía NO oficial de Meta)`)
  } else {
    console.log(`  ❌ ${nombre}: sin conectar`)
  }
}
if (legacy.length > 0) {
  console.log(`\n     ${legacy.length} hotel(es) con la vía vieja. Antes del vídeo hay que migrarlos`)
  console.log('     o asegurarse de que el revisor de Meta no llegue a esa pantalla.')
}

// ── 3. Plantillas ────────────────────────────────────────────────────────────
titulo('3. Plantillas')

const plantillas = db.query(`
  SELECT hotelId, name, approvalStatus, metaRejectedReason FROM whatsapp_templates
  ${hotelIdArg ? 'WHERE hotelId = ?' : ''}
`).all(...(hotelIdArg ? [hotelIdArg] : [])) as any[]

const porEstado = plantillas.reduce((acc: Record<string, number>, t: any) => {
  const k = t.approvalStatus || 'none'
  acc[k] = (acc[k] ?? 0) + 1
  return acc
}, {})

if (plantillas.length === 0) {
  console.log('  ❌ Ninguna plantilla creada.')
  console.log('     El hotel las crea de una con el botón "Usar plantillas recomendadas".')
} else {
  console.log(`  Sin enviar: ${porEstado.none ?? 0} · En revisión: ${porEstado.pending ?? 0} · Aprobadas: ${porEstado.approved ?? 0} · Rechazadas: ${porEstado.rejected ?? 0}`)
  for (const t of plantillas.filter((t: any) => t.approvalStatus === 'rejected')) {
    console.log(`  ❌ "${t.name}" rechazada: ${t.metaRejectedReason || 'sin motivo informado'}`)
  }
  if ((porEstado.approved ?? 0) === 0) {
    console.log('  ⚠️  Ninguna aprobada todavía: sin una plantilla aprobada NO se puede iniciar una')
    console.log('     conversación con un huésped que no escribió en las últimas 24 horas.')
  }
}

// ── 4. Contra Meta ───────────────────────────────────────────────────────────
titulo('4. Estado real en Meta')

if (conectados.length === 0) {
  console.log('  ⏭  Ningún hotel conectado: no hay a quién preguntarle.')
} else {
  for (const c of conectados) {
    const nombre = c.hotelName || c.hotelId
    try {
      const res = await fetch(`${GRAPH}/${VERSION}/${c.phoneNumberId}?fields=display_phone_number,quality_rating,messaging_limit_tier`, {
        headers: { Authorization: `Bearer ${c.accessToken}` },
        signal: AbortSignal.timeout(15_000),
      })
      const body: any = await res.json()
      if (!res.ok) {
        console.log(`  ❌ ${nombre}: Meta rechazó el token — ${body?.error?.message ?? res.status}`)
        console.log('     El hotel tiene que volver a conectar su WhatsApp.')
        continue
      }
      console.log(`  ✅ ${nombre}: token vigente · ${body.display_phone_number} · ${body.messaging_limit_tier ?? 'sin tope informado'}`)

      const tpl = await fetch(`${GRAPH}/${VERSION}/${c.wabaId}/message_templates?fields=name,status&limit=50`, {
        headers: { Authorization: `Bearer ${c.accessToken}` },
        signal: AbortSignal.timeout(15_000),
      })
      const tb: any = await tpl.json()
      if (tpl.ok) {
        const aprobadas = (tb.data ?? []).filter((t: any) => t.status === 'APPROVED')
        console.log(`     ${tb.data?.length ?? 0} plantilla(s) en Meta, ${aprobadas.length} aprobada(s)`)
      } else {
        console.log(`     ⚠️  No se pudieron leer las plantillas: ${tb?.error?.message ?? tpl.status}`)
        console.log('     Suele ser permiso: el usuario del sistema necesita control total sobre la cuenta.')
      }
    } catch (e) {
      console.log(`  ⚠️  ${nombre}: no se pudo contactar a Meta — ${String(e)}`)
    }
  }
}

// ── Resumen ──────────────────────────────────────────────────────────────────
titulo('Qué falta')

const faltantes = resultados.filter(r => r.estado === 'falta')
if (faltantes.length === 0 && conectados.length > 0) {
  console.log('  Nada del lado del sistema. Si el vídeo todavía no se grabó, es lo único pendiente.')
} else {
  for (const f of faltantes) {
    console.log(`  ❌ ${f.texto}`)
    if (f.comoSeArregla) console.log(`     → ${f.comoSeArregla}`)
  }
  if (conectados.length === 0) {
    console.log('  ❌ Ningún hotel con la conexión oficial de Meta')
    console.log('     → El hotel entra a Configuración → Integraciones y pulsa "Conectar WhatsApp".')
    console.log('       Necesita META_APP_SECRET cargado en el servidor.')
  }
}
console.log()
