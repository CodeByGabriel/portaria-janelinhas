/*
  Retrato ilustrado deterministico, derivado do nome.

  Nao geramos rosto fotorrealista de aluno. Estas ilustracoes sao planas e
  geometricas de proposito: leem como marcador de posicao de um sistema, nao
  como foto nem como desenho infantil. A escola vai do Pré 1 ao 9º ano, e um
  bonequinho de bochecha rosada constrange um aluno de 14 anos.

  Em producao, a escola sobe a foto que ja tem na matricula, sob o
  consentimento que a fase de conformidade definir.
*/

const PELES = ['#f0d5be', '#e2b591', '#c58d63', '#9c6b45', '#6d4830']
const CABELOS = ['#2a211c', '#4b3524', '#7a5636', '#a8763f', '#1a1a1a', '#8d6a4f']
const FUNDOS = ['#e7eeea', '#e9ecef', '#eceae4', '#e6edf1', '#eeeaef']

function digerir(texto) {
  let h = 2166136261
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

/** Tres silhuetas de cabelo. Sem franja fofa, sem cachinho: forma, nao personagem. */
const CABECAS = [
  (c) => `<path d="M27 45a23 23 0 0 1 46 0v4H27z" fill="${c}"/>`,
  (c) =>
    `<path d="M27 47a23 23 0 0 1 46 0v22q-5 3-6-2l-1-19q-16 6-32 0l-1 19q-1 5-6 2z" fill="${c}"/>`,
  (c) => `<path d="M28 44a22 22 0 0 1 44 0v3q-22-9-44 0z" fill="${c}"/>`,
]

export function retratoDe(nome) {
  const h = digerir(nome)
  const pele = PELES[h % PELES.length]
  const cabelo = CABELOS[Math.floor(h / 7) % CABELOS.length]
  const fundo = FUNDOS[Math.floor(h / 13) % FUNDOS.length]
  const cabeca = CABECAS[Math.floor(h / 31) % CABECAS.length]

  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 100 100')
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', `Retrato ilustrado de ${nome}`)

  /*
    innerHTML aqui e seguro e precisa continuar sendo: TUDO que entra no
    template vem das constantes acima (PELES, CABELOS, FUNDOS, CABECAS).
    O nome do aluno — unico dado que vem de fora — entra por setAttribute,
    que nao interpreta marcacao.

    Se algum dia um valor de fora precisar entrar neste SVG, ele NAO vem por
    aqui: monte o no com createElementNS.
  */
  svg.innerHTML = `
    <rect width="100" height="100" fill="${fundo}"/>
    <path d="M18 100a32 26 0 0 1 64 0z" fill="#5a6b63"/>
    <path d="M43 70h14v9H43z" fill="${pele}"/>
    <ellipse cx="50" cy="48" rx="22" ry="24" fill="${pele}"/>
    ${cabeca(cabelo)}
    <circle cx="42" cy="50" r="2.4" fill="#222b27"/>
    <circle cx="58" cy="50" r="2.4" fill="#222b27"/>
    <path d="M44 60q6 4 12 0" stroke="#222b27" stroke-width="2" fill="none" stroke-linecap="round"/>
  `
  return svg
}
