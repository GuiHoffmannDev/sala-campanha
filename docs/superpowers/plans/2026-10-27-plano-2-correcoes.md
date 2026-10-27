# Plano 2 — Correções da revisão final

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir os 15 problemas encontrados na revisão final do Plano 2 (2026-10-27) e fechar o Plano 2 com os documentos refletindo o estado real.

**Plano corrigido:** `docs/superpowers/plans/2026-10-25-plano-2-executor-agente.md` (chamado aqui de "Plano 2"). Toda a estrutura de arquivos, as interfaces e as Global Constraints dele continuam valendo.

**Spec:** `docs/superpowers/specs/2026-10-21-sala-campanha-design.md`

**Ordem:** A → B → C → D → E. Cada task roda num terminal separado e é revisada em outro (ver `HANDOFF.md`).

---

## Decisões do fundador (2026-10-27)

| Item da revisão | Decisão |
|---|---|
| Esforço do modelo | O usuário escolhe o esforço junto do modelo. A escolha de modelo ganha `effort` opcional, que o executor repassa ao provedor. Sem esforço escolhido, vale o padrão do provedor. O teto de saída do modelo de texto sobe de 2000 para 32000 tokens |
| Esforço em modelos de imagem | Vale onde o modelo aceita. Hoje só o Nano Banana 2.1 (`minimal`, `medium`, `high`). Nos modelos sem controle de esforço, um `effort` é recusado |
| Catálogo de modelos | Continua fixo em `MODEL_CATALOG`. Cada time usa a própria chave de API. Sem login com conta Claude |
| Escolha herdada | Mensagem sem modelo herda a última escolha **válida** do histórico: passa no schema, todos os modelos existem no catálogo e todo esforço é aceito pelo modelo. Sem nenhuma válida, usa o padrão. Uma escolha inválida no próprio lote continua dando `invalid_model` |
| Imagem atual | É a imagem da última versão **base**. A versão final (feita no Photoshop) nunca é editada pelo agente |
| Nova tentativa em imagem | Chamadas de imagem não repetem depois de erro de rede (a geração pode ter sido cobrada). Continuam repetindo uma vez em 429 e 5xx |
| Referências do Gemini | `maxReferenceImages`: Nano Banana 2.1 = 10 e Nano Banana Pro = 6. São as vagas de objeto em alta fidelidade da doc atual (2.1: 10 objetos + 4 personagens; Pro: 6 objetos + 5 personagens + 3 de estilo) |
| Desligamento | `SHUTDOWN_GRACE_MS` passa a ter padrão `480000` e precisa ser `≥ TEXT_TIMEOUT_MS + IMAGE_TIMEOUT_MS + 60000` |
| Teste ao vivo | O fundador tem chaves de alguns provedores. Roda o que houver; os outros ficam como pendência |

Fatos conferidos no Context7 em 2026-10-27:
- OpenAI Responses: `max_output_tokens` inclui os tokens de raciocínio. O GPT-6 Astra aceita `reasoning.effort` = `low`, `medium`, `high`, `xhigh` ou `max`, e não aceita `none`.
- Anthropic Messages: Sonnet 5.5 e Opus 5.5 raciocinam por padrão quando `thinking` é omitido, e o raciocínio conta em `max_tokens`. O esforço vai em `output_config.effort`, com os mesmos cinco valores.
- Gemini: o nível de raciocínio do Nano Banana 2.1 vai em `generationConfig.thinkingConfig.thinkingLevel`. Os níveis são `minimal`, `medium` (padrão) e `high`, e os tokens de raciocínio são cobrados.

## Global Constraints

- Todas as Global Constraints do Plano 2 continuam valendo. Em especial: sem dependência nova, só sintaxe TypeScript apagável, chave sempre redigida antes de log ou evento, textos de erro do chat exatamente os da tabela da Task 2 do Plano 2.
- Os IDs de modelo não mudam, e `MODEL_CATALOG` continua sendo o único lugar com IDs.
- Nenhuma task cria ou altera migration.
- Cada task atualiza, no mesmo commit, os trechos do Plano 2 e do spec que descrevem o comportamento que ela muda. Uma nota datada explica a mudança.
- Cada task marca como resolvidas, em `HANDOFF.md`, as pendências de revisão que ela fecha.

## Review Focus

1. **Dois slots do mesmo processo:** um slot que perdeu o claim recebe `ClaimLostError`, mesmo que outro slot do mesmo processo tenha reivindicado a mensagem de novo. Nenhum evento nem versão do slot antigo é aceito.
2. **Escolha de modelo:** um esforço não aceito pelo modelo, ou um modelo fora do catálogo, no lote atual, gera `invalid_model` sem ler chave nem chamar provedor. Uma escolha inválida antiga no histórico não prende a peça.
3. **Imagem devolvida pelo provedor:** o tipo vem dos bytes, a imagem tem no máximo 25 MiB e a resposta HTTP tem teto. Uma chamada de imagem nunca é repetida depois de erro de rede.
4. **Imagem atual:** o agente edita a última versão base, nunca a final.
5. **Chaves:** a chave continua fora de log, evento e erro em todos os caminhos novos (esforço, teto de resposta, decodificação de imagem).

---

### Task A: Contrato de modelo — esforço, schema estrito e limites do Gemini

Resolve os itens 11 e 12 da revisão e o contrato do esforço (item 2).

**Files:**
- Modify: `packages/shared/src/agent.ts`
- Test: `tests/shared/agent.test.ts`
- Docs: Plano 2, Task 2 (tabela do catálogo e a nota do Step 3, perto da linha 192); spec, seção 4, Fase 1, item 2

**Interfaces:**
- `type CatalogModel` ganha `efforts: readonly string[]`, os valores de esforço aceitos pelo modelo. Lista vazia = modelo sem controle de esforço.
- `MODEL_CATALOG`, na mesma ordem e com os mesmos IDs:

| model | efforts | maxReferenceImages |
|---|---|---|
| `claude-sonnet-5-5` | `low`, `medium`, `high`, `xhigh`, `max` | 0 |
| `gpt-6-astra` | `low`, `medium`, `high`, `xhigh`, `max` | 0 |
| `claude-opus-5-5` | `low`, `medium`, `high`, `xhigh`, `max` | 0 |
| `gemini-nano-banana-2.1` | `minimal`, `medium`, `high` | 10 |
| `fal-ai/flux-pro/kontext/max/multi` | (vazia) | 4 |
| `gemini-3-pro-image` | (vazia) | 6 |

- `ModelRefSchema = z.object({ provider: ProviderSchema, model: z.string().min(1), effort: z.string().min(1).optional() }).strict()`. `ModelChoiceSchema` e `AgentStartedBodySchema.models` passam a aceitar `effort` porque reusam `ModelRefSchema`.
- A validação de que o esforço é aceito pelo modelo fica no executor (Task B). O schema só confere o formato.

- [x] **Step 1: Escrever os testes que falham** em `tests/shared/agent.test.ts`:
  - `ModelChoiceSchema` rejeita `{ text: { provider: 'openai', model: 'gpt-6-astra', foo: 1 } }`.
  - `ModelChoiceSchema` aceita `{ text: { provider: 'openai', model: 'gpt-6-astra', effort: 'low' } }` e rejeita `effort: ''`.
  - Os `efforts` e os `maxReferenceImages` de cada modelo são os da tabela acima.
  - `AgentStartedBodySchema` aceita `models.text` com `effort`.
- [x] **Step 2: Run to verify fail.** Run: `pnpm test tests/shared/agent.test.ts`. Expected: FAIL nos casos novos.
- [x] **Step 3: Implementar** as mudanças em `agent.ts`.
- [x] **Step 4: Atualizar os documentos.**
  - Plano 2, Task 2: a tabela do catálogo ganha a coluna `efforts` e os novos limites. A nota do Step 3 passa a registrar a correção de 2026-10-27, citando os limites da doc atual.
  - Spec, seção 4, Fase 1, item 2: "escolhe o modelo e, quando o modelo permite, o esforço (quanto ele raciocina). O agente usa a chave de API cadastrada pelo time."
  - `HANDOFF.md`: marcar as duas pendências da Tarefa 2 do Plano 2 como resolvidas.
- [x] **Step 5: Run.** Run: `pnpm test tests/shared && pnpm typecheck`. Expected: PASS, sem erro de tipo.
- [x] **Step 6: Commit.** `git add -A && git commit -m "feat(shared): reasoning effort in the model choice, strict model refs and Gemini reference limits"`

---

### Task B: Escolha de modelo e esforço no executor

Resolve os itens 2, 3 e 4 da revisão.

**Files:**
- Modify: `packages/executor/src/job.ts`, `packages/executor/src/orchestrator.ts`, `packages/executor/src/providers/types.ts`, `packages/executor/src/providers/openai.ts`, `packages/executor/src/providers/anthropic.ts`, `packages/executor/src/providers/gemini.ts`
- Test: `tests/executor/job.test.ts`, `tests/executor/orchestrator.test.ts`, `tests/executor/providers-text.test.ts`, `tests/executor/providers-gemini.test.ts`
- Docs: Plano 2, Task 4 (`TextRequest` e os corpos dos pedidos), Task 5 (corpo do Gemini), Task 7 (`parsePlan`), Task 8 (escolha de modelo) e a linha "Modelo padrão" da tabela de decisões

**Interfaces:**
- `TextRequest` e `ImageRequest` ganham `effort?: string`. Cada adaptador manda o campo só quando ele existe:
  - OpenAI: `reasoning: { effort }`.
  - Anthropic: `output_config: { effort }`.
  - Gemini: `generationConfig.thinkingConfig = { thinkingLevel: <effort> }`. Antes de implementar, conferir no Context7 o formato exato do valor no REST, porque o exemplo em curl da doc usa `"High"`.
  - fal: nunca recebe esforço, porque o catálogo não lista nenhum.
- `orchestrator.ts`:
  - `export const MAX_OUTPUT_TOKENS = 32000`.
  - `planRound` recebe `effort: string | null` e repassa em `TextRequest.effort`.
  - `PlanSchema` usa `z.string().nullish()` nas duas chaves: `null` numa chave que o tipo da peça descarta não é erro.
- `resolveModels(kind, batch, history, keyed)`:
  - Escolha do lote: a última `model` não nula do lote. Se ela falha no schema, se um modelo não está no catálogo para a capacidade, ou se um esforço não está em `model.efforts`, retorna `invalid_model`, como hoje.
  - Escolha do histórico, usada só quando o lote não tem nenhuma: a última que passa nas mesmas três checagens. Escolhas inválidas são puladas. Sem nenhuma válida, cada capacidade usa o padrão (o primeiro do catálogo com chave).
  - Esforço inválido retorna `{ code: 'invalid_model', model: '<id> com esforço <effort>', capability }`. A mensagem do chat fica "O modelo gpt-6-astra com esforço turbo não está disponível para texto.", sem código de erro novo.
  - O resultado leva o esforço de cada capacidade (`effort: string | null`). Ele vai para `planRound`, para `generateImage` e para `agent_started.models` (o `ModelRef` ganha `effort` quando houver).

- [x] **Step 1: Escrever os testes que falham.**
  - `job.test.ts`:
    - O histórico tem `{ image: { provider: 'gemini', model: 'nope' } }` e o lote não tem modelo: a rodada usa o modelo de imagem padrão.
    - O histórico tem [escolha válida A, escolha inválida B]: a rodada usa A.
    - O lote pede `{ text: { provider: 'openai', model: 'gpt-6-astra', effort: 'turbo' } }`: `agent_error` com `invalid_model`, nenhuma chave lida e nenhum provedor chamado.
    - O esforço escolhido chega ao provedor falso e aparece em `agent_started.models`.
  - `orchestrator.test.ts`:
    - `parsePlan('{"image_prompt":"x","caption":null}', 'imagem', ...)` retorna `{ imagePrompt: 'x', caption: null }`.
    - `image_prompt: null` numa peça `imagem` continua dando `invalid_output`.
  - `providers-text.test.ts`:
    - Com `effort: 'low'`, a OpenAI recebe `reasoning: { effort: 'low' }` e a Anthropic recebe `output_config: { effort: 'low' }`.
    - Sem `effort`, nenhum dos dois campos aparece no corpo.
  - `providers-gemini.test.ts`: com `effort`, aparece `thinkingConfig.thinkingLevel`; sem `effort`, não aparece.
- [x] **Step 2: Run to verify fail.** Run: `pnpm test tests/executor/job.test.ts tests/executor/orchestrator.test.ts tests/executor/providers-text.test.ts tests/executor/providers-gemini.test.ts`. Expected: FAIL nos casos novos.
- [x] **Step 3: Implementar.**
- [x] **Step 4: Atualizar os documentos** do Plano 2 listados em Files, com uma nota datada da decisão.
- [x] **Step 5: Run.** Run: `pnpm db:reset && pnpm test && pnpm typecheck`. Expected: PASS.
- [x] **Step 6: Commit.** `git add -A && git commit -m "feat(executor): user-chosen reasoning effort, valid inherited model choice and nullable plan keys"`

---

### Task C: Imagem devolvida pelo provedor e HTTP

Resolve os itens 7, 8 e 10 da revisão e a parte do item 9 que está nos provedores. Também fecha as duas primeiras pendências da Tarefa 6 do Plano 2 no `HANDOFF.md`.

**Files:**
- Create: `packages/executor/src/providers/image.ts`
- Modify: `packages/executor/src/providers/types.ts`, `packages/executor/src/providers/http.ts`, `packages/executor/src/providers/gemini.ts`, `packages/executor/src/providers/fal.ts`
- Test: `tests/executor/providers-gemini.test.ts`, `tests/executor/providers-fal.test.ts`, `tests/executor/providers-text.test.ts`
- Docs: Plano 2, Task 4 (regra de nova tentativa), Task 5 e Task 6 (validação da imagem)

**Interfaces:**
- `types.ts`: `export const MAX_IMAGE_BYTES = 26_214_400`, o limite do bucket `team-files`. Fica aqui para que `http.ts` e `image.ts` o importem sem import circular.
- `http.ts`:
  - `export const MAX_DETAIL = 300`.
  - `export function abortError(signal: AbortSignal, provider: Provider): unknown` devolve um `ProviderError('timeout')` quando o motivo é um prazo vencido e `signal.reason` nos outros casos. Substitui as duas cópias dessa regra (hoje em `postJson` e no download da fal).
  - `export async function readCapped(res: Response, cap: number, tooLarge: () => Error): Promise<Uint8Array>`, extraído do `download` da fal. Recusa um `content-length` acima do teto e lê em pedaços, parando ao passar do teto.
  - `postJson` lê o corpo com `readCapped`, com teto `MAX_RESPONSE_BYTES = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 1_000_000` (uma imagem de 25 MiB em base64 mais o JSON em volta). Acima dele, `invalid_output` sem nova tentativa.
  - `PostJsonOptions` ganha `idempotent?: boolean`, com padrão `true`. Com `false`, um erro de rede, inclusive no meio do corpo, vira `provider_error` sem nova tentativa. 429 e 5xx continuam com uma nova tentativa nos dois casos.
- `image.ts`:
  - `sniffType(bytes)`, movido de `fal.ts`.
  - `decodeImage(base64: unknown, provider: Provider): GeneratedImage`:
    - Recusa um valor que não é string, vazio ou maior que `Math.ceil(MAX_IMAGE_BYTES / 3) * 4` caracteres, antes de decodificar.
    - Aplica `isBase64`.
    - Decodifica e confere `≤ MAX_IMAGE_BYTES`.
    - Tira o tipo de `sniffType`, ignorando o rótulo declarado.
    - Qualquer falha vira `ProviderError('invalid_output')`.
  - `checkRequestSize(body: unknown, provider: Provider, label: string): void`. É o limite de 20 MB por pedido, com a mensagem pt-BR atual ("o limite do <label> é 20 MB por pedido...").
- `gemini.ts` e `fal.ts`:
  - Usam `decodeImage`, `checkRequestSize`, `MAX_DETAIL`, `abortError` e `postJson` com `idempotent: false`.
  - O download `https` da fal usa `readCapped` e `sniffType`.
  - Somem `IMAGE_TYPES`, `checkType` e as constantes duplicadas.

- [ ] **Step 1: Escrever os testes que falham.**
  - Gemini (`inlineData` com `mimeType: 'image/png'`) e fal (data URI `data:image/png;base64,...`) com bytes JPEG: o resultado tem `mimeType: 'image/jpeg'`.
  - Imagem decodificada acima de `MAX_IMAGE_BYTES`, nos dois adaptadores: `invalid_output`.
  - Bytes que não são PNG, JPEG nem WebP: `invalid_output`.
  - Resposta JSON com `content-length`, ou corpo real, acima do teto: `invalid_output` com uma chamada só.
  - Erro de rede numa chamada de imagem (Gemini e fal): uma chamada só e `provider_error`. Numa chamada de texto: continuam duas chamadas.
  - 429 numa chamada de imagem: continuam duas chamadas.
- [ ] **Step 2: Run to verify fail.** Run: `pnpm test tests/executor/providers-gemini.test.ts tests/executor/providers-fal.test.ts tests/executor/providers-text.test.ts`. Expected: FAIL nos casos novos.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Atualizar os documentos** do Plano 2 listados em Files. Em `HANDOFF.md`, marcar como resolvidas as pendências "Imagem em data URI confia no tipo declarado" e "Imagem em data URI sem limite próprio de 25 MiB".
- [ ] **Step 5: Run.** Run: `pnpm db:reset && pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 6: Commit.** `git add -A && git commit -m "fix(executor): image type from bytes, size caps and no retried image calls after network errors"`

---

### Task D: Rodada, worker e desligamento

Resolve os itens 1, 5, 6 e 13 da revisão e o resto do item 9.

**Files:**
- Modify: `packages/executor/src/worker.ts`, `packages/executor/src/main.ts`, `packages/executor/src/job.ts`, `packages/executor/src/db.ts`, `packages/executor/src/log.ts`, `packages/executor/src/orchestrator.ts`, `packages/executor/src/config.ts`
- Test: `tests/executor/worker.test.ts`, `tests/executor/job.test.ts`, `tests/executor/db.test.ts`, `tests/executor/config.test.ts`
- Docs: Plano 2:
  - Task 3: tabela de config e `latestVersion` (perto da linha 244).
  - Task 9: assinatura de `runWorker`.
  - Tabela de decisões: linha "Imagem atual".
  - Checklist de deploy: `EXECUTOR_ID` e o grace de "120 s".

**Interfaces:**
- `runWorker(deps: Omit<JobDeps, 'db'> & { db: (slot: number) => ExecutorDb }, opts: WorkerOptions, signal: AbortSignal)`:
  - O slot `n` (de 1 a `concurrency`) usa `deps.db(n)` para o claim e para a rodada inteira.
  - A varredura usa `deps.db(1)`.
  - `main.ts` passa `(slot) => createExecutorDb(client, \`${config.executorId}#${slot}\`)`. Assim cada slot tem seu próprio `claimed_by`.
- `PieceContext.latestVersion` passa a ser a versão de maior `number` com `phase = 'base'`.
- `ExecutorDb.pieceStatus(pieceId: string): Promise<PieceStatus>`. O caminho de erro de `addAgentVersion` no `job.ts` usa ele, em vez de chamar `loadPieceContext` de novo.
- No `job.ts`, as referências são baixadas com `Promise.all`, mantendo a ordem: imagem atual primeiro, depois as referências.
- `log.ts` exporta `errorText`, usado em `job.ts`, `worker.ts` e `main.ts`. `db.ts` exporta `NO_AUTHOR`, usado em `orchestrator.ts`.
- `config.ts`:
  - `SHUTDOWN_GRACE_MS` com padrão `480000`.
  - Nova regra: `SHUTDOWN_GRACE_MS ≥ TEXT_TIMEOUT_MS + IMAGE_TIMEOUT_MS + 60000`, com 60 s de margem para banco e Storage.
  - Um valor fora da regra dá erro citando `SHUTDOWN_GRACE_MS`, nunca o valor.

- [ ] **Step 1: Escrever os testes que falham.**
  - `worker.test.ts`: com `concurrency: 2` e duas peças com mensagem na fila, os `claimed_by` vistos no banco são `<id>#1` e `<id>#2`. O helper `start()` passa a usar uma fábrica.
  - `db.test.ts`: numa peça com base v1 (agente) e final v2 (upload), `latestVersion` é v1. `pieceStatus` devolve o status.
  - `job.test.ts`: o caminho "someone stepped back while the image was generating" continua dando `wrong_status`.
  - `config.test.ts`:
    - O padrão de `shutdownGraceMs` é `480000`.
    - `SHUTDOWN_GRACE_MS: '0'` falha citando `SHUTDOWN_GRACE_MS`.
    - Um grace igual a `TEXT + IMAGE + 60000` é aceito.
- [ ] **Step 2: Run to verify fail.** Run: `pnpm test tests/executor/worker.test.ts tests/executor/db.test.ts tests/executor/job.test.ts tests/executor/config.test.ts`. Expected: FAIL nos casos novos.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Atualizar os documentos** do Plano 2 listados em Files. No checklist de deploy: "Grace period da plataforma ≥ `SHUTDOWN_GRACE_MS` (480 s)", e cada slot usa `<EXECUTOR_ID>#<n>`.
- [ ] **Step 5: Run.** Run: `pnpm db:reset && pnpm test && pnpm typecheck`, 3 vezes seguidas. Expected: PASS nas 3.
- [ ] **Step 6: Commit.** `git add -A && git commit -m "fix(executor): per-slot claim ids, latest base version, parallel downloads and a shutdown grace that fits a round"`

---

### Task E: Teste ao vivo e fechamento do Plano 2

Resolve os itens 14 e 15 da revisão.

**Files:**
- Modify: `tests/live/providers.live.test.ts`
- Docs: Plano 2, Task 10, Step 3; `HANDOFF.md`

**Interfaces:**
- O teste ao vivo:
  - Tem um caso por modelo de `MODEL_CATALOG`, não só o primeiro de cada provedor.
  - Usa o menor esforço da lista `efforts` quando o modelo tem, e manda sem esforço quando não tem.
  - O texto usa `maxOutputTokens: MAX_OUTPUT_TOKENS`.
  - A fal roda com 1 referência (endpoint `multi`) e sem referência (endpoint `text-to-image`).
  - Continua pulando cada provedor sem `LIVE_<PROVIDER>_KEY` e nunca imprime a chave.

- [ ] **Step 1: Ampliar o teste ao vivo.**
- [ ] **Step 2: Run sem chaves.** Run: `pnpm test tests/live`. Expected: todos os testes pulados, nenhum erro.
- [ ] **Step 3: Run com as chaves que o fundador fornecer.** Ele passa as chaves só na linha de comando (`LIVE_GEMINI_KEY=... pnpm test tests/live`), nunca num arquivo. Expected: PASS nos provedores com chave. Se algum formato de API divergir, corrigir o adaptador e o teste unitário dele juntos.
- [ ] **Step 4: Registrar o resultado.**
  - No Plano 2, o Step 3 da Task 10 volta para `[ ]` e ganha uma nota com a data, os provedores que rodaram e o resultado. Se todos os quatro passaram, o Step 3 fica `[x]`.
  - Em `HANDOFF.md`, a pendência "Nada da fal foi testado contra a API real" é atualizada com o que foi coberto. Ficam abertos os provedores sem chave e a lista `detail` do 422 da fal, que não dá para provocar de forma confiável.
- [ ] **Step 5: Fechar o Plano 2 no `HANDOFF.md`.** Marcar como resolvidas as pendências fechadas pelas Tasks A–D, se ainda não estiverem. Marcar Implementada e Revisada em cada task desta correção que tenha passado na revisão.
- [ ] **Step 6: Verificação final.**
  - Run: `pnpm db:reset && pnpm test && pnpm typecheck`. Expected: PASS.
  - Run: `docker build -f packages/executor/Dockerfile -t sala-executor . && docker run --rm sala-executor`. Expected: a imagem builda e o container sai com erro de configuração citando `SUPABASE_URL`.
  - Run: `docker run --rm --entrypoint sh sala-executor -c 'find / -name ".env*" 2>/dev/null'`. Expected: nenhum arquivo.
- [ ] **Step 7: Commit.** `git add -A && git commit -m "test(executor): live smoke test for every catalog model and Plan 2 close-out"`

---

## Fora destas correções

- O seletor de modelo e de esforço na tela fica para o Plano 3. Aqui entra só o contrato.
- Login com conta Claude: fora, por decisão do fundador. O produto usa só a chave de API do time.
- Os timeouts não mudam. Um esforço `xhigh` ou `max` pode passar de `TEXT_TIMEOUT_MS` (120 s). O usuário vê "não respondeu a tempo" e pode escolher um esforço menor.
