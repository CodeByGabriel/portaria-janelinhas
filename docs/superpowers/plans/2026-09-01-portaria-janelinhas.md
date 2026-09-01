# Portaria Janelinhas — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um app onde a portaria chama uma criança, a sala daquela criança recebe som e retrato numa janelinha que se abre, e a professora confirma a saída — sincronizado entre dois aparelhos de verdade.

**Architecture:** Um Worker do Cloudflare com um Durable Object único que guarda o estado do dia e as conexões WebSocket abertas. O núcleo de regras (`estados.ts`) é uma função pura sem rede nem relógio, e por isso é reusado tanto pelo Durable Object quanto pelo modo demo local. O servidor sempre transmite o retrato completo das chamadas do dia, nunca deltas — reconectar depois de queda de wifi fica automaticamente correto.

**Tech Stack:** TypeScript, Node 22, npm, Cloudflare Workers + Durable Objects (`wrangler dev` local, sem conta), `node:test` para testes, HTML/CSS/JS sem framework e sem CDN.

## Global Constraints

- Node >= 22. Verificado: `v22.13.0`.
- **npm**, não pnpm. Este projeto é autocontido e fica fora do workspace do repo raiz.
- Imports entre arquivos `.ts` **precisam da extensão explícita**: `from './estados.ts'`, não `from './estados'`.
- **Invocação exata dos testes** (verificada na Task 1, as variações falham):
  `node --experimental-strip-types --test "src/*.test.ts"`.
  A flag tem que vir **antes** de `--test`; depois dela é ignorada nos processos filhos. E o
  alvo tem que ser um **glob** — passar o diretório `src/` faz o Node tentar carregá-lo como
  módulo e morrer com `MODULE_NOT_FOUND`.
- **Proibido usar parameter property.** O strip-only do Node **não suporta**
  `constructor(readonly x: T)` nem `constructor(private y: T)` — eles exigem geração de
  código, não só apagar tipos, e quebram com `ERR_INVALID_TYPESCRIPT_SYNTAX`. Declare o campo
  e atribua no corpo do construtor. Vale para todo `.ts` do projeto, inclusive os que só rodam
  no wrangler: manter a regra única evita descobrir isso de novo mais tarde.
- **Não fixar `@cloudflare/workers-types`.** Fixar a versão conflita com a que o wrangler
  resolve (ERESOLVE). O wrangler traz a sua; se precisar dos tipos, gere com `npm run tipos`.
- **Nunca canalizar a saída de um comando de verificação para `tail`/`grep` sem checar o
  código de saída.** O pipe entrega o código do último comando, e um `npm install` que falhou
  passa como sucesso. Rode o comando cru, ou termine com `; echo "EXIT=$?"`.
- Nomes de arquivos, funções, tipos e variáveis em **português**, seguindo a convenção do repo (`pode.ts`, `matriz.ts`, `traducao.ts`).
- **Nenhum dado real de aluno.** Toda a semente é ficção declarada.
- O navegador não pode depender de rede externa: **sem CDN, sem fonte remota, sem biblioteca**. O modo demo tem que funcionar com o cabo desconectado.
- Som **sintetizado** com Web Audio. Nenhum arquivo de áudio no repositório.
- Animação de abrir a janelinha: **380ms**. Não é estimativa, é decisão do spec.
- A tela da sala mostra **um rosto por vez**. Nunca uma grade de rostos.
- Todo commit é feito a partir de `projeto portaria janelinhas/`, mas os caminhos do `git add` são relativos à raiz do repo — o diretório tem espaços, então **sempre entre aspas**.

## Mapa de arquivos

| Arquivo | Responsabilidade única |
| --- | --- |
| `package.json` | Scripts `test`, `typecheck`, `dev`. Sem dependência de runtime |
| `tsconfig.json` | Tipos do Worker, `strict` ligado |
| `wrangler.toml` | Binding do Durable Object e diretório de assets |
| `src/estados.ts` | A máquina de estados. Pura. Sem rede, sem relógio, sem armazenamento |
| `src/busca.ts` | Normalizar e buscar nome brasileiro. Pura |
| `src/semente.ts` | Os 32 alunos fictícios e as 4 turmas |
| `src/protocolo.ts` | Os tipos que trafegam no WebSocket. Sem lógica |
| `src/portaria.ts` | O Durable Object: estado do dia, conexões, registro append-only |
| `src/index.ts` | Roteamento HTTP e upgrade de WebSocket |
| `web/comum/tokens.css` | As cores e medidas da janelinha |
| `web/comum/avatar.js` | Retrato ilustrado determinístico a partir do nome |
| `web/comum/janelinha.js` | O componente da janelinha: fechada, abrindo, aberta |
| `web/comum/som.js` | Duas notas ao abrir, toque seco ao entregar, e o mudo |
| `web/comum/ligacao.js` | Cliente WebSocket com retentativa de espera crescente |
| `web/sala/index.html` | Tela da professora |
| `web/portaria/index.html` | Tela do celular da portaria |
| `web/demo/index.html` | As duas lado a lado, sem rede |

---

### Task 1: Andaime que sobe

**Files:**
- Create: `package.json`, `tsconfig.json`, `wrangler.toml`, `.gitignore`
- Create: `src/index.ts`
- Create: `web/sala/index.html`

**Interfaces:**
- Consumes: nada.
- Produces: um Worker que responde em `http://localhost:8787/sala` e o comando `npm test` funcionando com zero testes.

- [ ] **Step 1: Criar `package.json`**

```json
{
  "name": "portaria-janelinhas",
  "private": true,
  "version": "0.1.0",
  "description": "App de saida de alunos da escola Janelinhas do Saber. Vitrine.",
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "wrangler dev",
    "test": "node --test --experimental-strip-types \"src/**/*.test.ts\"",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "wrangler": "^4.27.0",
    "typescript": "^5.6.0",
    "@cloudflare/workers-types": "^4.20260901.0"
  }
}
```

- [ ] **Step 2: Criar `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true,
    "types": ["@cloudflare/workers-types"],
    "lib": ["ES2022", "DOM"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Criar `wrangler.toml`**

```toml
name = "portaria-janelinhas"
main = "src/index.ts"
compatibility_date = "2026-09-01"

[[durable_objects.bindings]]
name = "PORTARIA"
class_name = "Portaria"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["Portaria"]

[assets]
directory = "web"
```

- [ ] **Step 4: Criar `.gitignore` do projeto**

```
node_modules/
.wrangler/
*.tsbuildinfo
```

- [ ] **Step 5: Criar `src/index.ts` com o Durable Object mínimo**

O Durable Object precisa existir já nesta tarefa, senão o wrangler recusa subir por causa do binding.

```ts
export class Portaria {
  constructor(private estado: DurableObjectState, private env: unknown) {}
  async fetch(_pedido: Request): Promise<Response> {
    return new Response('portaria viva')
  }
}

export default {
  async fetch(pedido: Request, env: { PORTARIA: DurableObjectNamespace }): Promise<Response> {
    const url = new URL(pedido.url)
    if (url.pathname === '/saude') return new Response('ok')
    const id = env.PORTARIA.idFromName('escola')
    return env.PORTARIA.get(id).fetch(pedido)
  },
}
```

- [ ] **Step 6: Criar `web/sala/index.html` provisório**

```html
<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>Sala — Janelinhas</title></head>
<body><p>sala viva</p></body>
</html>
```

- [ ] **Step 7: Instalar e subir**

Run: `npm install`
Run: `npm run dev`
Expected: wrangler sobe em `http://localhost:8787`. Em outro terminal, `curl http://localhost:8787/saude` devolve `ok`, e `curl http://localhost:8787/sala/` devolve o HTML.

Se o wrangler reclamar do caminho com espaços, **pare e relate** — é o risco conhecido da seção 12 do spec. `node` já foi verificado e passa; só o wrangler é incógnita.

- [ ] **Step 8: Commit**

```bash
git add "projeto portaria janelinhas"
git commit -m "Andaime do Worker da portaria"
```

---

### Task 2: A máquina de estados

**Files:**
- Create: `src/estados.ts`
- Test: `src/estados.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `Estado`, `Acao`, `Papel`, `DONO`, `TransicaoInvalida`, `proximo(de: Estado, acao: Acao): Estado`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { proximo, TransicaoInvalida, DONO } from './estados.ts'

test('o caminho feliz percorre os quatro estados', () => {
  assert.equal(proximo('aguardando', 'chamar'), 'chamado')
  assert.equal(proximo('chamado', 'liberar'), 'liberado')
  assert.equal(proximo('liberado', 'entregar'), 'entregue')
})

test('a portaria pode cancelar uma chamada', () => {
  assert.equal(proximo('chamado', 'cancelar'), 'aguardando')
})

test('NAO se libera crianca que ninguem chamou', () => {
  assert.throws(() => proximo('aguardando', 'liberar'), TransicaoInvalida)
})

test('NAO se entrega pulando a professora', () => {
  assert.throws(() => proximo('aguardando', 'entregar'), TransicaoInvalida)
  assert.throws(() => proximo('chamado', 'entregar'), TransicaoInvalida)
})

test('NAO se desfaz uma liberacao: a crianca ja saiu da sala', () => {
  assert.throws(() => proximo('liberado', 'cancelar'), TransicaoInvalida)
})

test('entregue e terminal', () => {
  for (const acao of ['chamar', 'liberar', 'entregar', 'cancelar'] as const) {
    assert.throws(() => proximo('entregue', acao), TransicaoInvalida)
  }
})

test('NAO se chama quem ja esta chamado', () => {
  assert.throws(() => proximo('chamado', 'chamar'), TransicaoInvalida)
})

test('o erro diz de onde para onde', () => {
  try {
    proximo('aguardando', 'liberar')
    assert.fail('deveria ter lancado')
  } catch (e) {
    assert.ok(e instanceof TransicaoInvalida)
    assert.equal(e.de, 'aguardando')
    assert.equal(e.acao, 'liberar')
  }
})

test('cada acao tem um dono declarado', () => {
  assert.equal(DONO.chamar, 'portaria')
  assert.equal(DONO.liberar, 'sala')
  assert.equal(DONO.entregar, 'portaria')
  assert.equal(DONO.cancelar, 'portaria')
})
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npm test`
Expected: FAIL — `Cannot find module './estados.ts'`

- [ ] **Step 3: Implementar o mínimo**

```ts
export type Estado = 'aguardando' | 'chamado' | 'liberado' | 'entregue'
export type Acao = 'chamar' | 'liberar' | 'entregar' | 'cancelar'
export type Papel = 'portaria' | 'sala'

export const DONO: Record<Acao, Papel> = {
  chamar: 'portaria',
  liberar: 'sala',
  entregar: 'portaria',
  cancelar: 'portaria',
}

export class TransicaoInvalida extends Error {
  constructor(readonly de: Estado, readonly acao: Acao) {
    super(`nao e possivel "${acao}" a partir de "${de}"`)
    this.name = 'TransicaoInvalida'
  }
}

const MAPA: Partial<Record<Estado, Partial<Record<Acao, Estado>>>> = {
  aguardando: { chamar: 'chamado' },
  chamado: { liberar: 'liberado', cancelar: 'aguardando' },
  liberado: { entregar: 'entregue' },
}

export function proximo(de: Estado, acao: Acao): Estado {
  const destino = MAPA[de]?.[acao]
  if (!destino) throw new TransicaoInvalida(de, acao)
  return destino
}
```

- [ ] **Step 4: Rodar para ver passar**

Run: `npm test`
Expected: PASS, 9 testes.

- [ ] **Step 5: Commit**

```bash
git add "projeto portaria janelinhas/src/estados.ts" "projeto portaria janelinhas/src/estados.test.ts"
git commit -m "Maquina de estados da saida, com as transicoes proibidas testadas"
```

---

### Task 3: Semente e busca de nome brasileiro

**Files:**
- Create: `src/semente.ts`, `src/busca.ts`
- Test: `src/semente.test.ts`, `src/busca.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `Turma` (union de 4 strings), `TURMAS`, `Aluno` (`{ id: string; nome: string; turma: Turma }`), `semear(): Aluno[]`, `normalizar(texto: string): string`, `buscar(alunos: Aluno[], consulta: string, limite?: number): Aluno[]`.

- [ ] **Step 1: Escrever `src/semente.test.ts`**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { semear, TURMAS } from './semente.ts'

test('semeia 32 alunos', () => {
  assert.equal(semear().length, 32)
})

test('oito alunos em cada uma das quatro turmas', () => {
  const alunos = semear()
  assert.equal(TURMAS.length, 4)
  for (const turma of TURMAS) {
    assert.equal(alunos.filter((a) => a.turma === turma).length, 8)
  }
})

test('todo id e unico', () => {
  const ids = semear().map((a) => a.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('a semente tem nomes acentuados de verdade', () => {
  const nomes = semear().map((a) => a.nome).join(' ')
  assert.match(nomes, /[áàâãéêíóôõúç]/i)
})

test('semear e deterministico', () => {
  assert.deepEqual(semear(), semear())
})
```

- [ ] **Step 2: Escrever `src/busca.test.ts`**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizar, buscar } from './busca.ts'
import type { Aluno } from './semente.ts'

const ALUNOS: Aluno[] = [
  { id: '1', nome: 'Thaís Gonçalves', turma: 'Jardim II' },
  { id: '2', nome: 'João Conceição', turma: 'Maternal' },
  { id: '3', nome: 'Ana Beatriz Souza', turma: '1º ano' },
  { id: '4', nome: 'Thiago Alves', turma: 'Jardim I' },
]

test('normalizar tira acento e caixa', () => {
  assert.equal(normalizar('Thaís'), 'thais')
  assert.equal(normalizar('GONÇALVES'), 'goncalves')
  assert.equal(normalizar('Conceição'), 'conceicao')
})

test('normalizar colapsa espaco sobrando', () => {
  assert.equal(normalizar('  Ana   Beatriz  '), 'ana beatriz')
})

test('acha nome acentuado digitando sem acento', () => {
  const r = buscar(ALUNOS, 'thais')
  assert.equal(r.length, 1)
  assert.equal(r[0].nome, 'Thaís Gonçalves')
})

test('acha pelo sobrenome', () => {
  const r = buscar(ALUNOS, 'goncalves')
  assert.equal(r[0].id, '1')
})

test('acha por prefixo parcial', () => {
  const r = buscar(ALUNOS, 'thi')
  assert.equal(r.length, 1)
  assert.equal(r[0].nome, 'Thiago Alves')
})

test('prefixo ambiguo devolve os dois', () => {
  const r = buscar(ALUNOS, 'th')
  assert.equal(r.length, 2)
})

test('consulta vazia nao devolve ninguem', () => {
  assert.equal(buscar(ALUNOS, '').length, 0)
  assert.equal(buscar(ALUNOS, '   ').length, 0)
})

test('respeita o limite', () => {
  assert.equal(buscar(ALUNOS, 'a', 2).length, 2)
})

test('busca por duas palavras exige as duas', () => {
  assert.equal(buscar(ALUNOS, 'ana beatriz').length, 1)
  assert.equal(buscar(ALUNOS, 'ana thiago').length, 0)
})
```

- [ ] **Step 3: Rodar para ver falhar**

Run: `npm test`
Expected: FAIL — módulos não encontrados.

- [ ] **Step 4: Implementar `src/semente.ts`**

```ts
export const TURMAS = ['Maternal', 'Jardim I', 'Jardim II', '1º ano'] as const
export type Turma = (typeof TURMAS)[number]

export interface Aluno {
  id: string
  nome: string
  turma: Turma
}

const NOMES: readonly string[] = [
  'Thaís Gonçalves', 'João Conceição', 'Ana Beatriz Souza', 'Thiago Alves',
  'Maria Cecília Rocha', 'Davi Nascimento', 'Lara Mendonça', 'Bruno Assunção',
  'Íris Pacheco', 'Heitor Camargo', 'Alice Fernandes', 'Miguel Bittencourt',
  'Sofia Rezende', 'Arthur Magalhães', 'Helena Siqueira', 'Bernardo Antunes',
  'Manuela Vasconcelos', 'Théo Marçal', 'Valentina Queiroz', 'Gael Espíndola',
  'Cecília Barroso', 'Anthony Peçanha', 'Isabela Furtado', 'Lorenzo Sampaio',
  'Elisa Guimarães', 'Benício Andrade', 'Antonella Xavier', 'Noah Teixeira',
  'Maitê Salgado', 'Vicente Aragão', 'Liz Monteiro', 'Ravi Bacelar',
]

export function semear(): Aluno[] {
  return NOMES.map((nome, i) => ({
    id: `a${String(i + 1).padStart(2, '0')}`,
    nome,
    turma: TURMAS[Math.floor(i / 8)],
  }))
}
```

- [ ] **Step 5: Implementar `src/busca.ts`**

```ts
import type { Aluno } from './semente.ts'

export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

export function buscar(alunos: Aluno[], consulta: string, limite = 8): Aluno[] {
  const termos = normalizar(consulta).split(' ').filter(Boolean)
  if (termos.length === 0) return []
  const achados = alunos.filter((aluno) => {
    const partes = normalizar(aluno.nome).split(' ')
    return termos.every((termo) => partes.some((parte) => parte.startsWith(termo)))
  })
  return achados.slice(0, limite)
}
```

- [ ] **Step 6: Rodar para ver passar**

Run: `npm test`
Expected: PASS, 14 testes no total.

- [ ] **Step 7: Commit**

```bash
git add "projeto portaria janelinhas/src"
git commit -m "Semente ficticia e busca que aguenta nome brasileiro"
```

---

### Task 4: Protocolo e Durable Object

**Files:**
- Create: `src/protocolo.ts`, `src/portaria.ts`
- Test: `src/protocolo.test.ts`, `src/portaria.test.ts`
- Modify: `src/index.ts` (trocar o Durable Object provisório da Task 1 pelo de verdade)

**Interfaces:**
- Consumes: `proximo`, `TransicaoInvalida`, `Estado`, `Acao`, `Papel` de `estados.ts`; `Aluno`, `Turma`, `semear` de `semente.ts`.
- Produces: `Chamada`, `Retrato`, `Comando`, `EventoAuditoria` de `protocolo.ts`; classe `Portaria` com o método público `aplicar(comando: Comando, agora: number): EventoAuditoria` e `retratoPara(papel: Papel, turma?: Turma): Retrato`.

- [ ] **Step 1: Escrever `src/protocolo.ts`** (só tipos, sem lógica, sem teste próprio de comportamento)

```ts
import type { Estado, Acao } from './estados.ts'
import type { Turma } from './semente.ts'

export interface Chamada {
  alunoId: string
  nome: string
  turma: Turma
  estado: Estado
  em: number
}

export interface Retrato {
  tipo: 'retrato'
  chamadas: Chamada[]
  em: number
}

export interface Comando {
  tipo: Acao
  alunoId: string
}

export interface EventoAuditoria {
  alunoId: string
  nome: string
  acao: Acao
  de: Estado
  para: Estado
  em: number
}

export interface Recusa {
  tipo: 'recusa'
  alunoId: string
  motivo: string
}
```

- [ ] **Step 2: Escrever `src/portaria.test.ts` com os testes que falham**

O Durable Object precisa ser testável sem rede. Por isso a lógica mora numa classe simples (`Livro`) que a classe do Durable Object embrulha.

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Livro } from './portaria.ts'
import { TransicaoInvalida } from './estados.ts'

test('chamar cria uma chamada no estado chamado', () => {
  const livro = new Livro()
  livro.aplicar({ tipo: 'chamar', alunoId: 'a01' }, 1000)
  const r = livro.retratoPara('portaria')
  assert.equal(r.chamadas.length, 1)
  assert.equal(r.chamadas[0].estado, 'chamado')
  assert.equal(r.chamadas[0].alunoId, 'a01')
})

test('o ciclo completo chega em entregue', () => {
  const livro = new Livro()
  livro.aplicar({ tipo: 'chamar', alunoId: 'a01' }, 1000)
  livro.aplicar({ tipo: 'liberar', alunoId: 'a01' }, 2000)
  livro.aplicar({ tipo: 'entregar', alunoId: 'a01' }, 3000)
  assert.equal(livro.retratoPara('portaria').chamadas[0].estado, 'entregue')
})

test('liberar sem chamar e recusado', () => {
  const livro = new Livro()
  assert.throws(() => livro.aplicar({ tipo: 'liberar', alunoId: 'a01' }, 1000), TransicaoInvalida)
})

test('aluno inexistente e recusado', () => {
  const livro = new Livro()
  assert.throws(() => livro.aplicar({ tipo: 'chamar', alunoId: 'nao-existe' }, 1000), /desconhecido/)
})

test('a sala so ve a propria turma', () => {
  const livro = new Livro()
  livro.aplicar({ tipo: 'chamar', alunoId: 'a01' }, 1000)
  livro.aplicar({ tipo: 'chamar', alunoId: 'a09' }, 1000)
  const maternal = livro.retratoPara('sala', 'Maternal')
  assert.ok(maternal.chamadas.every((c) => c.turma === 'Maternal'))
  assert.equal(livro.retratoPara('portaria').chamadas.length, 2)
})

test('o registro e append-only e cresce a cada transicao', () => {
  const livro = new Livro()
  livro.aplicar({ tipo: 'chamar', alunoId: 'a01' }, 1000)
  livro.aplicar({ tipo: 'liberar', alunoId: 'a01' }, 2000)
  const registro = livro.registro()
  assert.equal(registro.length, 2)
  assert.deepEqual(
    registro.map((e) => [e.de, e.para]),
    [['aguardando', 'chamado'], ['chamado', 'liberado']],
  )
})

test('o registro devolvido e uma copia: mexer nele nao apaga a trilha', () => {
  const livro = new Livro()
  livro.aplicar({ tipo: 'chamar', alunoId: 'a01' }, 1000)
  livro.registro().length = 0
  assert.equal(livro.registro().length, 1)
})

test('cancelar volta para aguardando e some do retrato ativo', () => {
  const livro = new Livro()
  livro.aplicar({ tipo: 'chamar', alunoId: 'a01' }, 1000)
  livro.aplicar({ tipo: 'cancelar', alunoId: 'a01' }, 2000)
  assert.equal(livro.retratoPara('portaria').chamadas.length, 0)
})

test('o retrato carrega carimbo de tempo', () => {
  const livro = new Livro()
  const r = livro.retratoPara('portaria', undefined, 5000)
  assert.equal(r.em, 5000)
  assert.equal(r.tipo, 'retrato')
})
```

- [ ] **Step 3: Rodar para ver falhar**

Run: `npm test`
Expected: FAIL — `Livro` não existe.

- [ ] **Step 4: Implementar `Livro` e a classe `Portaria` em `src/portaria.ts`**

```ts
import { proximo, type Estado, type Acao, type Papel } from './estados.ts'
import { semear, type Aluno, type Turma } from './semente.ts'
import type { Chamada, Retrato, Comando, EventoAuditoria } from './protocolo.ts'

export class Livro {
  private readonly cadastro = new Map<string, Aluno>()
  private readonly chamadas = new Map<string, Chamada>()
  private readonly trilha: EventoAuditoria[] = []

  constructor(alunos: Aluno[] = semear()) {
    for (const aluno of alunos) this.cadastro.set(aluno.id, aluno)
  }

  alunos(): Aluno[] {
    return [...this.cadastro.values()]
  }

  aplicar(comando: Comando, agora: number): EventoAuditoria {
    const aluno = this.cadastro.get(comando.alunoId)
    if (!aluno) throw new Error(`aluno desconhecido: ${comando.alunoId}`)

    const atual = this.chamadas.get(comando.alunoId)
    const de: Estado = atual?.estado ?? 'aguardando'
    const para = proximo(de, comando.tipo)

    if (para === 'aguardando') this.chamadas.delete(comando.alunoId)
    else this.chamadas.set(comando.alunoId, {
      alunoId: aluno.id, nome: aluno.nome, turma: aluno.turma, estado: para, em: agora,
    })

    const evento: EventoAuditoria = {
      alunoId: aluno.id, nome: aluno.nome, acao: comando.tipo, de, para, em: agora,
    }
    this.trilha.push(evento)
    return evento
  }

  retratoPara(papel: Papel, turma?: Turma, agora = 0): Retrato {
    const todas = [...this.chamadas.values()]
    const chamadas = papel === 'sala' && turma ? todas.filter((c) => c.turma === turma) : todas
    return { tipo: 'retrato', chamadas, em: agora }
  }

  registro(): EventoAuditoria[] {
    return [...this.trilha]
  }
}
```

- [ ] **Step 5: Rodar para ver passar**

Run: `npm test`
Expected: PASS, 23 testes no total.

- [ ] **Step 6: Ligar o `Livro` ao Durable Object e ao WebSocket**

Acrescentar em `src/portaria.ts`:

```ts
interface Sessao { ws: WebSocket; papel: Papel; turma?: Turma }

export class Portaria {
  private readonly livro = new Livro()
  private readonly sessoes = new Set<Sessao>()

  constructor(private readonly estado: DurableObjectState) {}

  async fetch(pedido: Request): Promise<Response> {
    const url = new URL(pedido.url)

    if (url.pathname === '/registro') {
      return Response.json(this.livro.registro())
    }

    if (url.pathname !== '/ws') return new Response('nao encontrado', { status: 404 })
    if (pedido.headers.get('Upgrade') !== 'websocket') {
      return new Response('esperava upgrade', { status: 426 })
    }

    const papel = url.searchParams.get('papel') === 'sala' ? 'sala' : 'portaria'
    const turma = (url.searchParams.get('turma') ?? undefined) as Turma | undefined

    const par = new WebSocketPair()
    const cliente = par[0]
    const servidor = par[1]
    servidor.accept()

    const sessao: Sessao = { ws: servidor, papel, turma }
    this.sessoes.add(sessao)

    servidor.addEventListener('message', (evento) => {
      try {
        const comando = JSON.parse(String(evento.data)) as Comando
        this.livro.aplicar(comando, Date.now())
        this.transmitir()
      } catch (erro) {
        servidor.send(JSON.stringify({
          tipo: 'recusa',
          alunoId: '',
          motivo: erro instanceof Error ? erro.message : 'erro desconhecido',
        }))
      }
    })

    const encerrar = () => this.sessoes.delete(sessao)
    servidor.addEventListener('close', encerrar)
    servidor.addEventListener('error', encerrar)

    servidor.send(JSON.stringify(this.livro.retratoPara(papel, turma, Date.now())))

    return new Response(null, { status: 101, webSocket: cliente })
  }

  private transmitir(): void {
    const agora = Date.now()
    for (const sessao of this.sessoes) {
      try {
        sessao.ws.send(JSON.stringify(this.livro.retratoPara(sessao.papel, sessao.turma, agora)))
      } catch {
        this.sessoes.delete(sessao)
      }
    }
  }
}
```

- [ ] **Step 7: Trocar o Durable Object provisório em `src/index.ts`**

```ts
export { Portaria } from './portaria.ts'

export default {
  async fetch(pedido: Request, env: { PORTARIA: DurableObjectNamespace }): Promise<Response> {
    const url = new URL(pedido.url)
    if (url.pathname === '/saude') return new Response('ok')
    if (url.pathname === '/ws' || url.pathname === '/registro') {
      return env.PORTARIA.get(env.PORTARIA.idFromName('escola')).fetch(pedido)
    }
    return new Response('nao encontrado', { status: 404 })
  },
}
```

- [ ] **Step 8: Verificar tipos e subir**

Run: `npm run typecheck`
Expected: sem erro.
Run: `npm run dev` e conferir que `curl http://localhost:8787/registro` devolve `[]`.

- [ ] **Step 9: Commit**

```bash
git add "projeto portaria janelinhas/src"
git commit -m "Durable Object com retrato completo, filtro por turma e trilha append-only"
```

---

### Task 5: A janelinha, o retrato e o som

**Files:**
- Create: `web/comum/tokens.css`, `web/comum/avatar.js`, `web/comum/janelinha.js`, `web/comum/som.js`
- Create: `web/comum/oficina.html` (bancada para ver os três estados sem servidor)

**Interfaces:**
- Consumes: nada — este é código de navegador, isolado do servidor.
- Produces: `retratoDe(nome: string): SVGElement` em `avatar.js`; `criarJanelinha({ nome, turma }): HTMLElement` com o método `definirEstado(estado)` em `janelinha.js`; `destravar()`, `tocarAbertura()`, `tocarEntrega()`, `alternarMudo()` em `som.js`.

- [ ] **Step 1: Escrever `web/comum/tokens.css`**

As cores da marca real da escola não são conhecidas — `conteudo/institucional/` é todo `TODO(visita)`. As que dependem dela ficam marcadas.

```css
:root {
  --moldura: #b4671a;
  --moldura-escura: #7d4610;
  --vidro: #d9e9f5;
  --vidro-fosco: #b9c8d4;
  --entregue: #2f7d55;
  --tinta: #2a1d10;
  --tinta-suave: #6b5541;
  --papel: #fdf8f0;
  --abertura: 380ms;
  --curva: cubic-bezier(0.34, 1.2, 0.64, 1);
  --_todo-marca-primaria: var(--moldura);
  --_todo-marca-secundaria: var(--vidro);
}
```

- [ ] **Step 2: Escrever `web/comum/avatar.js`**

Retrato ilustrado determinístico. Geométrico de propósito: lê como ilustração, nunca como foto.

```js
const PELES = ['#f4d5bb', '#e8bd9a', '#c99163', '#a06a42', '#6f4527']
const CABELOS = ['#2b1b12', '#4a2c1a', '#7b4b23', '#c98b3a', '#1a1a1a']
const ROUPAS = ['#2f6f9f', '#2f7d55', '#9f4f2f', '#6a4b8f', '#b4671a']

function digerir(texto) {
  let h = 2166136261
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

export function retratoDe(nome) {
  const h = digerir(nome)
  const pele = PELES[h % PELES.length]
  const cabelo = CABELOS[Math.floor(h / 7) % CABELOS.length]
  const roupa = ROUPAS[Math.floor(h / 13) % ROUPAS.length]
  const franja = h % 2 === 0

  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 100 100')
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', `Retrato ilustrado de ${nome}`)
  svg.innerHTML = `
    <circle cx="50" cy="50" r="50" fill="${roupa}" opacity="0.18"/>
    <path d="M22 100a28 28 0 0 1 56 0z" fill="${roupa}"/>
    <circle cx="50" cy="45" r="24" fill="${pele}"/>
    <path d="M26 42a24 24 0 0 1 48 0${franja ? 'q-24 10-48 0' : 'q-24-14-48 0'}z" fill="${cabelo}"/>
    <circle cx="42" cy="47" r="2.6" fill="#2a1d10"/>
    <circle cx="58" cy="47" r="2.6" fill="#2a1d10"/>
    <path d="M43 56q7 6 14 0" stroke="#2a1d10" stroke-width="2.2" fill="none" stroke-linecap="round"/>
  `
  return svg
}
```

- [ ] **Step 3: Escrever `web/comum/janelinha.js`**

```js
import { retratoDe } from './avatar.js'

export function criarJanelinha({ nome, turma }) {
  const raiz = document.createElement('div')
  raiz.className = 'janelinha'
  raiz.innerHTML = `
    <div class="caixilho">
      <div class="retrato"></div>
      <div class="batente esquerdo"><span></span><span></span></div>
      <div class="batente direito"><span></span><span></span></div>
    </div>
    <p class="nome"></p>
    <p class="turma"></p>
  `
  raiz.querySelector('.nome').textContent = nome
  raiz.querySelector('.turma').textContent = turma
  raiz.querySelector('.retrato').append(retratoDe(nome))

  return Object.assign(raiz, {
    definirEstado(estado) {
      raiz.dataset.estado = estado
    },
  })
}
```

E o CSS correspondente, acrescentado ao fim de `tokens.css`:

```css
.janelinha { width: 100%; text-align: center; }
.caixilho {
  position: relative; aspect-ratio: 1; border: 10px solid var(--moldura);
  border-radius: 6px; background: var(--vidro); overflow: hidden;
}
.retrato { position: absolute; inset: 8%; }
.retrato svg { width: 100%; height: 100%; }
.batente {
  position: absolute; top: 0; bottom: 0; width: 50%;
  background: var(--vidro-fosco); border: 4px solid var(--moldura-escura);
  display: grid; grid-template-rows: 1fr 1fr; gap: 4px; padding: 4px;
  transition: transform var(--abertura) var(--curva);
  transform-style: preserve-3d;
}
.batente span { background: var(--vidro); border-radius: 2px; }
.esquerdo { left: 0; transform-origin: left center; }
.direito { right: 0; transform-origin: right center; }
[data-estado="chamado"] .esquerdo,
[data-estado="liberado"] .esquerdo { transform: perspective(600px) rotateY(-105deg); }
[data-estado="chamado"] .direito,
[data-estado="liberado"] .direito { transform: perspective(600px) rotateY(105deg); }
[data-estado="entregue"] .caixilho { border-color: var(--entregue); }
.nome { font-weight: 600; color: var(--tinta); margin: 0.6rem 0 0; }
.turma { color: var(--tinta-suave); margin: 0.1rem 0 0; font-size: 0.9rem; }
@media (prefers-reduced-motion: reduce) {
  .batente { transition: none; }
}
```

- [ ] **Step 4: Escrever `web/comum/som.js`**

```js
let contexto = null
let mudo = false

export function destravar() {
  if (!contexto) contexto = new (window.AudioContext || window.webkitAudioContext)()
  if (contexto.state === 'suspended') contexto.resume()
}

export function alternarMudo() {
  mudo = !mudo
  return mudo
}

function nota(frequencia, comeco, duracao, volume) {
  const osc = contexto.createOscillator()
  const ganho = contexto.createGain()
  osc.type = 'sine'
  osc.frequency.value = frequencia
  ganho.gain.setValueAtTime(0, comeco)
  ganho.gain.linearRampToValueAtTime(volume, comeco + 0.02)
  ganho.gain.exponentialRampToValueAtTime(0.0001, comeco + duracao)
  osc.connect(ganho).connect(contexto.destination)
  osc.start(comeco)
  osc.stop(comeco + duracao)
}

export function tocarAbertura() {
  if (mudo || !contexto) return
  const t = contexto.currentTime
  nota(587.33, t, 0.34, 0.16)
  nota(880.0, t + 0.16, 0.44, 0.13)
}

export function tocarEntrega() {
  if (mudo || !contexto) return
  nota(392.0, contexto.currentTime, 0.14, 0.1)
}
```

- [ ] **Step 5: Criar a bancada `web/comum/oficina.html` e conferir com o olho**

```html
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Oficina da janelinha</title>
  <link rel="stylesheet" href="./tokens.css">
  <style>
    body { background: var(--papel); font-family: system-ui, sans-serif; padding: 2rem; }
    .grade { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2rem; max-width: 900px; }
  </style>
</head>
<body>
  <div class="grade" id="grade"></div>
  <p><button id="abrir">Abrir todas</button> <button id="fechar">Fechar todas</button></p>
  <script type="module">
    import { criarJanelinha } from './janelinha.js'
    import { destravar, tocarAbertura } from './som.js'
    const nomes = [
      ['Thaís Gonçalves', 'Jardim II'], ['João Conceição', 'Maternal'],
      ['Lara Mendonça', 'Jardim I'], ['Ravi Bacelar', '1º ano'],
    ]
    const janelas = nomes.map(([nome, turma]) => {
      const j = criarJanelinha({ nome, turma })
      j.definirEstado('aguardando')
      document.getElementById('grade').append(j)
      return j
    })
    document.getElementById('abrir').onclick = () => {
      destravar(); tocarAbertura()
      janelas.forEach((j) => j.definirEstado('chamado'))
    }
    document.getElementById('fechar').onclick = () =>
      janelas.forEach((j) => j.definirEstado('aguardando'))
  </script>
</body>
</html>
```

Run: `npm run dev` e abrir `http://localhost:8787/comum/oficina.html`.
Expected: quatro janelinhas fechadas. "Abrir todas" gira os batentes em 380ms, revela os retratos e toca duas notas. Cada retrato é diferente e estável entre recargas.

- [ ] **Step 6: Commit**

```bash
git add "projeto portaria janelinhas/web"
git commit -m "A janelinha: caixilho que abre, retrato ilustrado e som sintetizado"
```

---

### Task 6: Ligação com reconexão

**Files:**
- Create: `web/comum/ligacao.js`
- Test: `src/ligacao.test.ts` (testa só a política de espera, que é pura)

**Interfaces:**
- Consumes: nada.
- Produces: `ligar({ papel, turma, aoRetrato, aoEstadoDaRede })` devolvendo `{ enviar(comando), fechar() }`; e `esperaDaTentativa(tentativa: number): number` em `src/espera.ts`.
- **Duplicação consciente.** A política de espera existe duas vezes: em `src/espera.ts`, que Node consegue testar, e dentro de `web/comum/ligacao.js`, que o navegador consegue importar. O navegador não importa `.ts`. É o mesmo arranjo de `busca.ts` e `busca.js` na Task 8. As duas cópias têm que mudar juntas.

- [ ] **Step 1: Escrever `src/espera.ts` e `src/espera.test.ts`**

```ts
export function esperaDaTentativa(tentativa: number): number {
  const base = Math.min(500 * 2 ** tentativa, 10_000)
  return base
}
```

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { esperaDaTentativa } from './espera.ts'

test('a primeira retentativa e quase imediata', () => {
  assert.equal(esperaDaTentativa(0), 500)
})

test('a espera dobra a cada tentativa', () => {
  assert.equal(esperaDaTentativa(1), 1000)
  assert.equal(esperaDaTentativa(2), 2000)
})

test('a espera tem teto de dez segundos', () => {
  assert.equal(esperaDaTentativa(20), 10_000)
})
```

Run: `npm test`
Expected: PASS, 26 testes no total.

- [ ] **Step 2: Escrever `web/comum/ligacao.js`**

```js
const TETO = 10000

function espera(tentativa) {
  return Math.min(500 * 2 ** tentativa, TETO)
}

export function ligar({ papel, turma, aoRetrato, aoEstadoDaRede }) {
  let ws = null
  let tentativa = 0
  let vivo = true

  function abrir() {
    if (!vivo) return
    const protocolo = location.protocol === 'https:' ? 'wss' : 'ws'
    const params = new URLSearchParams({ papel })
    if (turma) params.set('turma', turma)
    ws = new WebSocket(`${protocolo}://${location.host}/ws?${params}`)

    ws.onopen = () => { tentativa = 0; aoEstadoDaRede?.('ligado') }
    ws.onmessage = (evento) => {
      const dado = JSON.parse(evento.data)
      if (dado.tipo === 'retrato') aoRetrato(dado)
    }
    ws.onclose = () => {
      aoEstadoDaRede?.('desligado')
      if (!vivo) return
      setTimeout(abrir, espera(tentativa++))
    }
    ws.onerror = () => ws?.close()
  }

  abrir()

  return {
    enviar(comando) {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(comando))
    },
    fechar() { vivo = false; ws?.close() },
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add "projeto portaria janelinhas/src" "projeto portaria janelinhas/web"
git commit -m "Cliente de WebSocket com retentativa de espera crescente"
```

---

### Task 7: Tela da sala

**Files:**
- Modify: `web/sala/index.html` (substitui o provisório da Task 1)

**Interfaces:**
- Consumes: `criarJanelinha` de `janelinha.js`; `ligar` de `ligacao.js`; `destravar`, `tocarAbertura`, `tocarEntrega`, `alternarMudo` de `som.js`.
- Produces: nada consumido por outras tarefas.

- [ ] **Step 1: Escrever a tela**

Regras que a tela precisa cumprir, e que o revisor vai checar: uma janelinha por vez; a turma vem da query string (`/sala/?turma=Jardim%20II`); um botão "entrar na sala" que destrava o áudio antes de qualquer som; botão de mudo sempre visível; tocar na janelinha envia `liberar`.

```html
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sala — Janelinhas do Saber</title>
  <link rel="stylesheet" href="../comum/tokens.css">
  <style>
    body { margin: 0; background: var(--papel); font-family: system-ui, sans-serif;
           min-height: 100vh; display: grid; place-items: center; color: var(--tinta); }
    .palco { width: min(90vw, 460px); text-align: center; }
    .vazio { color: var(--tinta-suave); }
    .fila { color: var(--tinta-suave); font-size: 0.9rem; min-height: 1.4em; }
    button { font: inherit; padding: 0.7rem 1.2rem; border-radius: 8px;
             border: 2px solid var(--moldura); background: var(--papel); cursor: pointer; }
    .liberar { background: var(--moldura); color: #fff; width: 100%; margin-top: 1rem; }
    .barra { position: fixed; top: 1rem; right: 1rem; }
    .rede { position: fixed; bottom: 1rem; left: 1rem; font-size: 0.8rem; color: var(--tinta-suave); }
  </style>
</head>
<body>
  <div class="palco" id="palco">
    <button id="entrar">Entrar na sala</button>
  </div>
  <div class="barra"><button id="mudo">Som ligado</button></div>
  <div class="rede" id="rede">ligando…</div>

  <script type="module">
    import { criarJanelinha } from '../comum/janelinha.js'
    import { ligar } from '../comum/ligacao.js'
    import { destravar, tocarAbertura, tocarEntrega, alternarMudo } from '../comum/som.js'

    const turma = new URLSearchParams(location.search).get('turma') ?? 'Jardim II'
    const palco = document.getElementById('palco')
    const rede = document.getElementById('rede')
    let atual = null
    let ultimoId = null
    let ultimoEstado = null
    let conexao = null

    document.getElementById('mudo').onclick = (e) => {
      e.target.textContent = alternarMudo() ? 'Som desligado' : 'Som ligado'
    }

    document.getElementById('entrar').onclick = () => {
      destravar()
      palco.innerHTML = `<p class="vazio">Nenhuma chamada agora.</p><p class="fila"></p>`
      conexao = ligar({
        papel: 'sala',
        turma,
        aoEstadoDaRede: (e) => { rede.textContent = e === 'ligado' ? 'ligado' : 'religando…' },
        aoRetrato: desenhar,
      })
    }

    function desenhar(retrato) {
      const ativas = retrato.chamadas
        .filter((c) => c.estado === 'chamado' || c.estado === 'liberado')
        .sort((a, b) => a.em - b.em)
      const vez = ativas[0]

      if (!vez) {
        palco.innerHTML = `<p class="vazio">Nenhuma chamada agora.</p><p class="fila"></p>`
        atual = null; ultimoId = null; ultimoEstado = null
        return
      }

      if (vez.alunoId !== ultimoId) {
        ultimoId = vez.alunoId
        ultimoEstado = null
        palco.innerHTML = ''
        atual = criarJanelinha({ nome: vez.nome, turma: vez.turma })
        atual.definirEstado('aguardando')
        palco.append(atual)
        const botao = document.createElement('button')
        botao.className = 'liberar'
        botao.textContent = 'Liberar saída'
        botao.onclick = () => conexao.enviar({ tipo: 'liberar', alunoId: vez.alunoId })
        palco.append(botao)
        const fila = document.createElement('p')
        fila.className = 'fila'
        palco.append(fila)
      }

      if (vez.estado !== ultimoEstado) {
        requestAnimationFrame(() => atual.definirEstado(vez.estado))
        if (vez.estado === 'chamado') tocarAbertura()
        if (vez.estado === 'liberado') tocarEntrega()
        ultimoEstado = vez.estado
      }

      palco.querySelector('.fila').textContent =
        ativas.length > 1 ? `mais ${ativas.length - 1} na fila` : ''
    }
  </script>
</body>
</html>
```

- [ ] **Step 2: Conferir com o olho**

Run: `npm run dev`
Abrir `http://localhost:8787/sala/?turma=Maternal`, clicar "Entrar na sala".
Em outro terminal, simular uma chamada com `websocat` **ou** aguardar a Task 8 e usar a portaria de verdade. Se `websocat` não estiver disponível, pular a verificação manual aqui e fazê-la ao fim da Task 8.
Expected: a janelinha aparece fechada e abre em 380ms com som.

- [ ] **Step 3: Commit**

```bash
git add "projeto portaria janelinhas/web/sala/index.html"
git commit -m "Tela da sala: uma janelinha por vez, som destravado por gesto"
```

---

### Task 8: Tela da portaria e o primeiro fim-a-fim

**Files:**
- Create: `web/portaria/index.html`
- Create: `src/index.ts` rota `/alunos` (a portaria precisa da lista para buscar)
- Modify: `src/portaria.ts` (expor `alunos()` no `Livro`)

**Interfaces:**
- Consumes: `buscar` de `busca.ts` (via uma cópia em `web/comum/busca.js`, já que o navegador não importa `.ts`).
- Produces: o ciclo completo funcionando entre dois aparelhos.

- [ ] **Step 1: Expor a lista de alunos pela rede**

O método `Livro.alunos()` já existe desde a Task 4. Falta só a rota. Acrescentar em
`Portaria.fetch`, antes do tratamento de `/ws`:

```ts
    if (url.pathname === '/alunos') return Response.json(this.livro.alunos())
```

E em `src/index.ts`, incluir `/alunos` na lista de caminhos encaminhados ao Durable Object.

- [ ] **Step 2: Criar `web/comum/busca.js`** — a mesma regra da `busca.ts`, em JavaScript, para o navegador

```js
export function normalizar(texto) {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim().replace(/\s+/g, ' ')
}

export function buscar(alunos, consulta, limite = 8) {
  const termos = normalizar(consulta).split(' ').filter(Boolean)
  if (termos.length === 0) return []
  return alunos.filter((aluno) => {
    const partes = normalizar(aluno.nome).split(' ')
    return termos.every((termo) => partes.some((parte) => parte.startsWith(termo)))
  }).slice(0, limite)
}
```

- [ ] **Step 3: Escrever `web/portaria/index.html`**

```html
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Portaria — Janelinhas do Saber</title>
  <link rel="stylesheet" href="../comum/tokens.css">
  <style>
    body { margin: 0; background: var(--papel); font-family: system-ui, sans-serif;
           color: var(--tinta); padding: 1rem; max-width: 520px; margin-inline: auto; }
    input { width: 100%; font: inherit; padding: 0.8rem; border-radius: 8px;
            border: 2px solid var(--moldura); box-sizing: border-box; }
    ul { list-style: none; padding: 0; }
    li { display: flex; align-items: center; gap: 0.7rem; padding: 0.6rem;
         border-bottom: 1px solid var(--vidro-fosco); }
    li svg { width: 38px; height: 38px; flex: none; }
    .nome { flex: 1; }
    .estado { font-size: 0.8rem; color: var(--tinta-suave); }
    button { font: inherit; padding: 0.4rem 0.8rem; border-radius: 6px;
             border: 2px solid var(--moldura); background: var(--papel); cursor: pointer; }
    h2 { font-size: 1rem; color: var(--tinta-suave); margin: 1.4rem 0 0.3rem; }
    .rede { font-size: 0.8rem; color: var(--tinta-suave); }
  </style>
</head>
<body>
  <p class="rede" id="rede">ligando…</p>
  <input id="consulta" placeholder="Nome da criança" autocomplete="off">
  <ul id="resultados"></ul>
  <h2>Em saída</h2>
  <ul id="ativas"></ul>

  <script type="module">
    import { buscar } from '../comum/busca.js'
    import { retratoDe } from '../comum/avatar.js'
    import { ligar } from '../comum/ligacao.js'

    const rede = document.getElementById('rede')
    let alunos = []
    let ativas = []

    const conexao = ligar({
      papel: 'portaria',
      aoEstadoDaRede: (e) => { rede.textContent = e === 'ligado' ? 'ligado' : 'religando…' },
      aoRetrato: (r) => { ativas = r.chamadas; desenharAtivas() },
    })

    fetch('/alunos').then((r) => r.json()).then((lista) => { alunos = lista })

    document.getElementById('consulta').oninput = (e) => {
      const achados = buscar(alunos, e.target.value)
      const ul = document.getElementById('resultados')
      ul.innerHTML = ''
      for (const aluno of achados) {
        const li = document.createElement('li')
        li.append(retratoDe(aluno.nome))
        const nome = document.createElement('span')
        nome.className = 'nome'
        nome.textContent = `${aluno.nome} · ${aluno.turma}`
        const botao = document.createElement('button')
        botao.textContent = 'Chamar'
        botao.onclick = () => {
          conexao.enviar({ tipo: 'chamar', alunoId: aluno.id })
          document.getElementById('consulta').value = ''
          ul.innerHTML = ''
        }
        li.append(nome, botao)
        ul.append(li)
      }
    }

    function desenharAtivas() {
      const ul = document.getElementById('ativas')
      ul.innerHTML = ''
      for (const c of [...ativas].sort((a, b) => a.em - b.em)) {
        const li = document.createElement('li')
        li.append(retratoDe(c.nome))
        const nome = document.createElement('span')
        nome.className = 'nome'
        nome.innerHTML = `${c.nome}<br><span class="estado">${c.turma} · ${c.estado}</span>`
        li.append(nome)
        if (c.estado === 'chamado') {
          const cancelar = document.createElement('button')
          cancelar.textContent = 'Cancelar'
          cancelar.onclick = () => conexao.enviar({ tipo: 'cancelar', alunoId: c.alunoId })
          li.append(cancelar)
        }
        if (c.estado === 'liberado') {
          const entregar = document.createElement('button')
          entregar.textContent = 'Entregar'
          entregar.onclick = () => conexao.enviar({ tipo: 'entregar', alunoId: c.alunoId })
          li.append(entregar)
        }
        ul.append(li)
      }
    }
  </script>
</body>
</html>
```

- [ ] **Step 4: Rodar o fim-a-fim de verdade**

Run: `npm run typecheck` — sem erro.
Run: `npm test` — todos passam.
Run: `npm run dev`.
Abrir `http://localhost:8787/portaria/` numa aba e `http://localhost:8787/sala/?turma=Maternal` noutra.
Expected: buscar "joao" acha "João Conceição"; tocar "Chamar" abre a janelinha na aba da sala com som; "Liberar saída" muda o estado nas duas abas; "Entregar" fecha o ciclo. Uma criança de outra turma **não** aparece na sala do Maternal.

- [ ] **Step 5: Commit**

```bash
git add "projeto portaria janelinhas"
git commit -m "Tela da portaria e o ciclo completo entre dois aparelhos"
```

---

### Task 9: Modo demo à prova de wifi

**Files:**
- Create: `web/demo/index.html`

**Interfaces:**
- Consumes: `criarJanelinha`, `retratoDe`, `buscar`, `som.js`. **Não** consome `ligacao.js` — este é o ponto.
- Produces: uma página que funciona com o cabo de rede desconectado.

- [ ] **Step 1: Copiar a regra de estados para o navegador**

Create `web/comum/estados.js` com exatamente a mesma tabela de `src/estados.ts`:

```js
const MAPA = {
  aguardando: { chamar: 'chamado' },
  chamado: { liberar: 'liberado', cancelar: 'aguardando' },
  liberado: { entregar: 'entregue' },
}

export class TransicaoInvalida extends Error {
  constructor(de, acao) {
    super(`nao e possivel "${acao}" a partir de "${de}"`)
    this.name = 'TransicaoInvalida'
    this.de = de
    this.acao = acao
  }
}

export function proximo(de, acao) {
  const destino = MAPA[de]?.[acao]
  if (!destino) throw new TransicaoInvalida(de, acao)
  return destino
}
```

- [ ] **Step 2: Escrever `web/demo/index.html` com as duas colunas**

A lista vem embutida — `fetch('/alunos')` exigiria servidor, e o ponto desta página é não ter servidor.

```html
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Demo — Janelinhas do Saber</title>
  <link rel="stylesheet" href="../comum/tokens.css">
  <style>
    body { margin: 0; background: var(--papel); font-family: system-ui, sans-serif;
           color: var(--tinta); display: grid; grid-template-columns: 1fr 1fr;
           min-height: 100vh; }
    section { padding: 1.5rem; }
    section + section { border-left: 3px dashed var(--vidro-fosco); }
    h1 { font-size: 1rem; color: var(--tinta-suave); text-transform: uppercase;
         letter-spacing: 0.08em; margin: 0 0 1rem; }
    ul { list-style: none; padding: 0; }
    li { display: flex; align-items: center; gap: 0.6rem; padding: 0.5rem 0;
         border-bottom: 1px solid var(--vidro-fosco); }
    li svg { width: 34px; height: 34px; flex: none; }
    .nome { flex: 1; font-size: 0.95rem; }
    button { font: inherit; padding: 0.35rem 0.7rem; border-radius: 6px;
             border: 2px solid var(--moldura); background: var(--papel); cursor: pointer; }
    .palco { display: grid; place-items: center; min-height: 60vh; text-align: center; }
    .palco > div { width: min(80%, 320px); }
  </style>
</head>
<body>
  <section>
    <h1>Portaria</h1>
    <ul id="cadastro"></ul>
    <h1 style="margin-top:2rem">Em saída</h1>
    <ul id="ativas"></ul>
  </section>
  <section>
    <h1>Sala</h1>
    <div class="palco" id="palco"><p>Nenhuma chamada agora.</p></div>
  </section>

  <script type="module">
    import { proximo } from '../comum/estados.js'
    import { criarJanelinha } from '../comum/janelinha.js'
    import { retratoDe } from '../comum/avatar.js'
    import { destravar, tocarAbertura, tocarEntrega } from '../comum/som.js'

    const ALUNOS = [
      { id: 'd1', nome: 'Thaís Gonçalves', turma: 'Jardim II' },
      { id: 'd2', nome: 'João Conceição', turma: 'Jardim II' },
      { id: 'd3', nome: 'Lara Mendonça', turma: 'Jardim II' },
      { id: 'd4', nome: 'Ravi Bacelar', turma: 'Jardim II' },
      { id: 'd5', nome: 'Íris Pacheco', turma: 'Jardim II' },
      { id: 'd6', nome: 'Théo Marçal', turma: 'Jardim II' },
    ]

    const chamadas = new Map()
    let relogio = 0
    let atual = null, ultimoId = null, ultimoEstado = null

    function aplicar(alunoId, acao) {
      const aluno = ALUNOS.find((a) => a.id === alunoId)
      const de = chamadas.get(alunoId)?.estado ?? 'aguardando'
      const para = proximo(de, acao)
      if (para === 'aguardando') chamadas.delete(alunoId)
      else chamadas.set(alunoId, { ...aluno, alunoId, estado: para, em: ++relogio })
      desenhar()
    }

    function desenhar() {
      const ativas = [...chamadas.values()].sort((a, b) => a.em - b.em)

      const ul = document.getElementById('ativas')
      ul.innerHTML = ''
      for (const c of ativas) {
        const li = document.createElement('li')
        li.append(retratoDe(c.nome))
        const nome = document.createElement('span')
        nome.className = 'nome'
        nome.textContent = `${c.nome} · ${c.estado}`
        li.append(nome)
        if (c.estado === 'chamado') li.append(botao('Cancelar', () => aplicar(c.alunoId, 'cancelar')))
        if (c.estado === 'liberado') li.append(botao('Entregar', () => aplicar(c.alunoId, 'entregar')))
        ul.append(li)
      }

      const palco = document.getElementById('palco')
      const vez = ativas.find((c) => c.estado === 'chamado' || c.estado === 'liberado')
      if (!vez) {
        palco.innerHTML = '<p>Nenhuma chamada agora.</p>'
        atual = null; ultimoId = null; ultimoEstado = null
        return
      }
      if (vez.alunoId !== ultimoId) {
        ultimoId = vez.alunoId; ultimoEstado = null
        palco.innerHTML = ''
        const caixa = document.createElement('div')
        atual = criarJanelinha({ nome: vez.nome, turma: vez.turma })
        atual.definirEstado('aguardando')
        caixa.append(atual, botao('Liberar saída', () => aplicar(vez.alunoId, 'liberar')))
        palco.append(caixa)
      }
      if (vez.estado !== ultimoEstado) {
        requestAnimationFrame(() => atual.definirEstado(vez.estado))
        if (vez.estado === 'chamado') tocarAbertura()
        if (vez.estado === 'liberado') tocarEntrega()
        ultimoEstado = vez.estado
      }
    }

    function botao(texto, aoTocar) {
      const b = document.createElement('button')
      b.textContent = texto
      b.onclick = () => { destravar(); aoTocar() }
      return b
    }

    const cadastro = document.getElementById('cadastro')
    for (const aluno of ALUNOS) {
      const li = document.createElement('li')
      li.append(retratoDe(aluno.nome))
      const nome = document.createElement('span')
      nome.className = 'nome'
      nome.textContent = aluno.nome
      li.append(nome, botao('Chamar', () => aplicar(aluno.id, 'chamar')))
      cadastro.append(li)
    }
  </script>
</body>
</html>
```

- [ ] **Step 3: Verificar sem servidor**

Run: parar o `wrangler dev`. Abrir o arquivo direto pelo navegador.
Expected: funciona igual. A aba de rede do navegador não mostra nenhuma requisição além dos arquivos locais.

- [ ] **Step 4: Commit**

```bash
git add "projeto portaria janelinhas/web"
git commit -m "Modo demo local, sem rede, para quando o wifi da escola cair"
```

---

### Task 10: Importação por planilha

Segunda prioridade do spec. Só começa depois da Task 9 verde. Existe porque mata a objeção
número um da escola — "vai dar trabalho cadastrar todo mundo" — e é o que o print da
reportagem mostra: 292 alunos, 0 duplicados, 0 erros.

**Files:**
- Create: `src/importar.ts`, `src/importar.test.ts`
- Modify: `web/portaria/index.html` (botão e painel de importação)
- Modify: `src/portaria.ts` (rota `POST /importar`)

**Interfaces:**
- Consumes: `Aluno`, `Turma`, `TURMAS` de `semente.ts`; `normalizar` de `busca.ts`.
- Produces: `analisar(csv: string): Resultado` onde `Resultado` é `{ alunos: Aluno[]; duplicados: number; erros: Erro[] }` e `Erro` é `{ linha: number; motivo: string }`.

- [ ] **Step 1: Escrever `src/importar.test.ts`**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analisar } from './importar.ts'

const CABECALHO = 'Nome,Turma'

test('importa linhas validas', () => {
  const r = analisar(`${CABECALHO}\nThaís Gonçalves,Jardim II\nJoão Conceição,Maternal`)
  assert.equal(r.alunos.length, 2)
  assert.equal(r.erros.length, 0)
  assert.equal(r.duplicados, 0)
  assert.equal(r.alunos[0].nome, 'Thaís Gonçalves')
  assert.equal(r.alunos[0].turma, 'Jardim II')
})

test('conta duplicado por nome e turma, sem importar duas vezes', () => {
  const r = analisar(`${CABECALHO}\nLara Mendonça,Maternal\nlara  mendonca,Maternal`)
  assert.equal(r.alunos.length, 1)
  assert.equal(r.duplicados, 1)
})

test('mesmo nome em turmas diferentes nao e duplicado', () => {
  const r = analisar(`${CABECALHO}\nLara Mendonça,Maternal\nLara Mendonça,Jardim I`)
  assert.equal(r.alunos.length, 2)
  assert.equal(r.duplicados, 0)
})

test('turma desconhecida vira erro com o numero da linha', () => {
  const r = analisar(`${CABECALHO}\nAna Souza,Sexto Ano`)
  assert.equal(r.alunos.length, 0)
  assert.equal(r.erros.length, 1)
  assert.equal(r.erros[0].linha, 2)
  assert.match(r.erros[0].motivo, /turma/i)
})

test('nome vazio vira erro', () => {
  const r = analisar(`${CABECALHO}\n   ,Maternal`)
  assert.equal(r.erros.length, 1)
  assert.match(r.erros[0].motivo, /nome/i)
})

test('cabecalho sem a coluna Nome e recusado inteiro', () => {
  const r = analisar('Aluno,Turma\nAna,Maternal')
  assert.equal(r.alunos.length, 0)
  assert.equal(r.erros[0].linha, 1)
})

test('aceita ponto e virgula, que e o que o Excel brasileiro exporta', () => {
  const r = analisar('Nome;Turma\nAna Souza;Maternal')
  assert.equal(r.alunos.length, 1)
})

test('ignora colunas extras da planilha da escola', () => {
  const csv = 'Nome,Data Nascimento,Turno,Turma,Responsável 1\nAna Souza,2020-03-01,Manhã,Maternal,Marina'
  const r = analisar(csv)
  assert.equal(r.alunos.length, 1)
  assert.equal(r.alunos[0].turma, 'Maternal')
})

test('linhas em branco sao ignoradas, nao viram erro', () => {
  const r = analisar(`${CABECALHO}\nAna Souza,Maternal\n\n\n`)
  assert.equal(r.alunos.length, 1)
  assert.equal(r.erros.length, 0)
})

test('ids gerados sao unicos', () => {
  const r = analisar(`${CABECALHO}\nAna Souza,Maternal\nBia Lima,Maternal`)
  assert.equal(new Set(r.alunos.map((a) => a.id)).size, 2)
})
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npm test`
Expected: FAIL — `./importar.ts` não existe.

- [ ] **Step 3: Implementar `src/importar.ts`**

```ts
import { TURMAS, type Aluno, type Turma } from './semente.ts'
import { normalizar } from './busca.ts'

export interface Erro { linha: number; motivo: string }
export interface Resultado { alunos: Aluno[]; duplicados: number; erros: Erro[] }

function separar(linha: string): string[] {
  const separador = linha.includes(';') ? ';' : ','
  return linha.split(separador).map((c) => c.trim())
}

export function analisar(csv: string): Resultado {
  const linhas = csv.split(/\r?\n/)
  const alunos: Aluno[] = []
  const erros: Erro[] = []
  const vistos = new Set<string>()
  let duplicados = 0

  const cabecalho = separar(linhas[0] ?? '').map((c) => normalizar(c))
  const iNome = cabecalho.indexOf('nome')
  const iTurma = cabecalho.indexOf('turma')
  if (iNome === -1 || iTurma === -1) {
    return { alunos, duplicados, erros: [{ linha: 1, motivo: 'a planilha precisa das colunas Nome e Turma' }] }
  }

  for (let i = 1; i < linhas.length; i++) {
    if (linhas[i].trim() === '') continue
    const campos = separar(linhas[i])
    const nome = (campos[iNome] ?? '').trim()
    const turmaBruta = (campos[iTurma] ?? '').trim()

    if (nome === '') { erros.push({ linha: i + 1, motivo: 'nome vazio' }); continue }
    const turma = TURMAS.find((t) => normalizar(t) === normalizar(turmaBruta))
    if (!turma) { erros.push({ linha: i + 1, motivo: `turma desconhecida: "${turmaBruta}"` }); continue }

    const chave = `${normalizar(nome)}|${turma}`
    if (vistos.has(chave)) { duplicados++; continue }
    vistos.add(chave)
    alunos.push({ id: `i${String(alunos.length + 1).padStart(3, '0')}`, nome, turma: turma as Turma })
  }

  return { alunos, duplicados, erros }
}
```

- [ ] **Step 4: Rodar para ver passar**

Run: `npm test`
Expected: PASS. Total acumulado: 36 testes.

- [ ] **Step 5: Ligar à portaria**

Rota em `Portaria.fetch`, antes de `/ws`:

```ts
    if (url.pathname === '/importar' && pedido.method === 'POST') {
      const csv = await pedido.text()
      const resultado = analisar(csv)
      if (resultado.alunos.length > 0) this.livro.substituirCadastro(resultado.alunos)
      return Response.json({
        alunos: resultado.alunos.length,
        duplicados: resultado.duplicados,
        erros: resultado.erros,
      })
    }
```

E no `Livro`:

```ts
  substituirCadastro(alunos: Aluno[]): void {
    this.cadastro.clear()
    this.chamadas.clear()
    for (const aluno of alunos) this.cadastro.set(aluno.id, aluno)
  }
```

A trilha de auditoria **não** é limpa: ela é append-only, e apagá-la ao trocar o cadastro seria
exatamente o furo que ela existe para tapar.

- [ ] **Step 6: Painel na tela da portaria**

Um `<details>` com um `<textarea>` para colar a planilha e um botão "Importar". A resposta
aparece no formato do print da reportagem: três números lado a lado — alunos, duplicados,
erros. Se houver erros, listar linha e motivo, no máximo dez, com "e mais N" abaixo.

Deixar visível o aviso que aparece no app de referência: **a planilha não carrega consentimento
LGPD.** Texto exato a usar: "Esta planilha traz nome e turma. Consentimento de imagem e dados
do responsável não vêm dela — a escola trata isso à parte."

- [ ] **Step 7: Commit**

```bash
git add "projeto portaria janelinhas"
git commit -m "Importacao por planilha: analisador testado e painel na portaria"
```

---

## Passagens adversariais

Depois das Tasks 4, 8 e 9 — os três pontos onde algo de verdade passa a funcionar — rodar duas passagens separadas, com contextos independentes:

**Red team.** Procurar o furo, sem consertar. Foco em: uma criança liberada sem responsável no portão; uma sala vendo aluno de outra turma; retrato desatualizado depois de reconectar; duas chamadas simultâneas embaralhando a fila; comando com `alunoId` inventado; mensagem malformada derrubando o Durable Object.

**Blue team.** Consertar o que o red team achou, e deixar **um teste de regressão por achado**. Um achado sem teste não está consertado — está esquecido.
