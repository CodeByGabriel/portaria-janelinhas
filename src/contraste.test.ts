import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/*
  Contraste como portao automatico, nao como inspecao manual.

  A baseline de 01/09/2026 mediu cinco pares reprovando, e o pior era o botao
  "Aguardando no portao" a 2,12 — menos da metade do minimo, no estado que
  confirma a professora que ela ja fez a parte dela. Nenhum deles apareceu em
  revisao visual, porque contraste ruim nao PARECE quebrado; parece discreto.

  Este teste le o tokens.css de verdade e recalcula. Uma cor nova que reprove
  derruba o `npm test` antes de chegar na escola.
*/

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const CSS = readFileSync(join(RAIZ, 'web', 'comum', 'tokens.css'), 'utf8')

/** Le as custom properties do :root, resolvendo var() de um nivel. */
function tokens(): Map<string, string> {
  const bruto = new Map<string, string>()
  for (const linha of CSS.split('\n')) {
    const m = linha.match(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/i)
    if (m) bruto.set(m[1], m[2].trim())
  }
  const resolvido = new Map<string, string>()
  for (const [chave, valor] of bruto) {
    let v = valor
    for (let i = 0; i < 5 && v.startsWith('var('); i++) {
      const alvo = v.slice(4, -1).trim()
      v = bruto.get(alvo) ?? v
      if (v === valor) break
    }
    resolvido.set(chave, v)
  }
  return resolvido
}

const T = tokens()

function cor(nome: string): string {
  const v = T.get(nome)
  assert.ok(v, `token ${nome} nao existe em tokens.css`)
  assert.match(v!, /^#[0-9a-f]{6}$/i, `token ${nome} nao resolveu para hex: "${v}"`)
  return v!
}

function canais(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}

function luminancia(hex: string): number {
  const [r, g, b] = canais(hex).map((c) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Razao de contraste do WCAG 2.2. */
export function contraste(a: string, b: string): number {
  const la = luminancia(a)
  const lb = luminancia(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Remove comentarios de bloco e de linha, para asserções sobre CODIGO. */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const TEXTO = 4.5 // WCAG 1.4.3
const NAO_TEXTO = 3.0 // WCAG 1.4.11

const ESTADOS = ['aguardando', 'chamado', 'liberado', 'entregue', 'retorno'] as const

test('todo estado tem token de cor e de fundo', () => {
  for (const e of ESTADOS) {
    cor(`--estado-${e}`)
    cor(`--estado-${e}-fundo`)
  }
})

test('a cor de cada estado serve como TEXTO sobre o fundo da pagina', () => {
  for (const e of ESTADOS) {
    const r = contraste(cor(`--estado-${e}`), cor('--fundo'))
    assert.ok(r >= TEXTO, `${e}: ${r.toFixed(2)} < ${TEXTO}`)
  }
})

test('a cor de cada estado serve como TEXTO sobre o cartao', () => {
  for (const e of ESTADOS) {
    const r = contraste(cor(`--estado-${e}`), cor('--superficie'))
    assert.ok(r >= TEXTO, `${e}: ${r.toFixed(2)} < ${TEXTO}`)
  }
})

test('a etiqueta de cada estado le sobre o proprio fundo', () => {
  for (const e of ESTADOS) {
    const r = contraste(cor(`--estado-${e}`), cor(`--estado-${e}-fundo`))
    assert.ok(r >= TEXTO, `etiqueta ${e}: ${r.toFixed(2)} < ${TEXTO}`)
  }
})

test('a faixa lateral de cada estado passa como NAO-TEXTO', () => {
  for (const e of ESTADOS) {
    const r = contraste(cor(`--estado-${e}`), cor('--superficie'))
    assert.ok(r >= NAO_TEXTO, `faixa ${e}: ${r.toFixed(2)} < ${NAO_TEXTO}`)
  }
})

test('REGRESSAO: --tinta-fraca voltou a ser legivel', () => {
  // Era #78857f: 3,54 sobre o fundo e 3,85 sobre o cartao. Carrega a turma no
  // cartao, o detalhe na linha e o aviso de truncamento da busca.
  assert.ok(contraste(cor('--tinta-fraca'), cor('--fundo')) >= TEXTO)
  assert.ok(contraste(cor('--tinta-fraca'), cor('--superficie')) >= TEXTO)
})

test('REGRESSAO: o botao desabilitado nao usa mais opacity', () => {
  // opacity no elemento inteiro compunha texto E fundo contra a pagina, e
  // derrubava o par para 2,12. Agora sao dois tokens proprios.
  const r = contraste(cor('--apagado-tinta'), cor('--apagado-fundo'))
  assert.ok(r >= TEXTO, `botao desabilitado: ${r.toFixed(2)} < ${TEXTO}`)
  assert.doesNotMatch(
    CSS,
    /button:disabled\s*\{[^}]*opacity/,
    'button:disabled voltou a usar opacity',
  )
})

test('o texto principal e o secundario passam nas duas superficies', () => {
  for (const t of ['--tinta', '--tinta-media', '--tinta-fraca']) {
    for (const f of ['--fundo', '--superficie']) {
      const r = contraste(cor(t), cor(f))
      assert.ok(r >= TEXTO, `${t} sobre ${f}: ${r.toFixed(2)} < ${TEXTO}`)
    }
  }
})

test('branco sobre a marca passa (cabecalho e botao principal)', () => {
  assert.ok(contraste(cor('--tinta-clara'), cor('--marca')) >= TEXTO)
  assert.ok(contraste(cor('--tinta-clara'), cor('--marca-escura')) >= TEXTO)
})

test('o alvo de toque declarado atende o nivel AAA', () => {
  const v = T.get('--toque-min')
  assert.ok(v, '--toque-min nao existe')
  assert.ok(Number.parseInt(v!, 10) >= 44, `--toque-min e ${v}, abaixo de 44px`)
  assert.match(CSS, /button\s*\{[^}]*min-height:\s*var\(--toque-min\)/,
    'button nao aplica min-height: var(--toque-min)')
})

test('REGRESSAO: nenhum estado fica sem rotulo textual', () => {
  // `aguardando` era string vazia e a etiqueta ficava hidden: o estado era
  // comunicado pela AUSENCIA de etiqueta, que e cor/ausencia apenas.
  const componente = readFileSync(join(RAIZ, 'web', 'comum', 'cartao.js'), 'utf8')
  const bloco = componente.match(/const ROTULO = \{([\s\S]*?)\}/)
  assert.ok(bloco, 'nao achei o mapa ROTULO em cartao.js')
  for (const e of ESTADOS) {
    // Tipo explicito: sem ele o TS entra em ciclo com o assert.ok logo abaixo
    // (TS7022) e o typecheck quebra, ainda que o teste passe.
    const linha: string | undefined = bloco![1]
      .split('\n')
      .find((l) => l.trim().startsWith(`${e}:`))
    assert.ok(linha, `estado ${e} nao aparece no ROTULO`)
    const texto: string | undefined = linha!.split(':')[1]?.trim().replace(/^['"]|['"],?$/g, '')
    assert.ok(texto && texto.length > 0, `estado ${e} tem rotulo vazio`)
  }
})

test('REGRESSAO: nenhum estado fica sem icone', () => {
  const componente = readFileSync(join(RAIZ, 'web', 'comum', 'cartao.js'), 'utf8')
  const bloco = componente.match(/const ICONE = \{([\s\S]*?)^\}/m)
  assert.ok(bloco, 'nao achei o mapa ICONE em cartao.js')
  for (const e of ESTADOS) {
    assert.match(bloco![1], new RegExp(`\\b${e}:`), `estado ${e} nao tem icone`)
  }
})

test('REGRESSAO: o desabilitado vence as variantes de botao na cascata', () => {
  // `button:disabled` e `button.principal` tem a MESMA especificidade (0,1,1).
  // Quem vem depois no arquivo ganha. Com o bloco do desabilitado escrito antes,
  // os tokens estavam certos, este arquivo passava inteiro, e na tela o botao
  // "Aguardando no portao" continuava verde-cheio. O teste de cor nao pega
  // cascata: ele mede o que foi declarado, nao o que vence.
  const desabilitado = CSS.indexOf('button:disabled')
  const principal = CSS.indexOf('button.principal')
  assert.ok(desabilitado > 0, 'nao achei a regra button:disabled')
  assert.ok(principal > 0, 'nao achei a regra button.principal')
  assert.ok(
    desabilitado > principal,
    'button:disabled vem antes de button.principal e perde a cascata',
  )
})

test('REGRESSAO: a faixa de cada estado tem desenho proprio, nao so cor', () => {
  /*
    A primeira versao da faixa so trocava a COR, e o comentario no CSS afirmava
    que ela dava "posicao e espessura" a quem nao distingue matiz. A captura em
    docs/prints/fase-0/deuteranopia/sala.png desmentiu: as faixas de `chamado` e
    `liberado`, lado a lado, viraram o mesmo oliva. Cinco tracos com o mesmo
    desenho nao sao um quarto canal — sao o primeiro, desenhado maior.

    Aqui o par (estilo, espessura) tem que ser unico por estado, para a faixa
    continuar separando os estados numa tela sem cor nenhuma.
  */
  const vistos = new Map<string, string>()
  for (const e of ESTADOS) {
    const abre = CSS.indexOf(`.linha[data-estado='${e}'] {`)
    assert.ok(abre > 0, `nao achei o bloco da faixa de ${e}`)
    const fecha = CSS.indexOf('}', abre)
    const corpo = CSS.slice(abre, fecha)

    const estilo = corpo.match(/border-left-style:\s*([a-z]+)/)?.[1] ?? 'solid'
    const espessura = corpo.match(/border-left-width:\s*(\d+)px/)?.[1] ?? '6'
    const desenho = `${estilo}/${espessura}px`

    const gemeo = vistos.get(desenho)
    assert.ok(
      !gemeo,
      `${e} e ${gemeo} desenham a faixa igual (${desenho}); sem cor viram uma so`,
    )
    vistos.set(desenho, e)
  }
})

test('o aviso de som interrompido le sobre o proprio fundo', () => {
  // Ele se destaca por luminancia, nao por matiz — nao empresta a cor de
  // nenhum estado de aluno. Mas inversao so vale se o texto continuar legivel.
  const r = contraste(cor('--tinta-clara'), cor('--tinta'))
  assert.ok(r >= TEXTO, `aviso de som: ${r.toFixed(2)} < ${TEXTO}`)
  assert.match(
    CSS,
    /\.faixa\.aviso\s*\{[^}]*background:\s*var\(--tinta\)/,
    '.faixa.aviso deixou de usar o fundo escuro',
  )
})

test('REGRESSAO: o som confere o ESTADO do contexto, nao so a existencia', () => {
  /*
    `tocarAbertura()` testava `!contexto`. Depois do primeiro gesto o objeto
    existe para sempre, mas o sistema pode suspende-lo — aba em segundo plano,
    ligacao, tela bloqueada. A funcao rodava inteira, agendava as notas num
    contexto parado, e nao saia som nenhum, sem nada na tela dizendo isso.
    A professora ficava esperando o aviso com o responsavel parado no portao.
  */
  // Sem os comentarios: o texto que EXPLICA a guarda antiga cita a guarda
  // antiga, e a primeira versao deste teste reprovou o proprio comentario.
  const som = semComentarios(
    readFileSync(join(RAIZ, 'web', 'comum', 'som.js'), 'utf8'),
  )
  assert.match(som, /contexto\.state === 'running'/,
    'som.js nao confere se o contexto esta rodando antes de agendar')
  assert.match(som, /contexto\.resume\(\)/,
    'som.js nao tenta reativar um contexto suspenso')
  assert.doesNotMatch(som, /if \(mudo \|\| !contexto\) return/,
    'a guarda cega `mudo || !contexto` voltou')
})

test('REGRESSAO: o mudo sobrevive ao recarregamento', () => {
  // Sem isto a professora silenciava a sala e o proximo F5 devolvia o som,
  // no meio do turno, com a turma inteira em aula.
  const som = semComentarios(
    readFileSync(join(RAIZ, 'web', 'comum', 'som.js'), 'utf8'),
  )
  assert.match(som, /localStorage\.setItem/, 'o mudo nao e guardado')
  assert.match(som, /localStorage\.getItem/, 'o mudo nao e lido na abertura')
  // localStorage lanca em aba com armazenamento bloqueado; o padrao de falha
  // tem que ser SOM LIGADO, nunca uma sala que emudece sozinha.
  assert.match(som, /catch \{\s*\n\s*return false/,
    'a falha de localStorage nao cai em som ligado')
})

test('REGRESSAO: o botao de mudo diz o estado para leitor de tela', () => {
  const sala = readFileSync(join(RAIZ, 'web', 'sala', 'index.html'), 'utf8')
  assert.match(sala, /id="mudo"[^>]*aria-pressed/, 'o botao de mudo nao tem aria-pressed')
  assert.match(sala, /setAttribute\('aria-pressed'/, 'aria-pressed nunca e atualizado')
})

/*
  A especificacao do som, virada em portao.

  Frequencia e duracao sao numeros que ninguem confere de ouvido — 392 Hz e
  660 Hz soam "parecido" numa revisao, e a diferenca so aparece com vinte
  criancas falando na sala. Entao a faixa util fica escrita aqui.
*/

/** Le os pares de notas declarados em som.js. */
function notasDe(fonte: string, nome: string): number[][] {
  const bloco = fonte.match(new RegExp(`const ${nome} = \\[([^\\]]*(?:\\][^=]*?)*?)\\]\\n`))
  const cru = bloco?.[1] ?? ''
  return [...cru.matchAll(/\[([^\]]+)\]/g)].map((m) =>
    m[1].split(',').map((n) => Number.parseFloat(n.trim())),
  )
}

const SOM = readFileSync(join(RAIZ, 'web', 'comum', 'som.js'), 'utf8')

test('os dois toques ficam na faixa que atravessa uma sala com criancas', () => {
  // Abaixo de 600 Hz o som se perde no ruido de vinte vozes; acima de 2 kHz
  // fica estridente para quem ouve dezenas de vezes por tarde.
  for (const nome of ['ABERTURA', 'ENTREGA']) {
    const notas = notasDe(SOM, nome)
    assert.ok(notas.length >= 2, `${nome} precisa de fundamental e quinta`)
    for (const [frequencia] of notas) {
      assert.ok(
        frequencia >= 600 && frequencia <= 2000,
        `${nome}: ${frequencia} Hz fora da faixa de 600 a 2000`,
      )
    }
  }
})

test('cada toque dura entre 250 ms e 1 s', () => {
  // Menos que isso nao registra com barulho de fundo; mais que isso ainda esta
  // tocando quando a professora ja olhou.
  for (const nome of ['ABERTURA', 'ENTREGA']) {
    const notas = notasDe(SOM, nome)
    const fim = Math.max(...notas.map(([, atraso, duracao]) => atraso + duracao))
    assert.ok(fim >= 0.25, `${nome} dura ${fim}s, curto demais`)
    assert.ok(fim <= 1.0, `${nome} dura ${fim}s, longo demais`)
  }
})

test('as duas notas de cada toque formam uma quinta justa', () => {
  // Consonante de proposito: nao vira musiquinha que a turma imita, nao vira
  // alarme, e duas chamadas quase simultaneas nao produzem batimento aspero.
  for (const nome of ['ABERTURA', 'ENTREGA']) {
    const [a, b] = notasDe(SOM, nome).map(([f]) => f)
    const razao = Math.max(a, b) / Math.min(a, b)
    assert.ok(
      Math.abs(razao - 1.5) < 0.01,
      `${nome}: razao ${razao.toFixed(3)}, esperava 1,5 (quinta justa)`,
    )
  }
})

test('abertura sobe e entrega desce, com as mesmas duas notas', () => {
  // A sala aprende um par de sons, nao quatro, e a direcao carrega o sentido.
  const abertura = notasDe(SOM, 'ABERTURA').map(([f]) => f)
  const entrega = notasDe(SOM, 'ENTREGA').map(([f]) => f)
  assert.ok(abertura[1] > abertura[0], 'a abertura precisa subir')
  assert.ok(entrega[1] < entrega[0], 'a entrega precisa descer')
  assert.deepEqual([...abertura].sort(), [...entrega].sort())
})

test('REGRESSAO: o volume tem degraus e sobrevive ao recarregamento', () => {
  const som = semComentarios(SOM)
  assert.match(som, /const VOLUMES = \{/, 'nao ha degraus de volume declarados')
  assert.match(som, /janelinhas:volume/, 'o volume nao tem chave de armazenamento')
  assert.match(som, /localStorage\.setItem\(CHAVE_VOLUME/, 'o volume nao e guardado')
  // Degrau adulterado viraria NaN no ganho, e o oscilador falha em silencio.
  assert.match(som, /v in VOLUMES \? v : VOLUME_PADRAO/, 'o degrau lido nao e validado')
})

test('REGRESSAO: o primeiro retrato desenha mas nao toca', () => {
  /*
    O primeiro retrato e a fotografia do que ja estava acontecendo antes desta
    tela existir — um F5 no meio da saida, ou a reconexao depois de o wifi
    cair. Sem a guarda, recarregar com quatro criancas na fila disparava quatro
    sinos de uma vez, e nenhum correspondia a alguem que acabou de chegar.
    Som que toca quando nada aconteceu ensina a professora a ignorar o som.
  */
  const sala = readFileSync(join(RAIZ, 'web', 'sala', 'index.html'), 'utf8')
  assert.match(sala, /if \(!primeiro\) tocarAbertura\(\)/,
    'a abertura toca no primeiro retrato')
  assert.match(sala, /=== 'liberado' && !primeiro/,
    'a entrega toca no primeiro retrato')
})
