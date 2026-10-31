// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { loadTheme } from '../../packages/desktop/src/lib/theme.ts'
import { ThemePicker } from '../../packages/desktop/src/ui/ThemePicker.tsx'

afterEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.theme
  vi.restoreAllMocks()
})

it('loadTheme falls back to system for missing, unknown or unreadable values', () => {
  expect(loadTheme()).toBe('system')
  localStorage.setItem('sala.theme', 'sepia')
  expect(loadTheme()).toBe('system')
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
  expect(loadTheme()).toBe('system')
})

it('choosing Escuro sets data-theme and remembers it', async () => {
  const user = userEvent.setup()
  render(<ThemePicker />)
  await user.click(screen.getByLabelText('Escuro'))
  expect(document.documentElement.dataset.theme).toBe('dark')
  expect(localStorage.getItem('sala.theme')).toBe('dark')
})

it('choosing Sistema removes data-theme', async () => {
  const user = userEvent.setup()
  localStorage.setItem('sala.theme', 'light')
  document.documentElement.dataset.theme = 'light'
  render(<ThemePicker />)
  await user.click(screen.getByLabelText('Sistema'))
  expect(document.documentElement.dataset.theme).toBeUndefined()
  expect(localStorage.getItem('sala.theme')).toBeNull()
})

it('the picker starts on the stored choice', () => {
  localStorage.setItem('sala.theme', 'light')
  render(<ThemePicker />)
  expect((screen.getByLabelText('Claro') as HTMLInputElement).checked).toBe(true)
  expect(screen.getByRole('group', { name: 'Tema' })).toBeTruthy()
})

it('still changes the theme when storage refuses to save', async () => {
  const user = userEvent.setup()
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
  render(<ThemePicker />)
  await user.click(screen.getByLabelText('Escuro'))
  expect(document.documentElement.dataset.theme).toBe('dark')
  expect((screen.getByLabelText('Escuro') as HTMLInputElement).checked).toBe(true)
})
