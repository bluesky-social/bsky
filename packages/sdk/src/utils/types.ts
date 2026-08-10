import type { $Type, $Typed, Unknown$TypedObject } from '@atproto/lex'

/**
 * The narrowing performed by {@link is$typedObject}: like lex-schema's
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
 * unrelated object silently "matches". This guard requires `$type` to be
 * present and equal to the schema's `$type` constant.
 *
 * @example
 * ```ts
 * prefs.find((p) => is$typedObject(p, adultContentPref.$type))
 * ```
 */
export function is$typedObject<
  TType extends $Type,
  TValue extends Record<string, unknown>,
>(value: TValue, $type: TType): value is TypedObject<TType, TValue> {
  return value.$type === $type
}
