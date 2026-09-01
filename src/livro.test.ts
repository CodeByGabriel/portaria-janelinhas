import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Livro } from './livro.ts'
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
  assert.throws(
    () => livro.aplicar({ tipo: 'liberar', alunoId: 'a01' }, 1000),
    TransicaoInvalida,
  )
})

test('aluno inexistente e recusado', () => {
  const livro = new Livro()
  assert.throws(
    () => livro.aplicar({ tipo: 'chamar', alunoId: 'nao-existe' }, 1000),
    /desconhecido/,
  )
})

test('a sala so ve a propria turma', () => {
  const livro = new Livro()
  livro.aplicar({ tipo: 'chamar', alunoId: 'a01' }, 1000)
  livro.aplicar({ tipo: 'chamar', alunoId: 'a09' }, 1000)
  const maternal = livro.retratoPara('sala', 'Maternal')
  assert.equal(maternal.chamadas.length, 1)
  assert.ok(maternal.chamadas.every((c) => c.turma === 'Maternal'))
  assert.equal(livro.retratoPara('portaria').chamadas.length, 2)
})

test('sala sem turma declarada nao ve ninguem', () => {
  const livro = new Livro()
  livro.aplicar({ tipo: 'chamar', alunoId: 'a01' }, 1000)
  assert.equal(livro.retratoPara('sala').chamadas.length, 0)
})

test('o registro e append-only e cresce a cada transicao', () => {
  const livro = new Livro()
  livro.aplicar({ tipo: 'chamar', alunoId: 'a01' }, 1000)
  livro.aplicar({ tipo: 'liberar', alunoId: 'a01' }, 2000)
  const registro = livro.registro()
  assert.equal(registro.length, 2)
  assert.deepEqual(
    registro.map((e) => [e.de, e.para]),
    [
      ['aguardando', 'chamado'],
      ['chamado', 'liberado'],
    ],
  )
})

test('o registro devolvido e uma copia: mexer nele nao apaga a trilha', () => {
  const livro = new Livro()
  livro.aplicar({ tipo: 'chamar', alunoId: 'a01' }, 1000)
  livro.registro().length = 0
  assert.equal(livro.registro().length, 1)
})

test('transicao recusada NAO entra no registro', () => {
  const livro = new Livro()
  assert.throws(() => livro.aplicar({ tipo: 'liberar', alunoId: 'a01' }, 1000))
  assert.equal(livro.registro().length, 0)
})

test('cancelar volta para aguardando e some do retrato ativo', () => {
  const livro = new Livro()
  livro.aplicar({ tipo: 'chamar', alunoId: 'a01' }, 1000)
  livro.aplicar({ tipo: 'cancelar', alunoId: 'a01' }, 2000)
  assert.equal(livro.retratoPara('portaria').chamadas.length, 0)
})

test('cancelar deixa rastro no registro mesmo sumindo do retrato', () => {
  const livro = new Livro()
  livro.aplicar({ tipo: 'chamar', alunoId: 'a01' }, 1000)
  livro.aplicar({ tipo: 'cancelar', alunoId: 'a01' }, 2000)
  assert.equal(livro.registro().length, 2)
  assert.equal(livro.registro()[1].para, 'aguardando')
})

test('depois de cancelar, da para chamar de novo', () => {
  const livro = new Livro()
  livro.aplicar({ tipo: 'chamar', alunoId: 'a01' }, 1000)
  livro.aplicar({ tipo: 'cancelar', alunoId: 'a01' }, 2000)
  livro.aplicar({ tipo: 'chamar', alunoId: 'a01' }, 3000)
  assert.equal(livro.retratoPara('portaria').chamadas[0].estado, 'chamado')
})

test('o retrato carrega carimbo de tempo', () => {
  const livro = new Livro()
  const r = livro.retratoPara('portaria', undefined, 5000)
  assert.equal(r.em, 5000)
  assert.equal(r.tipo, 'retrato')
})

test('alunos() devolve o cadastro inteiro', () => {
  assert.equal(new Livro().alunos().length, 32)
})

test('duas criancas chamadas mantem a ordem de chegada', () => {
  const livro = new Livro()
  livro.aplicar({ tipo: 'chamar', alunoId: 'a02' }, 1000)
  livro.aplicar({ tipo: 'chamar', alunoId: 'a01' }, 2000)
  const ordenadas = [...livro.retratoPara('portaria').chamadas].sort((a, b) => a.em - b.em)
  assert.equal(ordenadas[0].alunoId, 'a02')
  assert.equal(ordenadas[1].alunoId, 'a01')
})
