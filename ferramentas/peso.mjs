/**
 * O orcamento de peso da primeira carga, como portao.
 *
 *   node ferramentas/peso.mjs        (exige `npm run dev`)
 *
 * O teto e 120 KB transferidos na primeira abertura da portaria. Ele existe
 * porque a rede e o wifi de uma escola, e porque a alternativa — "vamos manter
 * leve" escrito num documento — nao para ninguem. Orcamento que ninguem mede e
 * desejo.
 *
 * A conta e sobre a PORTARIA porque e a tela que abre no celular, muitas vezes
 * com a mao ocupada e a fila andando. A sala abre uma vez por turno, num
 * aparelho parado.
 *
 * Mede os bytes servidos, sem compressao de transporte: e o pior caso, e o
 * numero que nao depende de o proxy do dia estar ligado. O que este script nao
 * ve — imagem embutida, importacao dinamica — nao existe hoje, e um dia que
 * passar a existir o numero aqui vai mentir. Por isso ele lista o que somou.
 */
const BASE = process.env.BASE ?? 'http://127.0.0.1:8787'
const TETO = 120 * 1024

/*
  A pesquisa sugeriu 250 KB. O app pesava 25 KB quando ela foi escrita, entao
  250 KB autorizaria uma regressao de dez vezes sem nenhum alarme — teto que so
  dispara depois do estrago nao e teto, e permissao.
*/

/** Tudo o que a portaria pede antes de estar utilizavel. */
async function baixar(caminho) {
  const r = await fetch(`${BASE}${caminho}`)
  if (!r.ok) throw new Error(`${caminho} respondeu ${r.status}`)
  const bytes = (await r.arrayBuffer()).byteLength
  return { caminho, bytes }
}

function referencias(html) {
  const achados = new Set()
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const alvo = m[1]
    if (alvo.startsWith('http') || alvo.startsWith('#') || alvo.startsWith('data:')) continue
    achados.add(alvo.replace(/^\.\./, '').replace(/^\.\//, '/portaria/'))
  }
  // Modulos importados por `import ... from '...'` dentro do <script type=module>.
  for (const m of html.matchAll(/from\s+'(\.\.[^']+)'/g)) {
    achados.add(m[1].replace(/^\.\./, ''))
  }
  return [...achados]
}

/** O CSS puxa as fontes; elas contam, e sao a maior linha do orcamento. */
function fontesDe(css) {
  return [...css.matchAll(/url\('\.\/([^']+)'\)/g)].map((m) => `/comum/${m[1]}`)
}

/*
  Segue os imports em CADEIA, e nao so os da pagina.

  `cartao.js` importa `avatar.js`, que a pagina nunca menciona. Contar so o que
  o HTML cita deixaria de fora exatamente o caminho por onde uma dependencia
  pesada entra: alguem importa uma biblioteca dentro de um modulo que ja
  existia, e o orcamento nao vê. Contado assim, o teto so protege o que ja
  estava protegido.
*/
const IMPORTA = /from\s+'([^']+)'/g

function resolver(de, alvo) {
  if (alvo.startsWith('/')) return alvo
  const base = de.slice(0, de.lastIndexOf('/'))
  const partes = (base + '/' + alvo).split('/')
  const pilha = []
  for (const parte of partes) {
    if (parte === '.' || parte === '') continue
    if (parte === '..') pilha.pop()
    else pilha.push(parte)
  }
  return '/' + pilha.join('/')
}

const paginas = []
const vistos = new Set()
const fila = []

const html = await fetch(`${BASE}/portaria/`).then((r) => r.text())
paginas.push({ caminho: '/portaria/', bytes: new TextEncoder().encode(html).length })
for (const caminho of referencias(html)) fila.push(caminho)

while (fila.length > 0) {
  const caminho = fila.shift()
  if (vistos.has(caminho)) continue
  vistos.add(caminho)

  const r = await fetch(`${BASE}${caminho}`)
  if (!r.ok) throw new Error(`${caminho} respondeu ${r.status}`)
  const texto = await r.text()
  paginas.push({ caminho, bytes: new TextEncoder().encode(texto).length })

  if (caminho.endsWith('.js')) {
    for (const m of texto.matchAll(IMPORTA)) fila.push(resolver(caminho, m[1]))
  }
  if (caminho.endsWith('.css')) {
    for (const fonte of fontesDe(texto)) {
      if (vistos.has(fonte)) continue
      vistos.add(fonte)
      paginas.push(await baixar(fonte))
    }
  }
}

const total = paginas.reduce((s, p) => s + p.bytes, 0)

paginas.sort((a, b) => b.bytes - a.bytes)
for (const p of paginas) {
  console.log(`  ${String(Math.round(p.bytes / 102.4) / 10).padStart(6)} KB  ${p.caminho}`)
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`
console.log(`\n  total: ${kb(total)} em ${paginas.length} arquivos (teto ${kb(TETO)})`)

if (total > TETO) {
  console.error(
    `\nORCAMENTO ESTOURADO: ${kb(total - TETO)} acima do teto.\n` +
      'Nao suba isso sem decidir o que sai. A rede e o wifi de uma escola.\n',
  )
  process.exit(1)
}

console.log(`  folga: ${kb(TETO - total)}\n`)
process.exit(0)
