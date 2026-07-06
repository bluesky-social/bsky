import { type Main, type RecordSchema, getMain } from '@atproto/lex-schema'

export type CollectionFilter = string | Main<RecordSchema>

export function resolveNsids(filters: CollectionFilter[]): {
  nsids: string[]
  schemasByNsid: Map<string, RecordSchema>
} {
  const nsids: string[] = []
  const schemasByNsid = new Map<string, RecordSchema>()
  for (const f of filters) {
    if (typeof f === 'string') {
      nsids.push(f)
    } else {
      const schema = getMain(f)
      nsids.push(schema.$type)
      schemasByNsid.set(schema.$type, schema)
    }
  }
  return { nsids, schemasByNsid }
}
