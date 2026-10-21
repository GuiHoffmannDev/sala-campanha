# Handoff — Sala da Campanha

Guia para executar o projeto tarefa por tarefa. Cada tarefa roda num **terminal separado** do Claude Code, e cada revisão roda em outro, para manter o contexto de cada conversa pequeno.

## Documentos

| O quê | Caminho |
|---|---|
| Design aprovado (o que construir e por quê) | `docs/superpowers/specs/2026-10-21-sala-campanha-design.md` |
| Plano 1 — Fundação do backend (Supabase) | `docs/superpowers/plans/2026-10-21-plano-1-fundacao-backend.md` |
| Plano 2 — Executor do agente | ainda não escrito |
| Plano 3 — App Tauri para macOS | ainda não escrito |

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

## Depois do Plano 1

- [ ] **Escrever o Plano 2 (executor do agente).** Num terminal novo:
  ```
  cd ~/Documents/sala-campanha && claude "Use superpowers:writing-plans. Escreva o Plano 2 (executor do agente) a partir do spec docs/superpowers/specs/2026-10-21-sala-campanha-design.md, usando as interfaces já construídas no Plano 1 (docs/superpowers/plans/2026-10-21-plano-1-fundacao-backend.md). Salve em docs/superpowers/plans/ e atualize HANDOFF.md com as tarefas do Plano 2 no mesmo formato."
  ```
- [ ] **Instalar o Rust** (necessário para o Plano 3): `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh` e depois `xcode-select --install`.
- [ ] **Escrever o Plano 3 (app Tauri para macOS),** do mesmo jeito do Plano 2.
- [ ] **Confirmar com a designer** se ela aceita um gerador de imagem diferente do Krea (Gemini ou Flux Kontext), e se depende de algum recurso do Krea que pode não existir na API.
