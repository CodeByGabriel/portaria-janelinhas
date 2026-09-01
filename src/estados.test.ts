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
