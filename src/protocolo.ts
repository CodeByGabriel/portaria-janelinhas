import type { Estado, Acao } from './estados.ts'
import type { Aluno, Turma } from './semente.ts'

export interface Chamada {
  alunoId: string
  nome: string
  turma: Turma
  estado: Estado
  /**
   * Desde quando o responsavel esta no portao. Reinicia a cada `chamar`, e so
   * a cada `chamar` — as demais transicoes do ciclo preservam.
   *
   * E por este campo que a fila e ordenada: a portaria precisa ver quem espera
   * ha mais tempo, e a lista nao pode reordenar embaixo do dedo da professora
   * no instante em que ela toca em "liberar".
   *
   * O reinicio no `chamar` importa por causa do retorno: preservado atraves
   * dele, a crianca que voltou reapareceria no TOPO da fila como quem espera
   * ha mais tempo, e o cronometro da 1.3 anunciaria "esperando ha 47 min" para
   * alguem que acabou de ser chamado.
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
  /**
   * So faz sentido em `retornar`, e so um codigo de `RAZOES_RETORNO` passa.
   *
   * O Livro ZERA este campo em toda outra acao. Sem isso, qualquer sessao —
   * e o papel ainda vem da query string, sem autenticacao — gravaria texto
   * arbitrario numa tabela sem UPDATE nem DELETE por linha.
   */
  razao?: string
  /**
   * Quem esta levando a crianca. So faz sentido em `entregar`, e la e
   * OBRIGATORIO.
   *
   * E a metade da promessa que faltava: ate a 2.1 a trilha dizia que a crianca
   * saiu e nao dizia com quem. Um registro de saida que nao responde "a quem"
   * nao serve no dia em que a familia pergunta.
   */
  responsavelId?: string
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
  /** Quem pode levar cada crianca. Ausente em bancos anteriores a 2.1. */
  responsaveis?: import('./responsaveis.ts').Responsavel[]
  vinculos?: import('./responsaveis.ts').Vinculo[]
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
  /**
   * Codigo de `RAZOES_RETORNO`, e vazio em toda acao que nao seja `retornar`.
   *
   * Codigo, nunca frase: renomear o rotulo na tela nao pode reescrever o
   * passado, e a trilha nao tem caminho de correcao.
   */
  razao: string
  /**
   * Quem recebeu a crianca. Preenchido so em `entregar`.
   *
   * Grava id E nome. O id porque e a chave; o NOME porque a trilha e um
   * registro historico e precisa continuar legivel depois que a planilha de
   * responsaveis for substituida — do mesmo jeito que ela ja guarda o nome do
   * aluno em vez de so o id.
   */
  responsavelId: string
  responsavelNome: string
}
