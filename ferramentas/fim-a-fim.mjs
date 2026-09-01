/**
 * Verificacao fim-a-fim contra o servidor rodando.
 * Nao entra no `npm test` porque exige `npm run dev` de pe.
 *
 *   node ferramentas/fim-a-fim.mjs
 *
 * A segunda metade sao os ataques que o red team reproduziu ao vivo. Eles
 * ficam aqui para sempre: um furo consertado sem teste volta.
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
    setTimeout(() => reject(new Error(`timeout ligando ${query}`)), 5000)
  })
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
const ultimo = (c) => c.recebidos.filter((m) => m.tipo === 'retrato').at(-1)
const recusas = (c) => c.recebidos.filter((m) => m.tipo === 'recusa')

async function principal() {
  console.log('\n== ciclo normal ==')

  const portaria = await ligar('papel=portaria')
  const maternal = await ligar('papel=sala&turma=Maternal')
  const jardim = await ligar('papel=sala&turma=Jardim%20I')
  await esperar(300)

  conferir('as tres conexoes recebem retrato inicial',
    [portaria, maternal, jardim].every((c) => ultimo(c)))

  portaria.ws.send(JSON.stringify({ tipo: 'chamar', alunoId: 'a01' }))
  await esperar(400)

  conferir('a portaria ve a chamada', ultimo(portaria)?.chamadas.length === 1)
  conferir('o Maternal ve a propria crianca', ultimo(maternal)?.chamadas.length === 1)
  conferir('o Jardim I NAO ve crianca de outra turma',
    ultimo(jardim)?.chamadas.length === 0)
  conferir('o estado e chamado', ultimo(maternal)?.chamadas[0]?.estado === 'chamado')
  conferir('a chamada carrega desde e em',
    typeof ultimo(maternal)?.chamadas[0]?.desde === 'number' &&
    typeof ultimo(maternal)?.chamadas[0]?.em === 'number')

  maternal.ws.send(JSON.stringify({ tipo: 'liberar', alunoId: 'a01' }))
  await esperar(400)
  conferir('liberar propaga para a portaria',
    ultimo(portaria)?.chamadas[0]?.estado === 'liberado')

  portaria.ws.send(JSON.stringify({ tipo: 'entregar', alunoId: 'a01' }))
  await esperar(400)
  conferir('S1: entregar TIRA a crianca do retrato, nao acumula',
    ultimo(portaria)?.chamadas.length === 0,
    `sobraram ${ultimo(portaria)?.chamadas.length}`)

  console.log('\n== ataques do red team ==')

  // C1 — a sala tenta chamar e liberar sozinha
  maternal.ws.send(JSON.stringify({ tipo: 'chamar', alunoId: 'a02' }))
  await esperar(300)
  maternal.ws.send(JSON.stringify({ tipo: 'liberar', alunoId: 'a02' }))
  await esperar(300)
  conferir('C1: a sala NAO consegue chamar uma crianca',
    ultimo(portaria)?.chamadas.length === 0,
    `a portaria viu ${ultimo(portaria)?.chamadas.length} chamada(s)`)
  conferir('C1: a sala recebe recusa explicita', recusas(maternal).length >= 2)

  // C1 — a portaria tenta liberar sozinha
  portaria.ws.send(JSON.stringify({ tipo: 'chamar', alunoId: 'a03' }))
  await esperar(300)
  portaria.ws.send(JSON.stringify({ tipo: 'liberar', alunoId: 'a03' }))
  await esperar(300)
  conferir('C1: a portaria NAO consegue liberar sozinha',
    ultimo(portaria)?.chamadas[0]?.estado === 'chamado')

  // M1 — a recusa diz de qual crianca
  const recusa = recusas(portaria).at(-1)
  conferir('M1: a recusa identifica a crianca', recusa?.alunoId === 'a03',
    `veio "${recusa?.alunoId}"`)
  conferir('M1: a recusa nao vaza erro interno',
    Boolean(recusa) && !/Cannot read|undefined|null/.test(recusa.motivo),
    `motivo: ${recusa?.motivo}`)

  // C4 — chave de prototipo como acao
  for (const veneno of ['constructor', 'toString', '__proto__', 'valueOf']) {
    portaria.ws.send(JSON.stringify({ tipo: veneno, alunoId: 'a05' }))
  }
  await esperar(400)
  const chamadasDepois = ultimo(portaria)?.chamadas ?? []
  conferir('C4: acao de prototipo nao cria chamada fantasma',
    !chamadasDepois.some((c) => c.alunoId === 'a05'))
  conferir('C4: toda chamada no retrato tem estado valido',
    chamadasDepois.every((c) =>
      ['chamado', 'liberado'].includes(c.estado)))

  // C2 — papel fail-closed
  console.log('\n== papel fail-closed ==')
  for (const q of ['papel=Sala&turma=Maternal', 'papel=SALA', 'papel=professora',
                   'papel=', 'turma=Maternal']) {
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
  const registro = await fetch(`${HTTP}/registro?papel=portaria`).then((r) => r.json())
  conferir('a trilha registra o papel de quem agiu',
    registro.every((e) => e.papel === 'portaria' || e.papel === 'sala'))
  conferir('a trilha NAO registrou nenhuma acao recusada',
    registro.every((e) => e.alunoId !== 'a02' && e.alunoId !== 'a05'))

  for (const c of [portaria, maternal, jardim]) c.ws.close()

  console.log(falhas === 0 ? '\nTUDO VERDE\n' : `\n${falhas} FALHA(S)\n`)
  process.exit(falhas === 0 ? 0 : 1)
}

principal().catch((e) => {
  console.error('erro:', e.message)
  process.exit(1)
})
