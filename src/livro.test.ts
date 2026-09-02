import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Livro } from './livro.ts'
import { TransicaoInvalida, AcaoNaoPermitida } from './estados.ts'

import { semear } from './semente.ts'

/** A turma de cada aluno da semente, para os atalhos nao precisarem adivinhar. */
const TURMA_DE = new Map(semear().map((a) => [a.id, a.turma]))

/** Atalhos: o ciclo normal, com o papel E a turma certos em cada etapa. */
const chamar = (l: Livro, id: string, t: number) =>
  l.aplicar({ tipo: 'chamar', alunoId: id }, t, 'portaria')
const liberar = (l: Livro, id: string, t: number) =>
  l.aplicar({ tipo: 'liberar', alunoId: id }, t, 'sala', TURMA_DE.get(id))
const entregar = (l: Livro, id: string, t: number) =>
  l.aplicar({ tipo: 'entregar', alunoId: id }, t, 'portaria')
const cancelar = (l: Livro, id: string, t: number) =>
  l.aplicar({ tipo: 'cancelar', alunoId: id }, t, 'portaria')

test('chamar cria uma chamada no estado chamado', () => {
  const livro = new Livro()
  chamar(livro, 'a01', 1000)
  const r = livro.retratoPara('portaria')
  assert.equal(r.chamadas.length, 1)
  assert.equal(r.chamadas[0].estado, 'chamado')
  assert.equal(r.chamadas[0].alunoId, 'a01')
})

test('o ciclo completo termina com a crianca fora do retrato', () => {
  const livro = new Livro()
  chamar(livro, 'a01', 1000)
  liberar(livro, 'a01', 2000)
  entregar(livro, 'a01', 3000)
  assert.equal(livro.retratoPara('portaria').chamadas.length, 0)
  assert.equal(livro.registro().at(-1)?.para, 'entregue')
})

test('liberar sem chamar e recusado', () => {
  const livro = new Livro()
  assert.throws(() => liberar(livro, 'a01', 1000), TransicaoInvalida)
})

test('aluno inexistente e recusado', () => {
  const livro = new Livro()
  assert.throws(() => chamar(livro, 'nao-existe', 1000), /desconhecido/)
})

test('a sala so ve a propria turma', () => {
  const livro = new Livro()
  chamar(livro, 'a01', 1000)
  chamar(livro, 'a09', 1000)
  const maternal = livro.retratoPara('sala', 'Pré 1')
  assert.equal(maternal.chamadas.length, 1)
  assert.ok(maternal.chamadas.every((c) => c.turma === 'Pré 1'))
  assert.equal(livro.retratoPara('portaria').chamadas.length, 2)
})

test('sala sem turma declarada nao ve ninguem', () => {
  const livro = new Livro()
  chamar(livro, 'a01', 1000)
  assert.equal(livro.retratoPara('sala').chamadas.length, 0)
})

test('o registro e append-only e cresce a cada transicao', () => {
  const livro = new Livro()
  chamar(livro, 'a01', 1000)
  liberar(livro, 'a01', 2000)
  assert.deepEqual(
    livro.registro().map((e) => [e.de, e.para]),
    [
      ['aguardando', 'chamado'],
      ['chamado', 'liberado'],
    ],
  )
})

test('o registro devolvido e uma copia: mexer nele nao apaga a trilha', () => {
  const livro = new Livro()
  chamar(livro, 'a01', 1000)
  livro.registro().length = 0
  assert.equal(livro.registro().length, 1)
})

test('o registro guarda QUEM fez, nao so o que foi feito', () => {
  const livro = new Livro()
  chamar(livro, 'a01', 1000)
  liberar(livro, 'a01', 2000)
  assert.equal(livro.registro()[0].papel, 'portaria')
  assert.equal(livro.registro()[1].papel, 'sala')
})

test('transicao recusada NAO entra no registro', () => {
  const livro = new Livro()
  assert.throws(() => liberar(livro, 'a01', 1000))
  assert.equal(livro.registro().length, 0)
})

test('cancelar volta para aguardando e some do retrato ativo', () => {
  const livro = new Livro()
  chamar(livro, 'a01', 1000)
  cancelar(livro, 'a01', 2000)
  assert.equal(livro.retratoPara('portaria').chamadas.length, 0)
})

test('cancelar deixa rastro no registro mesmo sumindo do retrato', () => {
  const livro = new Livro()
  chamar(livro, 'a01', 1000)
  cancelar(livro, 'a01', 2000)
  assert.equal(livro.registro().length, 2)
  assert.equal(livro.registro()[1].para, 'aguardando')
})

test('depois de cancelar, da para chamar de novo', () => {
  const livro = new Livro()
  chamar(livro, 'a01', 1000)
  cancelar(livro, 'a01', 2000)
  chamar(livro, 'a01', 3000)
  assert.equal(livro.retratoPara('portaria').chamadas[0].estado, 'chamado')
})

test('o retrato carrega carimbo de tempo', () => {
  const livro = new Livro()
  const r = livro.retratoPara('portaria', undefined, 5000)
  assert.equal(r.em, 5000)
  assert.equal(r.tipo, 'retrato')
})

test('alunos() devolve o cadastro inteiro', () => {
  assert.equal(new Livro().alunos().length, 44)
})

// --- regressao: red team C1, papel nao verificado ---

test('REGRESSAO C1: a sala NAO consegue chamar uma crianca', () => {
  const livro = new Livro()
  assert.throws(
    () => livro.aplicar({ tipo: 'chamar', alunoId: 'a01' }, 1000, 'sala'),
    AcaoNaoPermitida,
  )
  assert.equal(livro.retratoPara('portaria').chamadas.length, 0)
  assert.equal(livro.registro().length, 0)
})

test('REGRESSAO C1: a sequencia do ataque nao leva a crianca ate entregue', () => {
  const livro = new Livro()
  assert.throws(() => livro.aplicar({ tipo: 'chamar', alunoId: 'a01' }, 1000, 'sala'))
  assert.throws(() => livro.aplicar({ tipo: 'liberar', alunoId: 'a01' }, 2000, 'sala'))
  assert.throws(() => livro.aplicar({ tipo: 'entregar', alunoId: 'a01' }, 3000, 'sala'))
  assert.equal(livro.retratoPara('portaria').chamadas.length, 0)
  assert.equal(livro.registro().length, 0)
})

test('REGRESSAO C1: a portaria NAO consegue liberar sozinha', () => {
  const livro = new Livro()
  chamar(livro, 'a01', 1000)
  assert.throws(
    () => livro.aplicar({ tipo: 'liberar', alunoId: 'a01' }, 2000, 'portaria'),
    AcaoNaoPermitida,
  )
  assert.equal(livro.retratoPara('portaria').chamadas[0].estado, 'chamado')
})

// --- regressao: red team S1, entregue acumulando ---

test('REGRESSAO S1: entregar remove do retrato; ele nao vira o cadastro', () => {
  const livro = new Livro()
  // a17 a a20 sao do 3º ano; a21 e a22, do 4º ano.
  const turnos = ['a17', 'a18', 'a19', 'a20', 'a21', 'a22']
  for (const id of turnos) {
    chamar(livro, id, 1000)
    liberar(livro, id, 2000)
    entregar(livro, id, 3000)
  }
  assert.equal(livro.retratoPara('portaria').chamadas.length, 0)
  // A turma que REALMENTE teve criancas chamadas tem que esvaziar. Conferir
  // uma turma qualquer passaria mesmo se o retrato nunca fosse limpo.
  assert.equal(livro.retratoPara('sala', '3º ano').chamadas.length, 0)
  assert.equal(livro.retratoPara('sala', '4º ano').chamadas.length, 0)
  assert.equal(livro.registro().length, 18)
})

// --- regressao: red team S2, fila reordenando ---

test('REGRESSAO S2: liberar NAO reordena a fila', () => {
  const livro = new Livro()
  chamar(livro, 'a26', 1000)
  chamar(livro, 'a27', 1500)
  assert.deepEqual(
    livro.retratoPara('portaria').chamadas.map((c) => c.alunoId),
    ['a26', 'a27'],
  )
  liberar(livro, 'a26', 9000)
  assert.deepEqual(
    livro.retratoPara('portaria').chamadas.map((c) => c.alunoId),
    ['a26', 'a27'],
    'quem chegou primeiro continua primeiro depois de liberado',
  )
})

test('REGRESSAO S2: desde guarda a chegada, em guarda a ultima mudanca', () => {
  const livro = new Livro()
  chamar(livro, 'a01', 1000)
  liberar(livro, 'a01', 7000)
  const c = livro.retratoPara('portaria').chamadas[0]
  assert.equal(c.desde, 1000)
  assert.equal(c.em, 7000)
})

// --- regressao: red team M3, substituirCadastro no meio da saida ---

test('REGRESSAO M3: trocar o cadastro com crianca em saida e recusado', () => {
  const livro = new Livro()
  chamar(livro, 'a01', 1000)
  assert.throws(() => livro.substituirCadastro([]), /em saida/)
  assert.equal(livro.retratoPara('portaria').chamadas.length, 1)
})

test('trocar o cadastro com a saida encerrada funciona e preserva a trilha', () => {
  const livro = new Livro()
  chamar(livro, 'a01', 1000)
  cancelar(livro, 'a01', 2000)
  livro.substituirCadastro([{ id: 'z1', nome: 'Novo Aluno', turma: 'Pré 1' }])
  assert.equal(livro.alunos().length, 1)
  assert.equal(livro.registro().length, 2)
})

// --- regressao: red team 2, furo 1 — a sala liberava aluno de outra turma ---

test('REGRESSAO: a sala do Pré 1 NAO libera aluno do 9º ano', () => {
  const livro = new Livro()
  chamar(livro, 'a41', 1000) // Giovanna Paixao, 9º ano
  assert.throws(
    () => livro.aplicar({ tipo: 'liberar', alunoId: 'a41' }, 2000, 'sala', 'Pré 1'),
    /outra turma/,
  )
  assert.equal(livro.retratoPara('portaria').chamadas[0].estado, 'chamado')
})

test('REGRESSAO: sala sem turma declarada NAO age sobre ninguem', () => {
  const livro = new Livro()
  chamar(livro, 'a01', 1000)
  assert.throws(
    () => livro.aplicar({ tipo: 'liberar', alunoId: 'a01' }, 2000, 'sala'),
    /declarar a turma/,
  )
  assert.equal(livro.retratoPara('portaria').chamadas[0].estado, 'chamado')
})

test('REGRESSAO: varrer os ids de outra turma nao libera ninguem', () => {
  const livro = new Livro()
  const alvos = ['a05', 'a09', 'a17', 'a41']
  for (const id of alvos) chamar(livro, id, 1000)
  for (const id of alvos) {
    try {
      livro.aplicar({ tipo: 'liberar', alunoId: id }, 2000, 'sala', 'Pré 1')
    } catch {
      // esperado para todos: nenhum deles e do Pré 1
    }
  }
  const liberados = livro
    .retratoPara('portaria')
    .chamadas.filter((c) => c.estado === 'liberado')
  assert.equal(liberados.length, 0, 'nenhum deveria ter sido liberado')
})

test('a sala da turma certa continua liberando normalmente', () => {
  const livro = new Livro()
  chamar(livro, 'a01', 1000)
  livro.aplicar({ tipo: 'liberar', alunoId: 'a01' }, 2000, 'sala', 'Pré 1')
  assert.equal(livro.retratoPara('portaria').chamadas[0].estado, 'liberado')
})

test('o registro guarda a ORIGEM da acao, para rastrear o incidente', () => {
  const livro = new Livro()
  chamar(livro, 'a01', 1000)
  liberar(livro, 'a01', 2000)
  assert.equal(livro.registro()[0].origem, 'portaria')
  assert.equal(livro.registro()[1].origem, 'Pré 1')
  assert.equal(livro.registro()[1].turma, 'Pré 1')
})

// --- versao do cadastro ---

test('a versao do cadastro sobe a cada troca', () => {
  const livro = new Livro()
  const antes = livro.versao()
  livro.substituirCadastro([{ id: 'z1', nome: 'Novo Aluno', turma: 'Pré 1' }])
  assert.equal(livro.versao(), antes + 1)
})

test('o retrato carrega a versao do cadastro', () => {
  const livro = new Livro()
  assert.equal(livro.retratoPara('portaria').cadastro, livro.versao())
})

/*
  Chamada esquecida nao pode atravessar a noite.

  Enquanto o Livro morria a cada reinicio isso nao existia: o quadro nascia
  vazio todo dia. Com a persistencia da 0.2 ele sobrevive — e um "chamado" que
  ninguem fechou volta na manha seguinte parecendo responsavel no portao AGORA.
  A professora libera uma crianca para ninguem.

  E ha o segundo dano, mais silencioso: `substituirCadastro` recusa a troca com
  crianca em saida. Uma chamada esquecida de ontem tranca a secretaria fora da
  importacao para sempre, e antes bastava reiniciar.

  A expiracao usa a transicao que ja existe (`cancelar`, chamado -> aguardando)
  e entra na trilha como qualquer outra acao. Nao e remocao silenciosa.
*/

const UMA_HORA = 60 * 60 * 1000

test('chamada esquecida expira pelo caminho legitimo', () => {
  const livro = new Livro()
  const alvo = livro.alunos()[0]
  const ontem = 1_000_000
  livro.aplicar({ tipo: 'chamar', alunoId: alvo.id }, ontem, 'portaria')
  assert.equal(livro.retratoPara('portaria').chamadas.length, 1)

  const agora = ontem + 13 * UMA_HORA
  const eventos = livro.expirar(agora - 12 * UMA_HORA, agora)

  assert.equal(eventos.length, 1)
  assert.equal(eventos[0].alunoId, alvo.id)
  assert.equal(eventos[0].acao, 'cancelar')
  assert.equal(eventos[0].de, 'chamado')
  assert.equal(eventos[0].para, 'aguardando')
  assert.equal(livro.retratoPara('portaria').chamadas.length, 0)
})

test('a expiracao entra na trilha, nao apaga nada', () => {
  const livro = new Livro()
  const alvo = livro.alunos()[0]
  livro.aplicar({ tipo: 'chamar', alunoId: alvo.id }, 1000, 'portaria')
  const antes = livro.registro().length

  livro.expirar(1000 + UMA_HORA, 1000 + 2 * UMA_HORA)

  const trilha = livro.registro()
  assert.equal(trilha.length, antes + 1)
  assert.equal(trilha.at(-1)?.acao, 'cancelar')
  // Nao pode dizer que a portaria cancelou: ninguem cancelou.
  assert.equal(trilha.at(-1)?.papel, 'sistema')
  assert.match(String(trilha.at(-1)?.origem), /expiracao/)
})

test('a expiracao nao toca em chamada recente', () => {
  const livro = new Livro()
  const alvo = livro.alunos()[0]
  livro.aplicar({ tipo: 'chamar', alunoId: alvo.id }, 10_000, 'portaria')

  const eventos = livro.expirar(10_000 - UMA_HORA, 10_000 + 60_000)

  assert.equal(eventos.length, 0)
  assert.equal(livro.retratoPara('portaria').chamadas.length, 1)
})

test('a expiracao NAO fecha um liberado, porque isso seria forjar a entrega', () => {
  /*
    `liberado` significa que a professora confirmou e a crianca esta a caminho
    do portao. Marca-la como entregue automaticamente seria o sistema afirmando
    que um adulto recebeu a crianca, sem nenhum adulto ter recebido nada. E
    devolve-la para `aguardando` apagaria a confirmacao da professora, que e o
    unico evento que este sistema existe para proteger.

    Entao ela FICA no quadro, de proposito. Uma crianca liberada e nao entregue
    e um caso aberto que uma pessoa precisa fechar — inclusive continuando a
    trancar a troca de cadastro, que e para o que essa tranca serve.
  */
  const livro = new Livro()
  const alvo = livro.alunos()[0]
  livro.aplicar({ tipo: 'chamar', alunoId: alvo.id }, 1000, 'portaria')
  livro.aplicar({ tipo: 'liberar', alunoId: alvo.id }, 1100, 'sala', alvo.turma)

  const eventos = livro.expirar(1000 + 99 * UMA_HORA, 1000 + 100 * UMA_HORA)

  assert.equal(eventos.length, 0)
  assert.equal(livro.retratoPara('portaria').chamadas[0]?.estado, 'liberado')
})

test('a recusa da troca de cadastro DIZ quem esta em saida', () => {
  // "ha 1 crianca em saida agora" manda a secretaria procurar sem dizer onde.
  const livro = new Livro()
  const alvo = livro.alunos()[0]
  livro.aplicar({ tipo: 'chamar', alunoId: alvo.id }, 1000, 'portaria')

  assert.throws(
    () => livro.substituirCadastro([]),
    (e: Error) => e.message.includes(alvo.nome),
    'a mensagem precisa nomear a crianca para a secretaria conseguir agir',
  )
})

test('REGRESSAO: a expiracao corta por `em`, nao por `desde`', () => {
  /*
    `desde` e a chave de ORDENACAO da fila, e `aplicar` a preserva entre as
    transicoes do mesmo ciclo (`anterior?.desde ?? agora`). Hoje as duas
    coincidem para quem esta `chamado`, porque toda chamada nasce vinda de
    `aguardando`, sem anterior — mas isso e coincidencia, nao regra.

    Com o corte por `desde`, a primeira transicao que traga um `desde` antigo
    faz a chamada nascer VENCIDA, e o proximo passe de expiracao a apaga do
    quadro com o responsavel parado no portao. `em` e o instante da ultima
    acao, que e o que "esquecida" quer dizer.

    O teste entra pelo caminho de producao: o Livro hidratado de um
    instantaneo, como o Durable Object faz a cada acordar.
  */
  const semente = new Livro().alunos()
  const alvo = semente[0]
  const ontem = 1_000_000
  const agora = ontem + 13 * UMA_HORA

  const recemMexida = new Livro({
    alunos: semente,
    chamadas: [
      {
        alunoId: alvo.id,
        nome: alvo.nome,
        turma: alvo.turma,
        estado: 'chamado',
        desde: ontem,
        em: agora - 60_000,
      },
    ],
    trilha: [],
    versaoCadastro: 1,
  })

  assert.equal(
    recemMexida.expirar(agora - 12 * UMA_HORA, agora).length,
    0,
    'chamada mexida ha um minuto nao esta esquecida, por mais velho que seja o desde',
  )
  assert.equal(recemMexida.retratoPara('portaria').chamadas.length, 1)

  const esquecida = new Livro({
    alunos: semente,
    chamadas: [
      {
        alunoId: alvo.id,
        nome: alvo.nome,
        turma: alvo.turma,
        estado: 'chamado',
        desde: agora - 60_000,
        em: ontem,
      },
    ],
    trilha: [],
    versaoCadastro: 1,
  })

  assert.equal(
    esquecida.expirar(agora - 12 * UMA_HORA, agora).length,
    1,
    'chamada sem nenhuma acao ha 13 horas esta esquecida, por mais novo que seja o desde',
  )
  assert.equal(esquecida.retratoPara('portaria').chamadas.length, 0)
})

/*
  O retorno visto do Livro: o que a trilha grava, e o que a fila mostra.
*/

function comCriancaLiberada() {
  const livro = new Livro()
  const alvo = livro.alunos()[0]
  livro.aplicar({ tipo: 'chamar', alunoId: alvo.id }, 1000, 'portaria')
  livro.aplicar({ tipo: 'liberar', alunoId: alvo.id }, 1100, 'sala', alvo.turma)
  return { livro, alvo }
}

test('a professora devolve a crianca, com razao, e a fila mostra `retorno`', () => {
  const { livro, alvo } = comCriancaLiberada()
  const evento = livro.aplicar(
    { tipo: 'retornar', alunoId: alvo.id, razao: 'esqueceu-material' },
    1200,
    'sala',
    alvo.turma,
  )

  assert.equal(evento.de, 'liberado')
  assert.equal(evento.para, 'retorno')
  assert.equal(evento.razao, 'esqueceu-material')
  assert.equal(evento.origem, alvo.turma)
  assert.equal(livro.retratoPara('portaria').chamadas[0]?.estado, 'retorno')
})

test('sem razao valida, o retorno e RECUSADO', () => {
  // Fail-closed, do mesmo jeito que papel e turma. Um retorno sem razao entra
  // na trilha para sempre e ninguem descobre depois por que aconteceu.
  for (const razao of [undefined, '', 'qualquer coisa', 'Esqueceu Material', 42]) {
    const { livro, alvo } = comCriancaLiberada()
    assert.throws(
      () => livro.aplicar(
        { tipo: 'retornar', alunoId: alvo.id, razao } as never,
        1200, 'sala', alvo.turma,
      ),
      /raz/i,
      `aceitou ${JSON.stringify(razao)}`,
    )
    // E nao deixou rastro: a crianca continua liberada.
    assert.equal(livro.retratoPara('portaria').chamadas[0]?.estado, 'liberado')
  }
})

test('REGRESSAO: razao mandada em OUTRA acao nao entra na trilha', () => {
  /*
    Se `aplicar` copiasse `comando.razao` sem zera-la fora de `retornar`,
    qualquer sessao — e o papel vem da query string, sem autenticacao — gravaria
    texto arbitrario numa tabela que nao tem UPDATE nem DELETE por linha.
  */
  const livro = new Livro()
  const alvo = livro.alunos()[0]
  const evento = livro.aplicar(
    { tipo: 'chamar', alunoId: alvo.id, razao: 'esqueceu-material' } as never,
    1000,
    'portaria',
  )
  assert.equal(evento.razao, '')
})

test('so a portaria tira a crianca do retorno', () => {
  const { livro, alvo } = comCriancaLiberada()
  livro.aplicar(
    { tipo: 'retornar', alunoId: alvo.id, razao: 'nao-saiu-com-o-responsavel' },
    1200, 'sala', alvo.turma,
  )

  // A sala nao consegue liberar de novo sem alguem reconfirmar o portao.
  assert.throws(
    () => livro.aplicar({ tipo: 'liberar', alunoId: alvo.id }, 1300, 'sala', alvo.turma),
    /nao e possivel/,
  )
  // Nem encerrar.
  assert.throws(
    () => livro.aplicar({ tipo: 'encerrar', alunoId: alvo.id }, 1300, 'sala', alvo.turma),
    /da portaria/,
  )

  const volta = livro.aplicar({ tipo: 'chamar', alunoId: alvo.id }, 1400, 'portaria')
  assert.equal(volta.para, 'chamado')
})

test('`desde` reinicia quando a portaria chama de novo', () => {
  /*
    `desde` e "desde quando o responsavel esta no portao", e e a chave de
    ordenacao da fila. Preservado atraves do retorno, a crianca reapareceria no
    TOPO da fila como quem espera ha mais tempo — e a 1.3 vai desenhar um
    cronometro em cima disso, entao a mentira viraria "esperando ha 47 min".
  */
  const { livro, alvo } = comCriancaLiberada()
  const primeiraEspera = livro.retratoPara('portaria').chamadas[0].desde
  assert.equal(primeiraEspera, 1000)

  livro.aplicar(
    { tipo: 'retornar', alunoId: alvo.id, razao: 'esqueceu-material' },
    1200, 'sala', alvo.turma,
  )
  livro.aplicar({ tipo: 'chamar', alunoId: alvo.id }, 9000, 'portaria')

  assert.equal(livro.retratoPara('portaria').chamadas[0].desde, 9000)
})

test('encerrar tira a crianca do quadro, e a trilha guarda tudo', () => {
  const { livro, alvo } = comCriancaLiberada()
  livro.aplicar(
    { tipo: 'retornar', alunoId: alvo.id, razao: 'nao-saiu-com-o-responsavel' },
    1200, 'sala', alvo.turma,
  )
  const fim = livro.aplicar({ tipo: 'encerrar', alunoId: alvo.id }, 1300, 'portaria')

  assert.equal(fim.para, 'aguardando')
  assert.equal(livro.retratoPara('portaria').chamadas.length, 0)

  const trilha = livro.registro()
  assert.deepEqual(
    trilha.map((e) => e.acao),
    ['chamar', 'liberar', 'retornar', 'encerrar'],
  )
})

test('`retorno` esquecido tambem expira, pelo caminho da portaria', () => {
  /*
    Sem isto, o retorno viraria o novo caso aberto eterno: a crianca voltou para
    a sala, ninguem chamou de novo, ninguem encerrou, e o quadro carrega isso
    para sempre — inclusive trancando a troca de cadastro.
  */
  const { livro, alvo } = comCriancaLiberada()
  livro.aplicar(
    { tipo: 'retornar', alunoId: alvo.id, razao: 'outro' },
    1200, 'sala', alvo.turma,
  )

  const agora = 1200 + 13 * UMA_HORA
  const eventos = livro.expirar(agora - 12 * UMA_HORA, agora)

  assert.equal(eventos.length, 1)
  assert.equal(eventos[0].de, 'retorno')
  assert.equal(eventos[0].para, 'aguardando')
  assert.equal(eventos[0].acao, 'encerrar')
  assert.equal(eventos[0].papel, 'sistema')
  assert.equal(livro.retratoPara('portaria').chamadas.length, 0)
})

test('REGRESSAO: `liberado` continua NAO expirando', () => {
  // Marca-lo como entregue seria afirmar que um adulto recebeu a crianca sem
  // nenhum adulto ter recebido nada. Continua sendo caso para uma pessoa fechar.
  const { livro } = comCriancaLiberada()
  const agora = 1100 + 99 * UMA_HORA
  assert.equal(livro.expirar(agora - 12 * UMA_HORA, agora).length, 0)
  assert.equal(livro.retratoPara('portaria').chamadas[0]?.estado, 'liberado')
})
