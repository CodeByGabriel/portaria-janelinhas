import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  proximo,
  exigirDono,
  ehAcao,
  ehPapel,
  TransicaoInvalida,
  AcaoNaoPermitida,
  DONO,
} from './estados.ts'

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

// --- regressao: red team C4, poluicao pela cadeia de prototipo ---

test('REGRESSAO C4: chave de prototipo NAO atravessa a maquina de estados', () => {
  const veneno = [
    'constructor',
    'toString',
    '__proto__',
    'valueOf',
    'hasOwnProperty',
    'isPrototypeOf',
    'propertyIsEnumerable',
    'toLocaleString',
    '__defineGetter__',
  ]
  for (const chave of veneno) {
    assert.throws(
      () => proximo('aguardando', chave as never),
      TransicaoInvalida,
      `"${chave}" deveria ter sido recusada`,
    )
  }
})

test('REGRESSAO C4: proximo() so devolve estado, nunca funcao ou objeto', () => {
  const estados = ['aguardando', 'chamado', 'liberado', 'entregue'] as const
  const acoes = ['chamar', 'liberar', 'entregar', 'cancelar', 'constructor'] as const
  for (const de of estados) {
    for (const acao of acoes) {
      try {
        assert.equal(typeof proximo(de, acao as never), 'string')
      } catch (e) {
        assert.ok(e instanceof TransicaoInvalida)
      }
    }
  }
})

test('ehAcao recusa qualquer coisa que nao seja uma das quatro acoes', () => {
  assert.ok(ehAcao('chamar'))
  for (const lixo of ['constructor', '__proto__', '', 'CHAMAR', null, 42, {}, []]) {
    assert.equal(ehAcao(lixo), false, `${String(lixo)} nao e acao`)
  }
})

test('ehPapel recusa qualquer coisa que nao seja portaria ou sala', () => {
  assert.ok(ehPapel('portaria'))
  assert.ok(ehPapel('sala'))
  for (const lixo of ['Sala', 'SALA', 'professora', '', ' sala', null, 42]) {
    assert.equal(ehPapel(lixo), false, `${String(lixo)} nao e papel`)
  }
})

// --- regressao: red team C1, acao sem dono verificado ---

test('REGRESSAO C1: a sala NAO pode chamar', () => {
  assert.throws(() => exigirDono('chamar', 'sala'), AcaoNaoPermitida)
})

test('REGRESSAO C1: a sala NAO pode entregar nem cancelar', () => {
  assert.throws(() => exigirDono('entregar', 'sala'), AcaoNaoPermitida)
  assert.throws(() => exigirDono('cancelar', 'sala'), AcaoNaoPermitida)
})

test('REGRESSAO C1: a portaria NAO pode liberar — quem libera e a professora', () => {
  assert.throws(() => exigirDono('liberar', 'portaria'), AcaoNaoPermitida)
})

test('cada dono pode fazer o que e seu', () => {
  assert.doesNotThrow(() => exigirDono('chamar', 'portaria'))
  assert.doesNotThrow(() => exigirDono('entregar', 'portaria'))
  assert.doesNotThrow(() => exigirDono('cancelar', 'portaria'))
  assert.doesNotThrow(() => exigirDono('liberar', 'sala'))
})

test('o erro de papel diz de quem e a acao', () => {
  try {
    exigirDono('chamar', 'sala')
    assert.fail('deveria ter lancado')
  } catch (e) {
    assert.ok(e instanceof AcaoNaoPermitida)
    assert.equal(e.acao, 'chamar')
    assert.equal(e.papel, 'sala')
  }
})
