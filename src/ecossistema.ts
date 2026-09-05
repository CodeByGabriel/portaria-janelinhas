/*
  Fase 3 — as interfaces com o ecossistema (backend NestJS/PostgreSQL, portal
  de pais), e a validacao de FORMA do que chega por elas.

  Tipos com sufixo "Externo/Externa" sao o que atravessa a rede, como o backend
  os manda: ids do backend, datas ISO. O que o Livro guarda e o tipo interno
  correspondente (`Aluno`, `Responsavel`, `Delegacao` em protocolo.ts).

  Aqui so entra forma: tamanho, tipo, turma conhecida, referencia que existe
  dentro do proprio corpo. Regra de negocio — impedido vence, quem autoriza
  precisa poder levar, crianca em saida tranca a troca — mora no Livro, como
  toda regra (invariante 8).

  O que este arquivo NAO decide: o nome e os campos exatos do `LogAuditoria` do
  backend, que so quem constroi o backend conhece. `comoLogAuditoria` e a
  proposta, a confirmar. Ver docs/fase-3-interfaces.md.
*/
import { TURMAS, type Aluno, type Turma } from './semente.ts'
import type { Acao, Estado, Papel } from './estados.ts'
import {
  LIMITE_NOME_RESPONSAVEL,
  LIMITE_VINCULO,
  LIMITE_TELEFONE,
  type Responsavel,
  type Vinculo,
} from './responsaveis.ts'
import type { Delegacao, EventoAuditoria } from './protocolo.ts'

export interface Erro {
  linha: number
  motivo: string
}

/** Teto de erros devolvidos, como no `/importar`. O total vai a parte. */
export const LIMITE_ERROS = 100
export const LIMITE_ALUNOS = 5000
export const LIMITE_ID = 64
export const LIMITE_NOME_ALUNO = 120
export const LIMITE_ALERTA = 500
/** Uma delegacao nunca vale mais que isto. "Hoje a avo busca" nao e "para sempre". */
export const MAXIMO_DIAS_DELEGACAO = 7
const UM_DIA = 24 * 60 * 60 * 1000

/**
 * Como a delegacao aparece no lugar de um responsavel: `delegacao:<id>`.
 *
 * Prefixo reservado — nenhum id vindo do backend pode comeca-lo — para que a
 * trilha diga, sozinha, que aquela entrega foi por autorizacao temporaria.
 */
export const PREFIXO_DELEGACAO = 'delegacao:'
export const idDeDelegacao = (id: string): string => PREFIXO_DELEGACAO + id
/**
 * O id da delegacao viaja como `responsavelId` no comando `entregar`, que tem
 * teto de LIMITE_ID. Com o prefixo na frente, sobra isto — um id maior seria
 * aceito na criacao e recusado na entrega, e a avo ficaria no portao.
 */
export const LIMITE_ID_DELEGACAO = LIMITE_ID - PREFIXO_DELEGACAO.length

const MARCACAO = /[<>]/g

/* ---------- 3.1 Cadastro por API (substitui a planilha) ---------- */

/**
 * Aluno como o backend o conhece. O `id` e o do backend, ESTAVEL: pela
 * planilha o satelite deriva o id de nome+turma (`importar.ts#idDe`), e uma
 * crianca que muda de turma vira outro id — e isso que orfana vinculos a cada
 * reimportacao. Com o id vindo de fora, `vinculosPerdidos` deixa de existir
 * no caminho da API.
 */
export interface AlunoExterno {
  id: string
  nome: string
  turma: Turma
  /** Restricao em texto livre. Fica fora de `/alunos`, como hoje (`alertas`). */
  alerta?: string
}

export interface ResponsavelExterno {
  id: string
  nome: string
  /** "mae", "pai", "avo", "vizinha autorizada"... texto livre, como hoje. */
  vinculo?: string
  telefone?: string
}

export interface VinculoExterno {
  alunoId: string
  responsavelId: string
  /** Guarda/decisao judicial: este adulto NAO leva esta crianca. Vence sempre. */
  impedido?: boolean
}

/**
 * Corpo de `PUT /cadastro`. Substituicao COMPLETA e atomica, como a planilha:
 * nao ha PATCH por aluno. Um cadastro parcial que sobrevive a um erro no meio
 * e pior que o cadastro antigo inteiro.
 */
export interface CadastroCompleto {
  /** Monotonica, definida pelo backend. Repetir a mesma versao e idempotente. */
  versao: number
  alunos: AlunoExterno[]
  responsaveis?: ResponsavelExterno[]
  vinculos?: VinculoExterno[]
}

export interface RespostaCadastro {
  trocado: boolean
  /** A versao vigente depois da chamada; `null` quando o cadastro veio de planilha. */
  versao: number | null
  alunos: number
  responsaveis: number
  vinculos: number
  /** No maximo LIMITE_ERROS itens; `errosTotal` diz quantos houve. */
  erros: Erro[]
  errosTotal: number
}

export interface CadastroAnalisado {
  ok: true
  versao: number
  alunos: Aluno[]
  alertas: { id: string; texto: string }[]
  responsaveis: Responsavel[]
  vinculos: Vinculo[]
}

export interface AnaliseRecusada {
  ok: false
  erros: Erro[]
  errosTotal: number
}

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
}

/** Texto obrigatorio: sem marcacao, sem espaco sobrando, dentro do teto. */
function texto(valor: unknown, maximo: number): string | null {
  if (typeof valor !== 'string') return null
  const limpo = valor.replace(MARCACAO, '').trim()
  if (limpo.length === 0 || limpo.length > maximo) return null
  return limpo
}

/** Texto opcional: ausente vira vazio; presente obedece ao teto. */
function textoOpcional(valor: unknown, maximo: number): string | null {
  if (valor === undefined || valor === null || valor === '') return ''
  return texto(valor, maximo)
}

/**
 * Ids sao opacos, tem teto, nao podem usar o prefixo da delegacao — e NAO sao
 * reescritos: um id com espaco na ponta ou com "<" era guardado limpo na
 * criacao, e o `DELETE /delegacoes?id=` com o id que o backend mandou nao
 * achava nada. Id que precisaria de limpeza e recusado na hora.
 */
export function idExternoValido(valor: unknown): string | null {
  if (typeof valor !== 'string') return null
  const id = texto(valor, LIMITE_ID)
  if (id === null || id !== valor || id.startsWith(PREFIXO_DELEGACAO)) return null
  return id
}
const idValido = idExternoValido

/** Para mensagens de erro: nunca ecoa mais que um pedaco, e nunca com marcacao. */
function amostra(valor: unknown): string {
  return String(valor ?? '').replace(MARCACAO, '').slice(0, 40)
}

class Coletor {
  readonly erros: Erro[] = []
  total = 0
  anotar(linha: number, motivo: string): void {
    this.total++
    if (this.erros.length < LIMITE_ERROS) this.erros.push({ linha, motivo })
  }
  recusa(): AnaliseRecusada {
    return { ok: false, erros: this.erros, errosTotal: this.total }
  }
}

/**
 * Confere a forma de um cadastro completo vindo do backend.
 *
 * ESTRITO: um erro em qualquer linha recusa o corpo inteiro. E diferente da
 * planilha, que pula linhas invalidas e devolve a lista de erros — la quem
 * corrige e a secretaria, olhando o arquivo; aqui quem corrige e um programa,
 * e um programa que recebe "aplicado com 3 erros" tende a ignorar os 3. Uma
 * substituicao atomica que deixa criancas de fora em silencio e o defeito que
 * este contrato existe para nao ter.
 */
export function analisarCadastroExterno(corpo: unknown): CadastroAnalisado | AnaliseRecusada {
  const c = new Coletor()
  if (!ehObjeto(corpo)) {
    c.anotar(0, 'o corpo precisa ser um objeto')
    return c.recusa()
  }

  const versao = corpo.versao
  // SafeInteger, e nao Integer: 1e21 e "inteiro", e 2^53+1 vira 2^53 no
  // JSON.parse — duas versoes distintas do backend seriam "a mesma".
  if (!Number.isSafeInteger(versao) || (versao as number) < 0) {
    c.anotar(0, 'versao precisa ser um inteiro nao negativo (ate 2^53 - 1)')
  }

  if (!Array.isArray(corpo.alunos)) {
    c.anotar(0, 'alunos precisa ser uma lista')
    return c.recusa()
  }
  if (corpo.alunos.length === 0) c.anotar(0, 'nenhum aluno')
  if (corpo.alunos.length > LIMITE_ALUNOS) {
    c.anotar(0, `alunos demais (${corpo.alunos.length}; o limite e ${LIMITE_ALUNOS})`)
    return c.recusa()
  }
  if (corpo.responsaveis !== undefined && !Array.isArray(corpo.responsaveis)) {
    c.anotar(0, 'responsaveis precisa ser uma lista')
  }
  if (corpo.vinculos !== undefined && !Array.isArray(corpo.vinculos)) {
    c.anotar(0, 'vinculos precisa ser uma lista')
  }
  const responsaveisCrus: unknown[] = Array.isArray(corpo.responsaveis) ? corpo.responsaveis : []
  const vinculosCrus: unknown[] = Array.isArray(corpo.vinculos) ? corpo.vinculos : []

  const alunos: Aluno[] = []
  const alertas: { id: string; texto: string }[] = []
  const idsDeAluno = new Set<string>()
  corpo.alunos.forEach((cru: unknown, i: number) => {
    const linha = i + 1
    if (!ehObjeto(cru)) return c.anotar(linha, 'aluno precisa ser um objeto')
    const id = idValido(cru.id)
    const nome = texto(cru.nome, LIMITE_NOME_ALUNO)
    // NFC antes de comparar: "Pré 1" com o acento decomposto (NFD) e a mesma
    // turma, e um backend que normaliza diferente nao pode ser recusado por isso.
    const turmaCrua = typeof cru.turma === 'string' ? cru.turma.normalize('NFC') : ''
    const turma = (TURMAS as readonly string[]).includes(turmaCrua) ? (turmaCrua as Turma) : null
    const alerta = textoOpcional(cru.alerta, LIMITE_ALERTA)
    if (id === null) return c.anotar(linha, 'id do aluno invalido')
    if (nome === null) return c.anotar(linha, 'nome do aluno invalido')
    if (turma === null) return c.anotar(linha, `turma desconhecida: ${amostra(cru.turma)}`)
    if (alerta === null) return c.anotar(linha, 'alerta longo demais')
    if (idsDeAluno.has(id)) return c.anotar(linha, `id de aluno repetido: ${id}`)
    idsDeAluno.add(id)
    alunos.push({ id, nome, turma, temAlerta: alerta !== '' })
    if (alerta !== '') alertas.push({ id, texto: alerta })
  })

  const responsaveis: Responsavel[] = []
  const idsDeResponsavel = new Set<string>()
  responsaveisCrus.forEach((cru, i) => {
    const linha = i + 1
    if (!ehObjeto(cru)) return c.anotar(linha, 'responsavel precisa ser um objeto')
    const id = idValido(cru.id)
    const nome = texto(cru.nome, LIMITE_NOME_RESPONSAVEL)
    const vinculo = textoOpcional(cru.vinculo, LIMITE_VINCULO)
    const telefone = textoOpcional(cru.telefone, LIMITE_TELEFONE)
    if (id === null) return c.anotar(linha, 'id do responsavel invalido')
    if (nome === null) return c.anotar(linha, 'nome do responsavel invalido')
    if (vinculo === null) return c.anotar(linha, 'vinculo do responsavel longo demais')
    if (telefone === null) return c.anotar(linha, 'telefone do responsavel longo demais')
    if (idsDeResponsavel.has(id)) return c.anotar(linha, `id de responsavel repetido: ${id}`)
    idsDeResponsavel.add(id)
    responsaveis.push({ id, nome, vinculo, telefone })
  })

  /*
    Par repetido: impedido vence, como na planilha. Se uma linha diz que o pai
    pode e outra diz que nao pode, a decisao judicial e a que fica.
  */
  const pares = new Map<string, Vinculo>()
  vinculosCrus.forEach((cru, i) => {
    const linha = i + 1
    if (!ehObjeto(cru)) return c.anotar(linha, 'vinculo precisa ser um objeto')
    const alunoId = idValido(cru.alunoId)
    const responsavelId = idValido(cru.responsavelId)
    if (alunoId === null || !idsDeAluno.has(alunoId)) {
      return c.anotar(linha, `vinculo aponta para aluno que nao esta na lista: ${amostra(cru.alunoId)}`)
    }
    if (responsavelId === null || !idsDeResponsavel.has(responsavelId)) {
      return c.anotar(
        linha,
        `vinculo aponta para responsavel que nao esta na lista: ${amostra(cru.responsavelId)}`,
      )
    }
    if (cru.impedido !== undefined && typeof cru.impedido !== 'boolean') {
      return c.anotar(linha, 'impedido precisa ser booleano')
    }
    const chave = `${alunoId} ${responsavelId}`
    const anterior = pares.get(chave)
    const impedido = cru.impedido === true || anterior?.impedido === true
    pares.set(chave, { alunoId, responsavelId, impedido })
  })

  if (c.total > 0) return c.recusa()
  return {
    ok: true,
    versao: versao as number,
    alunos,
    alertas,
    responsaveis,
    vinculos: [...pares.values()],
  }
}

/* ---------- 3.2 Trilha → LogAuditoria ---------- */

/**
 * Um evento da trilha no formato de exportacao. Espelha `EventoAuditoria`
 * com tres diferencas: ganha `seq` (cursor), `quando` em ISO 8601 e o
 * responsavel agrupado num objeto.
 *
 * O NOME desta interface e dos campos e proposta — a confirmar com o backend.
 * O que nao negocia: `seq` monotonico, `de`/`para`, `razao` em codigo (nunca
 * frase), responsavel com id E nome, e a origem "portaria-janelinhas".
 */
export interface LogAuditoria {
  /** SQLite AUTOINCREMENT da tabela `trilha`. Cursor e chave de deduplicacao. */
  seq: number
  /** Mesmo instante de `em`, em ISO 8601 UTC. `em` continua vindo em ms. */
  quando: string
  em: number
  sistema: 'portaria-janelinhas'
  /** `sistema` e a expiracao automatica: ninguem apertou nada. */
  ator: { papel: Papel | 'sistema'; origem: string }
  acao: Acao
  aluno: { id: string; nome: string; turma: Turma }
  de: Estado
  para: Estado
  /** Codigo de `RAZOES_RETORNO`; vazio fora de `retornar`. */
  razao: string
  /** So em `entregar`. Em delegacao, o id vem como `delegacao:<id>`. */
  responsavel: { id: string; nome: string } | null
}

/** Resposta de `GET /trilha?apos=<seq>&limite=<n>`. */
export interface PaginaDaTrilha {
  eventos: LogAuditoria[]
  /**
   * `seq` do ultimo evento devolvido — o que se passa como `apos` na proxima
   * chamada. `null` quando nao veio nada: o backend chegou ao fim.
   */
  proximo: number | null
}

export function comoLogAuditoria(seq: number, e: EventoAuditoria): LogAuditoria {
  return {
    seq,
    quando: new Date(e.em).toISOString(),
    em: e.em,
    sistema: 'portaria-janelinhas',
    ator: { papel: e.papel as Papel | 'sistema', origem: e.origem },
    acao: e.acao,
    aluno: { id: e.alunoId, nome: e.nome, turma: e.turma },
    de: e.de,
    para: e.para,
    razao: e.razao,
    responsavel: e.responsavelId ? { id: e.responsavelId, nome: e.responsavelNome } : null,
  }
}

/* ---------- 3.3 Delegacao "hoje a avo busca" ---------- */

/**
 * Autorizacao TEMPORARIA criada no portal de pais por um responsavel titular.
 * Corpo de `POST /delegacoes`; `DELETE /delegacoes?id=` revoga.
 */
export interface DelegacaoExterna {
  /** Id do backend. */
  id: string
  alunoId: string
  quemBusca: { nome: string; vinculo?: string; telefone?: string }
  /** ISO 8601 com fuso. Ausente: a partir de agora. */
  validoDe?: string
  /** ISO 8601 com fuso. Obrigatorio; no maximo MAXIMO_DIAS_DELEGACAO depois de validoDe. */
  validoAte: string
  /** `ResponsavelExterno.id` do titular que autorizou. Vai para a trilha. */
  autorizadoPor: string
}

/**
 * Como a delegacao aparece para a portaria, dentro da resposta de
 * `/responsaveis` — ao lado dos responsaveis fixos, marcada.
 */
export interface ResponsavelTemporario {
  id: string
  nome: string
  vinculo: string
  telefone?: string
  impedido: boolean
  temporario: true
  autorizadoPor: string
  validoAte: number
}

export interface DelegacaoAnalisada {
  ok: true
  delegacao: Omit<Delegacao, 'autorizadoPorNome'>
}

/*
  Data ISO 8601 COM fuso, obrigatoriamente.

  `Date.parse('2026-09-05T18:00')` sem fuso e interpretado como hora local, e a
  hora local do Worker e UTC: "valido ate as 18h" venceria as 15h de Brasilia,
  com a avo no portao. Um `Z` ou um `-03:00` no fim tira a ambiguidade; sem
  isso, a data e recusada e o backend descobre na hora, nao no portao.
*/
const ISO_COM_FUSO =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/
/*
  A forma INTEIRA, e nao so o sufixo: `Date.parse` aceita RFC 2822, "05/09/2026"
  (lido como 9 de maio) e datas que nao existem — 30/02 virava 2 de marco,
  24:00 virava o dia seguinte, +15:00 passava. Aqui cada campo e conferido, o
  dia contra o mes de verdade, e o deslocamento contra o que existe no mundo.
*/
function instante(valor: unknown): number | null {
  if (typeof valor !== 'string' || valor.length > 40) return null
  const m = ISO_COM_FUSO.exec(valor)
  if (!m) return null
  const ano = Number(m[1])
  const mes = Number(m[2])
  const dia = Number(m[3])
  const hora = Number(m[4])
  const minuto = Number(m[5])
  const segundo = Number(m[6] ?? '0')
  const ms = Number((m[7] ?? '0').padEnd(3, '0'))
  if (mes < 1 || mes > 12 || dia < 1 || hora > 23 || minuto > 59 || segundo > 59) return null
  if (dia > new Date(Date.UTC(ano, mes, 0)).getUTCDate()) return null
  let deslocamento = 0
  if (m[8] !== 'Z') {
    const sinal = m[8][0] === '-' ? -1 : 1
    const dh = Number(m[8].slice(1, 3))
    const dm = Number(m[8].slice(4, 6))
    if (dh > 14 || dm > 59) return null
    deslocamento = sinal * (dh * 60 + dm)
  }
  return Date.UTC(ano, mes - 1, dia, hora, minuto, segundo, ms) - deslocamento * 60_000
}

/** Forma da delegacao. `agora` vem de fora: aqui nao ha relogio. */
export function analisarDelegacaoExterna(
  corpo: unknown,
  agora: number,
): DelegacaoAnalisada | AnaliseRecusada {
  const c = new Coletor()
  if (!ehObjeto(corpo)) {
    c.anotar(0, 'o corpo precisa ser um objeto')
    return c.recusa()
  }

  const idCru = idValido(corpo.id)
  const id = idCru !== null && idCru.length <= LIMITE_ID_DELEGACAO ? idCru : null
  const alunoId = idValido(corpo.alunoId)
  const autorizadoPor = idValido(corpo.autorizadoPor)
  const quem = ehObjeto(corpo.quemBusca) ? corpo.quemBusca : null
  const nome = quem ? texto(quem.nome, LIMITE_NOME_RESPONSAVEL) : null
  const vinculo = quem ? textoOpcional(quem.vinculo, LIMITE_VINCULO) : ''
  const telefone = quem ? textoOpcional(quem.telefone, LIMITE_TELEFONE) : ''
  const validoDe = corpo.validoDe === undefined ? agora : instante(corpo.validoDe)
  const validoAte = instante(corpo.validoAte)

  if (id === null) c.anotar(0, `id invalido (ate ${LIMITE_ID_DELEGACAO} caracteres)`)
  if (alunoId === null) c.anotar(0, 'alunoId invalido')
  if (autorizadoPor === null) c.anotar(0, 'autorizadoPor invalido')
  if (quem === null) c.anotar(0, 'quemBusca precisa ser um objeto')
  else if (nome === null) c.anotar(0, 'quemBusca.nome invalido')
  if (vinculo === null) c.anotar(0, 'quemBusca.vinculo longo demais')
  if (telefone === null) c.anotar(0, 'quemBusca.telefone longo demais')
  if (validoDe === null) c.anotar(0, 'validoDe precisa ser data ISO 8601 com fuso (Z ou -03:00)')
  if (validoAte === null) c.anotar(0, 'validoAte precisa ser data ISO 8601 com fuso (Z ou -03:00)')
  if (validoDe !== null && validoAte !== null) {
    if (validoAte <= agora) c.anotar(0, 'validoAte ja passou')
    if (validoAte <= validoDe) c.anotar(0, 'janela invertida: validoAte antes de validoDe')
    if (validoAte - validoDe > MAXIMO_DIAS_DELEGACAO * UM_DIA) {
      c.anotar(0, `janela longa demais: o maximo e ${MAXIMO_DIAS_DELEGACAO} dias`)
    }
  }

  if (c.total > 0) return c.recusa()
  return {
    ok: true,
    delegacao: {
      id: id as string,
      alunoId: alunoId as string,
      nome: nome as string,
      vinculo: vinculo as string,
      telefone: telefone as string,
      validoDe: validoDe as number,
      validoAte: validoAte as number,
      autorizadoPor: autorizadoPor as string,
    },
  }
}
