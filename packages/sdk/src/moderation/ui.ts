import { type ModerationCause } from './types.js'

export class ModerationUI {
  noOverride = false
  filters: ModerationCause[] = []
  blurs: ModerationCause[] = []
  alerts: ModerationCause[] = []
  informs: ModerationCause[] = []
  get filter(): boolean {
    return this.filters.length !== 0
  }
  get blur(): boolean {
    return this.blurs.length !== 0
  }
  get alert(): boolean {
    return this.alerts.length !== 0
  }
  get inform(): boolean {
    return this.informs.length !== 0
  }
}

/**
 * Merges multiple ModerationUI results into one, combining their causes and
 * preserving the strictest override behavior. Useful when a single UI element
 * is subject to multiple moderation decisions or contexts.
 */
export function mergeModUIResults(
  ...uis: (ModerationUI | undefined)[]
): ModerationUI {
  const merged = new ModerationUI()
  for (const ui of uis) {
    if (!ui) continue
    merged.noOverride = merged.noOverride || ui.noOverride
    merged.filters.push(...ui.filters)
    merged.blurs.push(...ui.blurs)
    merged.alerts.push(...ui.alerts)
    merged.informs.push(...ui.informs)
  }
  return merged
}
