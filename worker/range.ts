export type ParsedByteRange =
  | { valid: true; offset: number; length: number }
  | { valid: false }
  | null

/** Parse the single byte range supported by HTMLAudioElement and R2. */
export const parseByteRange = (header: string | null, size: number): ParsedByteRange => {
  if (!header) return null
  if (!Number.isSafeInteger(size) || size <= 0 || !header.startsWith('bytes=') || header.includes(',')) {
    return { valid: false }
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(header)
  if (!match || (!match[1] && !match[2])) return { valid: false }

  if (!match[1]) {
    const suffixLength = Number(match[2])
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { valid: false }
    const length = Math.min(suffixLength, size)
    return { valid: true, offset: size - length, length }
  }

  const offset = Number(match[1])
  const requestedEnd = match[2] ? Number(match[2]) : size - 1
  if (
    !Number.isSafeInteger(offset)
    || !Number.isSafeInteger(requestedEnd)
    || offset < 0
    || offset >= size
    || requestedEnd < offset
  ) {
    return { valid: false }
  }
  const end = Math.min(requestedEnd, size - 1)
  return { valid: true, offset, length: end - offset + 1 }
}
