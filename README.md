# Portaria Janelinhas

App de saída de alunos da escola **Janelinhas do Saber**. O responsável chega no portão, a
portaria digita o nome, e **só a sala daquela criança** é avisada — com som e retrato, numa
janelinha que se abre.

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
| Sala | `http://localhost:8787/sala/?turma=Maternal` | tela ou tablet da professora |
| Demo | `http://localhost:8787/demo/` | as duas lado a lado, sem rede |
| Oficina | `http://localhost:8787/comum/oficina.html` | os quatro estados da janelinha |

Turmas da semente: `Maternal`, `Jardim I`, `Jardim II`, `1º ano`.

### Mostrar em dois aparelhos

O que faz o queixo cair é a sincronia: você toca no celular e a janelinha abre no notebook.

```bash
npx ngrok http 8787
```

Abra a URL do ngrok no celular com `/portaria/` e no notebook com `/sala/?turma=Maternal`.
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
| `aguardando` | `chamado` | Portaria | **A janelinha abre** na sala: som, retrato, nome |
| `chamado` | `liberado` | Professora | Ela confirma. A criança sai da sala |
| `liberado` | `entregue` | Portaria | Criança chegou no portão. Ciclo fechado |
| `chamado` | `aguardando` | Portaria | Cancelamento: nome errado, responsável desistiu |

**Quem pode fazer o quê é regra, não convenção.** A sala não consegue chamar; a portaria não
consegue liberar. Sem isso, duas mensagens de um cliente qualquer levariam uma criança de
`aguardando` até a rua sem ninguém no portão.

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
  semente.ts    32 alunos ficticios
  protocolo.ts  os tipos que trafegam no WebSocket
  portaria.ts   o Durable Object: rede e conexoes. Nenhuma regra mora aqui
  index.ts      roteamento
web/
  comum/        tokens.css, janelinha.js, avatar.js, som.js, ligacao.js, dom.js, estados.js
  portaria/ sala/ demo/
ferramentas/
  fim-a-fim.mjs      27 verificacoes contra o servidor rodando
  construir-demo.mjs gera o arquivo unico offline
```

**O servidor sempre transmite o retrato completo, nunca deltas.** Isso é decisão de robustez:
reconectar depois de uma queda de wifi fica automaticamente correto, porque o cliente recebe a
verdade inteira e redesenha. Com deltas, uma mensagem perdida deixaria a tela mentindo — e
mentir sobre qual criança pode sair é o pior defeito que este sistema pode ter.

## Privacidade por desenho

Não são detalhes de conformidade; são decisões de arquitetura, caras de acrescentar depois:

- **Um rosto por vez.** A janelinha fechada é opaca. Só a criança chamada aparece, e some
  quando o ciclo fecha. Nunca existe uma grade com o rosto de todas.
- **A sala vê apenas a própria turma.** O filtro é no servidor, não no cliente.
- **Papel fail-closed.** Papel inválido não conecta. Errar dá erro visível, nunca acesso
  ampliado em silêncio.
- **Retratos são ilustrações**, geradas do nome. Não geramos rosto fotorrealista de criança.
  Em produção, a escola sobe a foto que já tem na matrícula.
- **Nenhum dado real de aluno no repositório.** A semente é ficção declarada.

## Verificar

```bash
npm test          # 89 testes de unidade
npm run typecheck
npm run fim-a-fim # 27 verificacoes contra o servidor (precisa do npm run dev)
```

O `fim-a-fim` inclui os ataques que o red team reproduziu ao vivo: sala tentando chamar,
papel com maiúscula diferente, chave de protótipo como ação, rota HTTP sem papel. Eles ficam
lá para sempre — furo consertado sem teste volta.

## Armadilhas conhecidas do ambiente

| Sintoma | Causa | Saída |
|---|---|---|
| Servidor diz "Ready" mas tudo dá timeout | `workerd.exe` órfão segurando a porta | `netstat -ano \| grep ":8787.*LISTENING"`; se houver mais de uma linha, `taskkill //F //IM workerd.exe` |
| `ERR_INVALID_TYPESCRIPT_SYNTAX` | `constructor(readonly x: T)` não existe no strip-only do Node | Declare o campo e atribua no corpo |
| `MODULE_NOT_FOUND` ao testar | `node --test src/` trata a pasta como módulo | Use o glob, e a flag **antes** do `--test` |
| Janelinha parece meio aberta | Screenshot tirado durante os 380ms de animação | Tire outro; meça com `getBoundingClientRect` antes de culpar o CSS |

## O que falta para produção

Nada disto é bug — é escopo deliberadamente adiado, e cada item precisa da visita à escola.

- **Autenticação de verdade.** Hoje o papel vem da query string. Antes de qualquer dado real,
  isso precisa ser login.
- **Persistência.** O Durable Object tem armazenamento provisionado no `wrangler.toml` e não
  usado. Um reinício apaga o dia inteiro, **inclusive a trilha de auditoria**.
- **Consentimento LGPD por responsável**, e a foto real da criança.
- **Turmas de verdade.** As quatro da semente são chute fundamentado: todo
  `conteudo/institucional/` do repo ainda é `TODO(visita)`.
- **Limite de tamanho na importação e na trilha.** Ambas crescem sem teto hoje.

## Documentos

- `docs/superpowers/specs/2026-09-01-portaria-janelinhas-design.md` — o desenho e o porquê
- `docs/superpowers/plans/2026-09-01-portaria-janelinhas.md` — o plano executado, tarefa a tarefa
