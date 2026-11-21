/** Event kind codes as stored in segment rows. */
export const SegKind = {
  Create: 1,
  Update: 2,
  Delete: 3,
  Identity: 4,
  Account: 5,
  Sync: 6,
  CreateResync: 7,
  /** Format 2 only: a service-owned space lifecycle marker. */
  Scope: 8,
} as const

export type SegKind = (typeof SegKind)[keyof typeof SegKind]

/** Whether `n` is a kind code the given segment format can carry. */
export function isValidKind(n: number, formatVersion: 1 | 2 = 1): boolean {
  const max = formatVersion === 2 ? SegKind.Scope : SegKind.CreateResync
  return n >= SegKind.Create && n <= max
}

export function isCommitKind(k: number): boolean {
  return (
    k === SegKind.Create ||
    k === SegKind.Update ||
    k === SegKind.Delete ||
    k === SegKind.CreateResync
  )
}

/** Commit kinds that carry a record payload (creates and updates). */
export function isMaterializationKind(k: number): boolean {
  return (
    k === SegKind.Create || k === SegKind.Update || k === SegKind.CreateResync
  )
}
