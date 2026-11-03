import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useState, type ReactNode } from 'react'
import {
  displayNameOf, finishOAuth, oauthUrl, saveDisplayName, sendLoginCode, verifyLoginCode,
} from '../data/auth.ts'
import { resolveRoute } from '../data/campaigns.ts'
import { friendlyError } from '../data/errors.ts'
import { acceptInvites, createWorkspace, loadMyMemberships, type Membership } from '../data/team.ts'
import { parseAuthCallback, parseLink, type Route } from '../lib/link.ts'
import { loadStoredWorkspace, pickWorkspace, storeWorkspace } from '../lib/workspace.ts'
import { onDeepLink, openExternal } from '../native.ts'
import { LoginScreen } from './LoginScreen.tsx'
import { Onboarding } from './Onboarding.tsx'
import { Shell } from './Shell.tsx'

// What the app knows about the signed-in person's workspaces. `userId` ties it
// to one person, so a later sign-in never shows the previous person's data.
type Workspaces =
  | { userId: string; step: 'loading' }
  | { userId: string; step: 'failed'; message: string }
  | { userId: string; step: 'none' }
  | { userId: string; step: 'ready'; memberships: Membership[] }

const NO_ROUTE: Route = { campaignId: null, pieceId: null }

export function App({ client }: { client: SupabaseClient }) {
  // undefined until the stored session is read.
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspaces | null>(null)
  const [attempt, setAttempt] = useState(0)
  // The workspace the person picked in this session; null falls back to the stored one.
  const [chosenTeam, setChosenTeam] = useState<string | null>(null)
  const [route, setRoute] = useState<Route>(NO_ROUTE)
  // A share link waits here until the person is signed in and their workspaces are loaded.
  const [pendingLink, setPendingLink] = useState<Route | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    const { data } = client.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      // Once signed in, an earlier sign-in error is over; it must not come back after signing out.
      if (s) setLoginError(null)
    })
    return () => data.subscription.unsubscribe()
  }, [client])

  // Google and Apple come back through `sala://auth/callback`. Share links open a campaign or piece.
  useEffect(() => {
    let active = true
    let stop: (() => void) | undefined
    onDeepLink((url) => {
      if (!active) return
      const callback = parseAuthCallback(url)
      if (!callback) {
        const link = parseLink(url)
        if (link) setPendingLink(link)
        return
      }
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
  const memberships = workspaces?.step === 'ready' && workspaces.userId === userId ? workspaces.memberships : null
  const teamId = memberships ? pickWorkspace(memberships, chosenTeam ?? loadStoredWorkspace()) : null

  // Another person signing in starts from their own stored workspace, with nothing open and no old notice.
  useEffect(() => {
    setChosenTeam(null)
    setRoute(NO_ROUTE)
    setNotice(null)
  }, [userId])

  function openWorkspace(id: string) {
    setChosenTeam(id)
    storeWorkspace(id)
    setRoute(NO_ROUTE)
  }

  // A share link opens once the workspaces are loaded, switching to the link's workspace.
  useEffect(() => {
    if (!pendingLink || !memberships) return
    let active = true
    resolveRoute(client, pendingLink).then(
      (resolved) => {
        if (!active) return
        setPendingLink(null)
        setNotice(resolved.notice)
        // A link the person cannot open leaves what they had open in place.
        if (resolved.notice) return
        if (resolved.teamId) {
          openWorkspace(resolved.teamId)
          // Added to that workspace after the list loaded: load it again.
          if (!memberships.some((m) => m.teamId === resolved.teamId)) setAttempt((n) => n + 1)
        }
        setRoute(resolved.route)
      },
      (e: unknown) => {
        if (!active) return
        setPendingLink(null)
        setNotice(friendlyError(e))
      },
    )
    return () => {
      active = false
    }
  }, [client, pendingLink, memberships])

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

  async function addWorkspace(workspaceName: string) {
    openWorkspace(await createWorkspace(client, workspaceName, name ?? ''))
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
    content = <Onboarding step="name" suggestedName="" onSaveName={saveName} onCreateWorkspace={addWorkspace} />
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
    content = <Onboarding step="workspace" suggestedName={name} onSaveName={saveName} onCreateWorkspace={addWorkspace} />
  } else if (memberships && teamId) {
    return (
      <div className="app-shell">
        {/* Always present, so screen readers announce a notice as soon as it appears. */}
        <div role="alert">
          {notice && (
            <button type="button" className="notice" onClick={() => setNotice(null)}>{notice}</button>
          )}
        </div>
        <Shell
          client={client} memberships={memberships} teamId={teamId} route={route} onNavigate={setRoute}
          onSwitchWorkspace={openWorkspace} onCreateWorkspace={addWorkspace}
          onMembershipChange={() => setAttempt((n) => n + 1)}
        />
      </div>
    )
  } else {
    content = <p>Carregando…</p>
  }

  return (
    <main className="app">
      <header className="app-header">
        <h1>Sala da Campanha</h1>
      </header>
      {content}
    </main>
  )
}
