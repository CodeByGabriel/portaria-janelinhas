# Fase 3 — Interfaces com o ecossistema

Estado: **implementado no satélite sob os padrões abaixo**, em 05/09/2026, por
instrução do dono ("prossiga com todas as fases que conseguir"). Cada padrão é
reversível e está marcado. Os tipos vivem em `src/ecossistema.ts` e passam no
`typecheck` contra os tipos reais; as rotas vivem em `src/portaria.ts`; os
testes, em `src/ecossistema.test.ts`, `src/delegacao.test.ts` e no bloco
"fase 3" de `src/portaria.spec.ts`.

O que ainda depende de quem constrói o backend (NestJS/PostgreSQL, Better Auth,
portal de pais) está na tabela do fim.

## Papel do satélite

O app da portaria continua sendo um **serviço satélite**: Workers + Durable Object,
tempo real, com a máquina de estados e a trilha dele. O backend é a fonte do
cadastro e o destino da trilha. Nenhum dos quatro contratos abaixo muda isso, e
nenhum deles relaxa os invariantes: só a criança chamada na tela, sala filtrada
nos dois sentidos, papel fail-closed, trilha append-only, retrato completo.

Todos os contratos backend→satélite usam **`Authorization: Bearer <CHAVE_ADMIN>`**,
o mesmo segredo que já protege `/dispositivos` (que também passa a aceitar o
Bearer), comparado em tempo constante. Sem chave configurada, nada confere. Um
segredo só entre dois sistemas; nada de cookie de aparelho aqui — e o cookie da
portaria **não** abre estas rotas.

---

## 3.1 Cadastro por API (substitui a planilha)

| | |
|---|---|
| **Rota** | `PUT /cadastro` (backend → satélite), JSON, corpo ≤ 1 MB |
| **Corpo** | `CadastroCompleto` — alunos, responsáveis e vínculos numa chamada só |
| **Resposta** | `RespostaCadastro` |
| **Leitura** | `GET /cadastro` → `{ versao, interna, alunos }`, para o backend conferir o que está vigente |

**Substituição completa e atômica**, como a planilha hoje. Não há PATCH por aluno:
um cadastro meio trocado é pior que o cadastro antigo inteiro.

**A mudança que importa: o id vem do backend.** Pela planilha o satélite deriva o
id de nome+turma, e uma criança que muda de turma vira outro id — é isso que
orfana os vínculos e obriga a portaria a reimportar duas planilhas. Com id estável
vindo de fora, `vinculosPerdidos` não existe no caminho da API.

**Validação estrita.** Um erro em qualquer linha recusa o corpo inteiro (`422`,
com até 100 erros e o total). É diferente da planilha, que pula linhas: lá quem
corrige é a secretaria olhando o arquivo; aqui é um programa, e um programa que
recebe "aplicado com 3 erros" tende a ignorar os 3.

Códigos:

- `200` `trocado: true` — aplicado e transmitido a todas as telas.
- `200` `trocado: false` — mesma `versao` já vigente; repetir é idempotente.
- `409` — `versao` menor que a vigente, **ou há criança em saída agora**. Este
  segundo caso é o mesmo de hoje: trocar o cadastro no meio de uma saída sumiria
  com a criança de todas as telas. O backend tenta de novo; sincronizar fora do
  horário de saída resolve na prática.
- `400` / `413` / `422` — não é JSON / corpo grande demais / forma inválida.

**A planilha não morre, e manda quando é a última a chegar.** `/importar` e
`/importar-responsaveis` continuam como plano B — e **limpam a versão externa** ao
importar, para que o próximo envio do backend sempre valha (senão ele repetiria a
mesma versão, receberia "já vigente", e a planilha ficaria valendo para sempre).

---

## 3.2 Trilha → LogAuditoria

| | |
|---|---|
| **Rota** | `GET /trilha?apos=<seq>&limite=<n≤1000>` (backend puxa; padrão 500) |
| **Resposta** | `PaginaDaTrilha` — `eventos: LogAuditoria[]`, `proximo` |
| **Cursor** | `seq`, o AUTOINCREMENT que a tabela `trilha` já tinha |

O backend guarda o último `seq` que recebeu e pede "o que veio depois". Como a
trilha é append-only e `seq` é monotônico, a entrega é *at-least-once* com
deduplicação exata: receber duas vezes é inofensivo, pular é impossível.
`proximo` é o `seq` do último evento devolvido (o que se passa como `apos` na
chamada seguinte) e `null` quando não veio nada: fim.

**Nome e campos do `LogAuditoria` são proposta** — o formato real é do backend, e
eu não o vi. O que não negocia, porque é o que a trilha promete:

- `seq`, e `em` em ms + `quando` em ISO 8601 UTC;
- `de` → `para` (a transição, não só o estado final);
- `ator.papel` (`portaria`, `sala` ou `sistema`, este último a expiração
  automática) e `ator.origem` (qual sala, ou `portaria`);
- `razao` como **código**, nunca frase — renomear um rótulo não reescreve o passado;
- `responsavel` com id **e** nome — o nome porque a trilha precisa continuar legível
  depois que o cadastro for substituído. Em delegação, o id é `delegacao:<id>`.

**Retenção:** a poda diária de 90 dias (decisão 1 do plano) continua. O backend
precisa puxar antes disso — uma vez por dia basta, e o cursor torna qualquer atraso
recuperável enquanto os 90 dias não vencem.

---

## 3.3 Delegação "hoje a avó busca"

| | |
|---|---|
| **Rotas** | `POST /delegacoes` cria (`201`); `DELETE /delegacoes?id=` revoga (`204`, idempotente) |
| **Corpo** | `DelegacaoExterna` — aluno, quem busca, validade, quem autorizou |
| **Na portaria** | aparece dentro de `/responsaveis` com `temporario: true` e `autorizadoPor`, marcada "hoje" no diálogo de entrega |

O portal de pais é quem cria: um titular autoriza um adulto para uma janela de
tempo. O backend empurra para o satélite; o satélite guarda e mostra. A escolha
continua sendo da porteira, no diálogo de entrega, com o adulto temporário marcado
e o nome de quem autorizou ao lado. A sala vê a delegação, sem o telefone, como
vê os fixos.

Regras, todas no Livro e todas fail-closed:

- **Quem autoriza precisa poder levar.** `autorizadoPor` tem de ser responsável
  cadastrado *desta* criança, e não impedido. Sem responsáveis cadastrados não há
  titular, e sem titular não há delegação.
- **Impedido vence.** Delegação para alguém com o mesmo nome (normalizado) de quem
  está `impedido` para aquela criança é recusada na criação, `422`. Se o
  impedimento chegar *depois*, na próxima troca de cadastro, a delegação passa a
  aparecer como "não pode" — mesmo tratamento do fixo — e não entrega.
- **A janela faz sentido.** Fim depois do início, fim depois de agora, e no
  máximo 7 dias (`MAXIMO_DIAS_DELEGACAO`). `validoDe` ausente é "a partir de agora".
- Aluno desconhecido: `422`. Vencida some sozinha de `/responsaveis` e sai do
  disco no alarme diário. Trocar o cadastro sem a criança leva a delegação junto.
- Na trilha, `entregar` grava `responsavel.id = "delegacao:<id>"` e o nome — o
  registro diz quem levou **e** que foi por autorização temporária. O prefixo é
  reservado: nenhum id vindo do backend pode começar com ele.

---

## 3.4 Push com fallback

**O satélite não fala com pai nenhum.** Ele não tem contato, assinatura de push
nem consentimento — o backend tem. Push é consequência da trilha: o backend puxa
`/trilha` (3.2), vê `entregar` (e, se quiser, `chamar`) e decide o canal — push,
feed no portal, e-mail. O fallback é problema do backend, e é assim que deve ser.
Nada foi implementado aqui, de propósito.

Puxar a cada 15–30 s dá latência suficiente para "seu filho saiu". Se um dia não
der, o passo seguinte é um webhook `POST <backend>/eventos-portaria` com o mesmo
`LogAuditoria` e assinatura HMAC pela chave compartilhada — mas só depois de o
polling provar que não basta, e nunca antes de o portal existir. A pesquisa é
clara sobre Web Push no iOS: só com o app na tela inicial, e ainda assim
instável. A portaria segue como ponto de controle; **push nunca condiciona
nenhuma transição**.

---

## Junto com a fase: teto de tentativas no `/entrar`

Era o limite conhecido da 2.2: a única rota que aceita o token cru não tinha teto.
Agora dez falhas em quinze minutos, por origem (`CF-Connecting-IP`), respondem
`429` com `Retry-After`; acertar zera. É memória do objeto — reinício zera — e
basta: o espaço de tokens tem 256 bits, e o teto compra tempo e ruído no log, não
impossibilidade matemática. Fora da Cloudflare tudo cai num balde só, que é o lado
conservador.

---

## Padrões adotados e o que ainda precisa de resposta do backend

| # | Pergunta | Padrão adotado | Reversível? |
|---|---|---|---|
| 1 | O id do aluno passa a ser o do backend? | Sim | Trivialmente: é só o backend mandar o id que quiser |
| 2 | Formato real do `LogAuditoria` | `comoLogAuditoria` em `src/ecossistema.ts`; os cinco itens "não negocia" da 3.2 precisam existir no formato final | Uma função de mapeamento |
| 3 | Cadência de sincronização do cadastro | Decisão do backend; o satélite aceita a qualquer hora e responde 409 em saída | — |
| 4 | Quem puxa a trilha e com que frequência | Backend, por cursor; diária no mínimo, 15–30 s se houver push | — |
| 5 | Validade máxima da delegação | 7 dias; sem `validoDe`, começa agora | Uma constante |
| 6 | Segredo compartilhado | `CHAVE_ADMIN` por Bearer, até o Better Auth emitir credencial de serviço | Só o verificador muda |
