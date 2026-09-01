import { test } from 'node:test'
import assert from 'node:assert/strict'
import { semear, segmentoDa, TURMAS, SEGMENTOS } from './semente.ts'

test('a escola vai do Pré 1 ao 9º ano: onze turmas', () => {
  assert.equal(TURMAS.length, 11)
  assert.equal(TURMAS[0], 'Pré 1')
  assert.equal(TURMAS.at(-1), '9º ano')
})

test('semeia quatro alunos em cada turma', () => {
  const alunos = semear()
  assert.equal(alunos.length, 44)
  for (const turma of TURMAS) {
    assert.equal(
      alunos.filter((a) => a.turma === turma).length,
      4,
      `turma ${turma} deveria ter 4`,
    )
  }
})

test('todo id e unico', () => {
  const ids = semear().map((a) => a.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('a semente tem nomes acentuados de verdade', () => {
  const nomes = semear()
    .map((a) => a.nome)
    .join(' ')
  assert.match(nomes, /[áàâãéêíóôõúç]/i)
})

test('a semente tem nome com apostrofo e com hifen', () => {
  const nomes = semear().map((a) => a.nome)
  assert.ok(nomes.some((n) => /['’]/.test(n)), 'falta nome com apostrofo')
  assert.ok(nomes.some((n) => n.includes('-')), 'falta nome com hifen')
})

test('semear e deterministico', () => {
  assert.deepEqual(semear(), semear())
})

test('nenhum nome vem vazio', () => {
  assert.ok(semear().every((a) => a.nome.trim().length > 0))
})

// --- segmentos ---

test('Pré 1 e Pré 2 sao Educacao Infantil', () => {
  assert.equal(segmentoDa('Pré 1'), 'Educação Infantil')
  assert.equal(segmentoDa('Pré 2'), 'Educação Infantil')
})

test('do 1º ao 5º ano e Fundamental I', () => {
  for (const t of ['1º ano', '2º ano', '3º ano', '4º ano', '5º ano'] as const) {
    assert.equal(segmentoDa(t), 'Fundamental I', t)
  }
})

test('do 6º ao 9º ano e Fundamental II', () => {
  for (const t of ['6º ano', '7º ano', '8º ano', '9º ano'] as const) {
    assert.equal(segmentoDa(t), 'Fundamental II', t)
  }
})

test('toda turma cai em algum segmento conhecido', () => {
  for (const turma of TURMAS) {
    assert.ok(
      (SEGMENTOS as readonly string[]).includes(segmentoDa(turma)),
      `${turma} caiu fora`,
    )
  }
})
