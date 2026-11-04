import { checkImageFile, newImagePath } from '../../packages/desktop/src/data/files.ts'

it('rejects files the bucket refuses', () => {
  for (const type of ['application/pdf', 'image/heic']) {
    expect(checkImageFile({ type, size: 10 })).toBe('Use a PNG, JPG or WebP image.')
  }
  expect(checkImageFile({ type: 'image/png', size: 26_214_401 })).toBe('The image is larger than 25 MB.')
})

it('accepts a PNG at the limit', () => {
  expect(checkImageFile({ type: 'image/png', size: 26_214_400 })).toBeNull()
})

it("newImagePath is lowercase with the type's extension", () => {
  const team = 'AAAAAAAA-AAAA-4AAA-AAAA-AAAAAAAAAAAA'
  const folder = 'BBBBBBBB-BBBB-4BBB-BBBB-BBBBBBBBBBBB'
  for (const [type, extension] of [['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp']]) {
    const path = newImagePath(team, folder, type!)
    expect(path).toMatch(new RegExp(`^${team.toLowerCase()}/${folder.toLowerCase()}/[0-9a-f-]{36}\\.${extension}$`))
    expect(newImagePath(team, folder, type!)).not.toBe(path)
  }
})
