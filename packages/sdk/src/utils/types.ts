import type {
  $Type,
  $Typed,
  LexMap,
  TypedObjectSchema,
  Unknown$TypedObject,
  Validator,
} from '@atproto/lex'

/**
 * The narrowing performed by {@link isTypeOf}: like lex-schema's
 * `MaybeTypedObject` (the narrowing of `TypedObjectSchema.isTypeOf`), except
 * `$type` is required on the result rather than optional.
 */
export type TypedObject<
  TType extends $Type,
  TValue extends { $type?: unknown } = { $type?: unknown },
> = TValue extends { $type: TType }
  ? TValue
  : $Typed<Exclude<TValue, Unknown$TypedObject>, TType>

/**
 * Strict variant of `TypedObjectSchema.isTypeOf`, which we prefer because the
 * schema method matches when `$type` is missing — fine for discriminating
 * accurately-typed unions, but a footgun on imperfectly-typed data, where an
 * unrelated object silently "matches". This guard also requires `$type` to
 * be present.
 */
export function isTypeOf<
  TType extends $Type,
  TShape extends Validator<LexMap>,
  TValue extends Record<string, unknown>,
>(
  schema: TypedObjectSchema<TType, TShape>,
  value: TValue,
): value is TypedObject<TType, TValue> {
  return value.$type != null && schema.isTypeOf(value)
}
