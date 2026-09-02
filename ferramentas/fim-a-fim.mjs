/**
 * Verificacao fim-a-fim contra o servidor rodando.
 * Nao entra no `npm test` porque exige `npm run dev` de pe.
 *
 *   node ferramentas/fim-a-fim.mjs
 *
 * A segunda metade sao os ataques que o red team reproduziu ao vivo. Eles
 * ficam aqui para sempre: um furo consertado sem teste volta.
 *
 * As contagens sao absolutas ("a portaria ve 1 chamada"), entao o arquivo
 * comeca esvaziando a mesa (`limparMesa`). Antes da trilha passar a persistir
 * isso nao era preciso: o quadro morria junto com o servidor. Agora ele
 * sobrevive, e uma rodada do `prints.mjs` — que semeia tres chamados — fazia
 * quatro verificacoes falharem sem haver bug nenhum.
 */
const BASE = process.env.BASE ?? 'ws://127.0.0.1:8787'
const HTTP = BASE.replace(/^ws/, 'http')

let falhas = 0
function conferir(rotulo, condicao, detalhe = '') {
  if (condicao) {
    console.log(`  ok    ${rotulo}`)
  } else {
    falhas++
    console.log(`  FALHA ${rotulo} ${detalhe}`)
  }
}

function ligar(query) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${BASE}/ws?${query}`)
    const recebidos = []
    ws.addEventListener('message', (e) => recebidos.push(JSON.parse(e.data)))
    ws.addEventListener('open', () => resolve({ ws, recebidos }))
    ws.addEventListener('error', () => reject(new Error(`nao ligou: ${query}`)))
    // 15s, nao 5s: o Durable Object frio demora na primeira conexao e um
    // timeout apertado vira falha falsa que manda a gente cacar bug que nao existe.
    setTimeout(() => reject(new Error(`timeout ligando ${query}`)), 15000)
  })
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
const ultimo = (c) => c.recebidos.filter((m) => m.tipo === 'retrato').at(-1)
const recusas = (c) => c.recebidos.filter((m) => m.tipo === 'recusa')

/**
 * Deixa a mesa vazia antes das contagens absolutas comecarem.
 *
 * Fecha cada ciclo pelo caminho LEGITIMO — cancelar o que esta chamado,
 * entregar o que esta liberado — e nunca apagando: a trilha continua
 * append-only e guarda que a limpeza aconteceu, como guardaria qualquer
 * outra acao da portaria.
 *
 * O cabecalho deste arquivo pedia um `rm -rf .wrangler/state` na mao. Ritual
 * manual antes de um portao e portao que para de rodar.
 */
/*
  Como a portaria fecha cada estado. Uma tabela, e nao um encadeado de ifs,
  para que estado novo obrigue alguem a decidir aqui — foi assim que o
   chegou e a limpeza rodou dez voltas sem conseguir esvaziar nada.
*/
const FECHA = {
  chamado: 'cancelar',
  liberado: 'entregar',
  retorno: 'encerrar',
}

async function limparMesa(portaria) {
  for (let volta = 0; volta < 10; volta++) {
    const chamadas = ultimo(portaria)?.chamadas ?? []
    if (chamadas.length === 0) return true
    for (const c of chamadas) {
      const tipo = FECHA[c.estado]
      if (!tipo) continue
      portaria.ws.send(JSON.stringify({ tipo, alunoId: c.alunoId }))
    }
    await esperar(300)
  }
  return (ultimo(portaria)?.chamadas ?? []).length === 0
}

/*
  Os ids vem da LISTA, nao escritos a mao.

  Este arquivo usava `a01`, `a04`, `a41` — o esquema posicional da semente. Bom
  enquanto o cadastro fosse sempre a semente; e ele nao e: qualquer importacao
  recalcula os ids a partir de nome+turma (`i<hash>`), e a partir dai todo
  `alunoId: ID.a01` aponta para ninguem. Bastou uma verificacao de tela
  reimportar a planilha para este arquivo inteiro falhar, sem uma linha de
  relacao com o que ele testa.

  Resolver por posicao na lista mantem o significado que os numeros tinham
  ("o primeiro do Pré 1", "o ultimo da escola") e para de depender de COMO os
  ids sao formados.
*/
async function resolverIds() {
  const alunos = await fetch(`${HTTP}/alunos?papel=portaria`).then((r) => r.json())
  if (alunos.length < 6) throw new Error(`cadastro pequeno demais: ${alunos.length}`)

  const doPre1 = alunos.filter((a) => a.turma === 'Pré 1')
  const do1ano = alunos.filter((a) => a.turma === '1º ano')
  if (doPre1.length < 4 || do1ano.length < 1) {
    throw new Error('cadastro sem as turmas que este arquivo usa')
  }

  return {
    // Os quatro primeiros do Pré 1, na ordem em que a semente os punha.
    a01: doPre1[0].id,
    a02: doPre1[1].id,
    a03: doPre1[2].id,
    a04: doPre1[3].id,
    // O primeiro do 1º ano: usado para provar que a sala do Pré 1 nao o alcanca.
    a05: do1ano[0].id,
    // O ultimo da escola: usado na varredura de ids.
    a41: alunos[alunos.length - 1].id,
  }
}

async function principal() {
  console.log('\n== ciclo normal ==')

  const ID = await resolverIds()

  const portaria = await ligar('papel=portaria')
  const maternal = await ligar('papel=sala&turma=Pr%C3%A9%201')
  const jardim = await ligar('papel=sala&turma=1%C2%BA%20ano')
  await esperar(300)

  conferir('as tres conexoes recebem retrato inicial',
    [portaria, maternal, jardim].every((c) => ultimo(c)))

  conferir('a mesa comeca vazia', await limparMesa(portaria),
    `sobraram ${ultimo(portaria)?.chamadas.length}`)

  /*
    Marca onde a trilha estava antes desta rodada.

    A trilha e append-only E persiste. As verificacoes que a percorrem inteira
    passaram a somar as rodadas anteriores: "a trilha guarda as duas voltas"
    encontrava seis, e "nenhuma acao recusada" tropecava em coisa de outro dia.
    Nada disso e bug do app — e o teste medindo o historico em vez de medir o
    que ele mesmo acabou de fazer.
  */
  const marcaDaTrilha = (
    await fetch(`${HTTP}/registro?papel=portaria`).then((r) => r.json())
  ).length
  const trilhaDesta = async () =>
    (await fetch(`${HTTP}/registro?papel=portaria`).then((r) => r.json())).slice(marcaDaTrilha)

  portaria.ws.send(JSON.stringify({ tipo: 'chamar', alunoId: ID.a01 }))
  await esperar(400)

  conferir('a portaria ve a chamada', ultimo(portaria)?.chamadas.length === 1)
  conferir('o Pré 1 ve a propria crianca', ultimo(maternal)?.chamadas.length === 1)
  conferir('o 1º ano NAO ve crianca de outra turma',
    ultimo(jardim)?.chamadas.length === 0)
  conferir('o estado e chamado', ultimo(maternal)?.chamadas[0]?.estado === 'chamado')
  conferir('a chamada carrega desde e em',
    typeof ultimo(maternal)?.chamadas[0]?.desde === 'number' &&
    typeof ultimo(maternal)?.chamadas[0]?.em === 'number')

  maternal.ws.send(JSON.stringify({ tipo: 'liberar', alunoId: ID.a01 }))
  await esperar(400)
  conferir('liberar propaga para a portaria',
    ultimo(portaria)?.chamadas[0]?.estado === 'liberado')

  portaria.ws.send(JSON.stringify({ tipo: 'entregar', alunoId: ID.a01 }))
  await esperar(400)
  conferir('S1: entregar TIRA a crianca do retrato, nao acumula',
    ultimo(portaria)?.chamadas.length === 0,
    `sobraram ${ultimo(portaria)?.chamadas.length}`)

  console.log('\n== a volta para a sala, e quem pode o que ==')

  /*
    Uma crianca liberada que nunca foi entregue ficava no quadro para sempre: a
    expiracao fecha `chamado` esquecido, mas nao fecha `liberado`, porque
    marca-la como entregue seria o sistema afirmar que um adulto recebeu a
    crianca sem nenhum adulto ter recebido nada.

    `retornar` e a primeira saida legitima desse estado. E o destino NAO e
    `chamado`: neste sistema `chamado` significa literalmente "responsavel
    chegou" — a etiqueta diz isso, a portaria escreve essa frase, a sala conta
    esse estado no aviso. Com motivo "o responsavel nao chegou", as telas
    afirmariam o contrario do fato recem-registrado. E a professora poderia
    liberar de novo sem ninguem reconfirmar o portao.
  */
  /*
    a04, e nao a02: os ataques do red team usam a02 e a05 justamente para poder
    afirmar depois que NENHUM dos dois entrou na trilha. Reusar um deles aqui
    tornaria essa verificacao impossivel de distinguir de um furo de verdade.
  */
  portaria.ws.send(JSON.stringify({ tipo: 'chamar', alunoId: ID.a04 }))
  await esperar(400)
  maternal.ws.send(JSON.stringify({ tipo: 'liberar', alunoId: ID.a04 }))
  await esperar(400)
  conferir('a crianca esta liberada antes de voltar',
    ultimo(maternal)?.chamadas.find((c) => c.alunoId === ID.a04)?.estado === 'liberado')

  maternal.ws.send(JSON.stringify({ tipo: 'retornar', alunoId: ID.a04 }))
  await esperar(400)
  conferir('retorno SEM razao e recusado',
    ultimo(maternal)?.chamadas.find((c) => c.alunoId === ID.a04)?.estado === 'liberado',
    'a crianca mudou de estado sem razao declarada')
  conferir('e a recusa diz que faltou a razao',
    /raz/i.test(recusas(maternal).at(-1)?.motivo ?? ''),
    recusas(maternal).at(-1)?.motivo)

  maternal.ws.send(JSON.stringify({
    tipo: 'retornar', alunoId: ID.a04, razao: 'inventado por mim',
  }))
  await esperar(400)
  conferir('razao fora da lista e recusada',
    ultimo(maternal)?.chamadas.find((c) => c.alunoId === ID.a04)?.estado === 'liberado')

  maternal.ws.send(JSON.stringify({
    tipo: 'retornar', alunoId: ID.a04, razao: 'nao-saiu-com-o-responsavel',
  }))
  await esperar(400)
  conferir('com razao valida, a crianca vai para `retorno`',
    ultimo(maternal)?.chamadas.find((c) => c.alunoId === ID.a04)?.estado === 'retorno')
  conferir('e a portaria ve o mesmo estado',
    ultimo(portaria)?.chamadas.find((c) => c.alunoId === ID.a04)?.estado === 'retorno')
  conferir('a sala de OUTRA turma continua sem ver',
    !ultimo(jardim)?.chamadas.some((c) => c.alunoId === ID.a04))

  // A sala nao pode liberar de novo: alguem precisa reconfirmar o portao, e
  // quem enxerga o portao e a portaria.
  maternal.ws.send(JSON.stringify({ tipo: 'liberar', alunoId: ID.a04 }))
  await esperar(400)
  conferir('a sala NAO libera direto do retorno',
    ultimo(maternal)?.chamadas.find((c) => c.alunoId === ID.a04)?.estado === 'retorno')

  // Nem encerrar: encerrar afirma que nao ha ninguem no portao.
  maternal.ws.send(JSON.stringify({ tipo: 'encerrar', alunoId: ID.a04 }))
  await esperar(400)
  conferir('a sala NAO encerra o retorno',
    ultimo(maternal)?.chamadas.find((c) => c.alunoId === ID.a04)?.estado === 'retorno')
  conferir('e a recusa diz que a acao e da portaria',
    /portaria/.test(recusas(maternal).at(-1)?.motivo ?? ''),
    recusas(maternal).at(-1)?.motivo)

  // E a portaria nao pode devolver a crianca para a sala: quem sabe que ela
  // voltou e quem esta com ela.
  portaria.ws.send(JSON.stringify({
    tipo: 'retornar', alunoId: ID.a01, razao: 'esqueceu-material',
  }))
  await esperar(400)
  conferir('a portaria NAO devolve a crianca para a sala',
    /sala/.test(recusas(portaria).at(-1)?.motivo ?? ''),
    recusas(portaria).at(-1)?.motivo)

  // A portaria reconfirma o portao. `desde` reinicia: a espera e nova.
  const antesDeRechamar = ultimo(portaria)?.chamadas.find((c) => c.alunoId === ID.a04)?.desde
  portaria.ws.send(JSON.stringify({ tipo: 'chamar', alunoId: ID.a04 }))
  await esperar(400)
  const depoisDeRechamar = ultimo(portaria)?.chamadas.find((c) => c.alunoId === ID.a04)
  conferir('a portaria chama de novo e a crianca volta para `chamado`',
    depoisDeRechamar?.estado === 'chamado')
  conferir('e `desde` reinicia, para a fila nao mentir sobre a espera',
    depoisDeRechamar?.desde > antesDeRechamar,
    `${antesDeRechamar} -> ${depoisDeRechamar?.desde}`)

  // Fecha o ciclo pelo outro lado, para deixar a mesa limpa.
  maternal.ws.send(JSON.stringify({ tipo: 'liberar', alunoId: ID.a04 }))
  await esperar(300)
  maternal.ws.send(JSON.stringify({
    tipo: 'retornar', alunoId: ID.a04, razao: 'outro',
  }))
  await esperar(300)
  portaria.ws.send(JSON.stringify({ tipo: 'encerrar', alunoId: ID.a04 }))
  await esperar(400)
  conferir('encerrar tira a crianca do quadro',
    !ultimo(portaria)?.chamadas.some((c) => c.alunoId === ID.a04))

  const trilhaRetorno = await trilhaDesta()
  const retornos = trilhaRetorno.filter((e) => e.acao === 'retornar' && e.alunoId === ID.a04)
  conferir('a trilha guarda as duas voltas, com a razao de cada uma',
    retornos.length === 2 &&
      retornos[0].razao === 'nao-saiu-com-o-responsavel' &&
      retornos[1].razao === 'outro',
    JSON.stringify(retornos.map((e) => e.razao)))
  conferir('e nenhuma acao recusada entrou na trilha',
    !trilhaRetorno.some((e) => e.razao === 'inventado por mim'))
  conferir('as outras acoes tem razao vazia, nunca ausente',
    trilhaRetorno.filter((e) => e.acao !== 'retornar').every((e) => e.razao === ''))

  console.log('\n== ataques do red team ==')

  // C1 — a sala tenta chamar e liberar sozinha
  maternal.ws.send(JSON.stringify({ tipo: 'chamar', alunoId: ID.a02 }))
  await esperar(300)
  maternal.ws.send(JSON.stringify({ tipo: 'liberar', alunoId: ID.a02 }))
  await esperar(300)
  conferir('C1: a sala NAO consegue chamar uma crianca',
    ultimo(portaria)?.chamadas.length === 0,
    `a portaria viu ${ultimo(portaria)?.chamadas.length} chamada(s)`)
  conferir('C1: a sala recebe recusa explicita', recusas(maternal).length >= 2)

  // C1 — a portaria tenta liberar sozinha
  portaria.ws.send(JSON.stringify({ tipo: 'chamar', alunoId: ID.a03 }))
  await esperar(300)
  portaria.ws.send(JSON.stringify({ tipo: 'liberar', alunoId: ID.a03 }))
  await esperar(300)
  conferir('C1: a portaria NAO consegue liberar sozinha',
    ultimo(portaria)?.chamadas[0]?.estado === 'chamado')

  // M1 — a recusa diz de qual crianca
  const recusa = recusas(portaria).at(-1)
  conferir('M1: a recusa identifica a crianca', recusa?.alunoId === ID.a03,
    `veio "${recusa?.alunoId}"`)
  conferir('M1: a recusa nao vaza erro interno',
    Boolean(recusa) && !/Cannot read|undefined|null/.test(recusa.motivo),
    `motivo: ${recusa?.motivo}`)

  // C4 — chave de prototipo como acao
  for (const veneno of ['constructor', 'toString', '__proto__', 'valueOf']) {
    portaria.ws.send(JSON.stringify({ tipo: veneno, alunoId: ID.a05 }))
  }
  await esperar(400)
  const chamadasDepois = ultimo(portaria)?.chamadas ?? []
  conferir('C4: acao de prototipo nao cria chamada fantasma',
    !chamadasDepois.some((c) => c.alunoId === ID.a05))
  conferir('C4: toda chamada no retrato tem estado valido',
    chamadasDepois.every((c) =>
      ['chamado', 'liberado'].includes(c.estado)))

  // Furo 1 da segunda passagem: a sala liberava aluno de QUALQUER turma.
  // O filtro existia na leitura (retratoPara) e nao existia na escrita.
  console.log('\n== turma na escrita, nao so na leitura ==')
  portaria.ws.send(JSON.stringify({ tipo: 'chamar', alunoId: ID.a41 })) // 9º ano
  await esperar(400)
  maternal.ws.send(JSON.stringify({ tipo: 'liberar', alunoId: ID.a41 })) // sala do Pré 1
  await esperar(400)
  const alvo = (ultimo(portaria)?.chamadas ?? []).find((c) => c.alunoId === ID.a41)
  conferir('a sala do Pré 1 NAO libera aluno do 9º ano',
    alvo?.estado === 'chamado',
    `estado ficou "${alvo?.estado}"`)
  conferir('a sala recebe recusa dizendo que e de outra turma',
    /outra turma/.test(recusas(maternal).at(-1)?.motivo ?? ''),
    `motivo: ${recusas(maternal).at(-1)?.motivo}`)

  portaria.ws.send(JSON.stringify({ tipo: 'cancelar', alunoId: ID.a41 }))
  await esperar(300)

  // A trilha precisa dizer de ONDE partiu cada acao
  const trilhaOrigem = await fetch(`${HTTP}/registro?papel=portaria`).then((r) => r.json())
  conferir('a trilha guarda a origem de cada acao',
    trilhaOrigem.every((e) => typeof e.origem === 'string' && e.origem.length > 0))

  // C2 — papel fail-closed
  console.log('\n== papel fail-closed ==')
  for (const q of ['papel=Sala&turma=Pré 1', 'papel=SALA', 'papel=professora',
                   'papel=', 'turma=Pré 1']) {
    let recusou = false
    try { await ligar(q) } catch { recusou = true }
    conferir(`C2: "${q}" e RECUSADO`, recusou)
  }

  // C3 — rotas HTTP fechadas
  console.log('\n== rotas HTTP ==')
  const semPapel = await fetch(`${HTTP}/alunos`)
  conferir('C3: /alunos sem papel e recusado', semPapel.status === 400,
    `status ${semPapel.status}`)
  const comoSala = await fetch(`${HTTP}/alunos?papel=sala`)
  conferir('C3: /alunos como sala e recusado', comoSala.status === 403,
    `status ${comoSala.status}`)
  const comoPortaria = await fetch(`${HTTP}/alunos?papel=portaria`)
  conferir('C3: /alunos como portaria funciona', comoPortaria.status === 200)

  const regSemPapel = await fetch(`${HTTP}/registro`)
  conferir('C3: /registro sem papel e recusado', regSemPapel.status === 400)

  // malformada
  portaria.ws.send('{ isto nao e json')
  portaria.ws.send('[]')
  portaria.ws.send('null')
  portaria.ws.send(JSON.stringify({ tipo: 'chamar', alunoId: 42 }))
  await esperar(400)
  conferir('mensagem malformada nao derruba o servidor',
    portaria.ws.readyState === WebSocket.OPEN)

  // trilha
  const registro = await trilhaDesta()
  conferir('a trilha registra o papel de quem agiu',
    registro.every((e) => e.papel === 'portaria' || e.papel === 'sala'))
  conferir('a trilha NAO registrou nenhuma acao recusada',
    registro.every((e) => e.alunoId !== ID.a02 && e.alunoId !== ID.a05))

  for (const c of [portaria, maternal, jardim]) c.ws.close()

  console.log(falhas === 0 ? '\nTUDO VERDE\n' : `\n${falhas} FALHA(S)\n`)
  process.exit(falhas === 0 ? 0 : 1)
}

principal().catch((e) => {
  console.error('erro:', e.message)
  process.exit(1)
})
