# Tink website — design

> Approved 2026-10-29. Written in Portuguese to match the brainstorming session; site copy is English.


## Revisão de 2026-10-29 (decisão do fundador)

A direção visual passou a seguir a linguagem do site da Figma, com toques da Tink:

- **Base:** fundo branco e a sans **Inter** (OFL, com eixo de tamanho óptico, a mais próxima da Figma Sans) em peso regular, com títulos em dois tons (frase em preto e continuação em cinza `--muted`).
- **Palcos:** painéis de cor chapada mostram o produto. O amarelo recebe a cena do chat e o azul recebe as chaves do workspace.
- **Menu:** Products tem submenu, gerado a partir de `products.ts`. Não há "Log in", porque o app ainda não abriu.
- **Toques da Tink, só nos destaques:** a serifa Newsreader (logo, "in one room.", "Not quite."), o marca-texto amarelo e os traços azuis à mão.
- **Fora:** não copiamos textos, ilustrações nem o layout seção por seção da Figma.

O restante deste documento continua valendo onde não conflita com esta revisão.

## Hero com colagem de papel (2026-10-29, decisão do fundador)

O centro do hero tem uma colagem de papel recortado à mão, animada em stop-motion. Fica no componente `HeroCollage.astro`, e o hero segue o layout da Figma: título à esquerda, colagem no centro e formulário à direita.

- **Três atos em loop de 18 s:**
  1. O briefing e o bilhete "Not quite." passam de mão em mão entre três pessoas.
  2. Todos se juntam numa sala de papel kraft, e a referência vira três versões, com brilho e carimbo "Approved".
  3. As peças aprovadas se empilham e se revezam.
- **Feito só em código**, porque o Pletor estava sem créditos. Cada recorte é uma `div` com máscara SVG de borda irregular, textura de grão e sombra curta. A animação é CSS a 12 fps (`steps()`), com uma leve tremida.
- **Acessibilidade:** botão Pause/Play, pausa automática fora da tela e uma descrição em texto para leitores de tela.
- **Movimento reduzido ou sem JS:** mostra a pilha parada.

## Nome do produto principal (2026-10-29, decisão do fundador)

A funcionalidade principal, a conversa compartilhada entre o time e os agentes, se chama **Room** ("Tink Room"), e não "Chat". O nome amarra com o título "Your campaign, in one room." e com a origem do produto. A URL é `/products/room`.

## Revisão de 2026-10-29 (noite): referências "Dewbloom" (decisão do fundador)

O site passou a se inspirar em capturas de tela do site Dewbloom, enviadas pelo fundador. O layout Figma do hero (título, colagem no centro, formulário à direita) foi mantido.

- **Paleta da referência:** fundo off-white quente `#f7f5f0`, texto marrom quase preto, lilás `#dca8f2`, laranja `#e2924a`, marrom `#2e221e`, taupe `#9c8473` e azul claro `#cad4e4`. O amarelo da Tink fica só nos destaques. O traço à mão passou a ser laranja queimado `#a8501c`.
- **Títulos `h1` e `h2`:** Inter peso 650, a mesma fonte do texto corrido, só que mais pesada. A Bricolage foi testada e rejeitada pelo fundador. *(Revisão de 2026-10-31, por decisão do fundador: os títulos passaram para Inter peso 400, grandes e sem negrito, como na Figma. O tamanho marca a hierarquia, não o peso.)*
- **Molduras com padrão (`PatternFrame.astro`):** borda laranja, faixa de padrão (listras, xadrez ou cubos isométricos), passe-partout taupe e painel. Aparecem no hero, no chat, nas chaves e no CTA final.
- **Tabela comparativa (`Comparison.astro`):** "Chat app + AI tools" contra a Tink, com a coluna da Tink escura e uma legenda (Strong, Trade-off, Falls short). Todas as linhas vêm deste documento, inclusive uma em que a alternativa também é forte.
- **Rodapé:** marrom escuro, com colunas de links e "Tink" gigante listrado embaixo.
- **Fora:** faixa de números e cartões de preço, porque ainda não há dados reais.

## Contexto
O app desktop (Sala da Campanha, agora com o nome público **Tink**) ainda não está aberto ao público. O site serve para apresentar a Tink a times internos de marca e transformar a visita em inscrição na **lista de espera**. Mensagem central: *a peça para de ir e voltar, porque o time conversa e gera tudo num lugar só*. O site fica em inglês, num pacote novo dentro do monorepo, sem mexer no app.

## Decisões fechadas com o usuário
- Público: time interno de marca (marketing e designers da própria empresa).
- Única ação: entrar na lista de espera, com o formulário no hero e no fim da página. Envio para o **Loops**.
- Idioma: inglês.
- Sem números de preço, depoimentos ou logos de clientes.
- Tecnologia: **Astro**, em `packages/website`, com saída estática.
- Visual: direção **A · Blue Pencil**. A página parece uma prova de arte sendo revisada: serifada editorial, papel off-white, tinta preta, marca-texto amarelo (vem do brilho da logo) e o "lápis azul" de editor como cor de apoio. Ingredientes: rabisco sobre o texto, traços que reagem ao gesto, cena do chat encenada e voz de manifesto.
- Evitar: visual infantil, cara de IA genérica (roxo, gradiente, "mágica"), layout de template e site pesado.
- Páginas: Home, Products (hoje só o Room, com estrutura para novos produtos), Solutions, How it works, Pricing (sem valores), Learn, Manifesto, About e Privacy.
- Conteúdo: o usuário cola no chat o texto de Solutions, About, Learn e Manifesto. Eu rascunho Home, Products/Room, How it works, Pricing e Privacy para revisão.

## Minhas escolhas (o usuário pode trocar)
- Deploy e domínio ficam fora deste trabalho. O build estático serve em qualquer host.
- Sem framework de UI no navegador. Os componentes Astro geram HTML, e só quatro scripts pequenos rodam no cliente: menu mobile, traços, cena do chat e formulário.
- Tipografia: uma serifada editorial (candidata: Newsreader, licença OFL), hospedada no próprio site, com `font-display: swap`. A interface da cena do chat usa a fonte do sistema para parecer produto. Sem fonte manuscrita, porque ela puxa para o infantil e atrapalha a leitura.
- Tokens: papel `#F7F5F0`, tinta `#141414`, marca-texto `#F6E04B` (só como fundo, nunca como cor de texto) e lápis azul em torno de `#2346C8` (conferir contraste ≥ 4,5:1 sobre o papel quando usado em texto).
- As três versões de peça na cena do chat são de uma marca fictícia, desenhadas em SVG e identificadas como exemplo.

## Estrutura
```
packages/website/
  package.json            # @sala/website: dev, build, preview
  astro.config.mjs
  public/fonts/           # woff2 + licença OFL
  public/favicon.svg
  src/styles/global.css   # tokens, tipografia, reset, foco visível, reduced-motion
  src/data/site.ts        # nav, LOOPS_FORM_ENDPOINT, e-mail de contato
  src/data/products.ts    # lista de produtos (hoje só o Room); nav e /products leem daqui
  src/lib/waitlist.ts     # validação de e-mail + POST ao Loops + mapeamento de respostas (TS puro, testável)
  src/layouts/Base.astro  # <head>/meta/OG, skip link, Nav, Footer
  src/components/
    Nav.astro             # menu mobile com botão e aria-expanded
    Footer.astro
    WaitlistForm.astro    # label visível, aria-live, estados: enviando / ok / erro / limite
    Scribble.astro        # traços SVG à mão: underline, circle, strike, arrow, margin-note
    ChatScene.astro       # cena encenada com botão de pausar
  src/content/learn/      # artigos em Markdown (content collection)
  src/pages/ index, products/index, products/chat, solutions, how-it-works,
             pricing, learn/index, learn/[slug], manifesto, about, privacy, 404
tests/website/waitlist.test.ts
```
Mudanças fora do pacote: script `"website"` no `package.json` da raiz e o novo teste. O app desktop não é tocado.

## Comportamento
- **Traços:** paths SVG desenhados à mão, aplicados como marcas de revisão (sublinhar, circular, riscar "back and forth", seta). Eles se desenham ao entrar na tela (IntersectionObserver + `stroke-dashoffset`). No desktop, alguns têm um leve deslocamento com o cursor. São decorativos (`aria-hidden`).
- **Cena do chat:** HTML real, em que mensagens do time com @menção viram três versões de peça. Roda uma vez quando aparece na tela e tem botão de pausar/repetir. Tem resumo em texto para leitores de tela.
- **Movimento reduzido:** com `prefers-reduced-motion: reduce`, os traços aparecem completos e a cena mostra o estado final, sem animação.
- **Lista de espera:**
  - `fetch` POST `application/x-www-form-urlencoded` para o endpoint de formulário do Loops, com `email` e `source` (página de origem).
  - O endpoint é público e não envolve chave secreta.
  - Sem JS, o formulário cai para um POST nativo.
  - O build de produção falha se `LOOPS_FORM_ENDPOINT` estiver vazio. Em dev, o formulário avisa que o endpoint não foi configurado.
  - O status 429 vira a mensagem "try again in a moment".
- **Products:** uma página por produto, gerada a partir de `products.ts`. Para adicionar um produto no futuro, basta uma entrada nova e uma página nova.
- **Pricing:** explica o modelo sem números (o time usa as próprias chaves de IA) e chama para a lista de espera. Não inventa planos.
- **Privacy:** rascunho curto dizendo o que é coletado (e-mail e página de origem), para quê, que o Loops processa os dados e como sair da lista. Marcado para revisão jurídica.
- **About e Learn:** só com o conteúdo do usuário. Até ele chegar, cada página fica como "em breve", sem conteúdo inventado.

## Ordem de execução
1. Salvar este design em `docs/superpowers/specs/2026-10-29-tink-website-design.md`.
2. Criar o pacote Astro com tokens, layout, Nav, Footer e fontes.
3. Fazer `waitlist.ts` com teste (TDD) e depois o `WaitlistForm`.
4. Fazer `Scribble`, `ChatScene` e a Home completa. Revisar com o usuário antes de continuar.
5. Criar as outras páginas, colando o conteúdo do usuário à medida que chega.
6. Fazer a passada de acessibilidade, responsividade e desempenho, e depois o commit.

## Pendências do usuário (não bloqueiam o início)
- Arquivo original da logo (SVG ou PNG grande). Sem ele, eu recrio o ícone em SVG, marcado como provisório. O ícone atual do Tauri é o padrão e não é o da Tink.
- URL do endpoint de formulário do Loops (Forms → Settings) e lista marcada como Public.
- E-mail de contato para a página de Privacy.
- Textos de Solutions, About, Learn e Manifesto.

## Verificação
- `pnpm --filter @sala/website build` sem erros.
- `pnpm vitest run tests/website` passando, cobrindo e-mail inválido, sucesso, erro e 429.
- `pnpm typecheck` na raiz, que cobre `src/**/*.ts` do pacote.
- `pnpm --filter @sala/website preview` aberto no navegador em 375, 768 e 1280 px:
  - sem rolagem horizontal;
  - navegação completa só por teclado, com foco visível;
  - menu mobile funcionando;
  - movimento reduzido emulado nas DevTools;
  - envio real de um e-mail de teste ao Loops, quando houver endpoint.
- Lighthouse (DevTools) na Home: acessibilidade e desempenho ≥ 95 como meta.
