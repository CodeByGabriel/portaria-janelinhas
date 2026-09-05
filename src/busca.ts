import type { Aluno } from './semente.ts'

/*
  Escrito com escapes \u de proposito. A versao anterior usava as marcas
  combinantes cruas (U+0300 e U+036F) dentro do colchete: funciona, mas sao
  caracteres invisiveis que qualquer formatador, copy-paste ou normalizacao
  Unicode do fonte pode grudar no caractere anterior. O range mudaria em
  silencio e "Thais" deixaria de achar "Thaís" — sem erro, so resultado vazio.
*/
const ACENTOS = /[\u0300-\u036f]/g

/*
  Apostrofo (em todas as formas), hifen e ponto viram espaco, nao somem.

  Sant'Ana, D'Avila, D'Alessandro e Ana-Clara sao nome e sobrenome brasileiros
  comuns. Apagando o apostrofo, "Sant'Ana" vira "santana" e quem digita "ana"
  nao acha. Virando espaco, vira "sant ana" e as duas partes sao buscaveis.

  Escrito com escapes \u pelo mesmo motivo dos acentos logo acima: apostrofos
  sao visualmente identicos entre si e um formatador, um copy-paste ou uma
  normalizacao do fonte troca um pelo outro sem que ninguem veja. Foi
  exatamente o que aconteceu — as duas copias divergiam em
  U+02BC, e as duas telas passaram a normalizar nomes de formas diferentes sem
  nenhum erro em lugar nenhum. Quem pegou foi o teste de paridade.

    U+0027 '   apostrofo reto
    U+2018 '   aspa simples esquerda
    U+2019 '   aspa simples direita — o que o Excel grava
    U+02BC ʼ   letra modificadora apostrofo
    U+2D   -   hifen
    U+2013 –   meia risca
    U+2014 —   travessao
    U+2E   .   ponto
*/
const SEPARADORES = /[\u0027\u2018\u2019\u02bc\u002d\u2013\u2014\u002e]/g
const INVISIVEIS = /[\u00ad\u200b-\u200f\u2060\ufeff]/g

export function normalizar(texto: string): string {
  return texto
    // NFKD, e nao NFD: a ligadura "fi" vira "fi" e o ordinal º vira o.
    .normalize('NFKD')
    .replace(ACENTOS, '')
    // Caracteres de FORMATO invisiveis (largura zero, hifen suave, marcas de
    // direcao, BOM) vem de copy-paste de WhatsApp e Word e faziam "Ana<ZWSP>Souza"
    // ser outra crianca que a busca por sobrenome nao achava.
    .replace(INVISIVEIS, '')
    .replace(SEPARADORES, ' ')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

export interface Achado {
  achados: Aluno[]
  /** Quantos casaram no total, antes do corte. Nunca truncar em silencio. */
  total: number
  /**
   * Ids dos achados que compartilham o nome com outra crianca do CADASTRO.
   *
   * Olha o cadastro inteiro, e nao so os resultados: se ha duas Marias Eduardas
   * e o corte deixou uma de fora, a que aparece continua precisando de aviso —
   * e e justamente esse o caso em que ninguem desconfia.
   */
  homonimos: string[]
}

/**
 * Numa escola de 292 criancas, "Maria Eduarda" repete muito. Cortar em 8 e
 * necessario para a tela do celular, mas cortar SEM DIZER faz o operador
 * concluir que a crianca nao existe — ou tocar numa homonima de outra turma,
 * e af a sala errada e avisada. Por isso o total volta junto.
 */
/*
  Onde, dentro do nome, os termos casaram. Menor e melhor.

  Quem opera digita o que ouve, e o que se ouve no portao e o primeiro nome.
  Somando os indices das partes que casaram, "Silvana Rocha" (indice 0) fica
  acima de "Ana Silva" (indice 1) para a consulta "silva".

  Devolve Infinity quando algum termo nao casa — mas isso nao acontece, porque
  so entram aqui os que ja passaram no filtro.
*/
function proximidade(partes: string[], termos: string[]): number {
  let soma = 0
  for (const termo of termos) {
    const i = partes.findIndex((parte) => parte.startsWith(termo))
    if (i < 0) return Number.POSITIVE_INFINITY
    soma += i
  }
  return soma
}

/**
 * Numa escola de 292 criancas, "Maria Eduarda" repete muito. Cortar em 8 e
 * necessario para a tela do celular, mas cortar SEM DIZER faz o operador
 * concluir que a crianca nao existe — ou tocar numa homonima de outra turma,
 * e af a sala errada e avisada. Por isso o total volta junto.
 *
 * E a ORDEM importa tanto quanto o corte: sem ela os resultados saiam na ordem
 * da planilha, e a crianca obvia podia cair fora das oito primeiras por acaso
 * de posicao no arquivo.
 */
export function buscar(alunos: Aluno[], consulta: string, limite = 8): Achado {
  const termos = normalizar(consulta).split(' ').filter(Boolean)
  if (termos.length === 0) return { achados: [], total: 0, homonimos: [] }

  const casaram = alunos
    .map((aluno) => ({ aluno, partes: normalizar(aluno.nome).split(' ') }))
    .filter(({ partes }) =>
      termos.every((termo) => partes.some((parte) => parte.startsWith(termo))),
    )
    .map((x) => ({ ...x, perto: proximidade(x.partes, termos) }))
    .sort(
      (a, b) =>
        a.perto - b.perto ||
        // Desempate pelo nome: a lista e reconstruida a cada tecla, e resultado
        // que troca de lugar sozinho e botao que foge do dedo.
        a.aluno.nome.localeCompare(b.aluno.nome, 'pt-BR'),
    )

  const achados = casaram.slice(0, limite).map((x) => x.aluno)

  /*
    Homonimo e nome NORMALIZADO repetido: "Thaís Lima" e "THAIS LIMA" sao a
    mesma pessoa para quem digita, e a porteira precisa do mesmo aviso nos dois
    casos. A contagem varre o cadastro inteiro, nao os resultados.
  */
  const quantos = new Map<string, number>()
  for (const a of alunos) {
    const chave = normalizar(a.nome)
    quantos.set(chave, (quantos.get(chave) ?? 0) + 1)
  }

  return {
    achados,
    total: casaram.length,
    homonimos: achados
      .filter((a) => (quantos.get(normalizar(a.nome)) ?? 0) > 1)
      .map((a) => a.id),
  }
}
