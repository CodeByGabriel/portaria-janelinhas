import { retratoDe } from './avatar.js'

/*
  Os dois formatos em que um aluno aparece.

  Nada aqui usa innerHTML com o nome: nome vem de planilha colada pela
  secretaria, e interpolar isso em template transforma um nome com marcacao
  em codigo executando na tela. textContent nao interpreta marcacao.
*/

const ROTULO = {
  aguardando: '',
  chamado: 'responsável chegou',
  liberado: 'liberado',
  entregue: 'entregue',
}

function foto(nome, classe) {
  const caixa = document.createElement('div')
  caixa.className = classe
  caixa.append(retratoDe(nome))
  return caixa
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

  const etiqueta = document.createElement('span')
  etiqueta.className = 'etiqueta'
  etiqueta.hidden = true

  const textos = document.createElement('div')
  textos.append(nomeEl, turmaEl)

  raiz.append(foto(nome, 'foto'), textos, etiqueta)

  raiz.definirEstado = (estado) => {
    raiz.dataset.estado = estado
    const texto = ROTULO[estado] ?? ''
    etiqueta.textContent = texto
    etiqueta.dataset.estado = estado
    etiqueta.hidden = texto === ''
  }

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

  const bloco = document.createElement('div')
  bloco.className = 'nome'
  bloco.append(document.createTextNode(nome))

  const detalhe = document.createElement('span')
  detalhe.className = 'detalhe'
  detalhe.textContent = turma
  bloco.append(detalhe)

  raiz.append(foto(nome, 'foto'), bloco)

  if (estado && ROTULO[estado]) {
    const etiqueta = document.createElement('span')
    etiqueta.className = 'etiqueta'
    etiqueta.dataset.estado = estado
    etiqueta.textContent = ROTULO[estado]
    raiz.append(etiqueta)
  }

  return raiz
}

/** Etiqueta solta, para quando so o estado precisa aparecer. */
export function etiquetaDe(texto, estado) {
  const span = document.createElement('span')
  span.className = 'etiqueta'
  if (estado) span.dataset.estado = estado
  span.textContent = texto
  return span
}
