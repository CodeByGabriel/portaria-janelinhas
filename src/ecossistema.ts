/*
  Fase 3 — esboço das interfaces com o ecossistema (backend NestJS/PostgreSQL,
  portal de pais). SÓ TIPOS: nada aqui roda. Existe para o `typecheck` garantir
  que o contrato proposto bate com os tipos que o satélite já usa — `Aluno`,
  `EventoAuditoria`, `Responsavel` — e para o documento `docs/fase-3-interfaces.md`
  apontar para algo que compila, e não para prosa.

  O que este arquivo NÃO decide: o nome e os campos exatos do `LogAuditoria` do
  backend, que só quem constrói o backend conhece. Onde há dúvida, o comentário
  diz "a confirmar".
*/
import type { Acao, Estado, Papel } from './estados.ts'
import type { Turma } from './semente.ts'

/* ---------- 3.1 Cadastro por API (substitui a planilha) ---------- */

/**
 * Aluno como o backend o conhece. O `id` é o do backend, ESTÁVEL: hoje o
 * satélite deriva o id de nome+turma (`importar.ts#idDe`), e uma criança que
 * muda de turma vira outro id — é isso que orfana vínculos a cada reimportação.
 * Com o id vindo de fora, `vinculosPerdidos` deixa de existir no caminho da API.
 */
export interface AlunoExterno {
  id: string
  nome: string
  turma: Turma
  /** Restrição em texto livre. Fica fora de `/alunos`, como hoje (`alertas`). */
  alerta?: string
}

export interface ResponsavelExterno {
  id: string
  nome: string
  /** "mãe", "pai", "avó", "vizinha autorizada"... texto livre, como hoje. */
  vinculo: string
  telefone?: string
}

export interface VinculoExterno {
  alunoId: string
  responsavelId: string
  /** Guarda/decisão judicial: este adulto NÃO leva esta criança. Vence sempre. */
  impedido: boolean
}

/**
 * Corpo de `PUT /cadastro`. Substituição COMPLETA e atômica, como a planilha:
 * não há PATCH por aluno. Um cadastro parcial que sobrevive a um erro no meio
 * é pior que o cadastro antigo inteiro.
 */
export interface CadastroCompleto {
  /** Monotônico, definido pelo backend. Repetir a mesma versão é idempotente. */
  versao: number
  alunos: AlunoExterno[]
  responsaveis: ResponsavelExterno[]
  vinculos: VinculoExterno[]
}

export interface RespostaCadastro {
  trocado: boolean
  /** A versão vigente depois da chamada — igual à enviada quando `trocado`. */
  versao: number
  alunos: number
  responsaveis: number
  vinculos: number
  /** No máximo 100 itens; `errosTotal` diz quantos houve. */
  erros: { linha: number; motivo: string }[]
  errosTotal: number
}

/* ---------- 3.2 Trilha → LogAuditoria ---------- */

/**
 * Um evento da trilha no formato de exportação. Espelha `EventoAuditoria`
 * (protocolo.ts) com três diferenças: ganha `seq` (cursor), `quando` em ISO
 * 8601 e o responsável agrupado num objeto.
 *
 * O NOME desta interface e dos campos é proposta — a confirmar com o backend.
 * O que não negocia: `seq` monotônico, `de`/`para`, `razao` em código (nunca
 * frase), responsável com id E nome, e a origem "portaria-janelinhas".
 */
export interface LogAuditoria {
  /** SQLite AUTOINCREMENT da tabela `trilha`. Cursor e chave de deduplicação. */
  seq: number
  /** Mesmo instante de `em`, em ISO 8601 UTC. `em` continua vindo em ms. */
  quando: string
  em: number
  sistema: 'portaria-janelinhas'
  ator: { papel: Papel; origem: string }
  acao: Acao
  aluno: { id: string; nome: string; turma: Turma }
  de: Estado
  para: Estado
  /** Código de `RAZOES_RETORNO`; vazio fora de `retornar`. */
  razao: string
  /** Só em `entregar`. Em delegação, o id vem como `delegacao:<id>`. */
  responsavel: { id: string; nome: string } | null
}

/** Resposta de `GET /trilha?apos=<seq>&limite=<n>`. */
export interface PaginaDaTrilha {
  eventos: LogAuditoria[]
  /** `seq` do último evento devolvido; `null` quando não há mais nada. */
  proximo: number | null
}

/* ---------- 3.3 Delegação "hoje a avó busca" ---------- */

/**
 * Autorização TEMPORÁRIA criada no portal de pais por um responsável titular.
 * Corpo de `POST /delegacoes`; `DELETE /delegacoes/:id` revoga.
 */
export interface Delegacao {
  /** Id do backend. */
  id: string
  alunoId: string
  quemBusca: { nome: string; vinculo: string; telefone?: string }
  /** ISO 8601 com fuso. Padrão sugerido: do momento da criação ao fim do dia. */
  validoDe: string
  validoAte: string
  /** `ResponsavelExterno.id` do titular que autorizou. Vai para a trilha. */
  autorizadoPor: string
}

/**
 * Como a delegação aparece para a portaria, dentro da resposta de
 * `/responsaveis` — ao lado dos responsáveis fixos, marcada.
 */
export interface ResponsavelTemporario {
  id: string
  nome: string
  vinculo: string
  temporario: true
  autorizadoPor: string
  validoAte: string
}
