/*
  A mesma regra de src/busca.ts, em JavaScript, porque o navegador nao importa
  .ts.

  As duas copias tem que mudar juntas — e agora existe teste cobrando isso
  (`src/paridade.test.ts`), pelo mesmo motivo do `estados.js`: "tem que" escrito
  num comentario nao para ninguem, e uma copia atrasada aqui significa a
  portaria buscando por uma regra e o servidor guardando por outra.

  Escola brasileira: a portaria digita "thais" e precisa achar "Thaís", e "ana"
  precisa achar "Maria Sant'Ana".
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

export function normalizar(texto) {
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

/*
  Onde, dentro do nome, os termos casaram. Menor e melhor.

  Quem opera digita o que ouve, e o que se ouve no portao e o primeiro nome.
  Somando os indices das partes que casaram, "Silvana Rocha" (indice 0) fica
  acima de "Ana Silva" (indice 1) para a consulta "silva".
*/
function proximidade(partes, termos) {
  let soma = 0
  for (const termo of termos) {
    const i = partes.findIndex((parte) => parte.startsWith(termo))
    if (i < 0) return Number.POSITIVE_INFINITY
    soma += i
  }
  return soma
}

/**
 * Devolve { achados, total, homonimos }.
 *
 * `total` existe para a tela nunca truncar em silencio. `homonimos` traz os ids
 * dos achados cujo nome se repete no CADASTRO inteiro — nao so nos resultados:
 * se o corte deixou a outra Maria Eduarda de fora, a que aparece continua
 * precisando de aviso, e e justo esse o caso em que ninguem desconfia.
 */
export function buscar(alunos, consulta, limite = 8) {
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

  const quantos = new Map()
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
