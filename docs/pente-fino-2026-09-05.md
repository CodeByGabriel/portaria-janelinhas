# Pente fino — noite de 05/09/2026

Pedido do dono: "prossiga com todas as fases que conseguir e no final rode um pente fino
para ver se encontra algum erro possível no projeto", seguido de testes manuais profundos
no navegador e de uma segunda passada em busca de erros de lógica. Este documento é o que
foi encontrado, o que foi corrigido, e o que ficou.

## Como foi feito

Três frentes, na ordem:

1. **Testes manuais no navegador embutido**, com dois aparelhos ao mesmo tempo (portaria em
   `localhost:8787`, sala em `127.0.0.1:8787` — jarros de cookie separados): ciclo completo,
   retorno com razão, cancelar, restrição, homônimas, irmãs, delegação, busca, volume e
   mudo, 320px nos diálogos.
2. **Workflow multiagente** (`wf_5a520c18-da6`): dez frentes de busca em paralelo
   (invariantes, autenticação, máquina de estados, persistência, front-end, importação,
   WebSocket, privacidade, ferramentas, testes), cada achado julgado por três verificadores
   independentes (refutar, reproduzir, impacto). A rodada 1 terminou (58 achados brutos, 47
   após deduplicação); a verificação parou no limite de uso da sessão depois dos primeiros
   quatorze. Os demais foram triados à mão, lendo o código, com o mesmo rigor: só entrou o
   que se aponta com arquivo e linha.
3. **Correções**, cada uma com teste de regressão onde a falha era de lógica.

Portões ao fim: `npm test` **225 + 100**, `typecheck`, `fim-a-fim`, `telas`, `responsivo`
**45/45**, `peso` **81,5 / 120 KB** — todos com código de saída 0.

## Corrigido — gravidade alta

| Achado | Onde | Correção |
|---|---|---|
| **Revogar um aparelho não alcançava o WebSocket já aberto.** A identidade era conferida uma vez no handshake e congelada; um tablet perdido com a tela aberta continuava recebendo cada criança da turma e liberando saída até a conexão cair sozinha — e a tela da sala reconecta sozinha. Contradizia "revogação imediata" do README e do LGPD. | `src/portaria.ts` | A conexão guarda a impressão do aparelho. `DELETE /dispositivos` derruba as conexões daquele aparelho na hora (`1008 aparelho revogado`), e cada mensagem reconfere o aparelho no depósito antes de agir. Teste: revoga com socket aberto e espera o fechamento. |
| **A delegação continuava válida depois que o titular que a autorizou perdia o direito** (saía do cadastro ou virava impedido na planilha seguinte). | `src/livro.ts` | `responsaveisDe` só considera a delegação se o titular ainda é responsável daquela criança e não está impedido. Testes nos dois casos. |
| **Irmãos chamados junto pulavam o alerta de restrição.** O "Chamar" da busca passava pela caixa; o atalho da entrega ("chamar junto") não. | `web/portaria/index.html` | Cada irmão com restrição passa por `podeSeguir` antes de ser chamado. |
| **Sem batimento na conexão**: wifi que caía sem fechar o socket deixava "conectado" na tela com o quadro parado, por minutos. | `web/comum/ligacao.js`, `src/portaria.ts` | A tela manda `ping` a cada 30 s; sem nenhuma mensagem em 75 s, fecha e reconecta. O servidor responde `pong` sem passar pelo Livro. Teste do ping. |

## Corrigido — gravidade média

| Achado | Onde | Correção |
|---|---|---|
| `descartar()` por `body.cancel()` **nunca evitou** o "Can't read from request stream after response has been sent": toda resposta antecipada com corpo (405, 403, 401, 429) e toda rota que ignora o corpo geravam exceção não tratada no log. | `src/portaria.ts` | `fetch()` do Durable Object drena o corpo não lido antes de responder; `descartar` lê pedaço a pedaço. Conferido no log do `wrangler dev`: zero erros em seis casos que antes davam um cada. |
| JSON com bytes fora de UTF-8 era guardado como U+FFFD em silêncio ("avó" em Latin-1 virou "av�" numa delegação). | `src/portaria.ts` | Decodificação estrita em todas as rotas JSON: 400. Teste com bytes Latin-1 em `/delegacoes`, `/cadastro` e `/entrar`. |
| Poda de 90 dias apagava do disco e a trilha em memória seguia inteira até o reinício; `/registro` divergia do disco. | `src/livro.ts`, `src/portaria.ts` | `Livro.podarTrilha` pelo mesmo corte, chamado no `alarm()`. Teste do alarme: poda disco, memória e delegação vencida. |
| `push(...trilha)` na hidratação estoura a pilha acima de ~125 mil eventos, dentro do `blockConcurrencyWhile` — o objeto não subiria mais. | `src/livro.ts` | Laço. Teste com 300 mil eventos. |
| Se a gravação em disco falhasse depois de `livro.aplicar`, a memória ficava à frente do disco e a recusa mentia. | `src/portaria.ts` | Falha ao gravar ressincroniza a memória a partir do disco e recusa com "não consegui gravar; tente de novo". |
| `/sair` aberto a qualquer método sem autenticação: um link (ou `<img src="/sair">`) apagava o cookie do tablet. | `src/portaria.ts` | Só POST, só com cookie presente. Teste. |
| Oráculo para a sala: `/alerta` e `/responsaveis` respondiam 404 para criança inexistente e 403 para criança de outra turma, e a recusa do WebSocket dizia **qual** turma. | `src/livro.ts`, `src/portaria.ts` | `Livro.alunoVisivelPara` (regra num lugar só, invariante 8): para a sala, ambas viram 404 com o mesmo texto; a recusa diz "outra turma" sem o nome. Testes. |
| Sem teto de mensagens por conexão: uma aba em laço saturava o objeto. | `src/portaria.ts` | 120 mensagens em 10 s derruba a conexão (`1008 mensagens demais`). Teste com rajada de 150. |
| Limitador do `/entrar` bloqueava o token certo e chaveava a escola inteira (um NAT) num balde de dez. | `src/portaria.ts` | Trinta falhas por origem, e **só para o token errado**: o certo passa sempre. Testes ajustados. |
| Reusar o id de uma delegação para outra criança sobrescrevia a primeira em silêncio. | `src/livro.ts` | Recusa ("já usado para outra criança"); para a mesma criança continua idempotente. Teste. |
| Id de delegação com mais de 54 caracteres gerava `responsavelId` acima do teto do WebSocket: criava mas não entregava. | `src/ecossistema.ts` | Teto próprio (`LIMITE_ID_DELEGACAO`). Teste. |
| Data de delegação sem fuso era lida como UTC: "válido até 18h" vencia às 15h de Brasília. | `src/ecossistema.ts` | Fuso obrigatório (`Z` ou `-03:00`); sem ele, 422. Teste. |
| Hash de 32 bits sem detecção de colisão: dois nomes diferentes podiam virar a mesma criança (ou o mesmo adulto). | `src/importar.ts`, `src/responsaveis.ts` | Colisão vira erro de linha nomeado. Testes acham uma colisão real por busca pseudoaleatória e conferem. |
| Linha repetida (mesmo nome, mesma turma) sumia como "+1 duplicado" sem dizer qual — duas crianças homônimas na mesma turma desapareciam uma na outra. | `src/importar.ts` | Volta como erro com o número da linha e a sugestão de acrescentar sobrenome. Teste. |
| Texto separado por TAB (o que o Excel cola) era recusado como "precisa das colunas Nome e Turma". | `src/importar.ts` | TAB detectado. Teste. |
| Razão do retorno vinha **pré-marcada** ("esqueceu material"): o registro diria isso para toda professora que só tocasse em confirmar. | `web/sala/index.html` | Nenhuma marcada; "Confirmar" desabilitado até escolher; foco vai para a pergunta. |
| Grade de razões vazava em 320px (`1fr 1fr` deixa o rótulo mais longo ditar a largura). | `web/comum/tokens.css` | `minmax(0, 1fr)` e coluna única abaixo de 480px. |
| Toque duplo em "Liberar", "Chamar" e "Entregar" abria duas caixas e mandava comando repetido. | sala e portaria | Botão desabilitado enquanto pergunta. |
| Comando com o WebSocket fechado era descartado em silêncio. | sala, portaria, `ligacao.js` | `mandar()` avisa na tela quando não deu. |
| Cartões da sala nunca eram reordenados: "chamar de novo" reinicia o `desde`, e a criança ficava fora de ordem. | `web/sala/index.html` | Reordena por `desde` movendo só quem está fora do lugar (o nó sob o dedo é o mesmo). |
| Porta com título escondido atrás da tarja de demonstração (o print versionado documentava isso). | `web/comum/porta.js` | A porta desce o tanto que a tarja mede, e só quando há tarja. |
| A porta dizia "código não reconhecido" para 429 e travava em "Verificando…" com a rede fora. | `web/comum/porta.js` | Mensagens próprias para "aguarde N min" e "sem rede". |
| `telas.mjs` devolvia a restrição da semente sem aspas no CSV (texto com vírgula chegava truncado). | `ferramentas/telas.mjs` | Campo entre aspas quando tem vírgula ou aspas. |
| Fonte Fraunces recortada pela amostra do cabeçalho não tinha `z`, `Q`, `v`, `?` — e agora desenha títulos de diálogo. | `ferramentas/subsetar-fontes.mjs` | Recorte por intervalo (latim básico + acentos do português + pontuação tipográfica): 23,5 KB. |
| Perfil do Chrome das ferramentas podia ficar no repositório. | `.gitignore` | `/.responsivo-perfil/` e `.perfil/`. |
| `docs/lgpd.md` descrevia o sistema anterior à 2.1 e à fase 3. | `docs/lgpd.md` | Inventário com responsáveis, delegações, aparelhos, exportação da trilha, revogação da conexão aberta. |

## Corrigido — gravidade baixa

Duas recargas do cadastro em paralelo podiam deixar a lista com a resposta mais antiga
(só a última escreve); o timer do aviso anterior apagava o novo; foco perdido ao abrir a
lista de irmãos; comentário em `portaria.ts` dizendo "não há autenticação" numa rota que
exige aparelho; README e plano dizendo que o `/entrar` não tem limitador; referência de
linha errada no LGPD; `/importar-responsaveis` lia o corpo sem `try`; turma em NFD recusada
pela API; `alarm()` sem nenhum teste (agora tem); `baseline.mjs` quebrado desde a 2.2
(removido com o script — a medição de então continua em `docs/baseline.md`).

## Verificado e descartado

- **Escape não fecha o `<dialog>`** no navegador embutido: reproduzido num `<dialog>` puro
  sem nenhum código do app — é o simulador de teclado do painel, não o app.
- **Cartão pálido na sala**: era a animação de entrada, pausada enquanto a aba estava em
  segundo plano.
- **"0 responsáveis chegaram"**: texto de um elemento já oculto.
- **Semeadura de demonstração com `await` entre escritas**: refutada pelos verificadores
  (o caso só existe com `MODO_DEMO`, e um boot interrompido é reiniciado pelo próprio
  runtime).

## Ficou

- **A sala lê o texto da restrição de qualquer criança da própria turma** a qualquer
  momento (`/alerta`), não só quando está prestes a agir. É por desenho: a caixa precisa
  do texto antes de liberar. Fica registrado como escolha, não como defeito.
- **Testes com esperas fixas** (300/400 ms) e `ateQue` cujo `false` é ignorado em um
  teste: fragilidade em máquina lenta, não defeito do app. Não mexi para não mascarar.
- **`LIMITE_SESSOES` (503) e `/importar-responsaveis` (405/413)** continuam sem teste de
  unidade.
- **Em desenvolvimento, todas as origens caem no mesmo balde do limitador** ("desconhecida",
  porque não há `CF-Connecting-IP`); com trinta falhas e o token certo sempre passando,
  isso deixou de atrapalhar.
- **`wrangler dev` 4.128.0 cai sob carga** com um ERROR vazio e sugere a 4.129.0. Não
  atualizei no meio da noite; é uma linha no `package.json` para conferir de dia.
- **Os 33 achados da rodada 1 que a verificação automática não alcançou** foram triados
  à mão (tabelas acima). A rodada 2, a rodada 3 e a crítica final não rodaram por causa
  do limite de uso. Vale repetir o workflow com o código de agora, de dia.
