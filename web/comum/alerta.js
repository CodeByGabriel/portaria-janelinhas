/*
  Alerta de restricao, bloqueante.

  Uma crianca pode ter uma anotacao que muda quem pode leva-la embora: guarda
  compartilhada, decisao judicial, "so a avo materna busca". Este e o maior
  risco juridico do projeto, e a mitigacao barata e esta — mostrar a anotacao
  ANTES da acao, e exigir que a pessoa reconheca.

  O texto NAO vem junto da lista de alunos. Ele e pedido aqui, uma crianca por
  vez, no instante em que alguem esta prestes a agir. `/alunos` despeja o
  cadastro inteiro no navegador, e com a anotacao dentro cada tablet carregaria
  em repouso a situacao familiar da escola toda — uma tela esquecida no balcao
  passaria a expor guarda e conflito de 292 familias em vez de nome e turma.

  Isto e alerta, e nao autorizacao. O sistema nao sabe quem esta no portao
  (Fase 2), entao ele nao pode decidir — so pode garantir que quem decide leu.
*/

const CANCELAR = 'cancelar'
const SEGUIR = 'seguir'

/*
  Falha ao consultar tambem BLOQUEIA.

  Se a rede cair entre a busca e o toque, o app nao sabe se ha restricao. "Nao
  sei" e "nao ha" sao coisas diferentes, e tratar a primeira como a segunda e
  exatamente como uma crianca sai com a pessoa errada. Entao a duvida vira uma
  pergunta na tela, com o motivo escrito.
*/
async function textoDaRestricao(consulta) {
  const resposta = await fetch(`/alerta?${consulta}`)
  if (!resposta.ok) throw new Error(`servidor respondeu ${resposta.status}`)
  const dado = await resposta.json()
  return typeof dado?.texto === 'string' ? dado.texto : ''
}

function montarCaixa() {
  const caixa = document.createElement('dialog')
  caixa.className = 'restricao'

  const titulo = document.createElement('h2')
  const quem = document.createElement('p')
  quem.className = 'quem'
  const texto = document.createElement('p')
  texto.className = 'texto'

  const botoes = document.createElement('div')
  botoes.className = 'botoes'

  /*
    "Voltar" primeiro, e como acao principal.

    Quem abre esta caixa ja estava com o dedo indo para o botao anterior. Pondo
    "continuar" no mesmo lugar, o toque em curso confirmaria a restricao sem
    ninguem ter lido nada — que e o oposto do que a caixa existe para fazer.
  */
  const voltar = document.createElement('button')
  voltar.className = 'principal'
  voltar.textContent = 'Voltar'
  voltar.value = CANCELAR

  const seguir = document.createElement('button')
  seguir.className = 'fantasma'
  seguir.textContent = 'Li e vou continuar'
  seguir.value = SEGUIR

  botoes.append(voltar, seguir)
  caixa.append(titulo, quem, texto, botoes)
  return { caixa, titulo, quem, texto, voltar, seguir }
}

/**
 * Pergunta ao servidor se ha restricao e, havendo, exige reconhecimento.
 *
 * Devolve `true` quando a acao pode seguir. Sem restricao, nao mostra nada e
 * devolve `true` na hora — caixa que aparece sempre e caixa que ninguem le.
 */
export async function podeSeguir({ alunoId, nome, papel, turma, acao }) {
  const parametros = new URLSearchParams({ papel, alunoId })
  if (turma) parametros.set('turma', turma)

  let restricao
  try {
    restricao = await textoDaRestricao(parametros.toString())
  } catch (erro) {
    restricao = `Não consegui verificar se há restrição para esta criança (${erro.message}). Confira na secretaria antes de continuar.`
  }

  if (restricao === '') return true

  const { caixa, titulo, quem, texto, voltar, seguir } = montarCaixa()
  titulo.textContent = 'Atenção: há uma restrição registrada'
  quem.textContent = `${nome} — ${acao}`
  texto.textContent = restricao

  document.body.append(caixa)
  caixa.showModal()
  // O foco começa no botão que NÃO segue.
  voltar.focus()

  return new Promise((resolve) => {
    const fechar = (valor) => {
      caixa.close()
      caixa.remove()
      resolve(valor === SEGUIR)
    }
    voltar.onclick = () => fechar(CANCELAR)
    seguir.onclick = () => fechar(SEGUIR)
    // Esc fecha o <dialog> sozinho, e fechar sem escolher é NÃO seguir.
    caixa.addEventListener('cancel', (e) => {
      e.preventDefault()
      fechar(CANCELAR)
    })
  })
}
