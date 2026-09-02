import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ACOES, DONO, RAZOES_RETORNO, proximo, TransicaoInvalida } from './estados.ts'
import { buscar, normalizar } from './busca.ts'

/*
  A maquina de estados existe DUAS vezes: em `src/estados.ts`, para o servidor,
  e em `web/comum/estados.js`, para o modo demonstracao rodar sem servidor
  nenhum. A copia do navegador e inlinada no arquivo unico offline pelo
  `construir-demo.mjs`.

  O cabecalho da copia sempre disse "as duas copias tem que mudar juntas". Isso
  e um pedido, nao uma barreira, e a pessoa que esquecer nao vai ler o
  cabecalho — vai descobrir na frente da escola, com o botao lancando
  TransicaoInvalida ou, pior, com a demonstracao mostrando um produto que nao
  existe mais.

  Este arquivo le a copia como TEXTO e compara com o modulo de verdade. E feio
  de proposito: parsear e o preco de nao poder importar TypeScript de dentro de
  um .js sem etapa de build, e uma etapa de build so para isto contradiria o
  invariante de front sem framework.
*/

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const COPIA = readFileSync(join(RAIZ, 'web', 'comum', 'estados.js'), 'utf8')

/** Le um array de strings declarado como `export const NOME = [...]`. */
function listaDe(nome: string): string[] {
  const bloco = COPIA.match(new RegExp('export const ' + nome + ' = \\[([^\\]]*)\\]'))
  assert.ok(bloco, `nao achei ${nome} em web/comum/estados.js`)
  return [...bloco![1].matchAll(/'([^']+)'/g)].map((m) => m[1])
}

/** Le um objeto plano declarado como `export const NOME = { ... }`. */
function mapaDe(nome: string): Record<string, string> {
  const i = COPIA.indexOf(`export const ${nome} = {`)
  assert.ok(i >= 0, `nao achei ${nome} em web/comum/estados.js`)
  const corpo = COPIA.slice(i, COPIA.indexOf('\n}', i))
  const saida: Record<string, string> = {}
  for (const m of corpo.matchAll(/^\s*([a-z]+):\s*'([^']+)'/gm)) saida[m[1]] = m[2]
  return saida
}

test('a copia do navegador conhece as mesmas ACOES', () => {
  assert.deepEqual(listaDe('ACOES').sort(), [...ACOES].sort())
})

test('a copia do navegador atribui os mesmos DONOS', () => {
  assert.deepEqual(mapaDe('DONO'), { ...DONO })
})

test('a copia do navegador conhece as mesmas RAZOES', () => {
  assert.deepEqual(listaDe('RAZOES_RETORNO').sort(), [...RAZOES_RETORNO].sort())
})

test('a copia do navegador tem as mesmas transicoes, aresta por aresta', () => {
  /*
    Compara o comportamento, nao o texto: para cada par (estado, acao), ou as
    duas devolvem o mesmo destino, ou as duas recusam.
  */
  const ESTADOS = ['aguardando', 'chamado', 'liberado', 'retorno', 'entregue'] as const

  const bloco = COPIA.slice(COPIA.indexOf('const MAPA ='))
  const daCopia = (de: string, acao: string): string | null => {
    const linha = bloco.match(new RegExp('^\\s*' + de + ':[^\\n]*', 'm'))
    if (!linha) return null
    const par = linha[0].match(new RegExp(acao + ":\\s*'([a-z]+)'"))
    return par ? par[1] : null
  }

  for (const de of ESTADOS) {
    for (const acao of ACOES) {
      let doServidor: string | null = null
      try {
        doServidor = proximo(de, acao)
      } catch (erro) {
        assert.ok(erro instanceof TransicaoInvalida)
      }
      assert.equal(
        daCopia(de, acao),
        doServidor,
        `divergencia em ${de} + ${acao}: servidor diz ${doServidor}, copia diz ${daCopia(de, acao)}`,
      )
    }
  }
})

/*
  A busca tambem existe duas vezes, e a divergencia aqui e mais sorrateira que a
  da maquina de estados: nao lanca erro nenhum. A portaria acharia por uma
  regra e o servidor guardaria por outra, e o sintoma seria "a crianca sumiu da
  busca" num aparelho so.

  Aqui a comparacao e por COMPORTAMENTO. Importar o .js de dentro do teste e o
  unico jeito de comparar as duas implementacoes rodando — parsear texto diria
  se as letras batem, nao se as regras batem.
*/

const CADASTRO = [
  { id: 'a', nome: 'Maria Eduarda Nogueira', turma: 'Pré 1' },
  { id: 'b', nome: 'Maria Eduarda Nogueira', turma: '9º ano' },
  { id: 'c', nome: 'Thaís Sant\'Ana', turma: '3º ano' },
  { id: 'd', nome: 'THAIS SANTANA', turma: '5º ano' },
  { id: 'e', nome: 'Ana-Clara D\'Ávila', turma: '7º ano' },
  { id: 'f', nome: 'Silvana Rocha', turma: '2º ano' },
  { id: 'g', nome: 'Beatriz Silva', turma: '4º ano' },
  { id: 'h', nome: 'Ana Silva', turma: '6º ano' },
] as const

const CONSULTAS = [
  '', ' ', 'a', 'ana', 'ANA', 'thais', 'Thaís', 'santana', "sant'ana",
  'ana clara', 'm e n', 'maria nog', 'silva', 'nogueira', 'zzz', 'ana-clara',
]

test('a copia do navegador busca exatamente igual ao servidor', async () => {
  const daCopia = await import('../web/comum/busca.js')

  for (const consulta of CONSULTAS) {
    const doServidor = buscar([...CADASTRO] as never, consulta)
    const doNavegador = daCopia.buscar([...CADASTRO], consulta)

    assert.deepEqual(
      doNavegador.achados.map((a: { id: string }) => a.id),
      doServidor.achados.map((a) => a.id),
      `achados divergem para "${consulta}"`,
    )
    assert.equal(doNavegador.total, doServidor.total, `total diverge para "${consulta}"`)
    assert.deepEqual(
      doNavegador.homonimos,
      doServidor.homonimos,
      `homonimos divergem para "${consulta}"`,
    )
  }
})

test('a copia do navegador normaliza exatamente igual', async () => {
  const daCopia = await import('../web/comum/busca.js')
  const nomes = [
    ...CADASTRO.map((a) => a.nome),
    "D'Alessandro", 'José-Maria', 'Ana  Clara', '  Thaís  ', 'MARÇAL',
  ]
  for (const nome of nomes) {
    assert.equal(daCopia.normalizar(nome), normalizar(nome), `normalizacao diverge em "${nome}"`)
  }
})

test('cada separador de nome vira espaco nos DOIS lados', async () => {
  /*
    Apostrofos sao visualmente identicos entre si, e as duas copias divergiam
    em U+02BC sem lancar erro em lugar nenhum: uma tratava como separador e a
    outra nao. O sintoma seria "a crianca some da busca" num aparelho so, sem
    nada no log.
  */
  const daCopia = await import('../web/comum/busca.js')
  const SEPARADORES = [0x27, 0x2018, 0x2019, 0x02bc, 0x2d, 0x2013, 0x2014, 0x2e]

  for (const codigo of SEPARADORES) {
    const nome = `Sant${String.fromCodePoint(codigo)}Ana`
    assert.equal(
      normalizar(nome),
      'sant ana',
      `U+${codigo.toString(16).padStart(4, '0')} nao vira espaco no servidor`,
    )
    assert.equal(
      daCopia.normalizar(nome),
      normalizar(nome),
      `U+${codigo.toString(16).padStart(4, '0')} diverge entre as copias`,
    )
  }
})
