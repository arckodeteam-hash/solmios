// usuarios/validators/schema.ts — Validación de entrada
import type { ValidationRule } from 'arckode-framework'

export const CreateUsuarioSchema: Record<string, ValidationRule> = {
    name: { type: 'string', required: true, min: 2, max: 100 },
  email: { type: 'string', required: true, min: 5, max: 200 },
  password: { type: 'string', required: true, min: 6, max: 100 },
  role: { type: 'string', max: 50 },
  hotelId: { type: 'string', max: 100 },
  phone: { type: 'string', max: 30 },
}

export const UpdateUsuarioSchema: Record<string, ValidationRule> = {
    name: { type: 'string', min: 2, max: 100 },
  email: { type: 'string', min: 5, max: 200 },
  password: { type: 'string', min: 6, max: 100 },
  role: { type: 'string', max: 50 },
  phone: { type: 'string', max: 30 },
    active: { type: 'number' },
}

export const UsuarioValidator = { create: CreateUsuarioSchema, update: UpdateUsuarioSchema }

/**
 * Perfil propio. Deliberadamente NO acepta `role`, `hotelId`, `email` ni
 * `password`: cambiar el rol o el hotel sería escalar privilegios, el email es
 * la credencial de login, y la contraseña tiene su endpoint con la actual.
 */
export const UpdateProfileSchema: Record<string, ValidationRule> = {
  name: { type: 'string' as const, min: 2, max: 100 },
  phone: { type: 'string' as const, max: 30 },
  avatar: { type: 'string' as const, max: 500 },
}

export const LoginSchema: Record<string, ValidationRule> = {
  email: { type: 'string' as const, required: true, max: 200 },
  password: { type: 'string' as const, required: true, max: 200 },
  // Token del captcha: opcional en el schema porque se exige (o no) según lo que el super-admin
  // haya prendido para el login — la ruta lo verifica antes de llegar acá.
  captchaToken: { type: 'string' as const, max: 4096 },
}

export const ChangePasswordSchema: Record<string, ValidationRule> = {
  currentPassword: { type: 'string' as const, required: true },
  newPassword: { type: 'string' as const, required: true, min: 6 },
}

export const ForgotPasswordSchema: Record<string, ValidationRule> = {
  email: { type: 'string' as const, required: true },
}

export const ResetPasswordSchema: Record<string, ValidationRule> = {
  token: { type: 'string' as const, required: true },
  newPassword: { type: 'string' as const, required: true, min: 6 },
}
