# Base de conformidade — LGPD

**Este documento não é parecer jurídico.** Ele é o inventário técnico do que o sistema
coleta, onde guarda, por quanto tempo e quem alcança — escrito pela engenharia, a partir
do código, para que um advogado tenha o que analisar. **Nenhum dado real de aluno deve
entrar no sistema antes de revisão jurídica e da decisão da escola sobre a base legal.**

Atualizado em 02/09/2026 (a `razao` entrou na 1.1; a autenticação por aparelho, na 2.2). Cada afirmação aponta o arquivo que a sustenta; quando o código
mudar, este documento mente até ser atualizado junto.

---

## 1. Quem é quem

| Papel na LGPD | Quem | Por quê |
|---|---|---|
| **Controladora** | A Escola Janelinhas do Saber | Ela decide que a saída será organizada assim, quais alunos entram na lista e quem opera as telas. As decisões sobre finalidade e meios são dela. |
| **Operador** | Quem mantém este aplicativo | Trata os dados **em nome da** escola e seguindo as instruções dela. Não usa o dado para nada próprio, não cruza com outra base, não compartilha. |
| **Titulares** | Os alunos | Crianças e adolescentes, do Pré 1 ao 9º ano. Art. 14 — tratamento no **melhor interesse** da criança. |
| **Suboperador** | Cloudflare | Hospeda a execução e o armazenamento. Ver §6. |

Um **contrato de operador** entre a escola e quem mantém o app precisa existir antes do
primeiro dado real, fixando por escrito: finalidade, instruções, prazo, devolução ou
eliminação ao fim, e obrigação de reportar incidente. `TODO(juridico)`

---

## 2. Finalidade

Uma só: **organizar a saída dos alunos com segurança**, avisando a sala quando o
responsável chega ao portão e registrando quem liberou e quem entregou cada criança.

Fora da finalidade — e portanto proibido sem nova base legal e novo consentimento:
frequência, pontualidade, comportamento, relatório para os pais, qualquer forma de
avaliação de aluno ou de funcionário a partir da trilha.

---

## 3. O que é coletado, exatamente

Levantado de `src/deposito.ts:33-68`. Não há outro lugar onde o sistema grave dados.

### `cadastro` — quem pode ser chamado
| Campo | Conteúdo | Origem |
|---|---|---|
| `id` | Derivado do nome normalizado + turma (`src/importar.ts:162`) | Calculado |
| `nome` | Nome do aluno | Planilha da secretaria |
| `turma` | Pré 1 … 9º ano | Planilha da secretaria |

**Duas colunas. É o mínimo que faz o sistema funcionar** e é o padrão, não uma opção.
Não há data de nascimento, endereço, CPF, telefone, matrícula, foto, responsável,
observação médica ou qualquer outro campo — a importação lê `Nome` e `Turma` e ignora o
resto da planilha (`src/importar.ts:185-203`).

> ⚠️ O `id` é derivado do nome. Ele **não é anônimo**: dois sistemas com a mesma regra
> chegam ao mesmo `id` para a mesma pessoa. Trate o `id` como dado pessoal.

### `cadastro.alerta` — a restrição, quando a escola registra uma

Coluna **opcional** da planilha (`Restrição`, `Observação`, `Alerta` ou `Guarda`).
Texto livre, até 300 caracteres, filtrado contra marcação como o nome. É a informação
mais sensível que este sistema toca: guarda compartilhada, decisão judicial, quem pode e
quem não pode levar a criança.

Três decisões que a tornam tratável:

**O texto nunca sai em lote.** `/alunos` entrega o cadastro inteiro ao navegador — já é
minimização ao contrário (§6). Com a anotação dentro, cada tablet da portaria carregaria
**em repouso** a situação familiar da escola toda, e uma tela esquecida no balcão passaria
a expor guarda e conflito de 292 famílias em vez de nome e turma. O que viaja na lista é
um booleano (`temAlerta`); o texto sai por `/alerta`, **uma criança por vez**, no
instante em que alguém está prestes a chamar ou liberar. O texto não existe dentro do tipo
`Aluno`, então não há o que esquecer de remover.

**A sala só lê a da própria turma.** Mesma regra da leitura e da escrita. Sem ela, a sala
do Pré 1 varreria os ids e leria a anotação de guarda da escola inteira.

**Ela vive no cadastro, e não na trilha** — e por isso, ao contrário da `razao`, ela TEM
caminho de correção e de eliminação: a próxima planilha substitui ou apaga. Uma anotação
errada, ou que deixou de valer porque a decisão judicial mudou, sai com a reimportação.
É a diferença que permite texto livre aqui e não lá.

> ⚠️ Isto é **alerta, não autorização**. O sistema não sabe quem está no portão — ele não
> pode decidir, só pode garantir que quem decide leu. A verificação de verdade ("não
> entregar a X") depende do modelo de responsáveis, que é Fase 2. `TODO(fase2)`

### `responsaveis` e `vinculos` — quem pode levar cada criança

Entraram na 2.1, e são **dado pessoal de adulto**, que o sistema não tratava até aqui.

| Tabela | Campos |
|---|---|
| `responsaveis` | `id` (derivado do nome), `nome`, `vinculo` (mãe, pai, avó…), `telefone` |
| `vinculos` | `alunoId`, `responsavelId`, `impedido` |

**O telefone é opcional e a escola decide se o preenche.** A planilha funciona sem ele; a
coluna existe porque a portaria às vezes precisa ligar para confirmar. Não há foto, não há
documento, não há endereço.

**O impedimento vive no par, não na pessoa.** "O pai não busca" é uma frase sobre uma
dupla: o mesmo adulto pode estar impedido de levar um filho e autorizado a levar outro, e
é exatamente assim que decisão judicial costuma ser escrita. Guardar no adulto obrigaria a
duplicar a pessoa, e a duplicata sairia de sincronia.

**Substituição, nunca mesclagem.** A planilha é a verdade da escola. Um vínculo que sumiu
dela sumiu porque alguém o tirou — mesclar deixaria autorizações antigas vivas para
sempre, e revogar dependeria de lembrar de fazer isso em outro lugar.

**Poda automática de órfãos.** Toda importação de alunos recalcula os ids a partir de
nome + turma, e os vínculos da criança que mudou de turma passam a apontar para ninguém. O
sistema poda e **diz quantos** — porque sem o aviso a escola perderia a exigência de
"a quem" no dia da virada de bimestre, sem nenhum sinal na tela. Responsável que ficou sem
nenhuma criança também sai: guardar nome e telefone de um adulto que não busca ninguém é
guardar dado pessoal sem finalidade.

> ⚠️ **A trilha passou a gravar o nome do adulto que recebeu a criança**, e ele herda os 90
> dias de retenção. É o registro que responde "a quem", que é metade da razão de o sistema
> existir — mas é também um histórico de quem foi ao portão, e isso precisa constar do
> aviso de privacidade dado às famílias. `TODO(juridico)`

### `chamadas` — quem está saindo agora
`alunoId`, `nome`, `turma`, `estado`, `desde`, `em`. Some quando o ciclo fecha.

### `trilha` — o registro do que aconteceu
`alunoId`, `nome`, `turma`, `acao`, `papel`, `origem`, `de`, `para`, `em`, `razao`.

**`razao` é a única coluna que descreve uma situação, e não uma transição** — por isso
ela recebeu tratamento próprio. Ela só é preenchida na ação `retornar` (a criança foi
liberada e voltou para a sala), e só aceita um destes quatro **códigos**, validados no
servidor (`src/estados.ts`, `RAZOES_RETORNO`):

| Código | O que significa |
|---|---|
| `esqueceu-material` | Voltou buscar algo |
| `nao-saiu-com-o-responsavel` | O responsável não estava, ou não levou |
| `a-escola-reteve` | Decisão da escola |
| `outro` | Qualquer outra coisa — sem detalhe |

Três decisões deliberadas, que precisam sobreviver a quem vier depois:

**Lista fechada, nunca texto livre.** Uma professora sob pressão, com a turma esperando,
escreveria qualquer coisa num campo aberto — inclusive informação de saúde ou de conflito
familiar. E a trilha **não tem caminho de correção**: `registrar()` só faz INSERT, e a
única remoção é a poda da linha inteira; zerar um campo mantendo o evento seria UPDATE,
que o desenho append-only proíbe. O que entrar ali fica os 90 dias, sem conserto — então
o argumento "guardamos pouco tempo" não está disponível aqui.

**Código, não frase.** Renomear o rótulo na tela não pode reescrever o passado.

**Não há categoria de saúde.** "A criança passou mal" foi a primeira ideia e está fora:
seria dado sensível (art. 11) de titular criança, agrupável por aluno ao longo de 90
dias, e o §2 deste documento já proíbe usar a trilha para avaliar aluno. O detalhe
clínico fica no livro de ocorrência da escola, em papel. O buraco do `outro` é real e
assumido: é o preço de não coletar.

É **append-only**: não há edição nem remoção, por decisão de projeto — um registro de
entrega de criança que pode ser reescrito não serve para nada. Correções entram como
evento novo. A única remoção prevista é a poda por prazo (§5).

`origem` guarda **qual sala** agiu, não qual pessoa. Enquanto não houver login
(Fase 2), o sistema **não sabe qual funcionária** operou — apenas o papel e a sala. Isso
é uma limitação real e precisa ser dita à escola: a trilha responde "a sala do 3º ano
liberou", não "a professora Fulana liberou".

### O que o sistema NÃO coleta
Nenhum dado do responsável que busca (nome, documento, foto, parentesco) — isso é
Fase 2 e depende de decisão de base legal. Nenhuma geolocalização. Nenhuma imagem de
câmera. Nenhum áudio. Nenhum dado de dispositivo além do necessário para a conexão.
Não há `console.log` de nome de aluno em nenhum ponto do servidor (verificado em `src/`).

### Retratos
Os rostos na tela são **ilustrações planas geradas do nome** (`web/comum/avatar.js`),
determinísticas e não fotorrealistas. Nenhuma foto de aluno é armazenada, transmitida ou
exibida. Se a escola quiser usar as fotos da matrícula, isso é **decisão nova, com base
legal própria** — não uma configuração.

---

## 4. Base legal — a decisão que falta

Os titulares são crianças e adolescentes, então vale o **art. 14**.

**Para crianças (até 12 anos incompletos):** o art. 14 §1º exige **consentimento
específico e em destaque, dado por pelo menos um dos pais ou responsável legal**. Não
serve consentimento genérico embutido no contrato de matrícula; precisa ser específico
para esta finalidade e destacado.

**Para adolescentes (12 a 18):** a escola vai até o 9º ano, então há adolescentes na
base. A LGPD é menos explícita aqui; a leitura predominante da ANPD é que o melhor
interesse do art. 14 *caput* se aplica a ambos. Decidir com o jurídico se o consentimento
do responsável basta ou se o adolescente também participa.

**Alternativa a considerar:** parte da doutrina sustenta que controle de saída escolar é
**cumprimento de obrigação legal** (art. 7º, II — dever de guarda da escola) ou
**proteção da vida e da incolumidade física** (art. 7º, IV), que dispensam consentimento
e são mais robustos, porque consentimento pode ser revogado a qualquer momento — e uma
família que revoga o consentimento tira o filho do sistema no meio do turno.

**Esta escolha é do jurídico, não da engenharia.** Ela muda o produto: com consentimento,
o sistema precisa de um jeito de registrar, revogar e excluir por família; com obrigação
legal, não precisa. `TODO(juridico)`

Enquanto não houver decisão: **semente fictícia declarada**, nunca dado real.

---

## 5. Retenção

**Trilha: 90 dias**, podada diariamente por `alarm()` (`src/portaria.ts:21,81-82`).

Noventa dias cobrem um bimestre inteiro com folga — tempo de uma família contestar uma
entrega e a escola conseguir responder — sem virar um arquivo permanente de quem buscou
quem, todos os dias, por anos.

> ⚠️ **A `razao` herda esses 90 dias e não tem exceção.** As outras colunas descrevem uma
> transição de estado; `razao` descreve uma situação da família ("não saiu com o
> responsável"). Acumulada por aluno ao longo de um trimestre, ela permite exatamente o
> tipo de leitura que o §2 proíbe. É por isso que ela é lista fechada e sem categoria de
> saúde — a mitigação é o **domínio**, já que o prazo não pode ser menor sem quebrar o
> append-only.

**Cadastro:** vive enquanto a escola o mantiver. Sai quando a secretaria importa uma
planilha nova sem aquele aluno (`trocarCadastro` substitui o cadastro inteiro).

**Chamadas:** minutos. Somem quando o ciclo fecha.

> ⚠️ **Pendência:** a poda apaga sem exportar. Se a escola precisar guardar mais de 90
> dias por alguma exigência própria, isso tem que ser exportação **antes** da poda, e não
> existe ainda. `TODO(fase1)`

---

## 6. Onde o dado fica, e quem alcança

**Cloudflare Durable Object com SQLite**, uma instância só, `idFromName('escola')`
(`src/index.ts:15`).

> ⚠️ **O código não fixa região.** Sem `locationHint`, a Cloudflare cria o objeto perto
> de quem primeiro o acessa — o que na prática deve ser o Brasil, mas não é garantido, e
> o dado pode acabar fora do país. Transferência internacional tem regras próprias
> (art. 33). Mitigação barata: `env.PORTARIA.get(id, { locationHint: 'sam' })`. Não foi
> aplicada porque muda latência e é decisão da escola/jurídico, não da engenharia.
> `TODO(juridico)`

**Quem alcança o dado hoje:**

| Quem | Alcance |
|---|---|
| Portaria | O cadastro **inteiro** e a trilha inteira, `razao` incluída |
| Sala | Só as chamadas da **própria turma**, filtrado no servidor, na leitura e na escrita |
| Qualquer um com o link | **Nada.** Sem aparelho autorizado, toda rota responde 401 |

> ✅ **Fechado na 2.2.** O papel vinha da *query string* (`?papel=portaria`), o que nunca foi
> autenticação: era uma etiqueta que o cliente colava em si mesmo, e quem soubesse o
> endereço via o cadastro inteiro. Agora a escola emite um **token por aparelho**, ele é
> colado uma vez e vira um cookie `HttpOnly` + `SameSite=Strict` que o JavaScript da
> página não alcança. Revogar tem efeito imediato — aparelho perdido às 15h não chama
> criança às 15h05.
>
> Emitir aparelho exige uma **chave de administração** que é segredo do Worker e não
> existe em tela nenhuma: um tablet roubado da portaria não fabrica mais aparelhos. Ele
> consegue *revogar* — escolha deliberada, porque a alternativa faria a escola depender de
> achar um notebook no dia em que um aparelho some. Sabotagem se desfaz emitindo de novo;
> aparelho perdido que continua valendo, não.
>
> **O que isso NÃO resolve:** o app continua sem saber *qual pessoa* está operando — sabe
> qual aparelho. A trilha responde "o tablet da sala do 3º ano liberou", não "a professora
> Fulana liberou". Identidade de pessoa é outra decisão, e ela não é necessária para subir
> dado real.

> 🟡 **Minimização ao contrário.** `/alunos` entrega **o cadastro inteiro ao navegador**
> e a busca roda no cliente (`src/portaria.ts:120-123`). Foi escolha de latência —
> resposta instantânea sem ida ao servidor a cada tecla — mas significa que o aparelho da
> portaria tem uma cópia local de todos os alunos da escola, e que qualquer falha de
> acesso àquela tela expõe a lista toda em vez de um resultado de busca. Corrigir movendo
> a busca para o servidor. `TODO(fase1)`

---

## 7. Direitos do titular

O art. 18 dá ao titular (aqui, à família) direito a confirmação, acesso, correção,
anonimização, portabilidade, eliminação e informação sobre compartilhamento.

**Como responder hoje, na prática:**

| Pedido | Como | Estado |
|---|---|---|
| Acesso | A portaria abre `/registro` e filtra pelo aluno | Manual, funciona |
| Correção do nome | Nova importação da planilha corrigida | Funciona; o `id` muda junto, porque deriva do nome |
| Eliminação do cadastro | Importar sem aquele aluno | Funciona |
| Eliminação da trilha | **Não é possível hoje**, por projeto | Ver abaixo |
| Eliminação só da `razao` | **Não é possível**, e não é descuido | Seria UPDATE numa tabela append-only. É a razão de ela ser lista fechada |
| Portabilidade | Não existe exportação por aluno | `TODO(fase1)` |

> ⚠️ **A trilha é append-only e isso conflita com o art. 18, VI.** É uma tensão real, não
> um descuido: um registro de entrega de criança que pode ser apagado a pedido perde a
> função de prova. A saída usual é sustentar a retenção pelo art. 16, I (cumprimento de
> obrigação legal ou regulatória) ou pelo art. 7º, IV, e eliminar no prazo dos 90 dias.
> **Precisa de posição jurídica antes do primeiro dado real.** `TODO(juridico)`

**Canal de atendimento:** a escola precisa nomear um **encarregado (DPO)** e publicar um
contato. Não existe ainda. `TODO(juridico)`

---

## 8. Segurança e incidentes

**O que já protege:**

- Papel **fail-closed**: papel inválido não conecta, e o erro aparece na tela em vez de
  virar acesso ampliado em silêncio.
- Filtro de turma no **servidor**, na leitura **e** na escrita — a sala do 3º ano não
  libera aluno do 9º nem por mensagem forjada.
- Nome de aluno nunca vai para `innerHTML`; a planilha é colada pela secretaria e um nome
  com marcação viraria código na tela.
- Teto de 1 MB no corpo da importação e de 200 sessões simultâneas.
- Nenhum dado real de aluno no repositório: a semente é ficção declarada.

**O que ainda não protege:** autenticação (§6). Enquanto ela não existir, todo o resto é
tranca em porta aberta.

**Plano de incidente** (art. 48): quem mantém o app avisa a escola **em até 24 horas** do
que souber, com o que aconteceu, quais dados, quantos titulares e o que já foi feito. A
escola, como controladora, decide sobre comunicação à ANPD e às famílias, em prazo
razoável. Isso precisa estar no contrato de operador, não só aqui. `TODO(juridico)`

---

## 9. O que precisa acontecer antes do primeiro dado real

1. Decisão da base legal (§4) — **bloqueante**
2. Contrato de operador assinado (§1) — **bloqueante**
3. ~~Autenticação por dispositivo~~ — **feito na 2.2**
4. Encarregado nomeado e contato publicado (§7)
5. Aviso de privacidade específico, entregue às famílias
6. Decisão sobre região do armazenamento (§6)
7. Exportação antes da poda, se a escola precisar de mais de 90 dias (§5)
8. Revisão jurídica das quatro razões de retorno (§3) — o domínio inteiro cabe numa
   tabela e pode ser lido antes de existir uma linha, que é exatamente o ponto

Os três primeiros não são recomendação. Com qualquer um deles em aberto, o sistema roda
com a semente fictícia e mais nada.
