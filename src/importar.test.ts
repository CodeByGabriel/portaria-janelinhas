import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analisar } from './importar.ts'

const CABECALHO = 'Nome,Turma'

test('importa linhas validas', () => {
  const r = analisar(`${CABECALHO}\nThaís Gonçalves,Jardim II\nJoão Conceição,Maternal`)
  assert.equal(r.alunos.length, 2)
  assert.equal(r.erros.length, 0)
  assert.equal(r.duplicados, 0)
  assert.equal(r.alunos[0].nome, 'Thaís Gonçalves')
  assert.equal(r.alunos[0].turma, 'Jardim II')
})

test('conta duplicado por nome e turma, sem importar duas vezes', () => {
  const r = analisar(`${CABECALHO}\nLara Mendonça,Maternal\nlara  mendonca,Maternal`)
  assert.equal(r.alunos.length, 1)
  assert.equal(r.duplicados, 1)
})

test('mesmo nome em turmas diferentes NAO e duplicado', () => {
  const r = analisar(`${CABECALHO}\nLara Mendonça,Maternal\nLara Mendonça,Jardim I`)
  assert.equal(r.alunos.length, 2)
  assert.equal(r.duplicados, 0)
})

test('turma desconhecida vira erro com o numero da linha', () => {
  const r = analisar(`${CABECALHO}\nAna Souza,Sexto Ano`)
  assert.equal(r.alunos.length, 0)
  assert.equal(r.erros.length, 1)
  assert.equal(r.erros[0].linha, 2)
  assert.match(r.erros[0].motivo, /turma/i)
})

test('nome vazio vira erro', () => {
  const r = analisar(`${CABECALHO}\n   ,Maternal`)
  assert.equal(r.erros.length, 1)
  assert.match(r.erros[0].motivo, /nome/i)
})

test('cabecalho sem a coluna Nome e recusado inteiro', () => {
  const r = analisar('Aluno,Turma\nAna,Maternal')
  assert.equal(r.alunos.length, 0)
  assert.equal(r.erros[0].linha, 1)
})

test('aceita ponto e virgula, que e o que o Excel brasileiro exporta', () => {
  const r = analisar('Nome;Turma\nAna Souza;Maternal')
  assert.equal(r.alunos.length, 1)
})

test('ignora colunas extras da planilha da escola', () => {
  const csv =
    'Nome,Data Nascimento,Turno,Turma,Responsável 1\n' +
    'Ana Souza,2020-03-01,Manhã,Maternal,Marina'
  const r = analisar(csv)
  assert.equal(r.alunos.length, 1)
  assert.equal(r.alunos[0].turma, 'Maternal')
})

test('a coluna e achada pelo nome, nao pela posicao', () => {
  const r = analisar('Turma,Turno,Nome\nMaternal,Manhã,Ana Souza')
  assert.equal(r.alunos.length, 1)
  assert.equal(r.alunos[0].nome, 'Ana Souza')
})

test('cabecalho acentuado ou em caixa alta funciona', () => {
  const r = analisar('NOME,TURMA\nAna Souza,Maternal')
  assert.equal(r.alunos.length, 1)
})

test('linhas em branco sao ignoradas, nao viram erro', () => {
  const r = analisar(`${CABECALHO}\nAna Souza,Maternal\n\n\n`)
  assert.equal(r.alunos.length, 1)
  assert.equal(r.erros.length, 0)
})

test('aceita quebra de linha do Windows', () => {
  const r = analisar('Nome,Turma\r\nAna Souza,Maternal\r\nBia Lima,Maternal')
  assert.equal(r.alunos.length, 2)
})

test('ids gerados sao unicos', () => {
  const r = analisar(`${CABECALHO}\nAna Souza,Maternal\nBia Lima,Maternal`)
  assert.equal(new Set(r.alunos.map((a) => a.id)).size, 2)
})

test('planilha vazia nao explode', () => {
  const r = analisar('')
  assert.equal(r.alunos.length, 0)
  assert.equal(r.erros.length, 1)
})

test('erro numa linha nao impede as outras de entrar', () => {
  const r = analisar(`${CABECALHO}\nAna Souza,Maternal\nBia,Turma Fantasma\nCaio Lima,Maternal`)
  assert.equal(r.alunos.length, 2)
  assert.equal(r.erros.length, 1)
  assert.equal(r.erros[0].linha, 3)
})

test('nome com apostrofo entra intacto no cadastro', () => {
  const r = analisar(`${CABECALHO}\nMaria Sant'Ana,Maternal`)
  assert.equal(r.alunos[0].nome, "Maria Sant'Ana")
})

// --- regressao: injecao de marcacao pela planilha ---

test('REGRESSAO: nome com marcacao HTML e RECUSADO', () => {
  const venenos = [
    '<img src=x onerror=alert(1)>',
    '<script>alert(1)</script>',
    'Ana <b>Souza</b>',
    'Ana <',
    'Ana >',
  ]
  for (const veneno of venenos) {
    const r = analisar(`${CABECALHO}\n${veneno},Maternal`)
    assert.equal(r.alunos.length, 0, `"${veneno}" nao deveria entrar`)
    assert.equal(r.erros.length, 1)
    assert.match(r.erros[0].motivo, /invalido/)
  }
})

test('REGRESSAO: uma linha envenenada nao impede as boas de entrar', () => {
  const r = analisar(
    `${CABECALHO}\nAna Souza,Maternal\n<script>x</script>,Maternal\nBia Lima,Maternal`,
  )
  assert.equal(r.alunos.length, 2)
  assert.equal(r.erros.length, 1)
  assert.equal(r.erros[0].linha, 3)
})

test('nome absurdamente longo e recusado', () => {
  const r = analisar(`${CABECALHO}\n${'A'.repeat(200)},Maternal`)
  assert.equal(r.alunos.length, 0)
  assert.match(r.erros[0].motivo, /longo/)
})

test('nome brasileiro normal e longo NAO e recusado', () => {
  const nome = 'Maria Eduarda dos Santos Vasconcelos de Albuquerque'
  const r = analisar(`${CABECALHO}\n${nome},Maternal`)
  assert.equal(r.alunos.length, 1)
  assert.equal(r.alunos[0].nome, nome)
})
