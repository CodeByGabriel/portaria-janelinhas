import { retratoDe } from './avatar.js'

const ROTULO = {
  aguardando: '',
  chamado: 'responsável chegou',
  liberado: 'saída liberada',
  entregue: 'entregue',
}

/**
 * Cria uma janelinha. Comeca fechada: os batentes cobrem o retrato e
 * ninguem ve quem esta atras ate a crianca ser chamada.
 */
export function criarJanelinha({ nome, turma }) {
  const raiz = document.createElement('div')
  raiz.className = 'janelinha'
  raiz.dataset.estado = 'aguardando'

  const caixilho = document.createElement('div')
  caixilho.className = 'caixilho'

  const retrato = document.createElement('div')
  retrato.className = 'retrato'
  retrato.append(retratoDe(nome))

  const esquerdo = document.createElement('div')
  esquerdo.className = 'batente esquerdo'
  esquerdo.innerHTML = '<span></span><span></span>'

  const direito = document.createElement('div')
  direito.className = 'batente direito'
  direito.innerHTML = '<span></span><span></span>'

  caixilho.append(retrato, esquerdo, direito)

  const rotuloNome = document.createElement('p')
  rotuloNome.className = 'nome'
  rotuloNome.textContent = nome

  const rotuloTurma = document.createElement('p')
  rotuloTurma.className = 'turma'
  rotuloTurma.textContent = turma

  const selo = document.createElement('span')
  selo.className = 'selo'
  selo.hidden = true

  raiz.append(caixilho, rotuloNome, rotuloTurma, selo)

  raiz.definirEstado = (estado) => {
    raiz.dataset.estado = estado
    const texto = ROTULO[estado] ?? ''
    selo.textContent = texto
    selo.hidden = texto === ''
  }

  return raiz
}
