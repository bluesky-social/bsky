import { type l } from '@atproto/lex'
import type {
  Access,
  Config,
  ConfigRegion,
  ConfigRegionRuleDefault,
  ConfigRegionRuleIfAccountNewerThan,
  ConfigRegionRuleIfAccountOlderThan,
  ConfigRegionRuleIfAssuredOverAge,
  ConfigRegionRuleIfAssuredUnderAge,
  ConfigRegionRuleIfDeclaredOverAge,
  ConfigRegionRuleIfDeclaredUnderAge,
} from '../lexicons/app/bsky/ageassurance/defs.defs.js'
import { app } from '../lexicons/index.js'
import { is$typedObject } from './types.js'

const defs = app.bsky.ageassurance.defs

export type AgeAssuranceRuleID =
  | l.$TypeOf<ConfigRegionRuleDefault>
  | l.$TypeOf<ConfigRegionRuleIfDeclaredOverAge>
  | l.$TypeOf<ConfigRegionRuleIfDeclaredUnderAge>
  | l.$TypeOf<ConfigRegionRuleIfAssuredOverAge>
  | l.$TypeOf<ConfigRegionRuleIfAssuredUnderAge>
  | l.$TypeOf<ConfigRegionRuleIfAccountNewerThan>
  | l.$TypeOf<ConfigRegionRuleIfAccountOlderThan>

export const ageAssuranceRuleIDs: Record<string, AgeAssuranceRuleID> = {
  Default: defs.configRegionRuleDefault.$type,
  IfDeclaredOverAge: defs.configRegionRuleIfDeclaredOverAge.$type,
  IfDeclaredUnderAge: defs.configRegionRuleIfDeclaredUnderAge.$type,
  IfAssuredOverAge: defs.configRegionRuleIfAssuredOverAge.$type,
  IfAssuredUnderAge: defs.configRegionRuleIfAssuredUnderAge.$type,
  IfAccountNewerThan: defs.configRegionRuleIfAccountNewerThan.$type,
  IfAccountOlderThan: defs.configRegionRuleIfAccountOlderThan.$type,
}

/**
 * Returns the first matched region configuration based on the provided
 * filters. Region configurations that declare `platforms` only match when the
 * provided platform is included in that list. If no platform filter is
 * provided, platform restrictions are ignored.
 */
export function getAgeAssuranceRegionConfig(
  config: Config,
  filters: {
    countryCode: string
    regionCode?: string
    platform?: string
  },
): ConfigRegion | undefined {
  const { regions } = config
  return regions.find(({ countryCode, regionCode, platforms }) => {
    if (
      filters.platform &&
      platforms?.length &&
      !platforms.includes(filters.platform)
    ) {
      return false
    }
    if (countryCode === filters.countryCode) {
      return !regionCode || regionCode === filters.regionCode
    }
  })
}

export function computeAgeAssuranceRegionAccess(
  region: ConfigRegion,
  data:
    | {
        /**
         * The account creation date in ISO 8601 format. Only checked if we
         * don't have an assured age, such as on the client.
         */
        accountCreatedAt?: string
        /**
         * The user's declared age
         */
        declaredAge?: number
        /**
         * The user's minimum age as assured by a trusted third party.
         */
        assuredAge?: number
      }
    | undefined,
):
  | {
      access: Access
      reason: AgeAssuranceRuleID
    }
  | undefined {
  // first match wins
  for (const rule of region.rules) {
    if (is$typedObject(rule, defs.configRegionRuleIfAccountNewerThan.$type)) {
      if (data?.accountCreatedAt && !data?.assuredAge) {
        const accountCreatedAt = new Date(data.accountCreatedAt)
        const threshold = new Date(rule.date)
        if (accountCreatedAt >= threshold) {
          return {
            access: rule.access,
            reason: rule.$type,
          }
        }
      }
    } else if (
      is$typedObject(rule, defs.configRegionRuleIfAccountOlderThan.$type)
    ) {
      if (data?.accountCreatedAt && !data?.assuredAge) {
        const accountCreatedAt = new Date(data.accountCreatedAt)
        const threshold = new Date(rule.date)
        if (accountCreatedAt < threshold) {
          return {
            access: rule.access,
            reason: rule.$type,
          }
        }
      }
    } else if (
      is$typedObject(rule, defs.configRegionRuleIfDeclaredOverAge.$type)
    ) {
      if (data?.declaredAge !== undefined && data.declaredAge >= rule.age) {
        return {
          access: rule.access,
          reason: rule.$type,
        }
      }
    } else if (
      is$typedObject(rule, defs.configRegionRuleIfDeclaredUnderAge.$type)
    ) {
      if (data?.declaredAge !== undefined && data.declaredAge < rule.age) {
        return {
          access: rule.access,
          reason: rule.$type,
        }
      }
    } else if (
      is$typedObject(rule, defs.configRegionRuleIfAssuredOverAge.$type)
    ) {
      if (data?.assuredAge && data.assuredAge >= rule.age) {
        return {
          access: rule.access,
          reason: rule.$type,
        }
      }
    } else if (
      is$typedObject(rule, defs.configRegionRuleIfAssuredUnderAge.$type)
    ) {
      if (data?.assuredAge && data.assuredAge < rule.age) {
        return {
          access: rule.access,
          reason: rule.$type,
        }
      }
    } else if (is$typedObject(rule, defs.configRegionRuleDefault.$type)) {
      return {
        access: rule.access,
        reason: rule.$type,
      }
    }
  }
}
