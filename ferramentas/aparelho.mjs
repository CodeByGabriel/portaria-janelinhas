/*
  Autenticacao de aparelho para as ferramentas.

  Desde a 2.2 o papel nao vem mais da URL: vem de um token por aparelho, num
  cookie. As ferramentas — fim-a-fim, telas, prints, peso, baseline — precisam
  entrar como a portaria ou como uma sala, e todas precisam da mesma coisa.
  Este arquivo e essa coisa.

  Os tokens sao os que o Durable Object semeia quando `MODO_DEMO` esta ligado
  (ver `.dev.vars`). Previsiveis de proposito: uma ferramenta que precisasse de
  um token emitido a cada execucao teria de guardar segredo em algum lugar, e
  esse lugar seria o proximo vazamento.

  O `fetch` do Node NAO guarda cookie sozinho — nao ha jar. Entao aqui o cookie
  e montado a mao, do jeito que o servidor o entende. E o `WebSocket` do Node
  aceita `headers`, verificado: o Cookie chega no aperto de mao igual ao do
  navegador. Um caminho so, para o navegador e para as ferramentas.
*/

/*
  ASCII puro, e nao e detalhe: o token viaja num cookie, e cookie viaja num
  header HTTP. Um "é" ali passa por caminhos que o codificam de formas
  diferentes nas duas pontas, e o resultado e conexao recusada sem que nada
  esteja errado. A regra e a mesma de `tokenDemoDe` em `src/sessao.ts`.
*/
export const TOKEN = {
  portaria: 'demonstracao-portaria-0000',
  sala: (turma) =>
    'demonstracao-sala-' +
    turma
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase(),
}

export const cookieDe = (token) => `janelinhas_dispositivo=${token}`

/** Cabecalhos prontos para `fetch`, ja com o aparelho. */
export const comoAparelho = (token, extras = {}) => ({
  ...extras,
  headers: { ...(extras.headers ?? {}), Cookie: cookieDe(token) },
})

/**
 * Confere que o servidor esta em modo demonstracao antes de usar os tokens.
 *
 * Sem isto, uma ferramenta apontada por engano para um servidor de verdade
 * falharia com "401" espalhado por trinta verificacoes, e alguem passaria a
 * tarde procurando um bug que nao existe. Aqui ela diz o que houve, na
 * primeira linha.
 */
export async function exigirModoDemonstracao(base) {
  const r = await fetch(`${base}/modo`)
  if (!r.ok) throw new Error(`o servidor nao respondeu /modo (${r.status})`)
  const { demonstracao } = await r.json()
  if (!demonstracao) {
    throw new Error(
      'este servidor NAO esta em modo demonstracao, e as ferramentas usam os ' +
        'aparelhos de demonstracao. Rode com o .dev.vars do projeto.',
    )
  }
}
