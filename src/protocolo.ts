import type { Estado, Acao } from './estados.ts'
import type { Aluno, Turma } from './semente.ts'

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
  /**
   * Muda toda vez que o cadastro e trocado por uma importacao.
   *
   * Existe porque um tablet com a lista velha na memoria chamava o id errado
   * depois de uma reimportacao. O cliente compara com o que tem e rebusca a
   * lista quando difere — sem isso, a tela mente em silencio.
   */
  cadastro: number
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

/**
 * O estado do dia inteiro, como sai do disco e entra no Livro.
 *
 * Mora aqui, e nao em deposito.ts, de proposito: assim o Livro consegue
 * hidratar sem importar nada que saiba o que e armazenamento. A pureza dele
 * e um invariante, nao um detalhe de estilo.
 */
export interface Instantaneo {
  alunos: Aluno[]
  chamadas: Chamada[]
  trilha: EventoAuditoria[]
  versaoCadastro: number
}

export interface EventoAuditoria {
  alunoId: string
  nome: string
  turma: Turma
  acao: Acao
  papel: string
  /** De qual sala partiu a acao, ou 'portaria'. Rastreabilidade do incidente. */
  origem: string
  de: Estado
  para: Estado
  em: number
}
