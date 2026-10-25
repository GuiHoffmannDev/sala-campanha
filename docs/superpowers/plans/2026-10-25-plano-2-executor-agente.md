# Plano 2 — Executor do agente Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar o executor do agente: um processo Node no servidor que reivindica as mensagens do chat, monta o prompt com um modelo de texto, gera texto e/ou imagem com a chave do time, incorpora redirecionamentos e grava o resultado como versão base e como eventos da conversa.

**Architecture:** Um worker Node 24 de longa duração (`packages/executor`) fala com o Supabase só pelo service role e só pelas RPCs do Plano 1, mais uma RPC nova (`add_agent_event`). Cada reivindicação vira uma sequência de rodadas: absorve as mensagens na fila da peça, planeja com o modelo de texto, gera, salva e repete enquanto chegarem redirecionamentos. Os provedores são adaptadores finos sobre `fetch`, injetáveis, para que os testes rodem contra o Supabase local sem chamar provedores reais.

**Tech Stack:** Node 24 (TypeScript executado direto, por remoção de tipos), TypeScript 5, Vitest 5, Zod 4, `@supabase/supabase-js` 2, Supabase CLI 2.121 local, Docker. APIs REST: OpenAI Responses, Anthropic Messages, Gemini `generateContent`, fal (`fal.run`).

**Spec:** `docs/superpowers/specs/2026-10-21-sala-campanha-design.md`

**Plano anterior (interfaces consumidas):** `docs/superpowers/plans/2026-10-21-plano-1-fundacao-backend.md`. As RPCs usadas aqui já existem em `supabase/migrations/0003`–`0006`:
- `claim_next_message(p_executor text) returns setof session_events` (0 ou 1 linha)
- `absorb_pending(p_piece uuid, p_executor text) returns setof session_events` (erro `42501` sem claim)
- `touch_claim(p_piece uuid, p_executor text) returns int` (erro `42501` sem claim)
- `complete_message(p_event bigint, p_executor text, p_status delivery_status) returns void` (`done` ou `failed`)
- `release_stale_claims(p_older_than interval) returns int`
- `get_provider_key_for_executor(p_team uuid, p_provider provider) returns text` (null sem chave)
- `add_agent_version(p_piece uuid, p_image_path text, p_caption text, p_source_event bigint, p_executor text) returns piece_versions` (erro `42501` sem claim; `22023` fora de `gerando`/`base_em_revisao` ou pacote errado)
- `session_events.body` de `user_message` = `{ text, model, reference_asset_ids }`, gravado por `post_message`.

## Global Constraints

- Node 24 roda `.ts` direto: só sintaxe TypeScript apagável (sem `enum`, `namespace` nem parameter properties como `constructor(public x)`). Imports relativos com extensão `.ts`. `tsconfig.json` ganha `allowImportingTsExtensions: true` e `erasableSyntaxOnly: true`.
- Sem dependência nova de runtime: provedores via `fetch`; banco e Storage via `@supabase/supabase-js`; validação via `zod`. `@sala/shared` entra como `workspace:*`.
- Chaves: buscadas com `get_provider_key_for_executor` a cada rodada, nunca guardadas em cache, nunca registradas em log, nunca gravadas em evento. Todo texto vindo de provedor passa por `redact(text, key)` antes de ir para log ou evento.
- `SUPABASE_SERVICE_ROLE_KEY` existe só no ambiente do executor; mensagens de erro de configuração citam o nome da variável, nunca o valor.
- Eventos do agente (`agent_started`, `agent_result`, `agent_error`) entram só por `add_agent_event`, que exige o claim do executor.
- O agente só cria versão `base`, só em `gerando` ou `base_em_revisao` (regra do Plano 1). Fora disso, falha sem chamar provedor.
- Comentários não vão ao agente; mensagens `@Pessoa` já chegam ao banco com `to_agent = false` e nunca são reivindicadas.
- Mensagens de erro mostradas no chat em português do Brasil, com o texto exato da tabela da Task 2.
- Arquivo gerado: `team-files/<team_id>/<piece_id>/<uuid>.<png|jpg|webp>` (uuid em minúsculas), até 25 MB, tipos `image/png`, `image/jpeg`, `image/webp`.
- Os testes nunca chamam provedor real, exceto `tests/live/`, que só roda com chaves `LIVE_*` no ambiente.
- Provedores deste plano: texto `anthropic` e `openai`; imagem `gemini` e `fal`. `krea` fica fora até a designer confirmar (spec, seção 6).

## Review Focus

1. **Provedor devolve a chave no texto de erro** (ex.: "invalid api key sk-..."): a chave não aparece no evento `agent_error` nem no log. Testes: Task 4 `redacts the key from provider error details`; Task 8 `agent_error never contains the key`.
2. **Mensagem para o agente com a peça em `acabamento` ou `aprovada`:** erro claro `wrong_status`, mensagem `failed`, nenhum provedor chamado e nenhuma chave lida. Teste na Task 8: `does not call providers outside gerando/base_em_revisao`.
3. **Redirecionamento chega durante a geração:** é incorporado na rodada seguinte, respondido uma única vez e nunca perdido. Teste na Task 8: `folds messages queued during generation into the next round`.
4. **Claim perdido no meio da geração** (executor lento, `release_stale_claims` devolveu a mensagem): nenhuma versão duplicada, arquivo enviado removido, nenhum evento do executor antigo. Teste na Task 8: `claim lost: no version, uploaded file removed`.
5. **Time sem chave do provedor, ou chave removida com a mensagem na fila:** erro `missing_key` legível, mensagem `failed`, o worker segue atendendo outras peças. Testes: Task 8 `missing key fails the message with missing_key`; Task 9 `worker keeps serving after a failed job`.

---

## Estrutura de arquivos

```
supabase/migrations/0009_agent_events.sql   # RPC add_agent_event
packages/shared/src/agent.ts                 # catálogo de modelos, escolha de modelo, corpos de eventos do agente, erros
packages/executor/
  package.json                               # @sala/executor; deps: @sala/shared, @supabase/supabase-js, zod
  Dockerfile
  src/config.ts      # loadConfig(env)
  src/log.ts         # logger JSON por linha
  src/db.ts          # ExecutorDb: RPCs, leitura de contexto, Storage
  src/providers/types.ts      # interfaces de provedor e ProviderError
  src/providers/http.ts       # postJson com timeout, 1 nova tentativa e redação
  src/providers/openai.ts
  src/providers/anthropic.ts
  src/providers/gemini.ts
  src/providers/fal.ts
  src/providers/index.ts      # createProviders(fetchFn)
  src/orchestrator.ts         # prompt do orquestrador e parse do plano
  src/job.ts                  # processClaim: rodadas de uma reivindicação
  src/worker.ts               # runWorker: slots, polling, varredura de claims velhos
  src/main.ts                 # entrypoint e desligamento
tests/
  db/agent-events.test.ts
  shared/agent.test.ts
  executor/*.test.ts
  helpers/fake-providers.ts
  live/providers.live.test.ts # opcional, só com LIVE_*
```

---

### Task 1: Eventos do agente no banco

**Files:**
- Create: `supabase/migrations/0009_agent_events.sql`
- Test: `tests/db/agent-events.test.ts`

**Interfaces:**
- Consumes: `session_events`, `createPieceFixture`, `createClaimedMessage`, `TEST_EXECUTOR`, `serviceClient` (Plano 1).
- Produces (SQL): `public.add_agent_event(p_source_event bigint, p_executor text, p_kind public.event_kind, p_body jsonb) returns public.session_events`. Security invoker, `set search_path = ''`, `execute` só para `service_role` (revogado de `public`, `anon`, `authenticated`).
  - `p_kind` precisa estar em (`agent_started`,`agent_result`,`agent_error`), senão `22023`.
  - `p_body` precisa ser objeto JSON, senão `22023`.
  - Trava (`for update`) a mensagem `p_source_event` com `delivery='claimed'` e `claimed_by=p_executor`; sem ela, `42501` `'source message is not claimed by this executor'`.
  - Insere com `piece_id`/`team_id` da mensagem, `author_id null`, `to_agent false`, `delivery 'not_applicable'`.

- [x] **Step 1: Write the failing tests** em `tests/db/agent-events.test.ts`

```ts
it('executor adds agent event on its claimed message', async () => {
  const f = await createPieceFixture(); const src = await createClaimedMessage(f)
  const { data, error } = await serviceClient().rpc('add_agent_event', {
    p_source_event: src, p_executor: TEST_EXECUTOR, p_kind: 'agent_started', p_body: { message_ids: [src] } })
  expect(error).toBeNull()
  expect(data).toMatchObject({ piece_id: f.pieceId, kind: 'agent_started', author_id: null, to_agent: false, delivery: 'not_applicable' })
})
it('rejects other executor', async () => { /* p_executor 'other': error.code '42501' */ })
it('rejects non-agent kinds', async () => { /* p_kind 'approval': error.code '22023' */ })
it('rejects non-object body', async () => { /* p_body [] : error.code '22023' */ })
it('authenticated cannot call add_agent_event', async () => { /* rpc como admin: error not null */ })
it('members of the team see the agent event; other team does not', async () => {})
```

- [x] **Step 2: Run to verify fail.** Run: `pnpm test tests/db/agent-events.test.ts`. Expected: FAIL (função não existe).
- [x] **Step 3: Escrever `0009_agent_events.sql`** no padrão de `0005_inbox.sql` (comentário de cabeçalho, `revoke`/`grant` no fim).
- [x] **Step 4: Run.** Run: `pnpm db:reset && pnpm test tests/db/agent-events.test.ts`. Expected: PASS.
- [x] **Step 5: Commit.** `git add -A && git commit -m "feat(db): agent events written under the executor claim"`

---

### Task 2: Contrato compartilhado do agente

**Files:**
- Create: `packages/shared/src/agent.ts`
- Modify: `packages/shared/package.json` (`exports` ganha `"./agent": "./src/agent.ts"`)
- Modify: `tsconfig.json` (`allowImportingTsExtensions: true`, `erasableSyntaxOnly: true`)
- Test: `tests/shared/agent.test.ts`

**Interfaces:**
- Consumes: `PROVIDERS`, `ProviderSchema`, `Provider`, `PieceStatus` de `domain.ts`.
- Produces (`packages/shared/src/agent.ts`):
  - `type ModelCapability = 'text' | 'image'`
  - `type CatalogModel = { provider: Provider; model: string; label: string; capability: ModelCapability; maxReferenceImages: number }`
  - `MODEL_CATALOG: readonly CatalogModel[]`. A ordem é a preferência do modelo padrão:

    | provider | model | label | capability | maxReferenceImages |
    |---|---|---|---|---|
    | `anthropic` | `claude-sonnet-5-5` | Claude Sonnet 5.5 | text | 0 |
    | `openai` | `gpt-6-astra` | GPT-6 Astra | text | 0 |
    | `anthropic` | `claude-opus-5-5` | Claude Opus 5.5 | text | 0 |
    | `gemini` | `gemini-nano-banana-2.1` | Nano Banana 2.1 | image | 5 |
    | `fal` | `fal-ai/flux-pro/kontext/max/multi` | Flux Kontext Max | image | 4 |
    | `gemini` | `gemini-3-pro-image` | Nano Banana Pro | image | 10 |

  - `ModelRefSchema = z.object({ provider: ProviderSchema, model: z.string().min(1) })`, `type ModelRef`
  - `ModelChoiceSchema = z.object({ text: ModelRefSchema.optional(), image: ModelRefSchema.optional() }).strict()`, `type ModelChoice`. É o formato de `p_model` em `post_message`; o Plano 3 envia neste formato.
  - `findModel(ref: ModelRef, capability: ModelCapability): CatalogModel | undefined`
  - `AGENT_ERROR_CODES = ['missing_key','invalid_model','wrong_status','provider_error','timeout','invalid_output','internal'] as const`, `type AgentErrorCode`
  - `AgentStartedBodySchema`: `{ message_ids: number[]; round: number; models: { text: ModelRef | null; image: ModelRef | null }; reference_count: number; dropped_reference_ids: string[] }`
  - `AgentResultBodySchema`: `{ message_ids: number[]; round: number; version_id: string; version_number: number; image_prompt: string | null }` (o `image_prompt` é o prompt visível no chat, recolhido por padrão no Plano 3)
  - `AgentErrorBodySchema`: `{ message_ids: number[]; round: number; code: AgentErrorCode; message: string; image_prompt: string | null }`
  - `agentErrorMessage(e: AgentErrorInput): string`, com `AgentErrorInput` união discriminada por `code`. Textos exatos:

    | code | campos | texto |
    |---|---|---|
    | `missing_key` | `provider` | `Nenhuma chave cadastrada para ${provider}. Peça ao admin do time para cadastrar.` |
    | `missing_key` | `capability` (sem provider) | `Nenhuma chave cadastrada para um provedor de ${capability === 'text' ? 'texto' : 'imagem'}. Peça ao admin do time para cadastrar.` |
    | `invalid_model` | `model`, `capability` | `O modelo ${model} não está disponível para ${capability === 'text' ? 'texto' : 'imagem'}.` |
    | `wrong_status` | `status: PieceStatus` | `A peça está em ${status}. Volte uma etapa para gerar novas versões base.` |
    | `provider_error` | `provider`, `detail` | `${provider} recusou o pedido: ${detail}` |
    | `timeout` | `provider` | `${provider} não respondeu a tempo. Tente de novo.` |
    | `invalid_output` | `provider` | `${provider} devolveu uma resposta que o agente não entendeu. Tente de novo.` |
    | `internal` | — | `Erro interno do agente. Tente de novo.` |

- [x] **Step 1: Write the failing tests** em `tests/shared/agent.test.ts`

```ts
it('catalog only uses known providers and has a text and an image model', () => {
  for (const m of MODEL_CATALOG) expect(PROVIDERS).toContain(m.provider)
  expect(MODEL_CATALOG.some(m => m.capability === 'text')).toBe(true)
  expect(MODEL_CATALOG.some(m => m.capability === 'image')).toBe(true)
})
it('findModel requires the capability', () => {
  expect(findModel({ provider: 'gemini', model: 'gemini-nano-banana-2.1' }, 'image')?.label).toBe('Nano Banana 2.1')
  expect(findModel({ provider: 'gemini', model: 'gemini-nano-banana-2.1' }, 'text')).toBeUndefined()
})
it('ModelChoiceSchema rejects unknown keys and providers', () => {
  expect(ModelChoiceSchema.safeParse({ text: { provider: 'openai', model: 'gpt-6-astra' } }).success).toBe(true)
  expect(ModelChoiceSchema.safeParse({ video: {} }).success).toBe(false)
  expect(ModelChoiceSchema.safeParse({ image: { provider: 'midjourney', model: 'x' } }).success).toBe(false)
})
it('error messages match the fixed copy', () => {
  expect(agentErrorMessage({ code: 'missing_key', provider: 'gemini' }))
    .toBe('Nenhuma chave cadastrada para gemini. Peça ao admin do time para cadastrar.')
  expect(agentErrorMessage({ code: 'wrong_status', status: 'acabamento' }))
    .toBe('A peça está em acabamento. Volte uma etapa para gerar novas versões base.')
})
```

- [x] **Step 2: Run to verify fail.** Run: `pnpm test tests/shared/agent.test.ts`. Expected: FAIL (módulo não existe).
- [x] **Step 3: Conferir os IDs de modelo.** Consultar no Context7 a documentação atual de OpenAI, Anthropic, Gemini e fal. Se algum ID da tabela não existir mais, trocar pelo equivalente atual e registrar a troca numa nota no fim desta task. `MODEL_CATALOG` é o único lugar com IDs de modelo.
- [x] **Step 4: Implementar `agent.ts`** e as mudanças em `package.json` e `tsconfig.json`.
- [x] **Step 5: Run.** Run: `pnpm test tests/shared/agent.test.ts && pnpm typecheck`. Expected: PASS, sem erro de tipo.
- [x] **Step 6: Commit.** `git add -A && git commit -m "feat(shared): model catalog, model choice and agent event contract"`

> **Nota (Step 3, 2026-10-25):** IDs conferidos no Context7 (Anthropic, OpenAI, Gemini, fal); todos existem, nenhuma troca. A doc do Gemini lista até 14 referências no total (Nano Banana Pro: até 6 objetos em alta fidelidade); os limites da tabela ficam como estão.

---

### Task 3: Pacote do executor — configuração, log e acesso ao banco

**Files:**
- Create: `packages/executor/package.json`, `packages/executor/src/config.ts`, `packages/executor/src/log.ts`, `packages/executor/src/db.ts`
- Modify: `tests/helpers/supabase.ts` (`createClaimedMessage` ganha opções; novo `loadEvent`)
- Test: `tests/executor/config.test.ts`, `tests/executor/db.test.ts`

**Interfaces:**
- Consumes: RPCs listadas no cabeçalho, `add_agent_event` (Task 1), `PieceKind`, `PieceStatus`, `Provider` (`domain.ts`).
- Produces (`config.ts`): `loadConfig(env: NodeJS.ProcessEnv): Config`. Valida com Zod e lança `Error` listando os nomes inválidos, sem valores.

  | Variável | Campo | Padrão | Regra |
  |---|---|---|---|
  | `SUPABASE_URL` | `supabaseUrl` | — | URL obrigatória |
  | `SUPABASE_SERVICE_ROLE_KEY` | `serviceRoleKey` | — | obrigatória |
  | `EXECUTOR_ID` | `executorId` | `${os.hostname()}-${process.pid}` | não vazio |
  | `EXECUTOR_CONCURRENCY` | `concurrency` | `4` | inteiro 1..32 |
  | `POLL_INTERVAL_MS` | `pollIntervalMs` | `1000` | inteiro ≥ 100 |
  | `TOUCH_INTERVAL_MS` | `touchIntervalMs` | `30000` | inteiro ≥ 1000 |
  | `STALE_AFTER_SECONDS` | `staleAfterSeconds` | `300` | `touchIntervalMs * 3 <= staleAfterSeconds * 1000` |
  | `SWEEP_INTERVAL_MS` | `sweepIntervalMs` | `60000` | inteiro ≥ 1000 |
  | `TEXT_TIMEOUT_MS` | `textTimeoutMs` | `120000` | inteiro ≥ 1000 |
  | `IMAGE_TIMEOUT_MS` | `imageTimeoutMs` | `300000` | inteiro ≥ 1000 |
  | `SHUTDOWN_GRACE_MS` | `shutdownGraceMs` | `120000` | inteiro ≥ 0 |

- Produces (`log.ts`): `type Logger = { info(msg: string, fields?: Record<string, unknown>): void; warn(...); error(...) }`; `createLogger(write?: (line: string) => void): Logger`. Uma linha JSON por chamada: `{ level, msg, time, ...fields }`. Padrão `write` = `process.stdout.write(line + '\n')`.
- Produces (`db.ts`):
  - `type InboxMessage = { id: number; piece_id: string; team_id: string; author_id: string | null; body: { text: string; model: unknown; reference_asset_ids: string[] } }`
  - `type HistoryMessage = { id: number; author: string; text: string; model: unknown; reference_asset_ids: string[] }`
  - `type PieceContext = { piece: { id: string; team_id: string; campaign_id: string; title: string; kind: PieceKind; status: PieceStatus }; campaignName: string; history: HistoryMessage[]; latestVersion: { id: string; number: number; image_path: string | null; caption: string | null } | null; lastImagePrompt: string | null; keyedProviders: Provider[]; memberNames: Record<string, string> }`
  - `class ClaimLostError extends Error` (lançada quando a RPC responde `42501`)
  - `createExecutorDb(client: SupabaseClient, executorId: string): ExecutorDb`, com:
    - `claimNext(): Promise<InboxMessage | null>`
    - `absorbPending(pieceId: string): Promise<InboxMessage[]>`
    - `touchClaim(pieceId: string): Promise<void>`
    - `complete(eventId: number, status: 'done' | 'failed'): Promise<void>`
    - `releaseStale(olderThanSeconds: number): Promise<number>` (envia `` `${n} seconds` ``)
    - `addAgentEvent(sourceEvent: number, kind: 'agent_started' | 'agent_result' | 'agent_error', body: object): Promise<void>`
    - `addAgentVersion(pieceId: string, imagePath: string | null, caption: string | null, sourceEvent: number): Promise<{ id: string; number: number }>`
    - `getProviderKey(teamId: string, provider: Provider): Promise<string | null>`
    - `loadPieceContext(pieceId: string): Promise<PieceContext>`
    - `loadReferencePaths(teamId: string, campaignId: string, ids: string[]): Promise<{ id: string; storage_path: string }[]>` (filtra por time e campanha, mantém a ordem de `ids`)
    - `downloadFile(path: string): Promise<{ bytes: Uint8Array; mimeType: string }>`
    - `uploadFile(path: string, bytes: Uint8Array, mimeType: string): Promise<void>` (`upsert: false`)
    - `removeFile(path: string): Promise<void>`
  - Regras de `loadPieceContext`:
    - `history`: mensagens `user_message` da peça com `to_agent = true` e `delivery in ('claimed','done','failed')`, as 30 mais recentes, em ordem crescente de `id`. `author` = `team_members.display_name`, ou `'Alguém'` sem autor.
    - `latestVersion`: versão de maior `number`.
    - `lastImagePrompt`: `body.image_prompt` do `agent_result` mais recente.
    - `keyedProviders`: `provider_keys.provider` do time.
    - `memberNames`: `user_id` → `display_name` de todos os membros do time (nomes dos autores do lote atual).
  - Qualquer erro do Supabase que não seja `42501` vira `Error` com a mensagem do Supabase e o nome da operação.
- Produces (`tests/helpers/supabase.ts`):
  - `createClaimedMessage(f, executor = TEST_EXECUTOR, opts: { text?: string; model?: unknown; referenceAssetIds?: string[] } = {})`, compatível com as chamadas atuais.
  - `loadEvent(id: number): Promise<InboxMessage>`.

- [x] **Step 1: Write the failing tests**

```ts
// tests/executor/config.test.ts
it('applies defaults', () => {
  const c = loadConfig({ SUPABASE_URL: 'http://127.0.0.1:55321', SUPABASE_SERVICE_ROLE_KEY: 'x' })
  expect(c).toMatchObject({ concurrency: 4, pollIntervalMs: 1000, touchIntervalMs: 30000, staleAfterSeconds: 300 })
})
it('names missing variables without echoing values', () => {
  expect(() => loadConfig({ SUPABASE_SERVICE_ROLE_KEY: 'secret-value' })).toThrow(/SUPABASE_URL/)
  try { loadConfig({ SUPABASE_SERVICE_ROLE_KEY: 'secret-value' }) } catch (e) { expect(String(e)).not.toContain('secret-value') }
})
it('rejects touch interval too close to stale threshold', () => {
  expect(() => loadConfig({ SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'x', TOUCH_INTERVAL_MS: '200000' })).toThrow(/TOUCH_INTERVAL_MS/)
})

// tests/executor/db.test.ts (Supabase local)
it('loadPieceContext returns history with author names, keyed providers and latest version', async () => {})
it('history excludes queued and people-only messages', async () => {})
it('addAgentVersion throws ClaimLostError when the claim is gone', async () => {})
it('absorbPending and touchClaim work on the executor claim', async () => {})
it('loadReferencePaths ignores ids from another campaign', async () => {})
it('uploadFile then downloadFile round-trips bytes and mime type', async () => {})
```

- [x] **Step 2: Run to verify fail.** Run: `pnpm test tests/executor`. Expected: FAIL (módulos não existem).
- [x] **Step 3: Criar `packages/executor/package.json`** (`"name": "@sala/executor"`, `"type": "module"`, `"private": true`, deps `@sala/shared: workspace:*`, `@supabase/supabase-js`, `zod` nas mesmas versões da raiz) e rodar `pnpm install`.
- [x] **Step 4: Implementar `config.ts`, `log.ts`, `db.ts` e os helpers.**
- [x] **Step 5: Run.** Run: `pnpm test tests/executor && pnpm typecheck`. Expected: PASS.
- [x] **Step 6: Commit.** `git add -A && git commit -m "feat(executor): config, logger and Supabase access layer"`

---

### Task 4: HTTP e adaptadores de texto (Anthropic e OpenAI)

**Files:**
- Create: `packages/executor/src/providers/types.ts`, `http.ts`, `anthropic.ts`, `openai.ts`, `index.ts`
- Test: `tests/executor/providers-text.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  - `type TextRequest = { model: string; system: string; prompt: string; maxOutputTokens: number }`
  - `type TextProvider = { generateText(key: string, req: TextRequest, signal: AbortSignal): Promise<string> }`
  - `type InputImage = { bytes: Uint8Array; mimeType: string }`
  - `type ImageRequest = { model: string; prompt: string; images: InputImage[] }`
  - `type GeneratedImage = { bytes: Uint8Array; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' }`
  - `type ImageProvider = { generateImage(key: string, req: ImageRequest, signal: AbortSignal): Promise<GeneratedImage> }`
  - `type Providers = { text: Partial<Record<Provider, TextProvider>>; image: Partial<Record<Provider, ImageProvider>> }`
  - `class ProviderError extends Error`, com campos `code: 'provider_error' | 'timeout' | 'invalid_output'`, `provider: Provider`, `detail: string` atribuídos no construtor `(code, provider, detail)` (sem parameter properties).
- Produces (`http.ts`):
  - `redact(text: string, key: string): string`: troca toda ocorrência de `key` por `[chave]`. Chave vazia devolve o texto igual.
  - `postJson(o: { provider: Provider; url: string; headers: Record<string, string>; body: unknown; key: string; signal: AbortSignal; fetchFn: typeof fetch }): Promise<unknown>`
    - Uma nova tentativa, depois de 2000 ms, para status 429, 5xx ou erro de rede. Nenhuma nova tentativa para outros 4xx.
    - Resposta não ok: `ProviderError('provider_error', provider, detail)`. O `detail` é `error.message` do JSON (formatos OpenAI/Anthropic/Gemini) ou `HTTP <status>`, redigido e cortado em 300 caracteres.
    - `signal` abortado por timeout: `ProviderError('timeout', ...)`.
    - JSON inválido na resposta: `ProviderError('invalid_output', ...)`.
- Produces (`anthropic.ts`): `createAnthropic(fetchFn: typeof fetch): TextProvider`. `POST https://api.anthropic.com/v1/messages`, headers `x-api-key`, `anthropic-version: 2023-06-01`, corpo `{ model, max_tokens, system, messages: [{ role: 'user', content: prompt }] }`. Resultado: os blocos `content[].type === 'text'` concatenados. Vazio: `invalid_output`.
- Produces (`openai.ts`): `createOpenAI(fetchFn: typeof fetch): TextProvider`. `POST https://api.openai.com/v1/responses`, header `Authorization: Bearer <key>`, corpo `{ model, instructions: system, input: prompt, max_output_tokens }`. Resultado: `output[]` do tipo `message`, com `content[]` do tipo `output_text`, concatenados. Vazio: `invalid_output`.
- Produces (`index.ts`): `createProviders(fetchFn: typeof fetch = fetch): Providers`, com `text: { anthropic, openai }` e `image: {}` (as Tasks 5 e 6 completam).

- [x] **Step 1: Write the failing tests** com um `fetch` falso que grava as chamadas.

```ts
it('anthropic sends the request shape and joins text blocks', async () => {
  const fake = fakeFetch([{ status: 200, json: { content: [{ type: 'text', text: '{"caption":' }, { type: 'text', text: '"Oi"}' }] } }])
  const out = await createAnthropic(fake.fn).generateText('sk-ant-test-0000000000', { model: 'claude-sonnet-5-5', system: 'S', prompt: 'P', maxOutputTokens: 2000 }, AbortSignal.timeout(5000))
  expect(out).toBe('{"caption":"Oi"}')
  expect(fake.calls[0]).toMatchObject({ url: 'https://api.anthropic.com/v1/messages', headers: { 'x-api-key': 'sk-ant-test-0000000000', 'anthropic-version': '2023-06-01' } })
  expect(fake.calls[0].body).toEqual({ model: 'claude-sonnet-5-5', max_tokens: 2000, system: 'S', messages: [{ role: 'user', content: 'P' }] })
})
it('openai sends the request shape and reads output_text', async () => {})
it('retries once on 429 then succeeds', async () => { /* 2 chamadas; use vi.useFakeTimers para os 2000 ms */ })
it('does not retry on 401', async () => { /* 1 chamada; ProviderError code provider_error */ })
it('redacts the key from provider error details', async () => {
  // 401 com { error: { message: 'Incorrect API key provided: sk-live-abcdef1234567890' } }
  // expect: err.detail não contém a chave e contém '[chave]'
})
it('timeout becomes ProviderError timeout', async () => { /* fetch que espera o abort */ })
```

- [x] **Step 2: Run to verify fail.** Run: `pnpm test tests/executor/providers-text.test.ts`. Expected: FAIL.
- [x] **Step 3: Implementar os arquivos.** Conferir no Context7 os formatos atuais de request e response das duas APIs antes de fechar o parse.
- [x] **Step 4: Run.** Run: `pnpm test tests/executor/providers-text.test.ts && pnpm typecheck`. Expected: PASS.
- [x] **Step 5: Commit.** `git add -A && git commit -m "feat(executor): http helper with redaction and text providers"`

---

### Task 5: Adaptador de imagem Gemini (Nano Banana)

**Files:**
- Create: `packages/executor/src/providers/gemini.ts`
- Modify: `packages/executor/src/providers/index.ts` (`image.gemini`)
- Test: `tests/executor/providers-gemini.test.ts`

**Interfaces:**
- Consumes: `postJson`, `ProviderError`, tipos de `types.ts` (Task 4).
- Produces: `createGemini(fetchFn: typeof fetch): ImageProvider`.
  - `POST https://generativelanguage.googleapis.com/v1/models/${model}:generateContent`, header `x-goog-api-key`.
  - Corpo: `{ contents: [{ parts: [{ text: prompt }, ...images.map(i => ({ inline_data: { mime_type, data: base64 } }))] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }`.
  - Resultado: a primeira parte de `candidates[0].content.parts` com `inlineData` (ou `inline_data`), decodificada de base64. `mimeType` fora de png/jpeg/webp: `invalid_output`.
  - Sem parte de imagem: `ProviderError('provider_error', 'gemini', detail)`. O `detail` é o texto devolvido pelo modelo ou `finishReason` (ex.: recusa por segurança), redigido e cortado em 300 caracteres.

- [ ] **Step 1: Write the failing tests**

```ts
it('sends prompt and reference images as inline_data', async () => {
  // 2 imagens de entrada; expect parts[1].inline_data.mime_type 'image/png' e data em base64; header x-goog-api-key
})
it('decodes the returned image', async () => { /* inlineData { mimeType: 'image/png', data: base64('png-bytes') }: bytes iguais */ })
it('no image part becomes provider_error with the model text', async () => {
  // parts [{ text: 'Não posso gerar isso' }], finishReason 'SAFETY': err.code 'provider_error', detail contém 'Não posso gerar isso'
})
```

- [ ] **Step 2: Run to verify fail.** Run: `pnpm test tests/executor/providers-gemini.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implementar `gemini.ts`.** Conferir no Context7 o endpoint (`v1` ou `v1beta`) e o formato de `inlineData` da resposta.
- [ ] **Step 4: Run.** Run: `pnpm test tests/executor/providers-gemini.test.ts && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(executor): Gemini image provider with reference images"`

---

### Task 6: Adaptador de imagem fal (Flux Kontext)

Segundo provedor de imagem. É o item 4 da ordem de corte do spec ("mais de um provedor por tipo"): se faltar tempo, pule esta task e remova a linha `fal` de `MODEL_CATALOG`.

**Files:**
- Create: `packages/executor/src/providers/fal.ts`
- Modify: `packages/executor/src/providers/index.ts` (`image.fal`)
- Test: `tests/executor/providers-fal.test.ts`

**Interfaces:**
- Consumes: `postJson`, `ProviderError`, tipos de `types.ts`.
- Produces: `createFal(fetchFn: typeof fetch): ImageProvider`.
  - Com imagens: `POST https://fal.run/${model}` (`fal-ai/flux-pro/kontext/max/multi`). Sem imagens: `POST https://fal.run/fal-ai/flux-pro/kontext/max/text-to-image`, porque o endpoint `multi` exige `image_urls`.
  - Header `Authorization: Key <key>`.
  - Corpo: `{ prompt, image_urls: images.map(dataUri), sync_mode: true, output_format: 'png' }` (sem `image_urls` no text-to-image). As referências vão como data URI, sem URL assinada do Storage, para nenhum arquivo privado do time ficar acessível por link.
  - Resultado: `images[0].url`. Se for data URI, decodifica; se for `https://`, baixa com `fetchFn` (sem a chave no header). Nenhuma imagem: `invalid_output`.

- [ ] **Step 1: Write the failing tests**

```ts
it('uses the multi endpoint with data URIs when there are references', async () => {})
it('uses text-to-image without references', async () => {})
it('decodes a data URI result', async () => {})
it('downloads an https result without sending the key', async () => { /* 2ª chamada sem header Authorization */ })
```

- [ ] **Step 2: Run to verify fail.** Run: `pnpm test tests/executor/providers-fal.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implementar `fal.ts`.** Conferir no Context7 se os endpoints `kontext/max/multi` e `kontext/max/text-to-image` aceitam data URI e `sync_mode`.
- [ ] **Step 4: Run.** Run: `pnpm test tests/executor/providers-fal.test.ts && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(executor): fal Flux Kontext image provider"`

---

### Task 7: Orquestrador (monta o prompt)

**Files:**
- Create: `packages/executor/src/orchestrator.ts`
- Test: `tests/executor/orchestrator.test.ts`

**Interfaces:**
- Consumes: `PieceContext`, `InboxMessage` (Task 3), `TextProvider`, `ProviderError` (Task 4), `PieceKind`.
- Produces:
  - `type Plan = { imagePrompt: string | null; caption: string | null }`
  - `ORCHESTRATOR_SYSTEM: string`, com o texto exato abaixo.
  - `buildOrchestratorPrompt(ctx: PieceContext, batch: InboxMessage[], referenceCount: number, hasCurrentImage: boolean): string`. O nome de cada mensagem do lote vem de `ctx.memberNames[author_id]`, ou `'Alguém'`.
  - `parsePlan(raw: string, kind: PieceKind, provider: Provider): Plan`. Pega o trecho do primeiro `{` ao último `}`, faz `JSON.parse` e valida `{ image_prompt?: string, caption?: string }`. Apara os valores. Regras por tipo: `imagem` exige `image_prompt` e descarta `caption`; `texto` exige `caption` e descarta `image_prompt`; `imagem_texto` exige os dois. Falta, valor vazio ou JSON inválido: `ProviderError('invalid_output', provider, ...)`.
  - `planRound(o: { text: TextProvider; provider: Provider; key: string; model: string; ctx: PieceContext; batch: InboxMessage[]; referenceCount: number; hasCurrentImage: boolean; signal: AbortSignal }): Promise<Plan>`, com `maxOutputTokens: 2000`.

`ORCHESTRATOR_SYSTEM` (texto exato):

```
Você é o agente de criação da Sala da Campanha e trabalha para um time de marketing.
Leia o pedido atual e o histórico da peça. Responda SOMENTE com um objeto JSON, sem nenhum texto fora dele, com as chaves pedidas:
- "image_prompt": prompt em inglês para o gerador de imagem, com cena, composição, luz e estilo. As imagens anexadas são fotos de referência do produto; quando a primeira for a versão atual da peça, peça ao gerador para editá-la. Peça sempre para manter o produto fiel às referências.
- "caption": o texto da peça em português do Brasil, a menos que o pedido peça outro idioma.
O pedido atual tem prioridade sobre o histórico. Mensagens do pedido atual ajustam o pedido anterior; não começam uma peça nova.
```

Formato de `buildOrchestratorPrompt` (uma linha por item, nesta ordem):

```
Campanha: <campaignName>
Peça: <title> (tipo: <kind>; chaves pedidas: image_prompt | caption | image_prompt e caption)
Imagens anexadas: <referenceCount>[; a primeira é a versão atual da peça]
Prompt de imagem anterior: <lastImagePrompt ou (nenhum)>
Legenda atual: <latestVersion.caption ou (nenhuma)>
Histórico:
[#<id>] <author>: <text>          (history sem as mensagens do batch; "(vazio)" se não houver)
Pedido atual:
[#<id>] <nome>: <text>            (cada mensagem do batch, em ordem)
```

- [ ] **Step 1: Write the failing tests**

```ts
it('lists history before the current request and excludes batch ids from history', () => {
  const p = buildOrchestratorPrompt(ctx, batch, 2, true)
  expect(p.indexOf('Histórico:')).toBeLessThan(p.indexOf('Pedido atual:'))
  expect(p).toContain('Imagens anexadas: 2; a primeira é a versão atual da peça')
  expect(p.split('Pedido atual:')[0]).not.toContain(`[#${batch[0].id}]`)
})
it('asks for both keys on imagem_texto', () => { /* contém 'chaves pedidas: image_prompt e caption' */ })
it('parses JSON wrapped in prose or code fences', () => {
  expect(parsePlan('Claro!\n```json\n{"image_prompt":" a bottle "}\n```', 'imagem', 'anthropic')).toEqual({ imagePrompt: 'a bottle', caption: null })
})
it('texto piece drops image_prompt', () => { /* {"caption":"x","image_prompt":"y"}: { imagePrompt: null, caption: 'x' } */ })
it('missing required key is invalid_output', () => { /* imagem_texto sem caption: ProviderError code invalid_output */ })
it('non-JSON output is invalid_output', () => {})
```

- [ ] **Step 2: Run to verify fail.** Run: `pnpm test tests/executor/orchestrator.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implementar `orchestrator.ts`.**
- [ ] **Step 4: Run.** Run: `pnpm test tests/executor/orchestrator.test.ts && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(executor): orchestrator prompt and plan parsing"`

---

### Task 8: Processar uma reivindicação (rodadas, redirecionamento e erros)

**Files:**
- Create: `packages/executor/src/job.ts`, `tests/helpers/fake-providers.ts`
- Test: `tests/executor/job.test.ts`

**Interfaces:**
- Consumes: `ExecutorDb`, `ClaimLostError`, `InboxMessage`, `PieceContext` (Task 3); `Providers`, `ProviderError`, `redact` (Task 4); `planRound` (Task 7); `MODEL_CATALOG`, `findModel`, `ModelChoiceSchema`, `agentErrorMessage`, corpos de evento (Task 2); `Logger`.
- Produces (`job.ts`):
  - `type JobDeps = { db: ExecutorDb; providers: Providers; log: Logger; touchIntervalMs: number; textTimeoutMs: number; imageTimeoutMs: number }`
  - `type RoundOutcome = 'ok' | 'failed' | 'claim_lost'`
  - `processClaim(deps: JobDeps, first: InboxMessage): Promise<void>`. Nunca lança: erros inesperados viram log e `agent_error` `internal`.
  - `resolveModels(kind: PieceKind, batch: InboxMessage[], history: HistoryMessage[], keyed: Provider[]): { text: CatalogModel; image: CatalogModel | null } | AgentErrorInput`
- Produces (`tests/helpers/fake-providers.ts`): `fakeProviders(o?: { plan?: string | (() => Promise<string>); image?: () => Promise<GeneratedImage>; textError?: ProviderError }): { providers: Providers; calls: { text: TextRequest[]; image: ImageRequest[] } }`. Registra `anthropic`/`openai` como texto e `gemini`/`fal` como imagem.

Algoritmo de `processClaim` (a ordem importa):

```
batch = [first, ...await db.absorbPending(first.piece_id)]
round = 1
liga timer: a cada touchIntervalMs, db.touchClaim(piece); erro só vai para o log
try:
  loop:
    outcome = await runRound(deps, batch, round)
    if outcome == 'claim_lost': sair            # os claims já não são deste executor
    if outcome == 'failed':
      complete(cada mensagem do batch, 'failed'); sair   # as que estão na fila ficam para o próximo claim
    next = await db.absorbPending(piece)           # absorve ANTES de concluir: a peça nunca fica sem claim entre rodadas
    complete(cada mensagem do batch, 'done')
    if next vazio: sair
    batch = next; round += 1
finally: desliga o timer
```

`runRound(deps, batch, round): Promise<RoundOutcome>`, em ordem:
1. `ctx = loadPieceContext(piece)`. `sourceId` = `id` da última mensagem do batch, usado em todos os eventos e na versão.
2. Status fora de `gerando`/`base_em_revisao`: `agent_error` `wrong_status` → `'failed'`. Nenhuma chave lida, nenhum provedor chamado.
3. `resolveModels`:
   - Escolha = o `body.model` mais recente do batch que não seja null; se não houver, o mais recente do `history`; se não houver, nenhuma.
   - Escolha que não passa em `ModelChoiceSchema`: `invalid_model`.
   - Por capacidade necessária (texto sempre; imagem para `imagem` e `imagem_texto`): se a escolha tem o ref, `findModel(ref, cap)` (sem resultado: `invalid_model`) e provedor em `keyed` (senão: `missing_key` com `provider`). Sem ref, o primeiro item de `MODEL_CATALOG` com essa capacidade e provedor em `keyed` (nenhum: `missing_key` com `capability`).
   - Erro: `agent_error` → `'failed'`.
4. `getProviderKey` para cada provedor escolhido. Null (chave removida depois do cadastro): `missing_key` → `'failed'`.
5. Imagens de entrada (só com modelo de imagem): primeiro a imagem de `ctx.latestVersion` (se tiver `image_path`); depois as referências do batch (união, ordem de chegada). Se o batch não tem referência, usar as da mensagem mais recente do `history` que tenha. Cortar em `maxReferenceImages`; os ids cortados vão em `dropped_reference_ids`. Baixar com `downloadFile`.
6. `addAgentEvent(sourceId, 'agent_started', { message_ids, round, models, reference_count, dropped_reference_ids })`.
7. `planRound` com `AbortSignal.timeout(textTimeoutMs)`.
8. Com imagem: `generateImage` com `AbortSignal.timeout(imageTimeoutMs)`; `uploadFile(`${team}/${piece}/${randomUUID()}.${png|jpg|webp}`)`.
9. `addAgentVersion(piece, path | null, plan.caption, sourceId)`.
   - `ClaimLostError`: `removeFile(path)`, log `warn` → `'claim_lost'`, sem evento.
   - Outro erro: `removeFile(path)` e recarregar o status. Se saiu de `gerando`/`base_em_revisao` (alguém aprovou ou voltou a etapa durante a geração), `agent_error` `wrong_status`; senão, `internal`. Nos dois casos → `'failed'`.
10. `addAgentEvent(sourceId, 'agent_result', { message_ids, round, version_id, version_number, image_prompt })` → `'ok'`.

Erros em qualquer passo: `ProviderError` vira `agent_error` com `code` e `message` de `agentErrorMessage` (o `detail` já vem redigido; redigir de novo com todas as chaves da rodada) e `image_prompt` quando já existe → `'failed'`. `ClaimLostError` em `addAgentEvent` → `'claim_lost'`. Outro erro: log `error` com a mensagem redigida e `agent_error` `internal` → `'failed'`.

- [ ] **Step 1: Write the failing tests** em `tests/executor/job.test.ts` (Supabase local, `fakeProviders`, chaves fictícias com 20+ caracteres via `set_provider_key` como admin, mensagens com `createClaimedMessage` e `loadEvent`)

```ts
it('imagem_texto: one version with image and caption, events started/result, message done', async () => {
  // chaves anthropic + gemini; processClaim
  // expect: 1 piece_version origin 'agente' phase 'base', image_path em `${team}/${piece}/`, caption do plano
  // eventos do executor em ordem: agent_started, version_added, status_changed, agent_result; mensagem 'done'; status 'base_em_revisao'
})
it('texto piece calls only the text provider', async () => { /* calls.image vazio; versão só com caption */ })
it('uses the model chosen in the message', async () => { /* model { text: openai gpt-6-astra, image: fal ... }: calls usam esses modelos */ })
it('defaults to the first catalog model with a key', async () => { /* só chave openai + gemini: texto gpt-6-astra, imagem gemini-nano-banana-2.1 */ })
it('sends current version image first, then references, capped at maxReferenceImages', async () => {
  // versão anterior com imagem + 6 referências, gemini-nano-banana-2.1 (máx. 5): 5 imagens; agent_started.dropped_reference_ids tem 2 ids
})
it('folds messages queued during generation into the next round', async () => {
  // plan() do fake posta uma 2ª mensagem via post_message na 1ª chamada
  // expect: 2 rodadas, 2 versões; agent_result round 2 tem message_ids [id2]; as duas mensagens 'done'; prompt da 2ª rodada contém o texto da 2ª
})
it('does not call providers outside gerando/base_em_revisao', async () => {
  // peça em 'acabamento' (via service role): agent_error code 'wrong_status'; calls vazios; mensagem 'failed'
})
it('missing key fails the message with missing_key', async () => { /* só chave anthropic, nenhuma de imagem: message 'Nenhuma chave cadastrada para um provedor de imagem. Peça ao admin do time para cadastrar.'; calls vazios */ })
it('invalid model choice fails with invalid_model', async () => { /* model { image: { provider: 'gemini', model: 'nope' } } */ })
it('agent_error never contains the key', async () => {
  // textError = ProviderError com detail contendo a chave cadastrada: JSON.stringify do evento e das linhas de log não contém a chave
})
it('claim lost: no version, uploaded file removed', async () => {
  // image() do fake libera o claim (update direto delivery 'queued') antes de responder
  // expect: 0 versões; nenhum objeto novo em `${team}/${piece}/`; nenhum agent_result
})
it('approval during generation: wrong_status, file removed', async () => {})
it('touches the claim while generating', async () => { /* touchIntervalMs 50; image() espera 200 ms; claimed_at mudou */ })
```

- [ ] **Step 2: Run to verify fail.** Run: `pnpm test tests/executor/job.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implementar `fake-providers.ts` e `job.ts`.**
- [ ] **Step 4: Run.** Run: `pnpm test tests/executor/job.test.ts` três vezes seguidas. Expected: PASS nas 3, sem falha intermitente.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(executor): claim rounds with redirection, model resolution and safe errors"`

---

### Task 9: Worker, entrypoint e desligamento

**Files:**
- Create: `packages/executor/src/worker.ts`, `packages/executor/src/main.ts`
- Modify: `package.json` da raiz (script `"executor": "node packages/executor/src/main.ts"`)
- Test: `tests/executor/worker.test.ts`

**Interfaces:**
- Consumes: `processClaim`, `JobDeps` (Task 8); `ExecutorDb`; `loadConfig`, `createLogger`; `createProviders`.
- Produces (`worker.ts`):
  - `type WorkerOptions = { concurrency: number; pollIntervalMs: number; staleAfterSeconds: number; sweepIntervalMs: number }`
  - `runWorker(deps: JobDeps, opts: WorkerOptions, signal: AbortSignal): Promise<void>`
    - `concurrency` slots. Cada slot repete: se `signal` abortado, sai; `claimNext()`; com mensagem, `processClaim`; sem mensagem, espera `pollIntervalMs` (a espera termina cedo no abort).
    - Erro em `claimNext` (rede, banco): log `error` e espera `pollIntervalMs`; o slot não morre.
    - Varredura: `releaseStale(staleAfterSeconds)` ao iniciar e a cada `sweepIntervalMs`; erro só vai para o log.
    - Resolve quando todos os slots saíram. No abort, a rodada em andamento termina normalmente.
- Produces (`main.ts`): lê `loadConfig(process.env)`, cria o client service role (`persistSession: false`, `autoRefreshToken: false`), `createExecutorDb`, `createProviders()`, `createLogger()`. Loga `executor started` com `executorId` e `concurrency` (sem segredos). `SIGTERM`/`SIGINT` abortam o worker; se os slots não saírem em `shutdownGraceMs`, `process.exit(1)` (as mensagens voltam à fila por `release_stale_claims`). Sai com 0 depois de um desligamento limpo.

- [ ] **Step 1: Write the failing tests** em `tests/executor/worker.test.ts`

```ts
beforeAll(async () => {
  // Outros arquivos de teste deixam mensagens 'queued' que claim_next_message pegaria.
  // Os arquivos rodam em sequência, então neste ponto essas mensagens são sobra: marcá-las 'failed'.
  await serviceClient().from('session_events').update({ delivery: 'failed' }).in('delivery', ['queued', 'claimed'])
})
it('end to end: a posted message becomes a version', async () => {
  // runWorker com fakeProviders e concurrency 2; gestor posta via post_message; espera até 10 s pela versão; abort; await runWorker
})
it('two pieces are served in parallel', async () => { /* image() de cada peça espera 500 ms; as duas versões em < 900 ms (em série levaria ≥ 1000 ms) */ })
it('worker keeps serving after a failed job', async () => { /* peça A sem chave (failed), depois peça B ok */ })
it('abort waits for the running round to finish', async () => { /* abort durante image(): a versão é gravada e a mensagem fica 'done' */ })
it('claimNext error does not kill the slot', async () => { /* db com claimNext que falha 1 vez e depois delega */ })
it('main exits on missing config without printing secrets', async () => {
  // spawn `node packages/executor/src/main.ts` com env só SUPABASE_SERVICE_ROLE_KEY=secret-value: exit != 0, stderr contém SUPABASE_URL e não contém secret-value
})
```

- [ ] **Step 2: Run to verify fail.** Run: `pnpm test tests/executor/worker.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implementar `worker.ts` e `main.ts`.**
- [ ] **Step 4: Rodar contra o Supabase local.** Run: `pnpm test tests/executor/worker.test.ts`, depois `SUPABASE_URL=http://127.0.0.1:55321 SUPABASE_SERVICE_ROLE_KEY=<do .env.test> pnpm executor` por alguns segundos e `Ctrl+C`. Expected: testes PASS; o processo loga `executor started` e sai com código 0 no `Ctrl+C`.
- [ ] **Step 5: Rodar a suíte inteira.** Run: `pnpm db:reset && pnpm test && pnpm typecheck`. Expected: todos PASS.
- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat(executor): worker loop, entrypoint and graceful shutdown"`

---

### Task 10: Teste ao vivo opcional, imagem Docker e checklist de deploy

**Files:**
- Create: `tests/live/providers.live.test.ts`, `packages/executor/Dockerfile`, `.dockerignore`
- Modify: este plano (seção "Checklist de deploy do executor", marcar o que foi verificado)

**Interfaces:**
- Consumes: `createProviders`, `planRound`/`parsePlan`, catálogo.
- Produces:
  - Teste ao vivo: um `describe.skipIf(!process.env.LIVE_<PROVIDER>_KEY)` por provedor (`LIVE_ANTHROPIC_KEY`, `LIVE_OPENAI_KEY`, `LIVE_GEMINI_KEY`, `LIVE_FAL_KEY`). Texto: pede `{"caption":"..."}` e passa em `parsePlan`. Imagem: gera 1 imagem com 1 referência PNG pequena e confere o `mimeType`. Nunca imprime a chave. Sem as variáveis, o arquivo inteiro é pulado e `pnpm test` continua sem rede.
  - `Dockerfile`: base `node:24-slim`, `corepack enable`, `pnpm install --frozen-lockfile --prod --filter @sala/executor...`, usuário não root, `CMD ["node", "packages/executor/src/main.ts"]`. Sem `.env*` na imagem (`.dockerignore` exclui `.env*`, `node_modules`, `tests`, `supabase`, `.superpowers`).

- [ ] **Step 1: Escrever `tests/live/providers.live.test.ts`.**
- [ ] **Step 2: Run sem chaves.** Run: `pnpm test tests/live`. Expected: todos os testes pulados (skipped), nenhum erro.
- [ ] **Step 3: Run com chaves (opcional, se o fundador fornecer).** Run: `LIVE_ANTHROPIC_KEY=... LIVE_GEMINI_KEY=... pnpm test tests/live`. Expected: PASS nos provedores com chave. Se falhar por formato de API, corrigir o adaptador e o teste unitário dele juntos.
- [ ] **Step 4: Escrever `Dockerfile` e `.dockerignore`.** Run: `docker build -f packages/executor/Dockerfile -t sala-executor . && docker run --rm sala-executor`. Expected: a imagem builda; o container sai com erro de configuração citando `SUPABASE_URL`.
- [ ] **Step 5: Conferir que a imagem não tem segredo.** Run: `docker run --rm --entrypoint sh sala-executor -c 'ls -a /app; find / -name ".env*" 2>/dev/null'`. Expected: nenhum arquivo `.env`.
- [ ] **Step 6: Commit.** `git add -A && git commit -m "chore(executor): live provider smoke test, Docker image and deploy checklist"`

---

## Decisões deste plano

| Tema | Decisão |
|---|---|
| Hospedagem | Worker Node em container (Fly.io ou Railway), sempre ligado. Edge Functions ficam de fora por causa do limite de tempo com gerações longas e várias rodadas |
| Várias instâncias | Seguras: o claim por peça do Plano 1 impede resposta duplicada |
| Descoberta de mensagens | Polling de `claim_next_message` a cada 1 s por slot; sem Realtime no executor |
| Redirecionamento | Incorporado na rodada seguinte (`absorb_pending` antes de concluir a rodada). A requisição em andamento não é cancelada: as APIs de imagem não aceitam mudança no meio, e cancelar não devolve o custo |
| Lote | Mensagens que chegam juntas viram uma rodada só, com uma versão |
| Falha na rodada | Conclui o lote como `failed` e para; as mensagens na fila ficam para o próximo claim |
| Modelo padrão | O primeiro de `MODEL_CATALOG` com chave cadastrada, por capacidade; a escolha vale até alguém mudar (última escolha da peça) |
| Orquestrador | Sempre o modelo de texto; devolve JSON `{image_prompt, caption}` conforme o tipo da peça |
| Imagem atual | A imagem da versão mais recente entra como primeira referência, para "fundo mais claro" editar o que existe |
| Referências | As do lote; sem nenhuma no lote, as da última mensagem que tinha; cortadas em `maxReferenceImages` |
| Prompt visível | `agent_result.image_prompt` e `agent_error.image_prompt` (o Plano 3 mostra recolhido) |
| Toda mensagem gera | Na V1, toda mensagem ao agente gera uma versão; o agente não responde só com conversa |
| Chave por rodada | Lida a cada rodada, sem cache: troca ou remoção pelo admin vale na hora |
| Imagem para o fal | Data URI, sem URL assinada do Storage |
| Krea | Fora até a designer confirmar o uso pela API |

## Checklist de deploy do executor

- Variáveis no provedor de hospedagem: `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` como segredo; o resto usa os padrões da Task 3.
- `EXECUTOR_ID` único por instância (o padrão `hostname-pid` serve).
- Logs do provedor de hospedagem sem captura de variáveis de ambiente nem de headers HTTP de saída.
- Grace period de desligamento da plataforma ≥ `SHUTDOWN_GRACE_MS` (120 s), para a rodada em andamento terminar.
- A migration `0009_agent_events.sql` aplicada no projeto hospedado antes de subir o executor.
- Os itens do "Checklist de deploy" do Plano 1 continuam valendo (logs do Postgres sem parâmetros de `set_provider_key`).
