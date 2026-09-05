import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Livro } from './livro.ts'
import { semear, responsaveisDaSemente } from './semente.ts'
import { motivoDe } from './portaria.ts'

/*
  Nenhuma recusa pode chegar MUDA na tela.

  `motivoDe` e uma allowlist: mensagem nao prevista vira "comando recusado".
  E a escolha certa — erro interno cru nao vai para a tela da professora — mas
  tem um preco que morde: toda regra nova do Livro precisa entrar na lista,
  senao a professora ve "comando recusado" e nao fica sabendo que faltou
  escolher o motivo do retorno, ou que aquele adulto esta impedido.

  Estes testes cobram o preco: um provoca cada regra de verdade, o outro varre
  o fonte atras de mensagem que ninguem provocou.
*/

const alice = () => semear().find((a) => a.nome === 'Alice Fernandes')!
const familias = responsaveisDaSemente()

function comFamilias(): Livro {
  const l = new Livro()
  l.substituirResponsaveis(familias.responsaveis, familias.vinculos)
  return l
}

function capturar(f: () => unknown): unknown {
  try {
    f()
    return null
  } catch (erro) {
    return erro
  }
}

test('cada regra do Livro chega a tela com a propria mensagem', () => {
  const a = alice()
  const casos: [string, () => unknown][] = [
    ['sala sem turma', () => new Livro().aplicar({ tipo: 'liberar', alunoId: a.id }, 1, 'sala')],
    ['aluno desconhecido', () => new Livro().aplicar({ tipo: 'chamar', alunoId: 'z99' }, 1, 'portaria')],
    [
      'crianca de outra turma',
      () => {
        const l = new Livro()
        l.aplicar({ tipo: 'chamar', alunoId: a.id }, 1, 'portaria')
        return l.aplicar({ tipo: 'liberar', alunoId: a.id }, 2, 'sala', '9º ano')
      },
    ],
    ['transicao invalida', () => new Livro().aplicar({ tipo: 'liberar', alunoId: a.id }, 1, 'sala', a.turma)],
    ['acao de outro dono', () => new Livro().aplicar({ tipo: 'chamar', alunoId: a.id }, 1, 'sala', a.turma)],
    [
      'entregar sem dizer a quem',
      () => {
        const l = comFamilias()
        l.aplicar({ tipo: 'chamar', alunoId: a.id }, 1, 'portaria')
        l.aplicar({ tipo: 'liberar', alunoId: a.id }, 2, 'sala', a.turma)
        return l.aplicar({ tipo: 'entregar', alunoId: a.id }, 3, 'portaria')
      },
    ],
    [
      'entregar a quem esta impedido',
      () => {
        const l = comFamilias()
        const impedido = l.responsaveisDe(a.id).find((r) => r.impedido)!
        l.aplicar({ tipo: 'chamar', alunoId: a.id }, 1, 'portaria')
        l.aplicar({ tipo: 'liberar', alunoId: a.id }, 2, 'sala', a.turma)
        return l.aplicar({ tipo: 'entregar', alunoId: a.id, responsavelId: impedido.id }, 3, 'portaria')
      },
    ],
    [
      'retornar sem razao valida',
      () => {
        const l = new Livro()
        l.aplicar({ tipo: 'chamar', alunoId: a.id }, 1, 'portaria')
        l.aplicar({ tipo: 'liberar', alunoId: a.id }, 2, 'sala', a.turma)
        return l.aplicar({ tipo: 'retornar', alunoId: a.id, razao: 'inventada' }, 3, 'sala', a.turma)
      },
    ],
    [
      'trocar cadastro com crianca em saida',
      () => {
        const l = new Livro()
        l.aplicar({ tipo: 'chamar', alunoId: a.id }, 1, 'portaria')
        return l.substituirCadastro(semear())
      },
    ],
    [
      'delegacao vencida',
      () =>
        comFamilias().adicionarDelegacao(
          { id: 'd', alunoId: a.id, nome: 'Avó', vinculo: '', telefone: '', validoDe: 1, validoAte: 2, autorizadoPor: 'r' },
          10,
        ),
    ],
    [
      'delegacao com janela invertida',
      () =>
        comFamilias().adicionarDelegacao(
          { id: 'd', alunoId: a.id, nome: 'Avó', vinculo: '', telefone: '', validoDe: 100, validoAte: 50, autorizadoPor: 'r' },
          1,
        ),
    ],
    [
      'delegacao de quem nao pode autorizar',
      () =>
        comFamilias().adicionarDelegacao(
          { id: 'd', alunoId: a.id, nome: 'Avó', vinculo: '', telefone: '', validoDe: 1, validoAte: 1000, autorizadoPor: 'ninguem' },
          1,
        ),
    ],
    [
      'delegacao para quem esta impedido',
      () => {
        const l = comFamilias()
        const impedido = l.responsaveisDe(a.id).find((r) => r.impedido)!
        const titular = l.responsaveisDe(a.id).find((r) => !r.impedido)!
        return l.adicionarDelegacao(
          { id: 'd', alunoId: a.id, nome: impedido.nome, vinculo: '', telefone: '', validoDe: 1, validoAte: 1000, autorizadoPor: titular.id },
          1,
        )
      },
    ],
    [
      'id de delegacao reusado para outra crianca',
      () => {
        const l = comFamilias()
        const titular = l.responsaveisDe(a.id).find((r) => !r.impedido)!
        const d = { id: 'd', alunoId: a.id, nome: 'Avó', vinculo: '', telefone: '', validoDe: 1, validoAte: 1000, autorizadoPor: titular.id }
        l.adicionarDelegacao(d, 1)
        const outra = semear().find((x) => x.id !== a.id)!
        return l.adicionarDelegacao({ ...d, alunoId: outra.id }, 1)
      },
    ],
  ]

  for (const [rotulo, provocar] of casos) {
    const erro = capturar(provocar)
    assert.ok(erro instanceof Error, `${rotulo}: nao lancou`)
    const motivo = motivoDe(erro)
    assert.notEqual(motivo, 'comando recusado', `${rotulo} chegaria mudo na tela`)
    // E chega curto: a recusa e uma frase, nao um despejo.
    assert.ok(motivo.length <= 120, `${rotulo}: ${motivo.length} caracteres`)
  }
})

test('nenhuma mensagem escrita no Livro fica de fora da lista', () => {
  const fonte = readFileSync(new URL('./livro.ts', import.meta.url), 'utf8')
  const mensagens = [...fonte.matchAll(/throw new Error\(\s*[`'"]([^`'"]{8,})/g)].map((m) => m[1])
  assert.ok(mensagens.length >= 8, `so achei ${mensagens.length} mensagens no fonte`)
  for (const mensagem of mensagens) {
    assert.notEqual(
      motivoDe(new Error(mensagem)),
      'comando recusado',
      `esta mensagem chegaria muda: "${mensagem}"`,
    )
  }
})

test('erro interno cru NAO chega a tela', () => {
  for (const cru of [
    new Error("Cannot read properties of null (reading 'nome')"),
    new Error('SQLITE_BUSY: database is locked'),
    new TypeError('x is not a function'),
    'um texto solto',
    null,
    undefined,
  ]) {
    assert.equal(motivoDe(cru), 'comando recusado')
  }
})
