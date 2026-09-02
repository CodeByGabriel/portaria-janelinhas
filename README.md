# Portaria Janelinhas

App de saída de alunos da escola **Janelinhas do Saber** — do Pré 1 ao 9º ano. O responsável
chega no portão, a portaria digita o nome, e **só a sala daquele aluno** é avisada: faixa de
aviso, som curto e o cartão do aluno com retrato.

Troca o microfone que grita o nome da criança para a escola inteira por uma chamada
silenciosa e dirigida. E deixa registrado quem entregou qual criança, e quando.

> ## Estado: vitrine funcional
>
> Roda de verdade e está pronto para mostrar à escola. **Não está pronto para produção** —
> falta autenticação, consentimento LGPD e persistência. O que existe já nasceu no formato
> certo para virar produção sem reescrita. Ver "O que falta" no fim.

## Rodar

```bash
npm install
npm run dev
```

| Tela | Endereço | Quem usa |
|---|---|---|
| Portaria | `http://localhost:8787/portaria/` | celular de quem fica no portão |
| Sala | `http://localhost:8787/sala/` | tela ou tablet da professora (escolhe a turma ao entrar) |
| Demo | `http://localhost:8787/demo/` | as duas lado a lado, sem rede |
| Oficina | `http://localhost:8787/comum/oficina.html` | cartão e linha, nos quatro estados |

**11 turmas**, agrupadas por segmento: `Pré 1` e `Pré 2` (Educação Infantil), `1º` a `5º ano`
(Fundamental I), `6º` a `9º ano` (Fundamental II). A semente traz 4 alunos em cada.

### Mostrar em dois aparelhos

O que faz o queixo cair é a sincronia: você toca no celular e o cartão aparece no notebook.

```bash
npx ngrok http 8787
```

Abra a URL do ngrok no celular com `/portaria/` e no notebook com `/sala/`.
**Não precisa de conta na Cloudflare** — `wrangler dev` roda o Durable Object localmente.

### Quando o wifi da escola cair

Dois planos de contingência, para duas falhas diferentes:

| Falha | Plano |
|---|---|
| Wifi da escola caiu | `http://localhost:8787/demo/` — as duas telas numa página, sem rede |
| Nem o `npm run dev` sobe | `web/demo-offline.html` — arquivo único, duplo clique, sem servidor |

```bash
npm run demo:offline    # regenera o arquivo único
```

O `web/demo/` usa módulos ES, e **o navegador recusa carregar módulo por `file://`**. Por isso
o arquivo único existe: ele tem CSS e scripts embutidos e abre de qualquer lugar.

## Como funciona

Uma criança percorre no máximo quatro estados por dia, e cada transição tem um dono:

| De | Para | Quem faz | O que acontece |
|---|---|---|---|
| `aguardando` | `chamado` | Portaria | **O cartão aparece** na sala: faixa, som, retrato, nome |
| `chamado` | `liberado` | Professora | Ela confirma. A criança sai da sala |
| `liberado` | `entregue` | Portaria | Criança chegou no portão. Ciclo fechado |
| `chamado` | `aguardando` | Portaria | Cancelamento: nome errado, responsável desistiu |

**Quem pode fazer o quê é regra, não convenção**, e ela tem dois eixos. Por **papel**: a sala
não chama, a portaria não libera. Por **turma**: a sala do Pré 1 não age sobre um aluno do 9º
ano. Faltando qualquer um dos dois, duas mensagens de um cliente qualquer levam um aluno de
`aguardando` até a rua sem ninguém no portão — os ids são sequenciais e adivinháveis.

Toda transição vira uma linha num registro **append-only**: quem, quando, de qual estado para
qual, e por qual papel. Não há operação de edição nem de remoção.

## Arquitetura

Um Worker do Cloudflare com **um Durable Object para a escola inteira** (`ADR-A19` do repo).

```
src/
  estados.ts    a maquina de estados. Pura: sem rede, sem relogio, sem armazenamento
  livro.ts      o estado do dia: chamadas ativas, cadastro, trilha de auditoria
  busca.ts      normalizacao e busca de nome brasileiro
  importar.ts   analisador da planilha da escola
  semente.ts    44 alunos ficticios em 11 turmas
  protocolo.ts  os tipos que trafegam no WebSocket
  portaria.ts   o Durable Object: rede e conexoes. Nenhuma regra mora aqui
  index.ts      roteamento
web/
  comum/        tokens.css, cartao.js, avatar.js, som.js, ligacao.js, busca.js, estados.js
  portaria/ sala/ demo/
ferramentas/
  fim-a-fim.mjs      30 verificacoes contra o servidor rodando
  construir-demo.mjs gera o arquivo unico offline
```

**O servidor sempre transmite o retrato completo, nunca deltas.** Isso é decisão de robustez:
reconectar depois de uma queda de wifi fica automaticamente correto, porque o cliente recebe a
verdade inteira e redesenha. Com deltas, uma mensagem perdida deixaria a tela mentindo — e
mentir sobre qual criança pode sair é o pior defeito que este sistema pode ter.

## Privacidade por desenho

Não são detalhes de conformidade; são decisões de arquitetura, caras de acrescentar depois:

- **Só aluno chamado aparece**, e o cartão some quando o ciclo fecha. Nunca existe uma grade
  com o rosto da turma inteira.
- **A sala só vê E só age sobre a própria turma.** O filtro é no servidor, nos dois sentidos:
  leitura e escrita.
- **Papel fail-closed.** Papel inválido não conecta. Errar dá erro visível, nunca acesso
  ampliado em silêncio.
- **Retratos são ilustrações planas**, geradas do nome. Não geramos rosto fotorrealista de
  aluno. Em produção, a escola sobe a foto que já tem na matrícula.
- **Toda ação registra a origem** — de qual sala partiu, ou da portaria. Sem isso, um
  "liberar" indevido não tem de onde ser rastreado depois do incidente.
- **Nenhum dado real de aluno no repositório.** A semente é ficção declarada.

## Verificar

```bash
npm test          # 113 testes de unidade
npm run typecheck
npm run fim-a-fim # 30 verificacoes contra o servidor (precisa do npm run dev)
```

O `fim-a-fim` inclui os ataques que as duas passagens de red team reproduziram ao vivo: sala
tentando chamar, sala liberando aluno de outra turma, papel com maiúscula diferente, chave de
protótipo como ação, rota HTTP sem papel. Eles ficam lá para sempre — furo consertado sem teste volta.

## Armadilhas conhecidas do ambiente

| Sintoma | Causa | Saída |
|---|---|---|
| `SQLITE_BUSY: database is locked` ao subir | Um `wrangler dev` órfão ainda segura `.wrangler/state` | Mate só os processos deste projeto (veja abaixo) e `rm -rf .wrangler/state` |
| Servidor diz "Ready" mas tudo dá timeout | Dois `wrangler dev` na mesma porta; as conexões caem no morto | `netstat -ano \| grep ":8787.*LISTENING"` — mais de uma linha confirma |

Para limpar sem derrubar seus outros projetos (nunca `taskkill //IM node.exe`: o próprio
editor roda em node):

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='workerd.exe'" |
  Where-Object { $_.CommandLine -like '*portaria janelinhas*' -or $_.Name -eq 'workerd.exe' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

| Sintoma | Causa | Saída |
|---|---|---|
| `ERR_INVALID_TYPESCRIPT_SYNTAX` | `constructor(readonly x: T)` não existe no strip-only do Node | Declare o campo e atribua no corpo |
| `MODULE_NOT_FOUND` ao testar | `node --test src/` trata a pasta como módulo | Use o glob, e a flag **antes** do `--test` |
| Screenshot mostra estado intermediário | Foi tirado durante a transição CSS | Tire outro; meça com `getBoundingClientRect` antes de culpar o CSS |
| Importação recusa todas as turmas | Planilha em ANSI lida como UTF-8 | Já tratado: `decodificar()` cai para Windows-1252 quando o UTF-8 estrito falha |

## O que falta para produção

Nada disto é bug — é escopo deliberadamente adiado, e cada item precisa da visita à escola.

- **Autenticação de verdade.** Hoje o papel vem da query string. Antes de qualquer dado real,
  isso precisa ser login. É o item que sozinho impede subir a lista da escola — ver
  `docs/lgpd.md` §6.
- **Base legal e contrato de operador.** Quem é controladora, quem é operador, e sob qual
  artigo o tratamento se sustenta. `docs/lgpd.md` §1 e §4, os dois com `TODO(juridico)`.
- **Foto real da criança**, se a escola quiser: hoje o retrato é ilustração gerada do nome.
- **Nomes exatos das turmas.** A faixa Pré 1–9º ano veio da escola; os rótulos ainda não.
  Todo `conteudo/institucional/` do repo é `TODO(visita)`.
- **Busca no servidor.** Hoje `/alunos` entrega o cadastro inteiro ao navegador e a busca
  roda no cliente — minimização ao contrário. `docs/lgpd.md` §6.
- **Exportação da trilha antes da poda**, se a escola precisar guardar mais de 90 dias.

**Fechado desde então:** a persistência existe (a trilha e o cadastro sobrevivem ao
reinício, e o cadastro importado não volta mais para a semente), e a importação, as
sessões e a trilha têm teto — 1 MB, 200 conexões e 90 dias de retenção.

## Documentos

- `docs/superpowers/specs/2026-09-01-portaria-janelinhas-design.md` — o desenho e o porquê
- `docs/superpowers/plans/2026-09-01-portaria-janelinhas.md` — o plano executado, tarefa a tarefa
- `docs/plano-refatoracao.md` — a refatoração em curso, com o que cada fase fecha
- `docs/pesquisa-refatoracao.md` — a pesquisa que a embasa, e onde o código a desmentiu
- `docs/baseline.md` — os números do "antes", contra os quais cada fase é medida
- **`docs/lgpd.md` — o que o sistema coleta, onde guarda, quem alcança, e os três
  bloqueios que impedem dado real de entrar hoje. Leia antes de qualquer conversa com a
  escola sobre subir a lista de verdade.**
