import { type Main, type RecordSchema, getMain } from '@atproto/lex-schema'

export interface SchemaCollectionFilter {
  collection: Main<RecordSchema>
  validateRecord?: boolean // default true
}

export type CollectionFilter =
  string | Main<RecordSchema> | SchemaCollectionFilter

// Discriminate the options form from schema shapes: a SchemaCollectionFilter
// has `collection` and never `main` (namespace form) or `$type` (bare
// schema); a lexicon namespace could plausibly export a def named
// `collection`, so the negative checks are load-bearing.
function isOptsFilter(f: CollectionFilter): f is SchemaCollectionFilter {
  return (
    typeof f !== 'string' &&
    'collection' in f &&
    !('main' in f) &&
    !('$type' in f)
  )
}

export function parseCollectionFilters(filters: readonly CollectionFilter[]): {
  nsids: string[]
  schemasByNsid: Map<string, RecordSchema>
} {
  const nsids: string[] = []
  const schemasByNsid = new Map<string, RecordSchema>()
  for (const f of filters) {
    if (typeof f === 'string') {
      nsids.push(f)
      continue
    }
    if (isOptsFilter(f)) {
      const schema = getMain(f.collection)
      nsids.push(schema.$type)
      // set only, never delete: another filter may have registered a
      // validating schema for the same NSID
      if (f.validateRecord !== false) schemasByNsid.set(schema.$type, schema)
      continue
    }
    const schema = getMain(f)
    nsids.push(schema.$type)
    schemasByNsid.set(schema.$type, schema)
  }
  return { nsids, schemasByNsid }
}
