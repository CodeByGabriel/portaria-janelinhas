/**
 * Captura prints reais das telas, dirigindo o Chrome pelo DevTools Protocol.
 *
 *   node ferramentas/prints.mjs
 *   -> prints/*.png
 *
 * Existe porque a tela da sala so mostra os cartoes DEPOIS do clique em
 * "entrar na sala" (o navegador nao destrava audio sem gesto do usuario).
 * Um screenshot sem interacao mostraria so a tela de entrada — o print
 * seria honesto e inutil.
 *
 * Sem dependencia: Node 22 ja tem WebSocket, que e tudo que o CDP precisa.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const SAIDA = process.env.SAIDA ? join(RAIZ, process.env.SAIDA) : join(RAIZ, 'prints')
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORTA = 9222
const BASE = process.env.BASE ?? 'http://127.0.0.1:8787'

/*
  Simulacao de daltonismo pelo proprio Chrome.

  `VISAO=deuteranopia node ferramentas/prints.mjs` captura as mesmas telas com
  o filtro que o DevTools usa no painel de renderizacao. Nao e aproximacao
  nossa: e o mesmo caminho de cor do navegador, aplicado depois da composicao,
  entao pega tambem sombra, borda e antialiasing — coisas que uma matriz
  rodando so sobre os tokens nao alcanca.

  Vale para conferir o quarto canal: se dois estados so se distinguem pela
  matiz, e aqui que eles se encostam.
*/
const VISAO = process.env.VISAO ?? 'none'
const VISOES = ['none', 'achromatopsia', 'deuteranopia', 'protanopia', 'tritanopia']
if (!VISOES.includes(VISAO)) {
  console.error(`VISAO invalida: ${VISAO}. Use uma de ${VISOES.join(', ')}.`)
  process.exit(1)
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

const TELAS = [
  {
    arquivo: 'portaria.png',
    url: `${BASE}/portaria/`,
    largura: 430,
    altura: 880,
    espera: 1500,
    roteiro: null,
    pronto: `document.querySelectorAll('#ativas .linha').length >= 3`,
  },
  {
    arquivo: 'portaria-busca.png',
    url: `${BASE}/portaria/`,
    largura: 430,
    altura: 880,
    espera: 1800,
    roteiro: `
      const campo = document.getElementById('consulta')
      campo.value = 'sant'
      campo.dispatchEvent(new Event('input'))
    `,
    pronto: `document.querySelectorAll('#resultados .linha').length >= 2`,
  },
  {
    arquivo: 'portaria-importar.png',
    url: `${BASE}/portaria/`,
    largura: 430,
    altura: 980,
    espera: 1800,
    roteiro: `
      document.getElementById('painelImportar').open = true
      document.getElementById('planilha').value =
        'Nome,Turma\\nAna Souza,Pré 1\\nBia Lima,7º ano\\nana  souza,Pré 1\\nCaio,Turma Fantasma'
    `,
  },
  {
    arquivo: 'sala-entrada.png',
    url: `${BASE}/sala/`,
    largura: 900,
    altura: 560,
    espera: 1200,
    roteiro: null,
  },
  {
    arquivo: 'sala.png',
    url: `${BASE}/sala/?turma=3%C2%BA%20ano`,
    largura: 1100,
    altura: 700,
    espera: 1500,
    roteiro: `document.getElementById('entrar').click()`,
    pronto: `document.querySelectorAll('.cartao').length >= 3
             && document.getElementById('rede').textContent.includes('conectado')`,
  },
  {
    arquivo: 'demo.png',
    url: `${BASE}/demo/`,
    largura: 1200,
    altura: 760,
    espera: 1500,
    roteiro: `
      document.querySelectorAll('#cadastro button')[0]?.click()
      document.querySelectorAll('#cadastro button')[1]?.click()
    `,
    pronto: `document.querySelectorAll('.cartao').length >= 2`,
  },
  {
    arquivo: 'oficina.png',
    url: `${BASE}/comum/oficina`,
    largura: 1100,
    altura: 900,
    espera: 1400,
    roteiro: `document.querySelector('.controles [data-estado="chamado"]')?.click()`,
    pronto: `document.querySelectorAll('.cartao[data-estado="chamado"]').length >= 3`,
  },
]

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
}

/*
  Semeia o estado com UMA conexao, mantida aberta durante toda a captura.

  Fechar WebSocket e sair na sequencia derruba o `wrangler dev`: o proxy dele
  reage a desconexao abrupta com "Uncaught Error: Network connection lost" e
  encerra o processo. Por isso: uma conexao so, fechamento explicito no fim,
  e uma pausa antes de sair.
*/
function ligarWs(query) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws?${query}`)
    ws.addEventListener('open', () => resolve(ws))
    ws.addEventListener('error', () => reject(new Error(`nao ligou: ${query}`)))
    setTimeout(() => reject(new Error(`timeout: ${query}`)), 15000)
  })
}

async function semear() {
  const portaria = await ligarWs('papel=portaria')
  const sala = await ligarWs('papel=sala&turma=3%C2%BA%20ano')
  await esperar(400)

  for (const id of ['a17', 'a18', 'a19']) {
    portaria.send(JSON.stringify({ tipo: 'chamar', alunoId: id }))
    await esperar(200)
  }
  await esperar(400)
  for (const id of ['a17', 'a18']) {
    sala.send(JSON.stringify({ tipo: 'liberar', alunoId: id }))
    await esperar(250)
  }
  await esperar(300)

  /*
    Um caso de retorno no retrato.

    O print existe para mostrar o produto, e desde a 1.1 o produto tem um quarto
    caso na tela: a crianca que foi liberada e voltou para a sala. Sem isto, o
    print continuaria mostrando um app que nao e mais este.
  */
  sala.send(JSON.stringify({
    tipo: 'retornar', alunoId: 'a17', razao: 'nao-saiu-com-o-responsavel',
  }))
  await esperar(600)

  console.log('  estado: 3 no 3º ano — 1 chamado, 1 liberado, 1 de volta na sala')
  return async () => {
    portaria.close()
    sala.close()
    await esperar(800)
  }
}

async function principal() {
  rmSync(SAIDA, { recursive: true, force: true })
  mkdirSync(SAIDA, { recursive: true })

  const desligar = await semear()

  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORTA}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=2',
      '--user-data-dir=' + join(SAIDA, '.perfil'),
      'about:blank',
    ],
    { stdio: 'ignore', detached: false },
  )

  let alvo = null
  for (let i = 0; i < 40 && !alvo; i++) {
    await esperar(500)
    try {
      const lista = await fetch(`http://127.0.0.1:${PORTA}/json/list`).then((r) => r.json())
      alvo = lista.find((t) => t.type === 'page')
    } catch {
      // chrome ainda subindo
    }
  }
  if (!alvo) throw new Error('o Chrome nao abriu a porta de depuracao')

  const ws = new WebSocket(alvo.webSocketDebuggerUrl)
  await new Promise((r, j) => {
    ws.addEventListener('open', r)
    ws.addEventListener('error', () => j(new Error('nao conectei ao Chrome')))
  })
  const cdp = new Cdp(ws)
  await cdp.chamar('Page.enable')
  await cdp.chamar('Runtime.enable')
  if (VISAO !== 'none') {
    await cdp.chamar('Emulation.setEmulatedVisionDeficiency', { type: VISAO })
    console.log(`  visao emulada: ${VISAO}`)
  }

  for (const tela of TELAS) {
    await cdp.chamar('Emulation.setDeviceMetricsOverride', {
      width: tela.largura,
      height: tela.altura,
      deviceScaleFactor: 2,
      mobile: tela.largura < 500,
    })
    await cdp.chamar('Page.navigate', { url: tela.url })
    await esperar(tela.espera)

    if (tela.roteiro) {
      /*
        `userGesture: true` porque o roteiro clica em "entrar na sala".

        Sem ativacao do usuario o navegador deixa o AudioContext suspenso, a
        tela mostra corretamente o aviso "o som foi interrompido", e o print sai
        anunciando um defeito que a professora — que toca com o dedo — nao
        teria. O print tem que mostrar o produto, nao o arranjo do teste.
      */
      await cdp.chamar('Runtime.evaluate', {
        expression: tela.roteiro,
        awaitPromise: true,
        userGesture: true,
      })
      await esperar(600)
    }

    /*
      Espera por CONDICAO, nao por tempo fixo.

      A tela da sala precisa do WebSocket conectado e do primeiro retrato
      chegando. Um sleep generoso ainda pegava a tela em "ligando…" quando o
      Durable Object estava frio — e um print de tela vazia parece produto
      quebrado.
    */
    if (tela.pronto) {
      let ok = false
      for (let i = 0; i < 40 && !ok; i++) {
        const r = await cdp.chamar('Runtime.evaluate', {
          expression: tela.pronto,
          returnByValue: true,
        })
        ok = r.result?.value === true
        if (!ok) await esperar(300)
      }
      if (!ok) console.log(`  AVISO: ${tela.arquivo} capturado sem a condicao satisfeita`)
      await esperar(500)
    }

    /*
      Sem captureBeyondViewport: com metricas emuladas ele falha com "Cannot
      take screenshot with 0 width". O recorte vem das metricas reais da
      pagina, limitado a altura pedida — assim o print pega a tela inteira
      sem depender daquela flag.
    */
    const metricas = await cdp.chamar('Page.getLayoutMetrics')
    const conteudo = metricas.cssContentSize ?? metricas.contentSize
    const largura = Math.max(tela.largura, Math.round(conteudo?.width || tela.largura))
    const altura = Math.max(tela.altura, Math.round(conteudo?.height || tela.altura))

    const { data } = await cdp.chamar('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 0, y: 0, width: largura, height: altura, scale: 1 },
    })
    writeFileSync(join(SAIDA, tela.arquivo), Buffer.from(data, 'base64'))
    console.log(`  ${tela.arquivo}  ${tela.largura}x${tela.altura}`)
  }

  ws.close()
  chrome.kill()
  await esperar(600)
  /*
    O Chrome solta os arquivos do perfil um pouco depois do kill, e no Windows
    o CrashpadMetrics fica travado por alguns instantes. Sem esta tolerancia a
    ferramenta terminava com erro DEPOIS de ja ter gravado os sete prints —
    o que faz um portao verde parecer vermelho.
  */
  for (let i = 0; i < 5; i++) {
    try {
      rmSync(join(SAIDA, '.perfil'), { recursive: true, force: true })
      break
    } catch {
      await esperar(400)
    }
  }
  await desligar()
  const pasta = relative(RAIZ, SAIDA).replace(/\\/g, '/')
  console.log(`\n${TELAS.length} prints em ${pasta}/`)
  process.exit(0)
}

principal().catch((e) => {
  console.error('erro:', e.message)
  process.exit(1)
})
