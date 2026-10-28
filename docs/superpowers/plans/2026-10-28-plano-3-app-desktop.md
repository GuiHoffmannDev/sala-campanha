# Plano 3 — App Tauri para macOS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar o app desktop da Sala da Campanha para macOS. Qualquer pessoa baixa, entra com Google, Apple ou um código no e-mail, cria o próprio workspace e cadastra as próprias chaves. O app tem campanhas e peças, chat compartilhado com o agente, biblioteca de referências, versões com aprovação, comentários presos à imagem, presença, notificação de menção, membros e convites do workspace e link de compartilhamento. *(Revisão de 2026-10-28, por decisão do fundador: cadastro aberto e workspace próprio.)*

**Architecture:** É uma casca Tauri 2 mínima (Rust só registra plugins) em volta de uma interface React servida pelo Vite. O app fala com o Supabase só com a anon key e a sessão do usuário. Toda escrita passa pelas RPCs e pela RLS dos Planos 1 e 2, mais uma migration nova (`0010`). Nenhuma parte do app usa a service role. A lógica fica em funções puras (`src/lib`) e numa camada de dados (`src/data`) que recebe o `SupabaseClient` por parâmetro. Assim, as duas camadas são testadas sem a janela: a lógica com Vitest, os dados contra o Supabase local. Os componentes (`src/ui`) recebem dados e callbacks por props.

**Tech Stack:** Tauri 2.12 (plugins `deep-link` 2.6, `notification` 2.8, `clipboard-manager` 2.5, `opener` 2.7), Rust 1.99, React 19.3, Vite 8.3, `@vitejs/plugin-react` 6.1, TypeScript 5.9, Vitest 5, Testing Library (`@testing-library/react` 16.3, `user-event` 14.6), jsdom 30, `@supabase/supabase-js` 2, Zod 4, Supabase CLI 2.121.

**Spec:** `docs/superpowers/specs/2026-10-21-sala-campanha-design.md`

**Planos anteriores (interfaces consumidas):**
- `docs/superpowers/plans/2026-10-21-plano-1-fundacao-backend.md`: tabelas, RLS, RPCs `post_message`, `approve_version`, `step_back`, `upload_final_version`, `update_caption`, `set_provider_key`, `delete_provider_key`, comentários e publicação Realtime (migrations `0001`–`0008`).
- `docs/superpowers/plans/2026-10-25-plano-2-executor-agente.md`: `MODEL_CATALOG`, `ModelChoiceSchema`, corpos de `agent_started`, `agent_result` e `agent_error` (`packages/shared/src/agent.ts`) e a herança da escolha por capacidade.

## Global Constraints

- Só macOS. `minimumSystemVersion` `13.0`; o build do Vite mira `safari16`.
- A parte Rust só registra os plugins `deep-link`, `notification`, `clipboard-manager` e `opener`. Nenhuma regra de negócio em Rust.
- O app usa só `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` e a sessão do usuário. A service role nunca entra no pacote `desktop`.
- Uma chave de provedor só sai do app por `set_provider_key`. Nunca é lida de volta: o app mostra só `...<last4>`. O campo digitado é limpo depois de salvar, e nenhum select pede `vault_secret_id`.
- Toda escrita usa os inserts e updates que a RLS permite ou as RPCs dos Planos 1 e 2, mais as do Plano 3 (`0010`). Nenhuma migration antiga é editada.
- Cadastro aberto. O login é por Google ou Apple (OAuth com PKCE: `flowType: 'pkce'`, retorno em `sala://auth/callback` e `exchangeCodeForSession`) ou por código de 6 dígitos no e-mail (`signInWithOtp` com `shouldCreateUser: true` e `verifyOtp` com `type: 'email'`).
- Na interface, o `team` do banco se chama "workspace". No primeiro login, a pessoa cria o próprio workspace, onde é admin. Convites (`team_invites`) são aceitos pelo dono do e-mail verificado.
- Modelos vêm só de `MODEL_CATALOG`. O seletor lista só modelos de provedores com chave no workspace. O seletor de esforço só aparece quando `efforts` não é vazio. `p_model` segue `ModelChoiceSchema`, e o modelo de texto vai sempre.
- Arquivos: só `image/png`, `image/jpeg` e `image/webp`, até `26_214_400` bytes. Caminho `<team_id>/<pasta>/<uuid>.<png|jpg|webp>`, em minúsculas. Referências usam a pasta `<campaign_id>`, e versões finais usam `<piece_id>`.
- Trechos de legenda contam code points (`Array.from(caption)`), nunca unidades UTF-16.
- Link: `sala://campanha/<campaign_id>` e `sala://campanha/<campaign_id>/peca/<piece_id>`, com uuids em minúsculas. O retorno do login é `sala://auth/callback`.
- Toda a interface em português do Brasil, com os rótulos exatos da Task 6 (`labels.ts`) e as mensagens exatas da Task 4 (`errors.ts`).
- Dependências novas só estas.
  - Runtime de `@sala/desktop`: `react`, `react-dom`, `@tauri-apps/api` e os 4 plugins. Também `@sala/shared`, `@supabase/supabase-js` e `zod`, que já estão no repositório.
  - Dev: `@tauri-apps/cli`, `vite`, `@vitejs/plugin-react`, `@types/react`, `@types/react-dom`, `@testing-library/react`, `@testing-library/user-event` e `jsdom`.
  - Sem roteador, biblioteca de estado, kit de UI ou framework de CSS.
- Testes: a lógica e a camada de dados são automatizadas. A janela Tauri é conferida à mão (não há WebDriver para macOS), no checklist da Task 13.

## Review Focus

1. **Realtime cai e volta** (Mac dormiu, Wi-Fi caiu): o chat busca `id > último visto` a cada `SUBSCRIBED` e não perde nem duplica evento. Teste na Task 6: `gap fill after resubscribe misses nothing`.
2. **Presença vaza entre times:** um membro de outro time que conhece o `team_id` não entra no canal de presença. Teste na Task 2: `members of another team cannot join the team presence channel`.
3. **Convite aceito por quem não é dono do e-mail:** com o cadastro aberto, só quem confirmou o e-mail convidado entra no workspace. Uma conta com o mesmo e-mail ainda não confirmado não entra. Teste na Task 2: `an invite is accepted only by the verified owner of the email`. (Os botões por papel continuam testados na Task 9, em `pieceActions follows the permission table`.)
4. **Rótulo de destino diferente do roteamento real:** "Para o agente" ou "Para @Nome" bate com o que `post_message` grava em `to_agent`. Teste na Task 8: `post_message routes the same way as messageTarget`.
5. **Link para peça inexistente ou de outro time:** o app abre sem travar e avisa "Peça não encontrada ou sem acesso.". Teste na Task 5: `a link to another team's piece resolves to no route with a notice`.

---

## Estrutura de arquivos

```
packages/desktop/
  package.json                 # @sala/desktop: scripts dev, build, tauri
  index.html
  vite.config.ts
  src/
    main.tsx  app.css  env.ts  native.ts  vite-env.d.ts
    data/   client.ts errors.ts auth.ts team.ts keys.ts campaigns.ts files.ts
            references.ts events.ts versions.ts comments.ts presence.ts
    lib/    link.ts workspace.ts labels.ts timeline.ts routing.ts models.ts actions.ts
            excerpt.ts presence.ts
    ui/     App.tsx LoginScreen.tsx Onboarding.tsx Shell.tsx CampaignSidebar.tsx PieceList.tsx
            PieceHeader.tsx Chat.tsx Timeline.tsx Composer.tsx ModelPicker.tsx
            ReferenceLibrary.tsx VersionViewer.tsx CommentLayer.tsx
            UploadFinalDialog.tsx Settings.tsx
  src-tauri/                   # gerado por `tauri init`: Cargo.toml, tauri.conf.json,
                               # capabilities/default.json, src/lib.rs, src/main.rs, icons/
packages/shared/src/agent.ts   # + checkModelChoice, inheritedModel
packages/shared/src/events.ts  # tipos e schemas dos eventos da conversa
supabase/migrations/0010_app_support.sql
supabase/templates/codigo.html
tests/desktop/*.test.ts(x)  tests/db/members.test.ts  tests/shared/events.test.ts
scripts/fake-agent.ts          # agente falso local: worker do Plano 2 com provedores falsos
docs/instalar-no-mac.md
```

---

### Task 1: Pacote do app — Tauri, React e testes de interface

**Files:**
- Create: `packages/desktop/` (package.json, index.html, vite.config.ts, `src/main.tsx`, `src/app.css`, `src/env.ts`, `src/native.ts`, `src/vite-env.d.ts`, `src/ui/App.tsx`, `src-tauri/` via `tauri init`)
- Modify: `tsconfig.json` (`"jsx": "react-jsx"`), `vitest.config.mts` (inclui `tests/**/*.test.{ts,tsx}` e `plugins: [react()]`), `package.json` da raiz (devDeps de teste e script `"app": "pnpm --filter @sala/desktop tauri dev"`), `.gitignore` (`packages/desktop/dist`, `packages/desktop/src-tauri/target`, `packages/desktop/src-tauri/gen`)
- Test: `tests/desktop/env.test.ts`, `tests/desktop/app.test.tsx`

**Interfaces:**
- Produces:
  - `readEnv(env: Record<string, string | undefined>): { supabaseUrl: string; anonKey: string }` (`src/env.ts`). Sem as duas variáveis, lança `Error('Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em packages/desktop/.env.local (veja supabase status).')`.
  - `native.ts`: `isDesktop(): boolean` (`isTauri()` de `@tauri-apps/api/core`).
    - `copyText(text: string): Promise<void>` (plugin clipboard).
    - `notify(title: string, body: string): Promise<void>` (pede permissão na primeira vez; sem permissão, não faz nada).
    - `openExternal(url: string): Promise<void>` (`openUrl` do opener).
    - `onDeepLink(cb: (url: string) => void): Promise<() => void>` (`getCurrent()` na abertura e `onOpenUrl` depois).
    - Fora do Tauri (testes e navegador), as quatro funções usam `navigator.clipboard`, nada, `window.open` e nada.
  - `App(): JSX.Element` (`src/ui/App.tsx`). Nesta task, só o título "Sala da Campanha".
- `tauri.conf.json`:
  - `productName` "Sala da Campanha", `identifier` `app.salacampanha.desktop`.
  - Janela de 1280×800, com mínimo de 1024×680.
  - `bundle.targets` `["app","dmg"]`, `bundle.macOS.minimumSystemVersion` `"13.0"`.
  - `plugins.deep-link.desktop.schemes` `["sala"]`.
  - `app.security.csp`: `default-src 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co http://127.0.0.1:55321 ws://127.0.0.1:55321; img-src 'self' data: blob: https://*.supabase.co http://127.0.0.1:55321; style-src 'self' 'unsafe-inline'`.
- `capabilities/default.json`:
  - `core:default`, `deep-link:default`, `notification:default`, `clipboard-manager:allow-write-text`.
  - `opener:allow-open-url`, com escopo `http://127.0.0.1:55321/*`. O host hospedado entra no deploy com o ref exato, `https://<projeto>.supabase.co/*` (ver "Checklist de deploy do app"). Nunca `https://*.supabase.co/*`: no glob do opener, o `*` atravessa `/`, e `https://evil.example/.supabase.co/x` passaria.

- [x] **Step 1: Write the failing tests.**

```ts
// tests/desktop/env.test.ts
it('reads the Supabase URL and anon key', () => {
  expect(readEnv({ VITE_SUPABASE_URL: 'http://127.0.0.1:55321', VITE_SUPABASE_ANON_KEY: 'anon' }))
    .toEqual({ supabaseUrl: 'http://127.0.0.1:55321', anonKey: 'anon' })
})
it('names both variables when one is missing', () => {
  expect(() => readEnv({ VITE_SUPABASE_URL: 'x' })).toThrow(/VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY/)
})
// tests/desktop/app.test.tsx  (// @vitest-environment jsdom)
it('renders the app title', () => {
  render(<App />)
  expect(screen.getByText('Sala da Campanha')).toBeTruthy()
})
```

- [x] **Step 2: Run to verify fail.** Run: `pnpm test tests/desktop`. Expected: FAIL (módulos não existem).
- [x] **Step 3: Criar o pacote.**
  - Criar `packages/desktop/package.json` (`@sala/desktop`, `private`, `type: module`, scripts `dev: vite`, `build: vite build`, `tauri: tauri`) e instalar as dependências da Global Constraints com `pnpm --filter @sala/desktop add ...`.
  - Na raiz, `pnpm add -D @testing-library/react @testing-library/user-event jsdom @vitejs/plugin-react`.
  - `vite.config.ts`: `react()`, `server.port 1420`, `strictPort`, `clearScreen: false`, `build.target 'safari16'`.
  - Rodar `pnpm --filter @sala/desktop tauri init --ci --app-name "Sala da Campanha" --window-title "Sala da Campanha" --frontend-dist ../dist --dev-url http://localhost:1420 --before-dev-command "pnpm dev" --before-build-command "pnpm build"`.
  - Depois, `pnpm --filter @sala/desktop tauri add deep-link`, e o mesmo para `notification`, `clipboard-manager` e `opener`.
  - Ajustar `tauri.conf.json` e `capabilities/default.json` como em Interfaces.
- [x] **Step 4: Run.** Run: `pnpm test && pnpm typecheck && cargo check --manifest-path packages/desktop/src-tauri/Cargo.toml`. Expected: PASS e `cargo check` sem erro.
- [x] **Step 5: Conferir que o executor continua buildando.** O lockfile ganhou o pacote `desktop`. Run: `docker build -f packages/executor/Dockerfile -t sala-executor .`. Expected: a imagem builda. Se o `pnpm install --frozen-lockfile --filter @sala/executor...` reclamar do pacote ausente, copiar também `packages/desktop/package.json` no `Dockerfile`, sem copiar o código do app.
- [x] **Step 6: Abrir a janela.** Run: `pnpm app`. Expected: a janela abre com "Sala da Campanha". Fechar.
- [x] **Step 7: Commit.** `git add -A && git commit -m "feat(desktop): Tauri 2 and React app shell with UI test setup"`

---

### Task 2: Backend do app — workspaces, convites, presença privada, tempo real e login aberto

> *Revisão de 2026-10-28, por decisão do fundador:* o cadastro é aberto e cada pessoa cria o próprio workspace (`team`). A Edge Function `add-member` e a `user_id_by_email` saíram. Convites ficam no banco, e nenhuma parte do app usa a service role.

**Files:**
- Create: `supabase/migrations/0010_app_support.sql`, `supabase/templates/codigo.html`
- Modify: `supabase/config.toml`:
  - `[auth] enable_signup = true`.
  - `additional_redirect_urls` ganha `"sala://auth/callback"`.
  - `[auth.email.template.magic_link]`, com `subject = "Seu código da Sala da Campanha"` e `content_path = "./supabase/templates/codigo.html"`.
  - `[auth.external.google]` e `[auth.external.apple]` com `enabled = true`, `client_id = "env(SUPABASE_AUTH_EXTERNAL_<PROVEDOR>_CLIENT_ID)"` e `secret = "env(SUPABASE_AUTH_EXTERNAL_<PROVEDOR>_SECRET)"`, lidos de `supabase/.env` (fora do git). Sem as variáveis, os dois provedores falham com erro e o resto funciona.
- Test: `tests/db/members.test.ts`

**Interfaces:**
- Produces (SQL, `0010`). Toda função é `security definer` com `search_path = ''`.
  - `private.topic_team(p_topic text) returns uuid`: o uuid de `team:<uuid em minúsculas>`; qualquer outro formato devolve null.
  - Policies `select` e `insert` em `realtime.messages` para `authenticated`: `extension = 'presence' and private.team_role_of(private.topic_team(realtime.topic())) is not null`.
  - `public.create_workspace(p_name text, p_display_name text) returns uuid`: cria o `team` e insere quem chama como `admin`. Erros (`22023`):
    - nome vazio ou com mais de 80 caracteres: `'workspace name must not be empty'`;
    - `p_display_name` vazio ou com mais de 80: `'display name must not be empty'`.
  - Tabela `public.team_invites(team_id uuid fk teams on delete cascade, email text not null check (email = lower(email)), role team_role not null, invited_by uuid null default auth.uid() references auth.users on delete set null, created_at timestamptz default now(), primary key (team_id, email))`. Grants e RLS:
    - `select` para quem é `admin` do time.
    - Sem `insert`, `update` ou `delete` para `authenticated`; tudo passa pelas RPCs abaixo.
  - `public.invite_member(p_team uuid, p_email text, p_role team_role) returns void`: apara o e-mail e põe em minúsculas, depois faz upsert do convite (o papel novo vale). Erros:
    - quem chama não é admin: `'only team admins can invite'` (`42501`);
    - e-mail sem `@` ou com espaço: `'invalid email'` (`22023`);
    - o e-mail já é de um membro do time (por `auth.users.email`): `'user is already a team member'` (`22023`).
  - `public.revoke_invite(p_team uuid, p_email text) returns void`: só admin (`'only team admins can invite'`).
  - `public.accept_invites(p_display_name text) returns int`:
    - Lê o e-mail de quem chama em `auth.users`, só se `email_confirmed_at is not null`. Sem e-mail confirmado, devolve 0.
    - Para cada convite com esse e-mail, insere em `team_members` com o papel do convite e `p_display_name` (`on conflict do nothing`) e apaga o convite.
    - Devolve quantos aceitou. `p_display_name` vazio: `'display name must not be empty'`.
  - `public.set_member_role(p_team uuid, p_user uuid, p_role team_role) returns void` e `public.remove_member(p_team uuid, p_user uuid) returns void`. Travam as linhas do time em `team_members` (`for update`). Erros:
    - quem chama não é admin: `'only team admins can manage members'` (`42501`);
    - o alvo não é membro: `'user is not a team member'` (`22023`);
    - o time ficaria sem admin: `'team needs at least one admin'` (`22023`).
  - `alter publication supabase_realtime add table public.campaigns, public.reference_assets`.
- `codigo.html`: "Seu código para entrar na Sala da Campanha é {{ .Token }}. Ele vale por 1 hora."

- [ ] **Step 1: Write the failing tests** em `tests/db/members.test.ts`. Para um usuário novo com e-mail confirmado, usar `serviceClient().auth.admin.createUser({ email, email_confirm: true })`. Para um não confirmado, usar `email_confirm: false`. Depois, o login sai de `generateLink({ type: 'magiclink', email })`, com `verifyOtp`.
  - `create_workspace makes the caller its admin`: `teams` e `team_members` mostram o workspace com o papel `admin`.
  - `an invite is accepted only by the verified owner of the email`:
    - O admin do A convida `x@test.local` como `designer`.
    - Um usuário com e-mail não confirmado chama `accept_invites` e recebe 0.
    - O dono confirmado recebe 1, entra no A como `designer`, e o convite some.
  - `only admins invite`: gestor e espectador recebem `'only team admins can invite'`.
  - `inviting a current member is refused`.
  - `members of another team cannot read the invites`.
  - `admin changes a role; the last admin cannot be demoted or removed`: as mensagens SQL são exatas.
  - `members of another team cannot join the team presence channel`:
    - `B.designer.client.channel('team:' + A.teamId, { config: { private: true } })` termina em `CHANNEL_ERROR`.
    - `A.designer` termina em `SUBSCRIBED`.
  - `new campaigns reach other members live`: um insert de A.gestor em `campaigns` chega a A.designer em até 5 s, e não chega a B.
- [ ] **Step 2: Run to verify fail.** Run: `pnpm db:reset && pnpm test tests/db/members.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implementar** a migration, o template e o `config.toml`. Depois de mudar o `config.toml`, rodar `supabase stop && supabase start`.
- [ ] **Step 4: Run.** Run: `pnpm db:reset && pnpm test`. Expected: PASS na suíte inteira.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(db): open sign-up, personal workspaces, invites, private team presence and live campaigns"`

---

### Task 3: Contrato compartilhado — escolha de modelo e eventos da conversa

**Files:**
- Create: `packages/shared/src/events.ts`
- Modify: `packages/shared/src/agent.ts`, `packages/shared/package.json` (`exports` ganha `"./events"`), `packages/executor/src/job.ts`
- Test: `tests/shared/events.test.ts`, `tests/shared/agent.test.ts`

**Interfaces:**
- Produces (`agent.ts`, movidos de `job.ts` sem mudar o comportamento):
  - `type ChosenModel = CatalogModel & { effort: string | null }`
  - `type CheckedChoice = Partial<Record<ModelCapability, ChosenModel>>`
  - `checkModelChoice(choice: unknown): CheckedChoice | AgentErrorInput` (o atual `checkChoice`)
  - `inheritedModel(choices: unknown[], capability: ModelCapability): ChosenModel | undefined`: a última escolha válida que nomeia a capacidade. Uma escolha inválida é pulada inteira.
  - `job.ts`: `resolveModels` passa a usar os dois. Somem `checkChoice` e os tipos locais.
- Produces (`events.ts`):
  - `EVENT_COLUMNS = 'id, piece_id, team_id, author_id, kind, body, to_agent, mention_user_ids, delivery, created_at'`. Sem `claimed_by`, que é interno do executor.
  - `type SessionEventRow = { id: number; piece_id: string; team_id: string; author_id: string | null; kind: EventKind; body: unknown; to_agent: boolean; mention_user_ids: string[]; delivery: DeliveryStatus; created_at: string }`
  - Schemas dos corpos (os campos gravados pelas migrations `0004`, `0006` e `0007`):
    - `UserMessageBodySchema` `{ text: string; model: unknown; reference_asset_ids: string[] }`
    - `StatusChangedBodySchema` `{ from: PieceStatus; to: PieceStatus }`
    - `VersionAddedBodySchema` `{ version_id: string; number: number; phase: VersionPhase }`
    - `ApprovalBodySchema` `{ version_id: string; from: PieceStatus; to: PieceStatus }`
    - `CommentBodySchema` `{ comment_id: string; version_id: string; parent_id: string | null }`
    - Os três `Agent*BodySchema` de `agent.ts`.
  - `type SessionEvent`: união discriminada por `kind`, com o `body` tipado.
  - `parseEvent(row: unknown): SessionEvent | null`. Devolve null para tipo desconhecido ou corpo inválido, para uma linha ruim não quebrar o chat.

- [ ] **Step 1: Write the failing tests.**
  - `tests/shared/events.test.ts`: `parses every event kind` (um literal por tipo); `returns null for an unknown kind or a bad body`.
  - `tests/shared/agent.test.ts`:
    - `inheritedModel picks the latest valid choice that names the capability`: `[opus, { image: fal }]` dá opus para texto e fal para imagem.
    - `inheritedModel skips an invalid choice whole`.
- [ ] **Step 2: Run to verify fail.** Run: `pnpm test tests/shared`. Expected: FAIL.
- [ ] **Step 3: Implementar** e mudar `job.ts` para usar o shared.
- [ ] **Step 4: Run.** Run: `pnpm db:reset && pnpm test && pnpm typecheck`. Expected: PASS, inclusive `tests/executor/job.test.ts` sem mudança.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "refactor(shared): model choice checks and conversation event schemas shared with the app"`

---

### Task 4: Login, entrada no workspace, sessão e mensagens de erro

> *Revisão de 2026-10-28, por decisão do fundador:* login com Google, Apple e código por e-mail, com cadastro aberto. No primeiro login, a pessoa cria o próprio workspace ou entra pelos convites.

**Files:**
- Create: `src/data/client.ts`, `src/data/errors.ts`, `src/data/auth.ts`, `src/data/team.ts`, `src/lib/link.ts` (só `parseAuthCallback` nesta task), `src/ui/LoginScreen.tsx`, `src/ui/Onboarding.tsx` (todos em `packages/desktop/`)
- Modify: `src/ui/App.tsx`
- Test: `tests/desktop/errors.test.ts`, `tests/desktop/auth.test.ts`, `tests/desktop/auth-callback.test.ts`, `tests/desktop/login-screen.test.tsx`, `tests/desktop/onboarding.test.tsx`

**Interfaces:**
- Produces:
  - `createAppClient(url: string, anonKey: string): SupabaseClient`, com `auth.flowType: 'pkce'`, `auth.detectSessionInUrl: false` e a sessão no `localStorage` (padrão).
  - `friendlyError(e: unknown): string` (`errors.ts`). Procura a mensagem do erro nesta tabela (texto exato):

    | Mensagem do servidor (contém) | Texto no app |
    |---|---|
    | `piece not found or not writable` | Você não pode alterar esta peça. |
    | `message text must not be empty` | Escreva uma mensagem. |
    | `piece not found or not approvable` | Só o admin ou o gestor podem aprovar. |
    | `cannot be approved in status` | Esta versão não pode ser aprovada na etapa atual. |
    | `only admins and gestores can undo an approval` | Só o admin ou o gestor podem desfazer uma aprovação. |
    | `no previous status` | A peça já está na primeira etapa. |
    | `final version needs status acabamento or final_em_revisao` | A versão final só pode ser enviada depois da aprovação da base. |
    | `caption can only be edited on a version under review` | Só dá para editar a legenda da versão em revisão. |
    | `approved version cannot be edited` | Uma versão aprovada não pode ser editada. |
    | `only team admins can set provider keys` / `only team admins can delete provider keys` | Só o admin do workspace gerencia as chaves. |
    | `provider key must have at least 20 characters and no spaces` | A chave precisa ter pelo menos 20 caracteres e nenhum espaço. |
    | `only team admins can manage members` | Só o admin do workspace gerencia os membros. |
    | `only team admins can invite` | Só o admin do workspace convida pessoas. |
    | `team needs at least one admin` | O workspace precisa de pelo menos um admin. |
    | `user is already a team member` | Essa pessoa já está no workspace. |
    | `invalid email` | Confira o e-mail. |
    | `workspace name must not be empty` | Dê um nome ao workspace. |
    | `display name must not be empty` | Escreva seu nome. |
    | `provider is not enabled` | Esse jeito de entrar ainda não está disponível. |
    | `row-level security` | Você não tem permissão para isso. |
    | `Failed to fetch` / `fetch failed` / `NetworkError` | Sem conexão com o servidor. Tente de novo. |
    | (qualquer outra) | Algo deu errado. Tente de novo. |

  - `sendLoginCode(client, email: string): Promise<void>`: apara e põe o e-mail em minúsculas. Chama `signInWithOtp({ email, options: { shouldCreateUser: true } })`. Rate limit lança `Error('Espere um minuto antes de pedir outro código.')`.
  - `verifyLoginCode(client, email: string, code: string): Promise<void>`: chama `verifyOtp({ email, token: code.trim(), type: 'email' })`. Em erro, lança `Error('Código inválido ou vencido. Peça um novo.')`.
  - `type OAuthProvider = 'google' | 'apple'`.
  - `oauthUrl(client, provider: OAuthProvider): Promise<string>`: chama `signInWithOAuth({ provider, options: { redirectTo: 'sala://auth/callback', skipBrowserRedirect: true } })` e devolve `data.url`. O `LoginScreen` abre a URL com `openExternal`.
  - `parseAuthCallback(url: string): { code: string } | { error: string } | null` (`lib/link.ts`).
    - `sala://auth/callback?code=...` dá `{ code }`.
    - `?error_description=...` (ou `?error=...`) dá `{ error }`.
    - Qualquer outra URL dá null e segue para a navegação (Task 5).
  - `finishOAuth(client, code: string): Promise<void>`: chama `exchangeCodeForSession(code)`. Em erro, lança `Error('Não foi possível entrar. Tente de novo.')`.
  - `signOut(client): Promise<void>`.
  - `displayNameOf(user: User): string | null`: `user_metadata.display_name`, ou então `full_name` ou `name` (Google e Apple), aparado; senão null.
  - `saveDisplayName(client, name: string): Promise<void>`: `auth.updateUser({ data: { display_name } })`.
  - `acceptInvites(client, displayName: string): Promise<number>` e `createWorkspace(client, name: string, displayName: string): Promise<string>`: as RPCs da Task 2.
  - `type Membership = { teamId: string; teamName: string; role: Role; displayName: string }`. `loadMyMemberships(client): Promise<Membership[]>` lê `team_members` do usuário com `teams(name)`, ordenado pelo nome do workspace.
  - `type Member = { userId: string; displayName: string; role: Role }`. `loadMembers(client, teamId): Promise<Member[]>`, por nome. As Tasks 5 a 12 usam.
- UI:
  - `LoginScreen(props: { sendCode(email: string): Promise<void>; verifyCode(email: string, code: string): Promise<void>; startOAuth(provider: OAuthProvider): Promise<void> })`.
    - Os botões "Entrar com Google" e "Entrar com Apple". Depois de clicar, "Continue no navegador…".
    - Abaixo, "ou entre com um código no e-mail".
    - Passo 1 do e-mail: o campo e "Enviar código".
    - Passo 2: "Enviamos um código de 6 dígitos para <email>.", o campo do código, "Entrar" e "Usar outro e-mail".
    - Erros aparecem em `role="alert"`.
  - `Onboarding(props: { step: 'name' | 'workspace'; suggestedName: string; onSaveName(name: string): Promise<void>; onCreateWorkspace(name: string): Promise<void> })`.
    - `name`: "Como você quer aparecer para o time?", com o campo preenchido por `suggestedName` e "Continuar".
    - `workspace`: "Crie seu workspace", com o campo "Nome do workspace" e "Criar". Sugestão: "Workspace de <primeiro nome>".
  - `App`, nesta ordem:
    1. Registra `onDeepLink`. Uma URL que `parseAuthCallback` reconhece vai para `finishOAuth`; o erro aparece na tela de login.
    2. Sem sessão, mostra `LoginScreen`.
    3. Com sessão e sem `displayNameOf(user)`, mostra o `Onboarding` no passo `name` e grava com `saveDisplayName`.
    4. Com nome, chama `acceptInvites(nome)` a cada abertura e login, e depois `loadMyMemberships`.
    5. Sem nenhum workspace, mostra o `Onboarding` no passo `workspace`, que chama `createWorkspace`.
    6. Com workspace, mostra o `Shell` (Task 5). Antes da Task 5, um texto com o nome do workspace.

- [ ] **Step 1: Write the failing tests.**
  - `errors.test.ts`: `maps each server message to its Portuguese text` (uma linha da tabela por caso) e `falls back to the generic text`.
  - `auth-callback.test.ts`:
    - `reads the code from the auth callback`.
    - `reads the error description`.
    - `ignores other links and other schemes`.
  - `auth.test.ts` (Supabase local):
    - `a new person signs up with an email code and creates a workspace`:
      - `sendLoginCode` com um e-mail novo resolve.
      - O código sai de `generateLink({ type: 'magiclink', email })`, e `verifyLoginCode` entra.
      - `saveDisplayName` grava o nome, e `createWorkspace` cria o workspace.
      - `loadMyMemberships` traz o workspace com o papel `admin`.
    - `an invited person joins the inviter's workspace on first login`: o admin do A convida o e-mail como `designer`. A pessoa entra pelo código e `acceptInvites` devolve 1. As memberships trazem o A como `designer`.
    - `a wrong code is refused with a readable message`.
    - `oauthUrl points to the provider through Supabase`: com o Google desligado no ambiente local, `friendlyError` do erro dá "Esse jeito de entrar ainda não está disponível.". Com o Google ligado (variáveis em `supabase/.env`), a URL contém `/auth/v1/authorize?provider=google` e `redirect_to=sala%3A%2F%2Fauth%2Fcallback`.
  - `login-screen.test.tsx` (jsdom):
    - `asks for the code after sending it`.
    - `shows the friendly error and keeps the email`.
    - `starts Google and Apple sign-in`.
  - `onboarding.test.tsx` (jsdom):
    - `saves the suggested name`.
    - `creates the workspace with the typed name`.
- [ ] **Step 2: Run to verify fail.** Run: `pnpm test tests/desktop`. Expected: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Run.** Run: `pnpm db:reset && pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Conferir à mão.**
  - Rodar `pnpm app` com `packages/desktop/.env.local` apontando para o Supabase local.
  - Entrar com um e-mail novo pelo código, que chega no Mailpit (`http://127.0.0.1:55324`).
  - Dar o nome e criar o workspace.
  - Google e Apple são conferidos na Task 13, com o app empacotado: o link `sala://` só funciona assim no macOS.
- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat(desktop): Google, Apple and email code sign-in with workspace onboarding"`

---

### Task 5: Campanhas, peças, navegação e link de compartilhamento

**Files:**
- Create: `src/lib/workspace.ts`, `src/data/campaigns.ts`, `src/data/files.ts` (só `signedUrls` nesta task), `src/ui/Shell.tsx`, `src/ui/CampaignSidebar.tsx`, `src/ui/PieceList.tsx`, `src/ui/PieceHeader.tsx`
- Modify: `src/lib/link.ts`, `src/ui/App.tsx`
- Test: `tests/desktop/link.test.ts`, `tests/desktop/workspace.test.ts`, `tests/desktop/campaigns.test.ts`

**Interfaces:**
- Produces:
  - `type Route = { campaignId: string | null; pieceId: string | null }`
  - `buildLink(route: { campaignId: string; pieceId?: string | null }): string`
  - `parseLink(url: string): Route | null`: aceita os dois formatos da Global Constraints, com ou sem barra final, e põe os uuids em minúsculas. Qualquer outra coisa devolve null.
  - Tipos `Campaign = { id: string; team_id: string; name: string; created_at: string }` e `Piece = { id: string; campaign_id: string; team_id: string; title: string; kind: PieceKind; status: PieceStatus; approved_version_id: string | null; created_at: string }`.
  - `loadCampaigns(client, teamId): Promise<Campaign[]>`, por `created_at`.
  - `createCampaign(client, teamId, name): Promise<Campaign>`.
  - `loadPieces(client, campaignId): Promise<Piece[]>`.
  - `createPiece(client, input: { campaignId: string; teamId: string; title: string; kind: PieceKind }): Promise<Piece>`.
  - `renamePiece(client, pieceId, title): Promise<void>`.
  - `loadThumbnails(client, campaignId): Promise<Record<string, string>>`: `piece_id` para o `image_path` da versão mais nova com imagem.
  - `resolveRoute(client, route: Route): Promise<{ route: Route; teamId: string | null; notice: string | null }>`:
    - Uma campanha ou peça que não carrega vira `{ campaignId: null, pieceId: null }`, com `teamId: null` e `notice` "Peça não encontrada ou sem acesso.".
    - Uma peça de outra campanha corrige `campaignId`.
    - `teamId` é o workspace da campanha, para o app trocar de workspace quando o link é de outro workspace da pessoa.
  - `pickWorkspace(memberships: Membership[], stored: string | null): string | null` (`lib/workspace.ts`): o `stored` se a pessoa ainda é membro dele; senão, o primeiro; sem nenhum, null. O app guarda o último workspace em `localStorage` (`sala.workspace`), com `try/catch`. *(Revisão de 2026-10-28: a pessoa pode estar em vários workspaces.)*
  - `subscribeLists(client, teamId, campaignId: string | null, onChange: () => void): () => void`: INSERT em `campaigns` (`team_id=eq.`) e INSERT/UPDATE em `pieces` (`campaign_id=eq.`).
  - `signedUrls(client, paths: string[]): Promise<Record<string, string>>`: URLs assinadas por 1 h, num pedido só.
- UI (layout da seção 4 do spec):
  - **`CampaignSidebar` (esquerda):**
    - No topo, o seletor de workspace (quando há mais de um) e "Novo workspace", que pede o nome e chama `createWorkspace` (Task 4).
    - Depois, as campanhas, as peças da campanha aberta e o botão "Nova campanha".
    - Embaixo, as pessoas do workspace: nome, papel e o ponto de online, que a Task 11 liga.
  - **`PieceList` (direita):** as peças da campanha, com miniatura, título, tipo e status (rótulos da Task 6), e o botão "Nova peça" (título e tipo).
  - **`PieceHeader` (topo):** nome da campanha e da peça (renomear direto, se `can_write`), espaço dos avatares (Task 11) e o botão "Compartilhar", que copia `buildLink` com `copyText` e mostra "Link copiado".
  - **Centro:** "Escolha uma peça" até a Task 6.
  - **`App`:** as URLs do `onDeepLink` (Task 4) que não são de login passam por `parseLink` e `resolveRoute`. Um link que chega sem sessão fica guardado e é aberto depois do login. O `notice` aparece num aviso que some ao clicar.
  - **`espectador`:** não vê "Nova campanha" nem "Nova peça".

- [ ] **Step 1: Write the failing tests.**
  - `link.test.ts`:
    - `builds and parses campaign and piece links`.
    - `lowercases ids and accepts a trailing slash`.
    - `rejects other schemes, paths and non-uuid ids`.
  - `workspace.test.ts`:
    - `pickWorkspace keeps the stored workspace while the person is still a member`.
    - `pickWorkspace falls back to the first workspace, or null without any`.
  - `campaigns.test.ts` (local):
    - `designer creates a campaign and a piece and renames it`.
    - `espectador gets the friendly permission error`: `friendlyError` dá "Você não tem permissão para isso.".
    - `thumbnails use the newest version with an image`: usar `createAgentVersion` duas vezes.
    - `a link to another team's piece resolves to no route with a notice`.
    - `a link to a campaign in another of my workspaces returns that workspace`.
- [ ] **Step 2: Run to verify fail.** Run: `pnpm test tests/desktop/link.test.ts tests/desktop/workspace.test.ts tests/desktop/campaigns.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Run.** Run: `pnpm db:reset && pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Conferir à mão.**
  - Rodar `pnpm app`.
  - Criar uma campanha e uma peça.
  - Copiar o link e colar num editor. Deve sair `sala://campanha/<id>/peca/<id>`.
- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat(desktop): campaigns, pieces, navigation and share link"`

---

### Task 6: Conversa ao vivo

**Files:**
- Create: `src/lib/labels.ts`, `src/lib/timeline.ts`, `src/data/events.ts`, `src/data/versions.ts` (só `Version` e `loadVersions` nesta task), `src/ui/Chat.tsx`, `src/ui/Timeline.tsx`
- Modify: `src/ui/Shell.tsx`
- Test: `tests/desktop/timeline.test.ts`, `tests/desktop/events.test.ts`

**Interfaces:**
- Produces (`labels.ts`, textos exatos):
  - `STATUS_LABELS`: `gerando` "Gerando", `base_em_revisao` "Base em revisão", `acabamento` "Acabamento", `final_em_revisao` "Final em revisão", `aprovada` "Aprovada".
  - `KIND_LABELS`: `imagem` "Imagem", `texto` "Texto", `imagem_texto` "Imagem e texto".
  - `DELIVERY_LABELS` (só para mensagem ao agente): `queued` "na fila", `claimed` "o agente está trabalhando", `failed` "falhou", `done` e `not_applicable` "".
  - `EFFORT_LABELS`: `minimal` "mínimo", `low` "baixo", `medium` "médio", `high` "alto", `xhigh` "muito alto", `max` "máximo".
- Produces (`data`):
  - `type Version = { id: string; piece_id: string; number: number; origin: VersionOrigin; phase: VersionPhase; image_path: string | null; caption: string | null; author_id: string | null; created_at: string }`. `loadVersions(client, pieceId): Promise<Version[]>`, por `number`.
  - `loadEvents(client, pieceId, afterId = 0): Promise<SessionEvent[]>`: `EVENT_COLUMNS`, `id > afterId`, por `id`, passado por `parseEvent`. As linhas nulas são descartadas.
  - `subscribePiece(client, pieceId, h: { onEvent(e: SessionEvent): void; onVersion(): void; onComment(): void; onPiece(): void; onSubscribed(): void }): () => void`.
    - Um canal `piece:<id>` com `postgres_changes`: `session_events` INSERT e UPDATE, `piece_versions` INSERT, `comments` INSERT e UPDATE (`piece_id=eq.`) e `pieces` UPDATE (`id=eq.`).
    - `onSubscribed` roda a cada `SUBSCRIBED`, inclusive ao reconectar.
- Produces (`timeline.ts`):
  - `mergeEvents(current: SessionEvent[], incoming: SessionEvent[]): SessionEvent[]`: por `id`, ordem crescente. A cópia que chega depois substitui a anterior (UPDATE de `delivery`).
  - `type TimelineItem` com três formas:
    - `{ type: 'message'; id: number; author: string; text: string; mine: boolean; deliveryLabel: string }`
    - `{ type: 'agent'; id: number; text: string; prompt: string | null; version: Version | null; error: boolean }`
    - `{ type: 'system'; id: number; text: string }`
  - `timelineItems(events: SessionEvent[], ctx: { members: Record<string, string>; versions: Record<string, Version>; me: string }): TimelineItem[]`, com estes textos exatos:
    - `user_message`: o autor é `members[author_id]` ou "Alguém". O `deliveryLabel` sai de `DELIVERY_LABELS` quando `to_agent`, e fica "" quando não.
    - `agent_started`: `Gerando com <texto>` e, se houver imagem, ` e <imagem>`, com os `label` do catálogo. Com esforço, o rótulo ganha ` (esforço <EFFORT_LABELS>)`. Depois vem `.`. Com `dropped_reference_ids`, acrescenta ` 1 referência ficou de fora pelo limite do modelo.` ou ` <n> referências ficaram de fora pelo limite do modelo.`.
    - `agent_result`: `text` "Versão <n>", `version` do mapa, `prompt` = `image_prompt`.
    - `agent_error`: `text` = `body.message`, `prompt` = `image_prompt`, `error: true`.
    - `status_changed`: `<autor ou "O agente"> mudou a etapa de <from> para <to>.`, com `STATUS_LABELS`.
    - `approval`: `<autor> aprovou a versão <n>.`
    - `version_added`: sem autor (o agente), não gera item, porque o `agent_result` já mostra a versão. Com origem `upload`, `<autor> enviou a versão final <n>.`; com origem `edicao`, `<autor> editou a legenda (versão <n>).`.
    - `comment`: `<autor> comentou na versão <n>.`
- UI:
  - Cada mensagem mostra o autor e um avatar com as iniciais do nome.
  - `Chat` carrega membros, versões e eventos e assina `subscribePiece`.
  - Em `onSubscribed`, chama `loadEvents(afterId = último id)` e junta com `mergeEvents`.
  - Rola para o fim quando chega item novo.
  - O card do agente mostra a imagem (`signedUrls`), a legenda e o botão "Ver prompt", que começa recolhido.

- [ ] **Step 1: Write the failing tests.**
  - `timeline.test.ts`:
    - `mergeEvents dedupes, keeps order and applies updates`.
    - `timelineItems writes the exact text for each event kind`: uma linha por regra acima, incluindo o esforço e as referências cortadas, no singular e no plural.
  - `events.test.ts` (local):
    - `loadEvents returns only events after the given id, in order`.
    - `subscribePiece delivers new events and delivery updates`: um post do gestor e depois um update de `delivery` para `claimed` pela service role.
    - `gap fill after resubscribe misses nothing`: assinar, cancelar, postar 2 mensagens, assinar de novo. No `onSubscribed`, `loadEvents(after)` traz as 2, e `mergeEvents` não duplica.
- [ ] **Step 2: Run to verify fail.** Run: `pnpm test tests/desktop/timeline.test.ts tests/desktop/events.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Run.** Run: `pnpm db:reset && pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(desktop): live piece conversation with gap fill after reconnect"`

---

### Task 7: Biblioteca de referências e envio de arquivos

**Files:**
- Create: `src/data/references.ts`, `src/ui/ReferenceLibrary.tsx`
- Modify: `src/data/files.ts`, `src/ui/Shell.tsx` (botão "Referências" na campanha)
- Test: `tests/desktop/files.test.ts`, `tests/desktop/references.test.ts`

**Interfaces:**
- Produces (`files.ts`):
  - `MAX_FILE_BYTES = 26_214_400` e `IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']`.
  - `checkImageFile(file: { type: string; size: number }): string | null`:
    - Tipo fora da lista: "Use uma imagem PNG, JPG ou WebP.".
    - Acima do limite: "A imagem tem mais de 25 MB.".
  - `newImagePath(teamId: string, folder: string, type: string): string`: `<teamId>/<folder>/<uuid>.<png|jpg|webp>`, em minúsculas.
  - `uploadImage(client, path: string, file: Blob): Promise<void>` (`upsert: false`, `contentType` do arquivo).
  - `downloadUrl(client, path: string, filename: string): Promise<string>` (`createSignedUrl(path, 60, { download: filename })`).
- Produces (`references.ts`):
  - `type Reference = { id: string; campaign_id: string; team_id: string; storage_path: string; original_name: string; created_at: string }`.
  - `loadReferences(client, campaignId): Promise<Reference[]>`.
  - `addReference(client, input: { teamId: string; campaignId: string; file: File }): Promise<Reference>`. Ordem: `checkImageFile` (lança o texto), depois o upload em `newImagePath(teamId, campaignId, type)`, depois o insert.
- UI: `ReferenceLibrary(props: { references; urls; canUpload: boolean; selectable: boolean; selected: string[]; onUpload(files: File[]): Promise<void>; onSelect(ids: string[]): void })`.
  - Grade de miniaturas e "Enviar fotos" (várias de uma vez).
  - Cada arquivo recusado mostra o nome e o motivo.
  - Com `selectable`, mostra caixas de seleção e o botão "Usar selecionadas".

- [ ] **Step 1: Write the failing tests.**
  - `files.test.ts`:
    - `rejects files the bucket refuses`: `application/pdf`, `image/heic` e PNG com `26_214_401` bytes, cada um com o texto exato.
    - `accepts a PNG at the limit`.
    - `newImagePath is lowercase with the type's extension`.
  - `references.test.ts` (local):
    - `designer uploads a reference and everyone in the team lists it`.
    - `espectador cannot upload`.
    - `another team cannot list it`.
- [ ] **Step 2: Run to verify fail.** Run: `pnpm test tests/desktop/files.test.ts tests/desktop/references.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Run.** Run: `pnpm db:reset && pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(desktop): campaign reference library and image upload checks"`

---

### Task 8: Campo de mensagem — destino, menções, modelo e esforço

**Files:**
- Create: `src/lib/routing.ts`, `src/lib/models.ts`, `src/ui/Composer.tsx`, `src/ui/ModelPicker.tsx`
- Modify: `src/data/events.ts` (`postMessage`), `src/ui/Chat.tsx`
- Test: `tests/desktop/routing.test.ts`, `tests/desktop/models.test.ts`, `tests/desktop/composer.test.tsx`

**Interfaces:**
- Produces (`routing.ts`):
  - `type Mention = { userId: string; name: string }`.
  - `mentionedIn(text: string, members: Mention[]): Mention[]`: membros cujo `@<nome>` aparece no texto. Os nomes mais longos são testados primeiro, para "@Ana Souza" não contar como "@Ana".
  - `messageTarget(text: string, mentioned: Mention[]): { toAgent: boolean; label: string }`. Espelha o SQL de `post_message`: `toAgent = !(text.trim().startsWith('@') && mentioned.length > 0)`. O `label` é "Para o agente" ou "Para @Ana", "Para @Ana e @Bia", "Para @Ana, @Bia e @Caio".
  - `mentionQuery(text: string, caret: number): string | null`: o trecho depois do último `@` antes do cursor, sem quebra de linha e com até 30 caracteres. Fora disso, null.
- Produces (`models.ts`):
  - `type ModelPick = { model: CatalogModel; effort: string | null }`.
  - `modelOptions(capability, keyed: Provider[]): CatalogModel[]`, na ordem de `MODEL_CATALOG`.
  - `initialPick(choices: unknown[], capability, keyed): ModelPick | null`: `inheritedModel` quando o provedor tem chave; senão, o primeiro de `modelOptions` com `effort: null`; sem opções, null.
  - `toModelChoice(kind: PieceKind, text: ModelPick, image: ModelPick | null): ModelChoice`. Leva `text` sempre e `image` em `imagem` e `imagem_texto`. `effort` só vai quando não é null.
- Produces (`events.ts`):
  - `type PostInput = { pieceId: string; text: string; mentionUserIds: string[]; model: ModelChoice | null; referenceAssetIds: string[] }`.
  - `postMessage(client, input: PostInput): Promise<void>`.
- UI:
  - `ModelPicker(props: { capability; options: CatalogModel[]; value: ModelPick; onChange(p: ModelPick): void })`: um select de modelo com o `label`. O select de esforço ("Padrão do provedor" e `EFFORT_LABELS`) só aparece com `efforts` não vazio. Trocar de modelo volta o esforço para null.
  - `Composer(props: { piece: Piece; members: Mention[]; keyed: Provider[]; choices: unknown[]; references: Reference[]; urls: Record<string, string>; onPost(input: PostInput): Promise<void> })`:
    - O rótulo de destino fica acima do campo.
    - Ao digitar `@`, aparece o autocompletar de membros, que insere `@<nome> `.
    - Os seletores aparecem só para mensagem ao agente.
    - "Anexar referência" abre a `ReferenceLibrary` em modo de seleção, e as escolhidas viram chips.
    - Enter envia e Shift+Enter quebra a linha. O botão fica desabilitado com o texto vazio.
    - Mensagem a pessoas vai com `model: null` e sem referências.
    - Mensagem ao agente sem modelo de texto disponível fica bloqueada, com "Nenhuma chave de texto cadastrada. Peça ao admin do time.".
    - As `choices` vêm do `body.model` das mensagens ao agente da peça.
  - Para `espectador`, `Chat` mostra "Você acompanha esta peça como espectador." no lugar do `Composer`.

- [ ] **Step 1: Write the failing tests.**
  - `routing.test.ts`:
    - `messageTarget mirrors the SQL routing rule`. Casos: texto simples; `'@Ana oi'` com Ana; `'@algo'` sem menção; `'  @Ana oi'`; `'Oi @Ana'`.
    - `lists several people in the label`.
    - `post_message routes the same way as messageTarget` (local): os mesmos casos postados pelo gestor, com `to_agent` igual a `toAgent`.
  - `models.test.ts`:
    - `lists only models whose provider has a key`.
    - `initialPick inherits per capability and falls back when the provider has no key`.
    - `toModelChoice sends the image model only for image pieces and omits a null effort`.
  - `composer.test.tsx` (jsdom):
    - `sends the picked model and references to the agent`: o `onPost` recebe o payload exato.
    - `a message to a person carries no model`.
    - `effort select appears only for models with efforts`.
    - `blocks agent messages when no text key`.
- [ ] **Step 2: Run to verify fail.** Run: `pnpm test tests/desktop/routing.test.ts tests/desktop/models.test.ts tests/desktop/composer.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Run.** Run: `pnpm db:reset && pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Conferir à mão.** Rodar `pnpm app`.
  - Uma mensagem simples fica "na fila". Sem executor rodando, ela não sai daí.
  - `@Nome oi` aparece sem rótulo de fila.
- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat(desktop): message composer with routing label, mentions, model and effort"`

---

### Task 9: Versões e ciclo de vida da peça

**Files:**
- Create: `src/lib/actions.ts`, `src/ui/VersionViewer.tsx`, `src/ui/UploadFinalDialog.tsx`
- Modify: `src/data/versions.ts`, `src/ui/PieceHeader.tsx`, `src/ui/Timeline.tsx` (clicar na versão abre o visualizador)
- Test: `tests/desktop/actions.test.ts`, `tests/desktop/versions.test.ts`

**Interfaces:**
- Produces (`actions.ts`):
  - `pieceActions(role: Role, piece: Pick<Piece, 'kind' | 'status'>, version: { phase: VersionPhase; approved: boolean } | null): { approve: boolean; stepBack: boolean; uploadFinal: boolean; editCaption: boolean; comment: boolean; chat: boolean }`. Regras (spec, seção 5, e Plano 1, Task 7):
    - `approve`: papel `admin` ou `gestor`, e (`base_em_revisao` com versão `base`, ou `final_em_revisao` com versão `final`).
    - `stepBack`: papel diferente de `espectador`, status diferente de `gerando`, e em `aprovada` só `admin` ou `gestor`.
    - `uploadFinal`: papel diferente de `espectador`, e status `acabamento` ou `final_em_revisao`.
    - `editCaption`: papel diferente de `espectador`, tipo diferente de `imagem`, versão da fase em revisão e nunca aprovada.
    - `comment` e `chat`: papel diferente de `espectador`.
  - `approvedVersionIds(events: SessionEvent[]): Set<string>`, dos eventos `approval`.
- Produces (`versions.ts`):
  - `approveVersion(client, pieceId, versionId): Promise<void>` e `stepBack(client, pieceId): Promise<void>`.
  - `uploadFinalVersion(client, input: { piece: Piece; file: File | null; caption: string | null }): Promise<Version>`. Se o tipo não é `texto`: `checkImageFile`, upload em `newImagePath(teamId, pieceId, type)` e depois a RPC.
  - `updateCaption(client, versionId, caption): Promise<Version>`.
- UI:
  - **`VersionViewer` (modal):**
    - Imagem grande e a legenda, editável se `editCaption`.
    - "Aprovar esta versão" e "Baixar", que chama `downloadUrl` e depois `openExternal`. O arquivo se chama `<título da peça> v<n>.<ext>`.
    - Setas entre as versões da peça.
    - Espaço para os comentários (Task 10).
  - **`PieceHeader`:**
    - O status com o rótulo.
    - "Voltar uma etapa", com a confirmação "Voltar a peça de <status> para <anterior>?".
    - "Enviar versão final", que abre o `UploadFinalDialog`:
      - `imagem`: arquivo.
      - `texto`: legenda.
      - `imagem_texto`: os dois, com a legenda da base aprovada já preenchida.
  - Os erros usam `friendlyError`.

- [ ] **Step 1: Write the failing tests.**
  - `actions.test.ts`: `pieceActions follows the permission table`, uma tabela com os 4 papéis × os 5 status × as 2 fases, mais aprovada e não aprovada, e `texto` contra `imagem`.
  - `versions.test.ts` (local):
    - `designer uploads the final after the base is approved, and the gestor approves it`: `createAgentVersion`, aprovação do gestor, `uploadFinalVersion` da designer, aprovação do gestor; a peça termina `aprovada`.
    - `uploading a final before approval gives the friendly message`.
    - `designer cannot undo an approval`.
    - `caption edit creates an edicao version`.
- [ ] **Step 2: Run to verify fail.** Run: `pnpm test tests/desktop/actions.test.ts tests/desktop/versions.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Run.** Run: `pnpm db:reset && pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(desktop): version viewer, approval, step back, final upload and caption edit"`

---

### Task 10: Comentários na imagem e na legenda

**Files:**
- Create: `src/lib/excerpt.ts`, `src/data/comments.ts`, `src/ui/CommentLayer.tsx`
- Modify: `src/ui/VersionViewer.tsx`
- Test: `tests/desktop/excerpt.test.ts`, `tests/desktop/comments.test.ts`

**Interfaces:**
- Produces (`excerpt.ts`):
  - `captionExcerpt(caption: string, startUtf16: number, endUtf16: number): { text_start: number; text_end: number; quote: string } | null`. Converte a seleção do DOM (UTF-16) para code points. Uma seleção vazia devolve null.
  - `pointFromClick(rect: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number): { x: number; y: number }`: proporção dentro da imagem, limitada a 0..1 e arredondada a 4 casas.
- Produces (`comments.ts`):
  - `type Comment = { id: string; version_id: string; piece_id: string; author_id: string | null; body: string; x: number | null; y: number | null; text_start: number | null; text_end: number | null; quote: string | null; parent_id: string | null; resolved: boolean; created_at: string }`.
  - `loadComments(client, pieceId): Promise<Comment[]>`.
  - `addComment(client, input: { teamId: string; pieceId: string; versionId: string; body: string; target: { x: number; y: number } | { text_start: number; text_end: number; quote: string } | null; parentId: string | null }): Promise<Comment>`. O `author_id` é o usuário da sessão.
  - `setResolved(client, commentId, resolved: boolean): Promise<void>`.
- UI: `CommentLayer`, dentro do `VersionViewer`.
  - Pinos numerados sobre a imagem; os resolvidos ficam esmaecidos.
  - "Comentar na imagem": o próximo clique cria um pino com um formulário.
  - Selecionar um trecho da legenda mostra "Comentar trecho".
  - Uma lista de fios, com as respostas embaixo e o botão "Resolver" ou "Reabrir".
  - Sem `comment`, a lista aparece só para leitura.

- [ ] **Step 1: Write the failing tests.**
  - `excerpt.test.ts`:
    - `counts code points, not UTF-16 units`: em `'Oi 👋 mundo'`, a seleção UTF-16 6..11 dá `{ text_start: 5, text_end: 10, quote: 'mundo' }`.
    - `an empty selection is null`.
    - `pointFromClick returns proportions clamped to the image`: rect `{ left: 100, top: 50, width: 200, height: 100 }`, clique em (150, 100), dá `{ x: 0.25, y: 0.5 }`. Um clique fora fica limitado a 0..1.
  - `comments.test.ts` (local):
    - `pins a comment on the image and replies to it`.
    - `comments a caption excerpt with an emoji before it`: o trigger do servidor aceita os offsets de `captionExcerpt`.
    - `resolves a thread`.
    - `espectador gets the friendly error`.
- [ ] **Step 2: Run to verify fail.** Run: `pnpm test tests/desktop/excerpt.test.ts tests/desktop/comments.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Run.** Run: `pnpm db:reset && pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(desktop): comments pinned to the image and to caption excerpts"`

---

### Task 11: Presença e notificação de menção

**Files:**
- Create: `src/lib/presence.ts`, `src/data/presence.ts`
- Modify: `src/data/events.ts` (`subscribeMentions`), `src/ui/Shell.tsx`, `src/ui/CampaignSidebar.tsx`, `src/ui/PieceHeader.tsx`
- Test: `tests/desktop/presence-logic.test.ts`, `tests/desktop/presence.test.ts`

**Interfaces:**
- Produces (`lib/presence.ts`):
  - `type PresenceMeta = { user_id: string; piece_id: string | null }`.
  - `onlineUsers(state: Record<string, PresenceMeta[]>): Set<string>`.
  - `usersInPiece(state, pieceId: string): string[]`, sem repetir.
  - `shouldNotify(event: SessionEvent, me: string): boolean`: `user_message` que tem `me` em `mention_user_ids` e autor diferente de `me`.
  - `mentionNotice(event, members: Record<string, string>, pieceTitle: string): { title: string; body: string }`. O título é `<autor> mencionou você`. O corpo é `<título da peça>: <texto>`, cortado em 120 caracteres com `…`.
- Produces (`data/presence.ts`):
  - `joinTeamPresence(client, teamId, me: PresenceMeta, onSync: (state: Record<string, PresenceMeta[]>) => void): Promise<{ setPiece(pieceId: string | null): Promise<void>; leave(): Promise<void> }>`.
  - Usa o canal privado `team:<teamId>`, com `config: { private: true, presence: { key: me.user_id } }`. Antes, chama `await client.realtime.setAuth()`, e depois faz `track(me)`.
- Produces (`events.ts`): `subscribeMentions(client, teamId, onEvent: (e: SessionEvent) => void): () => void`, com INSERT em `session_events` (`team_id=eq.`).
- UI:
  - Ponto verde no time da lateral para quem está online.
  - Avatares (iniciais do nome) no topo para `usersInPiece`.
  - `notify` com `mentionNotice` quando `shouldNotify`, mesmo em outra peça.

- [ ] **Step 1: Write the failing tests.**
  - `presence-logic.test.ts`:
    - `onlineUsers and usersInPiece read the presence state`.
    - `notifies only mentions of me by someone else`.
    - `mentionNotice truncates long messages`.
  - `presence.test.ts` (local): `team members see each other online and in the same piece`, com dois clients do mesmo time e `setPiece` em um deles.
- [ ] **Step 2: Run to verify fail.** Run: `pnpm test tests/desktop/presence-logic.test.ts tests/desktop/presence.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Run.** Run: `pnpm db:reset && pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Conferir à mão.**
  - Rodar o app (`pnpm app`) com um usuário e o navegador (`pnpm --filter @sala/desktop dev`, em `http://localhost:1420`) com outro.
  - Os dois aparecem online.
  - Um `@Nome` do navegador gera a notificação no app.
- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat(desktop): team presence and mention notifications"`

---

### Task 12: Configurações do workspace — chaves, membros e convites

**Files:**
- Create: `src/data/keys.ts`, `src/ui/Settings.tsx`, `scripts/fake-agent.ts`
- Modify: `src/data/team.ts`, `src/ui/CampaignSidebar.tsx` (botão "Configurações do workspace", só para `admin`), `tests/helpers/images.ts` (recebe `solidPng`, que sai de `tests/live/providers.live.test.ts`), `package.json` da raiz (script `"fake-agent": "node scripts/fake-agent.ts"`), `tsconfig.json` (`include` ganha `scripts`)
- Test: `tests/desktop/keys.test.ts`, `tests/desktop/team.test.ts`, `tests/desktop/settings.test.tsx`, `tests/desktop/fake-agent.test.ts`

**Interfaces:**
- Produces (`keys.ts`):
  - `KEY_PROVIDERS`: os provedores de `MODEL_CATALOG`, na ordem em que aparecem, sem repetir (`anthropic`, `openai`, `gemini`, `fal`).
  - `PROVIDER_LABELS`: `anthropic` "Anthropic", `openai` "OpenAI", `gemini` "Google Gemini", `fal` "fal (Flux)".
  - `type KeyRow = { provider: Provider; last4: string; updated_at: string }`.
  - `loadKeys(client, teamId): Promise<KeyRow[]>`, com o select exato `'provider, last4, updated_at'`.
  - `saveKey(client, teamId, provider, key: string): Promise<void>` e `deleteKey(client, teamId, provider): Promise<void>`.
  - `maskKey(last4: string): string`: `...<last4>`.
- Produces (`team.ts`; `Member` e `loadMembers` vêm da Task 4):
  - `type Invite = { email: string; role: Role; created_at: string }`.
  - `inviteMember(client, teamId, email: string, role: Role): Promise<void>`, `loadInvites(client, teamId): Promise<Invite[]>` e `revokeInvite(client, teamId, email: string): Promise<void>` (RPCs e tabela da Task 2). *(Revisão de 2026-10-28: convites no banco no lugar da Edge Function `add-member`.)*
  - `setMemberRole(client, teamId, userId, role): Promise<void>` e `removeMember(client, teamId, userId): Promise<void>`.
- Produces (`scripts/fake-agent.ts`). É o agente falso para conferir o app sem chaves de provedor; ele nunca chama provedor real.
  - `assertLocalUrl(url: string): void`: só aceita `127.0.0.1` ou `localhost`. Em qualquer outro host, lança `Error('fake-agent só roda contra o Supabase local')`.
  - `fakeAgentProviders(): Providers`:
    - O texto devolve `{"image_prompt": "Teste local: <primeiros 60 caracteres do pedido atual>", "caption": "Legenda de teste <hora>"}`.
    - A imagem devolve `solidPng(512, <cor aleatória>)`, um PNG de verdade, visível no app. Ela espera 3 s, para dar tempo de testar o redirecionamento.
  - O script lê `.env.test`, chama `assertLocalUrl` e roda `runWorker` (Plano 2) com ``(slot) => createExecutorDb(client, `fake-agent#${slot}`)`` e `fakeAgentProviders()`, até `Ctrl+C`.
  - O time precisa de uma chave falsa (20+ caracteres, sem espaço, ex.: `chave-falsa-local-0001`) para `anthropic` e para `gemini`, cadastrada na tela de chaves desta task. Os provedores falsos ignoram a chave.
- UI: `Settings(props: { teamId; keys: KeyRow[]; members: Member[]; invites: Invite[]; me: string; onSaveKey; onDeleteKey; onInvite; onRevokeInvite; onSetRole; onRemove })`, com as abas "Chaves" e "Membros".
  - **Chaves:** uma linha por `KEY_PROVIDERS`.
    - Mostra `maskKey` e "Atualizada em <data>", ou "Sem chave".
    - Campo `type="password"` com `autoComplete="off"`, e os botões "Salvar" e "Remover" (com confirmação).
    - Depois de salvar, o campo é limpo e a máscara nova aparece.
  - **Membros:**
    - A lista de membros, com o papel editável e "Remover" (com confirmação; a pessoa perde o acesso na hora).
    - O formulário "Convidar" (e-mail e papel). Depois de convidar, aparece o texto "Convite criado. Avise a pessoa: baixe a Sala da Campanha e entre com <email>." e o botão "Copiar". O app não manda e-mail de convite.
    - Os convites pendentes, cada um com "Cancelar".

- [ ] **Step 1: Write the failing tests.**
  - `keys.test.ts` (local):
    - `admin saves a key and members load only the mask`: `JSON.stringify(await loadKeys(...))` não contém a chave.
    - `gestor gets the friendly admin-only message`.
  - `team.test.ts` (local):
    - `only the admin invites, with the friendly message`: o gestor recebe "Só o admin do workspace convida pessoas.".
    - `admin invites, lists and cancels an invite`.
    - `admin changes a role and removes a member`.
  - `settings.test.tsx` (jsdom):
    - `clears the typed key after saving and shows only the mask`.
    - `asks before removing a member`.
    - `shows the text to send after inviting`.
  - `fake-agent.test.ts`:
    - `refuses a non-local Supabase URL`.
    - `fake providers answer with a plan parsePlan accepts and a real PNG`: `parsePlan` aceita o plano para os 3 tipos de peça, e `sniffType` do PNG dá `image/png`.
- [ ] **Step 2: Run to verify fail.** Run: `pnpm test tests/desktop/keys.test.ts tests/desktop/team.test.ts tests/desktop/settings.test.tsx tests/desktop/fake-agent.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Run.** Run: `pnpm db:reset && pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Conferir à mão.** Rodar `pnpm app` como admin.
  - Cadastrar chaves falsas para Anthropic e Gemini.
  - Rodar `pnpm fake-agent` em outro terminal e pedir uma peça. A mensagem passa por "o agente está trabalhando" e vira uma versão com imagem colorida.
  - Uma segunda mensagem mandada durante os 3 s da imagem entra na rodada seguinte.
- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat(desktop): workspace settings for keys, members and invites, and a local fake agent"`

---

### Task 13: Build, DMG e verificação final

**Files:**
- Create: `docs/instalar-no-mac.md`
- Modify: este plano (seção "Checklist de deploy do app" e "Verificado"), `HANDOFF.md`
- Test: checklist manual abaixo; a suíte inteira

**Interfaces:**
- Produces:
  - `.dmg` em `packages/desktop/src-tauri/target/release/bundle/dmg/`, sem assinatura.
  - `docs/instalar-no-mac.md`, em pt-BR, para o time:
    - Abrir o `.dmg` e arrastar para Aplicativos.
    - No primeiro uso, ir em Ajustes do Sistema → Privacidade e Segurança → "Abrir mesmo assim".
    - Entrar com Google, Apple ou o código do e-mail, e criar o workspace.

- [ ] **Step 1: Suíte.** Run: `pnpm db:reset && pnpm test && pnpm typecheck && cargo check --manifest-path packages/desktop/src-tauri/Cargo.toml`. Expected: PASS.
- [ ] **Step 2: Build.** Run: `pnpm --filter @sala/desktop tauri build`, com `.env.local` do Supabase local. Expected: o `.app` e o `.dmg` são gerados.
- [ ] **Step 3: Conferir à mão** (instalar o `.app` em `/Applications`, com o Supabase local):
  - [ ] Entrar com um e-mail novo pelo código do Mailpit, dar o nome e criar o workspace; fechar e abrir o app mantém a sessão.
  - [ ] Google: com um cliente OAuth do tipo Web (redirect `http://127.0.0.1:55321/auth/v1/callback`) e as variáveis em `supabase/.env`, "Entrar com Google" abre o navegador e volta ao app por `sala://auth/callback`, já logado.
  - [ ] Apple: o mesmo, com o Services ID e a chave da conta Apple Developer. Sem a conta, o item fica pendente no `HANDOFF.md`.
  - [ ] Um convite para o e-mail de uma segunda conta: no login dela, o workspace aparece com o papel convidado.
  - [ ] Criar campanha e peça; subir 2 referências; um PDF é recusado com a mensagem.
  - [ ] `open 'sala://campanha/<id>/peca/<id>'` abre a peça, com o app aberto e com o app fechado.
  - [ ] Sem o `fake-agent`, a mensagem ao agente fica "na fila"; `@Nome` notifica a outra pessoa, que está no navegador.
  - [ ] Com `pnpm fake-agent` rodando e chaves falsas cadastradas, pedir uma peça e receber a versão; aprovar, enviar a final, comentar no ponto e no trecho, e aprovar a final.
  - [ ] Como espectador, nenhum botão de escrita aparece.
  - [ ] As configurações (só admin) salvam a chave e mostram só `...last4`; convidar e cancelar convite funcionam.
  - [ ] `grep -r` por um trecho da chave salva no diretório de dados do app (`~/Library/WebKit/app.salacampanha.desktop`, `~/Library/Application Support/app.salacampanha.desktop`) não acha nada.
- [ ] **Step 4: Registrar.**
  - Preencher "Verificado" neste plano.
  - Abrir uma pendência no `HANDOFF.md`: o fluxo com o agente de verdade (executor com chaves) ainda não foi testado no app. Ela depende das pendências do teste ao vivo.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "chore(desktop): unsigned DMG build, install guide and Plan 3 checklist"`

---

## Decisões deste plano

| Tema | Decisão |
|---|---|
| Cadastro e login | Cadastro aberto com Google, Apple e código de 6 dígitos no e-mail, sem senha (decisões do fundador, 2026-10-28). OAuth com PKCE, voltando ao app por `sala://auth/callback`. O template local tem `{{ .Token }}`. No projeto hospedado, precisa de SMTP próprio |
| Workspace | No primeiro login, a pessoa cria o próprio workspace (`create_workspace`) e é admin dele. Pode estar em vários e trocar pela lateral |
| Convites | O admin convida por e-mail e papel (`invite_member`). O convite é aceito no login pelo dono do e-mail verificado (`accept_invites`). O app não manda e-mail: mostra o texto para a pessoa copiar. Trocar papel e remover são RPCs. O workspace nunca fica sem admin. Substitui a Edge Function `add-member` (revisão de 2026-10-28) |
| Login com assinatura | Fora: a Anthropic não permite que apps de terceiros ofereçam login com a conta do Claude sem aprovação. O modo local estilo Conductor é uma ideia guardada (spec, seção 11a) |
| Distribuição | `.dmg` sem assinatura para os testes, com um guia de instalação (decisão do fundador, 2026-10-28). Assinatura e notarização são obrigatórias antes de abrir o download ao público. A atualização automática fica para depois |
| Navegação | Estado React com `Route`, sem roteador. O link `sala://` vira `Route` |
| Estado | Hooks e props, sem biblioteca de estado. A camada de dados recebe o client por parâmetro |
| Tempo real | Um canal por peça (`piece:<id>`) e um por time (presença, menções e listas). A cada `SUBSCRIBED`, o app busca o que perdeu |
| Presença | Canal privado `team:<id>`, autorizado por policy em `realtime.messages`. Um membro de outro time não entra |
| Escolha de modelo | O app sempre manda uma escolha explícita. O valor inicial do seletor segue a mesma herança por capacidade do executor (`inheritedModel` no shared) |
| Imagens | URLs assinadas de 1 h. Baixar abre uma URL assinada com `download` no navegador padrão |
| Vários workspaces | Seletor na lateral; o último workspace usado fica no `localStorage`; um link de outro workspace da pessoa troca para ele (revisão de 2026-10-28: antes, usava o primeiro time) |
| Teste sem chaves | `pnpm fake-agent` roda o worker do Plano 2 com provedores falsos, só contra o Supabase local. O fluxo inteiro do app pode ser testado antes de existir chave de provedor |

## Fora deste plano

- Atualização automática. (Assinatura e notarização ficam no checklist de deploy, antes do download público.)
- Modo local estilo Conductor, com o Claude Code ou o Codex da pessoa (spec, seção 11a). Depende de aprovação da Anthropic.
- E-mail de convite enviado pelo app.
- Limites contra abuso do cadastro aberto (por exemplo, quantos workspaces uma pessoa pode criar).
- Quem entra com Apple usando e-mail privado (relay) não casa com um convite para o e-mail real: nesse caso, a pessoa entra com Google ou com o código no e-mail.
- Windows e Linux.
- Notificações no Microsoft Teams e registro de uso por pessoa.
- Krea (depende da designer; ver `HANDOFF.md`).
- Teste do fluxo com o agente de verdade: depende das chaves (pendências do teste ao vivo no `HANDOFF.md`).

## Checklist de deploy do app

- [ ] Aplicar a migration `0010_app_support.sql` no projeto hospedado.
- [ ] Auth no projeto hospedado:
  - Ligar o cadastro público ("Allow new users to sign up").
  - Configurar SMTP próprio (ex.: Resend).
  - Usar o template "Magic Link" com `{{ .Token }}` (conteúdo de `supabase/templates/codigo.html`).
  - Pôr `sala://auth/callback` em Redirect URLs.
  - Google: um cliente OAuth no Google Cloud, com o redirect `https://<projeto>.supabase.co/auth/v1/callback`.
  - Apple: um Services ID e uma chave na conta Apple Developer.
- [ ] Antes de abrir o download ao público, assinar e notarizar o app com a conta Apple Developer.
- [ ] Em `packages/desktop/src-tauri/capabilities/default.json`, adicionar `https://<projeto>.supabase.co/*` ao escopo de `opener:allow-open-url`, com o ref exato do projeto hospedado. Nunca `https://*.supabase.co/*`: no glob do opener, o `*` atravessa `/` e libera qualquer site. Sem esse item, o login com Google ou Apple e o "Baixar" não abrem o navegador.
- [ ] Gerar o build com `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` do projeto hospedado. Nunca usar a service role no build.
- [ ] Executor do Plano 2 rodando, com as pendências do teste ao vivo resolvidas.
- [ ] Distribuir o `.dmg` com `docs/instalar-no-mac.md`.

### Verificado

(preenchido na Task 13)
