// site-pages/validators/schema.ts — Validación de entrada POST/PUT.
// Enums y regex de slug los valida el service (validateSchema no soporta pattern/enum),
// mismo reparto de responsabilidades que facturas (schema = forma; usecase = reglas).
import type { ValidationRule } from 'arckode-framework'

export const CreateSitePageSchema: Record<string, ValidationRule> = {
  slug: { type: 'string' as const, required: true, min: 1, max: 80 },
  title: { type: 'string' as const, required: true, min: 2, max: 160 },
  metaDescription: { type: 'string' as const, max: 320 },
  contentHtml: { type: 'string' as const },
  category: { type: 'string' as const, max: 20 },
  status: { type: 'string' as const, max: 20 },
  sortOrder: { type: 'number' as const, min: 0 },
}

export const UpdateSitePageSchema: Record<string, ValidationRule> = {
  slug: { type: 'string' as const, min: 1, max: 80 },
  title: { type: 'string' as const, min: 2, max: 160 },
  metaDescription: { type: 'string' as const, max: 320 },
  contentHtml: { type: 'string' as const },
  category: { type: 'string' as const, max: 20 },
  status: { type: 'string' as const, max: 20 },
  sortOrder: { type: 'number' as const, min: 0 },
}

export const SitePagesValidator = { create: CreateSitePageSchema, update: UpdateSitePageSchema }
