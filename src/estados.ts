export type Estado = 'aguardando' | 'chamado' | 'liberado' | 'entregue'
export type Acao = 'chamar' | 'liberar' | 'entregar' | 'cancelar'
export type Papel = 'portaria' | 'sala'

export const ACOES: readonly Acao[] = ['chamar', 'liberar', 'entregar', 'cancelar']
export const PAPEIS: readonly Papel[] = ['portaria', 'sala']

/** Quem tem direito de disparar cada acao. Isto e regra, nao documentacao. */
export const DONO: Record<Acao, Papel> = {
  chamar: 'portaria',
  liberar: 'sala',
  entregar: 'portaria',
  cancelar: 'portaria',
}

export function ehAcao(valor: unknown): valor is Acao {
  return typeof valor === 'string' && (ACOES as readonly string[]).includes(valor)
}

export function ehPapel(valor: unknown): valor is Papel {
  return typeof valor === 'string' && (PAPEIS as readonly string[]).includes(valor)
}

export class TransicaoInvalida extends Error {
  readonly de: Estado
  readonly acao: Acao

  constructor(de: Estado, acao: Acao) {
    super(`nao e possivel "${acao}" a partir de "${de}"`)
    this.name = 'TransicaoInvalida'
    this.de = de
    this.acao = acao
  }
}

export class AcaoNaoPermitida extends Error {
  readonly acao: Acao
  readonly papel: Papel

  constructor(acao: Acao, papel: Papel) {
    super(`"${acao}" e da ${DONO[acao]}, nao da ${papel}`)
    this.name = 'AcaoNaoPermitida'
    this.acao = acao
    this.papel = papel
  }
}

/*
  Objeto sem prototipo, de proposito.

  Com um objeto literal comum, MAPA['aguardando']['constructor'] resolve na
  cadeia de prototipo e devolve a funcao Object — que e truthy. O `if
  (!destino)` nao dispara, proximo() RETORNA em vez de lancar, e uma acao
  inventada atravessa a maquina de estados inteira: grava chamada com estado
  que nao e estado, e corrompe a trilha append-only.

  Object.create(null) mata a classe inteira de ataque na raiz. A validacao
  em ehAcao() e a segunda barreira.
*/
const MAPA: Record<string, Record<string, Estado>> = Object.assign(Object.create(null), {
  aguardando: Object.assign(Object.create(null), { chamar: 'chamado' }),
  chamado: Object.assign(Object.create(null), { liberar: 'liberado', cancelar: 'aguardando' }),
  liberado: Object.assign(Object.create(null), { entregar: 'entregue' }),
})

export function proximo(de: Estado, acao: Acao): Estado {
  if (!ehAcao(acao)) throw new TransicaoInvalida(de, acao)
  const destino = MAPA[de]?.[acao]
  if (typeof destino !== 'string') throw new TransicaoInvalida(de, acao)
  return destino as Estado
}

/**
 * Barreira de papel. A maquina de estados sozinha so impede pular etapa;
 * ela pressupoe que "chamar" veio da portaria. Sem esta verificacao, a
 * pressuposicao nao vale: duas mensagens de um cliente qualquer levam uma
 * crianca de aguardando ate entregue sem ninguem no portao.
 */
export function exigirDono(acao: Acao, papel: Papel): void {
  if (!ehAcao(acao)) throw new TransicaoInvalida('aguardando', acao)
  if (DONO[acao] !== papel) throw new AcaoNaoPermitida(acao, papel)
}
