/** Convert DOM UTF-16 offsets to the code point offsets stored by the server. */
export function captionExcerpt(caption: string, startUtf16: number, endUtf16: number):
  { text_start: number; text_end: number; quote: string } | null {
  if (!Number.isInteger(startUtf16) || !Number.isInteger(endUtf16) || startUtf16 < 0 ||
    endUtf16 > caption.length || endUtf16 <= startUtf16) return null
  const boundary = (offset: number) => offset === 0 || offset === caption.length ||
    !(caption.charCodeAt(offset - 1) >= 0xD800 && caption.charCodeAt(offset - 1) <= 0xDBFF &&
      caption.charCodeAt(offset) >= 0xDC00 && caption.charCodeAt(offset) <= 0xDFFF)
  if (!boundary(startUtf16) || !boundary(endUtf16)) return null
  return { text_start: Array.from(caption.slice(0, startUtf16)).length,
    text_end: Array.from(caption.slice(0, endUtf16)).length, quote: caption.slice(startUtf16, endUtf16) }
}

export function pointFromClick(
  rect: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number,
): { x: number; y: number } {
  const proportion = (distance: number, size: number) =>
    Math.round(Math.min(1, Math.max(0, size > 0 ? distance / size : 0)) * 10_000) / 10_000
  return { x: proportion(clientX - rect.left, rect.width), y: proportion(clientY - rect.top, rect.height) }
}
