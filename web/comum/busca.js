/*
  A mesma regra de src/busca.ts, em JavaScript, porque o navegador nao
  importa .ts. As duas copias tem que mudar juntas.

  Escola brasileira: a portaria digita "thais" e precisa achar "Thaís".
*/

const ACENTOS = /[̀-ͯ]/g

export function normalizar(texto) {
  return texto
    .normalize('NFD')
    .replace(ACENTOS, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

export function buscar(alunos, consulta, limite = 8) {
  const termos = normalizar(consulta).split(' ').filter(Boolean)
  if (termos.length === 0) return []
  const achados = alunos.filter((aluno) => {
    const partes = normalizar(aluno.nome).split(' ')
    return termos.every((termo) => partes.some((parte) => parte.startsWith(termo)))
  })
  return achados.slice(0, limite)
}
