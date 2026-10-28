# Handoff — Sala da Campanha

Guia para executar o projeto tarefa por tarefa. Cada tarefa roda num **terminal separado** do Claude Code, e cada revisão roda em outro, para manter o contexto de cada conversa pequeno.

## Documentos

| O quê | Caminho |
|---|---|
| Design aprovado (o que construir e por quê) | `docs/superpowers/specs/2026-10-21-sala-campanha-design.md` |
| Plano 1 — Fundação do backend (Supabase) | `docs/superpowers/plans/2026-10-21-plano-1-fundacao-backend.md` |
| Plano 2 — Executor do agente | `docs/superpowers/plans/2026-10-25-plano-2-executor-agente.md` |
| Plano 2 — Correções da revisão final | `docs/superpowers/plans/2026-10-27-plano-2-correcoes.md` |
| Plano 3 — App Tauri para macOS | `docs/superpowers/plans/2026-10-28-plano-3-app-desktop.md` |

O progresso oficial fica nas caixinhas `- [ ]` dentro do plano. Este handoff tem uma lista resumida para você acompanhar.

---

## Antes de começar (uma vez)

- [ ] Docker Desktop aberto e rodando.
- [ ] Conferir as ferramentas no terminal: `node --version` (24), `pnpm --version` (12) e `supabase --version` (2.121).

---

## Ciclo de cada tarefa

Repita os passos abaixo para cada tarefa, **na ordem**.

1. **Abrir um terminal novo e implementar.** Copie o comando "Implementar" da tarefa.
2. Esperar o Claude terminar. Ele deve dizer que os testes passaram, que marcou as caixinhas e que fez o commit.
3. **Abrir outro terminal novo e revisar.** Copie o comando "Revisar" da tarefa.
4. **Se a revisão apontar problemas:**
   1. Copie o relatório da revisão.
   2. Volte ao terminal da implementação, cole o relatório e escreva: `Corrija esses problemas, rode os testes e faça commit.`
   3. Feche o terminal da revisão e repita o passo 3 num terminal novo.
5. **Se a revisão vier limpa:** feche os dois terminais, marque a tarefa abaixo como feita e siga para a próxima.

> Os testes de banco rodam contra o Supabase local, que depende do Docker. Se der erro de conexão, rode `supabase start` dentro da pasta `sala-campanha`.

---

## Plano 1 — Fundação do backend

### Tarefa 1 — Estrutura do projeto e ambiente de testes
- [ ] Implementada
- [ ] Revisada

Esta tarefa só fica totalmente verde depois da Tarefa 2. O plano já prevê isso.

**Implementar:**
```
cd ~/Documents/sala-campanha && claude "Use superpowers:executing-plans. Leia docs/superpowers/specs/2026-10-21-sala-campanha-design.md e docs/superpowers/plans/2026-10-21-plano-1-fundacao-backend.md. Execute SOMENTE a Task 1, seguindo os passos com TDD. Respeite Global Constraints e Review Focus. Ao terminar: checkboxes da Task 1 marcados no plano e commit feito. O teste do harness só passa depois da Task 2; isso é esperado. Não comece outra task."
```
**Revisar:**
```
cd ~/Documents/sala-campanha && claude "Revise o último commit (Task 1 do plano docs/superpowers/plans/2026-10-21-plano-1-fundacao-backend.md) contra a Task 1, Global Constraints e Review Focus. Confira que .env de verdade não foi commitado. Só reporte problemas, com arquivo:linha. Não edite nada."
```

### Tarefa 2 — Times, membros e papéis
- [ ] Implementada
- [ ] Revisada

**Implementar:**
```
cd ~/Documents/sala-campanha && claude "Use superpowers:executing-plans. Leia docs/superpowers/specs/2026-10-21-sala-campanha-design.md e docs/superpowers/plans/2026-10-21-plano-1-fundacao-backend.md. Execute SOMENTE a Task 2, seguindo os passos com TDD. Respeite Global Constraints e Review Focus. Ao terminar: suite passando (incluindo o harness da Task 1), checkboxes da Task 2 marcados no plano, commit feito. Não comece outra task."
```
**Revisar:**
```
cd ~/Documents/sala-campanha && claude "Revise o último commit (Task 2 do plano docs/superpowers/plans/2026-10-21-plano-1-fundacao-backend.md) contra a Task 2, Global Constraints e Review Focus. Foque em RLS e isolamento entre times, e em funções security definer com search_path vazio. Só reporte problemas, com arquivo:linha. Não edite nada."
```

### Tarefa 3 — Campanhas, peças, referências e arquivos
- [ ] Implementada
- [ ] Revisada

**Implementar:**
```
cd ~/Documents/sala-campanha && claude "Use superpowers:executing-plans. Leia docs/superpowers/specs/2026-10-21-sala-campanha-design.md e docs/superpowers/plans/2026-10-21-plano-1-fundacao-backend.md. Execute SOMENTE a Task 3, seguindo os passos com TDD. Respeite Global Constraints e Review Focus. Ao terminar: suite passando, checkboxes da Task 3 marcados no plano, commit feito. Não comece outra task."
```
**Revisar:**
```
cd ~/Documents/sala-campanha && claude "Revise o último commit (Task 3 do plano docs/superpowers/plans/2026-10-21-plano-1-fundacao-backend.md) contra a Task 3, Global Constraints e Review Focus. Foque em policies do Storage por prefixo de time, e em que o status da peça não pode ser alterado direto pelo cliente. Só reporte problemas, com arquivo:linha. Não edite nada."
```

### Tarefa 4 — Chaves do time (cofre)
- [ ] Implementada
- [ ] Revisada

**Implementar:**
```
cd ~/Documents/sala-campanha && claude "Use superpowers:executing-plans. Leia docs/superpowers/specs/2026-10-21-sala-campanha-design.md e docs/superpowers/plans/2026-10-21-plano-1-fundacao-backend.md. Execute SOMENTE a Task 4, seguindo os passos com TDD. Respeite Global Constraints e Review Focus. Ao terminar: suite passando, checkboxes da Task 4 marcados no plano, commit feito. Não comece outra task."
```
**Revisar:**
```
cd ~/Documents/sala-campanha && claude "Revise o último commit (Task 4 do plano docs/superpowers/plans/2026-10-21-plano-1-fundacao-backend.md) contra a Task 4, Global Constraints e Review Focus. Foque em qualquer caminho pelo qual um usuário autenticado consiga ler a chave em texto puro (select, RPC, grants, logs, mensagens de erro). Só reporte problemas, com arquivo:linha. Não edite nada."
```

### Tarefa 5 — Conversa e roteamento de mensagens
- [ ] Implementada
- [ ] Revisada

**Implementar:**
```
cd ~/Documents/sala-campanha && claude "Use superpowers:executing-plans. Leia docs/superpowers/specs/2026-10-21-sala-campanha-design.md e docs/superpowers/plans/2026-10-21-plano-1-fundacao-backend.md. Execute SOMENTE a Task 5, seguindo os passos com TDD. Respeite Global Constraints e Review Focus. Ao terminar: suite passando, checkboxes da Task 5 marcados no plano, commit feito. Não comece outra task."
```
**Revisar:**
```
cd ~/Documents/sala-campanha && claude "Revise o último commit (Task 5 do plano docs/superpowers/plans/2026-10-21-plano-1-fundacao-backend.md) contra a Task 5, Global Constraints e Review Focus. Foque na regra de roteamento @Pessoa e na validação de peça, menções e referências do mesmo time. Só reporte problemas, com arquivo:linha. Não edite nada."
```

### Tarefa 6 — Fila com reivindicação única
- [ ] Implementada
- [ ] Revisada

**Implementar:**
```
cd ~/Documents/sala-campanha && claude "Use superpowers:executing-plans. Leia docs/superpowers/specs/2026-10-21-sala-campanha-design.md e docs/superpowers/plans/2026-10-21-plano-1-fundacao-backend.md. Execute SOMENTE a Task 6, seguindo os passos com TDD. Respeite Global Constraints e Review Focus. Ao terminar: suite passando 3 vezes seguidas, checkboxes da Task 6 marcados no plano, commit feito. Não comece outra task."
```
**Revisar:**
```
cd ~/Documents/sala-campanha && claude "Revise o último commit (Task 6 do plano docs/superpowers/plans/2026-10-21-plano-1-fundacao-backend.md) contra a Task 6, Global Constraints e Review Focus. Foque em condições de corrida no claim (duplicação ou perda de mensagem) e em que só service_role execute as funções. Só reporte problemas, com arquivo:linha. Não edite nada."
```

### Tarefa 7 — Versões, status e aprovação
- [ ] Implementada
- [ ] Revisada

**Implementar:**
```
cd ~/Documents/sala-campanha && claude "Use superpowers:executing-plans. Leia docs/superpowers/specs/2026-10-21-sala-campanha-design.md e docs/superpowers/plans/2026-10-21-plano-1-fundacao-backend.md. Execute SOMENTE a Task 7, seguindo os passos com TDD. Respeite Global Constraints e Review Focus. Ao terminar: suite passando, checkboxes da Task 7 marcados no plano, commit feito. Não comece outra task."
```
**Revisar:**
```
cd ~/Documents/sala-campanha && claude "Revise o último commit (Task 7 do plano docs/superpowers/plans/2026-10-21-plano-1-fundacao-backend.md) contra a Task 7, Global Constraints e Review Focus. Foque em transições de status inválidas, em quem pode aprovar e em versões de outra peça ou de outro time. Só reporte problemas, com arquivo:linha. Não edite nada."
```

### Tarefa 8 — Comentários na imagem
- [ ] Implementada
- [ ] Revisada

**Implementar:**
```
cd ~/Documents/sala-campanha && claude "Use superpowers:executing-plans. Leia docs/superpowers/specs/2026-10-21-sala-campanha-design.md e docs/superpowers/plans/2026-10-21-plano-1-fundacao-backend.md. Execute SOMENTE a Task 8, seguindo os passos com TDD. Respeite Global Constraints e Review Focus. Ao terminar: suite passando, checkboxes da Task 8 marcados no plano, commit feito. Não comece outra task."
```
**Revisar:**
```
cd ~/Documents/sala-campanha && claude "Revise o último commit (Task 8 do plano docs/superpowers/plans/2026-10-21-plano-1-fundacao-backend.md) contra a Task 8, Global Constraints e Review Focus. Foque em autoria do comentário, coordenadas e o que o update permite mudar. Só reporte problemas, com arquivo:linha. Não edite nada."
```

### Tarefa 9 — Tempo real e verificação final
- [ ] Implementada
- [ ] Revisada

**Implementar:**
```
cd ~/Documents/sala-campanha && claude "Use superpowers:executing-plans. Leia docs/superpowers/specs/2026-10-21-sala-campanha-design.md e docs/superpowers/plans/2026-10-21-plano-1-fundacao-backend.md. Execute SOMENTE a Task 9, seguindo os passos com TDD. Respeite Global Constraints e Review Focus. Ao terminar: pnpm db:reset && pnpm test com a suite inteira passando, checkboxes da Task 9 marcados no plano, commit feito."
```
**Revisar (revisão final do Plano 1 inteiro):**
```
cd ~/Documents/sala-campanha && claude "Faça a revisão final de todo o Plano 1 (docs/superpowers/plans/2026-10-21-plano-1-fundacao-backend.md) contra o spec docs/superpowers/specs/2026-10-21-sala-campanha-design.md. Confira cobertura de cada task, os 5 itens de Review Focus e isolamento entre times em todas as tabelas e RPCs. Rode pnpm db:reset && pnpm test. Só reporte problemas, com arquivo:linha. Não edite nada."
```

---

## Plano 2 — Executor do agente

Pré-requisitos: Plano 1 completo e Supabase local rodando (`supabase start`). Os testes usam provedores falsos; nenhuma chave real é necessária, exceto no passo opcional da Tarefa 10.

### Tarefa 1 — Eventos do agente no banco
- [x] Implementada
- [x] Revisada

**Implementar:**
```
cd ~/Documents/sala-campanha && claude "Use superpowers:executing-plans. Leia docs/superpowers/specs/2026-10-21-sala-campanha-design.md e docs/superpowers/plans/2026-10-25-plano-2-executor-agente.md. Execute SOMENTE a Task 1, seguindo os passos com TDD. Respeite Global Constraints e Review Focus. Ao terminar: suite passando, checkboxes da Task 1 marcados no plano, commit feito. Não comece outra task."
```
**Revisar:**
```
cd ~/Documents/sala-campanha && claude "Revise o último commit (Task 1 do plano docs/superpowers/plans/2026-10-25-plano-2-executor-agente.md) contra a Task 1, Global Constraints e Review Focus. Foque em add_agent_event: só service_role executa, exige claim do executor, aceita só agent_started/agent_result/agent_error e não vaza entre times. Só reporte problemas, com arquivo:linha. Não edite nada."
```

### Tarefa 2 — Contrato compartilhado do agente
- [x] Implementada
- [x] Revisada

**Implementar:**
```
cd ~/Documents/sala-campanha && claude "Use superpowers:executing-plans. Leia docs/superpowers/specs/2026-10-21-sala-campanha-design.md e docs/superpowers/plans/2026-10-25-plano-2-executor-agente.md. Execute SOMENTE a Task 2, seguindo os passos com TDD. Respeite Global Constraints e Review Focus. Ao terminar: suite passando, checkboxes da Task 2 marcados no plano, commit feito. Não comece outra task."
```
**Revisar:**
```
cd ~/Documents/sala-campanha && claude "Revise o último commit (Task 2 do plano docs/superpowers/plans/2026-10-25-plano-2-executor-agente.md) contra a Task 2, Global Constraints e Review Focus. Foque nos IDs de MODEL_CATALOG (conferidos no Context7), nos textos exatos de agentErrorMessage e em ModelChoiceSchema rejeitar chaves e provedores desconhecidos. Só reporte problemas, com arquivo:linha. Não edite nada."
```

**Pendências da revisão (commit `4d7925b`, 2026-10-25).** Resolver numa próxima sessão ou, no mais tardar, na revisão final do Plano 2:
- [x] **Limites de referência do Gemini divergem da doc atual** (`packages/shared/src/agent.ts:23` e `:25`). A doc (Context7, `ai.google.dev`) aceita no Nano Banana 2.1 até 10 objetos + 4 personagens (o catálogo diz `5`). No Nano Banana Pro aceita até 6 objetos + 5 personagens + 3 de estilo (o catálogo diz `10`). Os valores parecem invertidos. O código segue a tabela da Task 2, então decidir os limites, corrigir a tabela do plano e a nota da linha 193 junto com `MODEL_CATALOG`.
  - **Resolvida na Correção A (2026-10-27):** `maxReferenceImages` = 10 no Nano Banana 2.1 e 6 no Nano Banana Pro (vagas de objeto em alta fidelidade). Tabela e nota da Task 2 do Plano 2 atualizadas.
- [x] **`ModelRefSchema` aceita chaves extras** (`packages/shared/src/agent.ts:28`). Sem `.strict()`, `{ text: { provider: 'openai', model: 'gpt-6-astra', foo: 1 } }` passa em `ModelChoiceSchema` e `foo` é descartado sem aviso. Decidir se `ModelRefSchema` vira `.strict()` e adicionar o caso em `tests/shared/agent.test.ts`.
  - **Resolvida na Correção A (2026-10-27):** `ModelRefSchema` é `.strict()` e ganhou `effort` opcional. O caso `foo: 1` está em `tests/shared/agent.test.ts`.

### Tarefa 3 — Pacote do executor: configuração, log e banco
- [x] Implementada
- [x] Revisada

**Implementar:**
```
cd ~/Documents/sala-campanha && claude "Use superpowers:executing-plans. Leia docs/superpowers/specs/2026-10-21-sala-campanha-design.md e docs/superpowers/plans/2026-10-25-plano-2-executor-agente.md. Execute SOMENTE a Task 3, seguindo os passos com TDD. Respeite Global Constraints e Review Focus. Ao terminar: suite passando, checkboxes da Task 3 marcados no plano, commit feito. Não comece outra task."
```
**Revisar:**
```
cd ~/Documents/sala-campanha && claude "Revise o último commit (Task 3 do plano docs/superpowers/plans/2026-10-25-plano-2-executor-agente.md) contra a Task 3, Global Constraints e Review Focus. Foque em mensagens de erro de configuração sem valores de segredo, no filtro do histórico (sem mensagens na fila nem @Pessoa) e em ClaimLostError para 42501. Só reporte problemas, com arquivo:linha. Não edite nada."
```

### Tarefa 4 — HTTP e adaptadores de texto (Anthropic e OpenAI)
- [x] Implementada
- [x] Revisada

**Implementar:**
```
cd ~/Documents/sala-campanha && claude "Use superpowers:executing-plans. Leia docs/superpowers/specs/2026-10-21-sala-campanha-design.md e docs/superpowers/plans/2026-10-25-plano-2-executor-agente.md. Execute SOMENTE a Task 4, seguindo os passos com TDD. Respeite Global Constraints e Review Focus. Ao terminar: suite passando, checkboxes da Task 4 marcados no plano, commit feito. Não comece outra task."
```
**Revisar:**
```
cd ~/Documents/sala-campanha && claude "Revise o último commit (Task 4 do plano docs/superpowers/plans/2026-10-25-plano-2-executor-agente.md) contra a Task 4, Global Constraints e Review Focus. Foque em redação da chave nos erros, em quando há nova tentativa (só 429, 5xx e rede) e no formato atual das duas APIs. Só reporte problemas, com arquivo:linha. Não edite nada."
```

### Tarefa 5 — Adaptador de imagem Gemini
- [x] Implementada
- [x] Revisada

**Implementar:**
```
cd ~/Documents/sala-campanha && claude "Use superpowers:executing-plans. Leia docs/superpowers/specs/2026-10-21-sala-campanha-design.md e docs/superpowers/plans/2026-10-25-plano-2-executor-agente.md. Execute SOMENTE a Task 5, seguindo os passos com TDD. Respeite Global Constraints e Review Focus. Ao terminar: suite passando, checkboxes da Task 5 marcados no plano, commit feito. Não comece outra task."
```
**Revisar:**
```
cd ~/Documents/sala-campanha && claude "Revise o último commit (Task 5 do plano docs/superpowers/plans/2026-10-25-plano-2-executor-agente.md) contra a Task 5, Global Constraints e Review Focus. Foque no formato do request com imagens de referência, no parse de inlineData e na recusa do modelo virar erro legível. Só reporte problemas, com arquivo:linha. Não edite nada."
```

### Tarefa 6 — Adaptador de imagem fal (Flux Kontext)
- [x] Implementada
- [x] Revisada

Esta tarefa é cortável (item 4 da ordem de corte do spec). Se pular, remova a linha `fal` de `MODEL_CATALOG`.

**Implementar:**
```
cd ~/Documents/sala-campanha && claude "Use superpowers:executing-plans. Leia docs/superpowers/specs/2026-10-21-sala-campanha-design.md e docs/superpowers/plans/2026-10-25-plano-2-executor-agente.md. Execute SOMENTE a Task 6, seguindo os passos com TDD. Respeite Global Constraints e Review Focus. Ao terminar: suite passando, checkboxes da Task 6 marcados no plano, commit feito. Não comece outra task."
```
**Revisar:**
```
cd ~/Documents/sala-campanha && claude "Revise o último commit (Task 6 do plano docs/superpowers/plans/2026-10-25-plano-2-executor-agente.md) contra a Task 6, Global Constraints e Review Focus. Foque em data URI em vez de URL assinada, no endpoint sem referências e em não mandar a chave ao baixar o resultado. Só reporte problemas, com arquivo:linha. Não edite nada."
```

**Pendências da revisão (commits `a0ef3c8` e `808c475`, 2026-10-26).** Resolver na revisão final do Plano 2. O `808c475` já corrigiu, no download `https`, o redirecionamento, o limite de 25 MiB e o tipo pela assinatura dos bytes. Também corrigiu o limite de 20 MB no pedido e os erros 422 da fal em lista.
- [x] **Imagem em data URI confia no tipo declarado** (`packages/executor/src/providers/fal.ts:65` e `packages/executor/src/providers/gemini.ts:73`). O tipo vem do prefixo `data:<tipo>` (fal) ou de `mimeType` (Gemini), não dos bytes. Um arquivo rotulado errado é gravado com o tipo errado. Usar a mesma checagem de assinatura do download `https` (`sniffType` em `fal.ts`), compartilhada pelos dois adaptadores.
  - **Resolvida na Correção C (2026-10-27):** `decodeImage` em `packages/executor/src/providers/image.ts` tira o tipo de `sniffType` e ignora o rótulo, nos dois adaptadores.
- [x] **Imagem em data URI sem limite próprio de 25 MiB** (`packages/executor/src/providers/fal.ts:68` e `packages/executor/src/providers/gemini.ts:79`). Os bytes decodificados não são comparados com o limite do bucket `team-files`. Além disso, o `postJson` (`packages/executor/src/providers/http.ts`) lê a resposta JSON inteira para a memória, sem teto. Decidir o limite da resposta e recusar uma imagem decodificada acima de 25 MiB com `invalid_output`.
  - **Resolvida na Correção C (2026-10-27):** `decodeImage` recusa base64 longo demais antes de decodificar e bytes acima de `MAX_IMAGE_BYTES` depois. `postJson` lê a resposta com `readCapped`, com teto de uma imagem de 25 MiB em base64 mais 1 MB; acima dele, `invalid_output` sem nova tentativa.
- [ ] **Nada da fal foi testado contra a API real.** Ainda não foram confirmados no serviço: data URI nas referências, `sync_mode`, o formato da lista `detail` nos erros 422 e o limite real do corpo do pedido (o Context7 não informa). Cobrir em `tests/live/providers.live.test.ts` (Task 10).
  - **Atualizada na Correção E (2026-10-28):** o teste ao vivo rodou sem chave da fal, então nada foi coberto. Quando rodar com `LIVE_FAL_KEY`, ele confere a data URI na referência e `sync_mode` no endpoint `multi` (1 referência) e no `text-to-image` (sem referência). A lista `detail` do 422 e o limite real do corpo continuam abertos: não dá para provocar os dois de forma confiável.

### Tarefa 7 — Orquestrador (monta o prompt)
- [x] Implementada
- [x] Revisada

**Implementar:**
```
cd ~/Documents/sala-campanha && claude "Use superpowers:executing-plans. Leia docs/superpowers/specs/2026-10-21-sala-campanha-design.md e docs/superpowers/plans/2026-10-25-plano-2-executor-agente.md. Execute SOMENTE a Task 7, seguindo os passos com TDD. Respeite Global Constraints e Review Focus. Ao terminar: suite passando, checkboxes da Task 7 marcados no plano, commit feito. Não comece outra task."
```
**Revisar:**
```
cd ~/Documents/sala-campanha && claude "Revise o último commit (Task 7 do plano docs/superpowers/plans/2026-10-25-plano-2-executor-agente.md) contra a Task 7, Global Constraints e Review Focus. Foque no texto exato de ORCHESTRATOR_SYSTEM, em o lote atual não aparecer no histórico e em parsePlan aplicar as regras por tipo de peça. Só reporte problemas, com arquivo:linha. Não edite nada."
```

### Tarefa 8 — Processar uma reivindicação (rodadas e erros)
- [x] Implementada
- [x] Revisada

**Implementar:**
```
cd ~/Documents/sala-campanha && claude "Use superpowers:executing-plans. Leia docs/superpowers/specs/2026-10-21-sala-campanha-design.md e docs/superpowers/plans/2026-10-25-plano-2-executor-agente.md. Execute SOMENTE a Task 8, seguindo os passos com TDD. Respeite Global Constraints e Review Focus. Ao terminar: suite passando 3 vezes seguidas, checkboxes da Task 8 marcados no plano, commit feito. Não comece outra task."
```
**Revisar:**
```
cd ~/Documents/sala-campanha && claude "Revise o último commit (Task 8 do plano docs/superpowers/plans/2026-10-25-plano-2-executor-agente.md) contra a Task 8, Global Constraints e Review Focus. Foque na ordem absorb antes de complete, em nenhum provedor chamado fora de gerando/base_em_revisao, em claim perdido sem versão duplicada e com arquivo removido, e em a chave nunca aparecer em evento ou log. Só reporte problemas, com arquivo:linha. Não edite nada."
```

### Tarefa 9 — Worker, entrypoint e desligamento
- [x] Implementada
- [x] Revisada

**Implementar:**
```
cd ~/Documents/sala-campanha && claude "Use superpowers:executing-plans. Leia docs/superpowers/specs/2026-10-21-sala-campanha-design.md e docs/superpowers/plans/2026-10-25-plano-2-executor-agente.md. Execute SOMENTE a Task 9, seguindo os passos com TDD. Respeite Global Constraints e Review Focus. Ao terminar: pnpm db:reset && pnpm test && pnpm typecheck com tudo passando, checkboxes da Task 9 marcados no plano, commit feito. Não comece outra task."
```
**Revisar:**
```
cd ~/Documents/sala-campanha && claude "Revise o último commit (Task 9 do plano docs/superpowers/plans/2026-10-25-plano-2-executor-agente.md) contra a Task 9, Global Constraints e Review Focus. Foque em slot que não morre com erro, em desligamento que espera a rodada em andamento e em main sem imprimir segredos. Só reporte problemas, com arquivo:linha. Não edite nada."
```

### Tarefa 10 — Teste ao vivo, Docker e checklist de deploy
- [x] Implementada
- [x] Revisada

O passo com chaves reais é opcional. Para rodar, coloque as chaves só na linha de comando (`LIVE_ANTHROPIC_KEY=... pnpm test tests/live`), nunca num arquivo commitado.

**Implementar:**
```
cd ~/Documents/sala-campanha && claude "Use superpowers:executing-plans. Leia docs/superpowers/specs/2026-10-21-sala-campanha-design.md e docs/superpowers/plans/2026-10-25-plano-2-executor-agente.md. Execute SOMENTE a Task 10, seguindo os passos com TDD. Respeite Global Constraints e Review Focus. Ao terminar: suite passando, checkboxes da Task 10 marcados no plano, commit feito. Não comece outra task."
```
**Revisar (revisão final do Plano 2 inteiro):**
```
cd ~/Documents/sala-campanha && claude "Faça a revisão final de todo o Plano 2 (docs/superpowers/plans/2026-10-25-plano-2-executor-agente.md) contra o spec docs/superpowers/specs/2026-10-21-sala-campanha-design.md e as interfaces do Plano 1. Confira cobertura de cada task, os 5 itens de Review Focus, as pendências de revisão abertas no HANDOFF.md (ex.: Tarefa 2), e que nenhuma chave de provedor ou service role aparece em log, evento, erro ou imagem Docker. Rode pnpm db:reset && pnpm test && pnpm typecheck. Só reporte problemas, com arquivo:linha. Não edite nada."
```

---

## Plano 2 — Correções da revisão final

A revisão final do Plano 2 (2026-10-27) encontrou 15 problemas. As decisões tomadas com você estão no topo de `docs/superpowers/plans/2026-10-27-plano-2-correcoes.md`. Rode as tarefas na ordem A → B → C → D → E, no mesmo ciclo de sempre: um terminal para implementar e outro para revisar.

### Correção A — Contrato: esforço, schema estrito e limites do Gemini
- [x] Implementada
- [x] Revisada

**Implementar:**
```
cd ~/Documents/sala-campanha && claude "Use superpowers:executing-plans. Leia docs/superpowers/specs/2026-10-21-sala-campanha-design.md, docs/superpowers/plans/2026-10-25-plano-2-executor-agente.md e docs/superpowers/plans/2026-10-27-plano-2-correcoes.md. Execute SOMENTE a Task A do plano de correções, seguindo os passos com TDD. Respeite as Global Constraints e o Review Focus dos dois planos. Ao terminar: suite passando, checkboxes da Task A marcados no plano de correções, commit feito. Não comece outra task."
```
**Revisar:**
```
cd ~/Documents/sala-campanha && claude "Revise o último commit (Task A de docs/superpowers/plans/2026-10-27-plano-2-correcoes.md) contra a Task A, as Decisões do fundador, as Global Constraints e o Review Focus. Foque em ModelRefSchema estrito, em efforts e maxReferenceImages iguais à tabela da Task A e nos trechos do Plano 2 e do spec atualizados. Só reporte problemas, com arquivo:linha. Não edite nada."
```

### Correção B — Escolha de modelo e esforço no executor
- [x] Implementada
- [x] Revisada

**Implementar:**
```
cd ~/Documents/sala-campanha && claude "Use superpowers:executing-plans. Leia docs/superpowers/specs/2026-10-21-sala-campanha-design.md, docs/superpowers/plans/2026-10-25-plano-2-executor-agente.md e docs/superpowers/plans/2026-10-27-plano-2-correcoes.md. Execute SOMENTE a Task B do plano de correções, seguindo os passos com TDD. Respeite as Global Constraints e o Review Focus dos dois planos. Ao terminar: suite passando, checkboxes da Task B marcados no plano de correções, commit feito. Não comece outra task."
```
**Revisar:**
```
cd ~/Documents/sala-campanha && claude "Revise o último commit (Task B de docs/superpowers/plans/2026-10-27-plano-2-correcoes.md) contra a Task B, as Decisões do fundador, as Global Constraints e o Review Focus. Foque na herança da última escolha válida, em esforço inválido falhar sem ler chave nem chamar provedor, no esforço só ir no corpo quando existe, no formato do thinkingLevel do Gemini conferido no Context7 e em caption null aceito. Só reporte problemas, com arquivo:linha. Não edite nada."
```

### Correção C — Imagem devolvida pelo provedor e HTTP
- [x] Implementada
- [x] Revisada

**Implementar:**
```
cd ~/Documents/sala-campanha && claude "Use superpowers:executing-plans. Leia docs/superpowers/specs/2026-10-21-sala-campanha-design.md, docs/superpowers/plans/2026-10-25-plano-2-executor-agente.md e docs/superpowers/plans/2026-10-27-plano-2-correcoes.md. Execute SOMENTE a Task C do plano de correções, seguindo os passos com TDD. Respeite as Global Constraints e o Review Focus dos dois planos. Ao terminar: suite passando, checkboxes da Task C marcados no plano de correções, commit feito. Não comece outra task."
```
**Revisar:**
```
cd ~/Documents/sala-campanha && claude "Revise o último commit (Task C de docs/superpowers/plans/2026-10-27-plano-2-correcoes.md) contra a Task C, as Decisões do fundador, as Global Constraints e o Review Focus. Foque no tipo da imagem vindo dos bytes, no limite de 25 MiB e no teto da resposta, em nenhuma nova tentativa de imagem depois de erro de rede, na chave redigida nos caminhos novos e em nada duplicado entre gemini.ts e fal.ts. Só reporte problemas, com arquivo:linha. Não edite nada."
```

### Correção D — Rodada, worker e desligamento
- [x] Implementada
- [x] Revisada

**Implementar:**
```
cd ~/Documents/sala-campanha && claude "Use superpowers:executing-plans. Leia docs/superpowers/specs/2026-10-21-sala-campanha-design.md, docs/superpowers/plans/2026-10-25-plano-2-executor-agente.md e docs/superpowers/plans/2026-10-27-plano-2-correcoes.md. Execute SOMENTE a Task D do plano de correções, seguindo os passos com TDD. Respeite as Global Constraints e o Review Focus dos dois planos. Ao terminar: suite passando 3 vezes seguidas, checkboxes da Task D marcados no plano de correções, commit feito. Não comece outra task."
```
**Revisar:**
```
cd ~/Documents/sala-campanha && claude "Revise o último commit (Task D de docs/superpowers/plans/2026-10-27-plano-2-correcoes.md) contra a Task D, as Decisões do fundador, as Global Constraints e o Review Focus. Foque em claimed_by próprio por slot e ClaimLostError entre slots do mesmo processo, em latestVersion só de versões base, no Promise.all mantendo a ordem das imagens e na regra do SHUTDOWN_GRACE_MS sem expor valores. Só reporte problemas, com arquivo:linha. Não edite nada."
```

### Correção E — Teste ao vivo e fechamento do Plano 2
- [x] Implementada
- [ ] Revisada

No Step 3, rode o teste ao vivo você mesmo, num terminal comum, com as chaves só na linha de comando (ex.: `LIVE_GEMINI_KEY=... pnpm test tests/live`). Depois cole para o Claude só o resultado, nunca a chave.

**Revisão adiada (2026-10-28).** O fundador ainda não tem as chaves dos provedores. A revisão da Correção E e as pendências abaixo ficam para quando houver chaves para testar. O Plano 3 segue antes.

**Pendências do teste ao vivo (2026-10-28).** Em 2026-10-28 o teste rodou só com a chave da OpenAI, e a conta estava sem créditos. Nenhum provedor foi confirmado contra a API real. Resolver antes do primeiro deploy, rodando `LIVE_<PROVEDOR>_KEY=... pnpm test tests/live` e colando o resultado para o Claude registrar:
- [ ] **OpenAI (GPT-6 Astra):** a chave foi aceita, mas a resposta foi `You have no credits remaining`. Falta confirmar `reasoning.effort`, `max_output_tokens: 32000` e o formato da resposta. Rodar de novo depois de pôr créditos.
- [ ] **Anthropic (Claude Sonnet 5.5 e Claude Opus 5.5):** sem chave, não rodou. Falta confirmar `output_config.effort` e o formato da resposta.
- [ ] **Gemini (Nano Banana 2.1 e Nano Banana Pro):** sem chave, não rodou. Falta confirmar o endpoint `v1`, `thinkingLevel` em maiúsculas (`MINIMAL`) e a imagem em `inlineData`. Ler também a linha `<modelo>: HTTP ..., N bytes, N thought image part(s)`. Com alguma parte `thought`, `MAX_RESPONSE_BYTES` (`packages/executor/src/providers/http.ts`) não reserva espaço para os rascunhos. Nesse caso, subir o teto para caber a imagem final mais dois rascunhos, ou pedir `includeThoughts: false`. Sem partes `thought`, o comentário `shortcut:` de `http.ts` continua valendo.
- [ ] **fal (Flux Kontext Max):** sem chave, não rodou. Ver a pendência da Tarefa 6 do Plano 2.
- Quando os quatro passarem, marcar o Step 3 da Task 10 do Plano 2.

**Implementar:**
```
cd ~/Documents/sala-campanha && claude "Use superpowers:executing-plans. Leia docs/superpowers/specs/2026-10-21-sala-campanha-design.md, docs/superpowers/plans/2026-10-25-plano-2-executor-agente.md e docs/superpowers/plans/2026-10-27-plano-2-correcoes.md. Execute SOMENTE a Task E do plano de correções. No Step 3, não peça as chaves: eu rodo o teste ao vivo no meu terminal e colo o resultado. Ao terminar: suite passando, checkboxes da Task E marcados no plano de correções, commit feito."
```
**Revisar (revisão final das correções):**
```
cd ~/Documents/sala-campanha && claude "Faça a revisão final das correções do Plano 2 (docs/superpowers/plans/2026-10-27-plano-2-correcoes.md) contra as Decisões do fundador e o Review Focus dos dois planos. Confira que cada um dos 15 problemas da revisão final foi resolvido ou ficou registrado como pendência, que as pendências do HANDOFF.md batem com o estado do código, e que nenhuma chave de provedor ou service role aparece em log, evento, erro ou imagem Docker. Rode pnpm db:reset && pnpm test && pnpm typecheck. Só reporte problemas, com arquivo:linha. Não edite nada."
```

---

## Plano 3 — App Tauri para macOS

Pré-requisitos:
- Supabase local rodando (`supabase start`) e Rust instalado.
- A partir da Tarefa 4, o arquivo `packages/desktop/.env.local`, com `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (os valores `API_URL` e `ANON_KEY` de `supabase status -o env`). Ele nunca vai para o git.

Nenhuma chave real de provedor é necessária: a partir da Tarefa 12, `pnpm fake-agent` responde no lugar do agente, só no Supabase local. Para ver o app, use `pnpm app`. Os códigos de login chegam no Mailpit (`http://127.0.0.1:55324`).

*Revisão de 2026-10-28:* o app ficou aberto ao público, como o Conductor. Qualquer pessoa entra com Google, Apple ou código no e-mail, cria o próprio workspace, cadastra as próprias chaves e convida outras pessoas. Detalhes no topo do plano e no spec (objetivo 10 e seção 11a).
- Para testar Google e Apple de ponta a ponta (Tarefa 13), é preciso o app empacotado (`pnpm --filter @sala/desktop tauri build --debug`) e as credenciais OAuth em `supabase/.env`, que nunca vai para o git.
- O login com Apple precisa de uma conta Apple Developer. Ela também é necessária para assinar o app antes do download público.

### Tarefa 1 — Pacote do app: Tauri, React e testes de interface
- [x] Implementada
- [x] Revisada

**Implementar:**
```
cd ~/Documents/sala-campanha && claude "Use superpowers:executing-plans. Leia docs/superpowers/specs/2026-10-21-sala-campanha-design.md e docs/superpowers/plans/2026-10-28-plano-3-app-desktop.md. Execute SOMENTE a Task 1, seguindo os passos com TDD. Respeite Global Constraints e Review Focus. Ao terminar: suite passando, checkboxes da Task 1 marcados no plano, commit feito. Não comece outra task."
```
**Revisar:**
```
cd ~/Documents/sala-campanha && claude "Revise o último commit (Task 1 do plano docs/superpowers/plans/2026-10-28-plano-3-app-desktop.md) contra a Task 1, Global Constraints e Review Focus. Foque em a parte Rust só registrar plugins, na CSP e nas capabilities mínimas, em nenhuma service role no pacote desktop e no Docker do executor ainda buildando. Só reporte problemas, com arquivo:linha. Não edite nada."
```

### Tarefa 2 — Backend do app: workspaces, convites, presença privada, tempo real e login aberto
- [ ] Implementada
- [ ] Revisada

**Implementar:**
```
cd ~/Documents/sala-campanha && claude "Use superpowers:executing-plans. Leia docs/superpowers/specs/2026-10-21-sala-campanha-design.md e docs/superpowers/plans/2026-10-28-plano-3-app-desktop.md. Execute SOMENTE a Task 2, seguindo os passos com TDD. Respeite Global Constraints e Review Focus. Ao terminar: suite passando, checkboxes da Task 2 marcados no plano, commit feito. Não comece outra task."
```
**Revisar:**
```
cd ~/Documents/sala-campanha && claude "Revise o último commit (Task 2 do plano docs/superpowers/plans/2026-10-28-plano-3-app-desktop.md) contra a Task 2, Global Constraints e Review Focus. Foque em accept_invites só aceitar convite do dono do e-mail confirmado, em invite_member e team_invites só para admin, na policy de presença (outro time não entra no canal), em set_member_role e remove_member nunca deixarem o workspace sem admin, em funções security definer com search_path vazio e em nenhuma service role fora do servidor. Só reporte problemas, com arquivo:linha. Não edite nada."
```

### Tarefa 3 — Contrato compartilhado: escolha de modelo e eventos da conversa
- [ ] Implementada
- [ ] Revisada

**Implementar:**
```
cd ~/Documents/sala-campanha && claude "Use superpowers:executing-plans. Leia docs/superpowers/specs/2026-10-21-sala-campanha-design.md e docs/superpowers/plans/2026-10-28-plano-3-app-desktop.md. Execute SOMENTE a Task 3, seguindo os passos com TDD. Respeite Global Constraints e Review Focus. Ao terminar: suite passando, checkboxes da Task 3 marcados no plano, commit feito. Não comece outra task."
```
**Revisar:**
```
cd ~/Documents/sala-campanha && claude "Revise o último commit (Task 3 do plano docs/superpowers/plans/2026-10-28-plano-3-app-desktop.md) contra a Task 3, Global Constraints e Review Focus. Foque em checkModelChoice e inheritedModel manterem o comportamento do executor, nos schemas de evento baterem com as migrations e em parseEvent nunca quebrar com uma linha ruim. Só reporte problemas, com arquivo:linha. Não edite nada."
```

### Tarefa 4 — Login com Google, Apple e código por e-mail, entrada no workspace e mensagens de erro
- [ ] Implementada
- [ ] Revisada

**Implementar:**
```
cd ~/Documents/sala-campanha && claude "Use superpowers:executing-plans. Leia docs/superpowers/specs/2026-10-21-sala-campanha-design.md e docs/superpowers/plans/2026-10-28-plano-3-app-desktop.md. Execute SOMENTE a Task 4, seguindo os passos com TDD. Respeite Global Constraints e Review Focus. Ao terminar: suite passando, checkboxes da Task 4 marcados no plano, commit feito. Não comece outra task."
```
**Revisar:**
```
cd ~/Documents/sala-campanha && claude "Revise o último commit (Task 4 do plano docs/superpowers/plans/2026-10-28-plano-3-app-desktop.md) contra a Task 4, Global Constraints e Review Focus. Foque no OAuth com PKCE voltando por sala://auth/callback (parseAuthCallback e finishOAuth), no onboarding (nome, accept_invites a cada login e create_workspace), nos textos exatos de errors.ts e em nenhum segredo além da anon key no app. Só reporte problemas, com arquivo:linha. Não edite nada."
```

### Tarefa 5 — Campanhas, peças, navegação e link de compartilhamento
- [ ] Implementada
- [ ] Revisada

**Implementar:**
```
cd ~/Documents/sala-campanha && claude "Use superpowers:executing-plans. Leia docs/superpowers/specs/2026-10-21-sala-campanha-design.md e docs/superpowers/plans/2026-10-28-plano-3-app-desktop.md. Execute SOMENTE a Task 5, seguindo os passos com TDD. Respeite Global Constraints e Review Focus. Ao terminar: suite passando, checkboxes da Task 5 marcados no plano, commit feito. Não comece outra task."
```
**Revisar:**
```
cd ~/Documents/sala-campanha && claude "Revise o último commit (Task 5 do plano docs/superpowers/plans/2026-10-28-plano-3-app-desktop.md) contra a Task 5, Global Constraints e Review Focus. Foque em parseLink recusar entradas inválidas, no link para peça de outro time ou inexistente, no seletor de workspace (pickWorkspace e link de outro workspace da pessoa) e no espectador sem botões de criação. Só reporte problemas, com arquivo:linha. Não edite nada."
```

### Tarefa 6 — Conversa ao vivo
- [ ] Implementada
- [ ] Revisada

**Implementar:**
```
cd ~/Documents/sala-campanha && claude "Use superpowers:executing-plans. Leia docs/superpowers/specs/2026-10-21-sala-campanha-design.md e docs/superpowers/plans/2026-10-28-plano-3-app-desktop.md. Execute SOMENTE a Task 6, seguindo os passos com TDD. Respeite Global Constraints e Review Focus. Ao terminar: suite passando, checkboxes da Task 6 marcados no plano, commit feito. Não comece outra task."
```
**Revisar:**
```
cd ~/Documents/sala-campanha && claude "Revise o último commit (Task 6 do plano docs/superpowers/plans/2026-10-28-plano-3-app-desktop.md) contra a Task 6, Global Constraints e Review Focus. Foque em buscar o que faltou a cada SUBSCRIBED sem perder nem duplicar evento, nos textos exatos de labels.ts e timelineItems e no prompt recolhido por padrão. Só reporte problemas, com arquivo:linha. Não edite nada."
```

### Tarefa 7 — Biblioteca de referências e envio de arquivos
- [ ] Implementada
- [ ] Revisada

**Implementar:**
```
cd ~/Documents/sala-campanha && claude "Use superpowers:executing-plans. Leia docs/superpowers/specs/2026-10-21-sala-campanha-design.md e docs/superpowers/plans/2026-10-28-plano-3-app-desktop.md. Execute SOMENTE a Task 7, seguindo os passos com TDD. Respeite Global Constraints e Review Focus. Ao terminar: suite passando, checkboxes da Task 7 marcados no plano, commit feito. Não comece outra task."
```
**Revisar:**
```
cd ~/Documents/sala-campanha && claude "Revise o último commit (Task 7 do plano docs/superpowers/plans/2026-10-28-plano-3-app-desktop.md) contra a Task 7, Global Constraints e Review Focus. Foque na checagem de tipo e tamanho antes do upload, no caminho em minúsculas dentro da pasta do time e no isolamento entre times. Só reporte problemas, com arquivo:linha. Não edite nada."
```

### Tarefa 8 — Campo de mensagem: destino, menções, modelo e esforço
- [ ] Implementada
- [ ] Revisada

**Implementar:**
```
cd ~/Documents/sala-campanha && claude "Use superpowers:executing-plans. Leia docs/superpowers/specs/2026-10-21-sala-campanha-design.md e docs/superpowers/plans/2026-10-28-plano-3-app-desktop.md. Execute SOMENTE a Task 8, seguindo os passos com TDD. Respeite Global Constraints e Review Focus. Ao terminar: suite passando, checkboxes da Task 8 marcados no plano, commit feito. Não comece outra task."
```
**Revisar:**
```
cd ~/Documents/sala-campanha && claude "Revise o último commit (Task 8 do plano docs/superpowers/plans/2026-10-28-plano-3-app-desktop.md) contra a Task 8, Global Constraints e Review Focus. Foque em messageTarget espelhar o roteamento de post_message, no seletor listar só modelos com chave, no esforço só onde o modelo aceita e no payload exato de p_model. Só reporte problemas, com arquivo:linha. Não edite nada."
```

### Tarefa 9 — Versões e ciclo de vida da peça
- [ ] Implementada
- [ ] Revisada

**Implementar:**
```
cd ~/Documents/sala-campanha && claude "Use superpowers:executing-plans. Leia docs/superpowers/specs/2026-10-21-sala-campanha-design.md e docs/superpowers/plans/2026-10-28-plano-3-app-desktop.md. Execute SOMENTE a Task 9, seguindo os passos com TDD. Respeite Global Constraints e Review Focus. Ao terminar: suite passando, checkboxes da Task 9 marcados no plano, commit feito. Não comece outra task."
```
**Revisar:**
```
cd ~/Documents/sala-campanha && claude "Revise o último commit (Task 9 do plano docs/superpowers/plans/2026-10-28-plano-3-app-desktop.md) contra a Task 9, Global Constraints e Review Focus. Foque em pieceActions seguir a tabela de permissões do spec, no envio da versão final por tipo de peça e nas mensagens de erro. Só reporte problemas, com arquivo:linha. Não edite nada."
```

### Tarefa 10 — Comentários na imagem e na legenda
- [ ] Implementada
- [ ] Revisada

**Implementar:**
```
cd ~/Documents/sala-campanha && claude "Use superpowers:executing-plans. Leia docs/superpowers/specs/2026-10-21-sala-campanha-design.md e docs/superpowers/plans/2026-10-28-plano-3-app-desktop.md. Execute SOMENTE a Task 10, seguindo os passos com TDD. Respeite Global Constraints e Review Focus. Ao terminar: suite passando, checkboxes da Task 10 marcados no plano, commit feito. Não comece outra task."
```
**Revisar:**
```
cd ~/Documents/sala-campanha && claude "Revise o último commit (Task 10 do plano docs/superpowers/plans/2026-10-28-plano-3-app-desktop.md) contra a Task 10, Global Constraints e Review Focus. Foque nos offsets em code points, nas coordenadas entre 0 e 1 e nos fios de um nível só. Só reporte problemas, com arquivo:linha. Não edite nada."
```

### Tarefa 11 — Presença e notificação de menção
- [ ] Implementada
- [ ] Revisada

**Implementar:**
```
cd ~/Documents/sala-campanha && claude "Use superpowers:executing-plans. Leia docs/superpowers/specs/2026-10-21-sala-campanha-design.md e docs/superpowers/plans/2026-10-28-plano-3-app-desktop.md. Execute SOMENTE a Task 11, seguindo os passos com TDD. Respeite Global Constraints e Review Focus. Ao terminar: suite passando, checkboxes da Task 11 marcados no plano, commit feito. Não comece outra task."
```
**Revisar:**
```
cd ~/Documents/sala-campanha && claude "Revise o último commit (Task 11 do plano docs/superpowers/plans/2026-10-28-plano-3-app-desktop.md) contra a Task 11, Global Constraints e Review Focus. Foque no canal privado de presença, em notificar só menções a mim feitas por outra pessoa e em nenhum dado de outro time. Só reporte problemas, com arquivo:linha. Não edite nada."
```

### Tarefa 12 — Configurações do workspace: chaves, membros e convites
- [ ] Implementada
- [ ] Revisada

**Implementar:**
```
cd ~/Documents/sala-campanha && claude "Use superpowers:executing-plans. Leia docs/superpowers/specs/2026-10-21-sala-campanha-design.md e docs/superpowers/plans/2026-10-28-plano-3-app-desktop.md. Execute SOMENTE a Task 12, seguindo os passos com TDD. Respeite Global Constraints e Review Focus. Ao terminar: suite passando, checkboxes da Task 12 marcados no plano, commit feito. Não comece outra task."
```
**Revisar:**
```
cd ~/Documents/sala-campanha && claude "Revise o último commit (Task 12 do plano docs/superpowers/plans/2026-10-28-plano-3-app-desktop.md) contra a Task 12, Global Constraints e Review Focus. Foque em a chave nunca voltar ao app (só ...last4 e o campo limpo depois de salvar), nos convites (convidar, listar e cancelar só pelo admin), nas telas só para admin e no fake-agent recusar um Supabase que não seja local. Só reporte problemas, com arquivo:linha. Não edite nada."
```

### Tarefa 13 — Build, DMG e verificação final
- [ ] Implementada
- [ ] Revisada

**Implementar:**
```
cd ~/Documents/sala-campanha && claude "Use superpowers:executing-plans. Leia docs/superpowers/specs/2026-10-21-sala-campanha-design.md e docs/superpowers/plans/2026-10-28-plano-3-app-desktop.md. Execute SOMENTE a Task 13. O checklist manual do Step 3 eu faço junto: me diga cada item e espere minha resposta. Google e Apple precisam das credenciais OAuth em supabase/.env; sem elas, registre como pendência. Ao terminar: suite passando, checkboxes da Task 13 marcados no plano, commit feito."
```
**Revisar (revisão final do Plano 3 inteiro):**
```
cd ~/Documents/sala-campanha && claude "Faça a revisão final de todo o Plano 3 (docs/superpowers/plans/2026-10-28-plano-3-app-desktop.md) contra o spec docs/superpowers/specs/2026-10-21-sala-campanha-design.md e as interfaces dos Planos 1 e 2. Confira cobertura de cada task, os 5 itens de Review Focus, o checklist manual da Task 13, e que nenhuma chave de provedor ou service role aparece no app, no build ou no diretório de dados do app. Rode pnpm db:reset && pnpm test && pnpm typecheck. Só reporte problemas, com arquivo:linha. Não edite nada."
```

---

## Depois do Plano 1

- [x] **Escrever o Plano 2 (executor do agente).** Num terminal novo:
  ```
  cd ~/Documents/sala-campanha && claude "Use superpowers:writing-plans. Escreva o Plano 2 (executor do agente) a partir do spec docs/superpowers/specs/2026-10-21-sala-campanha-design.md, usando as interfaces já construídas no Plano 1 (docs/superpowers/plans/2026-10-21-plano-1-fundacao-backend.md). Salve em docs/superpowers/plans/ e atualize HANDOFF.md com as tarefas do Plano 2 no mesmo formato."
  ```
- [x] **Instalar o Rust** (necessário para o Plano 3): `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh` e depois `xcode-select --install`. *(2026-10-28: Rust 1.99.1; as Command Line Tools já estavam instaladas.)*
- [x] **Escrever o Plano 3 (app Tauri para macOS),** do mesmo jeito do Plano 2. *(2026-10-28: `docs/superpowers/plans/2026-10-28-plano-3-app-desktop.md`.)*
- [ ] **Confirmar com a designer** se ela aceita um gerador de imagem diferente do Krea (Gemini ou Flux Kontext), e se depende de algum recurso do Krea que pode não existir na API.
