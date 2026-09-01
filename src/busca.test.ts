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

test('acha quem tem acento digitando COM acento tambem', () => {
  assert.equal(buscar(ALUNOS, 'thaís').length, 1)
  assert.equal(buscar(ALUNOS, 'joão').length, 1)
})
