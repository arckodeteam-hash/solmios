#!/usr/bin/env bun
// doctor.ts — Channex connection health check
// Verifies every layer of the Channex integration against staging server.
// Run: bun run doctor.ts

import { readFileSync } from 'fs'

// ─── Read .env ───────────────────────────────────────────────────────

function loadEnv(path: string): Record<string, string> {
  const env: Record<string, string> = {}
  try {
    const content = readFileSync(path, 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1)
    }
  } catch {}
  return env
}

const env = loadEnv('.env')
const API_KEY = env.CHANNEX_API_KEY || process.env.CHANNEX_API_KEY || ''
const BASE_URL = env.CHANNEX_BASE_URL || process.env.CHANNEX_BASE_URL || 'https://staging.channex.io/api/v1'
// Property a revisar. La cuenta de Channex es UNA sola white-label para todos los hoteles, así que
// `GET /properties` devuelve las de todos: agarrar la primera y escribirle ARI de prueba le pisa la
// disponibilidad y el precio a un hotel real. Sin esta variable, el doctor es de SOLO LECTURA.
const PROPERTY_ID = process.env.CHANNEX_PROPERTY_ID || env.CHANNEX_PROPERTY_ID || ''

// ─── Simple HTTP client (no framework deps) ──────────────────────────

async function channexRequest(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: any; error?: string }> {
  const url = `${BASE_URL}${path}`
  try {
    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'user-api-key': API_KEY,
      },
    }
    if (body && method !== 'GET') options.body = JSON.stringify(body)

    const res = await fetch(url, options)
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch {}

    if (!res.ok) {
      const err = json?.errors
      return { ok: false, status: res.status, data: null, error: err ? `${err.title || err.code}: ${err.details?.join(', ') || ''}` : text }
    }

    return { ok: true, status: res.status, data: json?.data ?? json }
  } catch (e: any) {
    return { ok: false, status: 0, data: null, error: e.message }
  }
}

// ─── Doctor checks ───────────────────────────────────────────────────

interface CheckResult { name: string; pass: boolean; detail: string }

const results: CheckResult[] = []
function pass(name: string, detail: string) { results.push({ name, pass: true, detail }); console.log(`  ✓ ${name}: ${detail}`) }
function fail(name: string, detail: string) { results.push({ name, pass: false, detail }); console.log(`  ✗ ${name}: ${detail}`) }

console.log('\n🏥 Channex Doctor — Verificando conexión\n')
console.log(`   Base URL: ${BASE_URL}`)
console.log(`   API Key:  ${API_KEY ? API_KEY.slice(0, 8) + '...' : 'NO CONFIGURADA'}\n`)

// 1. API Key configurada
if (!API_KEY) {
  fail('API Key', 'No configurada. Agrega CHANNEX_API_KEY al .env')
  process.exit(1)
}
pass('API Key', 'Configurada')

// 2. Conexión básica — GET /properties
const propsRes = await channexRequest('GET', '/properties')
if (!propsRes.ok) {
  fail('Conexión API', `Error ${propsRes.status}: ${propsRes.error}`)
  console.log('\n⚠️  No se puede continuar sin conexión a la API.\n')
  process.exit(1)
}
const properties = Array.isArray(propsRes.data) ? propsRes.data : []
pass('Conexión API', `${properties.length} propiedades encontradas`)

// 3. Listar propiedades
if (properties.length === 0) {
  console.log('\n   📝 No hay propiedades en Channex todavía.')
  console.log('   Crea una en https://staging.channex.io/ → Properties → New Property')
  console.log('   O usa POST /properties para crearla via API.\n')
} else {
  for (const prop of properties) {
    const attrs = prop.attributes || prop
    pass('Propiedad', `${prop.id?.slice(0, 8)}... — "${attrs.title || attrs.name || 'Sin nombre'}" (${attrs.currency || '?'})`)
  }
}

// 4. Room Types de la propiedad elegida
const target = PROPERTY_ID ? properties.find((p: any) => p.id === PROPERTY_ID) : properties[0]
if (PROPERTY_ID && !target) {
  fail('Propiedad objetivo', `CHANNEX_PROPERTY_ID=${PROPERTY_ID} no está en esta cuenta`)
}
if (!PROPERTY_ID) {
  console.log('\n   ⚠️  Sin CHANNEX_PROPERTY_ID: modo SOLO LECTURA (no se escribe ARI de prueba).')
  console.log('      Para ejercitar el push, apuntá a la property de pruebas:')
  console.log('      CHANNEX_PROPERTY_ID=<uuid> bun run doctor\n')
}
if (target) {
  const propId = target.id
  console.log(`\n   Revisando propiedad: ${propId.slice(0, 8)}...\n`)

  const rtRes = await channexRequest('GET', `/room_types?filter[property_id]=${propId}`)
  if (rtRes.ok) {
    const roomTypes = Array.isArray(rtRes.data) ? rtRes.data : []
    pass('Room Types', `${roomTypes.length} encontrados`)
    for (const rt of roomTypes) {
      const a = rt.attributes || rt
      console.log(`     • "${a.title}" — ${a.count_of_rooms}u, ${a.occ_adults}p max`)
    }
    if (roomTypes.length === 0) {
      console.log('     📝 Sin room types. Se crearán automáticamente al sincronizar.')
    }
  } else {
    fail('Room Types', `Error ${rtRes.status}: ${rtRes.error}`)
  }

  // 5. Rate Plans
  const rpRes = await channexRequest('GET', `/rate_plans?filter[property_id]=${propId}`)
  if (rpRes.ok) {
    const ratePlans = Array.isArray(rpRes.data) ? rpRes.data : []
    pass('Rate Plans', `${ratePlans.length} encontrados`)
    for (const rp of ratePlans) {
      const a = rp.attributes || rp
      console.log(`     • "${a.title}" — ${a.sell_mode || '?'} / ${a.currency || '?'}`)
    }
    if (ratePlans.length === 0) {
      console.log('     📝 Sin rate plans. Se crearán automáticamente al sincronizar.')
    }
  } else {
    fail('Rate Plans', `Error ${rpRes.status}: ${rpRes.error}`)
  }

  // 6. Test ARI push + readback
  if (rtRes.ok && rpRes.ok) {
    const rts = Array.isArray(rtRes.data) ? rtRes.data : []
    const rps = Array.isArray(rpRes.data) ? rpRes.data : []

    if (rts.length > 0 && rps.length > 0 && PROPERTY_ID) {
      const roomId = rts[0].id
      const rateId = rps[0].id
      const today = new Date().toISOString().split('T')[0]
      const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]

      // Push availability
      const avResult = await channexRequest('POST', '/availability', {
        values: [{ property_id: propId, room_type_id: roomId, date_from: today, date_to: nextWeek, availability: 5 }]
      })
      if (avResult.ok) {
        // Readback
        const avReadback = await channexRequest('GET', `/availability?filter[property_id]=${propId}&filter[date][gte]=${today}&filter[date][lte]=${nextWeek}`)
        if (avReadback.ok) {
          pass('ARI Availability Push', 'Push exitoso + readback OK')
        } else {
          fail('ARI Availability Readback', `Error: ${avReadback.error}`)
        }
      } else {
        fail('ARI Availability Push', `Error ${avResult.status}: ${avResult.error}`)
      }

      // Push restrictions (just rate)
      const resResult = await channexRequest('POST', '/restrictions', {
        values: [{ property_id: propId, rate_plan_id: rateId, date_from: today, date_to: nextWeek, rate: 15000 }]
      })
      if (resResult.ok) {
        const resReadback = await channexRequest('GET', `/restrictions?filter[property_id]=${propId}&filter[date][gte]=${today}&filter[date][lte]=${nextWeek}&filter[restrictions]=rate`)
        if (resReadback.ok) {
          pass('ARI Rate Push', 'Push exitoso ($150.00) + readback OK')
        } else {
          fail('ARI Rate Readback', `Error: ${resReadback.error}`)
        }
      } else {
        fail('ARI Rate Push', `Error ${resResult.status}: ${resResult.error}`)
      }
    }
  }

  // 7. Booking feed
  const feedRes = await channexRequest('GET', '/booking_revisions/feed?limit=10')
  if (feedRes.ok) {
    const pending = feedRes.data?.meta?.total ?? (Array.isArray(feedRes.data) ? feedRes.data.length : 0)
    pass('Booking Feed', `${pending} revisiones pendientes`)
  } else {
    fail('Booking Feed', `Error ${feedRes.status}: ${feedRes.error}`)
  }

  // 8. Channel list
  const chRes = await channexRequest('GET', '/channels/list')
  if (chRes.ok) {
    const channels = Array.isArray(chRes.data) ? chRes.data : []
    pass('Canales Disponibles', `${channels.length} OTAs disponibles para conectar`)
  } else {
    fail('Canales', `Error ${chRes.status}: ${chRes.error}`)
  }
}

// ═══════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(50)}`)
const passed = results.filter(r => r.pass).length
const failed = results.filter(r => !r.pass).length
console.log(`  Resultado: ${passed} ✓ / ${failed} ✗ / ${results.length} total`)

if (failed === 0) {
  console.log('  Estado:    ✅ Todos los checks pasaron — integración lista\n')
} else {
  console.log(`  Estado:    ⚠️  ${failed} checks fallaron — revisar arriba\n`)
}
