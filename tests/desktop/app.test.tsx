// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { App } from '../../packages/desktop/src/ui/App.tsx'

it('renders the app title', () => {
  render(<App />)
  expect(screen.getByText('Sala da Campanha')).toBeTruthy()
})
