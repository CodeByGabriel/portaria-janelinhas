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
