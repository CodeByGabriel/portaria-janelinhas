import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Livro } from './livro.ts'
import { semear, responsaveisDaSemente } from './semente.ts'
import { idDeResponsavel } from './responsaveis.ts'

/*
  Buscar pelo nome de QUEM CHEGOU no portao.

  "Sou a mae da Alice" e o que se ouve de verdade, e o adulto que busca dois
  filhos em turmas diferentes teria de ser procurado duas vezes, pelo nome de
  cada crianca, com a porteira lembrando de cor quem e irmao de quem.

  O que estes testes guardam: os filhos certos, o impedido VISIVEL e marcado
  (some-lo faria a porteira concluir que aquela crianca nao e daquele adulto),
  e a mesma busca da crianca — acento, apostrofo, corte e aviso de homonimo.
*/

function comFamilias(): Livro {
  const livro = new Livro()
  const familias = responsaveisDaSemente()
  livro.substituirResponsaveis(familias.responsaveis, familias.vinculos)
  return livro
}

const nomes = (r: { achados: { nome: string }[] }) => r.achados.map((a) => a.nome)

test('acha o adulto pelo nome e devolve os filhos dele, em ordem', () => {
  const livro = comFamilias()
  const r = livro.quemBusca('marta')
  assert.deepEqual(nomes(r), ['Marta Fernandes'])
  assert.deepEqual(
    r.achados[0].filhos.map((f) => `${f.nome} (${f.turma})`),
    ['Alice Fernandes (Pré 1)', 'Maria Eduarda Nogueira (1º ano)', 'Maria Eduarda Nogueira (6º ano)'],
  )
  // O telefone e o vinculo vem junto: e por eles que a porteira confere quem e.
  assert.equal(r.achados[0].vinculo, 'mãe')
  assert.ok(r.achados[0].telefone.length > 0)
})

test('o filho IMPEDIDO aparece na lista, marcado como impedido', () => {
  const livro = comFamilias()
  const ricardo = livro.quemBusca('ricardo').achados[0]
  const alice = ricardo.filhos.find((f) => f.nome === 'Alice Fernandes')
  assert.ok(alice, 'a crianca impedida sumiu da lista')
  assert.equal(alice.impedido, true)
  // E as outras do mesmo adulto seguem liberadas: o impedimento e por PAR.
  assert.deepEqual(
    ricardo.filhos.filter((f) => !f.impedido).map((f) => f.turma),
    ['1º ano', '6º ano'],
  )
})

test('a restricao da crianca viaja junto, para a caixa interromper antes de chamar', () => {
  const livro = comFamilias()
  const zuleide = livro.quemBusca('zuleide').achados[0]
  assert.equal(zuleide.filhos.length, 1)
  assert.equal(zuleide.filhos[0].nome, 'Ravi Bacelar')
  assert.equal(zuleide.filhos[0].temAlerta, true)
})

test('e a mesma busca da crianca: acento, sobrenome, iniciais e caixa', () => {
  const livro = comFamilias()
  for (const consulta of ['MARTA', 'fernandes marta', 'marta fern', '  marta  ']) {
    assert.deepEqual(nomes(livro.quemBusca(consulta)), ['Marta Fernandes'], consulta)
  }
  assert.deepEqual(nomes(livro.quemBusca('zuleide bacelar')), ['Zuleide Bacelar'])
  assert.deepEqual(nomes(livro.quemBusca('ninguem')), [])
  assert.deepEqual(nomes(livro.quemBusca('')), [])
})

test('adulto sem crianca nenhuma volta com a lista vazia, nao some', () => {
  const livro = comFamilias()
  const familias = responsaveisDaSemente()
  livro.substituirResponsaveis(
    [...familias.responsaveis, { id: idDeResponsavel('Solto Sem Filho'), nome: 'Solto Sem Filho', vinculo: 'tio', telefone: '' }],
    familias.vinculos,
  )
  const r = livro.quemBusca('solto')
  assert.deepEqual(nomes(r), ['Solto Sem Filho'])
  assert.deepEqual(r.achados[0].filhos, [])
})

test('o adulto some quando a planilha de responsaveis e trocada sem ele', () => {
  const livro = comFamilias()
  assert.equal(livro.quemBusca('marta').achados.length, 1)
  livro.substituirResponsaveis([], [])
  assert.equal(livro.quemBusca('marta').achados.length, 0)
})

test('filho que saiu do cadastro nao aparece na lista do adulto', () => {
  const livro = comFamilias()
  const alice = semear().find((a) => a.nome === 'Alice Fernandes')!
  livro.substituirCadastro(semear().filter((a) => a.id !== alice.id))
  const marta = livro.quemBusca('marta').achados[0]
  assert.equal(marta.filhos.some((f) => f.id === alice.id), false)
  assert.ok(marta.filhos.length > 0, 'os outros filhos continuam')
})

test('homonimo de ADULTO tambem e avisado', () => {
  const livro = new Livro()
  const a = { id: 'r1', nome: 'Marta Silva', vinculo: 'mãe', telefone: '' }
  const b = { id: 'r2', nome: 'marta  SILVA', vinculo: 'tia', telefone: '' }
  livro.substituirResponsaveis([a, b], [])
  const r = livro.quemBusca('marta')
  assert.equal(r.achados.length, 2)
  assert.deepEqual([...r.homonimos].sort(), ['r1', 'r2'])
})

test('o corte devolve o total, para a porteira saber que ha mais', () => {
  const livro = new Livro()
  const muitos = Array.from({ length: 12 }, (_, i) => ({
    id: `r${i}`,
    nome: `Maria Souza ${i}`,
    vinculo: 'mãe',
    telefone: '',
  }))
  livro.substituirResponsaveis(muitos, [])
  const r = livro.quemBusca('maria', 8)
  assert.equal(r.achados.length, 8)
  assert.equal(r.total, 12)
})

/* ---------- a avo de HOJE, procuravel pelo nome dela ---------- */

/*
  A busca por adulto so olhava o cadastro fixo, e a delegacao mora em outro
  lugar. A avo autorizada para hoje digitava o proprio nome e recebia
  "nenhum adulto com esse nome" — que a porteira le como "essa senhora nao
  pode levar ninguem". E justamente o caso que a delegacao existe para
  atender.
*/

const HORA = 60 * 60 * 1000
const AGORA = 1_700_000_000_000
const MARTA = idDeResponsavel('Marta Fernandes')

const alunoChamado = (nome: string) => semear().find((a) => a.nome === nome)!

function comAvo(extras: Record<string, unknown> = {}): Livro {
  const livro = comFamilias()
  livro.adicionarDelegacao(
    {
      id: 'd1',
      alunoId: alunoChamado('Alice Fernandes').id,
      nome: 'Helena Prado',
      vinculo: 'avó',
      telefone: '11 90000-0009',
      validoDe: AGORA,
      validoAte: AGORA + 4 * HORA,
      autorizadoPor: MARTA,
      ...extras,
    },
    AGORA,
  )
  return livro
}

test('a avo autorizada para hoje e achada pelo nome dela, com a neta junto', () => {
  const livro = comAvo()
  const r = livro.quemBusca('helena prado', 8, AGORA)
  assert.deepEqual(nomes(r), ['Helena Prado'])
  const avo = r.achados[0]
  assert.deepEqual(avo.filhos.map((f) => f.nome), ['Alice Fernandes'])
  // Dita como o que e: de hoje, e por quem — a mesma frase do dialogo de entrega.
  assert.equal(avo.temporario, true)
  assert.equal(avo.autorizadoPor, 'Marta Fernandes')
  assert.equal(avo.validoAte, AGORA + 4 * HORA)
})

test('sem relogio a delegacao nao entra: quem nao diz a hora recebe so os fixos', () => {
  const livro = comAvo()
  assert.deepEqual(nomes(livro.quemBusca('helena prado')), [])
  assert.deepEqual(nomes(livro.quemBusca('marta')), ['Marta Fernandes'])
})

test('a avo de ONTEM nao e achada — a janela vale aqui como vale na entrega', () => {
  const livro = comAvo()
  assert.deepEqual(nomes(livro.quemBusca('helena', 8, AGORA + 5 * HORA)), [])
  assert.deepEqual(nomes(livro.quemBusca('helena', 8, AGORA - HORA)), [])
})

test('a avo com dois netos e UMA pessoa no portao, com os dois para chamar', () => {
  const livro = comAvo()
  livro.adicionarDelegacao(
    {
      id: 'd2',
      alunoId: alunoChamado('Ravi Bacelar').id,
      nome: 'Helena Prado',
      vinculo: 'avó',
      telefone: '11 90000-0009',
      validoDe: AGORA,
      validoAte: AGORA + 2 * HORA,
      autorizadoPor: idDeResponsavel('Zuleide Bacelar'),
    },
    AGORA,
  )
  const avo = livro.quemBusca('helena prado', 8, AGORA).achados
  assert.equal(avo.length, 1, 'a mesma pessoa apareceu duas vezes')
  assert.deepEqual(avo[0].filhos.map((f) => f.nome), ['Alice Fernandes', 'Ravi Bacelar'])
  // A janela mais curta manda: e ate quando ESTA visita esta autorizada.
  assert.equal(avo[0].validoAte, AGORA + 2 * HORA)
  // E a restricao da crianca viaja junto, como nos fixos.
  assert.equal(avo[0].filhos.find((f) => f.nome === 'Ravi Bacelar')?.temAlerta, true)
})

test('o titular que perdeu o direito derruba a delegacao tambem na busca', () => {
  const livro = comAvo()
  assert.equal(livro.quemBusca('helena', 8, AGORA).achados.length, 1)
  // Marta sai do cadastro na proxima planilha: ninguem delega o que perdeu.
  const familias = responsaveisDaSemente()
  livro.substituirResponsaveis(
    familias.responsaveis.filter((r) => r.id !== MARTA),
    familias.vinculos.filter((v) => v.responsavelId !== MARTA),
  )
  assert.deepEqual(nomes(livro.quemBusca('helena', 8, AGORA)), [])
})

test('a avo e o fixo aparecem lado a lado, e o homonimo entre eles e avisado', () => {
  const livro = comAvo({ nome: 'Marta Fernandes' })
  const r = livro.quemBusca('marta fernandes', 8, AGORA)
  assert.equal(r.achados.length, 2, 'a delegacao e o cadastro precisam coexistir')
  assert.equal(r.homonimos.length, 2)
})
