/**
 * GENERATED CODE - DO NOT MODIFY
 */
import { HeadersMap, XRPCError } from '@atproto/xrpc'
import { type ValidationResult, BlobRef } from '@atproto/lexicon'
import { CID } from 'multiformats/cid'
import { validate as _validate } from '../../../../lexicons.js'
import {
  type $Typed,
  is$typed as _is$typed,
  type OmitKey,
} from '../../../../util.js'
import type * as ToolsOzoneReportDefs from './defs.js'

const is$typed = _is$typed,
  validate = _validate
const id = 'tools.ozone.report.queryActivities'

export type QueryParams = {
  /** Filter to specific activity types (e.g. closeActivity, escalationActivity). If omitted, all types are returned. */
  activityTypes?: string[]
  /** Retrieve activities created at or after a given timestamp */
  createdAfter?: string
  /** Retrieve activities created at or before a given timestamp */
  createdBefore?: string
  sortDirection?: 'asc' | 'desc'
  limit?: number
  /** Cursor of the form `<createdAtMs>::<activityId>`. */
  cursor?: string
}
export type InputSchema = undefined

export interface OutputSchema {
  activities: ToolsOzoneReportDefs.ReportActivityView[]
  cursor?: string
}

export interface CallOptions {
  signal?: AbortSignal
  headers?: HeadersMap
}

export interface Response {
  success: boolean
  headers: HeadersMap
  data: OutputSchema
}

export function toKnownErr(e: any) {
  return e
}
