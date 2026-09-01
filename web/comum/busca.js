/*
  A mesma regra de src/busca.ts, em JavaScript, porque o navegador nao
  importa .ts. As duas copias tem que mudar juntas.

  Escola brasileira: a portaria digita "thais" e precisa achar "Thaís", e
  "ana" precisa achar "Maria Sant'Ana".
*/

const ACENTOS = /[̀-ͯ]/g
const SEPARADORES = /['‘’ʼ\-–—.]/g

export function normalizar(texto) {
  return texto
    .normalize('NFD')
    .replace(ACENTOS, '')
    .replace(SEPARADORES, ' ')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

/** Devolve { achados, total }. O total existe para a tela nunca truncar em silencio. */
export function buscar(alunos, consulta, limite = 8) {
  const termos = normalizar(consulta).split(' ').filter(Boolean)
  if (termos.length === 0) return { achados: [], total: 0 }

  const casaram = alunos.filter((aluno) => {
    const partes = normalizar(aluno.nome).split(' ')
    return termos.every((termo) => partes.some((parte) => parte.startsWith(termo)))
  })

  return { achados: casaram.slice(0, limite), total: casaram.length }
}
