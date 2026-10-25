import { createLogger } from '../../packages/executor/src/log.ts'

it('writes one JSON line per call with level, msg, time and fields', () => {
  const lines: string[] = []
  const log = createLogger((line) => lines.push(line))
  log.info('started', { pieceId: 'p1' })
  log.warn('slow')
  log.error('failed', { code: 'x' })
  const parsed = lines.map((l) => JSON.parse(l))
  expect(parsed).toMatchObject([
    { level: 'info', msg: 'started', pieceId: 'p1' },
    { level: 'warn', msg: 'slow' },
    { level: 'error', msg: 'failed', code: 'x' },
  ])
  expect(Number.isNaN(Date.parse(parsed[0].time))).toBe(false)
  expect(lines.every((l) => !l.includes('\n'))).toBe(true)
})

it('fields cannot overwrite level, msg or time', () => {
  const lines: string[] = []
  createLogger((line) => lines.push(line)).info('real', { level: 'error', msg: 'fake', time: 'never' })
  expect(JSON.parse(lines[0]!)).toMatchObject({ level: 'info', msg: 'real' })
  expect(JSON.parse(lines[0]!).time).not.toBe('never')
})
