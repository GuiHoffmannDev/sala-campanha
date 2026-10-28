/** File signatures: an image's type comes from these bytes, never from a declared label. */
export const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
export const JPEG = [0xff, 0xd8, 0xff, 0xe0]
export const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50] // RIFF....WEBP
export const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] // GIF89a

/** `size` bytes that start with `sig` and are zero after it. */
export function file(sig: number[], size = 64): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(size)
  b.set(sig)
  return b
}
