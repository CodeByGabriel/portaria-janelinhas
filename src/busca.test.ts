import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizar, buscar } from './busca.ts'
import type { Aluno } from './semente.ts'

const ALUNOS: Aluno[] = [
  { id: '1', nome: 'Thaís Gonçalves', turma: 'Jardim II' },
  { id: '2', nome: 'João Conceição', turma: 'Maternal' },
  { id: '3', nome: 'Ana Beatriz Souza', turma: '1º ano' },
  { id: '4', nome: 'Thiago Alves', turma: 'Jardim I' },
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
  { id: 'c1', nome: "Maria Sant'Ana", turma: 'Maternal' },
  { id: 'c2', nome: 'Luís Gonzaga D’Ávila', turma: 'Jardim I' },
  { id: 'c3', nome: 'Ana-Clara Vasconcelos', turma: 'Jardim II' },
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
    turma: 'Maternal' as const,
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
