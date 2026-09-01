import { test } from 'node:test'
import assert from 'node:assert/strict'
import { esperaDaTentativa, TETO_MS } from './espera.ts'

test('a primeira retentativa e quase imediata', () => {
  assert.equal(esperaDaTentativa(0), 500)
})

test('a espera dobra a cada tentativa', () => {
  assert.equal(esperaDaTentativa(1), 1000)
  assert.equal(esperaDaTentativa(2), 2000)
  assert.equal(esperaDaTentativa(3), 4000)
})

test('a espera tem teto de dez segundos', () => {
  assert.equal(esperaDaTentativa(20), TETO_MS)
  assert.equal(esperaDaTentativa(200), TETO_MS)
})

test('tentativa negativa nao produz espera negativa', () => {
  assert.equal(esperaDaTentativa(-1), 500)
})

test('a espera nunca e zero: martelar o servidor nao ajuda', () => {
  for (let i = 0; i < 30; i++) {
    assert.ok(esperaDaTentativa(i) >= 500)
  }
})
