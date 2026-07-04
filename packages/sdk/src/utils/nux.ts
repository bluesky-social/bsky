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
}
