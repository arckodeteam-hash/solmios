/**
 * GH-32 — todo `<input type="password">` declara `autocomplete`, y declara el correcto.
 *
 * El defecto original: sin `autocomplete`, Chrome asume que cualquier campo de contraseña es el
 * login del sitio y lo rellena con una credencial guardada. El operador abre "PIN de garantía" o
 * "Client Secret de TTLock" y lo encuentra lleno sin haber escrito nada — y peor, si guarda sin
 * mirar, persiste su propia contraseña de SolmiOS como secreto de la integración.
 *
 * El arreglo NO es poner `new-password` en todos lados. Hay dos clases de campo:
 *
 *   - Define un secreto NUEVO (PIN, API key, credencial de integración, contraseña nueva y su
 *     confirmación) → `autocomplete="new-password"`. Es el único valor que Chrome respeta para
 *     NO autorrellenar (`off` lo ignora deliberadamente en campos de contraseña).
 *   - Login real, donde el usuario DEBE poder usar su gestor de contraseñas →
 *     `autocomplete="current-password"`. Ponerle `new-password` acá le rompe el login a todos:
 *     el gestor deja de ofrecer la credencial guardada. Por eso `login.vue` tiene su propia
 *     aserción de valor exacto, para que una barrida futura no lo "corrija" de más.
 *
 * Es un test sobre el FUENTE, no sobre el componente montado: montar estas páginas exige router,
 * Pinia y varios services mockeados, y el defecto que cuidamos es puramente declarativo.
 * Sigue el modelo de `src/pages/form-fields-a11y.test.ts`.
 */
import { describe, it, expect } from 'vitest'

/**
 * Fuente cruda de cada `.vue` de `src/`, vía `import.meta.glob` de Vite: `tsconfig.app.json` no
 * incluye `@types/node`, así que `node:fs` no compila acá. `eager: true` resuelve en build-time.
 */
const RAW_VUE = import.meta.glob('./**/*.vue', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

interface PasswordField {
  /** Ruta relativa a `src/`, p. ej. `pages/auth/login.vue`. */
  file: string
  /** Línea de apertura del tag, para que el fallo diga dónde ir. */
  line: number
  /** El tag completo, tal cual está en el fuente. */
  tag: string
  /** `v-model` del campo — es lo que lo identifica de forma estable dentro del archivo. */
  model: string
}

/**
 * Todo `<input>` del fuente que renderiza una contraseña. `[^>]*` cruza saltos de línea, así que
 * también agarra los tags multilínea (el atributo suele estar en una línea distinta a la apertura);
 * ese fue justamente el motivo de que el censo con regex por línea no los viera.
 */
function passwordFields(): PasswordField[] {
  const found: PasswordField[] = []
  for (const [path, src] of Object.entries(RAW_VUE)) {
    const file = path.replace(/^\.\//, '')
    for (const m of src.matchAll(/<input\b[^>]*>/g)) {
      const tag = m[0]
      // `type="password"` estático, o dinámico (`:type="show ? 'text' : 'password'"`).
      if (!/type="password"/.test(tag) && !/:type="[^"]*'password'[^"]*"/.test(tag)) continue
      found.push({
        file,
        line: src.slice(0, m.index).split('\n').length,
        tag,
        model: tag.match(/v-model="([^"]*)"/)?.[1] ?? '',
      })
    }
  }
  return found
}

const FIELDS = passwordFields()

function attr(tag: string, name: string): string | null {
  // El negative lookbehind descarta el binding dinámico (`:name=`) y los sufijos (`data-name=`).
  return tag.match(new RegExp(`(?<![:\\w-])${name}="([^"]*)"`))?.[1] ?? null
}

function find(file: string, model: string): PasswordField {
  const f = FIELDS.find((x) => x.file === file && x.model === model)
  expect(f, `${file}: no existe el campo password con v-model="${model}" — ¿cambió el marcado?`).toBeDefined()
  return f!
}

/**
 * Los campos que este sprint fija, con el criterio aplicado a cada uno. Cada `name` es único
 * dentro de su archivo (ninguno de estos archivos tenía `name` previo).
 */
const EXPECTED: Array<{ file: string; model: string; autocomplete: string; name: string; why: string }> = [
  // ── Login real: el gestor de contraseñas TIENE que seguir funcionando ──
  {
    file: 'pages/auth/login.vue',
    model: 'password',
    autocomplete: 'current-password',
    name: 'password',
    why: 'login del panel: es la credencial guardada del usuario, no un secreto nuevo',
  },

  // ── Contraseña actual dentro del cambio de contraseña: también es la credencial vigente ──
  {
    file: 'pages/auth/change-password.vue',
    model: 'currentPassword',
    autocomplete: 'current-password',
    name: 'current-password',
    why: 'pide la contraseña VIGENTE para autorizar el cambio',
  },

  // ── Contraseñas nuevas y sus confirmaciones ──
  {
    file: 'pages/auth/change-password.vue',
    model: 'newPassword',
    autocomplete: 'new-password',
    name: 'new-password',
    why: 'define la contraseña nueva',
  },
  {
    file: 'pages/auth/change-password.vue',
    model: 'confirmPassword',
    autocomplete: 'new-password',
    name: 'confirm-password',
    why: 'confirmación de la contraseña nueva',
  },
  {
    file: 'pages/auth/reset-password.vue',
    model: 'password',
    autocomplete: 'new-password',
    name: 'new-password',
    why: 'restablecer: define contraseña nueva, no hay "actual"',
  },
  {
    file: 'pages/auth/reset-password.vue',
    model: 'confirmPassword',
    autocomplete: 'new-password',
    name: 'confirm-password',
    why: 'confirmación de la contraseña nueva',
  },

  // ── Credenciales de integración y PINes que define el operador ──
  {
    file: 'pages/cerraduras/index.vue',
    model: 'ttlockConfig.clientSecret',
    autocomplete: 'new-password',
    name: 'ttlock-client-secret',
    why: 'credencial de la app TTLock del hotel',
  },
  {
    file: 'pages/cerraduras/index.vue',
    model: 'ttlockConfig.password',
    autocomplete: 'new-password',
    name: 'ttlock-password',
    why: 'contraseña de la cuenta TTLock del hotel, no la del usuario',
  },
  {
    file: 'pages/super-admin/settings.vue',
    model: 'settings.smtpPassword',
    autocomplete: 'new-password',
    name: 'smtp-password',
    why: 'credencial del servidor SMTP de la plataforma',
  },
  {
    file: 'pages/ai-receptionist/config.vue',
    model: 'llmApiKey',
    autocomplete: 'new-password',
    name: 'llm-api-key',
    why: 'API key del proveedor LLM',
  },
  {
    file: 'pages/attendance/index.vue',
    model: 'pinCode',
    autocomplete: 'new-password',
    name: 'attendance-pin',
    why: 'PIN de fichaje del empleado: no es una credencial del navegador',
  },
  {
    file: 'components/features/ReservationModal.vue',
    model: 'guaranteePin',
    autocomplete: 'new-password',
    name: 'guarantee-pin',
    why: 'PIN del hotel para revelar la tarjeta de garantía (espeja settings/index.vue)',
  },
]

describe('GH-32 — ningún campo de contraseña queda sin `autocomplete`', () => {
  it('el censo encuentra los campos password del proyecto', () => {
    expect(FIELDS.length, 'no se detectó ningún <input type="password"> — ¿cambió el marcado?').toBeGreaterThanOrEqual(
      EXPECTED.length,
    )
  })

  it('todo <input type="password"> de src/ declara autocomplete', () => {
    const naked = FIELDS.filter((f) => attr(f.tag, 'autocomplete') === null).map((f) => `${f.file}:${f.line}`)
    expect(naked, `campo(s) password sin autocomplete: Chrome los autorrellena`).toEqual([])
  })
})

describe('GH-32 — el valor de `autocomplete` responde al rol del campo', () => {
  for (const { file, model, autocomplete, name, why } of EXPECTED) {
    it(`${file} [${model}] → ${autocomplete} (${why})`, () => {
      const field = find(file, model)
      expect(attr(field.tag, 'autocomplete'), `${file}:${field.line} — ${why}`).toBe(autocomplete)
      expect(attr(field.tag, 'name'), `${file}:${field.line} debe declarar name`).toBe(name)
    })
  }
})

describe('GH-32 — `new-password` NO se aplica a un login', () => {
  /**
   * Contrapeso del test de arriba. `new-password` en un login hace que el gestor de contraseñas
   * deje de ofrecer la credencial guardada: se arregla el autorrelleno molesto y se rompe el
   * acceso de todos los usuarios. Si alguien barre el repo poniendo `new-password` en todo, esto
   * es lo que lo frena.
   */
  const LOGIN_FIELDS = [{ file: 'pages/auth/login.vue', model: 'password' }]

  for (const { file, model } of LOGIN_FIELDS) {
    it(`${file} conserva current-password`, () => {
      expect(attr(find(file, model).tag, 'autocomplete')).toBe('current-password')
    })
  }
})

describe('GH-32 — ningún `name` se repite dentro del mismo archivo', () => {
  it('los name agregados no colisionan con otro campo de la misma página', () => {
    const collisions: string[] = []
    for (const { file, name } of EXPECTED) {
      const src = RAW_VUE[`./${file}`]
      const count = [...(src ?? '').matchAll(new RegExp(`(?<![:\\w-])name="${name}"`, 'g'))].length
      if (count !== 1) collisions.push(`${file}: name="${name}" aparece ${count} vez/veces`)
    }
    expect(collisions).toEqual([])
  })
})

/**
 * `autocomplete="off"` NO sirve en campos de contraseña: Chrome lo ignora deliberadamente y
 * autorrellena igual — es el mismo bug que reportó el usuario en el PIN de garantía, con otra cara.
 * El único valor que Chrome respeta para no autorrellenar es `new-password`.
 *
 * Esta aserción existe porque el barrido inicial arregló los campos que no tenían el atributo y
 * dejó pasar cinco que lo tenían en `off` (ChannexPlatformConfig, reputation ×2, tracking ×2):
 * el test anterior sólo miraba que el atributo estuviera presente, así que los daba por buenos.
 */
describe('GH-32 — ningún campo de contraseña usa `autocomplete="off"`', () => {
  it('Chrome ignora `off` en password: el valor correcto es new-password', () => {
    const useless = FIELDS.filter((f) => attr(f.tag, 'autocomplete') === 'off').map((f) => `${f.file}:${f.line}`)
    expect(
      useless,
      'campo(s) password con autocomplete="off": Chrome los autorrellena igual, usar new-password',
    ).toEqual([])
  })
})
