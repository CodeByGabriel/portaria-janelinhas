export type Estado = 'aguardando' | 'chamado' | 'liberado' | 'retorno' | 'entregue'
export type Acao = 'chamar' | 'liberar' | 'entregar' | 'cancelar' | 'retornar' | 'encerrar'
export type Papel = 'portaria' | 'sala'

/*
  `ACOES` e `readonly Acao[]`, e por isso esquecer uma acao nova AQUI nao da
  erro de tipo. O efeito seria `ehAcao('retornar') === false`: o botao existe na
  tela, o servidor recusa como acao desconhecida, e a crianca fica presa num
  estado sem saida. `estados.test.ts` compara esta lista com as chaves de DONO
  justamente porque o compilador nao compara.
*/
export const ACOES: readonly Acao[] = [
  'chamar',
  'liberar',
  'entregar',
  'cancelar',
  'retornar',
  'encerrar',
]
export const PAPEIS: readonly Papel[] = ['portaria', 'sala']

/** Quem tem direito de disparar cada acao. Isto e regra, nao documentacao. */
export const DONO: Record<Acao, Papel> = {
  chamar: 'portaria',
  liberar: 'sala',
  entregar: 'portaria',
  cancelar: 'portaria',
  // A professora e quem sabe que a crianca voltou para a sala.
  retornar: 'sala',
  // Sair do retorno afirma algo sobre o PORTAO — tem alguem la, ou nao tem.
  // Quem enxerga o portao e a portaria.
  encerrar: 'portaria',
}

/*
  As razoes do retorno, como lista fechada de CODIGOS.

  Texto livre aqui seria dado pessoal novo sobre uma crianca nomeada, escrito
  por alguem sob pressao, numa trilha que nao tem caminho de correcao:
  `Deposito.registrar()` so faz INSERT, e a unica remocao e a poda da linha
  inteira. Zerar um campo mantendo o evento seria UPDATE, que a trilha
  append-only proibe. O que entrar ali fica os 90 dias, sem conserto — entao o
  argumento "guardamos pouco tempo" nao esta disponivel.

  Lista fechada e a unica opcao validavel fail-closed no servidor, do mesmo
  jeito que `ehAcao` ja e, e a unica cujo dominio inteiro alguem consegue ler
  antes de existir uma linha.

  Sao CODIGOS, nao frases: renomear o rotulo na tela nao pode reescrever o
  passado.

  Nao ha razao de saude. "A crianca passou mal" e dado de saude de titular
  crianca, agrupavel por aluno ao longo de 90 dias, e `docs/lgpd.md` ja proibe
  usar a trilha para avaliar aluno. O detalhe clinico fica no livro de
  ocorrencia da escola. O buraco do "outro" e real e assumido.
*/
export const RAZOES_RETORNO = [
  'esqueceu-material',
  'nao-saiu-com-o-responsavel',
  'a-escola-reteve',
  'outro',
] as const

export type RazaoRetorno = (typeof RAZOES_RETORNO)[number]

export function ehRazaoRetorno(valor: unknown): valor is RazaoRetorno {
  return typeof valor === 'string' && (RAZOES_RETORNO as readonly string[]).includes(valor)
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
  liberado: Object.assign(Object.create(null), { entregar: 'entregue', retornar: 'retorno' }),
  /*
    `retorno` NAO sai por `liberar`.

    A crianca voltou para a sala; ninguem sabe mais se ha alguem no portao. A
    confirmacao da portaria e a premissa inteira deste sistema, entao a saida e
    dela: `chamar` de novo (o responsavel esta la) ou `encerrar` (nao esta).

    E a saida chama-se `encerrar`, nao `cancelar`, porque o invariante escrito
    diz "cancelamento so chamado -> aguardando" — `cancelar` continua com
    exatamente uma aresta.
  */
  retorno: Object.assign(Object.create(null), { chamar: 'chamado', encerrar: 'aguardando' }),
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
