import type { Estado, Acao } from './estados.ts'
import type { Turma } from './semente.ts'

export interface Chamada {
  alunoId: string
  nome: string
  turma: Turma
  estado: Estado
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
  de: Estado
  para: Estado
  em: number
}
