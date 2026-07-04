import { l } from '@atproto/lex-schema'

export const nuxSchema = l.object({
  id: l.string({ maxLength: 64 }),
  completed: l.boolean(),
  data: l.optional(l.string({ maxLength: 300 })),
  expiresAt: l.optional(l.string({ format: 'datetime' })),
})

export type Nux = l.Infer<typeof nuxSchema>

export function validateNux(nux: unknown): asserts nux is Nux {
  nuxSchema.check(nux)
  const allowedKeys = new Set(['id', 'completed', 'data', 'expiresAt'])
  for (const key of Object.keys(nux as object)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Unexpected property on nux: ${key}`)
    }
  }
}
