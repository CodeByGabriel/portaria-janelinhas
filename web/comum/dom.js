/*
  Construcao de DOM sem innerHTML.

  Nome de crianca chega de planilha colada pela secretaria. Interpolar isso
  num template de innerHTML transforma um nome como <img src=x onerror=...>
  em codigo executando na tela da portaria. textContent nao interpreta
  marcacao — o nome aparece literal, que e o comportamento certo.

  O analisador de importacao tambem recusa < e >, mas defesa que depende de
  uma camada so e defesa que ja falhou uma vez.
*/

/** Uma linha de duas alturas: nome em cima, detalhe menor embaixo. */
export function linhaDupla(principal, detalhe) {
  const caixa = document.createElement('div')
  caixa.className = 'nome'

  caixa.append(document.createTextNode(principal))
  caixa.append(document.createElement('br'))

  const span = document.createElement('span')
  span.className = 'detalhe'
  span.textContent = detalhe
  caixa.append(span)

  return caixa
}

/** Uma etiqueta com estado, para pendurar ao lado do nome. */
export function marca(texto, estado) {
  const span = document.createElement('span')
  span.className = 'marca'
  if (estado) span.dataset.estado = estado
  span.textContent = texto
  return span
}
