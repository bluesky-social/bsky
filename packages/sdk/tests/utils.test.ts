import { describe, expect, it } from 'vitest'
import {
  computeAgeAssuranceRegionAccess,
  getAgeAssuranceRegionConfig,
  nuxSchema,
  sanitizeMutedWordValue,
  validateNux,
} from '../src/utils/index.js'

describe('sanitizeMutedWordValue', () => {
  it('strips leading hash and trims', () => {
    expect(sanitizeMutedWordValue('#tag ')).toBe('tag')
  })
  it('trims whitespace without hash', () => {
    expect(sanitizeMutedWordValue('  hello  ')).toBe('hello')
  })
  it('does not strip emoji-variant hash', () => {
    expect(sanitizeMutedWordValue('#️tag')).toBe('#️tag')
  })
})

describe('nux validation', () => {
  // Old zod schema: id max(64), data max(300) — no minLength on id
  const valid = { id: 'a'.repeat(10), completed: false }
  it('accepts a valid nux', () => {
    expect(() => validateNux(valid)).not.toThrow()
  })
  it('rejects overlong ids (>64 chars)', () => {
    expect(() => validateNux({ ...valid, id: 'a'.repeat(65) })).toThrow()
  })
  it('accepts max-length ids (64 chars)', () => {
    expect(() => validateNux({ ...valid, id: 'a'.repeat(64) })).not.toThrow()
  })
  it('rejects overlong data (>300 chars)', () => {
    expect(() => validateNux({ ...valid, data: 'x'.repeat(301) })).toThrow()
  })
  it('accepts max-length data (300 chars)', () => {
    expect(() => validateNux({ ...valid, data: 'x'.repeat(300) })).not.toThrow()
  })
  it('nuxSchema is exported', () => {
    expect(nuxSchema).toBeDefined()
  })
  it('rejects unknown properties', () => {
    expect(() =>
      validateNux({ id: 'test-nux', completed: false, extra: true }),
    ).toThrow()
  })
})

describe('age assurance', () => {
  it('matches region config by country and region', () => {
    const config = {
      $type: 'app.bsky.ageassurance.defs#config' as const,
      regions: [
        { countryCode: 'US', regionCode: 'TX', minAccessAge: 13, rules: [] },
        { countryCode: 'US', minAccessAge: 13, rules: [] },
      ],
    }
    expect(
      getAgeAssuranceRegionConfig(config as never, {
        countryCode: 'US',
        regionCode: 'TX',
      })?.regionCode,
    ).toBe('TX')
    expect(
      getAgeAssuranceRegionConfig(config as never, {
        countryCode: 'US',
        regionCode: 'CA',
      })?.regionCode,
    ).toBeUndefined()
  })

  describe('platform-restricted regions', () => {
    const config = {
      $type: 'app.bsky.ageassurance.defs#config' as const,
      regions: [
        {
          platforms: ['ios', 'android'],
          countryCode: 'US',
          regionCode: 'TX',
          minAccessAge: 18,
          rules: [],
        },
        { countryCode: 'US', minAccessAge: 13, rules: [] },
      ],
    }

    it('finds platform-restricted region when platform matches', () => {
      const result = getAgeAssuranceRegionConfig(config as never, {
        countryCode: 'US',
        regionCode: 'TX',
        platform: 'ios',
      })
      expect(result).toEqual({
        platforms: ['ios', 'android'],
        countryCode: 'US',
        regionCode: 'TX',
        minAccessAge: 18,
        rules: [],
      })
    })

    it('skips platform-restricted region when platform does not match', () => {
      const result = getAgeAssuranceRegionConfig(config as never, {
        countryCode: 'US',
        regionCode: 'TX',
        platform: 'web',
      })
      // falls through to the country-wide US config
      expect(result).toEqual({
        countryCode: 'US',
        minAccessAge: 13,
        rules: [],
      })
    })

    it('ignores platform restrictions when platform is not provided', () => {
      const result = getAgeAssuranceRegionConfig(config as never, {
        countryCode: 'US',
        regionCode: 'TX',
      })
      expect(result).toEqual({
        platforms: ['ios', 'android'],
        countryCode: 'US',
        regionCode: 'TX',
        minAccessAge: 18,
        rules: [],
      })
    })
  })

  it('computeAgeAssuranceRegionAccess applies default rule', () => {
    const region = {
      countryCode: 'US',
      minAccessAge: 13,
      rules: [
        {
          $type: 'app.bsky.ageassurance.defs#configRegionRuleDefault' as const,
          access: 'full' as const,
        },
      ],
    }
    const result = computeAgeAssuranceRegionAccess(region as never, undefined)
    expect(result?.access).toBe('full')
  })
})
