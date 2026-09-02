/**
 * Verificacoes de interface contra o navegador de verdade.
 *
 *   npm run dev          (instancia limpa)
 *   node ferramentas/telas.mjs
 *
 * Existe porque ha invariantes que so o DOM prova. O `npm test` cobre regra,
 * o `fim-a-fim` cobre protocolo — nenhum dos dois enxerga se o botao sob o
 * dedo da porteira sobreviveu ao retrato que chegou pela rede.
 *
 * Dirige o Chrome pelo DevTools Protocol, sem dependencia.
 */
import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORTA = 9444
const BASE = process.env.BASE ?? 'http://127.0.0.1:8787'
const WS = BASE.replace(/^http/, 'ws')
const PERFIL = join(RAIZ, '.telas-perfil')

const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

let falhas = 0
function conferir(rotulo, condicao, detalhe = '') {
  if (condicao) console.log(`  ok    ${rotulo}`)
  else {
    falhas++
    console.log(`  FALHA ${rotulo} ${detalhe}`)
  }
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.n = 0
    this.pendentes = new Map()
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data)
      const p = this.pendentes.get(m.id)
      if (p) {
        this.pendentes.delete(m.id)
        m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result)
      }
    })
  }
  chamar(metodo, params = {}) {
    const id = ++this.n
    this.ws.send(JSON.stringify({ id, method: metodo, params }))
    return new Promise((resolve, reject) => {
      this.pendentes.set(id, { resolve, reject })
      setTimeout(() => reject(new Error(`timeout em ${metodo}`)), 30000)
    })
  }
  async avaliar(expressao) {
    const r = await this.chamar('Runtime.evaluate', {
      expression: expressao,
      returnByValue: true,
      awaitPromise: true,
    })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
    return r.result?.value
  }
}

function abrirWs(query) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS}/ws?${query}`)
    ws.addEventListener('open', () => resolve(ws))
    ws.addEventListener('error', () => reject(new Error(`nao ligou: ${query}`)))
    setTimeout(() => reject(new Error(`timeout: ${query}`)), 15000)
  })
}

/*
  Com retentativa, de proposito.

  O proxy do `wrangler dev` ainda reage a desconexao abrupta de WebSocket com
  "Network connection lost" e, as vezes, encerra o processo — mesmo no
  4.128.0, que ja corrigiu a maior parte dos casos. O Chrome headless abrindo
  e fechando conexoes torna isso mais provavel. Uma falha de ligacao aqui
  quase nunca e defeito do app; e o ambiente.
*/
async function ligarWs(query, tentativas = 4) {
  for (let i = 1; i <= tentativas; i++) {
    try {
      return await abrirWs(query)
    } catch (erro) {
      if (i === tentativas) throw erro
      await esperar(800 * i)
    }
  }
  throw new Error('inalcancavel')
}

/** O servidor esta de pe? Sem isto o teste culpa o app por porta fechada. */
async function esperarServidor(segundos = 30) {
  for (let i = 0; i < segundos; i++) {
    try {
      const r = await fetch(`${BASE}/saude`)
      if (r.ok) return
    } catch {
      /* ainda subindo */
    }
    await esperar(1000)
  }
  throw new Error(`o servidor nao respondeu em ${BASE}/saude — suba com "npm run dev"`)
}

/** No Windows o Chrome segura arquivos do perfil por um instante apos morrer. */
function limparPerfil() {
  for (let i = 0; i < 5; i++) {
    try {
      rmSync(PERFIL, { recursive: true, force: true })
      return
    } catch {
      /* tenta de novo */
    }
  }
}

async function principal() {
  await esperarServidor()
  limparPerfil()
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORTA}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--hide-scrollbars',
      `--user-data-dir=${PERFIL}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  let alvo = null
  for (let i = 0; i < 40 && !alvo; i++) {
    await esperar(500)
    try {
      const lista = await fetch(`http://127.0.0.1:${PORTA}/json/list`).then((r) => r.json())
      alvo = lista.find((t) => t.type === 'page')
    } catch {
      /* subindo */
    }
  }
  if (!alvo) throw new Error('o Chrome nao abriu a porta de depuracao')

  const wsCdp = new WebSocket(alvo.webSocketDebuggerUrl)
  await new Promise((r, j) => {
    wsCdp.addEventListener('open', r)
    wsCdp.addEventListener('error', () => j(new Error('nao conectei ao Chrome')))
  })
  const cdp = new Cdp(wsCdp)
  await cdp.chamar('Page.enable')
  await cdp.chamar('Runtime.enable')
  await cdp.chamar('Emulation.setDeviceMetricsOverride', {
    width: 430,
    height: 880,
    deviceScaleFactor: 1,
    mobile: true,
  })
  await cdp.chamar('Page.navigate', { url: `${BASE}/portaria/` })
  await esperar(2500)

  const outra = await ligarWs('papel=portaria')
  await esperar(400)

  console.log('\n== S2, o lado que faltava: o DOM sobrevive ao retrato ==')

  // Marca os nos atuais para poder reconhece-los depois.
  await cdp.avaliar(`
    (() => {
      const campo = document.getElementById('consulta')
      campo.value = 'a'
      campo.dispatchEvent(new Event('input'))
    })()
  `)
  await esperar(600)
  await cdp.avaliar(`
    (() => {
      window.__marcados = []
      document.querySelectorAll('#resultados .linha').forEach((li, i) => {
        li.dataset.marca = 'r' + i
        window.__marcados.push('r' + i)
      })
      return window.__marcados.length
    })()
  `)
  const quantosResultados = await cdp.avaliar(`document.querySelectorAll('#resultados .linha').length`)
  conferir('a busca desenhou resultados para trabalhar', quantosResultados > 0,
    `viu ${quantosResultados}`)

  // Outra pessoa, em outra sala, mexe no estado. Um retrato chega pela rede.
  const alunos = await fetch(`${BASE}/alunos?papel=portaria`).then((r) => r.json())
  const forasteiro = alunos[alunos.length - 1]
  outra.send(JSON.stringify({ tipo: 'chamar', alunoId: forasteiro.id }))
  await esperar(900)

  const sobreviveram = await cdp.avaliar(`
    (() => {
      const marcas = [...document.querySelectorAll('#resultados .linha')]
        .map((li) => li.dataset.marca)
        .filter(Boolean)
      return marcas.length
    })()
  `)
  conferir(
    'os nos dos resultados sobrevivem a um retrato vindo da rede',
    sobreviveram === quantosResultados,
    `${sobreviveram} de ${quantosResultados} sobreviveram`,
  )

  // A lista "em saida" tambem
  await cdp.avaliar(`
    (() => {
      document.querySelectorAll('#ativas .linha').forEach((li, i) => { li.dataset.marca = 'a' + i })
    })()
  `)
  const ativasAntes = await cdp.avaliar(`document.querySelectorAll('#ativas .linha').length`)
  const segundo = alunos[alunos.length - 2]
  outra.send(JSON.stringify({ tipo: 'chamar', alunoId: segundo.id }))
  await esperar(900)
  const ativasMarcadas = await cdp.avaliar(
    `[...document.querySelectorAll('#ativas .linha')].filter((li) => li.dataset.marca).length`,
  )
  conferir(
    'os nos de "em saida" sobrevivem quando outra crianca e chamada',
    ativasMarcadas === ativasAntes,
    `${ativasMarcadas} de ${ativasAntes} sobreviveram`,
  )

  console.log('\n== busca vazia deixa de ser indistinguivel de carregando ==')
  await cdp.avaliar(`
    (() => {
      const campo = document.getElementById('consulta')
      campo.value = 'zzzznaoexiste'
      campo.dispatchEvent(new Event('input'))
    })()
  `)
  await esperar(500)
  const avisoVazio = await cdp.avaliar(`
    (() => {
      const p = document.getElementById('semResultado')
      return { existe: !!p, visivel: p ? !p.hidden : false, texto: p ? p.textContent.trim() : '' }
    })()
  `)
  conferir('existe aviso de "nenhum aluno com esse nome"', avisoVazio.existe)
  conferir('e ele aparece quando a busca nao acha ninguem', avisoVazio.visivel,
    JSON.stringify(avisoVazio))

  await cdp.avaliar(`
    (() => {
      const campo = document.getElementById('consulta')
      campo.value = 'a'
      campo.dispatchEvent(new Event('input'))
    })()
  `)
  await esperar(500)
  const sumiu = await cdp.avaliar(`document.getElementById('semResultado').hidden`)
  conferir('e some quando a busca volta a achar', sumiu === true)

  console.log('\n== o som nao falha calado ==')

  /*
    Suspende o contexto DE VERDADE, que e o defeito C exato.

    A primeira tentativa foi entrar na sala sem ativacao do usuario, na
    esperanca de que o contexto nascesse suspenso. Nao nasce: medido, o Chrome
    headless devolve `running` mesmo com --autoplay-policy=user-gesture-required
    e `navigator.userActivation.hasBeenActive === false`. Sem alto-falante nao
    ha o que a politica proteja. A verificacao passava por nao reproduzir nada.

    Entao o harness instrumenta o AMBIENTE, e nao a aplicacao: um script
    injetado antes do carregamento guarda os contextos criados, e daqui a gente
    chama suspend() neles. E o mesmo que o sistema faz quando a aba vai para
    segundo plano, entra uma ligacao ou a tela bloqueia. A pagina sob teste
    continua sendo a pagina de producao, sem gancho nenhum.
  */
  const instrumentacao = await cdp.chamar('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      (() => {
        const Original = window.AudioContext
        if (!Original) return
        window.__contextos = []
        window.AudioContext = class extends Original {
          constructor(...args) {
            super(...args)
            window.__contextos.push(this)
          }
        }
      })()
    `,
  })

  const turmaDoAluno = forasteiro.turma
  await cdp.chamar('Page.navigate', {
    url: `${BASE}/sala/?turma=${encodeURIComponent(turmaDoAluno)}`,
  })
  await esperar(2000)

  await cdp.chamar('Runtime.evaluate', {
    expression: `document.getElementById('entrar').click()`,
    userGesture: true,
  })
  await esperar(1000)

  const entrou = await cdp.avaliar(`document.getElementById('app').hidden === false`)
  conferir('a sala entrou', entrou === true)

  const antes = await cdp.avaliar(`
    (() => {
      const el = document.getElementById('avisoSom')
      return { existe: !!el, visivel: el ? el.hidden === false : null,
               contextos: (window.__contextos || []).length,
               estado: (window.__contextos || [])[0]?.state ?? null }
    })()
  `)
  conferir('existe aviso de som interrompido', antes.existe)
  conferir('o harness alcancou o contexto de audio da pagina',
    antes.contextos >= 1, JSON.stringify(antes))
  conferir('com o som funcionando, o aviso fica escondido',
    antes.visivel === false, JSON.stringify(antes))

  // O aparelho suspende o audio. Nada muda na aplicacao; muda o ambiente.
  const suspendeu = await cdp.avaliar(`
    (async () => {
      await window.__contextos[0].suspend()
      return window.__contextos[0].state
    })()
  `)
  await esperar(400)
  conferir('o contexto ficou suspenso', suspendeu === 'suspended', String(suspendeu))

  const durante = await cdp.avaliar(`
    (() => {
      const el = document.getElementById('avisoSom')
      return { visivel: el.hidden === false, texto: (el.textContent || '').trim(),
               clicavel: el.tagName === 'BUTTON' }
    })()
  `)
  conferir('o som suspenso VIRA aviso na tela, nao silencio',
    durante.visivel === true, JSON.stringify(durante))
  conferir('o aviso diz o que fazer, e da para agir nele',
    durante.texto.length > 0 && durante.clicavel === true, JSON.stringify(durante))

  /*
    E uma chamada chegando com o som parado nao pode explodir nem apagar o
    aviso: a crianca ainda precisa aparecer na tela, que e o canal que sobrou.
  */
  outra.send(JSON.stringify({ tipo: 'chamar', alunoId: forasteiro.id }))
  await esperar(1500)
  const comChamada = await cdp.avaliar(`
    (() => ({
      cartoes: document.querySelectorAll('.cartao').length,
      aviso: document.getElementById('avisoSom').hidden === false,
    }))()
  `)
  conferir('a crianca aparece mesmo com o som parado',
    comChamada.cartoes >= 1, JSON.stringify(comChamada))
  conferir('e o aviso continua de pe', comChamada.aviso === true,
    JSON.stringify(comChamada))

  // A professora toca no aviso. O som volta e o aviso some sozinho.
  await cdp.chamar('Runtime.evaluate', {
    expression: `document.getElementById('avisoSom').click()`,
    userGesture: true,
  })
  await esperar(700)
  const depois = await cdp.avaliar(`
    (() => ({
      estado: window.__contextos[0].state,
      aviso: document.getElementById('avisoSom').hidden === false,
    }))()
  `)
  conferir('tocar no aviso reativa o som', depois.estado === 'running',
    JSON.stringify(depois))
  conferir('e o aviso some sozinho quando o som volta', depois.aviso === false,
    JSON.stringify(depois))

  /*
    O mudo tem que atravessar o F5. Sem isto a professora silenciava a sala e o
    proximo recarregamento devolvia o som, no meio do turno, com a turma toda
    em aula.
  */
  await cdp.chamar('Runtime.evaluate', {
    expression: `document.getElementById('mudo').click()`,
    userGesture: true,
  })
  await esperar(300)
  const mudouRotulo = await cdp.avaliar(`
    (() => {
      const b = document.getElementById('mudo')
      return { texto: b.textContent.trim(), pressed: b.getAttribute('aria-pressed') }
    })()
  `)
  conferir('o botao de mudo anuncia o estado para leitor de tela',
    mudouRotulo.pressed === 'true', JSON.stringify(mudouRotulo))

  await cdp.chamar('Page.navigate', {
    url: `${BASE}/sala/?turma=${encodeURIComponent(turmaDoAluno)}`,
  })
  await esperar(2000)
  const depoisDoF5 = await cdp.avaliar(`
    (() => {
      const b = document.getElementById('mudo')
      return { texto: b.textContent.trim(), pressed: b.getAttribute('aria-pressed') }
    })()
  `)
  conferir('o mudo sobrevive ao recarregamento',
    depoisDoF5.pressed === 'true' && depoisDoF5.texto === 'Som desligado',
    JSON.stringify(depoisDoF5))

  // devolve o perfil ao estado limpo para a proxima rodada
  await cdp.avaliar(`localStorage.removeItem('janelinhas:mudo')`)
  await cdp.chamar('Page.removeScriptToEvaluateOnNewDocument', {
    identifier: instrumentacao.identifier,
  })

  // limpa o estado
  for (const a of [forasteiro, segundo]) {
    outra.send(JSON.stringify({ tipo: 'cancelar', alunoId: a.id }))
    await esperar(200)
  }
  await esperar(500)
  outra.close()
  await esperar(600)

  wsCdp.close()
  chrome.kill()
  await esperar(900)
  limparPerfil()

  console.log(falhas === 0 ? '\nTUDO VERDE\n' : `\n${falhas} FALHA(S)\n`)
  process.exit(falhas === 0 ? 0 : 1)
}

principal().catch((e) => {
  console.error('erro:', e.message)
  limparPerfil()
  process.exit(1)
})
