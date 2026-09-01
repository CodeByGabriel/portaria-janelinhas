import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analisar, decodificar } from './importar.ts'

const CABECALHO = 'Nome,Turma'

test('importa linhas validas', () => {
  const r = analisar(`${CABECALHO}\nThaís Gonçalves,2º ano\nJoão Conceição,Pré 1`)
  assert.equal(r.alunos.length, 2)
  assert.equal(r.erros.length, 0)
  assert.equal(r.duplicados, 0)
  assert.equal(r.alunos[0].nome, 'Thaís Gonçalves')
  assert.equal(r.alunos[0].turma, '2º ano')
})

test('conta duplicado por nome e turma, sem importar duas vezes', () => {
  const r = analisar(`${CABECALHO}\nLara Mendonça,Pré 1\nlara  mendonca,Pré 1`)
  assert.equal(r.alunos.length, 1)
  assert.equal(r.duplicados, 1)
})

test('mesmo nome em turmas diferentes NAO e duplicado', () => {
  const r = analisar(`${CABECALHO}\nLara Mendonça,Pré 1\nLara Mendonça,Pré 2`)
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
  const r = analisar(`${CABECALHO}\n   ,Pré 1`)
  assert.equal(r.erros.length, 1)
  assert.match(r.erros[0].motivo, /nome/i)
})

test('cabecalho sem a coluna Nome e recusado inteiro', () => {
  const r = analisar('Aluno,Turma\nAna,Pré 1')
  assert.equal(r.alunos.length, 0)
  assert.equal(r.erros[0].linha, 1)
})

test('aceita ponto e virgula, que e o que o Excel brasileiro exporta', () => {
  const r = analisar('Nome;Turma\nAna Souza;Pré 2')
  assert.equal(r.alunos.length, 1)
})

test('ignora colunas extras da planilha da escola', () => {
  const csv =
    'Nome,Data Nascimento,Turno,Turma,Responsável 1\n' +
    'Ana Souza,2020-03-01,Manhã,Pré 1,Marina'
  const r = analisar(csv)
  assert.equal(r.alunos.length, 1)
  assert.equal(r.alunos[0].turma, 'Pré 1')
})

test('a coluna e achada pelo nome, nao pela posicao', () => {
  const r = analisar('Turma,Turno,Nome\nPré 1,Manhã,Ana Souza')
  assert.equal(r.alunos.length, 1)
  assert.equal(r.alunos[0].nome, 'Ana Souza')
})

test('cabecalho acentuado ou em caixa alta funciona', () => {
  const r = analisar('NOME,TURMA\nAna Souza,Pré 1')
  assert.equal(r.alunos.length, 1)
})

test('linhas em branco sao ignoradas, nao viram erro', () => {
  const r = analisar(`${CABECALHO}\nAna Souza,Pré 1\n\n\n`)
  assert.equal(r.alunos.length, 1)
  assert.equal(r.erros.length, 0)
})

test('aceita quebra de linha do Windows', () => {
  const r = analisar('Nome,Turma\r\nAna Souza,Pré 1\r\nBia Lima,Pré 1')
  assert.equal(r.alunos.length, 2)
})

test('ids gerados sao unicos', () => {
  const r = analisar(`${CABECALHO}\nAna Souza,Pré 1\nBia Lima,Pré 1`)
  assert.equal(new Set(r.alunos.map((a) => a.id)).size, 2)
})

test('planilha vazia nao explode', () => {
  const r = analisar('')
  assert.equal(r.alunos.length, 0)
  assert.equal(r.erros.length, 1)
})

test('erro numa linha nao impede as outras de entrar', () => {
  const r = analisar(`${CABECALHO}\nAna Souza,Pré 1\nBia,Turma Fantasma\nCaio Lima,Pré 1`)
  assert.equal(r.alunos.length, 2)
  assert.equal(r.erros.length, 1)
  assert.equal(r.erros[0].linha, 3)
})

test('nome com apostrofo entra intacto no cadastro', () => {
  const r = analisar(`${CABECALHO}\nMaria Sant'Ana,Pré 1`)
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
    const r = analisar(`${CABECALHO}\n${veneno},Pré 1`)
    assert.equal(r.alunos.length, 0, `"${veneno}" nao deveria entrar`)
    assert.equal(r.erros.length, 1)
    assert.match(r.erros[0].motivo, /invalido/)
  }
})

test('REGRESSAO: uma linha envenenada nao impede as boas de entrar', () => {
  const r = analisar(
    `${CABECALHO}\nAna Souza,Pré 1\n<script>x</script>,Pré 1\nBia Lima,Pré 1`,
  )
  assert.equal(r.alunos.length, 2)
  assert.equal(r.erros.length, 1)
  assert.equal(r.erros[0].linha, 3)
})

test('nome absurdamente longo e recusado', () => {
  const r = analisar(`${CABECALHO}\n${'A'.repeat(200)},Pré 1`)
  assert.equal(r.alunos.length, 0)
  assert.match(r.erros[0].motivo, /longo/)
})

test('nome brasileiro normal e longo NAO e recusado', () => {
  const nome = 'Maria Eduarda dos Santos Vasconcelos de Albuquerque'
  const r = analisar(`${CABECALHO}\n${nome},Pré 1`)
  assert.equal(r.alunos.length, 1)
  assert.equal(r.alunos[0].nome, nome)
})

// --- regressao: red team 2, furo 2 — ids posicionais deslocavam entre importacoes ---

test('REGRESSAO: o id vem do conteudo, nao da posicao', () => {
  const primeira = analisar(
    'Nome,Turma\nAna Beatriz Souza,Pré 1\nCarlos Lima,Pré 1\nDavi Rocha,Pré 1',
  )
  // A secretaria corrige a turma do Bruno e reimporta. Ele entra no MEIO.
  const segunda = analisar(
    'Nome,Turma\nAna Beatriz Souza,Pré 1\nBruno Assuncao,Pré 1\nCarlos Lima,Pré 1\nDavi Rocha,Pré 1',
  )

  const idDoCarlos = (r: { alunos: { id: string; nome: string }[] }) =>
    r.alunos.find((a) => a.nome === 'Carlos Lima')?.id

  assert.equal(
    idDoCarlos(primeira),
    idDoCarlos(segunda),
    'o id do Carlos NAO pode mudar so porque o Bruno entrou antes dele',
  )
})

test('REGRESSAO: reimportar a mesma planilha devolve exatamente os mesmos ids', () => {
  const csv = 'Nome,Turma\nAna Souza,Pré 1\nBia Lima,7º ano'
  assert.deepEqual(
    analisar(csv).alunos.map((a) => a.id),
    analisar(csv).alunos.map((a) => a.id),
  )
})

test('o mesmo nome em turmas diferentes gera ids diferentes', () => {
  const r = analisar('Nome,Turma\nLara Mendonça,Pré 1\nLara Mendonça,9º ano')
  assert.notEqual(r.alunos[0].id, r.alunos[1].id)
})

// --- regressao: red team 2, furo 4 — CSV com aspas e separador por linha ---

test('REGRESSAO: campo entre aspas com virgula e UM campo', () => {
  const r = analisar('Nome,Turma\n"Souza, Ana",Pré 1')
  assert.equal(r.erros.length, 0)
  assert.equal(r.alunos.length, 1)
  assert.equal(r.alunos[0].nome, 'Souza, Ana')
})

test('REGRESSAO: aspas nao entram no nome importado', () => {
  const r = analisar('Nome,Turma\n"Ana Souza",Pré 1')
  assert.equal(r.alunos[0].nome, 'Ana Souza')
})

test('REGRESSAO: nome entre aspas depois da coluna Turma nao trunca', () => {
  const r = analisar('Turma,Nome\nPré 1,"Souza, Ana"')
  assert.equal(r.alunos.length, 1)
  assert.equal(r.alunos[0].nome, 'Souza, Ana')
})

test('REGRESSAO: ponto e virgula DENTRO de uma coluna nao reparticiona a linha', () => {
  const r = analisar('Nome,Turma,Obs\nAna Souza,Pré 1,"alergia; asma"')
  assert.equal(r.erros.length, 0, JSON.stringify(r.erros))
  assert.equal(r.alunos.length, 1)
  assert.equal(r.alunos[0].turma, 'Pré 1')
})

test('aspas duplicadas viram uma aspa literal', () => {
  const r = analisar('Nome,Turma\n"Ana ""Aninha"" Souza",Pré 1')
  assert.equal(r.alunos[0].nome, 'Ana "Aninha" Souza')
})

test('o separador e decidido pelo cabecalho, uma vez so', () => {
  const r = analisar('Nome;Turma;Obs\nAna Souza;Pré 1;mora perto, vem a pe')
  assert.equal(r.alunos.length, 1)
  assert.equal(r.alunos[0].turma, 'Pré 1')
})

// --- regressao: red team 2, furo 5 — planilha ANSI do Excel brasileiro ---

test('REGRESSAO: planilha em Windows-1252 e lida corretamente', () => {
  const texto = 'Nome,Turma\nThaís Gonçalves,1º ano\nJoão Conceição,Pré 2'
  const bytes = new Uint8Array(
    [...texto].map((c) => {
      const cp = c.codePointAt(0) ?? 0
      return cp < 256 ? cp : cp === 0x00ba ? 0xba : cp
    }),
  )
  const r = analisar(decodificar(bytes))
  assert.equal(r.erros.length, 0, JSON.stringify(r.erros))
  assert.equal(r.alunos.length, 2)
  assert.equal(r.alunos[0].nome, 'Thaís Gonçalves')
  assert.equal(r.alunos[0].turma, '1º ano')
})

test('planilha em UTF-8 continua sendo lida como UTF-8', () => {
  const bytes = new TextEncoder().encode('Nome,Turma\nThaís Gonçalves,1º ano')
  const r = analisar(decodificar(bytes))
  assert.equal(r.alunos[0].nome, 'Thaís Gonçalves')
})

test('turma recusada volta na mensagem sem marcacao e com teto', () => {
  const r = analisar(`Nome,Turma\nAna Souza,"${'X'.repeat(200)}"`)
  assert.ok(r.erros[0].motivo.length < 80, 'a mensagem nao pode crescer com a entrada')
  const veneno = analisar('Nome,Turma\nAna Souza,"<script>alert(1)</script>"')
  assert.ok(!/[<>]/.test(veneno.erros[0].motivo), 'marcacao nao volta na mensagem')
})
