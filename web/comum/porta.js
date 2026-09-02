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

async function tentarToken(token) {
  const r = await fetch('/entrar', {
    method: 'POST',
    body: JSON.stringify({ token }),
  })
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
  } catch {
    /* sem resposta: nao inventa tarja */
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

    if (!quem) {
      erro.textContent = 'Código não reconhecido. Confira com a secretaria.'
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
  campo.focus()
}

/**
 * Garante um aparelho autorizado antes de a tela existir.
 *
 * Devolve uma promessa que so resolve quando ha sessao — e enquanto nao ha, a
 * porta fica na frente. Nenhuma tela precisa saber disto: ela pede quem e, e
 * recebe quando existir.
 */
export function exigirAparelho() {
  marcarModo()
  return new Promise((resolve) => {
    quemSou().then((quem) => {
      if (quem) return resolve(quem)
      desenharPorta(resolve)
    })
  })
}
