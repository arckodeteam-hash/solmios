// settings-email.test.ts — Validación del destino de la prueba de correo y default (#100).
import { describe, it, expect } from 'vitest'
import { validarDestinoPrueba, destinoPruebaPorDefecto, mensajeResultadoPrueba } from './settings-email'

describe('validarDestinoPrueba', () => {
  it('vacío (o solo espacios) devuelve error', () => {
    expect(validarDestinoPrueba('')).toBe('Cargá un email de destino para la prueba')
    expect(validarDestinoPrueba('   ')).toBe('Cargá un email de destino para la prueba')
  })

  it('sin @ o sin dominio devuelve error', () => {
    expect(validarDestinoPrueba('soporte')).toBe('El destino no es un email válido')
    expect(validarDestinoPrueba('soporte@hotel')).toBe('El destino no es un email válido')
    expect(validarDestinoPrueba('a b@hotel.com')).toBe('El destino no es un email válido')
  })

  it('email válido devuelve null (con espacios alrededor también)', () => {
    expect(validarDestinoPrueba('soporte@hotel.com')).toBeNull()
    expect(validarDestinoPrueba('  soporte@hotel.com  ')).toBeNull()
  })
})

describe('destinoPruebaPorDefecto', () => {
  it('prefiere el email de soporte si es válido', () => {
    expect(destinoPruebaPorDefecto('soporte@hotel.com', 'noreply@hotel.com')).toBe('soporte@hotel.com')
  })

  it('cae al remitente si el de soporte falta o es inválido', () => {
    expect(destinoPruebaPorDefecto('', 'noreply@hotel.com')).toBe('noreply@hotel.com')
    expect(destinoPruebaPorDefecto('sin-arroba', 'noreply@hotel.com')).toBe('noreply@hotel.com')
  })

  it('sin ninguno válido devuelve vacío', () => {
    expect(destinoPruebaPorDefecto('', '')).toBe('')
    expect(destinoPruebaPorDefecto('x', 'y@z')).toBe('')
  })
})

describe('mensajeResultadoPrueba', () => {
  it('indica el proveedor y el destino', () => {
    expect(mensajeResultadoPrueba('resend', 'a@b.co')).toBe('Enviado vía resend a a@b.co')
    expect(mensajeResultadoPrueba('smtp', 'a@b.co')).toBe('Enviado vía smtp a a@b.co')
  })
})
