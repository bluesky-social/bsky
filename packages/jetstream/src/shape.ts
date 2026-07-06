// src/shape.ts
import { type RecordSchema } from '@atproto/lex-schema'
import { typedEventFromRaw } from './decode-typed.js'
import { type EventBatch, type RawEventV1, type TypedEvent } from './event.js'

export interface ShapeFlags {
  raw?: boolean
}

export async function* shape(
  src: AsyncIterable<EventBatch<RawEventV1>>,
  flags: ShapeFlags,
  schemasByNsid: Map<string, RecordSchema>,
): AsyncGenerator<RawEventV1 | TypedEvent> {
  const raw = flags.raw === true
  for await (const batch of src) {
    if (raw) {
      for (const e of batch.events) yield e
    } else {
      for (const e of batch.events) yield typedEventFromRaw(e, schemasByNsid)
    }
  }
}
