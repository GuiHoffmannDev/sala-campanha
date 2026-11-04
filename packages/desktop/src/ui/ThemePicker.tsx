import { useState } from 'react'
import { loadTheme, saveTheme, type ThemeChoice } from '../lib/theme.ts'

const OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
]

// Native radios give arrow-key navigation and screen reader support; CSS draws them as a segmented control.
export function ThemePicker() {
  const [choice, setChoice] = useState(loadTheme)

  function choose(value: ThemeChoice) {
    setChoice(value)
    saveTheme(value)
  }

  return (
    <fieldset className="theme-picker">
      <legend>Theme</legend>
      {OPTIONS.map((o) => (
        <label key={o.value}>
          <input
            type="radio" name="theme" value={o.value}
            checked={choice === o.value} onChange={() => choose(o.value)}
          />
          <span>{o.label}</span>
        </label>
      ))}
    </fieldset>
  )
}
