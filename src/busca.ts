import type { Aluno } from './semente.ts'

/*
  Escrito com escapes \u de proposito. A versao anterior usava as marcas
  combinantes cruas (U+0300 e U+036F) dentro do colchete: funciona, mas sao
  caracteres invisiveis que qualquer formatador, copy-paste ou normalizacao
  Unicode do fonte pode grudar no caractere anterior. O range mudaria em
  silencio e "Thais" deixaria de achar "Thaís" — sem erro, so resultado vazio.
*/
const ACENTOS = /[̀-ͯ]/g

/*
  Apostrofo (reto e tipografico) e hifen viram espaco, nao somem.

  Sant'Ana, D'Avila, D'Alessandro e Ana-Clara sao sobrenome e nome brasileiro
  comuns. Apagando o apostrofo, "Sant'Ana" vira "santana" e quem digita "ana"
  nao acha. Virando espaco, vira "sant ana" e as duas partes sao buscaveis.
  O Excel exporta o apostrofo tipografico U+2019, entao ele entra tambem.
*/
const SEPARADORES = /[''‘’\-–—.]/g

export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(ACENTOS, '')
    .replace(SEPARADORES, ' ')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

export interface Achado {
  achados: Aluno[]
  /** Quantos casaram no total, antes do corte. Nunca truncar em silencio. */
  total: number
}

/**
 * Numa escola de 292 criancas, "Maria Eduarda" repete muito. Cortar em 8 e
 * necessario para a tela do celular, mas cortar SEM DIZER faz o operador
 * concluir que a crianca nao existe — ou tocar numa homonima de outra turma,
 * e af a sala errada e avisada. Por isso o total volta junto.
 */
export function buscar(alunos: Aluno[], consulta: string, limite = 8): Achado {
  const termos = normalizar(consulta).split(' ').filter(Boolean)
  if (termos.length === 0) return { achados: [], total: 0 }

  const casaram = alunos.filter((aluno) => {
    const partes = normalizar(aluno.nome).split(' ')
    return termos.every((termo) => partes.some((parte) => parte.startsWith(termo)))
  })

  return { achados: casaram.slice(0, limite), total: casaram.length }
}
