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
  const nomes = semear()
    .map((a) => a.nome)
    .join(' ')
  assert.match(nomes, /[áàâãéêíóôõúç]/i)
})

test('semear e deterministico', () => {
  assert.deepEqual(semear(), semear())
})

test('nenhum nome vem vazio', () => {
  assert.ok(semear().every((a) => a.nome.trim().length > 0))
})
