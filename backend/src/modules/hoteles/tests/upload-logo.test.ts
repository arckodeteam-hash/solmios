// hoteles/tests/upload-logo.test.ts — POST /api/settings/logo
//
// El campo Logo del hotel solo aceptaba una URL escrita a mano (sin forma de subir un archivo
// real). Mismo patrón que /api/auth/avatar (usuarios/controller.ts): el frontend manda la imagen
// como data URL base64 en JSON (el router de arckode no propaga multipart), el controller la decodifica,
// la sube por StorageService y persiste la URL devuelta en hotels.logo.

import { describe, it, expect } from 'bun:test'
import { HotelesController } from '../controller'

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} } as any

const PNG_1PX_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

function fakeQueries(hotelId: string | undefined) {
  return { resolveHotelId: async () => hotelId } as any
}

function fakeService(updateHotelSpy: (id: string, patch: any) => void) {
  return {
    updateHotel: async (id: string, patch: any) => {
      updateHotelSpy(id, patch)
      return { id, ...patch }
    },
  } as any
}

function fakeStorage(uploadSpy?: (file: any, dir?: string) => void) {
  return {
    upload: async (file: any, dir?: string) => {
      uploadSpy?.(file, dir)
      return { url: '/uploads/hotel-logos/logo-h1.png', path: 'hotel-logos/logo-h1.png', originalName: file.originalName, mimeType: file.mimeType, size: file.size }
    },
  } as any
}

const req = (body: any, hotelId = 'h1') => ({ body, query: {}, user: { id: 'u1', role: 'hotel_admin', hotelId } }) as any

describe('POST /api/settings/logo', () => {
  it('sin storage configurado: 500 explícito, no un crash', async () => {
    const c = new HotelesController(fakeService(() => {}), noopLogger, fakeQueries('h1'), undefined)
    const res = await c.uploadLogo(req({ logo: `data:image/png;base64,${PNG_1PX_BASE64}` }))
    expect(res.status).toBe(500)
  })

  it('sin hotel resoluble: 404', async () => {
    const c = new HotelesController(fakeService(() => {}), noopLogger, fakeQueries(undefined), fakeStorage())
    const res = await c.uploadLogo(req({ logo: `data:image/png;base64,${PNG_1PX_BASE64}` }))
    expect(res.status).toBe(404)
  })

  it('sin campo logo: 400', async () => {
    const c = new HotelesController(fakeService(() => {}), noopLogger, fakeQueries('h1'), fakeStorage())
    const res = await c.uploadLogo(req({}))
    expect(res.status).toBe(400)
  })

  it('data URL con forma inválida: 400', async () => {
    const c = new HotelesController(fakeService(() => {}), noopLogger, fakeQueries('h1'), fakeStorage())
    const res = await c.uploadLogo(req({ logo: 'no-es-un-data-url' }))
    expect(res.status).toBe(400)
  })

  it('rechaza archivos que no son imagen (ej. PDF)', async () => {
    const c = new HotelesController(fakeService(() => {}), noopLogger, fakeQueries('h1'), fakeStorage())
    const res = await c.uploadLogo(req({ logo: 'data:application/pdf;base64,JVBERi0xLjQK' }))
    expect(res.status).toBe(400)
  })

  it('rechaza una imagen que supera 5MB — el frontend ya lo corta, pero un cliente directo (curl/Postman) podía saltearlo', async () => {
    const bigBuffer = Buffer.alloc(5 * 1024 * 1024 + 1, 1)
    const c = new HotelesController(fakeService(() => {}), noopLogger, fakeQueries('h1'), fakeStorage())
    const res = await c.uploadLogo(req({ logo: `data:image/png;base64,${bigBuffer.toString('base64')}` }))
    expect(res.status).toBe(400)
  })

  it('imagen válida: sube al storage y guarda la URL devuelta en hotels.logo', async () => {
    let savedId = ''
    let savedPatch: any = null
    let uploadedDir = ''
    const c = new HotelesController(
      fakeService((id, patch) => { savedId = id; savedPatch = patch }),
      noopLogger,
      fakeQueries('h1'),
      fakeStorage((_file, dir) => { uploadedDir = dir || '' }),
    )
    const res = await c.uploadLogo(req({ logo: `data:image/png;base64,${PNG_1PX_BASE64}`, fileName: 'mi-logo.png' }))
    expect(res.status).toBe(201)
    expect(uploadedDir).toBe('hotel-logos')
    expect(savedId).toBe('h1')
    expect(savedPatch).toEqual({ logo: '/uploads/hotel-logos/logo-h1.png' })
    expect((res.body as any).logo).toBe('/uploads/hotel-logos/logo-h1.png')
  })

  it('aísla por hotel: el logo se guarda para el hotelId resuelto del token, no uno fijo', async () => {
    let savedId = ''
    const c = new HotelesController(
      fakeService((id) => { savedId = id }),
      noopLogger,
      fakeQueries('hotel-b'),
      fakeStorage(),
    )
    await c.uploadLogo(req({ logo: `data:image/png;base64,${PNG_1PX_BASE64}` }, 'hotel-b'))
    expect(savedId).toBe('hotel-b')
  })
})
