import { captionExcerpt, pointFromClick } from '../../packages/desktop/src/lib/excerpt.ts'

it('counts code points, not UTF-16 units', () => {
  expect(captionExcerpt('Oi 👋 mundo', 6, 11)).toEqual({ text_start: 5, text_end: 10, quote: 'mundo' })
  expect(captionExcerpt('Oi 👋 mundo', 3, 5)).toEqual({ text_start: 3, text_end: 4, quote: '👋' })
})

it('an empty selection is null', () => {
  expect(captionExcerpt('Oi 👋 mundo', 6, 6)).toBeNull()
})

it('rejects invalid offsets and selections that split a surrogate pair', () => {
  for (const [start, end] of [[-1, 2], [3, 2], [0, 12], [0.5, 2], [NaN, 2], [3, 4], [4, 5]]) {
    expect(captionExcerpt('Oi 👋 mundo', start!, end!)).toBeNull()
  }
})

it('pointFromClick returns proportions clamped to the image', () => {
  const rect = { left: 100, top: 50, width: 200, height: 100 }
  expect(pointFromClick(rect, 150, 100)).toEqual({ x: 0.25, y: 0.5 })
  expect(pointFromClick(rect, -100, 200)).toEqual({ x: 0, y: 1 })
  expect(pointFromClick(rect, 500, 0)).toEqual({ x: 1, y: 0 })
  expect(pointFromClick(rect, 123.456, 83.3333)).toEqual({ x: 0.1173, y: 0.3333 })
})
