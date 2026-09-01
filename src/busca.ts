import type { Aluno } from './semente.ts'

const ACENTOS = /[̀-ͯ]/g

export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(ACENTOS, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

export function buscar(alunos: Aluno[], consulta: string, limite = 8): Aluno[] {
  const termos = normalizar(consulta).split(' ').filter(Boolean)
  if (termos.length === 0) return []
  const achados = alunos.filter((aluno) => {
    const partes = normalizar(aluno.nome).split(' ')
    return termos.every((termo) => partes.some((parte) => parte.startsWith(termo)))
  })
  return achados.slice(0, limite)
}
