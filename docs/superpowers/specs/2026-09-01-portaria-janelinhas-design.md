# Portaria Janelinhas — desenho

**Data:** 01/09/2026
**Estado:** aprovado, pronto para virar plano
**Vive em:** `projeto portaria janelinhas/` (dentro do repo Janelinhas do Saber)

## 1. O problema

Na saída, os pais se aglomeram no portão enquanto as crianças são chamadas por microfone.
Isso gera tumulto na porta e barulho para as turmas menores que ainda estão em descanso.
A escola não tem como saber, depois, quem entregou qual criança a quem.

O app troca o microfone por uma chamada silenciosa e dirigida: o responsável chega, a
portaria digita o nome, e **só a sala daquela criança** é avisada.

## 2. O recorte: isto é uma vitrine

O objetivo imediato é a escola dizer sim. O objetivo seguinte, tido como certo, é rodar de
verdade. Por isso a vitrine **não é descartável**: o núcleo do domínio, a máquina de estados
e a trilha de auditoria nascem no formato de produção. O que fica de fora é o que só faz
sentido com a escola dentro — autenticação real, consentimento por responsável, banco,
hospedagem.

Nenhum dado real de aluno entra neste projeto. Nem agora, nem depois de aprovado sem que a
parte de conformidade seja feita primeiro.

## 3. Domínio: os quatro estados

Uma criança percorre no máximo quatro estados por dia. Cada transição tem um dono claro.

| De | Para | Quem | Significado |
| --- | --- | --- | --- |
| `aguardando` | `chamado` | Portaria | Responsável chegou. A janelinha abre na sala |
| `chamado` | `liberado` | Professora | Ela confirma. A criança sai da sala |
| `liberado` | `entregue` | Portaria | Criança chegou no portão. Ciclo fechado |
| `chamado` | `aguardando` | Portaria | Cancelamento: nome errado, responsável desistiu |

Transições que **precisam falhar**, e cada uma tem teste próprio:

- `aguardando` para `liberado`. Liberar criança que ninguém chamou. É o erro perigoso do
  sistema: uma criança sairia da sala sem responsável no portão.
- `aguardando` para `entregue`, e `chamado` para `entregue`. Pular a professora.
- `liberado` para `aguardando`. A criança já saiu da sala; desfazer é mentira.
- Qualquer coisa a partir de `entregue`. Estado terminal do dia.

`estados.ts` é uma função pura sem dependência de rede, relógio ou armazenamento. Recebe
estado atual e ação, devolve estado novo ou erro. É o único lugar onde essa regra existe.

## 4. Arquitetura

Um Worker do Cloudflare com um Durable Object, seguindo a `ADR-A19` já decidida no repo.

```
src/
  index.ts       rotas HTTP, upgrade de WebSocket, serve os arquivos de web/
  portaria.ts    Durable Object: o estado vivo da escola e as conexoes abertas
  estados.ts     nucleo puro: a maquina de estados
  busca.ts       normalizacao e busca de nomes brasileiros
  semente.ts     alunos ficticios
  protocolo.ts   tipos das mensagens que trafegam no WebSocket
web/
  comum/         tokens.css, janelinha.js, avatar.js, som.js, ligacao.js
  portaria/      tela do celular da portaria
  sala/          tela da sala
  demo/          as duas lado a lado, sem rede
```

**Um Durable Object para a escola inteira**, não um por turma. Um objeto por turma só criaria
costura entre objetos sem nenhum ganho nessa escala, e a portaria precisa enxergar todas as
turmas ao mesmo tempo.

**Duas escalas, e elas não se confundem.** A vitrine roda com 32 alunos fictícios. O desenho
é dimensionado para o tamanho real de uma escola municipal — a reportagem do app de referência
mostra 292 alunos importados. Nessa ordem de grandeza o estado do dia cabe folgado na memória
de um único Durable Object, então a escolha continua correta quando os dados reais entrarem.

`wrangler dev` roda o Worker e o Durable Object localmente **sem conta na Cloudflare**. O
ngrok expõe a porta local para o celular. Um `wrangler deploy` no futuro publica o mesmo
código sem reescrita.

**Este projeto não entra no workspace pnpm do repo.** O nome da pasta tem espaços, e globs de
workspace com espaço são fonte conhecida de quebra em ferramenta de linha de comando. Ele é
autocontido, com `package.json` próprio, e usa **npm** — que já está instalado e não depende
da resolução de workspace. O repo raiz continua em pnpm para o agente de WhatsApp; os dois não
se falam.

## 5. Protocolo do WebSocket

O servidor **sempre transmite o retrato completo das chamadas ativas**, nunca deltas.

Isso é uma decisão de robustez, não de preguiça: com retrato completo, reconectar depois de
uma queda de wifi é automaticamente correto — o cliente recebe a verdade inteira e desenha.
Com deltas, uma mensagem perdida deixa a tela mentindo, e mentir sobre qual criança pode sair
é o pior defeito que este sistema pode ter.

Chamadas ativas são poucas — as crianças em saída naquele instante, não o cadastro inteiro.
O payload é pequeno mesmo na escala real.

Cliente para servidor: `chamar`, `liberar`, `entregar`, `cancelar`, cada um com `alunoId`.
Servidor para cliente: `retrato`, com a lista de chamadas ativas e um carimbo de tempo.

Cada conexão declara seu papel (portaria ou sala) e, no caso da sala, a turma. O servidor
filtra o retrato pelo papel: a tela da sala recebe apenas as chamadas da sua turma.

## 6. As três telas

**Portaria** (celular). Campo de busca em cima, resultados embaixo, um toque chama. Lista de
quem já foi chamado, com o estado de cada um. Botão de entregar quando a criança chega.
Janelinhas pequenas em lista — densidade alta.

**Sala** (tela ou tablet da professora). Vazia quase o dia todo. Quando chamam, **uma
janelinha grande, uma criança por vez**. Se duas forem chamadas juntas, enfileiram. Um toque
libera. Botão de mudo sempre visível.

**Demo** (`web/demo/`). As duas telas lado a lado numa página só, sem WebSocket, usando a
mesma máquina de estados em memória. Existe porque wifi de escola cai na hora da reunião.
Como a regra é a mesma dos dois lados, esta tela não pode divergir da real.

**Demo offline** (`web/demo-offline.html`, gerado por `npm run demo:offline`). O mesmo, mas
num arquivo único com CSS e scripts embutidos.

Isto não é redundância: `web/demo/` usa módulos ES, e **o navegador recusa carregar módulo
por `file://`** — ele só funciona servido. O arquivo único abre com duplo clique, sem
servidor e sem Node. São dois planos de contingência para duas falhas diferentes: o wifi da
escola cair, e o notebook não conseguir subir o `npm run dev` na hora.

## 7. Linguagem visual: a janelinha

O nome da escola é a mecânica. Cada criança é uma janelinha de moldura de madeira com quatro
vidros.

**Fechada**, os vidros são opacos: não se vê quem está atrás. **Chamada**, os dois batentes
giram para fora em 380ms e revelam o retrato. **Entregue**, a janelinha fecha de novo.

380ms é decisão, não estimativa. Abaixo disso o movimento não é percebido; acima de 500ms
vira estorvo na quadragésima vez do dia.

A grade nunca mostra rostos. Só a janelinha chamada abre. Isso é a decisão de privacidade
transformada em interface, não uma limitação de layout.

Cores em `web/comum/tokens.css`: moldura em âmbar quente, vidro em azul-céu, verde reservado
para `entregue`. As cores que dependem da marca real da escola ficam marcadas com `--_todo`
até a visita, seguindo a convenção que o repo já usa.

## 8. Som

Sintetizado com Web Audio, sem arquivo de áudio. Funciona offline e não adiciona peso.

- Abrir: duas notas quentes, cerca de 600ms.
- Entregue: um toque curto e seco.
- A portaria é muda. Som é da sala.

**Navegador não toca áudio antes do primeiro gesto do usuário.** A tela da sala portanto abre
com um botão "entrar na sala" que destrava o `AudioContext`. Sem isso, a primeira chamada da
apresentação sai muda — que é exatamente o momento que precisa funcionar.

## 9. Dados: ficção declarada

`semente.ts` gera 32 alunos fictícios, oito em cada uma de quatro turmas: Maternal, Jardim I,
Jardim II e 1º ano. Nomes brasileiros com acentuação real — Thaís, Gonçalves, Conceição —
para que a busca seja testada de verdade e não com nomes de laboratório.

Os nomes das turmas são chute fundamentado, não informação da escola: `conteudo/institucional/`
inteiro ainda é `TODO(visita)`. Ficam num único lugar do arquivo, fáceis de trocar quando a
visita disser quais são de verdade.

**Retratos são ilustrações determinísticas**, derivadas do hash do nome: formato de cabeça,
cabelo, olhos e cor de roupa escolhidos de paletas curadas. Simples e geométricos o bastante
para lerem como ilustração, nunca como foto.

Não geramos rostos fotorrealistas de crianças. Em produção, a escola sobe a foto que já tem
na matrícula, sob o consentimento que a fase de conformidade definir.

## 10. Privacidade por desenho

Decisões tomadas agora porque são caras de acrescentar depois:

- Um rosto por vez, só quando chamado. Nunca uma grade de rostos.
- A tela da sala vê apenas a própria turma. O filtro é no servidor, não no cliente.
- Toda transição gera uma linha em um registro **append-only**: quem, quando, de qual estado
  para qual. O registro não tem operação de edição nem de remoção.
- `.gitignore` já barra planilha, dump e material com dado real.

## 11. Como se prova que funciona

Portões automáticos, porque sem eles o loop vira o agente concordando consigo mesmo:

- `estados.ts`: toda transição válida aceita, toda inválida recusada, com atenção especial a
  `aguardando` para `liberado`.
- `busca.ts`: "Thaís" encontrada por `thais`, "Gonçalves" por `goncalves`, busca por
  sobrenome, busca com espaços sobrando. É onde busca de escola quebra na vida real.
- `protocolo.ts`: retrato serializa e desserializa sem perda.
- Reconexão: cliente derrubado volta e recebe retrato íntegro.
- `npm run typecheck` e `npm test`, no formato `node --test` que o repo já usa.

Depois de cada tarefa grande concluída, duas passagens adversariais: uma procurando o furo,
outra consertando e deixando teste de regressão.

## 12. Riscos conhecidos

**Espaço no nome da pasta.** `projeto portaria janelinhas` tem espaços. Wrangler, npm e
caminhos de script podem quebrar. É a primeira coisa a verificar, antes de escrever
qualquer funcionalidade — descobrir isso no meio do trabalho custa muito mais.

**Reconexão é o risco número um da demo**, não um refinamento de robustez. O retrato completo
já ataca isso por desenho; o cliente ainda precisa de retentativa com espera crescente.

**Áudio bloqueado pelo navegador.** Mitigado pelo "entrar na sala". Precisa de teste manual
em celular real antes da apresentação.

## 13. Explicitamente fora de escopo

Autenticação real (na vitrine escolhe-se o papel numa tela); consentimento LGPD por
responsável; banco de dados e backup; deploy em produção; relatórios e histórico de dias
anteriores; notificação ao responsável; múltiplas escolas.

Importação por planilha entra **em segundo lugar**, depois do núcleo funcionando: ela mata a
objeção "vai dar trabalho cadastrar todo mundo", mas não é o que faz o app existir.
