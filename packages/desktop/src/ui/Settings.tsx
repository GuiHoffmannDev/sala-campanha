import { useId, useRef, useState } from 'react'
import { ROLES, type Provider, type Role } from '@sala/shared'
import { friendlyError } from '../data/errors.ts'
import { KEY_PROVIDERS, PROVIDER_LABELS, maskKey, type KeyRow } from '../data/keys.ts'
import type { Invite, Member } from '../data/team.ts'
import { ROLE_LABELS } from '../lib/labels.ts'
import { copyText } from '../native.ts'

type Props = {
  teamId: string
  keys: KeyRow[]
  members: Member[]
  invites: Invite[]
  me: string
  onSaveKey(provider: Provider, key: string): Promise<void>
  onDeleteKey(provider: Provider): Promise<void>
  onInvite(email: string, role: Role): Promise<void>
  onRevokeInvite(email: string): Promise<void>
  onSetRole(userId: string, role: Role): Promise<void>
  onRemove(userId: string): Promise<void>
}

export function Settings(props: Props) {
  const [tab, setTab] = useState(0)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const id = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('designer')
  const [invitedEmail, setInvitedEmail] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const invitation = invitedEmail
    ? `Invite created. Tell the person: download Sala da Campanha and sign in with ${invitedEmail}.` : null

  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError(null)
    try { await action() } catch (e) { setError(friendlyError(e)) } finally { setBusy(false) }
  }

  return <section className="workspace-settings" aria-label="Workspace settings">
    <h2>Workspace settings</h2>
    <div role="tablist" aria-label="Workspace settings">
      {['Keys', 'Members'].map((label, index) => <button key={label} type="button" role="tab"
        id={`${id}-tab-${index}`} aria-controls={`${id}-panel-${index}`} aria-selected={tab === index}
        tabIndex={tab === index ? 0 : -1} ref={(el) => { tabs.current[index] = el }}
        onClick={() => setTab(index)} onKeyDown={(e) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
          e.preventDefault()
          const next = e.key === 'Home' ? 0 : e.key === 'End' ? 1 : 1 - index
          setTab(next)
          tabs.current[next]?.focus()
        }}>{label}</button>)}
    </div>
    {error && <p role="alert">{error}</p>}
    <div role="tabpanel" id={`${id}-panel-0`} aria-labelledby={`${id}-tab-0`} hidden={tab !== 0}>
      {KEY_PROVIDERS.map((provider) => <KeyForm key={provider} provider={provider}
        row={props.keys.find((row) => row.provider === provider)} disabled={busy}
        onSave={(key) => run(() => props.onSaveKey(provider, key))}
        onDelete={() => run(() => props.onDeleteKey(provider))} />)}
    </div>
    <div role="tabpanel" id={`${id}-panel-1`} aria-labelledby={`${id}-tab-1`} hidden={tab !== 1}>
      <h3>Members</h3>
      {props.members.map((member) => <fieldset key={member.userId} disabled={busy} aria-label={member.displayName}>
        <legend>{member.displayName}{member.userId === props.me ? ' (you)' : ''}</legend>
        <label>Role for {member.displayName}<select value={member.role}
          onChange={(e) => { void run(() => props.onSetRole(member.userId, e.target.value as Role)) }}>
          {ROLES.map((value) => <option key={value} value={value}>{ROLE_LABELS[value]}</option>)}
        </select></label>
        <button type="button" onClick={() => {
          if (window.confirm(`Remove ${member.displayName}? This person will lose access immediately.`)) {
            void run(() => props.onRemove(member.userId))
          }
        }}>Remove</button>
      </fieldset>)}
      <form onSubmit={(e) => {
        e.preventDefault()
        const normalized = email.trim().toLowerCase()
        if (!normalized) return
        void run(async () => {
          await props.onInvite(normalized, role)
          setInvitedEmail(normalized)
          setCopied(false)
          setEmail('')
        })
      }}>
        <h3>Invite</h3>
        <fieldset disabled={busy}>
          <label>Email<input type="email" value={email} required onChange={(e) => setEmail(e.target.value)} /></label>
          <label>Invite role<select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((value) => <option key={value} value={value}>{ROLE_LABELS[value]}</option>)}
          </select></label>
          <button type="submit" disabled={!email.trim()}>Invite</button>
        </fieldset>
      </form>
      {invitation && <div className="settings-confirmation" role="status">
        <p>{invitation}</p>
        <button type="button" disabled={busy} onClick={() => { void run(async () => {
          await copyText(invitation)
          setCopied(true)
        }) }}>{copied ? 'Copied' : 'Copy'}</button>
      </div>}
      <h3>Pending invites</h3>
      {props.invites.length === 0 && <p>No pending invites.</p>}
      <ul>{props.invites.map((invite) => <li key={invite.email}>
        <span>{invite.email} — {ROLE_LABELS[invite.role]}</span>
        <button type="button" disabled={busy} onClick={() => { void run(() => props.onRevokeInvite(invite.email)) }}>Cancel</button>
      </li>)}</ul>
    </div>
  </section>
}

function KeyForm({ provider, row, disabled, onSave, onDelete }: {
  provider: Provider; row?: KeyRow; disabled: boolean
  onSave(key: string): Promise<void>; onDelete(): Promise<void>
}) {
  const [key, setKey] = useState('')
  const id = useId()
  const label = PROVIDER_LABELS[provider]
  return <section aria-labelledby={id}>
    <h3 id={id}>{label}</h3>
    <p>{row ? maskKey(row.last4) : 'No key'}</p>
    {row && <p>Updated on {new Date(row.updated_at).toLocaleString('en-US')}</p>}
    <form onSubmit={(e) => {
      e.preventDefault()
      if (!key || disabled) return
      const value = key
      setKey('')
      void onSave(value)
    }}>
      <fieldset disabled={disabled}>
        <label>Key {label}<input type="password" autoComplete="off" value={key}
          onChange={(e) => setKey(e.target.value)} /></label>
        <button type="submit" disabled={!key}>Save</button>
        <button type="button" disabled={!row} onClick={() => {
          if (window.confirm(`Remove the key for ${label}?`)) void onDelete()
        }}>Remove</button>
      </fieldset>
    </form>
  </section>
}
