export interface CursorStore {
  load(): Promise<number | undefined>
  save(seq: number): Promise<void>
}

export class MemoryCursorStore implements CursorStore {
  private value: number | undefined
  async load(): Promise<number | undefined> {
    return this.value
  }
  async save(seq: number): Promise<void> {
    this.value = seq
  }
}
