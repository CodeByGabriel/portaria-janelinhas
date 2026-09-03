/**
 * Varre as telas em varias larguras e mede o que a revisao visual nao pega.
 *
 *   npm run responsivo
 *
 * Existe porque "conferi no celular" e uma frase, nao uma medida. Um app de
 * escola roda em tudo: o celular da porteira, o tablet velho da sala, o
 * notebook da secretaria e, na apresentacao, um projetor. As quebras aparecem
 * em larguras que ninguem lembra de abrir.
 *
 * O que ele cobra, e por que cada coisa e um defeito de verdade:
 *
 *   ROLAGEM HORIZONTAL   conteudo que vaza para fora da tela. Num celular, isso
 *                        e um botao que a pessoa nao alcanca sem descobrir que
 *                        pode arrastar de lado — e ninguem descobre.
 *   VAZAMENTO            elemento que passa da borda da tela. E a causa da
 *                        rolagem, e apontar o elemento poupa a cacada.
 *   ALVO DE TOQUE        44px, o nivel AAA do WCAG 2.5.8. Ja e cobrado no CSS;
 *                        aqui e medido na tela renderizada, que e onde fonte
 *                        menor e padding apertado se combinam.
 *   TEXTO CORTADO        elemento cujo conteudo nao cabe nele. Nome de crianca
 *                        cortado no meio e a diferenca entre chamar a certa e
 *                        chamar a errada.
 *   SOBREPOSICAO         dois textos ocupando o mesmo pixel. Ja aconteceu nesta
 *                        tela: a etiqueta subia por cima do nome em 430px.
 *
 * Nao substitui olhar o print — o print pega o que fica feio, este pega o que
 * fica errado. Os dois erram coisas diferentes.
 */
import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { TOKEN, comoAparelho, exigirModoDemonstracao } from './aparelho.mjs'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORTA = 9555
const BASE = process.env.BASE ?? 'http://127.0.0.1:8787'
const PERFIL = join(RAIZ, '.responsivo-perfil')

/*
  As larguras, e de onde cada uma vem.

  Nao sao redondas de proposito: sao aparelhos. Uma tela que passa em 320 e em
  1440 mas quebra em 390 quebrou para metade dos celulares do Brasil.
*/
const LARGURAS = [
  { px: 320, nome: 'celular pequeno (iPhone SE 1a geracao)' },
  { px: 360, nome: 'Android comum' },
  { px: 390, nome: 'iPhone recente' },
  { px: 430, nome: 'celular grande' },
  { px: 600, nome: 'tablet em pe, pequeno' },
  { px: 768, nome: 'tablet em pe' },
  { px: 1024, nome: 'tablet deitado' },
  { px: 1280, nome: 'notebook' },
  { px: 1920, nome: 'projetor da apresentacao' },
]

const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

let falhas = 0
function conferir(rotulo, condicao, detalhe = '') {
  if (condicao) return
  falhas++
  console.log('  FALHA ' + rotulo + ' ' + detalhe)
}

function limparPerfil() {
  for (let i = 0; i < 5; i++) {
    try {
      rmSync(PERFIL, { recursive: true, force: true })
      return
    } catch {
      /* o Chrome ainda esta soltando os arquivos */
    }
  }
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pendentes = new Map()
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data)
      if (this.pendentes.has(m.id)) {
        this.pendentes.get(m.id)(m.result)
        this.pendentes.delete(m.id)
      }
    })
  }
  chamar(metodo, params = {}) {
    return new Promise((resolve) => {
      const id = ++this.id
      this.pendentes.set(id, resolve)
      this.ws.send(JSON.stringify({ id, method: metodo, params }))
    })
  }
  async avaliar(expressao) {
    const r = await this.chamar('Runtime.evaluate', {
      expression: expressao,
      returnByValue: true,
      awaitPromise: true,
    })
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description ?? 'erro na pagina')
    }
    return r.result?.value
  }
}

/*
  A auditoria roda DENTRO da pagina, de uma vez.

  Um ida-e-volta por elemento seria centenas de mensagens por largura, e o
  resultado mudaria enquanto a medicao acontece. Aqui o navegador percorre a
  arvore uma vez e devolve so o que esta errado.

  Nenhuma crase no corpo, nem em comentario: isto vive dentro de um template
  literal, e uma crase perdida fecha a string no meio — com o erro de sintaxe
  apontando para um lugar bem longe da causa.
*/
const AUDITORIA = String.raw`
(() => {
  const problemas = []
  const vis = (e) => {
    const r = e.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }

  /*
    Rotulo que so o leitor de tela alcanca NAO esta cortado.

    Ele esta recortado de proposito: 1px de caixa com o texto inteiro dentro.
    Sem esta excecao a ferramenta acusava a mesma linha em todas as larguras de
    todas as telas — e portao que grita sempre e portao que ninguem le.
  */
  const soParaLeitorDeTela = (e) => {
    const est = getComputedStyle(e)
    const r = e.getBoundingClientRect()
    return (est.clipPath || '').includes('inset') && r.width <= 2 && r.height <= 2
  }

  const nomeDe = (e) => {
    const id = e.id ? '#' + e.id : ''
    const cls = typeof e.className === 'string' && e.className
      ? '.' + e.className.trim().split(/\s+/).join('.')
      : ''
    return (e.tagName.toLowerCase() + id + cls).slice(0, 70)
  }

  const temTextoProprio = (e) =>
    [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0)

  // 1. rolagem horizontal na pagina
  const doc = document.documentElement
  if (doc.scrollWidth > doc.clientWidth + 1) {
    problemas.push({
      tipo: 'rolagem',
      alvo: 'documento',
      detalhe: doc.scrollWidth + 'px de conteudo em ' + doc.clientWidth + 'px de tela',
    })
  }

  const todos = [...document.body.querySelectorAll('*')].filter(vis)

  for (const e of todos) {
    const r = e.getBoundingClientRect()

    // 2. vazamento para fora da tela
    if (r.right > doc.clientWidth + 1 || r.left < -1) {
      const estilo = getComputedStyle(e)
      /*
        Elemento posicionado fora de proposito (aviso escondido, caixa guardada)
        nao conta: ele nao esta vazando, esta guardado.
      */
      if (estilo.position !== 'fixed' && estilo.position !== 'absolute') {
        problemas.push({
          tipo: 'vazamento',
          alvo: nomeDe(e),
          detalhe: 'vai de ' + Math.round(r.left) + ' a ' + Math.round(r.right) +
            ' numa tela de ' + doc.clientWidth,
        })
      }
    }

    // 3. alvo de toque
    const clicavel =
      e.tagName === 'BUTTON' ||
      e.tagName === 'A' ||
      e.tagName === 'SELECT' ||
      e.tagName === 'SUMMARY' ||
      (e.tagName === 'INPUT' && e.type !== 'hidden')
    if (clicavel && !e.disabled && (r.height < 44 || r.width < 24)) {
      problemas.push({
        tipo: 'alvo',
        alvo: nomeDe(e),
        detalhe: Math.round(r.width) + 'x' + Math.round(r.height) + 'px',
      })
    }

    // 4. texto cortado — o conteudo nao cabe na propria caixa
    if (temTextoProprio(e) && !soParaLeitorDeTela(e)) {
      const estilo = getComputedStyle(e)
      const escondido = estilo.overflow === 'hidden' || estilo.overflowX === 'hidden'
      const reticencias = estilo.textOverflow === 'ellipsis'
      if (escondido && !reticencias && e.scrollWidth > e.clientWidth + 1) {
        problemas.push({
          tipo: 'corte',
          alvo: nomeDe(e),
          detalhe: e.scrollWidth + 'px de texto em ' + e.clientWidth + 'px',
        })
      }
    }
  }

  /*
    5. sobreposicao de texto, medida LINHA A LINHA.

    So entre irmaos, e so quando os dois tem texto proprio: pai e filho se
    sobrepoem por definicao, e isso nao e defeito.

    A comparacao usa getClientRects, que devolve um retangulo POR LINHA. A caixa
    unica de um elemento em linha que quebra cobre area onde nao ha tinta
    nenhuma — dois spans irmaos na mesma frase, um deles quebrando, "se
    sobrepunham" sempre por aquela medida. Falso positivo em portao e o jeito
    mais rapido de ensinar alguem a ignorar o portao.
  */
  const comTexto = todos.filter(temTextoProprio)
  for (let i = 0; i < comTexto.length; i++) {
    for (let j = i + 1; j < comTexto.length; j++) {
      const a = comTexto[i]
      const b = comTexto[j]
      if (a.contains(b) || b.contains(a)) continue
      if (a.parentElement !== b.parentElement) continue

      let achou = null
      for (const ra of a.getClientRects()) {
        for (const rb of b.getClientRects()) {
          const largura = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left)
          const altura = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top)
          if (largura > 2 && altura > 2) {
            achou = { largura: largura, altura: altura }
            break
          }
        }
        if (achou) break
      }

      if (achou) {
        problemas.push({
          tipo: 'sobreposicao',
          alvo: nomeDe(a) + ' sobre ' + nomeDe(b),
          detalhe: Math.round(achou.largura) + 'x' + Math.round(achou.altura) + 'px em comum',
        })
      }
    }
  }

  return problemas
})()
`

async function esperarServidor(segundos = 30) {
  for (let i = 0; i < segundos * 2; i++) {
    try {
      const r = await fetch(BASE + '/saude')
      if (r.ok) return
    } catch {
      /* subindo */
    }
    await esperar(500)
  }
  throw new Error('o servidor nao respondeu em ' + BASE + ' — suba com "npm run dev"')
}

function abrirWs(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws', {
      headers: { Cookie: 'janelinhas_dispositivo=' + token },
    })
    ws.addEventListener('open', () => resolve(ws))
    ws.addEventListener('error', () => reject(new Error('nao ligou: ' + token)))
    setTimeout(() => reject(new Error('timeout ligando: ' + token)), 15000)
  })
}

async function principal() {
  await esperarServidor()
  await exigirModoDemonstracao(BASE)

  /*
    Monta um estado com conteudo de VERDADE antes de medir.

    Tela vazia nao quebra: ela cabe em qualquer largura. As quebras aparecem com
    tres criancas de nomes longos, etiqueta, cronometro e dois botoes na mesma
    linha — que e o dia normal, nao o caso extremo.
  */
  const alunos = await fetch(BASE + '/alunos', comoAparelho(TOKEN.portaria)).then((r) =>
    r.json(),
  )
  const doTerceiro = alunos.filter((a) => a.turma === '3º ano').slice(0, 3)
  if (doTerceiro.length < 3) throw new Error('o 3º ano precisa de 3 criancas para a medicao')

  const portaria = await abrirWs(TOKEN.portaria)
  const sala = await abrirWs(TOKEN.sala('3º ano'))
  await esperar(500)

  for (const a of doTerceiro) {
    portaria.send(JSON.stringify({ tipo: 'chamar', alunoId: a.id }))
    await esperar(200)
  }
  await esperar(300)
  sala.send(JSON.stringify({ tipo: 'liberar', alunoId: doTerceiro[0].id }))
  await esperar(250)
  sala.send(JSON.stringify({ tipo: 'liberar', alunoId: doTerceiro[1].id }))
  await esperar(250)
  sala.send(
    JSON.stringify({
      tipo: 'retornar',
      alunoId: doTerceiro[1].id,
      razao: 'nao-saiu-com-o-responsavel',
    }),
  )
  await esperar(600)

  limparPerfil()
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--remote-debugging-port=' + PORTA,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--hide-scrollbars',
      '--user-data-dir=' + PERFIL,
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  let alvo = null
  for (let i = 0; i < 40 && !alvo; i++) {
    await esperar(500)
    try {
      const lista = await fetch('http://127.0.0.1:' + PORTA + '/json/list').then((r) => r.json())
      alvo = lista.find((t) => t.type === 'page')
    } catch {
      /* subindo */
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
  await cdp.chamar('Network.enable')

  const BUSCA =
    "(() => { const c = document.getElementById('consulta');" +
    " c.value = 'nogueira'; c.dispatchEvent(new Event('input')) })()"

  const TELAS = [
    {
      nome: 'portaria',
      url: BASE + '/portaria/',
      cookie: TOKEN.portaria,
      pronto: "!!document.querySelector('#ativas .linha')",
    },
    {
      nome: 'portaria com busca',
      url: BASE + '/portaria/',
      cookie: TOKEN.portaria,
      antes: BUSCA,
      pronto: "document.querySelectorAll('#resultados .linha').length >= 2",
    },
    {
      nome: 'portaria com importacao aberta',
      url: BASE + '/portaria/',
      cookie: TOKEN.portaria,
      antes: "document.getElementById('painelImportar').open = true",
      pronto: "document.getElementById('painelImportar').open === true",
    },
    {
      nome: 'sala',
      url: BASE + '/sala/',
      cookie: TOKEN.sala('3º ano'),
      antes: "document.getElementById('entrar').click()",
      pronto: "!!document.querySelector('.cartao')",
    },
    {
      nome: 'porta de entrada',
      url: BASE + '/portaria/',
      cookie: '',
      pronto: "!!document.querySelector('.porta')",
    },
  ]

  for (const tela of TELAS) {
    console.log('\n== ' + tela.nome + ' ==')

    await cdp.chamar('Network.clearBrowserCookies')
    if (tela.cookie) {
      await cdp.chamar('Network.setCookie', {
        name: 'janelinhas_dispositivo',
        value: tela.cookie,
        domain: '127.0.0.1',
        path: '/',
      })
    }

    for (const largura of LARGURAS) {
      await cdp.chamar('Emulation.setDeviceMetricsOverride', {
        width: largura.px,
        height: 800,
        deviceScaleFactor: 1,
        mobile: largura.px < 768,
      })
      await cdp.chamar('Page.navigate', { url: tela.url })
      await esperar(1400)

      if (tela.antes) {
        await cdp.chamar('Runtime.evaluate', { expression: tela.antes, userGesture: true })
        await esperar(700)
      }

      let pronto = true
      if (tela.pronto) {
        pronto = false
        for (let i = 0; i < 20 && !pronto; i++) {
          pronto = (await cdp.avaliar(tela.pronto)) === true
          if (!pronto) await esperar(250)
        }
      }
      conferir(largura.px + 'px: a tela carregou', pronto, '(' + largura.nome + ')')
      if (!pronto) continue

      const problemas = await cdp.avaliar(AUDITORIA)

      if (problemas.length === 0) {
        console.log('  ok    ' + String(largura.px).padStart(4) + 'px  ' + largura.nome)
        continue
      }

      falhas += problemas.length
      console.log('  FALHA ' + String(largura.px).padStart(4) + 'px  ' + largura.nome)

      // Agrupa por tipo: dez vazamentos do mesmo pai sao um problema, nao dez.
      const porTipo = new Map()
      for (const p of problemas) {
        const lista = porTipo.get(p.tipo) ?? []
        lista.push(p)
        porTipo.set(p.tipo, lista)
      }
      for (const [tipo, lista] of porTipo) {
        console.log('          ' + tipo + ' (' + lista.length + '):')
        for (const p of lista.slice(0, 4)) {
          console.log('            ' + p.alvo + ' — ' + p.detalhe)
        }
        if (lista.length > 4) console.log('            … e mais ' + (lista.length - 4))
      }
    }
  }

  ws.close()
  chrome.kill()
  await esperar(800)
  limparPerfil()

  portaria.close()
  sala.close()
  await esperar(400)

  console.log(falhas === 0 ? '\nTUDO VERDE\n' : '\n' + falhas + ' PROBLEMA(S)\n')
  process.exit(falhas === 0 ? 0 : 1)
}

principal().catch((e) => {
  console.error('erro:', e.message)
  limparPerfil()
  process.exit(1)
})
