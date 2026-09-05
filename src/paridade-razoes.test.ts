import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { RAZOES_RETORNO } from './estados.ts'

/*
  A tela da sala carrega a propria copia das razoes de retorno (ROTULO_RAZAO,
  em web/sala/index.html), porque o navegador nao importa .ts. Se um codigo
  entrar em RAZOES_RETORNO e nao na tela — ou sair de um lado so — a
  professora escolhe uma razao que o servidor recusa, ou nunca ve uma que ele
  aceita. Nenhuma sonda cobria essa terceira copia; este teste le o HTML.
*/
test('a tela da sala oferece exatamente os codigos de RAZOES_RETORNO', () => {
  const html = readFileSync(new URL('../web/sala/index.html', import.meta.url), 'utf8')
  const bloco = html.match(/ROTULO_RAZAO\s*=\s*\[([\s\S]*?)\n\s*\]/)
  assert.ok(bloco, 'ROTULO_RAZAO nao encontrado em web/sala/index.html')
  const codigosNaTela = [...bloco![1].matchAll(/\[\s*'([a-z-]+)'\s*,/g)].map((m) => m[1])
  assert.deepEqual([...codigosNaTela].sort(), [...RAZOES_RETORNO].sort())
})
