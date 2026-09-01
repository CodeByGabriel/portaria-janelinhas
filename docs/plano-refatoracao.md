# Refatoração do Portaria Janelinhas

## Contexto

O app existe e funciona: 113 testes de unidade, 30 verificações fim-a-fim, dois ciclos de red team/blue team, 14 commits. A vitrine é apresentável. Mas ele foi construído para uma demonstração, e a pesquisa em `docs/pesquisa-refatoracao.md` — feita sem acesso ao código — apontou que a promessa central ("registra quem entregou qual criança a quem") não se sustenta em produção.

Verifiquei cada premissa dela contra o código. A pesquisa acertou o diagnóstico geral e errou em vários detalhes que mudam o plano. E o código escondia **quatro defeitos que nem ela nem os dois red teams anteriores encontraram** — um deles pior que o problema que ela veio resolver.

Este plano corrige a integridade antes da visita à escola, depois o fluxo humano, depois o modelo de "a quem".

---

## 1. Resumo

Fase 0 fecha integridade: persistir a trilha em SQLite (hoje um reinício **substitui a lista real da escola pelos 44 alunos fictícios, em silêncio**), migrar para a Hibernation API, pôr tetos de tamanho, parar a portaria de destruir o DOM sob o dedo da porteira, e corrigir os três pares de contraste que reprovam medidos. Fase 1 trata o humano: evento compensatório "retornou", busca melhor, fila com timer, direção visual "Pátio", wake lock, som novo. Fase 2 traz responsáveis autorizados e autenticação por token de dispositivo. Fase 3 esboça as interfaces do ecossistema.

Fica tudo: máquina de estados pura, retrato completo, trilha append-only, filtro de turma nos dois sentidos, `busca.ts`, `importar.ts` e os 26 testes de regressão. Nada disso tem defeito de mérito.

---

## 2. Premissas da pesquisa que o código desmente

| # | A pesquisa diz | O código diz | Efeito no plano |
|---|---|---|---|
| 1 | "Verificar a migração; se a classe for KV-backed, avalie criar nova classe" | `wrangler.toml:11` — **já é `new_sqlite_classes`** | 0.1 fica mais simples: nada de recriar classe, nada de perda de dados |
| 2 | "Estados dependem só de cor — falha WCAG 1.4.1" | `cartao.js:11-16` — `chamado` e `liberado` **têm rótulo textual**, e o W3C diz que texto sozinho satisfaz 1.4.1 | Não há violação de 1.4.1 para esses dois. **Há** para `aguardando`: rótulo é `''` e a etiqueta fica `hidden` — comunicado por ausência |
| 3 | "Verde e âmbar convergem sob daltonismo" | Simulei Viénot: distância entre os textos das etiquetas cai de 136 para **70** (deuteranopia) e 46 (protanopia). Reduz, não colapsa | O problema real é **contraste**, não indistinguibilidade |
| 4 | "Confirmar contraste no app rodando" | Calculei. Reprovam: `--tinta-fraca` **3,54** (mín. 4,5); todas as bordas de estado **1,29–1,51** (mín. 3,0); e o pior — botão desabilitado "Aguardando no portão" a **2,12**, que é justo o estado que a professora precisa ler | Critério de aceite deixa de ser "verificar" e passa a ser "corrigir estes cinco pares nomeados" |
| 5 | Paleta "Pátio" proposta como pronta | Dois defeitos medidos: `--estado-aguardando` **#78716C = 4,49** no creme (reprova por 0,01); e `--estado-chamado` **#C2410C** vs `--estado-retorno` **#B91C1C** colapsam para distância **20** sob deuteranopia | Adotar com correção: `aguardando` → `#736C67` (4,83); `retorno` → `#86198F` (contraste 7,71, separação mínima 60) |
| 6 | "Orçamento sugerido: portaria ≤ 250 KB" | A portaria hoje pesa **25,0 KiB em 6 requisições**, zero imagens, zero fontes, zero terceiros | 250 KB permitiria regressão de 10×. Orçamento proposto: **≤ 120 KB** |
| 7 | "Teste com `@cloudflare/vitest-pool-workers`" | Pacote substituído pelo **`@cloudflare/vitest-plugin`**; `runInDurableObject` não aparece na documentação atual | Critério de aceite muda de método (ver 0.2) |
| 8 | "Confirmar alvos de toque no app rodando" | Medido do CSS: **6 de 9 ações primárias em 40,08px**. A `.linha` mede 68px e *parece* generosa, mas o alvo dentro dela tem 40px | Vira correção, não investigação |
| 9 | Marca `web/comum/dom.js` como o módulo anti-injeção | **Não existe**; a função está em `cartao.js`. Mensagem de commit `52ae922` desatualizada | Nota histórica; sem efeito |

### Quatro defeitos que ninguém tinha encontrado

**A. No reinício, a escola vira ficção.** `livro.ts:16` — `constructor(alunos: Aluno[] = semear())`. Sem storage, um reinício não deixa a tela vazia: ela volta a mostrar os **44 alunos fictícios** no lugar da lista real importada. A porteira busca um nome real, não acha, e conclui que a criança não está matriculada. Isto é pior que perder a trilha, porque é silencioso e plausível.

**B. O furo S2 foi fechado pela metade.** A sala faz reconciliação por chave (`sala/index.html:126-161`) e o cartão sob o dedo sobrevive. A portaria faz `ul.innerHTML = ''` a cada retrato (`portaria/index.html:197`) — e pior, `aoRetrato` chama `campo.oninput()` (`:117`), então **um retrato entrando pela rede reconstrói também os resultados da busca**, incluindo o botão "Chamar" prestes a ser tocado. A ação de outra pessoa, em outra sala, troca o botão sob o dedo da porteira. O `desde` estável impediu a reordenação lógica; a preservação do DOM ficou faltando de um dos dois lados.

**C. O áudio falha em silêncio.** `som.js:48,55` testam `!contexto`, nunca `contexto.state === 'suspended'`. Se o sistema suspender o contexto depois do destravamento inicial (aba em segundo plano, chamada, bloqueio de tela), `tocarAbertura()` executa normalmente e não sai som — **sem nenhum sinal na tela**.

**D. Busca vazia é indistinguível de busca carregando.** `portaria/index.html:186` só renderiza aviso quando `total > achados.length`. Zero resultados produz lista em branco, igual a "ainda processando".

### Outras divergências registradas

- `portaria.ts` e `index.ts` têm **zero cobertura de teste unitário** — Node não instancia `WebSocketPair` nem `DurableObjectState`. Toda a camada de rede existe só sob o `fim-a-fim.mjs`.
- `/importar` **não tem nenhuma verificação fim-a-fim**: seus quatro códigos de erro (405, 403, 422, 409) nunca foram exercitados contra o servidor.
- `/alunos` e `/registro` **não checam o método HTTP**; um POST responde 200 e abandona o corpo.
- Os ids da semente continuam **posicionais** (`a01…a44`); a defesa contra varredura é o filtro de turma, não a imprevisibilidade.
- `registro()` é **cópia rasa**: o array é novo, os eventos dentro dele são as mesmas referências.
- Mudo não é lembrado, não há volume, não há `aria-pressed` nem `aria-live` em lugar nenhum.
- Turma inválida **não é fail-closed** como o papel: conecta e vira sessão cega.
- `docs/pesquisa-refatoracao.md` **não existia no repositório** — estava em `Downloads`. Versionada neste commit.

---

## 3. Tarefa 0 — Baseline (P/M)

**Objetivo:** medir o "antes" para os critérios de aceite terem contra o que ser medidos.

Saída: `docs/baseline.md` + `docs/prints/antes/`.

- `npm run dev`; `node ferramentas/prints.mjs` → `docs/prints/antes/`
- Latência chamar → cartão na sala, 10 amostras, mediana e pior caso (alvo < 400 ms)
- Alvos de toque medidos no DOM real com `getBoundingClientRect`, confirmando os 40,08px calculados
- Reload da sala no meio do turno: o áudio volta? A tela dorme?
- 15 chamados simultâneos em "EM SAÍDA": a lista escala?
- Peso transferido no primeiro carregamento da portaria (aba de rede), confirmando os 25,0 KiB
- Os três portões rodados crus, código de saída registrado explicitamente

**Risco:** o `wrangler dev` cai quando um WebSocket desconecta abruptamente (bug do 4.127.1, corrigido no 4.128.0 já instalado) e quando há instância órfã segurando `.wrangler/state` (`SQLITE_BUSY`). O README documenta a limpeza. Rodar a baseline com **uma** instância limpa.

---

## 4. Fase 0 — Integridade

Entregar antes da visita à escola. Nada aqui depende de decisão da escola.

### 0.1 — Ancoragem e infraestrutura de teste do Durable Object (M)

| | |
|---|---|
| **Objetivo** | Criar a branch, versionar a pesquisa, e ligar um runner capaz de instanciar o DO — hoje impossível |
| **Arquivos** | `docs/pesquisa-refatoracao.md` (novo, cópia do artefato), `docs/plano-refatoracao.md` (novo), `package.json`, `vitest.config.ts` (novo), `src/portaria.test.ts` (novo) |
| **Reescrito × reaproveitado** | Nada reescrito. `node --test` **fica** para os 6 módulos puros: 113 testes, zero dependência, arranque instantâneo. O `@cloudflare/vitest-plugin` entra **só** para a camada do DO, que exige o runtime `workerd`. Dois runners, cada um no que é bom; `npm test` roda os dois em sequência |
| **Testes novos** | Primeiro `portaria.test.ts`: conecta como `sala` sem turma e confirma que não vê nem age (protege o furo 1 da 2ª passagem no nível de unidade, hoje só coberto pelo e2e) |
| **Aceite** | `npm test` roda os dois runners e devolve código de saída 0; um teste instancia `Portaria` e recebe um retrato |
| **Risco/rollback** | O plugin pode conflitar com `--experimental-strip-types`. Rollback: manter só `node --test` e provar persistência pelo caminho de integração (0.2) |
| **Depende de** | — |

### 0.2 — Persistência da trilha, cadastro e chamadas (G)

| | |
|---|---|
| **Objetivo** | Que um reinício deixe de apagar o dia — e, principalmente, deixe de **substituir a escola pela ficção** (defeito A) |
| **Arquivos** | `src/deposito.ts` (novo), `src/livro.ts`, `src/portaria.ts`, `src/deposito.test.ts` (novo) |
| **Desenho** | `deposito.ts` é a **única** casa do SQL: `iniciar()` (CREATE TABLE IF NOT EXISTS), `carregar(): Instantaneo`, `registrar(evento)`, `salvarChamada`, `removerChamada`, `trocarCadastro`, `podar(antesDe)`. Três tabelas: `trilha` (append-only), `chamadas` (estado vivo), `cadastro`. `Livro` ganha um construtor que hidrata de um `Instantaneo` e **continua puro** — nunca importa `deposito`. O DO faz o write-through: `const evento = livro.aplicar(...)` e em seguida grava. Como `sql.exec` é síncrono e não há `await` entre as escritas, elas coalescem numa transação atômica (documentado nas *Rules of Durable Objects*) |
| **Por que write-through e não storage-como-fonte** | É o padrão que a própria Cloudflare recomenda ("initialize from persistent storage and set instance variables the first time it is accessed"), e é o único que preserva o invariante 8: `livro.ts` permanece sem armazenamento |
| **Inicialização** | `ctx.blockConcurrencyWhile(async () => { this.livro = new Livro(await deposito.carregar()) })` no construtor — a documentação diz que é para isso e só para isso |
| **Tetos, puxados para cá** | Persistir crescimento ilimitado é pior que mantê-lo em RAM. Corpo da importação ≤ **1 MB** (292 alunos ≈ 15 KB, 60× de folga); `erros[]` devolve no máximo **100** com o total à parte; sessões WebSocket ≤ **200**; trilha podada por `alarm()` diário conforme a retenção decidida |
| **Testes novos** | `deposito.test.ts`: esquema idempotente, trilha sobrevive a `carregar()`, poda respeita a data de corte. `portaria.test.ts`: **destruir a instância e recriar preserva a trilha e o cadastro** — e, explicitamente, que o cadastro **não** volta para `semear()` (defeito A) |
| **Aceite** | Depois de reinício forçado do DO, `/registro` devolve a trilha íntegra e `/alunos` devolve a lista **importada**, não a semente. Se o helper de reinício não existir no plugin, o teste roda pelo caminho de integração: um script em `ferramentas/` que semeia, mata o `wrangler dev`, sobe de novo sobre o mesmo `.wrangler/state` e confere |
| **Risco/rollback** | Alto — é o coração. Rollback: `git revert` da tarefa; o app volta a ser em memória e continua funcionando para a demonstração |
| **Depende de** | 0.1 |

### 0.3 — WebSocket Hibernation API (M)

| | |
|---|---|
| **Objetivo** | Deixar o DO hibernar sem perder conexões nem estado |
| **Arquivos** | `src/portaria.ts` |
| **Desenho** | `ctx.acceptWebSocket(servidor)` no lugar de `servidor.accept()`; `servidor.serializeAttachment({ papel, turma })` no lugar do `Set<Sessao>`; os listeners viram os métodos `webSocketMessage`, `webSocketClose`, `webSocketError`; `transmitir()` itera `ctx.getWebSockets()` e lê `deserializeAttachment()` |
| **Reescrito × reaproveitado** | Reescrito por mérito: o `Set<Sessao>` em memória é exatamente o que a hibernação quebra, e o attachment é a resposta oficial. A lógica de filtro por papel/turma é **reaproveitada intacta** — só muda de onde vêm os dados da sessão |
| **Ordem importa** | **Depois** de 0.2, nunca antes. Com Hibernation e sem persistência, acordar devolve as conexões e um `Livro` vazio — pior que hoje, onde o `accept()` clássico mantém o objeto residente. A pesquisa não tinha esse detalhe |
| **Testes novos** | As 30 verificações fim-a-fim são a rede: papel fail-closed, filtro de turma na escrita, varredura de ids. Acrescentar: reconexão após hibernação simulada preserva papel e turma |
| **Aceite** | Os 30 checks continuam verdes; nenhum `setTimeout`/`setInterval` no DO; `ctx.getWebSockets().length` reflete as conexões vivas |
| **Risco/rollback** | Médio. Rollback isolado: a tarefa toca um arquivo só |
| **Depende de** | 0.2 |

### 0.4 — A portaria para de destruir o DOM sob o dedo (M) — **acrescentado por mim**

| | |
|---|---|
| **Objetivo** | Fechar a outra metade do furo S2 (defeito B) |
| **Arquivos** | `web/portaria/index.html` |
| **Desenho** | Portar a reconciliação por chave que a **sala já faz corretamente** (`sala/index.html:126-161`): manter um `Map<alunoId, elemento>`, remover só os ausentes, mutar os existentes em lugar. E remover o `campo.oninput()` de dentro de `aoRetrato` — um retrato da rede não pode reconstruir os resultados da busca |
| **Reescrito × reaproveitado** | Reaproveita o padrão já validado da sala. Não é código novo, é aplicar de um lado o que já está certo do outro |
| **Testes novos** | Verificação fim-a-fim: com um resultado de busca na tela, um retrato chegando **não** troca o nó do botão (comparar identidade do elemento antes e depois). Protege S2 no lado que ficou de fora |
| **Aceite** | O elemento sob o cursor sobrevive a um retrato; o `innerHTML = ''` some das listas vivas |
| **Risco/rollback** | Baixo, arquivo único |
| **Depende de** | — (pode ir em paralelo com 0.2) |

### 0.5 — Estados legíveis e alvos de toque (M)

| | |
|---|---|
| **Objetivo** | Corrigir os cinco pares de contraste medidos, dar rótulo ao `aguardando`, acrescentar ícone e faixa lateral, e levar os alvos a 44px |
| **Arquivos** | `web/comum/tokens.css`, `web/comum/cartao.js`, `web/sala/index.html`, `web/portaria/index.html` |
| **Decisão de sequência** | **Antecipo aqui os tokens de *estado* da direção "Pátio"** (corrigidos: `aguardando #736C67`, `retorno #86198F`), porque são exatamente a correção de acessibilidade. Fazer contraste na Fase 0 e trocar a paleta na Fase 1 seria o mesmo trabalho duas vezes. A tipografia, as fontes e a variante "Painel" **ficam** na Fase 1 |
| **O que muda** | Cada estado passa a ter os quatro canais: cor + ícone + rótulo + faixa lateral grossa. `aguardando` ganha rótulo ("aguardando"). O botão desabilitado deixa de usar `opacity` no elemento inteiro (era o par de 2,12) e passa a ter tokens próprios. `button` ganha `min-height: 44px` |
| **Ícones** | SVG inline no `cartao.js`, sem biblioteca e sem CDN (invariante 12). Cinco glifos simples: relógio, sino, check, porta, seta-de-volta |
| **Testes novos** | Teste de tokens em Node: para cada par declarado, contraste calculado ≥ o mínimo do seu papel — o mesmo cálculo que usei na verificação, virando portão automático. E: todo estado tem rótulo não-vazio |
| **Aceite** | Zero pares reprovando no teste automático; auditoria sem violação de 2.5.8 nas duas telas; prints "depois" em `docs/prints/fase-0/` com simulação de deuteranopia anexada |
| **Risco/rollback** | Baixo. Visual, reversível |
| **Depende de** | — |

### 0.6 — Áudio deixa de falhar calado (P) — **acrescentado por mim**

| | |
|---|---|
| **Objetivo** | Defeito C: se o contexto suspender depois, a sala precisa saber |
| **Arquivos** | `web/comum/som.js`, `web/sala/index.html` |
| **Desenho** | `tocarAbertura()`/`tocarEntrega()` verificam `contexto.state`; se suspenso, tentam `resume()` e, falhando, emitem um aviso visível ("toque para reativar o som"). Mudo passa a ser lembrado em `localStorage` e o botão ganha `aria-pressed` |
| **Aceite** | Suspender o contexto pelo console faz aparecer o aviso; recarregar a página preserva o mudo |
| **Risco/rollback** | Baixo |
| **Depende de** | — |

### 0.7 — Base LGPD documentada (P)

`docs/lgpd.md`: escola = controladora, dono do app = operador; base legal do art. 14 (consentimento específico e em destaque de um dos pais); minimização (Nome + Turma é o mínimo e continua sendo o padrão); retenção da trilha; acesso e eliminação; resposta a incidente; nenhum dado real no repositório; avatar não fotorrealista. **Documento, não código**, com aviso explícito de que exige revisão jurídica antes de qualquer dado real.

Acrescento um item que a pesquisa não levantou: **`/alunos` entrega o cadastro inteiro ao cliente** (`portaria.ts:59`) e a busca roda no navegador. Isso é minimização ao contrário e precisa constar do inventário — a correção (busca no servidor) fica para a Fase 1.

---

## 5. Fase 1 — Fluxo humano

### 1.1 Evento compensatório `retornou` (M)
Nova ação, **dona: a professora** (decidido). É linha nova na trilha, jamais remoção. `liberado → chamado` com motivo obrigatório. Teste garantindo que `liberado → aguardando` continua proibido e que `entregue` continua terminal.

### 1.2 Busca redesenhada (M)
Iniciais e sobrenome além do prefixo; **mensagem quando não há resultado** (defeito D); homônimos sempre com turma; chamar em ≤ 2 toques; feedback < 400 ms. Reaproveita `busca.ts` inteiro — a normalização de nome brasileiro tem mérito comprovado por 4 testes de regressão.

### 1.3 Lista "EM SAÍDA" (M)
Agrupada por estado, timer de espera visível (o `desde` já existe e nunca foi renderizado), badge de contagem — hoje a tela que gerencia a fila é a única que não mostra o tamanho dela. Estabilidade sob o dedo já resolvida em 0.4.

### 1.4 Irmãos — **adiado para a Fase 2** (decidido)
Coluna "Família" seria um segundo modelo de identidade competindo com o de responsáveis. O vínculo real é "mesmo responsável".

### 1.5 Direção visual "Pátio", tipografia e variante "Painel" (G)
Tokens de estado já vieram em 0.5. Aqui entram: escala tipográfica real (hoje há **15 tamanhos distintos**, cinco deles dentro de 1,6px uns dos outros), Fraunces + a sans escolhida, **self-hosted em woff2 subset latin** com só os pesos usados (invariante 12), e a variante "Painel" para a sala com os mesmos tokens semânticos. Checklist anti-slop aplicado.

### 1.6 Wake lock (P)
Screen Wake Lock com reaquisição em `visibilitychange`. Não existe nada hoje.

### 1.7 Som novo (P)
250 ms–1 s, 600 Hz–2 kHz, fundamental + quinta, sem repetição, só em evento genuíno, com volume lembrado.

### 1.8 Lembrar a última turma (P)
Pré-selecionada com confirmação explícita, até existir login.

### 1.9 Alerta de restrição/guarda (M) — **antecipado para cá** (decidido)
Campo de observação por aluno, vindo de coluna opcional da planilha, disparando alerta bloqueante na portaria **antes de chamar e antes de liberar**. É o maior risco jurídico do projeto e a mitigação barata existe agora. O modelo nomeado ("não entregar a X") vem na Fase 2 por cima.

---

## 6. Fase 2 — "A quem" e identidade

### 2.1 Responsáveis autorizados (G)
Nome, vínculo, telefone; foto só com consentimento. "Entregar" passa a exigir a escolha do responsável e a trilha grava o adulto. A restrição da 1.9 evolui para nomeada. **Habilita a chamada agrupada de irmãos** (1.4), que passa a usar "mesmo responsável" como vínculo.

### 2.2 Autenticação por token de dispositivo (G) — decidido
A escola emite um token por aparelho carregando papel e turma; o app deixa de aceitar papel pela query string. Fail-closed preservado. Migra para Better Auth trocando só o verificador. Aqui também se corrige a **assimetria** encontrada: turma inválida hoje conecta e vira sessão cega, em vez de recusar como o papel.

---

## 7. Fase 3 — Ecossistema (esboço de interfaces apenas)

Cadastro por API substituindo a planilha; exportação da trilha no formato `LogAuditoria`; delegação "hoje a avó busca" via portal de pais; push só com fallback e só quando o portal existir.

---

## 8. Decisões que dependem de você

**Já decididas nesta rodada:** restrição como alerta simples na Fase 1 · irmãos adiados para a Fase 2 · "retornou" disparado pela professora · token de dispositivo agora.

**Abertas** — cada uma com o padrão que adoto se você não responder:

| # | Decisão | Recomendação | Padrão se calar |
|---|---|---|---|
| 1 | **Retenção da trilha** | 90 dias no app + exportação antes da poda. Cobre o ano letivo por bimestre sem acumular indefinidamente | 90 dias, poda diária por `alarm()` |
| 2 | **Nomes exatos das turmas** | Vêm da visita. Ficam num único ponto de `semente.ts` | Manter Pré 1, Pré 2, 1º–9º ano |
| 3 | **Som: síntese ou arquivo** | Síntese com Web Audio — zero asset, funciona offline, e o invariante 12 empurra para cá | Síntese |
| 4 | **Fonte de corpo: Inter Tight ou Instrument Sans** | **Instrument Sans**. Inter Tight é parente do Inter, que é justamente a fonte citada como marca do visual genérico de IA | Instrument Sans |
| 5 | **Orçamento de peso** | **≤ 120 KB** transferidos no primeiro carregamento da portaria. A pesquisa sugeriu 250 KB sem saber que o app pesa 25 KB — isso autorizaria uma regressão de 10× | 120 KB, medido na Tarefa 0 e reconferido a cada fase |

---

## 9. Ordem, checkpoints e definição de pronto

**Branch:** `refatoracao-v2`, a partir de `portaria-janelinhas`. Primeiro commit = este plano em `docs/plano-refatoracao.md` + a pesquisa em `docs/pesquisa-refatoracao.md`.

**Um commit por tarefa.** Antes de cada commit, os três portões rodados **crus**, com código de saída conferido explicitamente — nunca canalizados para `head` ou `grep`, que foi como o typecheck passou meses quebrado sem ninguém ver.

**Parada obrigatória ao fim de cada fase** para sua aprovação. Ao fim de cada fase: red team (só acha) + blue team (conserta com um teste de regressão por achado).

**Definição de pronto por fase:**

- **Fase 0** — reinício do DO preserva trilha e cadastro, e não volta para a semente; os 30 checks fim-a-fim verdes; zero par de contraste reprovando no teste automático; nenhum alvo primário abaixo de 44px; `docs/lgpd.md` escrito; prints "depois" comparados com a baseline.
- **Fase 1** — "retornou" na trilha sem nenhuma remoção; busca acha por iniciais e diz quando não acha; fila com timer e contagem; "Pátio" aplicado dentro do orçamento de peso; wake lock ativo; alerta de restrição bloqueando as duas ações.
- **Fase 2** — papel e turma vindos da sessão, nunca da query string; "Entregar" exigindo o responsável; trilha gravando o adulto.
- **Fase 3** — interfaces esboçadas e acordadas com quem constrói o backend.

**Invariantes verificados a cada fase:** os 13. O modo demonstração, o arquivo único offline e o `prints.mjs` continuam funcionando ao fim de cada uma — são o plano B da visita.
