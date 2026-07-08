import { l } from '@atproto/lex-schema'
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
import { isTypeOf } from './types.js'

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
 * Returns the first matched region configuration based on the provided geolocation.
 */
export function getAgeAssuranceRegionConfig(
  config: Config,
  geolocation: {
    countryCode: string
    regionCode?: string
  },
): ConfigRegion | undefined {
  const { regions } = config
  return regions.find(({ countryCode, regionCode }) => {
    if (countryCode === geolocation.countryCode) {
      return !regionCode || regionCode === geolocation.regionCode
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
    if (isTypeOf(defs.configRegionRuleIfAccountNewerThan, rule)) {
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
    } else if (isTypeOf(defs.configRegionRuleIfAccountOlderThan, rule)) {
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
    } else if (isTypeOf(defs.configRegionRuleIfDeclaredOverAge, rule)) {
      if (data?.declaredAge !== undefined && data.declaredAge >= rule.age) {
        return {
          access: rule.access,
          reason: rule.$type,
        }
      }
    } else if (isTypeOf(defs.configRegionRuleIfDeclaredUnderAge, rule)) {
      if (data?.declaredAge !== undefined && data.declaredAge < rule.age) {
        return {
          access: rule.access,
          reason: rule.$type,
        }
      }
    } else if (isTypeOf(defs.configRegionRuleIfAssuredOverAge, rule)) {
      if (data?.assuredAge && data.assuredAge >= rule.age) {
        return {
          access: rule.access,
          reason: rule.$type,
        }
      }
    } else if (isTypeOf(defs.configRegionRuleIfAssuredUnderAge, rule)) {
      if (data?.assuredAge && data.assuredAge < rule.age) {
        return {
          access: rule.access,
          reason: rule.$type,
        }
      }
    } else if (isTypeOf(defs.configRegionRuleDefault, rule)) {
      return {
        access: rule.access,
        reason: rule.$type,
      }
    }
  }
}
