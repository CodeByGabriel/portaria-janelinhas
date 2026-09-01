import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Livro } from './livro.ts'
import { TransicaoInvalida, AcaoNaoPermitida } from './estados.ts'

import { semear } from './semente.ts'

/** A turma de cada aluno da semente, para os atalhos nao precisarem adivinhar. */
const TURMA_DE = new Map(semear().map((a) => [a.id, a.turma]))

/** Atalhos: o ciclo normal, com o papel E a turma certos em cada etapa. */
const chamar = (l: Livro, id: string, t: number) =>
  l.aplicar({ tipo: 'chamar', alunoId: id }, t, 'portaria')
const liberar = (l: Livro, id: string, t: number) =>
  l.aplicar({ tipo: 'liberar', alunoId: id }, t, 'sala', TURMA_DE.get(id))
const entregar = (l: Livro, id: string, t: number) =>
  l.aplicar({ tipo: 'entregar', alunoId: id }, t, 'portaria')
const cancelar = (l: Livro, id: string, t: number) =>
  l.aplicar({ tipo: 'cancelar', alunoId: id }, t, 'portaria')

test('chamar cria uma chamada no estado chamado', () => {
  const livro = new Livro()
  chamar(livro, 'a01', 1000)
  const r = livro.retratoPara('portaria')
  assert.equal(r.chamadas.length, 1)
  assert.equal(r.chamadas[0].estado, 'chamado')
  assert.equal(r.chamadas[0].alunoId, 'a01')
})

test('o ciclo completo termina com a crianca fora do retrato', () => {
  const livro = new Livro()
  chamar(livro, 'a01', 1000)
  liberar(livro, 'a01', 2000)
  entregar(livro, 'a01', 3000)
  assert.equal(livro.retratoPara('portaria').chamadas.length, 0)
  assert.equal(livro.registro().at(-1)?.para, 'entregue')
})

test('liberar sem chamar e recusado', () => {
  const livro = new Livro()
  assert.throws(() => liberar(livro, 'a01', 1000), TransicaoInvalida)
})

test('aluno inexistente e recusado', () => {
  const livro = new Livro()
  assert.throws(() => chamar(livro, 'nao-existe', 1000), /desconhecido/)
})

test('a sala so ve a propria turma', () => {
  const livro = new Livro()
  chamar(livro, 'a01', 1000)
  chamar(livro, 'a09', 1000)
  const maternal = livro.retratoPara('sala', 'Pré 1')
  assert.equal(maternal.chamadas.length, 1)
  assert.ok(maternal.chamadas.every((c) => c.turma === 'Pré 1'))
  assert.equal(livro.retratoPara('portaria').chamadas.length, 2)
})

test('sala sem turma declarada nao ve ninguem', () => {
  const livro = new Livro()
  chamar(livro, 'a01', 1000)
  assert.equal(livro.retratoPara('sala').chamadas.length, 0)
})

test('o registro e append-only e cresce a cada transicao', () => {
  const livro = new Livro()
  chamar(livro, 'a01', 1000)
  liberar(livro, 'a01', 2000)
  assert.deepEqual(
    livro.registro().map((e) => [e.de, e.para]),
    [
      ['aguardando', 'chamado'],
      ['chamado', 'liberado'],
    ],
  )
})

test('o registro devolvido e uma copia: mexer nele nao apaga a trilha', () => {
  const livro = new Livro()
  chamar(livro, 'a01', 1000)
  livro.registro().length = 0
  assert.equal(livro.registro().length, 1)
})

test('o registro guarda QUEM fez, nao so o que foi feito', () => {
  const livro = new Livro()
  chamar(livro, 'a01', 1000)
  liberar(livro, 'a01', 2000)
  assert.equal(livro.registro()[0].papel, 'portaria')
  assert.equal(livro.registro()[1].papel, 'sala')
})

test('transicao recusada NAO entra no registro', () => {
  const livro = new Livro()
  assert.throws(() => liberar(livro, 'a01', 1000))
  assert.equal(livro.registro().length, 0)
})

test('cancelar volta para aguardando e some do retrato ativo', () => {
  const livro = new Livro()
  chamar(livro, 'a01', 1000)
  cancelar(livro, 'a01', 2000)
  assert.equal(livro.retratoPara('portaria').chamadas.length, 0)
})

test('cancelar deixa rastro no registro mesmo sumindo do retrato', () => {
  const livro = new Livro()
  chamar(livro, 'a01', 1000)
  cancelar(livro, 'a01', 2000)
  assert.equal(livro.registro().length, 2)
  assert.equal(livro.registro()[1].para, 'aguardando')
})

test('depois de cancelar, da para chamar de novo', () => {
  const livro = new Livro()
  chamar(livro, 'a01', 1000)
  cancelar(livro, 'a01', 2000)
  chamar(livro, 'a01', 3000)
  assert.equal(livro.retratoPara('portaria').chamadas[0].estado, 'chamado')
})

test('o retrato carrega carimbo de tempo', () => {
  const livro = new Livro()
  const r = livro.retratoPara('portaria', undefined, 5000)
  assert.equal(r.em, 5000)
  assert.equal(r.tipo, 'retrato')
})

test('alunos() devolve o cadastro inteiro', () => {
  assert.equal(new Livro().alunos().length, 44)
})

// --- regressao: red team C1, papel nao verificado ---

test('REGRESSAO C1: a sala NAO consegue chamar uma crianca', () => {
  const livro = new Livro()
  assert.throws(
    () => livro.aplicar({ tipo: 'chamar', alunoId: 'a01' }, 1000, 'sala'),
    AcaoNaoPermitida,
  )
  assert.equal(livro.retratoPara('portaria').chamadas.length, 0)
  assert.equal(livro.registro().length, 0)
})

test('REGRESSAO C1: a sequencia do ataque nao leva a crianca ate entregue', () => {
  const livro = new Livro()
  assert.throws(() => livro.aplicar({ tipo: 'chamar', alunoId: 'a01' }, 1000, 'sala'))
  assert.throws(() => livro.aplicar({ tipo: 'liberar', alunoId: 'a01' }, 2000, 'sala'))
  assert.throws(() => livro.aplicar({ tipo: 'entregar', alunoId: 'a01' }, 3000, 'sala'))
  assert.equal(livro.retratoPara('portaria').chamadas.length, 0)
  assert.equal(livro.registro().length, 0)
})

test('REGRESSAO C1: a portaria NAO consegue liberar sozinha', () => {
  const livro = new Livro()
  chamar(livro, 'a01', 1000)
  assert.throws(
    () => livro.aplicar({ tipo: 'liberar', alunoId: 'a01' }, 2000, 'portaria'),
    AcaoNaoPermitida,
  )
  assert.equal(livro.retratoPara('portaria').chamadas[0].estado, 'chamado')
})

// --- regressao: red team S1, entregue acumulando ---

test('REGRESSAO S1: entregar remove do retrato; ele nao vira o cadastro', () => {
  const livro = new Livro()
  // a17 a a20 sao do 3º ano; a21 e a22, do 4º ano.
  const turnos = ['a17', 'a18', 'a19', 'a20', 'a21', 'a22']
  for (const id of turnos) {
    chamar(livro, id, 1000)
    liberar(livro, id, 2000)
    entregar(livro, id, 3000)
  }
  assert.equal(livro.retratoPara('portaria').chamadas.length, 0)
  // A turma que REALMENTE teve criancas chamadas tem que esvaziar. Conferir
  // uma turma qualquer passaria mesmo se o retrato nunca fosse limpo.
  assert.equal(livro.retratoPara('sala', '3º ano').chamadas.length, 0)
  assert.equal(livro.retratoPara('sala', '4º ano').chamadas.length, 0)
  assert.equal(livro.registro().length, 18)
})

// --- regressao: red team S2, fila reordenando ---

test('REGRESSAO S2: liberar NAO reordena a fila', () => {
  const livro = new Livro()
  chamar(livro, 'a26', 1000)
  chamar(livro, 'a27', 1500)
  assert.deepEqual(
    livro.retratoPara('portaria').chamadas.map((c) => c.alunoId),
    ['a26', 'a27'],
  )
  liberar(livro, 'a26', 9000)
  assert.deepEqual(
    livro.retratoPara('portaria').chamadas.map((c) => c.alunoId),
    ['a26', 'a27'],
    'quem chegou primeiro continua primeiro depois de liberado',
  )
})

test('REGRESSAO S2: desde guarda a chegada, em guarda a ultima mudanca', () => {
  const livro = new Livro()
  chamar(livro, 'a01', 1000)
  liberar(livro, 'a01', 7000)
  const c = livro.retratoPara('portaria').chamadas[0]
  assert.equal(c.desde, 1000)
  assert.equal(c.em, 7000)
})

// --- regressao: red team M3, substituirCadastro no meio da saida ---

test('REGRESSAO M3: trocar o cadastro com crianca em saida e recusado', () => {
  const livro = new Livro()
  chamar(livro, 'a01', 1000)
  assert.throws(() => livro.substituirCadastro([]), /em saida/)
  assert.equal(livro.retratoPara('portaria').chamadas.length, 1)
})

test('trocar o cadastro com a saida encerrada funciona e preserva a trilha', () => {
  const livro = new Livro()
  chamar(livro, 'a01', 1000)
  cancelar(livro, 'a01', 2000)
  livro.substituirCadastro([{ id: 'z1', nome: 'Novo Aluno', turma: 'Pré 1' }])
  assert.equal(livro.alunos().length, 1)
  assert.equal(livro.registro().length, 2)
})

// --- regressao: red team 2, furo 1 — a sala liberava aluno de outra turma ---

test('REGRESSAO: a sala do Pré 1 NAO libera aluno do 9º ano', () => {
  const livro = new Livro()
  chamar(livro, 'a41', 1000) // Giovanna Paixao, 9º ano
  assert.throws(
    () => livro.aplicar({ tipo: 'liberar', alunoId: 'a41' }, 2000, 'sala', 'Pré 1'),
    /outra turma/,
  )
  assert.equal(livro.retratoPara('portaria').chamadas[0].estado, 'chamado')
})

test('REGRESSAO: sala sem turma declarada NAO age sobre ninguem', () => {
  const livro = new Livro()
  chamar(livro, 'a01', 1000)
  assert.throws(
    () => livro.aplicar({ tipo: 'liberar', alunoId: 'a01' }, 2000, 'sala'),
    /declarar a turma/,
  )
  assert.equal(livro.retratoPara('portaria').chamadas[0].estado, 'chamado')
})

test('REGRESSAO: varrer os ids de outra turma nao libera ninguem', () => {
  const livro = new Livro()
  const alvos = ['a05', 'a09', 'a17', 'a41']
  for (const id of alvos) chamar(livro, id, 1000)
  for (const id of alvos) {
    try {
      livro.aplicar({ tipo: 'liberar', alunoId: id }, 2000, 'sala', 'Pré 1')
    } catch {
      // esperado para todos: nenhum deles e do Pré 1
    }
  }
  const liberados = livro
    .retratoPara('portaria')
    .chamadas.filter((c) => c.estado === 'liberado')
  assert.equal(liberados.length, 0, 'nenhum deveria ter sido liberado')
})

test('a sala da turma certa continua liberando normalmente', () => {
  const livro = new Livro()
  chamar(livro, 'a01', 1000)
  livro.aplicar({ tipo: 'liberar', alunoId: 'a01' }, 2000, 'sala', 'Pré 1')
  assert.equal(livro.retratoPara('portaria').chamadas[0].estado, 'liberado')
})

test('o registro guarda a ORIGEM da acao, para rastrear o incidente', () => {
  const livro = new Livro()
  chamar(livro, 'a01', 1000)
  liberar(livro, 'a01', 2000)
  assert.equal(livro.registro()[0].origem, 'portaria')
  assert.equal(livro.registro()[1].origem, 'Pré 1')
  assert.equal(livro.registro()[1].turma, 'Pré 1')
})

// --- versao do cadastro ---

test('a versao do cadastro sobe a cada troca', () => {
  const livro = new Livro()
  const antes = livro.versao()
  livro.substituirCadastro([{ id: 'z1', nome: 'Novo Aluno', turma: 'Pré 1' }])
  assert.equal(livro.versao(), antes + 1)
})

test('o retrato carrega a versao do cadastro', () => {
  const livro = new Livro()
  assert.equal(livro.retratoPara('portaria').cadastro, livro.versao())
})
