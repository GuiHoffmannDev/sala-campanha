import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import pg from 'pg'
import { ROLES, type Role } from '../../packages/shared/src/domain'

const ENV_FILE = '.env.test'
// Local-only password shared by every test user; never used outside the local stack.
const TEST_PASSWORD = 'test-password-1234'

function loadEnv() {
  if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE)
  const url = process.env.SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const dbUrl = process.env.SUPABASE_DB_URL
  if (!url || !anonKey || !serviceRoleKey || !dbUrl) {
    throw new Error(
      `Missing SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY or SUPABASE_DB_URL. Create ${ENV_FILE} as described in .env.test.example.`,
    )
  }
  return { url, anonKey, serviceRoleKey, dbUrl }
}

const env = loadEnv()

// Tests run in Node: no session storage and no background token refresh.
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } }

export function serviceClient(): SupabaseClient {
  return createClient(env.url, env.serviceRoleKey, clientOptions)
}

/** Runs SQL as `postgres` on the local DB, for checks PostgREST cannot reach (such as the Vault). */
export async function dbQuery<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: env.dbUrl })
  await client.connect()
  try {
    return (await client.query(sql, params)).rows as T[]
  } finally {
    await client.end()
  }
}

export type TestMember = { userId: string; client: SupabaseClient }
export type TestTeam = { teamId: string; members: Record<Role, TestMember> }

async function createSignedInUser(role: Role): Promise<TestMember> {
  const email = `${role}-${randomUUID()}@test.local`
  const { data, error } = await serviceClient().auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(`createUser(${role}) failed: ${error?.message}`)

  const client = createClient(env.url, env.anonKey, clientOptions)
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD })
  if (signInError) throw new Error(`signIn(${role}) failed: ${signInError.message}`)

  return { userId: data.user.id, client }
}

/** Creates a team with one signed-in member per role, using the service role. */
export async function createTestTeam(name = `Test team ${randomUUID()}`): Promise<TestTeam> {
  const entries = await Promise.all(ROLES.map(async (role) => [role, await createSignedInUser(role)] as const))
  const members = Object.fromEntries(entries) as Record<Role, TestMember>

  // `teams` and `team_members` are created by migration 0001 (Task 2).
  const admin = serviceClient()
  const { data: team, error: teamError } = await admin.from('teams').insert({ name }).select('id').single()
  if (teamError || !team) throw new Error(`insert team failed: ${teamError?.message}`)

  const { error: membersError } = await admin.from('team_members').insert(
    ROLES.map((role) => ({ team_id: team.id, user_id: members[role].userId, role, display_name: role })),
  )
  if (membersError) throw new Error(`insert team_members failed: ${membersError.message}`)

  return { teamId: team.id, members }
}

export type PieceFixture = { t: TestTeam; campaignId: string; pieceId: string }

export type PieceKind = 'imagem' | 'texto' | 'imagem_texto'

/** Creates a test team with one campaign and one piece, using the service role. */
export async function createPieceFixture(t?: TestTeam, kind: PieceKind = 'imagem_texto'): Promise<PieceFixture> {
  const team = t ?? (await createTestTeam())
  const admin = serviceClient()
  const { data: campaign, error: campaignError } = await admin.from('campaigns')
    .insert({ team_id: team.teamId, name: 'Campanha de teste', created_by: team.members.admin.userId })
    .select('id').single()
  if (campaignError || !campaign) throw new Error(`insert campaign failed: ${campaignError?.message}`)

  const { data: piece, error: pieceError } = await admin.from('pieces')
    .insert({ campaign_id: campaign.id, team_id: team.teamId, title: 'Peça de teste', kind, created_by: team.members.admin.userId })
    .select('id').single()
  if (pieceError || !piece) throw new Error(`insert piece failed: ${pieceError?.message}`)

  return { t: team, campaignId: campaign.id, pieceId: piece.id }
}

/** Uploads a tiny PNG to the `team-files` bucket with the service role and returns its path. */
export async function uploadTeamFile(path: string): Promise<string> {
  const { error } = await serviceClient().storage.from('team-files')
    .upload(path, new Blob(['png'], { type: 'image/png' }))
  if (error) throw new Error(`upload ${path} failed: ${error.message}`)
  return path
}

export const TEST_EXECUTOR = 'test-executor'

/**
 * Posts a message to the agent and marks it claimed by `executor`. Claims the
 * row directly instead of calling claim_next_message, which takes the oldest
 * queued message of any piece and could grab another test's message.
 */
export async function createClaimedMessage(f: PieceFixture, executor = TEST_EXECUTOR): Promise<number> {
  const { data: msg, error } = await f.t.members.gestor.client.rpc('post_message', { p_piece: f.pieceId, p_text: 'Gerar versão' })
  if (error || !msg) throw new Error(`post_message failed: ${error?.message}`)
  const { error: claimError } = await serviceClient().from('session_events')
    .update({ delivery: 'claimed', claimed_by: executor, claimed_at: new Date().toISOString() }).eq('id', msg.id)
  if (claimError) throw new Error(`claim message failed: ${claimError.message}`)
  return msg.id
}

export type Version = {
  id: string; piece_id: string; number: number; origin: string; phase: string
  image_path: string | null; caption: string | null; author_id: string | null; source_event_id: number | null
}

/** Uploads a new image under the piece folder and returns its path. */
export const uploadPieceImage = (f: PieceFixture) => uploadTeamFile(`${f.t.teamId}/${f.pieceId}/${randomUUID()}.png`)

/**
 * Stores an agent base version the way the executor does: claimed source
 * message, uploaded image (unless `image` is false), then add_agent_version.
 */
export async function createAgentVersion(
  f: PieceFixture, opts: { caption?: string | null; image?: boolean } = {},
): Promise<Version> {
  const caption = opts.caption === undefined ? 'Legenda base' : opts.caption
  const image = opts.image === false ? null : await uploadPieceImage(f)
  const source = await createClaimedMessage(f)
  const { data, error } = await serviceClient().rpc('add_agent_version', {
    p_piece: f.pieceId, p_image_path: image, p_caption: caption, p_source_event: source, p_executor: TEST_EXECUTOR,
  })
  if (error || !data) throw new Error(`add_agent_version failed: ${error?.message}`)
  return data
}
