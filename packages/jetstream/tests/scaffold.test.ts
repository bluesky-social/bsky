import { expect, test } from 'vitest'
import { PACKAGE_NAME } from '../src/version.js'

test('package wiring resolves', () => {
  expect(PACKAGE_NAME).toBe('@bsky.app/jetstream')
})
