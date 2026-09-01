/**
 * Gera um arquivo unico e autocontido a partir de web/demo/.
 *
 *   node ferramentas/construir-demo.mjs
 *   -> web/demo-offline.html
 *
 * Por que existe: modulo ES nao carrega por file:// (o navegador bloqueia por
 * CORS), entao a pasta web/demo/ so funciona servida. Este arquivo unico abre
 * com duplo clique, sem servidor, sem node, sem rede. E o plano C da
 * apresentacao: sobrevive ao wifi da escola cair E ao notebook nao conseguir
 * rodar o npm.
 *
 * A montagem e literal: o CSS entra numa tag <style> e os modulos entram em
 * ordem de dependencia numa unica <script>, com as linhas de import e a
 * palavra export removidas. Nao ha empacotador; se um modulo passar a usar
 * import dinamico ou export nomeado com renome, isto quebra de forma visivel
 * (o teste ao fim confere que nao sobrou import nem export).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const ler = (p) => readFileSync(join(raiz, p), 'utf8')

/** Ordem de dependencia: quem e importado vem antes de quem importa. */
const MODULOS = [
  'web/comum/estados.js',
  'web/comum/dom.js',
  'web/comum/avatar.js',
  'web/comum/janelinha.js',
  'web/comum/som.js',
]

const SEM_IMPORT = /^\s*import\s+[^\n]*?from\s+['"][^'"]+['"]\s*;?\s*$/gm
const SEM_EXPORT = /^(\s*)export\s+(?=(const|let|var|function|class)\b)/gm

function achatar(codigo, origem) {
  return `\n/* ===== ${origem} ===== */\n` + codigo.replace(SEM_IMPORT, '').replace(SEM_EXPORT, '$1')
}

const css = ler('web/comum/tokens.css')
const html = ler('web/demo/index.html')

const corpoDoScript = html.match(/<script type="module">([\s\S]*?)<\/script>/)
if (!corpoDoScript) throw new Error('nao achei o <script type="module"> em web/demo/index.html')

const estiloProprio = html.match(/<style>([\s\S]*?)<\/style>/)
if (!estiloProprio) throw new Error('nao achei o <style> em web/demo/index.html')

const marcacao = html
  .match(/<body>([\s\S]*?)<script type="module">/)[1]
  .trim()

const juntado =
  MODULOS.map((m) => achatar(ler(m), m)).join('\n') +
  achatar(corpoDoScript[1], 'web/demo/index.html')

const saida = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Demo offline — Janelinhas do Saber</title>
<style>
${css}
${estiloProprio[1]}
</style>
</head>
<body>
${marcacao}
<script>
${juntado}
</script>
</body>
</html>
`

// Conferencia: se sobrou import ou export, o arquivo nao roda por file://
const sobrouImport = /^\s*import\s/m.test(juntado)
const sobrouExport = /^\s*export\s/m.test(juntado)
if (sobrouImport || sobrouExport) {
  console.error('FALHOU: sobrou', sobrouImport ? 'import' : '', sobrouExport ? 'export' : '')
  process.exit(1)
}

writeFileSync(join(raiz, 'web/demo-offline.html'), saida)
console.log(`web/demo-offline.html gerado — ${(saida.length / 1024).toFixed(1)} KB, zero dependencia externa`)
