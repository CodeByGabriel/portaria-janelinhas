/**
 * Mede o "antes" da refatoracao. Tarefa 0 do plano.
 *
 *   npm run dev          (numa instancia LIMPA — ver README)
 *   node ferramentas/baseline.mjs
 *
 * Saida: docs/baseline.md
 *
 * Mede o que o plano vai cobrar depois: latencia ate o cartao aparecer,
 * tamanho real dos alvos de toque, peso transferido, e como a lista da
 * portaria se comporta com 15 chamados. Numeros, nao impressoes.
 *
 * Dirige o Chrome pelo DevTools Protocol, como o prints.mjs. Sem dependencia.
 */
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORTA = 9333
const BASE = process.env.BASE ?? 'http://127.0.0.1:8787'
const WS = BASE.replace(/^http/, 'ws')
const PERFIL = join(RAIZ, '.baseline-perfil')

const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
const mediana = (a) => {
  const s = [...a].sort((x, y) => x - y)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.n = 0
    this.pendentes = new Map()
    this.ouvintes = []
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data)
      if (m.id !== undefined) {
        const p = this.pendentes.get(m.id)
        if (p) {
          this.pendentes.delete(m.id)
          m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result)
        }
      } else {
        for (const o of this.ouvintes) o(m)
      }
    })
  }
  ao(fn) {
    this.ouvintes.push(fn)
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
    return r.result?.value
  }
}

function ligarWs(query) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS}/ws?${query}`)
    ws.addEventListener('open', () => resolve(ws))
    ws.addEventListener('error', () => reject(new Error(`nao ligou: ${query}`)))
    setTimeout(() => reject(new Error(`timeout ligando: ${query}`)), 15000)
  })
}

/** Latencia do SERVIDOR: comando enviado -> retrato correspondente recebido. */
async function latenciaServidor(amostras = 10) {
  const portaria = await ligarWs('papel=portaria')
  const sala = await ligarWs('papel=sala&turma=3%C2%BA%20ano')
  await esperar(500)

  const tempos = []
  const alvos = ['a17', 'a18', 'a19', 'a20']

  for (let i = 0; i < amostras; i++) {
    const id = alvos[i % alvos.length]
    // limpa o estado do alvo antes de medir
    portaria.send(JSON.stringify({ tipo: 'cancelar', alunoId: id }))
    await esperar(200)

    const t = await new Promise((resolve) => {
      const inicio = performance.now()
      const ouvir = (e) => {
        const m = JSON.parse(e.data)
        if (m.tipo === 'retrato' && m.chamadas.some((c) => c.alunoId === id)) {
          sala.removeEventListener('message', ouvir)
          resolve(performance.now() - inicio)
        }
      }
      sala.addEventListener('message', ouvir)
      portaria.send(JSON.stringify({ tipo: 'chamar', alunoId: id }))
      setTimeout(() => {
        sala.removeEventListener('message', ouvir)
        resolve(NaN)
      }, 5000)
    })
    if (!Number.isNaN(t)) tempos.push(t)
    await esperar(150)
  }

  // limpa
  for (const id of alvos) portaria.send(JSON.stringify({ tipo: 'cancelar', alunoId: id }))
  await esperar(400)
  portaria.close()
  sala.close()
  await esperar(600)
  return tempos
}

async function principal() {
  const rel = {}

  console.log('1/5  latencia do servidor (chamar -> retrato na sala)')
  const lat = await latenciaServidor(10)
  rel.latenciaServidor = {
    amostras: lat.length,
    mediana: mediana(lat),
    pior: Math.max(...lat),
    melhor: Math.min(...lat),
  }
  console.log(
    `      mediana ${rel.latenciaServidor.mediana.toFixed(0)} ms | pior ${rel.latenciaServidor.pior.toFixed(0)} ms`,
  )

  // --- browser ---
  rmSync(PERFIL, { recursive: true, force: true })
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
  await cdp.chamar('Network.enable')

  // --- peso transferido no primeiro carregamento da portaria ---
  console.log('2/5  peso transferido (primeiro carregamento da portaria)')
  const recursos = new Map()
  cdp.ao((m) => {
    if (m.method === 'Network.loadingFinished') {
      const r = recursos.get(m.params.requestId)
      if (r) r.bytes = m.params.encodedDataLength
    }
    if (m.method === 'Network.responseReceived') {
      recursos.set(m.params.requestId, {
        url: m.params.response.url,
        tipo: m.params.type,
        bytes: 0,
      })
    }
  })
  await cdp.chamar('Network.setCacheDisabled', { cacheDisabled: true })
  await cdp.chamar('Emulation.setDeviceMetricsOverride', {
    width: 430,
    height: 880,
    deviceScaleFactor: 2,
    mobile: true,
  })
  await cdp.chamar('Page.navigate', { url: `${BASE}/portaria/` })
  await esperar(3500)

  const lista = [...recursos.values()].filter((r) => r.url.startsWith(BASE))
  rel.peso = {
    requisicoes: lista.length,
    bytes: lista.reduce((s, r) => s + r.bytes, 0),
    detalhe: lista.map((r) => ({ url: r.url.replace(BASE, ''), tipo: r.tipo, bytes: r.bytes })),
  }
  console.log(`      ${rel.peso.requisicoes} requisicoes, ${(rel.peso.bytes / 1024).toFixed(1)} KiB`)

  // --- alvos de toque na portaria ---
  console.log('3/5  alvos de toque (DOM real)')
  await cdp.avaliar(`
    (() => {
      const campo = document.getElementById('consulta')
      campo.value = 'a'
      campo.dispatchEvent(new Event('input'))
      document.getElementById('painelImportar').open = true
    })()
  `)
  await esperar(1200)
  rel.alvosPortaria = await cdp.avaliar(`
    (() => {
      const medir = (sel, rotulo) => {
        const e = document.querySelector(sel)
        if (!e) return { rotulo, ausente: true }
        const r = e.getBoundingClientRect()
        return { rotulo, largura: +r.width.toFixed(1), altura: +r.height.toFixed(1) }
      }
      return [
        medir('#consulta', 'campo de busca'),
        medir('#resultados button', 'Chamar'),
        medir('#ativas button', 'Cancelar/Entregar'),
        medir('#importar', 'Importar'),
        medir('#painelImportar summary', 'abrir importacao'),
      ]
    })()
  `)
  for (const a of rel.alvosPortaria) {
    if (!a.ausente) console.log(`      ${a.rotulo.padEnd(22)} ${a.largura} x ${a.altura}`)
  }

  // --- sala: alvos + latencia ate o cartao aparecer ---
  console.log('4/5  sala: alvos de toque e latencia ate o cartao renderizar')
  await cdp.chamar('Emulation.setDeviceMetricsOverride', {
    width: 1100,
    height: 700,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await cdp.chamar('Page.navigate', { url: `${BASE}/sala/?turma=3%C2%BA%20ano` })
  await esperar(2000)
  await cdp.avaliar(`document.getElementById('entrar').click()`)
  await esperar(2500)

  const portaria2 = await ligarWs('papel=portaria')
  await esperar(400)
  await cdp.avaliar(`window.__marca = null;
    (() => {
      const alvo = document.getElementById('grade')
      new MutationObserver(() => { if (!window.__marca) window.__marca = performance.now() })
        .observe(alvo, { childList: true, subtree: true })
      window.__t0 = performance.now()
    })()`)
  portaria2.send(JSON.stringify({ tipo: 'chamar', alunoId: 'a17' }))
  await esperar(2000)
  rel.latenciaRender = await cdp.avaliar(
    `window.__marca ? +(window.__marca - window.__t0).toFixed(0) : null`,
  )
  console.log(`      render do cartao: ${rel.latenciaRender} ms apos o comando sair da portaria`)

  rel.alvosSala = await cdp.avaliar(`
    (() => {
      const medir = (sel, rotulo) => {
        const e = document.querySelector(sel)
        if (!e) return { rotulo, ausente: true }
        const r = e.getBoundingClientRect()
        return { rotulo, largura: +r.width.toFixed(1), altura: +r.height.toFixed(1) }
      }
      return [ medir('.cartao button', 'Liberar saida'), medir('#mudo', 'mudo') ]
    })()
  `)
  for (const a of rel.alvosSala) {
    if (!a.ausente) console.log(`      ${a.rotulo.padEnd(22)} ${a.largura} x ${a.altura}`)
  }

  // --- 15 chamados: a lista escala? ---
  console.log('5/5  15 chamados simultaneos na portaria')
  const ids = Array.from({ length: 15 }, (_, i) => `a${String(i + 17).padStart(2, '0')}`)
  for (const id of ids) {
    portaria2.send(JSON.stringify({ tipo: 'chamar', alunoId: id }))
    await esperar(90)
  }
  await esperar(1200)

  await cdp.chamar('Emulation.setDeviceMetricsOverride', {
    width: 430,
    height: 880,
    deviceScaleFactor: 2,
    mobile: true,
  })
  await cdp.chamar('Page.navigate', { url: `${BASE}/portaria/` })
  await esperar(3000)
  rel.quinze = await cdp.avaliar(`
    (() => {
      const ul = document.getElementById('ativas')
      const linhas = ul.querySelectorAll('.linha')
      const alturaLista = ul.getBoundingClientRect().height
      return {
        linhas: linhas.length,
        alturaListaPx: +alturaLista.toFixed(0),
        alturaJanelaPx: window.innerHeight,
        rolagensNecessarias: +(alturaLista / window.innerHeight).toFixed(2),
        temContagem: !!document.querySelector('#ativas + .contagem, .contagem'),
        temTimer: /\\d+\\s*min|\\d+\\s*s\\b/.test(ul.textContent),
        agrupadoPorEstado: ul.querySelectorAll('h2, .secao, [role=group]').length > 0,
      }
    })()
  `)
  console.log(
    `      ${rel.quinze.linhas} linhas, lista de ${rel.quinze.alturaListaPx}px em janela de ${rel.quinze.alturaJanelaPx}px`,
  )

  // limpa o estado
  for (const id of ids) portaria2.send(JSON.stringify({ tipo: 'cancelar', alunoId: id }))
  await esperar(800)
  portaria2.close()
  await esperar(600)

  wsCdp.close()
  chrome.kill()
  await esperar(600)
  rmSync(PERFIL, { recursive: true, force: true })

  /*
    O "antes" e imutavel: e a referencia contra a qual as fases sao medidas.
    Remedicoes vao para outro arquivo — senao a primeira reexecucao apaga
    justamente o numero que se queria comparar. Foi o que aconteceu na 0.5,
    e so nao virou perda porque o arquivo estava versionado.

    SAIDA=baseline.json  sobrescreve, de proposito, quando for o caso.
  */
  const destino = process.env.SAIDA ?? 'medicao.json'
  mkdirSync(join(RAIZ, 'docs'), { recursive: true })
  writeFileSync(join(RAIZ, 'docs', destino), JSON.stringify(rel, null, 2))
  console.log(`\ndocs/${destino} escrito`)
  process.exit(0)
}

principal().catch((e) => {
  console.error('erro:', e.message)
  rmSync(PERFIL, { recursive: true, force: true })
  process.exit(1)
})
