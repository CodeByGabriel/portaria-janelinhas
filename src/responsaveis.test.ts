import { test } from 'node:test'
import assert from 'node:assert/strict'

import { analisarResponsaveis, idDeResponsavel } from './responsaveis.ts'
import type { Turma } from './semente.ts'

/*
  A leitura da planilha de responsaveis.

  Ela e o unico caminho pelo qual a escola diz "quem pode levar esta crianca",
  e por isso todo erro dela precisa virar linha recusada com motivo — nunca um
  vinculo solto. Autorizacao que ninguem consegue revisar depois e pior do que
  autorizacao que faltou: a que faltou aparece no portao, na hora.
*/

const ALUNOS: { id: string; nome: string; turma: Turma }[] = [
  { id: 'a01', nome: 'Alice Fernandes', turma: 'Pré 1' },
  { id: 'a02', nome: 'Théo Marçal', turma: 'Pré 1' },
  { id: 'a30', nome: 'Alice Fernandes', turma: '7º ano' },
]

const tabela = (texto: string) =>
  texto
    .trim()
    .split('\n')
    .map((l) => l.split(',').map((c) => c.trim()))

test('uma linha por par vira responsavel e vinculo', () => {
  const r = analisarResponsaveis(
    tabela(`
      Aluno,Turma,Responsavel,Vinculo,Telefone
      Alice Fernandes,Pré 1,Marta Fernandes,mãe,11 90000-0000
    `),
    ALUNOS,
  )
  assert.equal(r.erros.length, 0)
  assert.equal(r.responsaveis.length, 1)
  assert.equal(r.responsaveis[0].nome, 'Marta Fernandes')
  assert.equal(r.responsaveis[0].vinculo, 'mãe')
  assert.deepEqual(r.vinculos, [
    { alunoId: 'a01', responsavelId: idDeResponsavel('Marta Fernandes'), impedido: false },
  ])
})

test('o mesmo adulto em dois filhos e UMA pessoa, e e isso que faz irmaos', () => {
  /*
    O id do responsavel nao leva turma, de proposito: ele atravessa turmas, e
    e essa travessia que permite a portaria oferecer "chamar os dois". Com o id
    composto por turma, cada filho teria uma "Marta" diferente e a escola teria
    irmaos que o sistema nao sabe que sao irmaos.
  */
  const r = analisarResponsaveis(
    tabela(`
      Aluno,Turma,Responsavel
      Alice Fernandes,Pré 1,Marta Fernandes
      Alice Fernandes,7º ano,Marta Fernandes
    `),
    ALUNOS,
  )
  assert.equal(r.responsaveis.length, 1)
  assert.equal(r.vinculos.length, 2)
  assert.deepEqual(
    r.vinculos.map((v) => v.alunoId).sort(),
    ['a01', 'a30'],
  )
})

test('homonimos sao separados pela TURMA, como no resto do sistema', () => {
  const r = analisarResponsaveis(
    tabela(`
      Aluno,Turma,Responsavel
      Alice Fernandes,7º ano,Marta Fernandes
    `),
    ALUNOS,
  )
  assert.deepEqual(r.vinculos.map((v) => v.alunoId), ['a30'])
})

test('aluno que nao existe vira ERRO, nunca vinculo solto', () => {
  const r = analisarResponsaveis(
    tabela(`
      Aluno,Turma,Responsavel
      Fulano de Tal,Pré 1,Marta Fernandes
    `),
    ALUNOS,
  )
  assert.equal(r.vinculos.length, 0)
  assert.equal(r.erros.length, 1)
  assert.match(r.erros[0].motivo, /nao encontrado/)
  assert.match(r.erros[0].motivo, /Fulano de Tal/)
})

test('impedido GANHA de autorizado quando a planilha se contradiz', () => {
  /*
    Se uma linha diz que o pai busca e outra diz que nao, o sistema fica com
    "nao". A planilha esta ambigua e alguem precisa corrigi-la; ate la, o lado
    seguro do erro e a crianca nao sair — e nao sair com quem talvez nao
    pudesse.
  */
  for (const ordem of [
    ['sim', ''],
    ['', 'sim'],
  ]) {
    const r = analisarResponsaveis(
      tabela(`
        Aluno,Turma,Responsavel,Impedido
        Alice Fernandes,Pré 1,Ricardo Fernandes,${ordem[0]}
        Alice Fernandes,Pré 1,Ricardo Fernandes,${ordem[1]}
      `),
      ALUNOS,
    )
    assert.equal(r.vinculos.length, 1)
    assert.equal(r.vinculos[0].impedido, true, `ordem ${JSON.stringify(ordem)}`)
  }
})

test('o impedimento vive no PAR, nao na pessoa', () => {
  // "O pai nao busca" e uma frase sobre uma dupla. O mesmo adulto pode estar
  // impedido de buscar um filho e autorizado a buscar outro — e e assim que
  // decisao judicial costuma ser escrita.
  const r = analisarResponsaveis(
    tabela(`
      Aluno,Turma,Responsavel,Impedido
      Alice Fernandes,Pré 1,Ricardo Fernandes,sim
      Alice Fernandes,7º ano,Ricardo Fernandes,
    `),
    ALUNOS,
  )
  assert.equal(r.responsaveis.length, 1)
  const porAluno = Object.fromEntries(r.vinculos.map((v) => [v.alunoId, v.impedido]))
  assert.equal(porAluno.a01, true)
  assert.equal(porAluno.a30, false)
})

test('planilha sem as colunas obrigatorias e recusada inteira', () => {
  const r = analisarResponsaveis(tabela('Nome,Turma\nAlice Fernandes,Pré 1'), ALUNOS)
  assert.equal(r.responsaveis.length, 0)
  assert.match(r.erros[0].motivo, /precisa das colunas/)
})

test('titulos alternativos funcionam, porque a secretaria escreve o que faz sentido', () => {
  const r = analisarResponsaveis(
    tabela(`
      Criança,Série,Autorizado,Parentesco,Celular
      Alice Fernandes,Pré 1,Marta Fernandes,mãe,11 90000-0000
    `),
    ALUNOS,
  )
  assert.equal(r.erros.length, 0)
  assert.equal(r.vinculos.length, 1)
})

test('marcacao no nome nao atravessa', () => {
  const r = analisarResponsaveis(
    tabela(`
      Aluno,Turma,Responsavel
      Alice Fernandes,Pré 1,<script>alert(1)</script>
    `),
    ALUNOS,
  )
  assert.equal(r.responsaveis.length, 0)
  assert.match(r.erros[0].motivo, /caractere invalido/)
})

test('acento e caixa no nome do aluno nao impedem o casamento', () => {
  const r = analisarResponsaveis(
    tabela(`
      Aluno,Turma,Responsavel
      THEO MARCAL,Pré 1,Marta Fernandes
    `),
    ALUNOS,
  )
  assert.equal(r.erros.length, 0)
  assert.deepEqual(r.vinculos.map((v) => v.alunoId), ['a02'])
})
