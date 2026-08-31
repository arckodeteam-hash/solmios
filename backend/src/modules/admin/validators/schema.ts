import type { ValidationRule } from 'arckode-framework'

const arrayType = 'array' as any
const objectType = 'object' as any

export const CreatePlanSchema: Record<string, ValidationRule> = {
  name: { type: 'string' as const, required: true, min: 2, max: 100 },
  price: { type: 'number' as const, required: true, min: 0 },
  currency: { type: 'string' as const, min: 3, max: 3 },
  description: { type: 'string' as const, max: 500 },
  features: { type: arrayType },
  modules: { type: arrayType },
  limits: { type: objectType },
  isActive: { type: 'boolean' as const },
  sortOrder: { type: 'number' as const, min: 0 },
}

export const UpdatePlanSchema: Record<string, ValidationRule> = {
  name: { type: 'string' as const, min: 2, max: 100 },
  price: { type: 'number' as const, min: 0 },
  currency: { type: 'string' as const, min: 3, max: 3 },
  description: { type: 'string' as const, max: 500 },
  features: { type: arrayType },
  modules: { type: arrayType },
  limits: { type: objectType },
  isActive: { type: 'boolean' as const },
  sortOrder: { type: 'number' as const, min: 0 },
}

export const CreateAmenityCatalogSchema: Record<string, ValidationRule> = {
  key: { type: 'string' as const, required: true, min: 2, max: 80 },
  label: { type: 'string' as const, required: true, min: 2, max: 100 },
  category: { type: 'string' as const, max: 50 },
  icon: { type: 'string' as const, max: 50 },
  isActive: { type: 'boolean' as const },
  sortOrder: { type: 'number' as const, min: 0 },
}

export const UpdateAmenityCatalogSchema: Record<string, ValidationRule> = {
  key: { type: 'string' as const, min: 2, max: 80 },
  label: { type: 'string' as const, min: 2, max: 100 },
  category: { type: 'string' as const, max: 50 },
  icon: { type: 'string' as const, max: 50 },
  isActive: { type: 'boolean' as const },
  sortOrder: { type: 'number' as const, min: 0 },
}

// Update de hotel por el super_admin (plan/estado/datos). El `plan` se valida contra la tabla en el service.
export const UpdateHotelAdminSchema: Record<string, ValidationRule> = {
  name: { type: 'string' as const, min: 2, max: 120 },
  email: { type: 'string' as const, max: 160 },
  phone: { type: 'string' as const, max: 40 },
  location: { type: 'string' as const, max: 200 },
  plan: { type: 'string' as const, max: 40 },
  status: { type: 'string' as const, max: 20 },
}

// "Condiciones especiales" (PLAN-SUSCRIPCIONES.md §6/§8). `category` acepta null explícito
// (desasigna) — el framework no valida null en un string required=false, así que no se marca required.
export const ApplySpecialConditionsSchema: Record<string, ValidationRule> = {
  type: { type: 'string' as const, required: true, max: 20 }, // category | percentage | free_month
  category: { type: 'string' as const, max: 20 }, // founder_one | founder_two | pioneer
  discountPct: { type: 'number' as const, min: 0, max: 100 },
  durationMonths: { type: 'number' as const, min: 1, max: 60 },
  reason: { type: 'string' as const, max: 300 },
}

export const UpdateSpecialCategorySchema: Record<string, ValidationRule> = {
  totalSlots: { type: 'number' as const, min: 0 },
  discountPct: { type: 'number' as const, min: 0, max: 100 },
  minPlanSortOrder: { type: 'number' as const, min: 0 },
  sequenceGroup: { type: 'string' as const, max: 50 },
  opensAfter: { type: 'string' as const, max: 20 },
  status: { type: 'string' as const, max: 20 }, // closed | open | full
}

export const UpdateSubscriptionSettingsSchema: Record<string, ValidationRule> = {
  reminderDaysBefore: { type: 'number' as const, min: 0, max: 60 },
  gracePeriodDays: { type: 'number' as const, min: 0, max: 60 },
  founderChurnBlocksReturn: { type: 'boolean' as const },
  maxManualDiscountPct: { type: 'number' as const, min: 0, max: 100 },
  requireCardOnTrial: { type: 'boolean' as const },
  founderCountdownEnabled: { type: 'boolean' as const },
  founderCountdownDurationDays: { type: 'number' as const, min: 1, max: 3650 },
}

// Override por hotel de módulo (upsert). moduleKey se valida contra el catálogo en el service.
// status se valida contra 'enabled'|'disabled' en el service (validateSchema no tiene enum).
export const ModuleOverrideSchema: Record<string, ValidationRule> = {
  moduleKey: { type: 'string' as const, required: true, min: 2, max: 60 },
  status: { type: 'string' as const, required: true, max: 10 },
  reason: { type: 'string' as const, max: 300 },
  startsAt: { type: 'string' as const, max: 30 },
  endsAt: { type: 'string' as const, max: 30 },
}

export const AdminValidator = {
  createPlan: CreatePlanSchema,
  updatePlan: UpdatePlanSchema,
  createAmenityCatalog: CreateAmenityCatalogSchema,
  updateAmenityCatalog: UpdateAmenityCatalogSchema,
  applySpecialConditions: ApplySpecialConditionsSchema,
  updateSpecialCategory: UpdateSpecialCategorySchema,
  updateSubscriptionSettings: UpdateSubscriptionSettingsSchema,
}
