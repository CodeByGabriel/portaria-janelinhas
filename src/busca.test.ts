import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizar, buscar } from './busca.ts'
import type { Aluno } from './semente.ts'

const ALUNOS: Aluno[] = [
  { id: '1', nome: 'Thaís Gonçalves', turma: '2º ano' },
  { id: '2', nome: 'João Conceição', turma: 'Pré 1' },
  { id: '3', nome: 'Ana Beatriz Souza', turma: '1º ano' },
  { id: '4', nome: 'Thiago Alves', turma: 'Pré 2' },
]

test('normalizar tira acento e caixa', () => {
  assert.equal(normalizar('Thaís'), 'thais')
  assert.equal(normalizar('GONÇALVES'), 'goncalves')
  assert.equal(normalizar('Conceição'), 'conceicao')
})

test('normalizar colapsa espaco sobrando', () => {
  assert.equal(normalizar('  Ana   Beatriz  '), 'ana beatriz')
})

test('acha nome acentuado digitando sem acento', () => {
  const r = buscar(ALUNOS, 'thais')
  assert.equal(r.achados.length, 1)
  assert.equal(r.achados[0].nome, 'Thaís Gonçalves')
})

test('acha pelo sobrenome', () => {
  assert.equal(buscar(ALUNOS, 'goncalves').achados[0].id, '1')
})

test('acha por prefixo parcial', () => {
  const r = buscar(ALUNOS, 'thi')
  assert.equal(r.achados.length, 1)
  assert.equal(r.achados[0].nome, 'Thiago Alves')
})

test('prefixo ambiguo devolve os dois', () => {
  assert.equal(buscar(ALUNOS, 'th').achados.length, 2)
})

test('consulta vazia nao devolve ninguem', () => {
  assert.equal(buscar(ALUNOS, '').achados.length, 0)
  assert.equal(buscar(ALUNOS, '   ').achados.length, 0)
  assert.equal(buscar(ALUNOS, '').total, 0)
})

test('busca por duas palavras exige as duas', () => {
  assert.equal(buscar(ALUNOS, 'ana beatriz').achados.length, 1)
  assert.equal(buscar(ALUNOS, 'ana thiago').achados.length, 0)
})

test('acha quem tem acento digitando COM acento tambem', () => {
  assert.equal(buscar(ALUNOS, 'thaís').achados.length, 1)
  assert.equal(buscar(ALUNOS, 'joão').achados.length, 1)
})

// --- regressao: red team S3, apostrofo e hifen ---

const COMPOSTOS: Aluno[] = [
  { id: 'c1', nome: "Maria Sant'Ana", turma: 'Pré 1' },
  { id: 'c2', nome: 'Luís Gonzaga D’Ávila', turma: 'Pré 2' },
  { id: 'c3', nome: 'Ana-Clara Vasconcelos', turma: '2º ano' },
  { id: 'c4', nome: "Pedro D'Alessandro", turma: '1º ano' },
]

test('REGRESSAO S3: acha sobrenome depois do apostrofo reto', () => {
  assert.equal(buscar(COMPOSTOS, 'ana').achados.some((a) => a.id === 'c1'), true)
  assert.equal(buscar(COMPOSTOS, 'sant').achados[0].id, 'c1')
})

test('REGRESSAO S3: acha depois do apostrofo tipografico do Excel', () => {
  const r = buscar(COMPOSTOS, 'avila')
  assert.equal(r.achados.length, 1)
  assert.equal(r.achados[0].id, 'c2')
})

test('REGRESSAO S3: acha a segunda metade de nome com hifen', () => {
  assert.equal(buscar(COMPOSTOS, 'clara').achados[0].id, 'c3')
  assert.equal(buscar(COMPOSTOS, 'ana').achados.some((a) => a.id === 'c3'), true)
})

test('REGRESSAO S3: D Alessandro achavel pelo sobrenome', () => {
  assert.equal(buscar(COMPOSTOS, 'alessandro').achados[0].id, 'c4')
})

test('normalizar transforma separador em espaco, nao apaga', () => {
  assert.equal(normalizar("Sant'Ana"), 'sant ana')
  assert.equal(normalizar('Ana-Clara'), 'ana clara')
  assert.equal(normalizar('D’Ávila'), 'd avila')
})

// --- regressao: red team S4, truncagem silenciosa ---

test('REGRESSAO S4: o corte e informado, nunca silencioso', () => {
  const homonimas: Aluno[] = Array.from({ length: 20 }, (_, i) => ({
    id: `h${i}`,
    nome: `Maria Eduarda Sobrenome${i}`,
    turma: 'Pré 1' as const,
  }))
  const r = buscar(homonimas, 'maria eduarda')
  assert.equal(r.achados.length, 8, 'a tela do celular recebe 8')
  assert.equal(r.total, 20, 'mas o total diz que ha 20')
  assert.ok(r.total > r.achados.length, 'a interface consegue avisar que cortou')
})

test('quando nao corta, total e igual ao numero de achados', () => {
  const r = buscar(ALUNOS, 'th')
  assert.equal(r.total, r.achados.length)
})

test('o limite e respeitado', () => {
  assert.equal(buscar(ALUNOS, 'a', 2).achados.length, 2)
})

/*
  Ordenacao e homonimos: o que faltava na busca.
*/

import type { Turma } from './semente.ts'

const TURMA: Turma = 'Pré 1'
const aluno = (id: string, nome: string, turma: Turma = TURMA) => ({ id, nome, turma })

test('quem casa no PRIMEIRO nome vem antes de quem casa no sobrenome', () => {
  /*
    A busca nao ordenava nada: os resultados saiam na ordem do cadastro, que e
    a ordem da planilha. Com o corte em 8, a crianca obvia podia ficar de fora
    por acaso de posicao — e a porteira concluiria que ela nao esta matriculada,
    ou tocaria numa homonima.

    Quem opera digita o que ouve, e o que se ouve no portao e o primeiro nome.
  */
  const cadastro = [
    aluno('a', 'Beatriz Silva'),
    aluno('b', 'Silvana Rocha'),
    aluno('c', 'Ana Silva'),
  ]
  const { achados } = buscar(cadastro, 'silva')
  // Silvana primeiro porque o termo casa no primeiro nome dela. As outras duas
  // empatam em proximidade e desempatam pelo nome, que e a regra estavel.
  assert.deepEqual(achados.map((x) => x.nome), ['Silvana Rocha', 'Ana Silva', 'Beatriz Silva'])
})

test('empate desempata pelo nome, para a lista nao dancar', () => {
  // Ordem estavel importa: a lista e reconstruida a cada tecla, e resultado que
  // troca de lugar sozinho e botao que foge do dedo.
  const cadastro = [aluno('a', 'Ana Zuleide'), aluno('b', 'Ana Beatriz')]
  assert.deepEqual(
    buscar(cadastro, 'ana').achados.map((x) => x.nome),
    ['Ana Beatriz', 'Ana Zuleide'],
  )
})

test('REGRESSAO: iniciais e sobrenome continuam achando', () => {
  const cadastro = [aluno('a', 'Maria Eduarda Nogueira')]
  for (const consulta of ['m e n', 'nogueira', 'maria nog', 'eduarda', 'MARIA']) {
    assert.equal(buscar(cadastro, consulta).achados.length, 1, `"${consulta}" nao achou`)
  }
})

test('homonimos vem marcados, mesmo o que ficou fora do corte', () => {
  /*
    Numa escola de 292, "Maria Eduarda" repete. Chamar a homonima errada avisa a
    SALA errada, e a crianca certa continua esperando.

    A marca olha o cadastro INTEIRO, nao so os resultados mostrados: se ha duas
    Marias e o corte deixou uma de fora, a que aparece continua precisando de
    aviso — e e justamente esse o caso em que ninguem desconfia.
  */
  const cadastro = [
    aluno('a', 'Maria Eduarda', 'Pré 1'),
    aluno('b', 'Maria Eduarda', '9º ano'),
    aluno('c', 'Joana Prado'),
  ]
  const r = buscar(cadastro, 'maria', 1)
  assert.equal(r.achados.length, 1)
  assert.equal(r.total, 2)
  assert.ok(r.homonimos.includes(r.achados[0].id), 'a que aparece nao foi marcada')
})

test('acento e caixa nao criam homonimo falso nem escondem um verdadeiro', () => {
  const cadastro = [aluno('a', 'Thaís Lima'), aluno('b', 'THAIS LIMA'), aluno('c', 'Thales Lima')]
  const r = buscar(cadastro, 'lima')
  assert.equal(r.homonimos.length, 2)
  assert.ok(!r.homonimos.includes('c'))
})

test('nome unico nao e marcado como homonimo', () => {
  const cadastro = [aluno('a', 'Joana Prado'), aluno('b', 'Bruno Assuncao')]
  assert.deepEqual(buscar(cadastro, 'a').homonimos, [])
})
