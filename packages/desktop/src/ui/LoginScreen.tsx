import { useState, type FormEvent } from 'react'
import type { OAuthProvider } from '../data/auth.ts'
import { friendlyError } from '../data/errors.ts'

type Props = {
  sendCode(email: string): Promise<void>
  verifyCode(email: string, code: string): Promise<void>
  startOAuth(provider: OAuthProvider): Promise<void>
  /** A sign-in error that came back from the browser through `sala://auth/callback`. */
  error?: string | null
}

export function LoginScreen({ sendCode, verifyCode, startOAuth, error: callbackError = null }: Props) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [inBrowser, setInBrowser] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const shownError = error ?? callbackError

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  const oauth = (provider: OAuthProvider) => run(async () => {
    setInBrowser(false)
    await startOAuth(provider)
    setInBrowser(true)
  })

  function submitEmail(e: FormEvent) {
    e.preventDefault()
    void run(async () => {
      await sendCode(email.trim())
      setCodeSent(true)
    })
  }

  function submitCode(e: FormEvent) {
    e.preventDefault()
    void run(() => verifyCode(email.trim(), code))
  }

  function useOtherEmail() {
    setCodeSent(false)
    setCode('')
    setError(null)
  }

  return (
    <section className="login">
      <button type="button" disabled={busy} onClick={() => oauth('google')}>Entrar com Google</button>
      <button type="button" disabled={busy} onClick={() => oauth('apple')}>Entrar com Apple</button>
      {inBrowser && !shownError && <p>Continue no navegador…</p>}

      <p>ou entre com um código no e-mail</p>
      {codeSent ? (
        <form onSubmit={submitCode}>
          <p>{`Enviamos um código de 6 dígitos para ${email.trim()}.`}</p>
          <label>
            Código
            <input
              value={code} onChange={(e) => setCode(e.target.value)}
              inputMode="numeric" autoComplete="one-time-code" required autoFocus
            />
          </label>
          <button type="submit" disabled={busy}>Entrar</button>
          <button type="button" disabled={busy} onClick={useOtherEmail}>Usar outro e-mail</button>
        </form>
      ) : (
        <form onSubmit={submitEmail}>
          <label>
            E-mail
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </label>
          <button type="submit" disabled={busy}>Enviar código</button>
        </form>
      )}

      {shownError && <p role="alert">{shownError}</p>}
    </section>
  )
}
