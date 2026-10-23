# Plano 1 — Fundação do backend (Supabase) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar o backend da Sala da Campanha no Supabase. Ele cobre times e papéis, campanhas, peças, versões, comentários, chaves do time guardadas com segurança, conversa como lista de eventos, caixa de entrada com reivindicação única e a máquina de status da peça. Tudo é coberto por testes de integração contra um Supabase local.

**Architecture:** Toda regra de negócio vive no Postgres, em tabelas com Row Level Security e funções RPC. Assim, o app Tauri (Plano 3) e o executor do agente (Plano 2) usam o mesmo contrato. O cliente nunca escreve direto em tabelas sensíveis: eventos, versões, status e chaves mudam só por RPC. Os testes usam `supabase-js` com usuários reais criados no Supabase local.

**Tech Stack:** Supabase CLI 2.121 (Postgres, Auth, Realtime, Storage, Vault), Docker, Node 24, pnpm 12, TypeScript 5, Vitest 5, Zod 4, `@supabase/supabase-js` 2.

**Spec:** `docs/superpowers/specs/2026-10-21-sala-campanha-design.md`

**Planos seguintes (fora deste):**
- Plano 2: executor do agente (consome `claim_next_message`, chama provedores com `get_provider_key_for_executor`, grava versões).
- Plano 3: app Tauri para macOS (UI, presença, link de compartilhamento).

## Global Constraints

- Papéis exatos: `admin`, `gestor`, `designer`, `espectador`.
- Status exatos da peça, em ordem: `gerando`, `base_em_revisao`, `acabamento`, `final_em_revisao`, `aprovada`.
- Provedores da primeira versão: `openai`, `anthropic`, `gemini`, `fal` (Flux Kontext), `krea`.
- Só `admin` e `gestor` aprovam. Só `admin` cadastra chaves e membros. `espectador` só lê.
- Todos os papéis, menos `espectador`, pedem e redirecionam o agente, comentam, sobem referência ou versão final e voltam a peça uma etapa.
- Mensagem com `mention_user_ids` não vazio e texto começando com `@` é conversa entre pessoas: não aciona o agente.
- A chave de provedor nunca é retornada a um usuário autenticado. Após o cadastro, só a máscara (`sk-...a1b2`, ou seja, os 4 últimos caracteres) é visível.
- Uma versão é um pacote: `image_path` e `caption` juntos, aprovados juntos.
- Isolamento por time: nenhum dado de um time é visível para membro de outro time.
- Primeira versão só para o time de teste. Não há cadastro público; times são criados com service role.

## Review Focus

1. **Duas pessoas mandam mensagem ao mesmo tempo:** cada mensagem é reivindicada por exatamente um executor, sem duplicar nem perder mensagem. Teste na Task 6: `claim is exclusive under concurrency`.
2. **Função `security definer` vazando outro time:** uma RPC chamada com `piece_id` de outro time precisa falhar, e não agir por cima da RLS. Testes nas Tasks 5, 7 e 8: `rejects piece from another team`.
3. **Chave em texto puro:** nenhuma resposta de select ou RPC para `authenticated` contém a chave. Teste na Task 4: `never returns plaintext to members`.
4. **Aprovar versão errada:** aprovar uma versão de outra peça, ou fora da fase de revisão, precisa falhar. Teste na Task 7: `rejects approval outside review status`.
5. **Voltar etapa no início:** `step_back` em `gerando` não tem etapa anterior e precisa dar erro claro, sem corromper o status. Teste na Task 7: `step_back from gerando fails`.

---

## Estrutura de arquivos

```
sala-campanha/
  package.json                 # workspace root, scripts
  pnpm-workspace.yaml
  tsconfig.json
  vitest.config.mts            # roda tests/, timeout maior, sequencial por arquivo
  .env.test.example            # SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
  supabase/
    config.toml                # gerado por `supabase init`
    migrations/
      0001_teams.sql
      0002_campaigns_pieces.sql
      0003_provider_keys.sql
      0004_session_events.sql
      0005_inbox.sql
      0006_versions_status.sql
      0007_comments.sql
      0008_realtime.sql
  packages/shared/
    package.json
    src/domain.ts              # enums e schemas Zod compartilhados com Planos 2 e 3
  tests/
    helpers/supabase.ts        # clientes e fábrica de times de teste
    db/*.test.ts               # um arquivo por task
```

---

### Task 1: Workspace, Supabase local e fábrica de testes

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `vitest.config.mts`, `.env.test.example`, `.gitignore`
- Create: `supabase/` via `supabase init`
- Create: `packages/shared/package.json`, `packages/shared/src/domain.ts`
- Create: `tests/helpers/supabase.ts`
- Test: `tests/db/harness.test.ts`

**Interfaces:**
- Produces (`packages/shared/src/domain.ts`):
  - `ROLES = ['admin','gestor','designer','espectador'] as const`, `type Role`
  - `PIECE_STATUSES = ['gerando','base_em_revisao','acabamento','final_em_revisao','aprovada'] as const`, `type PieceStatus`
  - `PROVIDERS = ['openai','anthropic','gemini','fal','krea'] as const`, `type Provider`
  - `EVENT_KINDS = ['user_message','agent_started','agent_result','agent_error','status_changed','version_added','approval'] as const`, `type EventKind`
  - `DELIVERY_STATUSES = ['queued','claimed','done','failed','not_applicable'] as const`, `type DeliveryStatus`
- Produces (`tests/helpers/supabase.ts`):
  - `serviceClient(): SupabaseClient` (service role)
  - `createTestTeam(name?: string): Promise<TestTeam>`, onde `TestTeam = { teamId: string; members: Record<Role, { userId: string; client: SupabaseClient }> }`. Cria 4 usuários (um por papel) com e-mail aleatório e senha fixa de teste, insere o time e os membros via service role e devolve clientes já autenticados.

- [x] **Step 1: Inicializar repositório e workspace**

Run: `cd /Users/guilhermehoffmann/Documents/sala-campanha && git init && pnpm init && supabase init`
Expected: `supabase/config.toml` criado. `.gitignore` inclui `node_modules`, `.env*` (exceto `.env.test.example`) e `.superpowers/`.

- [x] **Step 2: Instalar dependências de dev**

Run: `pnpm add -D typescript vitest @types/node && pnpm add @supabase/supabase-js zod`
Expected: `package.json` com scripts `"test": "vitest run"`, `"db:reset": "supabase db reset"` e `"db:start": "supabase start"`.

- [x] **Step 3: Write the failing test** em `tests/db/harness.test.ts`

```ts
it('createTestTeam returns 4 signed-in members', async () => {
  const t = await createTestTeam()
  for (const role of ROLES) {
    const { data } = await t.members[role].client.auth.getUser()
    expect(data.user?.id).toBe(t.members[role].userId)
  }
})
```

- [x] **Step 4: Run test to verify it fails**

Run: `pnpm db:start && pnpm test tests/db/harness.test.ts`
Expected: FAIL (`createTestTeam` não existe, ou a tabela `teams` não existe).

- [x] **Step 5: Implementar `domain.ts` e `tests/helpers/supabase.ts`**

O helper lê URL e chaves de `.env.test`, gerado a partir de `supabase status -o env`. Usa `auth.admin.createUser({ email_confirm: true })` e depois `signInWithPassword`. A inserção em `teams` e `team_members` só funciona depois da Task 2: neste passo, o helper só cria os usuários, e a parte de time fica pronta na Task 2.

- [x] **Step 6: Run test to verify it passes** (depois da Task 2, rodar de novo)

Run: `pnpm test tests/db/harness.test.ts`
Expected: PASS

> Notas da execução da Task 1 (para a Task 2):
> - `createTestTeam` já insere `teams` e `team_members` (colunas da interface da Task 2: `team_id`, `user_id`, `role`, `display_name`). Hoje o teste falha com `Could not find the table 'public.teams'`; a Task 2 só precisa criar a migração e rodar o harness.
> - As portas do Supabase local foram movidas para 5532x (API em `http://127.0.0.1:55321`), porque outro projeto local já usa 5432x.
> - TypeScript fixado em 5.x, conforme o Tech Stack (o `pnpm add` sem versão instalou o 7).

- [x] **Step 7: Commit**

```bash
git add -A && git commit -m "chore: scaffold workspace, local Supabase and test harness"
```

---

### Task 2: Times, membros e papéis com RLS

**Files:**
- Create: `supabase/migrations/0001_teams.sql`
- Modify: `tests/helpers/supabase.ts` (completar `createTestTeam`)
- Test: `tests/db/teams.test.ts`

**Interfaces:**
- Produces (SQL):
  - enum `team_role` com os 4 papéis
  - `teams(id uuid pk, name text not null, created_at timestamptz)`
  - `team_members(team_id uuid fk, user_id uuid fk auth.users, role team_role, display_name text not null, pk(team_id,user_id))`
  - `private.team_role_of(p_team uuid) returns team_role`: `security definer`, retorna o papel de `auth.uid()` ou null
  - `private.can_write(p_team uuid) returns boolean`: papel não nulo e diferente de `espectador`
  - `private.can_approve(p_team uuid) returns boolean`: papel em (`admin`,`gestor`)
- Policies: `select` em `teams` e `team_members` só para membros do time. Sem `insert`, `update` ou `delete` para `authenticated`; a gestão de membros fica para o admin via RPC no Plano 3.

- [x] **Step 1: Write the failing tests**

```ts
it('member sees own team and not another team', async () => {
  const a = await createTestTeam('A'); const b = await createTestTeam('B')
  const { data } = await a.members.designer.client.from('teams').select('id')
  expect(data?.map(r => r.id)).toEqual([a.teamId])
  const { data: other } = await a.members.admin.client.from('team_members').select('user_id').eq('team_id', b.teamId)
  expect(other).toEqual([])
})
it('authenticated cannot insert team_members', async () => {
  const a = await createTestTeam()
  const { error } = await a.members.admin.client.from('team_members')
    .insert({ team_id: a.teamId, user_id: a.members.admin.userId, role: 'admin', display_name: 'x' })
  expect(error).not.toBeNull()
})
```

- [x] **Step 2: Run to verify fail.** Run: `pnpm test tests/db/teams.test.ts`. Expected: FAIL (a tabela não existe).
- [x] **Step 3: Escrever `0001_teams.sql` e completar `createTestTeam`.** Funções em schema `private`, com `set search_path = ''`.
- [x] **Step 4: Run.** Run: `pnpm db:reset && pnpm test tests/db/teams.test.ts tests/db/harness.test.ts`. Expected: PASS.
- [x] **Step 5: Commit.** `git commit -am "feat(db): teams, members and roles with RLS"`

---

### Task 3: Campanhas, peças, referências e Storage

**Files:**
- Create: `supabase/migrations/0002_campaigns_pieces.sql`
- Test: `tests/db/campaigns.test.ts`

**Interfaces:**
- Produces (SQL):
  - `campaigns(id, team_id, name, created_by, created_at)`
  - `pieces(id, campaign_id, team_id, title, kind text check in ('imagem','texto','imagem_texto'), status piece_status default 'gerando', approved_version_id uuid null, created_by, created_at)`. O `team_id` é denormalizado para RLS.
  - enum `piece_status` com os 5 status
  - `reference_assets(id, campaign_id, team_id, storage_path, original_name, uploaded_by, created_at)`
  - Bucket privado `team-files`, com caminho obrigatório `<team_id>/...`
- Policies:
  - `select` para membros do time.
  - `insert` em `campaigns`, `pieces` e `reference_assets` quando `private.can_write(team_id)`.
  - `update` de `pieces.status` e `approved_version_id` negado a `authenticated`; esses campos mudam só por RPC (Task 7).
  - Storage: leitura para membros do time do 1º segmento do caminho; escrita para `can_write`.

- [x] **Step 1: Write the failing tests**

```ts
it('designer creates campaign and piece; espectador cannot', async () => {
  const t = await createTestTeam()
  const { data: c, error } = await t.members.designer.client.from('campaigns')
    .insert({ team_id: t.teamId, name: 'Black Friday 2026' }).select().single()
  expect(error).toBeNull()
  const { error: e2 } = await t.members.espectador.client.from('campaigns').insert({ team_id: t.teamId, name: 'x' })
  expect(e2).not.toBeNull()
  const { data: p } = await t.members.designer.client.from('pieces')
    .insert({ campaign_id: c!.id, team_id: t.teamId, title: 'Banner Instagram', kind: 'imagem_texto' }).select().single()
  expect(p!.status).toBe('gerando')
})
it('client cannot update piece status directly', async () => {
  // cria a peça como designer; tenta update status='aprovada' como gestor; expect: linha inalterada
})
it('storage rejects upload outside own team prefix', async () => {
  // gestor do time A sobe em `${b.teamId}/ref.png`: expect error
})
```

- [x] **Step 2: Run to verify fail.** Run: `pnpm test tests/db/campaigns.test.ts`. Expected: FAIL.
- [x] **Step 3: Escrever `0002_campaigns_pieces.sql`**, com bucket e policies de `storage.objects`.
- [x] **Step 4: Run.** Run: `pnpm db:reset && pnpm test tests/db/campaigns.test.ts`. Expected: PASS.
- [x] **Step 5: Commit.** `git commit -am "feat(db): campaigns, pieces, reference assets and storage policies"`

---

### Task 4: Chaves do time no Vault

**Files:**
- Create: `supabase/migrations/0003_provider_keys.sql`
- Test: `tests/db/provider-keys.test.ts`

**Interfaces:**
- Produces (SQL):
  - enum `provider` com os 5 provedores
  - `provider_keys(team_id, provider, vault_secret_id uuid, last4 text, updated_by, updated_at, pk(team_id, provider))`. RLS: `select` de `team_id, provider, last4, updated_at` para membros. A coluna `vault_secret_id` é revogada de `authenticated` via column privileges.
  - RPC `set_provider_key(p_team uuid, p_provider provider, p_key text) returns void`: `security definer`. Exige `team_role_of = 'admin'`, rejeita chave com menos de 20 caracteres, cria ou atualiza o segredo em `vault.secrets` e grava `last4`.
  - RPC `delete_provider_key(p_team uuid, p_provider provider) returns void`: só admin; remove o segredo do Vault.
  - RPC `get_provider_key_for_executor(p_team uuid, p_provider provider) returns text`: `execute` concedido só a `service_role`, revogado de `public`, `anon` e `authenticated`. É usado pelo Plano 2.

- [x] **Step 1: Write the failing tests**

```ts
it('admin sets key; members see only last4', async () => {
  const t = await createTestTeam()
  const key = 'sk-test-1234567890abcd'
  expect((await t.members.admin.client.rpc('set_provider_key', { p_team: t.teamId, p_provider: 'openai', p_key: key })).error).toBeNull()
  const { data } = await t.members.designer.client.from('provider_keys').select('provider,last4')
  expect(data).toEqual([{ provider: 'openai', last4: 'abcd' }])
})
it('gestor cannot set key', async () => { /* rpc as gestor: expect error */ })
it('never returns plaintext to members', async () => {
  // select('*') como admin: JSON.stringify(data) não contém key; rpc get_provider_key_for_executor como admin: expect error
})
it('service role reads plaintext for executor', async () => {
  // serviceClient().rpc('get_provider_key_for_executor', ...): data === key
})
```

- [x] **Step 2: Run to verify fail.** Run: `pnpm test tests/db/provider-keys.test.ts`. Expected: FAIL.
- [x] **Step 3: Escrever `0003_provider_keys.sql`** usando `vault.create_secret` e `vault.update_secret`; a leitura usa `vault.decrypted_secrets` só dentro da função de executor. Nenhum `raise notice` com a chave.
- [x] **Step 4: Run.** Run: `pnpm db:reset && pnpm test tests/db/provider-keys.test.ts`. Expected: PASS.
- [x] **Step 5: Commit.** `git commit -am "feat(db): team provider keys stored in Vault"`

---

### Task 5: Conversa como eventos e roteamento de mensagens

**Files:**
- Create: `supabase/migrations/0004_session_events.sql`
- Test: `tests/db/session-events.test.ts`

**Interfaces:**
- Produces (SQL):
  - enums `event_kind` e `delivery_status`, com os valores de `domain.ts`
  - `session_events(id bigint identity pk, piece_id, team_id, author_id uuid null, kind event_kind, body jsonb not null, to_agent boolean not null, mention_user_ids uuid[] default '{}', delivery delivery_status not null, claimed_by text null, claimed_at timestamptz null, created_at)`. O `id` crescente é a ordem da conversa, e o cliente busca eventos com `id > último visto`.
  - RLS: `select` para membros. Sem `insert` ou `update` para `authenticated`.
  - RPC `post_message(p_piece uuid, p_text text, p_mention_user_ids uuid[] default '{}', p_model jsonb default null, p_reference_asset_ids uuid[] default '{}') returns session_events`: `security definer`. Exige `can_write` no time da peça e texto não vazio. Valida que as menções e referências pertencem ao mesmo time e campanha.
    - Regra de roteamento: `to_agent = not (left(trim(p_text),1) = '@' and cardinality(p_mention_user_ids) > 0)`.
    - `delivery = 'queued'` se `to_agent`, senão `'not_applicable'`.
    - `body = {text, model, reference_asset_ids}`.

- [x] **Step 1: Write the failing tests**

```ts
it('plain message goes to agent queue', async () => {
  const { t, pieceId } = await createPieceFixture()   // helper local: campanha + peça
  const { data } = await t.members.gestor.client.rpc('post_message', { p_piece: pieceId, p_text: 'Fundo escuro, clima premium' })
  expect(data).toMatchObject({ to_agent: true, delivery: 'queued', kind: 'user_message', author_id: t.members.gestor.userId })
})
it('message starting with @mention goes to people only', async () => {
  // p_text '@Gestor o que acha?', p_mention_user_ids [gestor.userId]: to_agent false, delivery 'not_applicable'
})
it('@ without mention ids still goes to agent', async () => {
  // p_text '@algo', mentions []: to_agent true
})
it('espectador cannot post', async () => { /* expect error */ })
it('rejects piece from another team', async () => { /* membro de A posta em peça de B: expect error */ })
it('rejects mention of user from another team', async () => { /* expect error */ })
```

- [x] **Step 2: Run to verify fail.** Run: `pnpm test tests/db/session-events.test.ts`. Expected: FAIL.
- [x] **Step 3: Escrever `0004_session_events.sql`.** Adicionar `createPieceFixture()` em `tests/helpers/supabase.ts`, retornando `{ t: TestTeam; campaignId: string; pieceId: string }`.
- [x] **Step 4: Run.** Run: `pnpm db:reset && pnpm test tests/db/session-events.test.ts`. Expected: PASS.
- [x] **Step 5: Commit.** `git commit -am "feat(db): session events and agent/people message routing"`

---

### Task 6: Caixa de entrada com reivindicação única

**Files:**
- Create: `supabase/migrations/0005_inbox.sql`
- Test: `tests/db/inbox.test.ts`

**Interfaces:**
- Produces (SQL, `execute` só para `service_role`):
  - `claim_next_message(p_executor text) returns setof session_events`: reivindica a mensagem `queued` mais antiga **por peça que não tenha outra `claimed`**. Marca `claimed`, `claimed_by` e `claimed_at` e retorna 0 ou 1 linha. Algoritmo: `select ... where delivery='queued' and not exists (claimed na mesma peça) order by id limit 1 for update skip locked`, depois `update`.
  - `pending_for_piece(p_piece uuid) returns setof session_events`: mensagens `queued` da peça, em ordem. O executor usa para incorporar redirecionamentos durante a geração (Plano 2).
  - `complete_message(p_event bigint, p_executor text, p_status delivery_status) returns void`: aceita só `done` ou `failed`, e só se `claimed_by = p_executor`.
  - `release_stale_claims(p_older_than interval) returns int`: volta para `queued` as reivindicações abandonadas.

- [x] **Step 1: Write the failing tests**

```ts
it('claim is exclusive under concurrency', async () => {
  // 1 mensagem queued; Promise.all de 5 claims com executores diferentes: exatamente 1 retorna linha
})
it('second message of same piece waits while first is claimed', async () => {
  // 2 mensagens na mesma peça; claim A pega a 1ª; claim B retorna vazio; complete A done; claim B pega a 2ª
})
it('messages of different pieces are claimed in parallel', async () => { /* 2 peças: 2 claims retornam 2 linhas */ })
it('complete_message rejects other executor', async () => { /* expect error */ })
it('authenticated cannot claim', async () => { /* rpc como gestor: expect error */ })
it('release_stale_claims requeues old claims', async () => { /* claim; release('0 seconds'): retorna 1; delivery 'queued' */ })
```

- [x] **Step 2: Run to verify fail.** Run: `pnpm test tests/db/inbox.test.ts`. Expected: FAIL.
- [x] **Step 3: Escrever `0005_inbox.sql`.**
- [x] **Step 4: Run.** Run: `pnpm db:reset && pnpm test tests/db/inbox.test.ts`. Expected: PASS, rodando 3 vezes seguidas sem falha intermitente.
- [x] **Step 5: Commit.** `git commit -am "feat(db): inbox with exclusive per-piece claim"`

---

### Task 7: Versões, status e aprovação

**Files:**
- Create: `supabase/migrations/0006_versions_status.sql`
- Test: `tests/db/versions-status.test.ts`

**Interfaces:**
- Produces (SQL):
  - `piece_versions(id, piece_id, team_id, number int, origin text check in ('agente','upload'), phase text check in ('base','final'), image_path text null, caption text null, author_id uuid null, source_event_id bigint null, created_at, unique(piece_id, number), check (image_path is not null or caption is not null))`
  - RPC `add_agent_version(p_piece uuid, p_image_path text, p_caption text, p_source_event bigint) returns piece_versions`: só `service_role`. Cria a versão `phase='base'` e, se o status é `gerando`, muda para `base_em_revisao`. Grava eventos `version_added` e `status_changed`.
  - RPC `upload_final_version(p_piece uuid, p_image_path text, p_caption text) returns piece_versions`: exige `can_write` e status em (`acabamento`,`final_em_revisao`). Cria a versão `phase='final'`, muda o status para `final_em_revisao` e grava os eventos.
  - RPC `update_caption(p_version uuid, p_caption text) returns piece_versions`: exige `can_write` e versão ainda não aprovada; cria uma nova versão com a mesma imagem e a nova legenda.
  - RPC `approve_version(p_piece uuid, p_version uuid) returns pieces`: exige `can_approve` na peça; a versão precisa ser dessa peça.
    - `base_em_revisao` + versão `base` → `acabamento`.
    - `final_em_revisao` + versão `final` → `aprovada`.
    - Peça só de texto em `base_em_revisao` → `aprovada` (a fase de acabamento é opcional para texto, conforme o spec).
    - Atualiza `approved_version_id` e grava o evento `approval`.
  - RPC `step_back(p_piece uuid) returns pieces`: exige `can_write`. Volta um status na ordem de `PIECE_STATUSES` e grava `status_changed` com `{from,to}`. Em `gerando`, falha com `'no previous status'`.

- [x] **Step 1: Write the failing tests**

```ts
it('agent version moves gerando to base_em_revisao', async () => {})
it('gestor approves base: acabamento; designer approval fails', async () => {})
it('upload final then approve: aprovada', async () => {})
it('texto piece approved directly from base_em_revisao', async () => {})
it('rejects approval outside review status', async () => { /* aprovar com status 'acabamento': error */ })
it('rejects approving version of another piece', async () => {})
it('step_back from gerando fails', async () => { /* error 'no previous status'; status segue 'gerando' */ })
it('step_back records status_changed event with author', async () => {})
it('rejects piece from another team', async () => { /* upload_final_version em peça de B: error */ })
```

- [x] **Step 2: Run to verify fail.** Run: `pnpm test tests/db/versions-status.test.ts`. Expected: FAIL.
- [x] **Step 3: Escrever `0006_versions_status.sql`.** `number` = max + 1 por peça, dentro da mesma transação, com `for update` na peça.
- [x] **Step 4: Run.** Run: `pnpm db:reset && pnpm test tests/db/versions-status.test.ts`. Expected: PASS.
- [x] **Step 5: Commit.** `git commit -am "feat(db): piece versions, status machine and approvals"`

---

### Task 8: Comentários presos à imagem

**Files:**
- Create: `supabase/migrations/0007_comments.sql`
- Test: `tests/db/comments.test.ts`

**Interfaces:**
- Produces (SQL):
  - `comments(id, version_id, piece_id, team_id, author_id, body text not null, x real null, y real null, parent_id uuid null, resolved boolean default false, created_at)`, com `check ((x is null) = (y is null) and (x is null or (x between 0 and 1 and y between 0 and 1)))`. As coordenadas são relativas à imagem (0–1). Comentário sem coordenadas é comentário simples na versão, que é o corte nº 1 do spec.
  - RLS: `select` para membros; `insert` com `can_write` e `author_id = auth.uid()`; `update` só de `resolved`, por `can_write`.

- [x] **Step 1: Write the failing tests**

```ts
it('designer comments on a point of the image', async () => {})
it('rejects coordinates outside 0..1', async () => { /* x 1.5: error */ })
it('espectador cannot comment', async () => {})
it('reply keeps thread via parent_id', async () => {})
it('rejects comment authored as someone else', async () => {})
```

- [x] **Step 2–4:** como nas tasks anteriores. Run: `pnpm db:reset && pnpm test tests/db/comments.test.ts`. Expected: PASS.
- [x] **Step 5: Commit.** `git commit -am "feat(db): pinned comments on versions"`

---

### Task 9: Realtime e verificação final

**Files:**
- Create: `supabase/migrations/0008_realtime.sql`
- Test: `tests/db/realtime.test.ts`

**Interfaces:**
- Produces: as tabelas `session_events`, `pieces`, `piece_versions` e `comments` entram na publicação `supabase_realtime`. A RLS filtra o que cada cliente recebe. O Plano 3 assina `postgres_changes` por `piece_id`.

- [x] **Step 1: Write the failing test**

```ts
it('member receives new event; other team does not', async () => {
  // A.designer e B.designer assinam postgres_changes INSERT em session_events
  // A.gestor posta mensagem; em até 5s A recebe 1 evento, B recebe 0
})
```

- [x] **Step 2: Run to verify fail.** Run: `pnpm test tests/db/realtime.test.ts`. Expected: FAIL (timeout sem evento).
- [x] **Step 3: Escrever `0008_realtime.sql`.**
- [x] **Step 4: Rodar a suíte inteira.** Run: `pnpm db:reset && pnpm test`. Expected: todos PASS.
- [x] **Step 5: Commit.** `git commit -am "feat(db): realtime publication for collaborative tables"`

---

## Pré-requisitos para o Plano 3 (registrar, não executar aqui)

- Instalar Rust via `rustup` (hoje `cargo` e `rustc` não estão instalados) e as Xcode Command Line Tools. São necessários para o Tauri.
