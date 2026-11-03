import { useState } from 'react'
import type { Campaign, Piece } from '../data/campaigns.ts'
import type { Member, Membership } from '../data/team.ts'
import type { Route } from '../lib/link.ts'
import { NameForm } from './NameForm.tsx'
import { ThemePicker } from './ThemePicker.tsx'

type Props = {
  memberships: Membership[]
  teamId: string
  campaigns: Campaign[]
  /** The pieces of the open campaign. */
  pieces: Piece[]
  members: Member[]
  online?: Set<string>
  route: Route
  canWrite: boolean
  onNavigate(route: Route): void
  onSwitchWorkspace(teamId: string): void
  onCreateWorkspace(name: string): Promise<void>
  onCreateCampaign(name: string): Promise<void>
  onOpenSettings(): void
}

export function CampaignSidebar(props: Props) {
  const { memberships, teamId, campaigns, pieces, members, route, canWrite, onNavigate } = props
  const [form, setForm] = useState<'workspace' | 'campaign' | null>(null)
  const workspace = memberships.find((m) => m.teamId === teamId)

  return (
    <nav className="sidebar" aria-label="Campanhas">
      <div className="sidebar-workspace">
        {memberships.length > 1 ? (
          <label>
            Workspace
            <select value={teamId} onChange={(e) => props.onSwitchWorkspace(e.target.value)}>
              {memberships.map((m) => <option key={m.teamId} value={m.teamId}>{m.teamName}</option>)}
            </select>
          </label>
        ) : (
          <h2>{workspace?.teamName}</h2>
        )}
        {form === 'workspace' ? (
          <NameForm
            label="Nome do workspace" submitLabel="Criar workspace" onCancel={() => setForm(null)}
            onSubmit={async (name) => {
              await props.onCreateWorkspace(name)
              setForm(null)
            }}
          />
        ) : (
          <button type="button" onClick={() => setForm('workspace')}>Novo workspace</button>
        )}
      </div>

      <ul className="sidebar-campaigns">
        {campaigns.map((c) => {
          const open = c.id === route.campaignId
          return (
            <li key={c.id}>
              <button
                type="button" className="sidebar-item" aria-current={open && !route.pieceId ? 'page' : undefined}
                onClick={() => onNavigate({ campaignId: c.id, pieceId: null })}
              >
                {c.name}
              </button>
              {open && pieces.length > 0 && (
                <ul className="sidebar-pieces">
                  {pieces.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button" className="sidebar-item" aria-current={p.id === route.pieceId ? 'page' : undefined}
                        onClick={() => onNavigate({ campaignId: c.id, pieceId: p.id })}
                      >
                        {p.title}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
      {canWrite && (form === 'campaign' ? (
        <NameForm
          label="Nome da campanha" submitLabel="Criar campanha" onCancel={() => setForm(null)}
          onSubmit={async (name) => {
            await props.onCreateCampaign(name)
            setForm(null)
          }}
        />
      ) : (
        <button type="button" onClick={() => setForm('campaign')}>Nova campanha</button>
      ))}

      <section className="sidebar-people" aria-label="Pessoas do workspace">
        <ul>
          {members.map((m) => (
            <li key={m.userId}>
              {/* The online dot is lit by presence (Task 11). */}
              <span className={`presence-dot${props.online?.has(m.userId) ? ' online' : ''}`}
                role="img" aria-label={`${m.displayName}: ${props.online?.has(m.userId) ? 'online' : 'offline'}`} />
              <span className="person-name">{m.displayName}</span>
              <span className="person-role">{m.role}</span>
            </li>
          ))}
        </ul>
      </section>

      <footer className="sidebar-footer">
        {workspace?.role === 'admin' && <button type="button" onClick={props.onOpenSettings}>Configurações do workspace</button>}
        <ThemePicker />
      </footer>
    </nav>
  )
}
