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
import { TOKEN, cookieDe, comoAparelho, exigirModoDemonstracao } from './aparelho.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:8787'
const WS = BASE.replace(/^http/, 'ws')
const PERFIL = join(RAIZ, '.telas-perfil')

const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

let falhas = 0
/*
  Expressao que responde se o elemento ESTA NA TELA, e nao se a propriedade
  `hidden` esta ligada.

  As duas divergem quando uma regra de CSS declara `display` no elemento: o
  atributo `hidden` esconde por `display: none` da folha do navegador, que
  perde para qualquer regra nossa. Foi assim que uma barra preta vazia ficou
  atravessada na tela da sala com `el.hidden === true`, e nenhuma verificacao
  reclamou.
*/
const naTela = (id) =>
  `(() => { const e = document.getElementById(${JSON.stringify(id)});` +
  ` return !!e && e.getBoundingClientRect().height > 0 })()`

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

function abrirWs(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS}/ws`, { headers: { Cookie: cookieDe(token) } })
    ws.addEventListener('open', () => resolve(ws))
    ws.addEventListener('error', () => reject(new Error(`nao ligou como ${token}`)))
    setTimeout(() => reject(new Error(`timeout ligando como ${token}`)), 15000)
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
/*
  Como a portaria fecha cada estado.

  Estas verificacoes contam criancas ("2 criancas na fila"), e o quadro
  PERSISTE desde a 0.2. Sem esvaziar antes, cada secao herda o que a anterior —
  ou uma rodada de prints — deixou, e a contagem mede o historico em vez do que
  a propria secao acabou de montar.

  Fecha pelo caminho legitimo, nunca apagando: a trilha registra a limpeza como
  registraria qualquer acao da portaria.
*/
/*
  A restricao que a semente instala, repetida aqui.

  Repeticao deliberada, e ela precisa de explicacao: o ataque do red team
  reimporta a planilha para provocar a troca de versao do cadastro, e importar
  SUBSTITUI a lista inteira — inclusive a coluna de restricao. Como `/alunos`
  entrega so o booleano (que e o ponto da 1.9), este arquivo nao consegue ler o
  texto para devolve-lo.

  Entao ele devolve o que sabe. Sem isso, uma execucao apaga o alerta e a
  execucao SEGUINTE falha inteira na secao da restricao, sem nenhuma relacao
  aparente com o ataque que a causou.

  Se `src/semente.ts` mudar o texto, a unica coisa que quebra e a comparacao de
  substring logo abaixo — visivel, e nao silenciosa.
*/
/*
  As familias da semente, repetidas aqui — pelo mesmo motivo da restricao logo
  abaixo, e com um agravante.

  Reimportar a lista de ALUNOS recalcula os ids a partir de nome+turma, e os
  vinculos antigos ficam apontando para ninguem. O servidor poda os orfaos (e
  avisa quantos), entao depois de qualquer reimportacao a escola — e este
  arquivo — precisa subir a segunda planilha de novo.

  Sem isto, uma execucao apaga as autorizacoes e a execucao SEGUINTE falha na
  secao de entrega, tres secoes longe da causa. Ja aconteceu quatro vezes nesta
  refatoracao com formas diferentes do mesmo erro: teste que mexe em estado
  compartilhado e teste que envenena os outros.
*/
const FAMILIAS_DA_SEMENTE = [
  ['Alice Fernandes', 'Pré 1', 'Marta Fernandes', 'mãe', '(11) 90000-0001', ''],
  ['Maria Eduarda Nogueira', '1º ano', 'Marta Fernandes', 'mãe', '(11) 90000-0001', ''],
  ['Maria Eduarda Nogueira', '6º ano', 'Marta Fernandes', 'mãe', '(11) 90000-0001', ''],
  ['Alice Fernandes', 'Pré 1', 'Ricardo Fernandes', 'pai', '(11) 90000-0002', 'sim'],
  ['Maria Eduarda Nogueira', '1º ano', 'Ricardo Fernandes', 'pai', '(11) 90000-0002', ''],
  ['Maria Eduarda Nogueira', '6º ano', 'Ricardo Fernandes', 'pai', '(11) 90000-0002', ''],
  ['Ravi Bacelar', 'Pré 2', 'Zuleide Bacelar', 'avó', '(11) 90000-0003', ''],
]

const RESTRICAO_DA_SEMENTE =
  'Guarda compartilhada. Entregar somente à mãe ou à avó materna, ' +
  'conforme decisão judicial de 2026 (ficção da semente).'
const CRIANCA_COM_RESTRICAO = 'Ravi Bacelar'

const FECHA_ESTADO = {
  chamado: 'cancelar',
  liberado: 'entregar',
  retorno: 'encerrar',
}

async function esvaziarQuadro(ws) {
  /*
    Exige socket VIVO, e abre um proprio se o de fora tiver caido.

    A versao anterior lia `ws.__retratos.at(-1)` sem conferir nada. Depois de
    oitenta verificacoes o socket compartilhado ja tinha caido em algum ponto, e
    o ultimo retrato que ele viu — de minutos atras — passou a ser lido como o
    estado atual: a funcao declarava o quadro vazio com duas criancas nele, e a
    secao seguinte falhava inteira. E a terceira vez nesta refatoracao que dado
    velho e lido como dado atual, e as tres tinham o mesmo formato: nao havia
    como distinguir "sei que esta vazio" de "nao sei".

    Agora, se a conexao entregue nao estiver aberta, esta funcao abre a dela e
    fecha ao sair. Um connect por chamada, e nao um por volta: o wrangler ainda
    cai com desconexao abrupta de WebSocket.
  */
  let proprio = null
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    proprio = await ligarWs(TOKEN.portaria)
    ws = proprio
    await esperar(500)
  }

  const encerrar = async (resultado) => {
    if (proprio) {
      proprio.close()
      await esperar(300)
    }
    return resultado
  }

  for (let volta = 0; volta < 10; volta++) {
    if (ws.readyState !== WebSocket.OPEN) return encerrar(false)

    const chamadas = ws.__retratos.at(-1)?.chamadas ?? []
    if (chamadas.length === 0) return encerrar(true)

    for (const c of chamadas) {
      const tipo = FECHA_ESTADO[c.estado]
      if (tipo) ws.send(JSON.stringify({ tipo, alunoId: c.alunoId }))
      await esperar(200)
    }
    await esperar(500)
  }
  return encerrar((ws.__retratos.at(-1)?.chamadas ?? []).length === 0)
}

/*
  Liga, e guarda TODO retrato que chegar desde a conexao.

  O coletor existe porque a ausencia de retrato nao e informacao: uma conexao
  parada nao significa quadro vazio, significa que nada mudou. `esvaziarQuadro`
  lia justamente isso ao contrario — esperava um retrato por tres segundos e,
  nao vindo nenhum, dava o quadro por vazio e seguia. A secao seguinte entao
  contava criancas que a anterior deixou, e falhava sem haver bug nenhum.
*/
/*
  Autoriza o NAVEGADOR do teste, colocando o cookie do aparelho direto.

  A alternativa seria a ferramenta digitar o token na porta a cada tela — o que
  testaria a porta trinta vezes e o resto nenhuma. A porta tem verificacao
  propria; aqui o que interessa e o que vem depois dela.

  `Network.setCookie` precisa do dominio, e nao da URL, senao o cookie nao
  acompanha o WebSocket.
*/
async function autorizarNavegador(cdp, token) {
  await cdp.chamar('Network.enable')
  await cdp.chamar('Network.setCookie', {
    name: 'janelinhas_dispositivo',
    value: token,
    domain: '127.0.0.1',
    path: '/',
    httpOnly: true,
    sameSite: 'Strict',
  })
}

async function ligarWs(token, tentativas = 4) {
  for (let i = 1; i <= tentativas; i++) {
    try {
      const ws = await abrirWs(token)
      ws.__retratos = []
      ws.addEventListener('message', (e) => {
        const m = JSON.parse(e.data)
        if (m.tipo === 'retrato') ws.__retratos.push(m)
      })
      return ws
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
  await exigirModoDemonstracao(BASE)
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
  await autorizarNavegador(cdp, TOKEN.portaria)
  await cdp.chamar('Emulation.setDeviceMetricsOverride', {
    width: 430,
    height: 880,
    deviceScaleFactor: 1,
    mobile: true,
  })
  await cdp.chamar('Page.navigate', { url: `${BASE}/portaria/` })
  await esperar(2500)

  const outra = await ligarWs(TOKEN.portaria)
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
  const alunos = await fetch(`${BASE}/alunos`, comoAparelho(TOKEN.portaria)).then((r) => r.json())
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

  console.log('\n== a fila em saida: grupo, cronometro e contagem ==')

  /*
    A tela que gerencia a fila era a unica que nao mostrava o tamanho dela, e o
    `desde` existia desde sempre sem nunca ter sido desenhado.
  */
  // Ponto de partida conhecido: contagem absoluta exige quadro vazio.
  conferir('o quadro comeca vazio para contar', await esvaziarQuadro(outra))
  await esperar(600)

  const salaDoForasteiro = await ligarWs(TOKEN.sala(forasteiro.turma))
  await esperar(400)
  outra.send(JSON.stringify({ tipo: 'chamar', alunoId: forasteiro.id }))
  await esperar(900)

  const comUm = await cdp.avaliar(`
    (() => {
      const c = document.getElementById('contagemSaida')
      const grupos = [...document.querySelectorAll('#ativas .grupo')].map((g) => ({
        estado: g.dataset.grupo,
        quantos: g.querySelector('.quantos')?.textContent,
      }))
      const espera = document.querySelector('#ativas .linha .espera')?.textContent ?? ''
      return { contagem: c.textContent.trim(), visivel: !c.hidden, grupos, espera }
    })()
  `)
  conferir('a contagem aparece e concorda com a lista',
    comUm.visivel === true && /1 crian/.test(comUm.contagem), JSON.stringify(comUm))
  conferir('a linha mostra ha quanto tempo espera',
    /h[aá] \d+/.test(comUm.espera), JSON.stringify(comUm.espera))
  conferir('e a fila esta agrupada por estado, com o grupo contado',
    comUm.grupos.length === 1 && comUm.grupos[0].estado === 'chamado' &&
      comUm.grupos[0].quantos === '1',
    JSON.stringify(comUm.grupos))

  // Uma segunda crianca, em outro estado: dois grupos, e a acao da portaria em cima.
  salaDoForasteiro.send(JSON.stringify({ tipo: 'liberar', alunoId: forasteiro.id }))
  await esperar(400)
  outra.send(JSON.stringify({ tipo: 'chamar', alunoId: segundo.id }))
  await esperar(900)

  const comDois = await cdp.avaliar(`
    (() => {
      const filhos = [...document.getElementById('ativas').children]
      return {
        ordem: filhos.map((n) =>
          n.classList.contains('grupo')
            ? 'GRUPO:' + n.dataset.grupo
            : n.dataset.estado),
        contagem: document.getElementById('contagemSaida').textContent.trim(),
      }
    })()
  `)
  conferir('a contagem acompanha', /2 crian/.test(comDois.contagem), comDois.contagem)
  conferir('o que a portaria PODE ENTREGAR vem primeiro',
    comDois.ordem[0] === 'GRUPO:liberado' && comDois.ordem[1] === 'liberado',
    JSON.stringify(comDois.ordem))
  conferir('e quem espera a sala vem depois',
    comDois.ordem.includes('GRUPO:chamado') &&
      comDois.ordem.indexOf('GRUPO:chamado') > comDois.ordem.indexOf('GRUPO:liberado'),
    JSON.stringify(comDois.ordem))

  /*
    O cronometro nao pode trocar no nenhum.

    Redesenhar a lista de dez em dez segundos seria o furo S2 automatizado: o
    botao sob o dedo da porteira trocado por conta propria, sem nem haver um
    evento. Aqui o tique so reescreve o texto de um <span>.
  */
  await cdp.avaliar(`
    (() => {
      window.__antes = [...document.querySelectorAll('#ativas .linha')]
      window.__textoAntes = window.__antes.map((li) => li.querySelector('.espera').textContent)
    })()
  `)
  await esperar(11000)
  const depoisDoTique = await cdp.avaliar(`
    (() => {
      const agora = [...document.querySelectorAll('#ativas .linha')]
      return {
        mesmosNos: agora.length === window.__antes.length &&
          agora.every((li, i) => li === window.__antes[i]),
        mudouTexto: agora.some(
          (li, i) => li.querySelector('.espera').textContent !== window.__textoAntes[i],
        ),
      }
    })()
  `)
  conferir('o tique do cronometro NAO troca os nos da lista',
    depoisDoTique.mesmosNos === true, JSON.stringify(depoisDoTique))
  conferir('mas o tempo escrito anda', depoisDoTique.mudouTexto === true,
    JSON.stringify(depoisDoTique))

  // limpa
  salaDoForasteiro.close()
  outra.send(JSON.stringify({ tipo: 'entregar', alunoId: forasteiro.id }))
  await esperar(300)
  outra.send(JSON.stringify({ tipo: 'cancelar', alunoId: segundo.id }))
  await esperar(500)

  const vazia = await cdp.avaliar(`
    (() => ({
      contagemEscondida: document.getElementById('contagemSaida').hidden,
      grupos: document.querySelectorAll('#ativas .grupo').length,
      vazioVisivel: !document.getElementById('nenhuma').hidden,
    }))()
  `)
  conferir('com a fila vazia, a contagem some', vazia.contagemEscondida === true,
    JSON.stringify(vazia))
  conferir('e nao sobra cabecalho de grupo vazio', vazia.grupos === 0,
    JSON.stringify(vazia))
  conferir('e o aviso de fila vazia aparece', vazia.vazioVisivel === true,
    JSON.stringify(vazia))

  console.log('\n== a etiqueta nao perde o icone quando o estado muda ==')

  /*
    A portaria trocava so o TEXTO da etiqueta, e textContent substitui todos os
    filhos — inclusive o <svg> que o cartao.js monta. Resultado: na tela onde o
    estado mais muda, a etiqueta perdia o icone assim que mudava, e os quatro
    canais viravam dois, cor e texto. Exatamente o que a 0.5 existe para
    impedir, quebrado no lugar mais movimentado.

    Este teste olha a linha ANTES e DEPOIS de uma mudanca de estado.
  */
  /*
    O nome entra como ARGUMENTO da funcao, nao como `const` antes dela.

    `const` no escopo global do Runtime.evaluate vale para a sessao
    inteira, e este helper e chamado duas vezes: a segunda morria com
    "Identifier 'ALVO' has already been declared". E a ordem importa —
    a funcao primeiro, o argumento depois; ao contrario, o JavaScript
    tenta chamar a string como funcao.
  */
  const lerEtiqueta = () =>
    cdp.avaliar(
`
      ((ALVO) => {
        // Pelo NOME, nao pelo primeiro da lista: o quadro pode ter outras
        // criancas das secoes anteriores, e ai o teste mediria a linha errada.
        const li = [...document.querySelectorAll('#ativas .linha')].find(
          (n) => n.querySelector('.nome')?.textContent?.startsWith(ALVO),
        )
        if (!li) return { existe: false }
        const et = li.querySelector('.etiqueta')
        return {
          existe: true,
          estado: li.dataset.estado,
          texto: (et?.textContent || '').trim(),
          temIcone: !!et?.querySelector('svg'),
        }
      })
    ` + '(' + JSON.stringify(forasteiro.nome) + ')')

  outra.send(JSON.stringify({ tipo: 'chamar', alunoId: forasteiro.id }))
  await esperar(900)
  const chamado = await lerEtiqueta()
  conferir('a linha recem-chamada tem icone', chamado.temIcone === true,
    JSON.stringify(chamado))

  // Outra pessoa, na sala daquela crianca, libera. A etiqueta muda de estado
  // na tela da PORTARIA, que e onde o defeito vivia.
  const salaDoAluno = await ligarWs(TOKEN.sala(forasteiro.turma))
  await esperar(400)
  salaDoAluno.send(JSON.stringify({ tipo: 'liberar', alunoId: forasteiro.id }))
  await esperar(1200)

  const liberado = await lerEtiqueta()
  conferir('a etiqueta acompanhou a mudanca de estado',
    liberado.estado === 'liberado' && liberado.texto.length > 0, JSON.stringify(liberado))
  conferir('REGRESSAO: e continua com icone depois de mudar',
    liberado.temIcone === true, JSON.stringify(liberado))
  conferir('o rotulo vem do componente, nao de texto escrito na tela',
    liberado.texto === 'liberado', JSON.stringify(liberado))

  salaDoAluno.close()
  outra.send(JSON.stringify({ tipo: 'entregar', alunoId: forasteiro.id }))
  await esperar(600)

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
        if (Original) {
          window.__contextos = []
          window.__osciladores = 0
          window.AudioContext = class extends Original {
            constructor(...args) {
              super(...args)
              window.__contextos.push(this)
            }
            // Conta cada nota efetivamente agendada. E a unica evidencia direta
            // de que saiu som — ou de que nao saiu, que e o que este teste quer.
            createOscillator(...args) {
              window.__osciladores++
              return super.createOscillator(...args)
            }
          }
        }
        // Guarda os bloqueios de tela concedidos, para o teste poder solta-los
        // como o sistema operacional faria ao esconder a aba.
        if (navigator.wakeLock) {
          window.__travas = []
          const pedirOriginal = navigator.wakeLock.request.bind(navigator.wakeLock)
          navigator.wakeLock.request = async (tipo) => {
            const trava = await pedirOriginal(tipo)
            window.__travas.push(trava)
            return trava
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
  const avisoNaTela = await cdp.avaliar(naTela('avisoSom'))
  conferir('com o som funcionando, o aviso fica escondido',
    antes.visivel === false, JSON.stringify(antes))
  conferir('e escondido de verdade, nao so no atributo',
    avisoNaTela === false, `altura na tela: ${avisoNaTela}`)

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
      rodando: window.__contextos[0].state === 'running',
    }))()
  `)
  conferir('a crianca aparece mesmo com o som parado',
    comChamada.cartoes >= 1, JSON.stringify(comChamada))

  /*
    O invariante e este, e nao "o aviso continua de pe".

    `acordar()` tenta o resume a cada toque, e as vezes ele volta — e ai o aviso
    sumir e acerto, nao falha. A primeira versao desta verificacao exigia o
    aviso de pe e reprovava o comportamento certo. O que NAO pode existir e o
    terceiro caso: som que nao saiu e tela que nao diz nada.
  */
  conferir('nao existe silencio sem aviso',
    comChamada.rodando || comChamada.aviso === true, JSON.stringify(comChamada))

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
    Silenciar tem que apagar o aviso.

    Sem isto a tela insistia em "toque aqui para reativar" depois de a
    professora ter desligado o som de proposito — o app tentando consertar algo
    que ela acabou de escolher.
  */
  await cdp.avaliar(`window.__contextos[0].suspend()`)
  await esperar(400)
  const avisoAntesDoMudo = await cdp.avaliar(
    `document.getElementById('avisoSom').hidden === false`,
  )
  conferir('o aviso esta de pe antes de silenciar', avisoAntesDoMudo === true)

  await cdp.chamar('Runtime.evaluate', {
    expression: `document.getElementById('mudo').click()`,
    userGesture: true,
  })
  await esperar(300)
  const avisoDepoisDoMudo = await cdp.avaliar(
    `document.getElementById('avisoSom').hidden === false`,
  )
  conferir('silenciar apaga o aviso de som interrompido',
    avisoDepoisDoMudo === false, String(avisoDepoisDoMudo))
  conferir('e ele sai da tela, nao so do atributo',
    (await cdp.avaliar(naTela('avisoSom'))) === false)

  // e religar traz o aviso de volta, porque o problema continua existindo
  await cdp.chamar('Runtime.evaluate', {
    expression: `document.getElementById('mudo').click()`,
    userGesture: false,
  })
  await esperar(400)
  const avisoAoReligar = await cdp.avaliar(`
    (() => ({ aviso: document.getElementById('avisoSom').hidden === false,
              estado: window.__contextos[0].state }))()
  `)
  conferir('religar com o som ainda parado traz o aviso de volta',
    avisoAoReligar.estado !== 'running' ? avisoAoReligar.aviso === true : true,
    JSON.stringify(avisoAoReligar))

  await cdp.chamar('Runtime.evaluate', {
    expression: `window.__contextos[0].resume()`,
    userGesture: true,
  })
  await esperar(400)

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

  console.log('\n== o som so toca quando algo acontece ==')

  /*
    O primeiro retrato e a fotografia do que ja estava acontecendo antes desta
    tela existir: um F5 no meio da saida, ou a reconexao depois de o wifi cair.
    Sem a guarda, recarregar com criancas na fila disparava um sino para cada
    uma, de uma vez — e nenhum correspondia a alguem que acabou de chegar.

    Som que toca quando nada aconteceu ensina a professora a ignorar o som, e
    ai o canal esta perdido para quando importar.
  */
  /*
    Desliga o mudo que a secao anterior deixou ligado.

    Sem isto, "o primeiro retrato nao toca" passava por a sala estar
    SILENCIADA, e nao pela guarda que este teste existe para proteger — teste
    verde pelo motivo errado e pior que teste vermelho, porque ninguem volta
    nele.
  */
  await cdp.avaliar(`localStorage.removeItem('janelinhas:mudo')`)

  outra.send(JSON.stringify({ tipo: 'chamar', alunoId: forasteiro.id }))
  await esperar(800)

  await cdp.chamar('Page.navigate', {
    url: `${BASE}/sala/?turma=${encodeURIComponent(turmaDoAluno)}`,
  })
  await esperar(1800)
  await cdp.chamar('Runtime.evaluate', {
    expression: `document.getElementById('entrar').click()`,
    userGesture: true,
  })
  await esperar(1800)

  const aoEntrar = await cdp.avaliar(`
    (() => ({
      cartoes: document.querySelectorAll('.cartao').length,
      osciladores: window.__osciladores,
      estado: window.__contextos[0]?.state,
      mudo: document.getElementById('mudo').textContent.trim(),
    }))()
  `)
  conferir('o som esta LIGADO antes de medir silencio',
    aoEntrar.mudo === 'Som ligado', JSON.stringify(aoEntrar))
  conferir('a crianca que ja estava na fila aparece no F5',
    aoEntrar.cartoes >= 1, JSON.stringify(aoEntrar))
  conferir('REGRESSAO: e o primeiro retrato NAO toca nada',
    aoEntrar.osciladores === 0, JSON.stringify(aoEntrar))

  // Agora sim: alguem chega no portao com a tela ja aberta.
  const outroAluno = (
    await fetch(`${BASE}/alunos`, comoAparelho(TOKEN.portaria)).then((r) => r.json())
  ).filter((a) => a.turma === turmaDoAluno && a.id !== forasteiro.id)[0]

  if (outroAluno) {
    outra.send(JSON.stringify({ tipo: 'chamar', alunoId: outroAluno.id }))
    await esperar(1500)
    const aoChegar = await cdp.avaliar(`window.__osciladores`)
    conferir('mas uma chegada de verdade toca', aoChegar >= 2,
      `osciladores: ${aoChegar} (a abertura sao duas notas)`)
    outra.send(JSON.stringify({ tipo: 'cancelar', alunoId: outroAluno.id }))
    await esperar(400)
  } else {
    conferir('mas uma chegada de verdade toca', false,
      'nao achei um segundo aluno na turma para testar')
  }

  console.log('\n== o volume tem degraus e e lembrado ==')

  const controle = await cdp.avaliar(`
    (() => {
      const s = document.getElementById('volume')
      if (!s) return { existe: false }
      const rotulo = document.querySelector('label[for="volume"]')
      return {
        existe: true,
        opcoes: [...s.options].map((o) => o.value),
        escolhido: s.value,
        temRotulo: !!rotulo && rotulo.textContent.trim().length > 0,
        alturaOk: Math.round(s.getBoundingClientRect().height) >= 44,
        altura: Math.round(s.getBoundingClientRect().height),
      }
    })()
  `)
  conferir('existe controle de volume', controle.existe === true)
  conferir('com tres degraus', controle.opcoes?.length === 3, JSON.stringify(controle))
  conferir('e com rotulo para leitor de tela', controle.temRotulo === true,
    JSON.stringify(controle))
  conferir('dentro do alvo de 44px', controle.alturaOk === true,
    `mede ${controle.altura}px`)

  await cdp.avaliar(`
    (() => {
      const s = document.getElementById('volume')
      s.value = 'baixo'
      s.dispatchEvent(new Event('change'))
    })()
  `)
  await esperar(300)
  const guardadoVolume = await cdp.avaliar(`localStorage.getItem('janelinhas:volume')`)
  conferir('escolher o volume guarda a escolha', guardadoVolume === 'baixo',
    String(guardadoVolume))

  await cdp.chamar('Page.navigate', {
    url: `${BASE}/sala/?turma=${encodeURIComponent(turmaDoAluno)}`,
  })
  await esperar(1800)
  const voltou = await cdp.avaliar(`document.getElementById('volume').value`)
  conferir('e ela sobrevive ao recarregamento', voltou === 'baixo', String(voltou))

  await cdp.avaliar(`localStorage.removeItem('janelinhas:volume')`)

  console.log('\n== a tela nao apaga durante a saida ==')

  /*
    A tela da sala fica minutos parada de proposito: ela so muda quando um
    responsavel chega no portao. E exatamente ai que o tablet decide apagar — e
    com a tela apagada o som tambem nao sai, porque o navegador suspende o audio
    junto. Os dois canais caem ao mesmo tempo, e a professora nao fica sabendo
    de nada.
  */
  await cdp.chamar('Page.navigate', {
    url: `${BASE}/sala/?turma=${encodeURIComponent(turmaDoAluno)}`,
  })
  await esperar(1800)

  const antesDeEntrar = await cdp.avaliar(`
    (() => ({
      suporta: 'wakeLock' in navigator,
      aviso: document.getElementById('telaApaga').hidden === false,
      travas: (window.__travas || []).length,
    }))()
  `)
  conferir('o navegador de teste tem a API de bloqueio de tela',
    antesDeEntrar.suporta === true, JSON.stringify(antesDeEntrar))
  conferir('fora da sala o bloqueio nem e pedido',
    antesDeEntrar.travas === 0, JSON.stringify(antesDeEntrar))

  await cdp.chamar('Runtime.evaluate', {
    expression: `document.getElementById('entrar').click()`,
    userGesture: true,
  })
  await esperar(1000)

  const depoisDeEntrar = await cdp.avaliar(`
    (() => ({
      travas: (window.__travas || []).length,
      solta: (window.__travas || [])[0]?.released,
      aviso: document.getElementById('telaApaga').hidden === false,
    }))()
  `)
  conferir('entrar na sala pede o bloqueio de tela',
    depoisDeEntrar.travas === 1 && depoisDeEntrar.solta === false,
    JSON.stringify(depoisDeEntrar))
  conferir('com o bloqueio ativo, o rodape nao diz nada',
    depoisDeEntrar.aviso === false, JSON.stringify(depoisDeEntrar))

  /*
    O sistema solta o bloqueio sozinho toda vez que a aba deixa de estar
    visivel: trocar de aplicativo, atender uma ligacao, a tela travar. Sem a
    reaquisicao, a primeira dessas coisas desliga o bloqueio para o resto do
    turno — e a professora acha que continua protegida.
  */
  const soltou = await cdp.avaliar(`
    (async () => {
      await window.__travas[0].release()
      await new Promise((r) => setTimeout(r, 300))
      return { solta: window.__travas[0].released,
               aviso: document.getElementById('telaApaga').hidden === false }
    })()
  `)
  conferir('quando o sistema solta o bloqueio, o rodape avisa',
    soltou.solta === true && soltou.aviso === true, JSON.stringify(soltou))

  const readquiriu = await cdp.avaliar(`
    (async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await new Promise((r) => setTimeout(r, 500))
      return { travas: window.__travas.length,
               ultimaSolta: window.__travas.at(-1)?.released,
               aviso: document.getElementById('telaApaga').hidden === false }
    })()
  `)
  conferir('e voltar para a aba readquire o bloqueio sozinho',
    readquiriu.travas === 2 && readquiriu.ultimaSolta === false && readquiriu.aviso === false,
    JSON.stringify(readquiriu))

  console.log('\n== a turma vem do APARELHO, e a tela nao a contradiz ==')

  /*
    Ate a fase 2 esta secao verificava a memoria da turma: a ultima usada
    voltava pre-selecionada, com aviso, porque entrar na sala errada e ver a
    crianca de outra turma sumir da tela sem explicacao — e nao ver a da sua.
    O plano dizia que aquilo valia "ate existir login".

    Agora existe. O tablet foi autorizado como uma sala pela escola, e o erro
    deixou de ser POSSIVEL em vez de ficar sendo avisado. O que se verifica
    aqui, entao, e o oposto: que a tela nao oferece nada capaz de contrariar o
    aparelho.
  */
  const salaDoTeste = TOKEN.sala(turmaDoAluno)
  await autorizarNavegador(cdp, salaDoTeste)
  await cdp.chamar('Page.navigate', { url: `${BASE}/sala/` })
  await esperar(2000)

  const semSeletor = await cdp.avaliar(`
    (() => ({
      temSeletorDeTurma: !!document.getElementById('turma'),
      escrito: document.getElementById('turmaDoAparelho')?.textContent ?? '',
      guardado: localStorage.getItem('janelinhas:turma'),
    }))()
  `)
  conferir('a tela NAO oferece escolha de turma', semSeletor.temSeletorDeTurma === false,
    JSON.stringify(semSeletor))
  conferir('ela escreve a turma do aparelho',
    semSeletor.escrito.includes(turmaDoAluno), JSON.stringify(semSeletor.escrito))
  conferir('e nao guarda turma nenhuma: a memoria virou o proprio aparelho',
    semSeletor.guardado === null, JSON.stringify(semSeletor.guardado))

  /*
    E a URL nao manda mais nada. `?turma=` era o caminho que produzia a sessao
    cega — a professora entrava numa turma que nao era a dela, nao via crianca
    nenhuma, e nao havia erro em lugar nenhum.
  */
  const outraTurma = turmaDoAluno === '9º ano' ? 'Pré 1' : '9º ano'
  await cdp.chamar('Page.navigate', {
    url: `${BASE}/sala/?turma=${encodeURIComponent(outraTurma)}`,
  })
  await esperar(2000)
  const comUrl = await cdp.avaliar(`
    document.getElementById('turmaDoAparelho')?.textContent ?? ''
  `)
  conferir('a URL nao consegue trocar a turma do aparelho',
    comUrl.includes(turmaDoAluno) && !comUrl.includes(outraTurma),
    JSON.stringify(comUrl))

  // devolve o navegador para a portaria, que e o que as secoes seguintes usam
  await autorizarNavegador(cdp, TOKEN.portaria)

  console.log('\n== homonimo: a turma deixa de ser detalhe ==')

  /*
    Chamar a Maria Eduarda errada avisa a SALA errada, e a crianca certa
    continua esperando no portao sem ninguem saber. Quando o nome se repete no
    cadastro, a turma vira a UNICA coisa que separa as duas — e ate aqui ela
    estava em cinza pequeno, do mesmo tamanho de todo o resto.

    O par de homonimas mora na SEMENTE. A primeira versao desta verificacao
    importava uma planilha com nomes repetidos e devolvia o cadastro depois —
    e nao dava: importar deriva os ids de nome+turma (`i<hash>`), enquanto a
    semente usa `a01..a44`, entao a devolucao trocava os ids e quebrava o
    fim-a-fim, que os usa por escrito. Semente sem o caso dificil e semente que
    so prova o caminho facil.
  */
  await cdp.chamar('Page.navigate', { url: BASE + '/portaria/' })
  await esperar(2200)

  const buscarPor = async (texto) => {
    await cdp.chamar('Runtime.evaluate', {
      expression:
        '(() => { const c = document.getElementById(' +
        JSON.stringify('consulta') +
        '); c.value = ' +
        JSON.stringify(texto) +
        '; c.dispatchEvent(new Event(' +
        JSON.stringify('input') +
        ')) })()',
    })
    await esperar(450)
  }

  await buscarPor('maria eduarda')
  const comHomonimo = await cdp.avaliar(`
    (() => {
      const linhas = [...document.querySelectorAll('#resultados .linha')]
      return {
        quantas: linhas.length,
        marcadas: linhas.filter((li) => li.dataset.homonimo === 'true').length,
        aviso: linhas[0]?.querySelector('.homonimo')?.textContent ?? '',
        turmas: linhas.map((li) => li.querySelector('.turma-da-linha')?.textContent),
      }
    })()
  `)
  conferir('as duas homonimas aparecem', comHomonimo.quantas === 2,
    JSON.stringify(comHomonimo))
  conferir('as duas vem marcadas', comHomonimo.marcadas === 2,
    JSON.stringify(comHomonimo))
  conferir('com aviso em TEXTO, nao so em cor',
    comHomonimo.aviso.length > 0, JSON.stringify(comHomonimo.aviso))
  conferir('e as turmas aparecem e sao diferentes, que e o que as separa',
    comHomonimo.turmas.filter(Boolean).length === 2 &&
      comHomonimo.turmas[0] !== comHomonimo.turmas[1],
    JSON.stringify(comHomonimo.turmas))

  await buscarPor('alice')
  const unico = await cdp.avaliar(`
    (() => {
      const li = document.querySelector('#resultados .linha')
      return { marcada: li?.dataset.homonimo, temAviso: !!li?.querySelector('.homonimo') }
    })()
  `)
  conferir('nome unico NAO e marcado',
    unico.marcada === 'false' && unico.temAviso === false, JSON.stringify(unico))

  /*
    A ordem: quem casa no PRIMEIRO nome vem antes de quem casa no sobrenome.
    Sem ordem, os resultados saiam na ordem da planilha e a crianca obvia podia
    cair fora das oito primeiras por acaso de posicao no arquivo.
  */
  await buscarPor('maria')
  const ordem = await cdp.avaliar(`
    (() => [...document.querySelectorAll('#resultados .linha')].map(
      (li) => li.querySelector('.nome')?.firstChild?.textContent?.trim(),
    ))()
  `)
  conferir('busca por primeiro nome poe quem comeca com ele na frente',
    ordem.length > 0 && ordem[0].startsWith('Maria'), JSON.stringify(ordem))

  /*
    Busca por sobrenome acha as duas homonimas E a Beatriz Nogueira, que so
    divide o sobrenome. So as duas primeiras sao marcadas: a marca e sobre o
    nome INTEIRO se repetir, nao sobre parte dele. Marcar a Beatriz seria um
    alarme falso, e alarme falso e como se ensina alguem a ignorar alarme.
  */
  await buscarPor('nogueira')
  const porSobrenome = await cdp.avaliar(`
    (() => {
      const linhas = [...document.querySelectorAll('#resultados .linha')]
      return {
        quantas: linhas.length,
        marcadas: linhas.filter((li) => li.dataset.homonimo === 'true').length,
      }
    })()
  `)
  conferir('a busca por sobrenome acha as tres Nogueira',
    porSobrenome.quantas === 3, JSON.stringify(porSobrenome))
  conferir('mas so as duas de nome INTEIRO repetido sao marcadas',
    porSobrenome.marcadas === 2, JSON.stringify(porSobrenome))

  await buscarPor('')

  console.log('\n== restricao: a caixa que interrompe ==')

  /*
    Uma crianca pode ter anotacao que muda quem pode leva-la embora. E o maior
    risco juridico do projeto, e a mitigacao barata e esta: mostrar a anotacao
    ANTES da acao e exigir reconhecimento.

    O caso vem da SEMENTE (Ravi Bacelar, Pré 2). A primeira versao desta secao
    importava uma planilha com restricoes e devolvia o cadastro no fim — e uma
    execucao que morreu no meio deixou o servidor com dois alunos, fazendo TODAS
    as secoes seguintes falharem em rodadas posteriores, sem relacao aparente
    com o que elas testam. Teste que mexe no cadastro e teste que envenena os
    outros.
  */
  // Contagem absoluta exige ponto de partida conhecido.
  conferir('o quadro comeca vazio para a restricao', await esvaziarQuadro(outra))
  await esperar(500)

  await cdp.chamar('Page.navigate', { url: BASE + '/portaria/' })
  await esperar(2200)

  const buscarNa = async (texto) => {
    await cdp.chamar('Runtime.evaluate', {
      expression:
        '(() => { const c = document.getElementById(' +
        JSON.stringify('consulta') +
        '); c.value = ' +
        JSON.stringify(texto) +
        '; c.dispatchEvent(new Event(' +
        JSON.stringify('input') +
        ')) })()',
    })
    await esperar(450)
  }

  await buscarNa('ravi')
  const marcada = await cdp.avaliar(`
    (() => {
      const li = document.querySelector('#resultados .linha')
      const marca = li?.querySelector('.marca-restricao')
      return { existe: !!marca, texto: marca?.textContent ?? '' }
    })()
  `)
  conferir('a linha avisa que ha restricao ANTES do toque',
    marcada.existe === true && marcada.texto.length > 0, JSON.stringify(marcada))

  /*
    O texto da anotacao NAO pode estar no HTML da pagina antes do toque: ele so
    sai do servidor uma crianca por vez, quando alguem esta prestes a agir. Com
    o texto junto da lista, um tablet esquecido no balcao passaria a expor
    guarda e conflito de 292 familias em vez de nome e turma.
  */
  const noHtml = await cdp.avaliar(
    ` document.documentElement.innerHTML.includes('avó materna') `,
  )
  conferir('e o TEXTO da anotacao nao esta na pagina antes de alguem pedir',
    noHtml === false, String(noHtml))

  await cdp.chamar('Runtime.evaluate', {
    expression: ` document.querySelector('#resultados .linha button').click() `,
    userGesture: true,
  })
  await esperar(800)

  const caixa = await cdp.avaliar(`
    (() => {
      const d = document.querySelector('dialog.restricao')
      if (!d) return { existe: false }
      return {
        existe: true,
        aberta: d.open,
        texto: d.querySelector('.texto')?.textContent ?? '',
        quem: d.querySelector('.quem')?.textContent ?? '',
        focoNoVoltar: document.activeElement === d.querySelector('button'),
        emSaida: document.querySelectorAll('#ativas .linha').length,
      }
    })()
  `)
  conferir('tocar em Chamar abre a caixa', caixa.existe === true && caixa.aberta === true,
    JSON.stringify(caixa))
  conferir('a caixa mostra a anotacao inteira',
    /avó materna/.test(caixa.texto), JSON.stringify(caixa.texto))
  conferir('e diz de quem e, e o que vai acontecer',
    /Ravi/.test(caixa.quem) && /chamar/.test(caixa.quem), JSON.stringify(caixa.quem))
  conferir('o foco comeca no botao que NAO segue',
    caixa.focoNoVoltar === true, JSON.stringify(caixa))
  conferir('e NADA aconteceu ainda: a crianca nao foi chamada',
    caixa.emSaida === 0, 'em saida: ' + caixa.emSaida)

  await cdp.chamar('Runtime.evaluate', {
    expression:
      ` document.querySelector('dialog.restricao button').click() `,
    userGesture: true,
  })
  await esperar(700)
  const depoisDeVoltar = await cdp.avaliar(`
    (() => ({
      caixa: !!document.querySelector('dialog.restricao'),
      emSaida: document.querySelectorAll('#ativas .linha').length,
    }))()
  `)
  conferir('Voltar fecha a caixa e NAO chama a crianca',
    depoisDeVoltar.caixa === false && depoisDeVoltar.emSaida === 0,
    JSON.stringify(depoisDeVoltar))

  await cdp.chamar('Runtime.evaluate', {
    expression: ` document.querySelector('#resultados .linha button').click() `,
    userGesture: true,
  })
  await esperar(800)
  await cdp.chamar('Runtime.evaluate', {
    expression:
      ` document.querySelectorAll('dialog.restricao button')[1].click() `,
    userGesture: true,
  })
  await esperar(1000)
  const depoisDeSeguir = await cdp.avaliar(
    ` document.querySelectorAll('#ativas .linha').length `,
  )
  conferir('reconhecer a restricao deixa seguir', depoisDeSeguir === 1,
    'em saida: ' + depoisDeSeguir)

  // Crianca SEM restricao nao abre caixa nenhuma: caixa que aparece sempre e
  // caixa que ninguem le.
  await buscarNa('gael')
  await cdp.chamar('Runtime.evaluate', {
    expression: ` document.querySelector('#resultados .linha button').click() `,
    userGesture: true,
  })
  await esperar(900)
  const semRestricao = await cdp.avaliar(`
    (() => ({
      caixa: !!document.querySelector('dialog.restricao'),
      emSaida: document.querySelectorAll('#ativas .linha').length,
    }))()
  `)
  conferir('crianca sem restricao nao abre caixa',
    semRestricao.caixa === false && semRestricao.emSaida === 2,
    JSON.stringify(semRestricao))

  await esvaziarQuadro(outra)
  await esperar(400)

  console.log('\n== red team da fase 1 ==')

  /*
    A caixa de restricao fica aberta enquanto alguem LE — segundos, nao
    milissegundos. E a maior janela do app, e e nela que a secretaria pode
    reimportar a planilha. Com a lista trocada, o id que o botao guardou deixa
    de valer, e a restricao recem-lida pode nao ser mais a daquela crianca.
  */
  // Quadro vazio: com a crianca ja em saida nao ha botao Chamar para tocar, e
  // com alguem no quadro a reimportacao e recusada com 409 — o ataque nem
  // chegaria a acontecer, e as quatro verificacoes falhariam sem provar nada.
  conferir('o quadro comeca vazio para o ataque', await esvaziarQuadro(outra))
  await esperar(600)

  await cdp.chamar('Page.navigate', { url: BASE + '/portaria/' })
  await esperar(2200)

  await cdp.chamar('Runtime.evaluate', {
    expression:
      '(() => { const c = document.getElementById(' +
      JSON.stringify('consulta') +
      '); c.value = ' +
      JSON.stringify('ravi') +
      '; c.dispatchEvent(new Event(' +
      JSON.stringify('input') +
      ')) })()',
  })
  await esperar(500)

  await cdp.chamar('Runtime.evaluate', {
    expression: ` document.querySelector('#resultados .linha button').click() `,
    userGesture: true,
  })
  await esperar(800)

  const abriu = await cdp.avaliar(
    ` document.querySelector('dialog.restricao')?.open === true `,
  )
  conferir('a caixa esta aberta para o ataque', abriu === true)

  // Com a caixa aberta, outra pessoa reimporta a planilha.
  const cadastroAntes = await fetch(BASE + '/alunos', comoAparelho(TOKEN.portaria)).then((r) => r.json())
  const reimportou = await fetch(BASE + '/importar', { ...comoAparelho(TOKEN.portaria),
    method: 'POST',
    body:
      'Nome,Turma' +
      String.fromCharCode(10) +
      cadastroAntes.map((a) => a.nome + ',' + a.turma).join(String.fromCharCode(10)),
  })
  conferir('a reimportacao acontece com a caixa aberta', reimportou.status === 200,
    'status ' + reimportou.status)
  await esperar(1200)

  // A pessoa termina de ler e confirma.
  await cdp.chamar('Runtime.evaluate', {
    expression:
      ` document.querySelectorAll('dialog.restricao button')[1].click() `,
    userGesture: true,
  })
  await esperar(1200)

  const depoisDoAtaque = await cdp.avaliar(`
    (() => ({
      emSaida: document.querySelectorAll('#ativas .linha').length,
      aviso: document.querySelector('#aviso .aviso')?.textContent ?? '',
    }))()
  `)
  conferir('a crianca NAO e chamada com a lista trocada no meio',
    depoisDoAtaque.emSaida === 0, JSON.stringify(depoisDoAtaque))
  conferir('e a pessoa e avisada do porque',
    /lista mudou/i.test(depoisDoAtaque.aviso), JSON.stringify(depoisDoAtaque.aviso))

  await esvaziarQuadro(outra)
  await esperar(400)

  /*
    Devolve o cadastro COM a restricao.

    O ataque acima reimportou sem a coluna, e sem isto a proxima execucao
    encontraria o Ravi sem alerta — e a secao da restricao falharia inteira, com
    o sintoma tres secoes longe da causa. Ja aconteceu tres vezes nesta
    refatoracao: teste que mexe em estado compartilhado e teste que envenena os
    outros, e a conta chega depois.
  */
  const paraDevolver = await fetch(BASE + '/alunos', comoAparelho(TOKEN.portaria)).then((r) => r.json())
  const linhas = ['Nome,Turma,Restrição']
  for (const a of paraDevolver) {
    const restricao = a.nome === CRIANCA_COM_RESTRICAO ? RESTRICAO_DA_SEMENTE : ''
    linhas.push([a.nome, a.turma, restricao].join(','))
  }
  const devolvido = await fetch(BASE + '/importar', { ...comoAparelho(TOKEN.portaria),
    method: 'POST',
    body: linhas.join(String.fromCharCode(10)),
  })
  const conferindo = await fetch(BASE + '/alunos', comoAparelho(TOKEN.portaria)).then((r) => r.json())
  conferir(
    'o cadastro volta com a restricao, para a proxima execucao',
    devolvido.status === 200 &&
      conferindo.some((a) => a.nome === CRIANCA_COM_RESTRICAO && a.temAlerta === true),
    'status ' + devolvido.status,
  )

  /*
    E devolve as autorizacoes, que a reimportacao acima acabou de orfanar.

    O servidor avisa quantas se perderam — e o aviso e para a escola reimportar
    a segunda planilha. Aqui a "escola" e este bloco.
  */
  const linhasFamilia = ['Aluno,Turma,Responsavel,Vinculo,Telefone,Impedido']
  for (const f of FAMILIAS_DA_SEMENTE) linhasFamilia.push(f.join(','))

  const familiasDevolvidas = await fetch(BASE + '/importar-responsaveis', {
    method: 'POST',
    ...comoAparelho(TOKEN.portaria),
    body: linhasFamilia.join(String.fromCharCode(10)),
  })
  const corpoFamilias = familiasDevolvidas.ok
    ? await familiasDevolvidas.json()
    : { vinculos: 0 }
  conferir(
    'e as autorizacoes voltam, senao a proxima execucao entrega sem perguntar a quem',
    familiasDevolvidas.status === 200 && corpoFamilias.vinculos >= 7,
    JSON.stringify(corpoFamilias),
  )

  console.log('\n== a quem entregar: a caixa que pergunta ==')

  /*
    Ate a 2.1 a portaria tocava em "Entregar" e o ciclo fechava. A trilha
    registrava que a crianca saiu e nao registrava com quem.
  */
  conferir('o quadro comeca vazio para a entrega', await esvaziarQuadro(outra))
  await esperar(500)

  const todosAlunos = await fetch(BASE + '/alunos', comoAparelho(TOKEN.portaria)).then((r) =>
    r.json(),
  )
  const aliceDoTeste = todosAlunos.find((a) => a.nome === 'Alice Fernandes')

  const salaDaAlice = await ligarWs(TOKEN.sala(aliceDoTeste.turma))
  await esperar(400)
  outra.send(JSON.stringify({ tipo: 'chamar', alunoId: aliceDoTeste.id }))
  await esperar(500)
  salaDaAlice.send(JSON.stringify({ tipo: 'liberar', alunoId: aliceDoTeste.id }))
  await esperar(700)

  await cdp.chamar('Page.navigate', { url: BASE + '/portaria/' })
  await esperar(2200)

  const acharBotaoEntregar = `
    (() => {
      const alvo = [...document.querySelectorAll('#ativas .linha')].find(
        (li) => li.dataset.estado === 'liberado',
      )
      const b = [...(alvo?.querySelectorAll('button') ?? [])].find(
        (x) => x.textContent.trim() === 'Entregar',
      )
      if (b) b.click()
      return !!b
    })()
  `

  const tocou = await cdp.avaliar(acharBotaoEntregar)
  conferir('a linha liberada oferece Entregar', tocou === true)
  await esperar(900)

  const caixaEntrega = await cdp.avaliar(`
    (() => {
      const d = document.querySelector('dialog.entrega')
      if (!d) return { existe: false }
      const linhas = [...d.querySelectorAll('.responsavel')]
      return {
        existe: true,
        aberta: d.open,
        quem: d.querySelector('.quem')?.textContent ?? '',
        quantos: linhas.length,
        impedidos: linhas.filter((l) => l.classList.contains('impedido')).length,
        impedidoDesabilitado: linhas
          .filter((l) => l.classList.contains('impedido'))
          .every((l) => l.disabled),
        textoDoImpedido:
          linhas.find((l) => l.classList.contains('impedido'))?.textContent ?? '',
        emSaida: document.querySelectorAll('#ativas .linha').length,
      }
    })()
  `)

  conferir('tocar em Entregar abre a caixa de quem esta levando',
    caixaEntrega.existe === true && caixaEntrega.aberta === true,
    JSON.stringify(caixaEntrega))
  conferir('a caixa diz de qual crianca se trata',
    caixaEntrega.quem.includes('Alice'), JSON.stringify(caixaEntrega.quem))
  conferir('ela lista quem pode levar', caixaEntrega.quantos >= 2,
    JSON.stringify(caixaEntrega))
  conferir('o IMPEDIDO aparece na lista, e nao some',
    caixaEntrega.impedidos === 1, JSON.stringify(caixaEntrega))
  conferir('mas nao da para toca-lo', caixaEntrega.impedidoDesabilitado === true,
    JSON.stringify(caixaEntrega))
  conferir('e a linha dele DIZ que ele nao pode, em texto',
    /N[ÃA]O PODE LEVAR/.test(caixaEntrega.textoDoImpedido),
    JSON.stringify(caixaEntrega.textoDoImpedido))
  conferir('e NADA aconteceu ainda: a crianca continua no quadro',
    caixaEntrega.emSaida >= 1, JSON.stringify(caixaEntrega.emSaida))

  /*
    Escolher o autorizado leva a caixa dos irmaos — que existem porque o MESMO
    adulto pode levar outra crianca. E a 1.4, que o plano adiou ate existir
    este modelo.
  */
  await cdp.chamar('Runtime.evaluate', {
    expression: `
      [...document.querySelectorAll('dialog.entrega .responsavel')]
        .find((l) => !l.classList.contains('impedido'))
        .click()
    `,
    userGesture: true,
  })
  await esperar(1200)

  const comIrmaos = await cdp.avaliar(`
    (() => {
      const d = document.querySelector('dialog.entrega')
      if (!d) return { caixaFechou: true }
      return {
        caixaFechou: false,
        irmaosVisiveis: d.querySelector('.irmaos')?.hidden === false,
        quantos: d.querySelectorAll('.irmao').length,
        texto: d.querySelector('.irmaos p')?.textContent ?? '',
      }
    })()
  `)
  conferir('escolher o adulto oferece os irmaos que ele tambem pode levar',
    comIrmaos.caixaFechou === false && comIrmaos.irmaosVisiveis === true &&
      comIrmaos.quantos >= 1,
    JSON.stringify(comIrmaos))
  conferir('e o texto explica de quem sao', /tamb[eé]m pode levar/.test(comIrmaos.texto),
    JSON.stringify(comIrmaos.texto))

  // Confirma sem marcar irmao nenhum: entrega so a crianca.
  await cdp.chamar('Runtime.evaluate', {
    expression: `
      [...document.querySelectorAll('dialog.entrega button')]
        .find((b) => b.textContent.trim() === 'Entregar')
        .click()
    `,
    userGesture: true,
  })
  await esperar(1200)

  const depoisDaEntrega = await cdp.avaliar(`
    (() => ({
      caixa: !!document.querySelector('dialog.entrega'),
      emSaida: document.querySelectorAll('#ativas .linha').length,
    }))()
  `)
  conferir('a caixa fecha e a crianca sai do quadro',
    depoisDaEntrega.caixa === false && depoisDaEntrega.emSaida === 0,
    JSON.stringify(depoisDaEntrega))

  const trilhaDaTela = await fetch(BASE + '/registro', comoAparelho(TOKEN.portaria)).then((r) =>
    r.json(),
  )
  const ultimaEntrega = trilhaDaTela.filter((e) => e.acao === 'entregar').at(-1)
  conferir('e a trilha guarda o nome de quem recebeu',
    (ultimaEntrega?.responsavelNome ?? '').length > 0,
    JSON.stringify(ultimaEntrega?.responsavelNome))

  salaDaAlice.close()
  await esperar(300)

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
