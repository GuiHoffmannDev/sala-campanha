import { readFileSync } from 'node:fs'

// Reads the token values straight from app.css, so a later palette edit cannot break WCAG AA unnoticed.
const css = readFileSync(new URL('../../packages/desktop/src/app.css', import.meta.url), 'utf8')

function tokens(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map((m) => [m[1], m[2]]))
}

function blockAfter(selector: string): string {
  const start = css.indexOf(selector)
  if (start < 0) throw new Error(`app.css has no ${selector} block`)
  return css.slice(start, css.indexOf('}', start))
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

const THEMES = {
  light: tokens(blockAfter(':root {')),
  'dark (Sistema)': tokens(blockAfter(':root:not([data-theme="light"])')),
  'dark (Escuro)': tokens(blockAfter(':root[data-theme="dark"]')),
}

// [foreground, backgrounds it is drawn on]
const PAIRS: [string, string[]][] = [
  ['text', ['bg', 'panel', 'surface']],
  ['text-muted', ['bg', 'panel', 'surface']],
  ['accent', ['bg', 'panel']],
  ['on-accent', ['accent-bg']],
  ['success', ['bg', 'panel']],
  ['warning', ['bg', 'panel']],
  ['danger', ['bg', 'panel']],
]

it('both dark blocks hold the same values', () => {
  expect(THEMES['dark (Escuro)']).toEqual(THEMES['dark (Sistema)'])
})

for (const [theme, t] of Object.entries(THEMES)) {
  it(`${theme} text tokens reach 4.5:1 on their backgrounds`, () => {
    for (const [fg, bgs] of PAIRS) {
      for (const bg of bgs) {
        expect(t[fg], `--${fg}`).toBeDefined()
        expect(t[bg], `--${bg}`).toBeDefined()
        expect(contrast(t[fg]!, t[bg]!), `--${fg} on --${bg}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
}
