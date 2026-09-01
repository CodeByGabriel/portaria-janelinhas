/**
 * Verificacao fim-a-fim contra o servidor rodando.
 * Nao entra no `npm test` porque exige `npm run dev` de pe.
 *
 *   node ferramentas/fim-a-fim.mjs
 */
const BASE = process.env.BASE ?? 'ws://127.0.0.1:8787'

let falhas = 0
function conferir(rotulo, condicao, detalhe = '') {
  if (condicao) {
    console.log(`  ok   ${rotulo}`)
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
    ws.addEventListener('error', reject)
    setTimeout(() => reject(new Error(`timeout ligando ${query}`)), 5000)
  })
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

async function principal() {
  console.log('fim-a-fim: portaria chama, sala recebe\n')

  const portaria = await ligar('papel=portaria')
  const maternal = await ligar('papel=sala&turma=Maternal')
  const jardim = await ligar('papel=sala&turma=Jardim%20I')
  await esperar(300)

  conferir('as tres conexoes recebem retrato inicial',
    portaria.recebidos.length === 1 && maternal.recebidos.length === 1 && jardim.recebidos.length === 1,
    `(${portaria.recebidos.length}/${maternal.recebidos.length}/${jardim.recebidos.length})`)
  conferir('o retrato inicial vem vazio', portaria.recebidos[0]?.chamadas.length === 0)

  portaria.ws.send(JSON.stringify({ tipo: 'chamar', alunoId: 'a01' }))
  await esperar(400)

  const ultimo = (c) => c.recebidos.at(-1)
  conferir('a portaria ve a chamada', ultimo(portaria)?.chamadas.length === 1)
  conferir('o Maternal ve a propria crianca', ultimo(maternal)?.chamadas.length === 1)
  conferir('o Jardim I NAO ve crianca de outra turma', ultimo(jardim)?.chamadas.length === 0,
    `viu ${ultimo(jardim)?.chamadas.length}`)
  conferir('o estado e chamado', ultimo(maternal)?.chamadas[0]?.estado === 'chamado')

  maternal.ws.send(JSON.stringify({ tipo: 'liberar', alunoId: 'a01' }))
  await esperar(400)
  conferir('liberar propaga para a portaria', ultimo(portaria)?.chamadas[0]?.estado === 'liberado')

  portaria.ws.send(JSON.stringify({ tipo: 'entregar', alunoId: 'a01' }))
  await esperar(400)
  conferir('entregar fecha o ciclo', ultimo(portaria)?.chamadas[0]?.estado === 'entregue')

  portaria.ws.send(JSON.stringify({ tipo: 'liberar', alunoId: 'a05' }))
  await esperar(400)
  const recusa = portaria.recebidos.filter((m) => m.tipo === 'recusa').at(-1)
  conferir('liberar sem chamar e RECUSADO pelo servidor', Boolean(recusa),
    'nenhuma recusa recebida')

  portaria.ws.send('{ isto nao e json')
  await esperar(300)
  conferir('mensagem malformada nao derruba o servidor',
    portaria.ws.readyState === WebSocket.OPEN)

  const registro = await fetch(BASE.replace('ws', 'http') + '/registro').then((r) => r.json())
  conferir('a trilha registrou as tres transicoes validas', registro.length === 3,
    `tem ${registro.length}`)
  conferir('a trilha NAO registrou a transicao recusada',
    registro.every((e) => e.alunoId !== 'a05'))

  for (const c of [portaria, maternal, jardim]) c.ws.close()

  console.log(falhas === 0 ? '\nTUDO VERDE' : `\n${falhas} FALHA(S)`)
  process.exit(falhas === 0 ? 0 : 1)
}

principal().catch((e) => {
  console.error('erro:', e.message)
  process.exit(1)
})
