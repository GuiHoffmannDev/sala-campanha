import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ROLES, type Role } from '../../packages/shared/src/domain'

const ENV_FILE = '.env.test'
// Local-only password shared by every test user; never used outside the local stack.
const TEST_PASSWORD = 'test-password-1234'

function loadEnv() {
  if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE)
  const url = process.env.SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error(
      `Missing SUPABASE_URL, SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY. Create ${ENV_FILE} as described in .env.test.example.`,
    )
  }
  return { url, anonKey, serviceRoleKey }
}

const env = loadEnv()

// Tests run in Node: no session storage and no background token refresh.
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } }

export function serviceClient(): SupabaseClient {
  return createClient(env.url, env.serviceRoleKey, clientOptions)
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

/** Creates a test team with one campaign and one piece, using the service role. */
export async function createPieceFixture(t?: TestTeam): Promise<PieceFixture> {
  const team = t ?? (await createTestTeam())
  const admin = serviceClient()
  const { data: campaign, error: campaignError } = await admin.from('campaigns')
    .insert({ team_id: team.teamId, name: 'Campanha de teste', created_by: team.members.admin.userId })
    .select('id').single()
  if (campaignError || !campaign) throw new Error(`insert campaign failed: ${campaignError?.message}`)

  const { data: piece, error: pieceError } = await admin.from('pieces')
    .insert({ campaign_id: campaign.id, team_id: team.teamId, title: 'Peça de teste', kind: 'imagem_texto', created_by: team.members.admin.userId })
    .select('id').single()
  if (pieceError || !piece) throw new Error(`insert piece failed: ${pieceError?.message}`)

  return { t: team, campaignId: campaign.id, pieceId: piece.id }
}
