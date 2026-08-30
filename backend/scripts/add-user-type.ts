// scripts/add-user-type.ts — Agrega campo userType a usuarios existentes
import { Database } from 'bun:sqlite'

// `{ create: false }` rompe con SQLITE_MISUSE en Bun 1.3 aunque el archivo exista —
// sin opciones, bun:sqlite abre normal (mismo criterio DB_PATH que migrate-db.ts).
const db = new Database(process.env.DB_PATH || 'data/managerhotel.db')

// Agregar columna si no existe
try {
  db.run(`ALTER TABLE users ADD COLUMN userType TEXT DEFAULT 'merchant'`)
  console.log('✅ Columna userType agregada')
} catch {
  console.log('⚠️ Columna userType ya existe')
}

// Actualizar super_admin → userType: 'admin'
const result = db.run(`UPDATE users SET userType = 'admin' WHERE role = 'super_admin'`)
console.log(`✅ ${result.changes} usuarios super_admin actualizados a userType: admin`)

// Todos los demás → userType: 'merchant' (ya es el default)
const result2 = db.run(`UPDATE users SET userType = 'merchant' WHERE userType IS NULL OR userType = ''`)
console.log(`✅ ${result2.changes} usuarios actualizados a userType: merchant`)

db.close()
console.log('✅ Migración completada')
