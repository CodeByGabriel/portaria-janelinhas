# Fase 3 — Interfaces com o ecossistema (esboço para acordar)

Estado: **proposta**, nada aqui está implementado. Os tipos vivem em
`src/ecossistema.ts` e passam no `typecheck` contra os tipos reais do satélite.
O que fica decidido aqui vira código só depois do acordo com quem constrói o
backend (NestJS/PostgreSQL, Better Auth, portal de pais).

## Papel do satélite

O app da portaria continua sendo um **serviço satélite**: Workers + Durable Object,
tempo real, com a máquina de estados e a trilha dele. O backend é a fonte do
cadastro e o destino da trilha. Nenhum dos quatro contratos abaixo muda isso, e
nenhum deles relaxa os invariantes: só a criança chamada na tela, sala filtrada
nos dois sentidos, papel fail-closed, trilha append-only, retrato completo.

Todos os contratos backend→satélite usam **`Authorization: Bearer <CHAVE_ADMIN>`**,
o mesmo segredo que já protege `/dispositivos`, comparado em tempo constante.
Um segredo só entre dois sistemas; nada de cookie de aparelho aqui.

---

## 3.1 Cadastro por API (substitui a planilha)

| | |
|---|---|
| **Rota** | `PUT /cadastro` (backend → satélite), JSON, corpo ≤ 1 MB |
| **Corpo** | `CadastroCompleto` — alunos, responsáveis e vínculos numa chamada só |
| **Resposta** | `RespostaCadastro` |
| **Leitura** | `GET /cadastro/versao` → `{ versao }`, para o backend conferir o que está vigente |

**Substituição completa e atômica**, como a planilha hoje. Não há PATCH por aluno:
um cadastro meio trocado é pior que o cadastro antigo inteiro.

**A mudança que importa: o id vem do backend.** Hoje o satélite deriva o id de
nome+turma, e uma criança que muda de turma vira outro id — é isso que orfana os
vínculos e obriga a portaria a reimportar duas planilhas. Com id estável vindo de
fora, `vinculosPerdidos` deixa de existir no caminho da API.

Códigos:

- `200` `trocado: true` — aplicado e transmitido a todas as telas.
- `200` `trocado: false` — mesma `versao` já vigente; repetir é idempotente.
- `409` — `versao` menor que a vigente, **ou há criança em saída agora**. Este
  segundo caso é o mesmo de hoje: trocar o cadastro no meio de uma saída sumiria
  com a criança de todas as telas. O backend tenta de novo; sincronizar fora do
  horário de saída resolve na prática.
- `413` / `422` — corpo grande demais / nenhum aluno válido. `erros` explica, até
  100 itens.

**A planilha não morre.** `/importar` e `/importar-responsaveis` ficam como plano B
da visita e da escola sem backend — deixam de ser o caminho principal.

---

## 3.2 Trilha → LogAuditoria

| | |
|---|---|
| **Rota** | `GET /trilha?apos=<seq>&limite=<n≤1000>` (backend puxa) |
| **Resposta** | `PaginaDaTrilha` — `eventos: LogAuditoria[]`, `proximo` |
| **Cursor** | `seq`, o AUTOINCREMENT que a tabela `trilha` já tem |

O backend guarda o último `seq` que recebeu e pede "o que veio depois". Como a
trilha é append-only e `seq` é monotônico, a entrega é *at-least-once* com
deduplicação exata: receber duas vezes é inofensivo, pular é impossível.

**Nome e campos do `LogAuditoria` são proposta** — o formato real é do backend, e
eu não o vi. O que não negocia, porque é o que a trilha promete:

- `seq`, e `em` em ms + `quando` em ISO 8601 UTC;
- `de` → `para` (a transição, não só o estado final);
- `ator.papel` e `ator.origem` (qual sala, ou `portaria`);
- `razao` como **código**, nunca frase — renomear um rótulo não reescreve o passado;
- `responsavel` com id **e** nome — o nome porque a trilha precisa continuar legível
  depois que o cadastro for substituído.

**Retenção:** a poda diária de 90 dias (decisão 1 do plano) continua. O backend
precisa puxar antes disso — uma vez por dia basta, e o cursor torna qualquer atraso
recuperável enquanto os 90 dias não vencem.

---

## 3.3 Delegação "hoje a avó busca"

| | |
|---|---|
| **Rotas** | `POST /delegacoes` cria; `DELETE /delegacoes/:id` revoga (backend → satélite) |
| **Corpo** | `Delegacao` — aluno, quem busca, validade, quem autorizou |
| **Na portaria** | aparece dentro de `/responsaveis` como `ResponsavelTemporario`, marcada "hoje" |

O portal de pais é quem cria: um titular autoriza um adulto para uma janela de
tempo (padrão: até o fim do dia). O backend empurra para o satélite; o satélite só
guarda e mostra. A escolha continua sendo da porteira, no diálogo de entrega, com
o adulto temporário marcado e o nome de quem autorizou ao lado.

Regras, todas fail-closed:

- **Impedido vence.** Delegação para alguém que está `impedido` para aquela criança
  (mesmo nome normalizado) é recusada na criação, `422`. Um portal não pode
  desfazer uma decisão judicial por engano.
- Aluno desconhecido, `validoAte` no passado, janela invertida: `422`.
- Vencida, some sozinha de `/responsaveis`; poda junto com a trilha.
- Na trilha, `entregar` grava `responsavel.id = "delegacao:<id>"` e o nome — o
  registro diz quem levou **e** que foi por autorização temporária.

---

## 3.4 Push com fallback

**O satélite não fala com pai nenhum.** Ele não tem contato, assinatura de push
nem consentimento — o backend tem. Push é consequência da trilha: o backend puxa
`/trilha` (3.2), vê `entregar` (e, se quiser, `chamar`) e decide o canal — push,
feed no portal, e-mail. O fallback é problema do backend, e é assim que deve ser.

Puxar a cada 15–30 s dá latência suficiente para "seu filho saiu". Se um dia não
der, o passo seguinte é um webhook `POST <backend>/eventos-portaria` com o mesmo
`LogAuditoria` e assinatura HMAC pela chave compartilhada — mas só depois de o
polling provar que não basta, e nunca antes de o portal existir. A pesquisa é
clara sobre Web Push no iOS: só com o app na tela inicial, e ainda assim
instável. A portaria segue como ponto de controle; **push nunca condiciona
nenhuma transição**.

---

## O que precisa de resposta de quem constrói o backend

| # | Pergunta | Recomendação |
|---|---|---|
| 1 | O id do aluno passa a ser o do backend? | Sim. É o que elimina os vínculos órfãos |
| 2 | Formato real do `LogAuditoria` — nome e campos | Mapear a partir de `src/ecossistema.ts`; os cinco itens "não negocia" da 3.2 precisam existir lá |
| 3 | Cadência de sincronização do cadastro | Uma vez por dia, fora do horário de saída, mais gatilho manual na secretaria |
| 4 | Quem puxa a trilha e com que frequência | Backend, a cada 15–30 s se houver push; senão, diária |
| 5 | Validade padrão da delegação | Fim do dia em `America/Sao_Paulo`; nunca mais que 7 dias |
| 6 | Segredo compartilhado | `CHAVE_ADMIN` até o Better Auth emitir credencial de serviço |

Nada desta fase vira código antes destas respostas.
