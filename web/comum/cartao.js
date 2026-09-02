import { retratoDe } from './avatar.js'

/*
  Os dois formatos em que um aluno aparece.

  Nada aqui usa innerHTML com o nome: nome vem de planilha colada pela
  secretaria, e interpolar isso em template transforma um nome com marcacao em
  codigo executando na tela. textContent nao interpreta marcacao.

  REGRA DOS ESTADOS. Nenhum estado se apresenta so por cor. Cada um traz
  quatro canais ao mesmo tempo:

    cor      — token --estado-*, todos medidos contra as superficies
    rotulo   — texto em portugues corrido, nunca jargao
    icone    — forma distinta, para quem nao distingue matiz
    faixa    — posicao e espessura na lateral (o CSS cuida, via data-estado)

  O componente monta o conjunto. A tela nao escolhe partes dele — foi assim
  que `aguardando` acabou sem rotulo nenhum, comunicado apenas pela AUSENCIA
  da etiqueta.
*/

const ROTULO = {
  aguardando: 'aguardando',
  chamado: 'responsável chegou',
  liberado: 'liberado',
  entregue: 'entregue',
  retorno: 'retornou à sala',
}

/*
  Icones desenhados a mao, em SVG inline.

  Sem biblioteca e sem CDN: o app tem que subir com o cabo da escola
  desconectado, e uma fonte de icone remota seria a unica dependencia externa
  do projeto inteiro. Cada glifo e um punhado de tracos num viewBox de 24.
*/
const ICONE = {
  aguardando: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7v5l3 2'],
  chamado: ['M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7', 'M13.7 21a2 2 0 0 1-3.4 0'],
  liberado: ['M20 6 9 17l-5-5'],
  entregue: ['M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8', 'M17 16l4-4-4-4', 'M21 12H10'],
  retorno: ['M9 14 4 9l5-5', 'M4 9h11a5 5 0 0 1 0 10h-4'],
}

const NS = 'http://www.w3.org/2000/svg'

function icone(estado) {
  const tracos = ICONE[estado]
  if (!tracos) return null
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  for (const d of tracos) {
    const caminho = document.createElementNS(NS, 'path')
    caminho.setAttribute('d', d)
    svg.append(caminho)
  }
  return svg
}

function foto(nome, classe) {
  const caixa = document.createElement('div')
  caixa.className = classe
  caixa.append(retratoDe(nome))
  return caixa
}

/** Etiqueta completa: icone + rotulo + cor, os tres sempre juntos. */
export function etiquetaDe(texto, estado) {
  const span = document.createElement('span')
  span.className = 'etiqueta'
  if (estado) {
    span.dataset.estado = estado
    const glifo = icone(estado)
    if (glifo) span.append(glifo)
  }
  span.append(document.createTextNode(texto))
  return span
}

/**
 * Monta a etiqueta a partir do estado, com o rotulo e o icone que lhe pertencem.
 *
 * Exportada porque a portaria precisa RECONSTRUIR a etiqueta quando o estado
 * muda. Reescrever so o texto apagava o <svg> junto — textContent substitui
 * todos os filhos — e o rotulo escrito a mao la virava segunda fonte da
 * verdade, que nao sabe de nenhum estado alem dos dois digitados.
 */
export function etiquetaDoEstado(estado) {
  const texto = ROTULO[estado]
  if (!texto) return null
  return etiquetaDe(texto, estado)
}

/**
 * Cartao grande. E o que a professora ve do fundo da sala: rosto grande,
 * nome legivel, estado inequivoco.
 */
export function criarCartao({ nome, turma }) {
  const raiz = document.createElement('article')
  raiz.className = 'cartao'
  raiz.dataset.estado = 'aguardando'

  const nomeEl = document.createElement('p')
  nomeEl.className = 'nome'
  nomeEl.textContent = nome

  const turmaEl = document.createElement('p')
  turmaEl.className = 'turma'
  turmaEl.textContent = turma

  const textos = document.createElement('div')
  textos.append(nomeEl, turmaEl)

  const lugarDaEtiqueta = document.createElement('div')
  lugarDaEtiqueta.className = 'lugar-etiqueta'

  raiz.append(foto(nome, 'foto'), textos, lugarDaEtiqueta)

  raiz.definirEstado = (estado) => {
    raiz.dataset.estado = estado
    lugarDaEtiqueta.replaceChildren()
    const etiqueta = etiquetaDoEstado(estado)
    if (etiqueta) lugarDaEtiqueta.append(etiqueta)
  }
  raiz.definirEstado('aguardando')

  raiz.acrescentar = (no) => {
    raiz.append(no)
    return raiz
  }

  return raiz
}

/** Linha compacta. E o que a portaria percorre com o polegar, no celular. */
export function criarLinha({ nome, turma, estado }) {
  const raiz = document.createElement('li')
  raiz.className = 'linha'
  // Alimenta a faixa lateral do CSS. Sem isto a linha fica sem o quarto canal.
  if (estado) raiz.dataset.estado = estado

  const bloco = document.createElement('div')
  bloco.className = 'nome'
  bloco.append(document.createTextNode(nome))

  const detalhe = document.createElement('span')
  detalhe.className = 'detalhe'
  detalhe.textContent = turma
  bloco.append(detalhe)

  raiz.append(foto(nome, 'foto'), bloco)

  const etiqueta = estado ? etiquetaDoEstado(estado) : null
  if (etiqueta) raiz.append(etiqueta)

  return raiz
}
