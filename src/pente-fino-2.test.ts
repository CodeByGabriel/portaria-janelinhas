import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Livro } from './livro.ts'
import { semear } from './semente.ts'
import { analisarResponsaveis } from './responsaveis.ts'
import { analisar, analisarCsv, turmaDe } from './importar.ts'
import { normalizar } from './busca.ts'
import { normalizar as normalizarDoNavegador } from '../web/comum/busca.js'
import { analisarDelegacaoExterna, analisarCadastroExterno, idExternoValido } from './ecossistema.ts'

/*
  Regressoes da segunda passada (sondas executaveis) de 05/09/2026.
*/

const AGORA = Date.UTC(2026, 8, 5, 13)
const HORA = 60 * 60 * 1000
const ALUNOS = [{ id: 'k1', nome: 'Kaique Souza', turma: 'Pré 1' as const }]
const cabecalho = ['Aluno', 'Turma', 'Responsavel', 'Impedido']

/* ---------- a coluna Impedido decide pelo lado seguro, ou nao decide ---------- */

test('"sim" e variantes impedem; vazio e "nao" autorizam', () => {
  for (const [valor, esperado] of [['sim', true], ['SIM', true], ['s', true], ['x', true], ['1', true], ['', false], ['nao', false], ['Não', false], ['n', false], ['0', false]] as const) {
    const r = analisarResponsaveis([cabecalho, ['Kaique Souza', 'Pré 1', 'Marta', valor]], ALUNOS)
    assert.equal(r.erros.length, 0, valor + ': ' + JSON.stringify(r.erros))
    assert.equal(r.vinculos[0].impedido, esperado, valor)
  }
})

test('qualquer outro valor em Impedido recusa a linha — nunca vira autorizado', () => {
  for (const valor of ['Sim (ordem judicial)', 'sim - liminar', 'impedido', 'bloqueado', 'nao pode buscar', 'proibido', 'talvez']) {
    const r = analisarResponsaveis([cabecalho, ['Kaique Souza', 'Pré 1', 'Marta', valor]], ALUNOS)
    assert.equal(r.vinculos.length, 0, valor)
    assert.equal(r.responsaveis.length, 0, valor + ' — o adulto de uma linha recusada nao entra')
    assert.equal(r.erros.length, 1, valor)
    assert.equal(r.erros[0].linha, 2)
    assert.match(r.erros[0].motivo, /Impedido nao reconhecido/)
  }
})

test('marcacao e recusada mesmo logo depois de outra linha recusada (lastIndex)', () => {
  const r = analisarResponsaveis(
    [cabecalho.slice(0, 3), ['Kaique Souza', 'Pré 1', 'Marta Silva<'], ['Kaique Souza', 'Pré 1', '<b>Pai']],
    ALUNOS,
  )
  assert.equal(r.erros.length, 2)
  assert.equal(r.responsaveis.length, 0)
})

/* ---------- CSV ---------- */

test('aspa sem fechar nao engole o resto da planilha', () => {
  const r = analisar('Nome,Turma\nAna "Nina,Pré 1\nBia Lima,7º ano\nCaio Melo,2º ano\n')
  assert.ok(r.alunos.some((a) => a.nome === 'Bia Lima'), JSON.stringify(r))
  assert.ok(r.alunos.some((a) => a.nome === 'Caio Melo'))
  assert.ok(r.alunos.some((a) => a.nome.includes('Nina')))
  assert.equal(r.alunos.length, 3)
})

test('aspas balanceadas continuam funcionando, inclusive com quebra de linha dentro', () => {
  const linhas = analisarCsv('Nome,Turma\n"Souza, Ana","Pré 1"\n"Bia\nLima",7º ano\n', ',')
  assert.deepEqual(linhas[1], ['Souza, Ana', 'Pré 1'])
  assert.deepEqual(linhas[2], ['Bia\nLima', '7º ano'])
})

test('CR sozinho (CSV Macintosh) e aceito', () => {
  const r = analisar('Nome,Turma\rAna Souza,Pré 1\rBia Lima,7º ano\r')
  assert.equal(r.erros.length, 0, JSON.stringify(r.erros))
  assert.equal(r.alunos.length, 2)
})

test('linhas em branco antes do cabecalho sao puladas, e a numeracao continua fisica', () => {
  const r = analisar('\n\nNome,Turma\nAna Souza,Pré 1\nBia Lima,Turma Fantasma\n')
  assert.equal(r.alunos.length, 1)
  assert.equal(r.erros.length, 1)
  assert.equal(r.erros[0].linha, 5)
})

test('a turma como a secretaria digita: grau, sem espaco, com ponto, letra o', () => {
  for (const bruta of ['1° ano', '1o ano', '1.º ano', '1ºano', '1º  ano']) {
    assert.equal(turmaDe(bruta), '1º ano', bruta)
  }
  for (const bruta of ['Pré1', 'pre 1', 'PRÉ 1', 'Pré. 1']) {
    assert.equal(turmaDe(bruta), 'Pré 1', bruta)
  }
  assert.equal(turmaDe('10º ano'), undefined)
  assert.equal(turmaDe('Pré 3'), undefined)
})

test('caractere de controle no nome e recusado; invisivel e apagado', () => {
  const r = analisar('Nome,Turma\nAnaSouza,Pré 1\nBia​Lima,7º ano\n')
  assert.equal(r.erros.length, 1)
  assert.match(r.erros[0].motivo, /controle/)
  assert.equal(r.alunos.length, 1)
  assert.equal(r.alunos[0].nome, 'BiaLima')
})

/* ---------- normalizar: invisiveis, ligaduras, paridade ---------- */

test('normalizar apaga invisiveis e desfaz ligaduras, nas duas copias', () => {
  const casos = ['Ana​Souza', 'So­fia', 'Raﬁnha', 'Jo⁠ao', 'Thaís', '3º ano', "Sant'Ana"]
  for (const c of casos) {
    assert.equal(normalizar(c), normalizarDoNavegador(c), c)
  }
  assert.equal(normalizar('Ana​Souza'), 'anasouza')
  assert.equal(normalizar('Raﬁnha'), 'rafinha')
  assert.equal(normalizar('3º ano'), '3o ano')
})

/* ---------- Livro: a sala nao distingue inexistente de outra turma ---------- */

test('pelo WebSocket tambem: outra turma e "desconhecido" para a sala', () => {
  const livro = new Livro()
  const alice = semear().find((a) => a.nome === 'Alice Fernandes')!
  livro.aplicar({ tipo: 'chamar', alunoId: alice.id }, 1000, 'portaria')
  const erros: string[] = []
  for (const id of [alice.id, 'nao-existe']) {
    try {
      livro.aplicar({ tipo: 'liberar', alunoId: id }, 2000, 'sala', '9º ano')
    } catch (e) {
      erros.push((e as Error).message.replace(id, '<id>'))
    }
  }
  assert.equal(erros.length, 2)
  assert.equal(erros[0], erros[1])
  assert.match(erros[0], /desconhecido/)
  assert.doesNotMatch(erros[0], /Pré 1/)
  // A portaria continua agindo normalmente, e a sala certa tambem.
  livro.aplicar({ tipo: 'liberar', alunoId: alice.id }, 3000, 'sala', alice.turma)
})

/* ---------- API externa ---------- */

test('versao precisa ser inteiro SEGURO', () => {
  for (const versao of [1e21, Number.MAX_VALUE, 2 ** 53, -1, 1.5]) {
    const r = analisarCadastroExterno({ versao, alunos: [{ id: 'x', nome: 'A', turma: 'Pré 1' }] })
    assert.equal(r.ok, false, String(versao))
  }
  assert.equal(analisarCadastroExterno({ versao: 2 ** 53 - 1, alunos: [{ id: 'x', nome: 'A', turma: 'Pré 1' }] }).ok, true)
})

test('id externo nao e reescrito: espaco na ponta ou marcacao recusam', () => {
  assert.equal(idExternoValido(' d1 '), null)
  assert.equal(idExternoValido('d<1>'), null)
  assert.equal(idExternoValido('d1'), 'd1')
  assert.equal(idExternoValido(''), null)
  assert.equal(idExternoValido(42), null)
})

test('datas: forma ISO inteira, calendario de verdade, deslocamento que existe', () => {
  const base = { id: 'd', alunoId: 'a', quemBusca: { nome: 'Avó' }, autorizadoPor: 'r' }
  const ok = (validoAte: string) => analisarDelegacaoExterna({ ...base, validoAte }, AGORA).ok
  assert.equal(ok('2026-09-05T18:00:00-03:00'), true)
  assert.equal(ok('2026-09-05T18:00Z'), true)
  assert.equal(ok('2026-09-05T18:00:00.250+00:00'), true)
  assert.equal(ok('2026-02-30T18:00:00Z'), false, '30 de fevereiro')
  assert.equal(ok('2026-04-31T18:00:00Z'), false, '31 de abril')
  assert.equal(ok('2026-09-05T24:00:00Z'), false, '24h')
  assert.equal(ok('2026-09-05T18:00:00+15:00'), false, 'fuso que nao existe')
  assert.equal(ok('05/09/2026 18:00 +0300'), false, 'formato brasileiro')
  assert.equal(ok('Sat, 05 Sep 2026 18:00:00 +0000'), false, 'RFC 2822')
  assert.equal(ok('2026-09-05Z'), false, 'so data')
  const r = analisarDelegacaoExterna({ ...base, validoAte: '2026-09-05T18:00:00-03:00' }, AGORA)
  if (r.ok) assert.equal(r.delegacao.validoAte, Date.UTC(2026, 8, 5, 21))
  assert.equal(analisarDelegacaoExterna({ ...base, validoAte: '2026-09-05T13:30:00Z' }, AGORA).ok, true)
  assert.equal(analisarDelegacaoExterna({ ...base, validoAte: new Date(AGORA + HORA).toISOString() }, AGORA).ok, true)
})
