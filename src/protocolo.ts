import type { Estado, Acao } from './estados.ts'
import type { Turma } from './semente.ts'

export interface Chamada {
  alunoId: string
  nome: string
  turma: Turma
  estado: Estado
  /**
   * Quando o responsavel chegou. NAO muda nas transicoes seguintes.
   * E por este campo que a fila e ordenada: a portaria precisa ver quem
   * espera ha mais tempo, e a lista nao pode reordenar embaixo do dedo da
   * professora no instante em que ela toca em "liberar".
   */
  desde: number
  /** Quando o estado mudou pela ultima vez. */
  em: number
}

export interface Retrato {
  tipo: 'retrato'
  chamadas: Chamada[]
  em: number
}

export interface Comando {
  tipo: Acao
  alunoId: string
}

export interface Recusa {
  tipo: 'recusa'
  alunoId: string
  motivo: string
}

export interface EventoAuditoria {
  alunoId: string
  nome: string
  acao: Acao
  papel: string
  de: Estado
  para: Estado
  em: number
}
