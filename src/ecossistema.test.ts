import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  analisarCadastroExterno,
  analisarDelegacaoExterna,
  comoLogAuditoria,
  idDeDelegacao,
  LIMITE_ERROS,
  MAXIMO_DIAS_DELEGACAO,
} from './ecossistema.ts'

/*
  A forma do que chega do backend (fase 3). Regra de negocio fica no Livro e e
  testada la; aqui e so o que um corpo pode ou nao ser.
*/

const UMA_HORA = 60 * 60 * 1000
const UM_DIA = 24 * UMA_HORA

const cadastroBom = () => ({
  versao: 7,
  alunos: [
    { id: 'aluno-1', nome: 'Alice Prado', turma: 'Pré 1' },
    { id: 'aluno-2', nome: 'Bento Prado', turma: '3º ano', alerta: 'nao entregar ao pai' },
  ],
  responsaveis: [
    { id: 'resp-1', nome: 'Marta Prado', vinculo: 'mãe', telefone: '11 99999-0000' },
    { id: 'resp-2', nome: 'Ricardo Prado', vinculo: 'pai' },
  ],
  vinculos: [
    { alunoId: 'aluno-1', responsavelId: 'resp-1' },
    { alunoId: 'aluno-2', responsavelId: 'resp-1', impedido: false },
    { alunoId: 'aluno-2', responsavelId: 'resp-2', impedido: true },
  ],
})

test('cadastro externo valido vira alunos, alertas separados, responsaveis e vinculos', () => {
  const r = analisarCadastroExterno(cadastroBom())
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.versao, 7)
  assert.deepEqual(
    r.alunos.map((a) => [a.id, a.turma, a.temAlerta]),
    [
      ['aluno-1', 'Pré 1', false],
      ['aluno-2', '3º ano', true],
    ],
  )
  // O texto do alerta NAO mora no aluno: sai a parte, como na planilha.
  assert.deepEqual(r.alertas, [{ id: 'aluno-2', texto: 'nao entregar ao pai' }])
  assert.deepEqual(
    r.responsaveis.map((x) => [x.id, x.vinculo, x.telefone]),
    [
      ['resp-1', 'mãe', '11 99999-0000'],
      ['resp-2', 'pai', ''],
    ],
  )
  assert.deepEqual(
    r.vinculos.map((v) => [v.alunoId, v.responsavelId, v.impedido]),
    [
      ['aluno-1', 'resp-1', false],
      ['aluno-2', 'resp-1', false],
      ['aluno-2', 'resp-2', true],
    ],
  )
})

test('par repetido: impedido vence, como na planilha', () => {
  const corpo = cadastroBom()
  corpo.vinculos.push({ alunoId: 'aluno-2', responsavelId: 'resp-2', impedido: false })
  const r = analisarCadastroExterno(corpo)
  assert.equal(r.ok, true)
  if (!r.ok) return
  const par = r.vinculos.filter((v) => v.alunoId === 'aluno-2' && v.responsavelId === 'resp-2')
  assert.equal(par.length, 1)
  assert.equal(par[0].impedido, true)
})

test('um erro em qualquer linha recusa o corpo INTEIRO', () => {
  const corpo = cadastroBom()
  corpo.alunos.push({ id: 'aluno-3', nome: 'Caio', turma: '12º ano' })
  const r = analisarCadastroExterno(corpo)
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.errosTotal, 1)
  assert.equal(r.erros[0].linha, 3)
  assert.match(r.erros[0].motivo, /turma desconhecida/)
})

test('o que nao e cadastro: nao objeto, sem alunos, versao negativa', () => {
  for (const corpo of [null, 'texto', [], 42]) {
    const r = analisarCadastroExterno(corpo)
    assert.equal(r.ok, false)
  }
  const semAlunos = analisarCadastroExterno({ versao: 1, alunos: [] })
  assert.equal(semAlunos.ok, false)
  const negativa = analisarCadastroExterno({ ...cadastroBom(), versao: -1 })
  assert.equal(negativa.ok, false)
  if (negativa.ok) return
  assert.match(negativa.erros[0].motivo, /versao/)
})

test('ids repetidos e vinculos para quem nao esta na lista sao erro', () => {
  const repetido = cadastroBom()
  repetido.alunos.push({ id: 'aluno-1', nome: 'Outra Alice', turma: 'Pré 2' })
  const r1 = analisarCadastroExterno(repetido)
  assert.equal(r1.ok, false)
  if (!r1.ok) assert.match(r1.erros[0].motivo, /repetido/)

  const solto = cadastroBom()
  solto.vinculos.push({ alunoId: 'aluno-9', responsavelId: 'resp-1' })
  const r2 = analisarCadastroExterno(solto)
  assert.equal(r2.ok, false)
  if (!r2.ok) assert.match(r2.erros[0].motivo, /aluno que nao esta na lista/)

  const semResponsavel = cadastroBom()
  semResponsavel.vinculos.push({ alunoId: 'aluno-1', responsavelId: 'resp-9' })
  const r3 = analisarCadastroExterno(semResponsavel)
  assert.equal(r3.ok, false)
  if (!r3.ok) assert.match(r3.erros[0].motivo, /responsavel que nao esta na lista/)
})

test('o prefixo da delegacao e reservado: nenhum id do backend pode usa-lo', () => {
  const corpo = cadastroBom()
  corpo.responsaveis.push({ id: idDeDelegacao('x'), nome: 'Impostor', vinculo: 'tio', telefone: '' })
  const r = analisarCadastroExterno(corpo)
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.erros[0].motivo, /id do responsavel invalido/)
})

test('marcacao e tirada do nome, e o erro nunca ecoa marcacao', () => {
  const corpo = cadastroBom()
  corpo.alunos[0].nome = 'Alice <b>Prado</b>'
  const r = analisarCadastroExterno(corpo)
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.alunos[0].nome, 'Alice bPrado/b')

  const ruim = cadastroBom()
  ruim.alunos[0].turma = '<script>alert(1)</script>'
  const r2 = analisarCadastroExterno(ruim)
  assert.equal(r2.ok, false)
  if (!r2.ok) assert.doesNotMatch(r2.erros[0].motivo, /[<>]/)
})

test('a lista de erros tem teto, e o total conta todos', () => {
  const corpo = cadastroBom()
  for (let i = 0; i < LIMITE_ERROS + 50; i++) {
    corpo.alunos.push({ id: `x${i}`, nome: `Fulano ${i}`, turma: 'inexistente' })
  }
  const r = analisarCadastroExterno(corpo)
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.erros.length, LIMITE_ERROS)
  assert.equal(r.errosTotal, LIMITE_ERROS + 50)
})

/* ---------- delegacao ---------- */

const AGORA = Date.UTC(2026, 8, 5, 13, 0, 0)
const iso = (ms: number) => new Date(ms).toISOString()

const delegacaoBoa = () => ({
  id: 'del-1',
  alunoId: 'aluno-1',
  quemBusca: { nome: 'Zuleide Prado', vinculo: 'avó', telefone: '11 98888-7777' },
  validoAte: iso(AGORA + 4 * UMA_HORA),
  autorizadoPor: 'resp-1',
})

test('delegacao valida: validoDe ausente vira agora, datas viram ms', () => {
  const r = analisarDelegacaoExterna(delegacaoBoa(), AGORA)
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.delegacao.validoDe, AGORA)
  assert.equal(r.delegacao.validoAte, AGORA + 4 * UMA_HORA)
  assert.equal(r.delegacao.nome, 'Zuleide Prado')
  assert.equal(r.delegacao.vinculo, 'avó')
  assert.equal(r.delegacao.autorizadoPor, 'resp-1')
})

test('delegacao sem validoAte, com validoAte no passado, ou invertida, e recusada', () => {
  const sem = { ...delegacaoBoa(), validoAte: undefined }
  assert.equal(analisarDelegacaoExterna(sem, AGORA).ok, false)

  const passada = { ...delegacaoBoa(), validoAte: iso(AGORA - UMA_HORA) }
  const r2 = analisarDelegacaoExterna(passada, AGORA)
  assert.equal(r2.ok, false)
  if (!r2.ok) assert.match(r2.erros.map((e) => e.motivo).join(' '), /ja passou/)

  const invertida = {
    ...delegacaoBoa(),
    validoDe: iso(AGORA + 5 * UMA_HORA),
    validoAte: iso(AGORA + 4 * UMA_HORA),
  }
  const r3 = analisarDelegacaoExterna(invertida, AGORA)
  assert.equal(r3.ok, false)
  if (!r3.ok) assert.match(r3.erros.map((e) => e.motivo).join(' '), /invertida/)
})

test('"hoje a avo busca" nao e "para sempre": a janela tem teto', () => {
  const longa = { ...delegacaoBoa(), validoAte: iso(AGORA + (MAXIMO_DIAS_DELEGACAO + 1) * UM_DIA) }
  const r = analisarDelegacaoExterna(longa, AGORA)
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.erros[0].motivo, /longa demais/)

  const noLimite = { ...delegacaoBoa(), validoAte: iso(AGORA + MAXIMO_DIAS_DELEGACAO * UM_DIA) }
  assert.equal(analisarDelegacaoExterna(noLimite, AGORA).ok, true)
})

test('delegacao precisa de quem busca, com nome, e de quem autoriza', () => {
  const semQuem = { ...delegacaoBoa(), quemBusca: undefined }
  assert.equal(analisarDelegacaoExterna(semQuem, AGORA).ok, false)
  const semNome = { ...delegacaoBoa(), quemBusca: { vinculo: 'avó' } }
  assert.equal(analisarDelegacaoExterna(semNome, AGORA).ok, false)
  const semTitular = { ...delegacaoBoa(), autorizadoPor: '' }
  assert.equal(analisarDelegacaoExterna(semTitular, AGORA).ok, false)
  const dataInvalida = { ...delegacaoBoa(), validoAte: 'amanha de manha' }
  assert.equal(analisarDelegacaoExterna(dataInvalida, AGORA).ok, false)
})

/* ---------- LogAuditoria ---------- */

test('o evento da trilha vira LogAuditoria com cursor, ISO e responsavel agrupado', () => {
  const log = comoLogAuditoria(42, {
    alunoId: 'a01',
    nome: 'Alice',
    turma: 'Pré 1',
    acao: 'entregar',
    papel: 'portaria',
    origem: 'portaria',
    de: 'liberado',
    para: 'entregue',
    em: AGORA,
    razao: '',
    responsavelId: 'delegacao:del-1',
    responsavelNome: 'Zuleide Prado',
  })
  assert.equal(log.seq, 42)
  assert.equal(log.quando, '2026-09-05T13:00:00.000Z')
  assert.equal(log.em, AGORA)
  assert.equal(log.sistema, 'portaria-janelinhas')
  assert.deepEqual(log.ator, { papel: 'portaria', origem: 'portaria' })
  assert.deepEqual(log.aluno, { id: 'a01', nome: 'Alice', turma: 'Pré 1' })
  assert.deepEqual(log.responsavel, { id: 'delegacao:del-1', nome: 'Zuleide Prado' })
})

test('sem responsavel, o campo e null — e nao um objeto vazio', () => {
  const log = comoLogAuditoria(1, {
    alunoId: 'a01',
    nome: 'Alice',
    turma: 'Pré 1',
    acao: 'cancelar',
    papel: 'sistema',
    origem: 'expiracao automatica',
    de: 'chamado',
    para: 'aguardando',
    em: AGORA,
    razao: '',
    responsavelId: '',
    responsavelNome: '',
  })
  assert.equal(log.responsavel, null)
  assert.equal(log.ator.papel, 'sistema')
})
