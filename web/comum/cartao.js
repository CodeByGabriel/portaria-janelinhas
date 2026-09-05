
/*
  Os dois formatos em que um aluno aparece.

  Nada aqui usa innerHTML com o nome: nome vem de planilha colada pela
  secretaria, e interpolar isso em template transforma um nome com marcacao em
  codigo executando na tela. textContent nao interpreta marcacao.

  REGRA DOS ESTADOS. Nenhum estado se apresenta so por cor. Cada um traz
  quatro canais ao mesmo tempo:

    cor      — token --estado-*, todos medidos contra as superficies
    rotulo   — texto em portugues corrido, nunca jargao
    icone    — silhueta distinta a 24px, para quem nao distingue matiz
    faixa    — desenho proprio do traco lateral (o CSS cuida, via data-estado)

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
  Icones desenhados a mao, em SVG inline. Sem biblioteca e sem CDN.

  Cada silhueta diz o que o estado E, nao o que ele parece:
    aguardando  relogio          — o estado quieto, em aula
    chamado     sino             — alguem chegou
    liberado    porta com seta   — a crianca SAIU da sala (antes era um check,
                                   e check e "concluido"; concluido e entregue)
    retorno     seta em U        — voltou
    entregue    check duplo      — passou por duas maos, ciclo fechado
*/
const ICONE = {
  aguardando: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7v5l3 2'],
  chamado: ['M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7', 'M13.7 21a2 2 0 0 1-3.4 0'],
  liberado: ['M4 3h9v18H4z', 'M15 12h6M18 9l3 3-3 3'],
  retorno: ['M20 20v-6a4 4 0 0 0-4-4H4', 'M8 6 4 10l4 4'],
  entregue: ['M2.5 12.5l5 5L18 7', 'M11 17.5l1 1L22 8'],
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

/*
  O lugar da foto, vazio ate a escola trazer as fotos de matricula.

  O ESPACO CONTINUA RESERVADO: um lugar vazio hoje e a mesma caixa que recebe
  a foto amanha. Vazio digno — contorno tracejado, sem inicial, sem avatar.
  `aria-hidden`: e decoracao ate ter conteudo.
*/
function foto(_nome, classe) {
  const caixa = document.createElement('div')
  caixa.className = classe
  caixa.dataset.semFoto = 'sim'
  caixa.setAttribute('aria-hidden', 'true')
  return caixa
}

/** Etiqueta completa: icone + rotulo + cor, os tres sempre juntos. Sem caixa. */
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

export function etiquetaDoEstado(estado) {
  const texto = ROTULO[estado]
  if (!texto) return null
  return etiquetaDe(texto, estado)
}

/**
 * Cartao. Na sala (variante .painel) e uma linha larga: retrato, nome como
 * estrutura, estado e acao a direita. Fora do painel vira compacto.
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

/**
 * Linha compacta. E o que a portaria percorre com o polegar, no celular.
 *
 * Duas linhas internas: retrato + nome em cima; etiqueta + acao embaixo.
 * A quebra e um elemento de propósito (flex-basis: 100%): um nome longo nunca
 * disputa espaco com o botao, e o botao nunca encolhe.
 */
export function criarLinha({ nome, turma, estado }) {
  const raiz = document.createElement('li')
  raiz.className = 'linha'
  if (estado) raiz.dataset.estado = estado

  const bloco = document.createElement('div')
  bloco.className = 'nome'
  bloco.append(document.createTextNode(nome))

  const detalhe = document.createElement('span')
  detalhe.className = 'detalhe'

  const turmaEl = document.createElement('span')
  turmaEl.className = 'turma-da-linha'
  turmaEl.textContent = turma

  const espera = document.createElement('span')
  espera.className = 'espera'

  detalhe.append(turmaEl, espera)
  bloco.append(detalhe)

  raiz.append(foto(nome, 'foto'), bloco)

  const etiqueta = estado ? etiquetaDoEstado(estado) : null
  if (etiqueta) {
    const quebra = document.createElement('span')
    quebra.className = 'quebra'
    quebra.setAttribute('aria-hidden', 'true')
    raiz.append(quebra, etiqueta)
  }

  return raiz
}
