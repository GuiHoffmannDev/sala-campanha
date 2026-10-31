// The person's theme choice. 'system' follows macOS through the CSS media query,
// so only an explicit choice sets `data-theme` on <html>.
export type ThemeChoice = 'light' | 'dark' | 'system'

const KEY = 'sala.theme'

/** The stored choice, or 'system' when nothing valid is stored or storage is unavailable. */
export function loadTheme(): ThemeChoice {
  try {
    const stored = localStorage.getItem(KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement
  if (choice === 'system') delete root.dataset.theme
  else root.dataset.theme = choice
}

/** Applies the choice and remembers it. A storage failure only loses the memory, never the change. */
export function saveTheme(choice: ThemeChoice): void {
  applyTheme(choice)
  try {
    if (choice === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, choice)
  } catch {
    // Private mode or blocked storage: the theme still changes for this session.
  }
}
