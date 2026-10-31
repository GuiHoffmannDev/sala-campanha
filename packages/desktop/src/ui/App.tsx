import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useState, type ReactNode } from 'react'
import {
  displayNameOf, finishOAuth, oauthUrl, saveDisplayName, sendLoginCode, verifyLoginCode,
} from '../data/auth.ts'
import { friendlyError } from '../data/errors.ts'
import { acceptInvites, createWorkspace, loadMyMemberships, type Membership } from '../data/team.ts'
import { parseAuthCallback } from '../lib/link.ts'
import { onDeepLink, openExternal } from '../native.ts'
import { LoginScreen } from './LoginScreen.tsx'
import { Onboarding } from './Onboarding.tsx'
import { ThemePicker } from './ThemePicker.tsx'

// What the app knows about the signed-in person's workspaces. `userId` ties it
// to one person, so a later sign-in never shows the previous person's data.
type Workspaces =
  | { userId: string; step: 'loading' }
  | { userId: string; step: 'failed'; message: string }
  | { userId: string; step: 'none' }
  | { userId: string; step: 'ready'; memberships: Membership[] }

export function App({ client }: { client: SupabaseClient }) {
  // undefined until the stored session is read.
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspaces | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const { data } = client.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      // Once signed in, an earlier sign-in error is over; it must not come back after signing out.
      if (s) setLoginError(null)
    })
    return () => data.subscription.unsubscribe()
  }, [client])

  // Google and Apple come back through `sala://auth/callback`. Other links are navigation (Task 5).
  useEffect(() => {
    let active = true
    let stop: (() => void) | undefined
    onDeepLink((url) => {
      if (!active) return
      const callback = parseAuthCallback(url)
      if (!callback) return
      if ('code' in callback) {
        finishOAuth(client, callback.code, callback.flowId).catch((e: unknown) => setLoginError(friendlyError(e)))
      } else {
        setLoginError('Não foi possível entrar. Tente de novo.')
      }
    }).then(
      (unlisten) => {
        if (active) stop = unlisten
        else unlisten()
      },
      (e: unknown) => console.error('could not listen for sala:// links', e),
    )
    return () => {
      active = false
      stop?.()
    }
  }, [client])

  const userId = session?.user.id
  const name = session ? displayNameOf(session.user) : null

  // On every app start and sign-in: accept pending invites, then load the workspaces.
  useEffect(() => {
    if (!userId || !name) return
    let active = true
    setWorkspaces({ userId, step: 'loading' })
    acceptInvites(client, name)
      .then(() => loadMyMemberships(client))
      .then((memberships) => {
        if (active) setWorkspaces(memberships.length ? { userId, step: 'ready', memberships } : { userId, step: 'none' })
      })
      .catch((e: unknown) => {
        if (active) setWorkspaces({ userId, step: 'failed', message: friendlyError(e) })
      })
    return () => {
      active = false
    }
  }, [client, userId, name, attempt])

  async function startOAuth(provider: 'google' | 'apple') {
    setLoginError(null)
    await openExternal(await oauthUrl(client, provider))
  }

  async function createFirstWorkspace(workspaceName: string) {
    await createWorkspace(client, workspaceName, name ?? '')
    // Reload through the effect, so a failed reload offers "Tentar de novo" instead of a second workspace.
    setAttempt((n) => n + 1)
  }

  const saveName = (n: string) => saveDisplayName(client, n)

  let content: ReactNode
  if (session === undefined) {
    content = <p>Carregando…</p>
  } else if (!session) {
    content = (
      <LoginScreen
        sendCode={(email) => {
          setLoginError(null)
          return sendLoginCode(client, email)
        }}
        verifyCode={(email, code) => {
          setLoginError(null)
          return verifyLoginCode(client, email, code)
        }}
        startOAuth={startOAuth}
        error={loginError}
      />
    )
  } else if (!name) {
    content = <Onboarding step="name" suggestedName="" onSaveName={saveName} onCreateWorkspace={createFirstWorkspace} />
  } else if (!workspaces || workspaces.userId !== userId || workspaces.step === 'loading') {
    content = <p>Carregando…</p>
  } else if (workspaces.step === 'failed') {
    content = (
      <>
        <p role="alert">{workspaces.message}</p>
        <button type="button" onClick={() => setAttempt((n) => n + 1)}>Tentar de novo</button>
      </>
    )
  } else if (workspaces.step === 'none') {
    content = <Onboarding step="workspace" suggestedName={name} onSaveName={saveName} onCreateWorkspace={createFirstWorkspace} />
  } else {
    // The Shell (Task 5) replaces this line.
    content = <p>{workspaces.memberships[0]?.teamName}</p>
  }

  return (
    <main className="app">
      {/* The picker moves to the sidebar footer with the Shell (Task 5). */}
      <header className="app-header">
        <h1>Sala da Campanha</h1>
        <ThemePicker />
      </header>
      {content}
    </main>
  )
}
