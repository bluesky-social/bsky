import { l } from '@atproto/lex'

export const nuxSchema = /*#__PURE__*/ l.object({
  id: /*#__PURE__*/ l.string({ maxLength: 64 }),
  completed: /*#__PURE__*/ l.boolean(),
  data: /*#__PURE__*/ l.optional(/*#__PURE__*/ l.string({ maxLength: 300 })),
  expiresAt: /*#__PURE__*/ l.optional(
    /*#__PURE__*/ l.string({ format: 'datetime' }),
  ),
})

export type Nux = l.Infer<typeof nuxSchema>

export function validateNux(nux: unknown): asserts nux is Nux {
  nuxSchema.check(nux)
  const allowedKeys = new Set(['id', 'completed', 'data', 'expiresAt'])
  // Object.keys requires object; value already validated by schema check above
  for (const key of Object.keys(nux as object)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Unexpected property on nux: ${key}`)
    }
  }
}
