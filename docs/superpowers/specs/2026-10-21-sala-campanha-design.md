# Sala da Campanha — Documento de design

Data: 2026-10-21
Status: rascunho para aprovação

## 1. Intenção e o porquê

A IA ainda não teve seu "momento multiplayer". Hoje, quem usa IA no trabalho usa sozinho: abre um chat, escreve um prompt, recebe uma resposta que só ele vê. Quando o trabalho envolve mais de uma pessoa, alguém vira intermediário e repassa pedidos de um lado para o outro.

O caso concreto que originou o produto é um time interno de marketing:

- O gestor pede uma peça (post, banner, e-mail) pelo Microsoft Teams.
- A designer traduz o pedido em prompt no Krea (imagem) ou em outra IA (texto), gera, exporta e manda de volta.
- O gestor responde "não era bem isso", e o ciclo se repete por várias rodadas.
- O gestor nunca vê o prompt, as versões descartadas nem o raciocínio. A designer gasta tempo traduzindo pedidos em vez de criar.
- Depois da imagem base, a designer finaliza no Photoshop (logo, texto, pequenos ajustes), e o gestor pede ajustes de novo, também pelo Teams.

**Sala da Campanha** é um app de computador onde o time de marketing e os agentes de IA trabalham juntos na mesma peça, em tempo real. Todos veem a mesma conversa com o agente, qualquer um pode pedir, redirecionar ou aprovar, e o histórico de versões e decisões fica num lugar só.

A referência de experiência é o **Conductor** (conductor.build), um app para desenvolvedores com workspaces compartilhados, presença, chat compartilhado com agentes e painel de resultado. A Sala da Campanha leva esse modelo para times de marketing.

### Por que agora

Agentes já executam tarefas longas e de qualidade, e times de marketing já pagam por várias IAs (ChatGPT, Claude, Krea). O que falta é o espaço compartilhado: hoje cada pessoa usa essas IAs isoladamente.

## 2. Usuários

- **Primeiro time de teste:** o time de marketing interno onde trabalha a namorada do fundador (designer). A designer usa Windows no dia a dia, mas tem um Mac disponível para o teste; o resto do time (incluindo o gestor) usa macOS. Por isso a primeira versão pode ser só para macOS. O time se comunica pelo Microsoft Teams, usa Krea para imagem e pode instalar programas por conta própria.
- **Papéis dentro do time:**
  - **Gestor:** pede peças, redireciona e aprova.
  - **Designer:** produz, conduz a parte criativa e faz o acabamento no Photoshop.
  - **Admin do time:** cadastra as chaves de API e gerencia os membros. Pode ser o próprio gestor.
  - **Espectador:** pode acompanhar uma sala sem pedir nada ao agente. *(Escolha do autor: incluir como papel simples de leitura; ver seção 10.)*

## 3. Objetivos, não-objetivos e anti-objetivos

### Objetivo de sucesso (em cerca de 2 meses)

O time de teste usar o app **numa campanha real**, do pedido à peça aprovada, sem voltar ao Teams para pedir ajustes.

### Objetivos da primeira versão

1. Campanhas compartilhadas entre membros do time, com presença (quem está online e quem está em cada peça).
2. Um chat por peça, compartilhado entre pessoas e agente, onde cada mensagem mostra quem a enviou.
3. Geração de **texto e imagem** no mesmo chat, com escolha de modelo e provedor por pedido e, quando o modelo permite, do esforço (quanto ele raciocina). *(Esforço incluído em 2026-10-27, por decisão do fundador.)*
4. **Chaves do time** (traga suas próprias chaves): o admin cadastra uma vez as chaves de OpenAI, Anthropic, Krea e outros provedores suportados, e todo o time usa.
5. **Fotos do produto como referência:** uma biblioteca por campanha. As fotos podem ser anexadas como referência em qualquer geração de imagem.
6. **Redirecionar durante a geração:** alguém pode mandar mensagem enquanto o agente trabalha, e o pedido é incorporado sem recomeçar a conversa.
7. **Ciclo de vida da peça** com versões, comentários presos a um ponto da imagem e aprovação pelo gestor (seção 5).
8. **Upload da versão final** feita fora do app (Photoshop), para revisão e aprovação dentro da peça.
9. Link de compartilhamento do workspace, que abre o app direto na campanha ou peça.

### Não-objetivos (fora da primeira versão)

- Editar logo, texto ou camadas dentro do app (o acabamento continua no Photoshop).
- Integração direta com Photoshop, Figma ou Canva.
- Publicar direto em Instagram ou outras redes.
- Integração com Microsoft Teams (notificações no Teams podem vir depois).
- Outros verticais (jurídico, vendas). O jurídico fica guardado como ideia 2.
- Windows e Linux. A primeira versão é só para macOS.
- Créditos próprios ou revenda de uso de IA. O time paga direto aos provedores com as próprias chaves.

### Anti-objetivos (fracasso mesmo que funcione)

- **Voltar ao intermediário:** se alguém ainda precisar repassar pedido para outra pessoa colar na IA, o produto falhou.
- **Designer sem autoria:** se o gestor virar "o designer de prompt" e a designer perder o controle criativo, ela rejeita o produto. Pedidos e comentários do gestor ficam visíveis para a designer, que continua dona do acabamento.
- **Complicado demais:** se o gestor precisar aprender uma ferramenta complexa, ele volta ao Teams. Pedir, comentar e aprovar precisam ser óbvios.
- **Chaves vazadas:** se uma chave do time aparecer no computador de um usuário, em log ou para outro membro, o produto perde a confiança do time.

## 4. Tela principal (decidida)

Layout no estilo Conductor, **chat no centro** (opção A escolhida nos mockups):

- **Lateral esquerda:** lista de campanhas e, dentro de cada uma, suas peças. Embaixo, o time, com indicador de quem está online.
- **Centro:** o chat da peça selecionada, compartilhado entre pessoas e agente.
  - Cada mensagem mostra autor e avatar.
  - Textos e imagens gerados aparecem no fio da conversa.
  - Dá para marcar um colega com `@Nome`.
  - No campo de mensagem ficam o seletor de modelo e provedor (com o esforço, quando o modelo permite), o botão de anexar referência e o botão de enviar. *(Esforço incluído em 2026-10-27, por decisão do fundador.)*
- **Lateral direita:** as peças da campanha, com miniatura, tipo (imagem, texto ou ambos) e status (seção 5).
- **Topo:** nome da campanha e da peça, avatares de quem está na peça agora e botão **Compartilhar**, que copia o link do workspace.

Mockup de referência: `.superpowers/brainstorm/.../content/layout.html` (opção A), produzido na sessão de brainstorming. É um wireframe, não um design visual final.

## 5. Ciclo de vida de uma peça (decidido)

Uma peça é a unidade de trabalho: por exemplo, "Banner Instagram — Black Friday". Ela pode conter imagem, texto ou os dois (ex.: post com imagem e legenda).

**Status:** Gerando → Base em revisão → Acabamento → Final em revisão → Aprovada.

### Fase 1: base (no app, com o agente)

1. Alguém sobe fotos do produto na biblioteca da campanha.
2. O gestor ou a designer descreve a peça no chat, escolhe o modelo e, quando o modelo permite, o esforço (quanto ele raciocina). O agente usa a chave de API cadastrada pelo time. Ele gera versões de imagem e/ou texto, usando as fotos marcadas como referência. *(Esforço incluído em 2026-10-27, por decisão do fundador.)*
3. Qualquer membro pode redirecionar durante a geração ("fundo mais claro"). O agente incorpora o pedido.
4. O gestor aprova uma versão base. A peça passa para **Acabamento**.

### Fase 2: acabamento (fora do app)

1. A designer baixa a base aprovada e finaliza no Photoshop (logo, texto, ajustes).
2. Ela sobe a versão final de volta na peça, como nova versão.
3. O gestor comenta num ponto da imagem ("logo menor aqui"). Esse comentário é direcionado à designer, não ao agente, porque o agente não edita o arquivo do Photoshop.
4. Novas versões até o gestor aprovar. A peça fica **Aprovada**.

Para peças só de texto, a fase de acabamento é opcional: o gestor pode aprovar direto a versão gerada ou editada. *(Escolha do autor.)*

### Versões de peças com imagem e texto

Uma versão é um pacote: imagem e legenda juntas, aprovadas juntas. A legenda pode ser editada direto no app antes da aprovação. *(Escolha do autor.)*

### Quem pode fazer o quê (decidido)

| Ação | Admin | Gestor | Designer | Espectador |
|---|---|---|---|---|
| Pedir e redirecionar o agente | sim | sim | sim | não |
| Comentar | sim | sim | sim | não |
| Subir referência ou versão final | sim | sim | sim | não |
| Aprovar base ou final | sim | sim | não | não |
| Voltar a peça uma etapa | sim | sim | sim | não |
| Cadastrar chaves e membros | sim | não | não | não |

- Todos podem pedir gerações, inclusive o gestor sem a designer na sala.
- Voltar uma etapa (ex.: de Acabamento para Gerando) fica registrado no histórico, com autor.
- O gestor pode ser também o admin.

## 5a. Quais mensagens vão para o agente (decidido)

- **Por padrão, toda mensagem enviada no chat da peça vai para o agente.**
- **Exceção:** uma mensagem que começa com `@Pessoa` é conversa entre pessoas. Ela aparece no chat, notifica a pessoa marcada e **não** aciona o agente nem gasta chave.
- O campo de mensagem mostra claramente para onde a mensagem vai (ex.: "Para o agente" ou "Para @Gestor") antes do envio. *(Escolha do autor, para evitar gasto por engano.)*

## 6. Modelos e chaves (decidido)

- **Traga suas próprias chaves:** o time usa as próprias contas de provedores de IA.
- **Chave do time inteiro:** o admin cadastra cada chave uma vez, e todos os membros usam. Não há chave pessoal por membro na primeira versão.
- **Provedores da primeira versão** *(escolha do autor, a confirmar com o time)*:
  - Texto: OpenAI e Anthropic.
  - Imagem com referência: o primeiro adaptador é um modelo que aceita várias imagens de referência, como Gemini (Nano Banana) ou Flux Kontext. O Krea entra como segundo adaptador, se a API dele cobrir o uso do time.
  - **A confirmar com a designer:** se ela aceita um gerador que não seja o Krea, e se depende de recursos do Krea que podem não existir na API (estilos treinados, aumento de resolução).
- O seletor no campo de mensagem lista apenas modelos de provedores cujas chaves o time cadastrou.
- **Segurança das chaves:**
  - Guardadas criptografadas no servidor e usadas somente pelo servidor.
  - Nunca enviadas ao app desktop, nunca registradas em log.
  - Depois de cadastradas, aparecem mascaradas (ex.: `sk-...a1b2`) e só o admin pode substituí-las ou removê-las.
- **Registro de uso por pessoa e por peça:** desejável, mas pode ficar para depois da primeira versão. *(Escolha do autor.)*

## 7. Arquitetura (decidida em linhas gerais)

### Princípio central

**O agente roda no servidor, não no computador de alguém.** Se rodasse no PC da designer, pararia quando ela fechasse o notebook, e o gestor ficaria sem resposta. O app desktop é só uma janela para o estado que vive no servidor.

### Componentes

- **App desktop:** **Tauri** (Rust + WebKit do sistema), como o Conductor, **somente para macOS na primeira versão**. *(Decisão do fundador.)* A interface é web (React), empacotada no Tauri. A parte em Rust deve ficar mínima (janela, protocolo de link, notificações), porque o agente roda no servidor. Windows fica para uma versão posterior; o Tauri usa WebView2 no Windows, então diferenças visuais entre os motores precisarão ser testadas nessa etapa. O link de compartilhamento usa um protocolo próprio (ex.: `sala://campanha/<id>/peca/<id>`), registrado na instalação.
- **Backend:** Supabase. *(Escolha do autor, alinhada aos projetos existentes do fundador em Next.js.)*
  - Auth: login e convite de membros para o time.
  - Postgres: dados (seção 8), com Row Level Security por time.
  - Realtime: presença e novas mensagens e eventos chegando ao vivo para todos.
  - Storage: fotos de referência, imagens geradas e versões finais.
- **Executor do agente no servidor:** um processo que recebe mensagens da fila, chama os provedores com a chave do time e grava os resultados como eventos.
  - O processo é longo, porque gerar imagem leva segundos ou minutos e precisa aceitar redirecionamentos no meio.
  - O builder escolhe a hospedagem (ex.: Supabase Edge Functions com fila, ou um worker em Fly.io ou Railway), desde que cumpra as garantias abaixo.

### Garantias de comportamento (inspiradas no Conductor)

1. **Conversa como lista de eventos:** cada sessão é uma sequência ordenada de eventos (mensagem de usuário, início de geração, resultado, comentário, mudança de status). Cada app recebe os eventos a partir do último que já viu, então quem entra depois vê tudo.
2. **Caixa de entrada de mensagens:** toda mensagem de usuário vai primeiro para o servidor. Um único executor "reivindica" cada mensagem. Duas pessoas mandando ao mesmo tempo nunca geram resposta duplicada.
3. **Fila e redirecionamento:** se o agente está trabalhando e chega nova mensagem, ela é incorporada ao trabalho atual quando o provedor permitir, ou entra na fila. O chat mostra mensagens na fila como "na fila".
4. **Aprovação por outra pessoa:** aprovar uma versão é um evento com autor. Quem aprova pode ser diferente de quem pediu.

### Agente

O "agente" é uma camada de orquestração sobre os provedores. Na primeira versão, ele faz três coisas:

- interpreta o pedido em linguagem natural e o contexto da conversa;
- monta o prompt para o modelo escolhido, incluindo as fotos de referência marcadas;
- devolve o resultado na conversa.

O modelo de texto escolhido pelo time (Claude ou GPT) pode servir como orquestrador para montar prompts de imagem. *(Escolha do autor; o builder define os detalhes.)*

## 8. Modelo de dados (referência)

Inspirado no modelo observado no Conductor (repositório → workspace → sessão → mensagens), adaptado:

- `teams`: time e membros com papel (admin, gestor, designer, espectador).
- `provider_keys`: chave por time e provedor, criptografada, com máscara para exibição.
- `campaigns`: campanha do time.
- `reference_assets`: fotos do produto da campanha.
- `pieces`: peça da campanha (tipo, status, versão aprovada).
- `piece_versions`: versão (origem: gerada pelo agente ou enviada por upload; arquivo e/ou texto; autor).
- `session_events`: eventos ordenados da conversa da peça (autor, tipo, conteúdo, posição na fila).
- `comments`: comentários com autor, alvo (versão e coordenadas na imagem, ou trecho de texto), fio de respostas e "resolvido".
- `presence`: efêmera, via Supabase Realtime, sem tabela.

## 9. Referência: o que foi observado no Conductor

Análise feita no app instalado (v0.91.2), limitada a estrutura, esquema do banco local e textos do executável, sem extrair nem copiar código ou arquivos. Serve apenas como referência de arquitetura e experiência. **Nenhum código, texto ou asset do Conductor deve ser reaproveitado.**

- Casca Tauri (Rust + WebKit) e motor de agentes em Bun, que roda Claude Agent SDK e Codex.
- Servidor central ("Roundhouse") com fluxo de eventos por sessão (`sessionEventWatermark`) e caixa de entrada com reivindicação (`confirmInboxMessageOwnership`).
- Mensagens com `sender_id` e `queue_order`. Redirecionamento durante o turno (`steer`). Aprovação de plano com autor (`resolvePlan`).
- Comentários presos a arquivo e linha, com fio de respostas. Organizações, times, papéis e permissão por workspace.
- Workspaces na nuvem que "dormem" quando ficam ociosos.

## 9a. Escopo do teste real e ordem de corte

*(Escolhas do autor.)*

- **Primeira versão só para o time de teste.** O time e os membros são criados manualmente, sem cadastro aberto ao público nem onboarding automático.
- **Obrigatórios para o teste:**
  - chat compartilhado com autor por mensagem;
  - presença;
  - chaves do time;
  - geração de texto e imagem com referência do produto;
  - ciclo de vida com versões, upload da final e aprovação.
- **Ordem de corte, se faltar tempo** (primeiro a sair primeiro):
  1. comentário preso a um ponto da imagem (vira comentário simples na versão);
  2. link com protocolo próprio (vira convite por e-mail mais abrir no app);
  3. redirecionamento durante a geração (vira fila simples);
  4. mais de um provedor por tipo.
- O prompt montado pelo agente fica visível no chat (recolhido por padrão), para o time ver o que foi pedido ao modelo.

## 10. O que fica a cargo do builder

- Hospedagem do executor do agente, mecanismo de fila e como implementar o redirecionamento para cada provedor.
- Bibliotecas de UI, gerenciamento de estado e empacotamento e atualização automática do Electron.
- Design visual (cores, tipografia). O wireframe só define o layout.
- Criptografia das chaves (ex.: Supabase Vault ou equivalente), desde que cumpra a seção 6.
- Formato exato do link de compartilhamento e da tela de entrada no workspace.
- Limites de tamanho de arquivo e formatos aceitos (no mínimo PNG, JPG e WebP).
- Detalhes do papel de espectador; pode ser omitido se complicar a primeira versão.

## 11. Ideia guardada: jurídico

Mesmo padrão aplicado a escritórios de advocacia: estagiário redige com IA, advogada revisa, e a correção dela hoje se perde. Usuários de teste disponíveis: o sócio advogado e a chefe do fundador num escritório. Fica para depois da validação em marketing.
