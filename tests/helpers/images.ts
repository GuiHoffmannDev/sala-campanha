import { crc32, deflateSync } from 'node:zlib'

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

/** A small solid-colour RGB PNG, built in memory so the test needs no fixture file. */
export function solidPng(size: number, [r, g, b]: [number, number, number]): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc32(body), body.length + 4)
    return out
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 2 // colour type: RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3).map((_, i) => [r, g, b][i % 3]!)])
  const pixels = Buffer.concat(Array.from({ length: size }, () => row))
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(pixels)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  )
}
