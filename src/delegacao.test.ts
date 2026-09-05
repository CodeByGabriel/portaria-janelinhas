import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Livro } from './livro.ts'
import { semear, responsaveisDaSemente } from './semente.ts'
import { idDeResponsavel } from './responsaveis.ts'
import { idDeDelegacao } from './ecossistema.ts'

/*
  Delegacao — "hoje a avo busca" — no Livro, onde as regras moram.

  A forma do corpo e testada em ecossistema.test.ts. Aqui e o que acontece
  depois que a forma passou: quem pode delegar, para quem, por quanto tempo, e
  o que a trilha diz quando a crianca sai com a pessoa delegada.
*/

const HORA = 60 * 60 * 1000
const AGORA = 1_700_000_000_000

const alice = () => semear().find((a) => a.nome === 'Alice Fernandes')!
const MARTA = idDeResponsavel('Marta Fernandes')
const RICARDO = idDeResponsavel('Ricardo Fernandes')

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
  telefone: '11 90000-0009',
  validoDe: AGORA,
  validoAte: AGORA + 4 * HORA,
  autorizadoPor: MARTA,
  ...extras,
})

test('a delegacao so aparece com o relogio, e so dentro da janela', () => {
  const livro = livroComFamilias()
  const completa = livro.adicionarDelegacao(avo(), AGORA)
  assert.equal(completa.autorizadoPorNome, 'Marta Fernandes')

  // Sem relogio: so os fixos. E o lado certo para errar.
  assert.equal(livro.responsaveisDe(alice().id).some((r) => r.temporario), false)

  const dentro = livro.responsaveisDe(alice().id, AGORA + HORA).find((r) => r.temporario)
  assert.ok(dentro)
  assert.equal(dentro.id, idDeDelegacao('d1'))
  assert.equal(dentro.nome, 'Helena Prado')
  assert.equal(dentro.autorizadoPor, 'Marta Fernandes')
  assert.equal(dentro.impedido, false)

  assert.equal(livro.responsaveisDe(alice().id, AGORA - HORA).some((r) => r.temporario), false)
  assert.equal(livro.responsaveisDe(alice().id, AGORA + 5 * HORA).some((r) => r.temporario), false)
})

test('entregar pela delegacao grava delegacao:<id> E o nome na trilha', () => {
  const livro = livroComFamilias()
  livro.adicionarDelegacao(avo(), AGORA)
  const { id, turma } = alice()

  livro.aplicar({ tipo: 'chamar', alunoId: id }, AGORA + HORA, 'portaria')
  livro.aplicar({ tipo: 'liberar', alunoId: id }, AGORA + HORA + 1, 'sala', turma)
  const evento = livro.aplicar(
    { tipo: 'entregar', alunoId: id, responsavelId: idDeDelegacao('d1') },
    AGORA + HORA + 2,
    'portaria',
  )
  assert.equal(evento.para, 'entregue')
  assert.equal(evento.responsavelId, 'delegacao:d1')
  assert.equal(evento.responsavelNome, 'Helena Prado')
})

test('a delegacao vencida nao entrega — nem a que ainda nao comecou', () => {
  const livro = livroComFamilias()
  livro.adicionarDelegacao(avo({ validoDe: AGORA + 2 * HORA, validoAte: AGORA + 4 * HORA }), AGORA)
  const { id, turma } = alice()
  livro.aplicar({ tipo: 'chamar', alunoId: id }, AGORA, 'portaria')
  livro.aplicar({ tipo: 'liberar', alunoId: id }, AGORA + 1, 'sala', turma)

  // Antes da janela: a avo ainda nao pode.
  assert.throws(
    () =>
      livro.aplicar(
        { tipo: 'entregar', alunoId: id, responsavelId: idDeDelegacao('d1') },
        AGORA + HORA,
        'portaria',
      ),
    /escolha um responsavel/,
  )
  // Depois da janela: tambem nao.
  assert.throws(
    () =>
      livro.aplicar(
        { tipo: 'entregar', alunoId: id, responsavelId: idDeDelegacao('d1') },
        AGORA + 5 * HORA,
        'portaria',
      ),
    /escolha um responsavel/,
  )
  // Dentro dela: sim.
  const evento = livro.aplicar(
    { tipo: 'entregar', alunoId: id, responsavelId: idDeDelegacao('d1') },
    AGORA + 3 * HORA,
    'portaria',
  )
  assert.equal(evento.para, 'entregue')
})

test('quem autoriza precisa ser responsavel DESTA crianca, e poder leva-la', () => {
  const livro = livroComFamilias()
  // Ricardo e impedido de levar a Alice: nao delega o que nao tem.
  assert.throws(() => livro.adicionarDelegacao(avo({ autorizadoPor: RICARDO }), AGORA), /quem autoriza/)
  // Alguem que nao consta.
  assert.throws(
    () => livro.adicionarDelegacao(avo({ autorizadoPor: 'r-inexistente' }), AGORA),
    /quem autoriza/,
  )
  // Sem responsaveis cadastrados nao ha titular, e sem titular nao ha delegacao.
  const semFamilias = new Livro()
  assert.throws(() => semFamilias.adicionarDelegacao(avo(), AGORA), /quem autoriza/)
  assert.equal(livro.listarDelegacoes().length, 0)
})

test('impedido vence: delegar para o nome do impedido e recusado, em qualquer caixa', () => {
  const livro = livroComFamilias()
  assert.throws(
    () => livro.adicionarDelegacao(avo({ nome: 'Ricardo Fernandes' }), AGORA),
    /impedido de levar/,
  )
  assert.throws(
    () => livro.adicionarDelegacao(avo({ nome: '  ricardo   FERNANDES ' }), AGORA),
    /impedido de levar/,
  )
  assert.equal(livro.listarDelegacoes().length, 0)
})

test('o impedimento que chega DEPOIS marca a delegacao como "nao pode"', () => {
  const livro = livroComFamilias()
  livro.adicionarDelegacao(avo(), AGORA)

  // A escola sobe uma planilha nova em que Helena Prado passa a ser impedida.
  const familias = responsaveisDaSemente()
  const helena = { id: idDeResponsavel('Helena Prado'), nome: 'Helena Prado', vinculo: 'avó', telefone: '' }
  livro.substituirResponsaveis(
    [...familias.responsaveis, helena],
    [...familias.vinculos, { alunoId: alice().id, responsavelId: helena.id, impedido: true }],
  )

  const lista = livro.responsaveisDe(alice().id, AGORA + HORA)
  const temporaria = lista.find((r) => r.temporario)
  assert.ok(temporaria)
  assert.equal(temporaria.impedido, true)

  const { id, turma } = alice()
  livro.aplicar({ tipo: 'chamar', alunoId: id }, AGORA + HORA, 'portaria')
  livro.aplicar({ tipo: 'liberar', alunoId: id }, AGORA + HORA + 1, 'sala', turma)
  assert.throws(
    () =>
      livro.aplicar(
        { tipo: 'entregar', alunoId: id, responsavelId: idDeDelegacao('d1') },
        AGORA + HORA + 2,
        'portaria',
      ),
    /impedido de levar/,
  )
})

test('aluno desconhecido, janela invertida e delegacao vencida nao entram', () => {
  const livro = livroComFamilias()
  assert.throws(() => livro.adicionarDelegacao(avo({ alunoId: 'z99' }), AGORA), /desconhecido/)
  assert.throws(
    () => livro.adicionarDelegacao(avo({ validoDe: AGORA + 2 * HORA, validoAte: AGORA + HORA }), AGORA),
    /invertida/,
  )
  assert.throws(
    () => livro.adicionarDelegacao(avo({ validoAte: AGORA - 1 }), AGORA),
    /vencida/,
  )
  assert.equal(livro.listarDelegacoes().length, 0)
})

test('remover, substituir e hidratar do instantaneo', () => {
  const livro = livroComFamilias()
  const completa = livro.adicionarDelegacao(avo(), AGORA)
  assert.equal(livro.removerDelegacao('d1'), true)
  assert.equal(livro.removerDelegacao('d1'), false)
  assert.equal(livro.responsaveisDe(alice().id, AGORA + HORA).some((r) => r.temporario), false)

  const familias = responsaveisDaSemente()
  const hidratado = new Livro({
    alunos: semear(),
    chamadas: [],
    trilha: [],
    versaoCadastro: 1,
    responsaveis: familias.responsaveis,
    vinculos: familias.vinculos,
    delegacoes: [completa],
  })
  const vinda = hidratado.responsaveisDe(alice().id, AGORA + HORA).find((r) => r.temporario)
  assert.ok(vinda)
  assert.equal(vinda.autorizadoPor, 'Marta Fernandes')
})

test('trocar o cadastro sem a crianca leva a delegacao dela junto', () => {
  const livro = livroComFamilias()
  livro.adicionarDelegacao(avo(), AGORA)
  livro.substituirCadastro(semear().filter((a) => a.id !== alice().id))
  assert.equal(livro.listarDelegacoes().length, 0)
})

/* ---------- o segundo neto, na hora da entrega ---------- */

/*
  A avo de hoje busca dois netos. A porteira acha os dois pelo nome dela e
  entrega o primeiro; na hora do segundo, o convite de irmaos vinha vazio —
  `irmaosPara` so olhava `vinculos`, e a delegacao mora em `temporarias`.
  Nao entregava a crianca errada: apenas fazia a porteira comecar de novo,
  como se a autorizacao valesse so para um dos dois.
*/

test('a avo de hoje leva os DOIS netos: o convite de irmaos enxerga a delegacao', () => {
  const livro = livroComFamilias()
  const ravi = semear().find((a) => a.nome === 'Ravi Bacelar')!
  livro.adicionarDelegacao(avo(), AGORA)
  livro.adicionarDelegacao(
    avo({ id: 'd2', alunoId: ravi.id, autorizadoPor: idDeResponsavel('Zuleide Bacelar') }),
    AGORA,
  )

  const irmaos = livro.irmaosPara(idDeDelegacao('d1'), alice().id, AGORA)
  assert.deepEqual(irmaos.map((a) => a.nome), ['Ravi Bacelar'])

  // Sem relogio segue sem delegacao, como em `responsaveisDe`.
  assert.deepEqual(livro.irmaosPara(idDeDelegacao('d1'), alice().id), [])
  // E a janela vale aqui tambem.
  assert.deepEqual(livro.irmaosPara(idDeDelegacao('d1'), alice().id, AGORA + 5 * HORA), [])
})

test('o convite de irmaos nao mistura duas avos de nomes diferentes', () => {
  const livro = livroComFamilias()
  const ravi = semear().find((a) => a.nome === 'Ravi Bacelar')!
  livro.adicionarDelegacao(avo(), AGORA)
  livro.adicionarDelegacao(
    avo({
      id: 'd2',
      alunoId: ravi.id,
      nome: 'Outra Pessoa',
      autorizadoPor: idDeResponsavel('Zuleide Bacelar'),
    }),
    AGORA,
  )
  assert.deepEqual(livro.irmaosPara(idDeDelegacao('d1'), alice().id, AGORA), [])
})

test('o responsavel FIXO continua achando os irmaos como antes', () => {
  const livro = livroComFamilias()
  livro.adicionarDelegacao(avo(), AGORA)
  const irmaos = livro.irmaosPara(MARTA, alice().id, AGORA)
  assert.ok(irmaos.length > 0, 'a delegacao no meio nao pode apagar o caminho dos fixos')
  assert.equal(irmaos.some((a) => a.id === alice().id), false)
})
