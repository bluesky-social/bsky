/** Event kind codes as stored in segment rows. */
export const SegKind = {
  Create: 1,
  Update: 2,
  Delete: 3,
  Identity: 4,
  Account: 5,
  Sync: 6,
  CreateResync: 7,
} as const

export type SegKind = (typeof SegKind)[keyof typeof SegKind]

export function isValidKind(n: number): boolean {
  return n >= SegKind.Create && n <= SegKind.CreateResync
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
