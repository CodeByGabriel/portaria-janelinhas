# Pente fino — noite de 05/09/2026

Pedido do dono: "prossiga com todas as fases que conseguir e no final rode um pente fino
para ver se encontra algum erro possível no projeto", seguido de testes manuais profundos
no navegador e de uma segunda passada em busca de erros de lógica. Este documento é o que
foi encontrado, o que foi corrigido, e o que ficou.

## Como foi feito

Quatro frentes, na ordem:

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
4. **Revisão do próprio diff da noite** (seção "Terceira passada"), porque cinquenta
   correções entram e alguma quebra outra coisa — e uma delas tinha quebrado.

Portões ao fim (depois das três passadas): `npm test` **243 + 109**, `typecheck`,
`fim-a-fim`, `telas`, `responsivo` **45/45**, `peso` **82,0 / 120 KB** — todos com código de
saída 0. Prints regenerados em `docs/prints/patio/`.

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

## Segunda passada — sondas executáveis (erros de lógica por execução)

Um segundo workflow (`wf_5bf494ed-d19`, 60 agentes, terminou inteiro): oito agentes
escreveram e **rodaram** sondas — fuzz da máquina de estados, propriedades da busca, CSV e
JSON malformados, cookies, matriz HTTP contra o servidor, cenários de WebSocket ao vivo,
fronteiras de tempo — e cada achado passou por dois verificadores (refutar e reproduzir).
27 achados brutos, 25 distintos, **23 confirmados**, 2 refutados. Tudo abaixo está
corrigido, com teste de regressão em `src/pente-fino-2.test.ts` e no bloco "segunda
passada" de `src/portaria.spec.ts`.

| Gravidade | Achado | Correção |
|---|---|---|
| **alta** | **A coluna Impedido falhava aberta**: só "sim" impedia; "Sim (ordem judicial)", "impedido", "bloqueado", "não pode buscar" viravam vínculo AUTORIZADO, sem erro. | "sim" e variantes impedem; vazio e "não" autorizam; qualquer outra coisa recusa a linha com o número — e o adulto daquela linha não entra. |
| **alta** | **Aspa sem fechar engolia o resto da planilha**: `Ana "Nina` abria um campo que só fechava no fim do arquivo; metade da escola sumia com um erro só ("nome longo demais"). | Aspa que não fecha até o fim é tratada como texto; o analisador repete a leitura ignorando aquela aspa. |
| **alta** | **Chamada esquecida atravessava a noite** quando o objeto ficava residente: a expiração só rodava na hidratação e no alarme diário, cuja hora era "a do primeiro boot + 24 h·n". | Expira a cada conexão nova (idempotente, barato) e o alarme cai às 03:00 de Brasília, reagendado em `finally` mesmo se a poda falhar. |
| média | Caracteres invisíveis (largura zero, hífen suave) e ligaduras passavam por `normalizar()`: "Ana​Souza" era outra criança que a busca por sobrenome não achava e o aviso de homônimo não via. | `normalizar` usa NFKD e apaga caracteres de formato, nas duas cópias (paridade testada); a importação apaga invisíveis e recusa caracteres de controle no nome. |
| média | Regex global com `.test()` em `responsaveis.ts`: um nome com `<` logo depois de uma linha recusada passava (lastIndex). | Regex sem `/g` para testar, com `/g` só para `.replace()`. |
| média | CSV com `\r` sozinho ("CSV (Macintosh)" do Excel) era recusado inteiro. | Quebras normalizadas antes de analisar. |
| média | Turma "1° ano" (sinal de grau), "Pré1", "1.º ano" recusadas com mensagem visualmente idêntica à turma válida. | `turmaDe()`: compara por chave (sem grau/ordinal/espaço/ponto). |
| média | `DELETE /delegacoes` com o id que o backend mandou não revogava quando a criação tinha reescrito o id (espaço, `<>`). | Id externo não é reescrito: precisa de limpeza, é recusado na criação; o DELETE valida igual. |
| baixa | Pelo WebSocket a sala ainda distinguia id inexistente de id de outra turma. | Mesma regra e mesma frase de `/alerta`: "aluno desconhecido". |
| baixa | `ACENTOS` com marcas combinantes cruas no fonte (o comentário dizia o contrário). | Escapes `\u` nas duas cópias. |
| baixa | Linha em branco antes do cabeçalho recusava a planilha com mensagem enganosa. | Linhas vazias iniciais puladas; numeração continua física. |
| baixa | `versao` aceitava 1e21 e 2^53+1 (colide com 2^53). | `Number.isSafeInteger`. |
| baixa | `instante()` aceitava 30/02, 24:00, +15:00, "05/09/2026" e RFC 2822 via `Date.parse`. | Forma ISO inteira conferida campo a campo, dia contra o mês real, deslocamento real. |
| baixa | Rotas de leitura respondiam a qualquer método (um `DELETE /alunos` devolvia o cadastro); `/ws` aceitava upgrade fora de GET. | 405 com `Allow: GET` nas leituras; guarda de método no `/ws` (o runtime entrega upgrades como GET, então a guarda é defensiva). |
| baixa | `POST /dispositivos` era a única rota JSON sem teto de corpo. | 64 KB, 413. |
| baixa | `/ws` aceitava qualquer `Origin`; a única defesa era o SameSite do cookie. | Origin presente precisa ter o host deste servidor (só o host: atrás do ngrok o Worker vê http e a página é https). |
| baixa | Sem teto de bytes por mensagem no WebSocket (32 MB eram parseados). | 4 KB; acima disso a conexão fecha com 1009. |
| baixa | `alarm()` que falhasse não deixava alarme agendado. | `finally`. |
| baixa | O cronômetro "há N min" só se corrigia a cada retrato. | O pong traz `em`; a tela corrige o relógio a cada batimento. |
| baixa | Comentário do `tokenDemoDe` e README diziam `3o-ano`; o token é `3-ano`. | Corrigidos. |
| baixa | Os comentários de `telas.mjs`/`prints.mjs` descreviam o gatilho do "Network connection lost" ao contrário (é o fechamento **limpo** de um socket que nunca falou; abrupto não dispara). | Comentários corrigidos; a tela manda um ping ao abrir, o que elimina o gatilho. |
| — | Das lacunas apontadas pela crítica: TOCTOU entre o teto de sessões e o `await` do handshake; BOM na frente do JSON; `Cache-Control` ausente nas leituras; referência de 8 hex ambígua no `DELETE /dispositivos`. | Impressão calculada antes do teto; BOM removido; `Cache-Control: no-store` em toda resposta do Durable Object; referência ambígua é 409 (e aceita até 64 hex). |

**Refutados:** um byte fora do UTF-8 fazer o arquivo inteiro ser lido como Windows-1252
(é o desenho, e é o certo para o Excel em ANSI); o "Network connection lost" no fechamento
limpo (é do runtime local, não do app).

**Ficou desta passada:** as lacunas da crítica que não são defeito — escritas de cadastro ao
vivo nunca sondadas com corpo válido (proibido para não derrubar a semente dos outros
agentes), `deposito.ts` quase inteiro sem sonda própria, escala de 90 dias no disco, vazão
sob carga, o cliente WebSocket real e as duas páginas só por teste manual, ngrok, nomes
hostis na tela (override bidi), acessibilidade por teclado. E o ambiente: o `wrangler dev`
4.128.0 morre com HTTP malformado ou com uma leva de conexões fechadas de forma abrupta —
um vigia em segundo plano o subiu de novo a cada queda.

## Terceira passada — revisão do que a própria noite mudou

Cinquenta correções entram e alguma quebra outra coisa. Esta passada reli o diff da noite
inteira (`git diff 4505027..HEAD`, 42 arquivos) e exercitou o que dava para exercitar.

**Um defeito encontrado, e era meu, de ontem à noite.** A correção da aspa sem par no CSV
tratava a aspa **ímpar** e deixava as **pares** se casarem entre si: trezentas aspas soltas
transformavam 301 linhas em 151 — metade da escola fundida, sem uma única mensagem. E a
releitura por aspa era quadrática: 1 MB cheio de aspas soltas travaria um Durable Object,
que atende um pedido por vez. Trocado pelas duas regras do RFC 4180 (a aspa só abre campo
no começo dele, e só se houver adiante uma que possa fechar), com a lista de fechamentos
calculada uma vez e ponteiro que só avança. Medido depois: 1 MB com 20 mil aspas soltas em
**156 ms**, com as 20 mil crianças importadas em vez de zero.

**Conferido e correto** (nesta ordem, com sonda quando possível):

- O envio no socket itera sobre uma cópia da lista, então fechar uma conexão dentro do laço
  não pula ninguém; a expiração por conexão roda antes de a sessão existir, então não
  transmite para um socket ainda não aceito.
- Datas nas bordas: 29/02 de ano bissexto passa e de ano comum não; milissegundo de um
  dígito, `-00:00` e fuso com minutos (+05:30) passam; `:99` de minuto e segundo 60 não.
- Janela da delegação inclusiva nas duas pontas, e fora dela por 1 ms já não conta.
- Poda da trilha em memória corta abaixo do corte, mantém o resto e preserva a ordem.
- Visibilidade: a portaria enxerga qualquer turma, a sala só a própria, e o ciclo completo
  segue intacto.
- No servidor: `Cache-Control: no-store` em toda resposta do Durable Object (com e sem
  identidade), leituras só por GET com `Allow: GET` (HEAD passa), `/entrar` ainda entregando
  o cookie HttpOnly + SameSite=Strict, `/sair` só por POST com cookie, `/ws` recusando
  origem de fora e aceitando sem `Origin`, BOM na frente do JSON aceito, e as três rotas do
  backend continuando fechadas ao cookie da portaria.
- Na tela: o batimento manda ping sozinho aos 30 s; o pong traz o instante do servidor; a
  rajada acima do teto fecha com `1008 mensagens demais` depois de exatamente 120 respostas
  e a tela reconecta (sem recarregar, porque não foi revogação); e um comando dado com o
  socket fechado mostra "Sem conexão com o servidor agora" em vez de sumir.
- **Migração do banco antigo**, que ninguém cobria: o esquema anterior à 2.1 (sem `razao`,
  sem `alerta`, sem responsável na trilha, sem a tabela de delegações) é montado com dados
  dentro e o objeto é obrigado a hidratar em cima dele. A lista da escola e a trilha
  sobrevivem, as colunas novas nascem vazias, o ciclo completo funciona e a delegação
  responde 422 (regra), não 500 (tabela faltando). Subir duas vezes seguidas também não
  quebra. Teste no spec.

**Escala medida** (uma escola de 292 alunos gera ~80 mil eventos em 90 dias):

| O quê | Com 80 mil eventos |
|---|---|
| Primeira resposta depois do reinício (inclui hidratar a trilha inteira) | 499 ms |
| `GET /trilha?limite=1000` (o caminho do backend) | 13 ms |
| `GET /registro` (a trilha inteira de uma vez) | 195 ms, **17,7 MB** |

`/registro` continua sem paginação. Nenhuma tela o consome — só as ferramentas de
verificação — e o caminho oficial para volume é o `/trilha` por cursor. Fica registrado: se
um dia uma tela precisar da trilha, ela precisa de página, não deste despejo.

**Teclado e foco nos diálogos**, outra lacuna da crítica: o diálogo de entrega é modal de
verdade (`:modal`), então o foco não escapa para a página atrás; todo botão habilitado recebe
foco e o adulto impedido fica fora da ordem de foco mas continua legível no fluxo; e, depois
de escolher o adulto, o foco vai para a primeira caixa de irmão em vez de ficar num botão que
sumiu. O que **não** dá para verificar neste navegador embutido é a tecla em si: Tab, Enter e
Escape simulados não chegam a um `<dialog>` modal — artefato da simulação, não do app, e o
mesmo motivo pelo qual o Escape "não fechava" ontem.

**E uma lacuna fechada de tabela:** nomes com **controles de direção** (bidi) entravam no
cadastro. `U+202E` inverte a exibição do que vem depois, então "Ana ‮aviuqS aeD" aparece na
tela como outro nome — numa lista em que a porteira escolhe pelo que lê, um nome que se
disfarça de outro é pior que um invisível qualquer. Os controles de direção e de isolamento
entraram na regex de invisíveis, nas três cópias, e viraram teste.

**Dois falsos positivos das minhas próprias sondas**, anotados para não voltarem: `18:00` no
fuso `+05:30` é 12:30 UTC, ou seja, passado — a recusa estava certa; e o 404 de rota
desconhecida não leva `no-store` porque é respondido pelo Worker, antes do Durable Object, e
não carrega dado de criança.

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
- **`wrangler dev` 4.128.0 caía sob carga** com um ERROR vazio e sugeria a 4.129.0. Atualizado
  para a 4.129.0 no fim da noite, com a suíte do workerd e os portões verdes; se ela ainda cair
  sob HTTP malformado ou rajada de fechamentos, é do runtime local, não do app.
- **Os 33 achados da rodada 1 que a verificação automática não alcançou** foram triados
  à mão (tabelas acima). A rodada 2, a rodada 3 e a crítica final não rodaram por causa
  do limite de uso. Vale repetir o workflow com o código de agora, de dia.
