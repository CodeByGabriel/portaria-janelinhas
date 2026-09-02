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
  ACOES,
  RAZOES_RETORNO,
  ehRazaoRetorno,
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

/*
  A saida do `liberado`, e por que ela precisa de um estado proprio.

  Ate aqui, uma crianca liberada que nunca foi entregue ficava no quadro para
  sempre: a expiracao automatica fecha `chamado` esquecido, mas nao fecha
  `liberado`, porque marca-la como entregue seria o sistema afirmar que um
  adulto recebeu a crianca sem nenhum adulto ter recebido nada.

  O plano previa mandar o retorno de volta para `chamado`. Nao serve. Neste
  codigo `chamado` significa literalmente "responsavel chegou" — a etiqueta diz
  isso, a portaria escreve essa frase, e a sala conta esse estado para o aviso
  "N responsaveis chegaram". Com motivo "o responsavel nao chegou", as duas
  telas passariam a afirmar o contrario do fato recem-registrado.

  Pior: a professora poderia LIBERAR de novo sem ninguem reconfirmar que ha
  alguem no portao — e a confirmacao da portaria e a premissa inteira do
  sistema. Por isso `retorno` so sai por acao da PORTARIA.
*/

test('a professora devolve a crianca para a sala, e so ela', () => {
  assert.equal(proximo('liberado', 'retornar'), 'retorno')
  assert.equal(DONO.retornar, 'sala')
  assert.throws(() => exigirDono('retornar', 'portaria'), AcaoNaoPermitida)
})

test('quem tira a crianca do retorno e a PORTARIA, nunca a sala', () => {
  // Sair de `retorno` significa afirmar algo sobre o portao: ou tem alguem la
  // (chamar), ou nao tem e o ciclo fecha (encerrar). Quem enxerga o portao e a
  // portaria.
  assert.equal(proximo('retorno', 'chamar'), 'chamado')
  assert.equal(proximo('retorno', 'encerrar'), 'aguardando')
  assert.equal(DONO.chamar, 'portaria')
  assert.equal(DONO.encerrar, 'portaria')
  assert.throws(() => exigirDono('encerrar', 'sala'), AcaoNaoPermitida)
})

test('a sala NAO consegue liberar direto de `retorno`', () => {
  // Seria liberar sem ninguem ter reconfirmado o portao — que e exatamente o
  // furo que o estado proprio existe para fechar.
  assert.throws(() => proximo('retorno', 'liberar'), TransicaoInvalida)
})

test('REGRESSAO: `entregue` continua terminal, inclusive para as acoes novas', () => {
  for (const acao of ACOES) {
    assert.throws(() => proximo('entregue', acao), TransicaoInvalida, `entregue + ${acao}`)
  }
})

test('REGRESSAO: cancelamento continua sendo so `chamado` -> `aguardando`', () => {
  // O invariante diz "cancelamento so chamado -> aguardando". Por isso a saida
  // de `retorno` chama-se `encerrar`, e nao `cancelar`: `cancelar` continua com
  // exatamente uma aresta.
  assert.equal(proximo('chamado', 'cancelar'), 'aguardando')
  for (const de of ['aguardando', 'liberado', 'entregue', 'retorno'] as const) {
    assert.throws(() => proximo(de, 'cancelar'), TransicaoInvalida, `cancelar de ${de}`)
  }
})

test('REGRESSAO: `liberado` nao volta para `aguardando` por nenhum caminho', () => {
  // Apagaria a confirmacao da professora, que e o unico evento que este sistema
  // existe para proteger.
  for (const acao of ACOES) {
    if (acao === 'entregar' || acao === 'retornar') continue
    assert.throws(() => proximo('liberado', acao), TransicaoInvalida)
  }
  assert.notEqual(proximo('liberado', 'retornar'), 'aguardando')
})

test('toda acao declarada tem dono, e todo dono e de uma acao declarada', () => {
  /*
    `ACOES` e `readonly Acao[]`, entao esquecer uma acao nova ali NAO da erro de
    tipo — o efeito e `ehAcao('retornar') === false`, o botao morre em runtime
    com "acao desconhecida", e a crianca fica presa. Este teste e a unica
    barreira contra isso.
  */
  assert.deepEqual([...ACOES].sort(), Object.keys(DONO).sort())
  for (const acao of ACOES) {
    assert.ok(ehAcao(acao), `ehAcao recusa ${acao}, que esta em ACOES`)
    assert.ok(DONO[acao], `${acao} nao tem dono`)
  }
})

test('as razoes do retorno sao uma lista fechada, validada fail-closed', () => {
  /*
    Texto livre sobre uma crianca nomeada, escrito por alguem sob pressao, numa
    trilha que NAO tem caminho de correcao: `registrar()` so faz INSERT e a
    unica remocao e a poda da linha inteira. Zerar um campo mantendo o evento
    seria UPDATE, que a trilha append-only proibe. Ou seja, o que entrar ali
    fica os 90 dias, sem conserto.

    Lista fechada e a unica das duas opcoes cujo dominio inteiro o advogado da
    escola consegue ler ANTES de existir uma linha, e a unica validavel no
    servidor do mesmo jeito que `ehAcao` ja e.
  */
  assert.ok(RAZOES_RETORNO.length >= 3)
  for (const razao of RAZOES_RETORNO) {
    assert.ok(ehRazaoRetorno(razao))
    // Codigo, nao frase: renomear o rotulo na tela nao pode reescrever o passado.
    assert.match(razao, /^[a-z-]+$/, `"${razao}" nao e um codigo`)
  }
  for (const lixo of ['', 'outro ', 'Esqueceu Material', 42, null, undefined, {}]) {
    assert.equal(ehRazaoRetorno(lixo), false, `aceitou ${JSON.stringify(lixo)}`)
  }
})

test('nenhuma razao coleta dado de saude', () => {
  /*
    "crianca passou mal" foi a primeira ideia e esta fora: e dado de saude de
    titular crianca (art. 11), agrupavel por aluno ao longo de 90 dias — e
    docs/lgpd.md ja proibe usar a trilha para avaliar aluno. O detalhe clinico
    vai para o livro de ocorrencia da escola, em papel. Esta decisao de NAO
    coletar precisa estar testada, senao alguem a "conserta" depois.
  */
  for (const razao of RAZOES_RETORNO) {
    assert.doesNotMatch(razao, /saude|passou-mal|doente|febre|medic/)
  }
})
