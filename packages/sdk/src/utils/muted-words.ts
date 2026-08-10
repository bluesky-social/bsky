export function sanitizeMutedWordValue(value: string) {
  return (
    value
      .trim()
      .replace(/^#(?!\ufe0f)/, '')
      // eslint-disable-next-line no-misleading-character-class
      .replace(/[\r\n\u00AD\u2060\u200D\u200C\u200B]+/, '')
  )
}
