import { useId, useRef, useState } from 'react'
import { ROLES, type Provider, type Role } from '@sala/shared'
import { friendlyError } from '../data/errors.ts'
import { KEY_PROVIDERS, PROVIDER_LABELS, maskKey, type KeyRow } from '../data/keys.ts'
import type { Invite, Member } from '../data/team.ts'
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
    ? `Convite criado. Avise a pessoa: baixe a Sala da Campanha e entre com ${invitedEmail}.` : null

  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError(null)
    try { await action() } catch (e) { setError(friendlyError(e)) } finally { setBusy(false) }
  }

  return <section className="workspace-settings" aria-label="Configurações do workspace">
    <h2>Configurações do workspace</h2>
    <div role="tablist" aria-label="Configurações do workspace">
      {['Chaves', 'Membros'].map((label, index) => <button key={label} type="button" role="tab"
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
      <h3>Membros</h3>
      {props.members.map((member) => <fieldset key={member.userId} disabled={busy} aria-label={member.displayName}>
        <legend>{member.displayName}{member.userId === props.me ? ' (você)' : ''}</legend>
        <label>Papel de {member.displayName}<select value={member.role}
          onChange={(e) => { void run(() => props.onSetRole(member.userId, e.target.value as Role)) }}>
          {ROLES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select></label>
        <button type="button" onClick={() => {
          if (window.confirm(`Remover ${member.displayName}? Essa pessoa perde o acesso na hora.`)) {
            void run(() => props.onRemove(member.userId))
          }
        }}>Remover</button>
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
        <h3>Convidar</h3>
        <fieldset disabled={busy}>
          <label>E-mail<input type="email" value={email} required onChange={(e) => setEmail(e.target.value)} /></label>
          <label>Papel do convite<select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((value) => <option key={value} value={value}>{value}</option>)}
          </select></label>
          <button type="submit" disabled={!email.trim()}>Convidar</button>
        </fieldset>
      </form>
      {invitation && <div className="settings-confirmation" role="status">
        <p>{invitation}</p>
        <button type="button" disabled={busy} onClick={() => { void run(async () => {
          await copyText(invitation)
          setCopied(true)
        }) }}>{copied ? 'Copiado' : 'Copiar'}</button>
      </div>}
      <h3>Convites pendentes</h3>
      {props.invites.length === 0 && <p>Nenhum convite pendente.</p>}
      <ul>{props.invites.map((invite) => <li key={invite.email}>
        <span>{invite.email} — {invite.role}</span>
        <button type="button" disabled={busy} onClick={() => { void run(() => props.onRevokeInvite(invite.email)) }}>Cancelar</button>
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
    <p>{row ? maskKey(row.last4) : 'Sem chave'}</p>
    {row && <p>Atualizada em {new Date(row.updated_at).toLocaleString('pt-BR')}</p>}
    <form onSubmit={(e) => {
      e.preventDefault()
      if (!key || disabled) return
      const value = key
      setKey('')
      void onSave(value)
    }}>
      <fieldset disabled={disabled}>
        <label>Chave {label}<input type="password" autoComplete="off" value={key}
          onChange={(e) => setKey(e.target.value)} /></label>
        <button type="submit" disabled={!key}>Salvar</button>
        <button type="button" disabled={!row} onClick={() => {
          if (window.confirm(`Remover a chave de ${label}?`)) void onDelete()
        }}>Remover</button>
      </fieldset>
    </form>
  </section>
}
