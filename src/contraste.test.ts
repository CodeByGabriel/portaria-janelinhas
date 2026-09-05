import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/*
  Contraste como portao automatico, nao como inspecao manual.

  A baseline de 01/09/2026 mediu cinco pares reprovando, e o pior era o botao
  "Aguardando no portao" a 2,12. Nenhum deles apareceu em revisao visual,
  porque contraste ruim nao PARECE quebrado; parece discreto.

  Este teste le o tokens.css de verdade e recalcula. Uma cor nova que reprove
  derruba o `npm test` antes de chegar na escola.

  Nomes de token do Pátio refinado: --papel/--cartao/--destaque (superficies),
  --tinta/--tinta-2/--tinta-3 (tinta), --acao (a unica cor de acao),
  --estado-* (cinco), --alerta, --apagado-*. Os apelidos antigos continuam no
  CSS ate a ultima tela migrar, mas o teste ja cobra os novos.
*/

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const CSS = readFileSync(join(RAIZ, 'web', 'comum', 'tokens.css'), 'utf8')

/** Le as custom properties do :root, resolvendo var() de ate cinco niveis. */
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
      const proximo = bruto.get(alvo)
      if (!proximo) break
      v = proximo
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

/*
  Distancia perceptual sob daltonismo.

  Simulacao de Machado et al. (2009), severidade 1,0, seguida de CIELAB e ΔE76.
  Os numeros sao os mesmos que estao anotados no tokens.css; o teste existe
  para que ninguem troque uma cor de estado por outra "parecida" sem ver o par
  colapsar. Terracota e vermelho, por exemplo, colapsam a 20.
*/
const MACHADO = {
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
} as const

function linear(hex: string): number[] {
  return canais(hex).map((c) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  })
}

function simular(hex: string, tipo: keyof typeof MACHADO): number[] {
  const l = linear(hex)
  return MACHADO[tipo].map((linha) =>
    Math.min(1, Math.max(0, linha[0] * l[0] + linha[1] * l[1] + linha[2] * l[2])),
  )
}

function lab([r, g, b]: number[]): number[] {
  let x = r * 0.4124 + g * 0.3576 + b * 0.1805
  let y = r * 0.2126 + g * 0.7152 + b * 0.0722
  let z = r * 0.0193 + g * 0.1192 + b * 0.9505
  x /= 0.95047
  z /= 1.08883
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const fx = f(x), fy = f(y), fz = f(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

export function distanciaDaltonica(a: string, b: string, tipo: keyof typeof MACHADO): number {
  const la = lab(simular(a, tipo))
  const lb = lab(simular(b, tipo))
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2])
}

/** Remove comentarios de bloco e de linha, para asserções sobre CODIGO. */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const TEXTO = 4.5 // WCAG 1.4.3
const NAO_TEXTO = 3.0 // WCAG 1.4.11

const ESTADOS = ['aguardando', 'chamado', 'liberado', 'entregue', 'retorno'] as const
const SUPERFICIES = ['--papel', '--cartao'] as const

test('todo estado tem token de cor', () => {
  for (const e of ESTADOS) cor(`--estado-${e}`)
})

test('a cor de cada estado serve como TEXTO sobre o papel e sobre o cartao', () => {
  for (const e of ESTADOS) {
    for (const s of SUPERFICIES) {
      const r = contraste(cor(`--estado-${e}`), cor(s))
      assert.ok(r >= TEXTO, `${e} sobre ${s}: ${r.toFixed(2)} < ${TEXTO}`)
    }
  }
})

test('a cor de cada estado ainda le sobre o destaque (hover, campo)', () => {
  for (const e of ESTADOS) {
    const r = contraste(cor(`--estado-${e}`), cor('--destaque'))
    assert.ok(r >= TEXTO, `${e} sobre --destaque: ${r.toFixed(2)} < ${TEXTO}`)
  }
})

test('a faixa lateral de cada estado passa como NAO-TEXTO', () => {
  for (const e of ESTADOS) {
    const r = contraste(cor(`--estado-${e}`), cor('--cartao'))
    assert.ok(r >= NAO_TEXTO, `faixa ${e}: ${r.toFixed(2)} < ${NAO_TEXTO}`)
  }
})

test('a faixa de chamada da sala: branco sobre a cor de chamado', () => {
  // E o unico lugar em que uma cor de estado vira FUNDO.
  const r = contraste(cor('--tinta-clara'), cor('--estado-chamado'))
  assert.ok(r >= TEXTO, `faixa de chamada: ${r.toFixed(2)} < ${TEXTO}`)
})

test('REGRESSAO: os fundos pastel de estado nao voltaram', () => {
  // Cinco tints lado a lado eram cor sem trabalho, e colapsavam sob daltonismo
  // antes das cores cheias. O estado se apresenta por icone + rotulo + faixa.
  for (const e of ESTADOS) {
    assert.ok(!T.has(`--estado-${e}-fundo`), `--estado-${e}-fundo voltou ao tokens.css`)
  }
})

test('nenhuma cor de estado se parece com a cor de acao', () => {
  /*
    Botao verde ao lado de estado verde destroi o sistema de estados — foi o
    motivo de `liberado` deixar de ser verde (ΔE 16 sob deuteranopia contra a
    acao). Cor de acao e cor de estado nao podem colidir.

    Piso em 18, nao em 20: acao/chamado sob protanopia mede exatamente 18, e
    nao ha terracota mais clara que passe 4,5 sobre o papel. E o unico par
    abaixo de 30, e os dois nunca se apresentam do mesmo jeito — a acao e
    sempre um botao preenchido com texto branco; chamado e texto, icone e
    faixa lateral. Se alguem escurecer a acao ou clarear a terracota, este
    numero cai e o teste avisa.
  */
  const acao = cor('--acao')
  for (const e of ESTADOS) {
    if (e === 'aguardando') continue // nunca aparece ao lado de um botao
    const c = cor(`--estado-${e}`)
    for (const tipo of ['deuteranopia', 'protanopia'] as const) {
      const d = distanciaDaltonica(acao, c, tipo)
      assert.ok(d >= 18, `acao vs ${e} sob ${tipo}: ΔE ${d.toFixed(0)} < 18`)
    }
  }
})

test('estados adjacentes no fluxo se separam sob daltonismo', () => {
  /*
    Pares que aparecem lado a lado na mesma tela. O minimo e 20 — a distancia
    em que terracota e vermelho ja colapsavam. liberado/retorno fica em 22 sob
    deuteranopia e e o par mais fraco possivel com cinco cores texto-seguras;
    o icone e a faixa carregam o resto.
  */
  const PARES: Array<[string, string]> = [
    ['chamado', 'liberado'],
    ['liberado', 'entregue'],
    ['liberado', 'retorno'],
    ['retorno', 'chamado'],
    ['entregue', 'retorno'],
  ]
  for (const [a, b] of PARES) {
    for (const tipo of ['deuteranopia', 'protanopia'] as const) {
      const d = distanciaDaltonica(cor(`--estado-${a}`), cor(`--estado-${b}`), tipo)
      assert.ok(d >= 20, `${a}/${b} sob ${tipo}: ΔE ${d.toFixed(0)} < 20`)
    }
  }
})

test('o texto principal e o secundario passam nas duas superficies', () => {
  for (const t of ['--tinta', '--tinta-2']) {
    for (const f of SUPERFICIES) {
      const r = contraste(cor(t), cor(f))
      assert.ok(r >= TEXTO, `${t} sobre ${f}: ${r.toFixed(2)} < ${TEXTO}`)
    }
  }
})

test('a tinta fraca so serve para borda, e passa como componente', () => {
  // --tinta-3 e a borda de campo e o retrato tracejado. Nunca texto.
  const r = contraste(cor('--tinta-3'), cor('--cartao'))
  assert.ok(r >= NAO_TEXTO, `--tinta-3 sobre cartao: ${r.toFixed(2)} < ${NAO_TEXTO}`)
})

test('branco sobre a acao passa (botao principal)', () => {
  assert.ok(contraste(cor('--tinta-clara'), cor('--acao')) >= TEXTO)
  assert.ok(contraste(cor('--tinta-clara'), cor('--acao-pressionada')) >= TEXTO)
})

test('o alerta de restricao le sobre o cartao e se afasta da terracota', () => {
  assert.ok(contraste(cor('--alerta'), cor('--cartao')) >= TEXTO)
  // O vermelho anterior colapsava com `chamado` sob deuteranopia.
  for (const tipo of ['deuteranopia', 'protanopia'] as const) {
    const d = distanciaDaltonica(cor('--alerta'), cor('--estado-chamado'), tipo)
    assert.ok(d >= 20, `alerta vs chamado sob ${tipo}: ΔE ${d.toFixed(0)} < 20`)
  }
})

test('REGRESSAO: o botao desabilitado nao usa mais opacity', () => {
  const r = contraste(cor('--apagado-tinta'), cor('--apagado-fundo'))
  assert.ok(r >= TEXTO, `botao desabilitado: ${r.toFixed(2)} < ${TEXTO}`)
  assert.doesNotMatch(CSS, /button:disabled\s*\{[^}]*opacity/, 'button:disabled voltou a usar opacity')
})

test('REGRESSAO: cartao sem sombra, sem gradiente', () => {
  const codigo = semComentarios(CSS)
  assert.doesNotMatch(codigo, /box-shadow/, 'box-shadow voltou ao tokens.css')
  assert.doesNotMatch(codigo, /gradient\(/, 'gradiente voltou ao tokens.css')
  // A etiqueta nao e mais pilula.
  assert.doesNotMatch(codigo, /\.etiqueta\s*\{[^}]*border-radius:\s*999px/, 'a etiqueta voltou a ser pilula')
})

test('o alvo de toque declarado atende o nivel AAA', () => {
  const v = T.get('--toque-min')
  assert.ok(v, '--toque-min nao existe')
  assert.ok(Number.parseInt(v!, 10) >= 44, `--toque-min e ${v}, abaixo de 44px`)
  assert.match(CSS, /button\s*\{[^}]*min-height:\s*var\(--toque-min\)/, 'button nao aplica min-height: var(--toque-min)')
  const bloco = CSS.slice(CSS.indexOf('select,'))
  assert.match(
    bloco.slice(0, bloco.indexOf('}')),
    /min-height:\s*var\(--toque-min\)/,
    'os campos e selects nao aplicam min-height: var(--toque-min)',
  )
})

test('REGRESSAO: nenhum estado fica sem rotulo textual', () => {
  const componente = readFileSync(join(RAIZ, 'web', 'comum', 'cartao.js'), 'utf8')
  const bloco = componente.match(/const ROTULO = \{([\s\S]*?)\}/)
  assert.ok(bloco, 'nao achei o mapa ROTULO em cartao.js')
  for (const e of ESTADOS) {
    const linha: string | undefined = bloco![1].split('\n').find((l) => l.trim().startsWith(`${e}:`))
    assert.ok(linha, `estado ${e} nao aparece no ROTULO`)
    const texto: string | undefined = linha!.split(':')[1]?.trim().replace(/^['"]|['"],?$/g, '')
    assert.ok(texto && texto.length > 0, `estado ${e} tem rotulo vazio`)
  }
})

test('REGRESSAO: nenhum estado fica sem icone, e nenhum icone se repete', () => {
  const componente = readFileSync(join(RAIZ, 'web', 'comum', 'cartao.js'), 'utf8')
  const bloco = componente.match(/const ICONE = \{([\s\S]*?)^\}/m)
  assert.ok(bloco, 'nao achei o mapa ICONE em cartao.js')
  const vistos = new Map<string, string>()
  for (const e of ESTADOS) {
    const linha: string | undefined = bloco![1].split('\n').find((l) => l.trim().startsWith(`${e}:`))
    assert.ok(linha, `estado ${e} nao tem icone`)
    const desenho = linha!.slice(linha!.indexOf('[')).replace(/\s/g, '')
    const gemeo = vistos.get(desenho)
    assert.ok(!gemeo, `${e} e ${gemeo} usam o mesmo icone`)
    vistos.set(desenho, e)
  }
})

test('REGRESSAO: o desabilitado vence as variantes de botao na cascata', () => {
  const desabilitado = CSS.indexOf('button:disabled')
  const principal = CSS.indexOf('button.principal')
  assert.ok(desabilitado > 0, 'nao achei a regra button:disabled')
  assert.ok(principal > 0, 'nao achei a regra button.principal')
  assert.ok(desabilitado > principal, 'button:disabled vem antes de button.principal e perde a cascata')
})

test('REGRESSAO: a faixa de cada estado tem desenho proprio, nao so cor', () => {
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
    assert.ok(!gemeo, `${e} e ${gemeo} desenham a faixa igual (${desenho}); sem cor viram uma so`)
    vistos.set(desenho, e)
  }
})

test('o aviso de som interrompido le sobre o proprio fundo', () => {
  const r = contraste(cor('--tinta-clara'), cor('--tinta'))
  assert.ok(r >= TEXTO, `aviso de som: ${r.toFixed(2)} < ${TEXTO}`)
  assert.match(CSS, /\.faixa\.aviso\s*\{[^}]*background:\s*var\(--tinta\)/, '.faixa.aviso deixou de usar o fundo escuro')
})

test('REGRESSAO: o som confere o ESTADO do contexto, nao so a existencia', () => {
  const som = semComentarios(readFileSync(join(RAIZ, 'web', 'comum', 'som.js'), 'utf8'))
  assert.match(som, /contexto\.state === 'running'/, 'som.js nao confere se o contexto esta rodando antes de agendar')
  assert.match(som, /contexto\.resume\(\)/, 'som.js nao tenta reativar um contexto suspenso')
  assert.doesNotMatch(som, /if \(mudo \|\| !contexto\) return/, 'a guarda cega `mudo || !contexto` voltou')
})

test('REGRESSAO: o mudo sobrevive ao recarregamento', () => {
  const som = semComentarios(readFileSync(join(RAIZ, 'web', 'comum', 'som.js'), 'utf8'))
  assert.match(som, /localStorage\.setItem/, 'o mudo nao e guardado')
  assert.match(som, /localStorage\.getItem/, 'o mudo nao e lido na abertura')
  assert.match(som, /catch \{\s*\n\s*return false/, 'a falha de localStorage nao cai em som ligado')
})

test('REGRESSAO: o botao de mudo diz o estado para leitor de tela', () => {
  const sala = readFileSync(join(RAIZ, 'web', 'sala', 'index.html'), 'utf8')
  assert.match(sala, /id="mudo"[^>]*aria-pressed/, 'o botao de mudo nao tem aria-pressed')
  assert.match(sala, /setAttribute\('aria-pressed'/, 'aria-pressed nunca e atualizado')
})

/** Le os pares de notas declarados em som.js. */
function notasDe(fonte: string, nome: string): number[][] {
  const bloco = fonte.match(new RegExp(`const ${nome} = \\[([^\\]]*(?:\\][^=]*?)*?)\\]\\n`))
  const cru = bloco?.[1] ?? ''
  return [...cru.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].split(',').map((n) => Number.parseFloat(n.trim())))
}

const SOM = readFileSync(join(RAIZ, 'web', 'comum', 'som.js'), 'utf8')

test('os dois toques ficam na faixa que atravessa uma sala com criancas', () => {
  for (const nome of ['ABERTURA', 'ENTREGA']) {
    const notas = notasDe(SOM, nome)
    assert.ok(notas.length >= 2, `${nome} precisa de fundamental e quinta`)
    for (const [frequencia] of notas) {
      assert.ok(frequencia >= 600 && frequencia <= 2000, `${nome}: ${frequencia} Hz fora da faixa de 600 a 2000`)
    }
  }
})

test('cada toque dura entre 250 ms e 1 s', () => {
  for (const nome of ['ABERTURA', 'ENTREGA']) {
    const notas = notasDe(SOM, nome)
    const fim = Math.max(...notas.map(([, atraso, duracao]) => atraso + duracao))
    assert.ok(fim >= 0.25, `${nome} dura ${fim}s, curto demais`)
    assert.ok(fim <= 1.0, `${nome} dura ${fim}s, longo demais`)
  }
})

test('as duas notas de cada toque formam uma quinta justa', () => {
  for (const nome of ['ABERTURA', 'ENTREGA']) {
    const [a, b] = notasDe(SOM, nome).map(([f]) => f)
    const razao = Math.max(a, b) / Math.min(a, b)
    assert.ok(Math.abs(razao - 1.5) < 0.01, `${nome}: razao ${razao.toFixed(3)}, esperava 1,5 (quinta justa)`)
  }
})

test('abertura sobe e entrega desce, com as mesmas duas notas', () => {
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
  assert.match(som, /v in VOLUMES \? v : VOLUME_PADRAO/, 'o degrau lido nao e validado')
})

test('REGRESSAO: o primeiro retrato desenha mas nao toca', () => {
  const sala = readFileSync(join(RAIZ, 'web', 'sala', 'index.html'), 'utf8')
  assert.match(sala, /if \(!primeiro\) tocarAbertura\(\)/, 'a abertura toca no primeiro retrato')
  assert.match(sala, /=== 'liberado' && !primeiro/, 'a entrega toca no primeiro retrato')
})
