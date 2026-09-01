/*
  Retrato ilustrado deterministico, derivado do nome.

  Nao geramos rosto fotorrealista de crianca. Estas ilustracoes sao
  geometricas de proposito: leem como desenho, nunca como foto. Em producao,
  a escola sobe a foto que ja tem na matricula, sob o consentimento que a
  fase de conformidade definir.
*/

const PELES = ['#f6d9c0', '#eabd99', '#cd9263', '#a26a42', '#71482a']
const CABELOS = ['#2b1b12', '#4a2c1a', '#7b4b23', '#c98b3a', '#171717', '#8d5524']
const ROUPAS = ['#2f6f9f', '#2f7d55', '#a1441f', '#6a4b8f', '#b4671a', '#38799a']

function digerir(texto) {
  let h = 2166136261
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

const PENTEADOS = [
  // franja reta
  (c) => `<path d="M25 44a25 25 0 0 1 50 0v3q-25-12-50 0z" fill="${c}"/>`,
  // cabelo comprido dos dois lados
  (c) =>
    `<path d="M25 46a25 25 0 0 1 50 0v26q-6 4-8-2l-2-22q-15 7-30 0l-2 22q-2 6-8 2z" fill="${c}"/>`,
  // cachinhos
  (c) =>
    `<g fill="${c}"><circle cx="34" cy="27" r="9"/><circle cx="50" cy="22" r="10"/>` +
    `<circle cx="66" cy="27" r="9"/><circle cx="27" cy="38" r="8"/><circle cx="73" cy="38" r="8"/></g>`,
]

export function retratoDe(nome) {
  const h = digerir(nome)
  const pele = PELES[h % PELES.length]
  const cabelo = CABELOS[Math.floor(h / 7) % CABELOS.length]
  const roupa = ROUPAS[Math.floor(h / 13) % ROUPAS.length]
  const penteado = PENTEADOS[Math.floor(h / 31) % PENTEADOS.length]
  const sardas = Math.floor(h / 53) % 3 === 0

  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 100 100')
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', `Retrato ilustrado de ${nome}`)
  svg.innerHTML = `
    <circle cx="50" cy="50" r="50" fill="${roupa}" opacity="0.14"/>
    <path d="M20 100a30 30 0 0 1 60 0z" fill="${roupa}"/>
    <path d="M42 68h16v10H42z" fill="${pele}"/>
    <circle cx="50" cy="47" r="25" fill="${pele}"/>
    ${penteado(cabelo)}
    <circle cx="41" cy="49" r="2.8" fill="#2c1e11"/>
    <circle cx="59" cy="49" r="2.8" fill="#2c1e11"/>
    <circle cx="34" cy="55" r="4" fill="#e8908a" opacity="0.45"/>
    <circle cx="66" cy="55" r="4" fill="#e8908a" opacity="0.45"/>
    ${
      sardas
        ? `<g fill="#a9724c" opacity="0.6"><circle cx="43" cy="57" r="0.9"/>` +
          `<circle cx="46" cy="59" r="0.9"/><circle cx="54" cy="59" r="0.9"/>` +
          `<circle cx="57" cy="57" r="0.9"/></g>`
        : ''
    }
    <path d="M43 60q7 6 14 0" stroke="#2c1e11" stroke-width="2.4" fill="none" stroke-linecap="round"/>
  `
  return svg
}
