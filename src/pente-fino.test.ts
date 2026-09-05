import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Livro } from './livro.ts'
import { semear, responsaveisDaSemente } from './semente.ts'
import { idDeResponsavel, analisarResponsaveis } from './responsaveis.ts'
import { analisar, idDe, separadorDo } from './importar.ts'
import { analisarDelegacaoExterna, analisarCadastroExterno, LIMITE_ID_DELEGACAO } from './ecossistema.ts'

/*
  Regressoes do pente fino de 05/09/2026 — cada teste e um achado confirmado
  por tres verificadores independentes, com a correcao ao lado.
*/

const HORA = 60 * 60 * 1000
const AGORA = 1_700_000_000_000
const alice = () => semear().find((a) => a.nome === 'Alice Fernandes')!
const MARTA = idDeResponsavel('Marta Fernandes')

function livroComFamilias(): Livro {
  const livro = new Livro()
  const familias = responsaveisDaSemente()
  livro.substituirResponsaveis(familias.responsaveis, familias.vinculos)
  return livro
}

const avo = (extras: Record<string, unknown> = {}) => ({
  id: 'd1',
  alunoId: alice().id,
  nome: 'Helena Prado',
  vinculo: 'avó',
  telefone: '',
  validoDe: AGORA,
  validoAte: AGORA + 4 * HORA,
  autorizadoPor: MARTA,
  ...extras,
})

/* ---------- delegacao: o titular precisa CONTINUAR podendo levar ---------- */

test('a delegacao cai quando o titular que a autorizou sai do cadastro', () => {
  const livro = livroComFamilias()
  livro.adicionarDelegacao(avo(), AGORA)
  assert.ok(livro.responsaveisDe(alice().id, AGORA + HORA).some((r) => r.temporario))

  // A proxima planilha veio sem a Marta.
  const familias = responsaveisDaSemente()
  livro.substituirResponsaveis(
    familias.responsaveis.filter((r) => r.id !== MARTA),
    familias.vinculos.filter((v) => v.responsavelId !== MARTA),
  )
  assert.equal(livro.responsaveisDe(alice().id, AGORA + HORA).some((r) => r.temporario), false)
})

test('a delegacao cai quando o titular vira impedido depois', () => {
  const livro = livroComFamilias()
  livro.adicionarDelegacao(avo(), AGORA)
  const familias = responsaveisDaSemente()
  livro.substituirResponsaveis(
    familias.responsaveis,
    familias.vinculos.map((v) =>
      v.responsavelId === MARTA && v.alunoId === alice().id ? { ...v, impedido: true } : v,
    ),
  )
  assert.equal(livro.responsaveisDe(alice().id, AGORA + HORA).some((r) => r.temporario), false)
})

test('reusar o id de delegacao para OUTRA crianca e recusado; para a mesma, substitui', () => {
  const livro = livroComFamilias()
  livro.adicionarDelegacao(avo(), AGORA)
  const outra = semear().find((a) => a.nome === 'Maria Eduarda Nogueira')!
  assert.throws(
    () => livro.adicionarDelegacao(avo({ alunoId: outra.id }), AGORA),
    /ja usado para outra crianca/,
  )
  // Mesma crianca, mesmo id: idempotente, com os dados novos.
  livro.adicionarDelegacao(avo({ nome: 'Helena P. Prado' }), AGORA)
  assert.equal(livro.listarDelegacoes().length, 1)
  assert.equal(livro.listarDelegacoes()[0].nome, 'Helena P. Prado')
})

/* ---------- forma da delegacao ---------- */

test('id de delegacao maior que o que cabe no responsavelId e recusado na criacao', () => {
  const grande = 'x'.repeat(LIMITE_ID_DELEGACAO + 1)
  const r = analisarDelegacaoExterna(
    { id: grande, alunoId: 'a', quemBusca: { nome: 'Avó' }, validoAte: new Date(AGORA + HORA).toISOString(), autorizadoPor: 'r' },
    AGORA,
  )
  assert.equal(r.ok, false)
  const noLimite = analisarDelegacaoExterna(
    { id: 'x'.repeat(LIMITE_ID_DELEGACAO), alunoId: 'a', quemBusca: { nome: 'Avó' }, validoAte: new Date(AGORA + HORA).toISOString(), autorizadoPor: 'r' },
    AGORA,
  )
  assert.equal(noLimite.ok, true)
})

test('data sem fuso e recusada: "18h" sem dizer de onde venceria as 15h de Brasilia', () => {
  const semFuso = analisarDelegacaoExterna(
    { id: 'd', alunoId: 'a', quemBusca: { nome: 'Avó' }, validoAte: '2030-01-01T18:00:00', autorizadoPor: 'r' },
    AGORA,
  )
  assert.equal(semFuso.ok, false)
  if (!semFuso.ok) assert.match(semFuso.erros[0].motivo, /fuso/)
  const comFuso = analisarDelegacaoExterna(
    { id: 'd', alunoId: 'a', quemBusca: { nome: 'Avó' }, validoDe: '2030-01-01T10:00:00-03:00', validoAte: '2030-01-01T18:00:00-03:00', autorizadoPor: 'r' },
    Date.UTC(2030, 0, 1, 12),
  )
  assert.equal(comFuso.ok, true)
  if (comFuso.ok) assert.equal(comFuso.delegacao.validoAte, Date.UTC(2030, 0, 1, 21))
})

test('turma em NFD e aceita no cadastro por API', () => {
  const nfd = 'Pré 1'.normalize('NFD')
  assert.notEqual(nfd, 'Pré 1')
  const r = analisarCadastroExterno({ versao: 1, alunos: [{ id: 'x', nome: 'Alguém', turma: nfd }] })
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.alunos[0].turma, 'Pré 1')
})

/* ---------- Livro: poda em memoria, visibilidade, recusa sem vazar turma ---------- */

test('podarTrilha corta pelo mesmo `em` da poda em disco', () => {
  const livro = new Livro()
  livro.aplicar({ tipo: 'chamar', alunoId: 'a01' }, 1000, 'portaria')
  livro.aplicar({ tipo: 'cancelar', alunoId: 'a01' }, 2000, 'portaria')
  livro.aplicar({ tipo: 'chamar', alunoId: 'a01' }, 3000, 'portaria')
  assert.equal(livro.podarTrilha(2500), 2)
  assert.deepEqual(livro.registro().map((e) => e.em), [3000])
  assert.equal(livro.podarTrilha(2500), 0)
})

test('alunoVisivelPara: a sala nao distingue "nao existe" de "outra turma"', () => {
  const livro = new Livro()
  const a = alice()
  assert.equal(livro.alunoVisivelPara('portaria', undefined, a.id)?.id, a.id)
  assert.equal(livro.alunoVisivelPara('portaria', undefined, 'z99'), null)
  assert.equal(livro.alunoVisivelPara('sala', a.turma, a.id)?.id, a.id)
  assert.equal(livro.alunoVisivelPara('sala', '9º ano', a.id), null)
  assert.equal(livro.alunoVisivelPara('sala', '9º ano', 'z99'), null)
  assert.equal(livro.alunoVisivelPara('sala', undefined, a.id), null)
})

test('a recusa por outra turma nao diz qual turma e', () => {
  const livro = new Livro()
  const a = alice()
  livro.aplicar({ tipo: 'chamar', alunoId: a.id }, 1000, 'portaria')
  assert.throws(
    () => livro.aplicar({ tipo: 'liberar', alunoId: a.id }, 2000, 'sala', '9º ano'),
    (erro: Error) => /outra turma/.test(erro.message) && !erro.message.includes(a.turma),
  )
})

test('a hidratacao aguenta uma trilha enorme', () => {
  const evento = {
    alunoId: 'a01', nome: 'x', turma: 'Pré 1' as const, acao: 'chamar' as const, papel: 'portaria',
    origem: 'portaria', de: 'aguardando' as const, para: 'chamado' as const, em: 1, razao: '',
    responsavelId: '', responsavelNome: '',
  }
  const trilha = Array.from({ length: 300_000 }, () => evento)
  const livro = new Livro({ alunos: semear(), chamadas: [], trilha, versaoCadastro: 1 })
  assert.equal(livro.registro().length, 300_000)
})

/* ---------- importacao: TAB, linha repetida com numero, colisao de hash ---------- */

test('texto separado por TAB (o que o Excel cola) e aceito', () => {
  assert.equal(separadorDo('Nome\tTurma'), '\t')
  const r = analisar('Nome\tTurma\nAna Souza\tPré 1\nBia Lima\t7º ano\n')
  assert.equal(r.erros.length, 0, JSON.stringify(r.erros))
  assert.equal(r.alunos.length, 2)
})

test('linha repetida volta como erro COM o numero da linha', () => {
  const r = analisar('Nome,Turma\nLara Mendonça,Pré 1\nAna Souza,Pré 2\nlara  mendonca,Pré 1\n')
  assert.equal(r.alunos.length, 2)
  assert.equal(r.duplicados, 1)
  assert.equal(r.erros.length, 1)
  assert.equal(r.erros[0].linha, 4)
  assert.match(r.erros[0].motivo, /repete a linha 2/)
})

/*
  Procura dois nomes com o mesmo hash. Nomes ESTRUTURADOS ("Aluno 1", "Aluno
  2"...) nunca colidem em FNV-1a — o ultimo passo e uma bijecao — entao os
  nomes vem de um gerador pseudoaleatorio com semente fixa, silaba a silaba,
  como nomes de verdade se parecem. Em 32 bits a primeira colisao aparece por
  volta de oitenta mil nomes; o teto de meio milhao e folga.
*/
function acharColisao(hash: (nome: string) => string): [string, string] {
  const silabas = ['ma', 'ri', 'jo', 'ana', 'lu', 'ca', 'be', 'to', 'ne', 'li', 'so', 'fa', 'gui', 'pe', 'dro', 'vi', 'na', 'ze']
  let semente = 20260905
  const proximo = () => {
    semente = (Math.imul(semente, 1664525) + 1013904223) >>> 0
    return semente
  }
  const vistos = new Map<string, string>()
  for (let n = 0; n < 500_000; n++) {
    const partes = 2 + (proximo() % 3)
    let nome = ''
    for (let p = 0; p < partes; p++) {
      const s = silabas[proximo() % silabas.length]
      nome += (p === 0 ? s[0].toUpperCase() + s.slice(1) : s) + (proximo() % 2 ? '' : ' ')
    }
    nome = nome.trim() + ' ' + (proximo() % 1000)
    const h = hash(nome)
    const antes = vistos.get(h)
    if (antes !== undefined && antes !== nome) return [antes, nome]
    vistos.set(h, nome)
  }
  throw new Error('nao achei colisao em meio milhao de nomes')
}

test('dois nomes diferentes com o mesmo id nao viram uma crianca so', () => {
  const [a, b] = acharColisao((nome) => idDe(nome, 'Pré 1'))
  assert.notEqual(a, b)
  const r = analisar(`Nome,Turma\n${a},Pré 1\n${b},Pré 1\n`)
  assert.equal(r.alunos.length, 1)
  assert.equal(r.duplicados, 0)
  assert.equal(r.erros.length, 1)
  assert.match(r.erros[0].motivo, /colisao de identificador/)
  assert.equal(r.erros[0].linha, 3)
})

test('dois responsaveis diferentes com o mesmo id nao viram um adulto so', () => {
  const [a, b] = acharColisao((nome) => idDeResponsavel(nome))
  const alunos = [{ id: 'k1', nome: 'Kaique', turma: 'Pré 1' as const }]
  const r = analisarResponsaveis(
    [['Aluno', 'Turma', 'Responsavel'], ['Kaique', 'Pré 1', a], ['Kaique', 'Pré 1', b]],
    alunos,
  )
  assert.equal(r.responsaveis.length, 1)
  assert.equal(r.erros.length, 1)
  assert.match(r.erros[0].motivo, /colisao de identificador/)
})
