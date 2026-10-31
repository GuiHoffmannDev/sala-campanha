import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './app.css'
import { createAppClient } from './data/client.ts'
import { readEnv } from './env.ts'
import { applyTheme, loadTheme } from './lib/theme.ts'
import { App } from './ui/App.tsx'

// Before the first render, so the first paint already uses the chosen theme.
applyTheme(loadTheme())

const root = document.getElementById('root')
if (!root) throw new Error('index.html has no #root element')

let app: ReactNode
try {
  const { supabaseUrl, anonKey } = readEnv({
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
  })
  app = <App client={createAppClient(supabaseUrl, anonKey)} />
} catch (e) {
  // Without the settings there is no app to show; say what is missing instead of a blank window.
  app = <p role="alert">{e instanceof Error ? e.message : String(e)}</p>
}

createRoot(root).render(<StrictMode>{app}</StrictMode>)
