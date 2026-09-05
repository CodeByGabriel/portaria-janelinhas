/*
  A porta de entrada de um aparelho.

  Ate a fase 2, cada tela dizia quem era pela URL: `?papel=portaria`. Isso nunca
  foi autenticacao — era uma etiqueta que o cliente colava em si mesmo, e
  qualquer pessoa com o endereco virava portaria e baixava o cadastro inteiro.

  Agora a escola emite um token por aparelho, ele e colado UMA vez, e vira um
  cookie que este arquivo nem consegue ler (HttpOnly). Daqui em diante o
  aparelho e a portaria do 3º ano, ou a sala do Pré 2, e nao ha nada na tela
  que mude isso.

  Este modulo nao desenha a tela da escola: ele desenha a porta. Se o aparelho
  ja esta autorizado, ele sai da frente sem aparecer.
*/

/** Pergunta ao servidor quem e este aparelho. `null` quando ninguem. */
export async function quemSou() {
  try {
    const r = await fetch('/eu')
    if (r.ok) return await r.json()
  } catch {
    /*
      Rede fora cai no caminho de NAO AUTORIZADO, que e o seguro.

      A tentacao seria lembrar quem o aparelho era da ultima vez e seguir. Mas
      "nao consegui perguntar" e "voce e a portaria" sao coisas diferentes, e
      tratar a primeira como a segunda e como um aparelho revogado continua
      funcionando enquanto a rede estiver ruim.
    */
  }
  return null
}

/*
  Devolve quem o aparelho e; `null` quando o codigo nao foi reconhecido; e
  `{ falhou }` com a frase certa quando o problema NAO e o codigo.

  Dois casos ficavam invisiveis. Rede fora: o fetch lancava, o `await` do
  chamador subia, e o botao ficava em "Verificando…" para sempre. Teto de
  tentativas (429): a tela dizia "codigo nao reconhecido" para um codigo
  certo, e a secretaria trocava o codigo de um aparelho que so precisava
  esperar quinze minutos.
*/
async function tentarToken(token) {
  let r
  try {
    r = await fetch('/entrar', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
  } catch {
    return { falhou: 'Não consegui falar com o servidor. Confira a rede e tente de novo.' }
  }
  if (r.status === 429) {
    const segundos = Number(r.headers.get('Retry-After')) || 900
    return {
      falhou: `Tentativas demais neste aparelho. Aguarde ${Math.ceil(segundos / 60)} min e tente de novo.`,
    }
  }
  if (!r.ok) return null
  return r.json()
}

/*
  A tarja do modo demonstracao.

  Este servidor pode estar rodando com aparelhos de tokens previsiveis, para as
  ferramentas e para a apresentacao. Um sistema assim que NAO diz isso na tela e
  uma armadilha esperando alguem confundi-lo com producao — entao ele diz, o
  tempo todo, em cima de tudo.
*/
async function marcarModo() {
  try {
    const { demonstracao } = await fetch('/modo').then((r) => r.json())
    if (!demonstracao) return
    const tarja = document.createElement('p')
    tarja.className = 'tarja-demo'
    tarja.textContent =
      'MODO DEMONSTRAÇÃO — os aparelhos deste servidor usam tokens conhecidos. ' +
      'Não use com dados reais de aluno.'
    document.body.prepend(tarja)
    afastarDaTarja()
  } catch {
    /* sem resposta: nao inventa tarja */
  }
}

/*
  A tarja fica em cima de tudo, inclusive da porta — que e fixa e ocupa a tela
  inteira. Sem isto o titulo da porta ficava escondido atras da tarja, e o
  print versionado documentava uma tela com titulo ilegivel. A porta desce o
  tanto que a tarja mede, e so quando ha tarja.
*/
function afastarDaTarja() {
  const tarja = document.querySelector('.tarja-demo')
  for (const porta of document.querySelectorAll('.porta')) {
    porta.style.paddingTop = tarja ? `calc(var(--e-12) + ${tarja.offsetHeight}px)` : ''
  }
}

function desenharPorta(aoEntrar) {
  const caixa = document.createElement('div')
  caixa.className = 'porta'

  const titulo = document.createElement('h2')
  titulo.textContent = 'Autorizar este aparelho'

  const explicacao = document.createElement('p')
  explicacao.textContent =
    'Cole o código que a escola gerou para este tablet. ' +
    'Ele fica guardado aqui e não precisa ser digitado de novo.'

  const rotulo = document.createElement('label')
  rotulo.setAttribute('for', 'token')
  rotulo.textContent = 'Código do aparelho'

  const campo = document.createElement('input')
  campo.id = 'token'
  campo.type = 'text'
  campo.autocomplete = 'off'
  campo.spellcheck = false
  campo.placeholder = 'cole aqui'

  const botao = document.createElement('button')
  botao.className = 'principal larga'
  botao.textContent = 'Autorizar'

  /*
    A recusa e uma so, e nao diz por que.

    Codigo inexistente e codigo revogado devolvem a mesma coisa — o servidor
    tambem. A diferenca seria um oraculo para quem estivesse tentando adivinhar.
  */
  const erro = document.createElement('p')
  erro.className = 'porta-erro'
  erro.setAttribute('role', 'alert')
  erro.hidden = true

  let tentando = false
  const tentar = async () => {
    if (tentando) return
    const token = campo.value.trim()
    if (token === '') return

    tentando = true
    botao.disabled = true
    botao.textContent = 'Verificando…'
    erro.hidden = true

    const quem = await tentarToken(token)

    tentando = false
    botao.disabled = false
    botao.textContent = 'Autorizar'

    if (!quem || quem.falhou) {
      erro.textContent = quem ? quem.falhou : 'Código não reconhecido. Confira com a secretaria.'
      erro.hidden = false
      campo.select()
      return
    }
    caixa.remove()
    aoEntrar(quem)
  }

  botao.onclick = tentar
  campo.onkeydown = (e) => {
    if (e.key === 'Enter') tentar()
  }

  caixa.append(titulo, explicacao, rotulo, campo, erro, botao)
  document.body.prepend(caixa)
  afastarDaTarja()
  campo.focus()
}

/*
  Aparelho autorizado NAO e aparelho certo.

  Um tablet da portaria abrindo /sala/ passava pela porta — ele TEM aparelho — e
  a tela montava com `turma` indefinida. Como a sessao era de portaria, o
  retrato vinha com a escola inteira, e a tela da sala listava criancas de todas
  as turmas. O servidor estava certo o tempo todo: ele respondeu ao papel que
  perguntou. Quem estava errado era a pagina, que perguntou de um jeito e
  desenhou de outro.

  Este aviso e definitivo de proposito: nao ha campo para colar outro codigo. O
  aparelho ja tem um, valido, e o problema e que ele e de outro lugar — quem
  resolve isso e a secretaria, no aparelho certo.
*/
function desenharPapelErrado(quem, esperado) {
  const caixa = document.createElement('div')
  caixa.className = 'porta'

  const titulo = document.createElement('h2')
  titulo.textContent = 'Este aparelho não é desta tela'

  const explicacao = document.createElement('p')
  explicacao.textContent =
    quem.papel === 'portaria'
      ? 'Este tablet foi autorizado como PORTARIA, e esta é a tela de uma sala. ' +
        'Abra a tela da portaria neste aparelho.'
      : `Este tablet foi autorizado como sala (${quem.turma ?? 'sem turma'}), ` +
        'e esta é a tela da portaria.'

  const onde = document.createElement('p')
  onde.className = 'porta-erro'
  onde.textContent = `Esperado: ${esperado}. Autorizado: ${quem.papel}.`

  const link = document.createElement('a')
  link.className = 'principal larga'
  link.href = quem.papel === 'portaria' ? '/portaria/' : '/sala/'
  link.textContent = 'Ir para a tela deste aparelho'
  link.style.textAlign = 'center'

  caixa.append(titulo, explicacao, onde, link)
  document.body.prepend(caixa)
  afastarDaTarja()
}

/**
 * Garante um aparelho autorizado — e do PAPEL certo — antes de a tela existir.
 *
 * Devolve uma promessa que so resolve quando ha sessao valida para esta tela.
 * Enquanto nao ha, a porta fica na frente; se o aparelho e de outro papel, a
 * promessa nunca resolve e a tela nunca monta. E o comportamento correto:
 * melhor uma tela que nao abre do que uma tela que abre mostrando o que nao
 * deveria.
 */
export function exigirAparelho(papelEsperado) {
  marcarModo()
  return new Promise((resolve) => {
    const conferir = (quem) => {
      if (papelEsperado && quem.papel !== papelEsperado) {
        desenharPapelErrado(quem, papelEsperado)
        return
      }
      resolve(quem)
    }
    quemSou().then((quem) => {
      if (quem) return conferir(quem)
      desenharPorta(conferir)
    })
  })
}
