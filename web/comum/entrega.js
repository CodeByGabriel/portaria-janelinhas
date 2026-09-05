/*
  A pergunta que faltava: a quem esta crianca esta sendo entregue.

  Ate a fase 2 a portaria tocava em "Entregar" e o ciclo fechava. A trilha
  registrava que a crianca saiu e nao registrava com quem — e um registro de
  saida que nao responde "a quem" nao serve no dia em que a familia pergunta.

  Agora a portaria escolhe, de uma lista curta, quem esta ali. E o impedido
  aparece na lista, MARCADO e sem poder ser escolhido: some-lo faria a porteira
  concluir que aquele adulto nao foi cadastrado, quando o que existe e uma
  decisao de que ele nao pode levar. A diferenca entre "nao consta" e "nao
  pode" e a unica coisa que importa quando ele esta parado na frente dela.
*/

async function responsaveisDe(alunoId) {
  const r = await fetch(`/responsaveis?alunoId=${encodeURIComponent(alunoId)}`)
  if (!r.ok) throw new Error(`servidor respondeu ${r.status}`)
  return r.json()
}

async function irmaosDe(responsavelId, exceto) {
  try {
    const r = await fetch(
      `/irmaos?responsavelId=${encodeURIComponent(responsavelId)}` +
        `&exceto=${encodeURIComponent(exceto)}`,
    )
    return r.ok ? await r.json() : []
  } catch {
    return []
  }
}

function montarCaixa() {
  const caixa = document.createElement('dialog')
  caixa.className = 'entrega'

  const titulo = document.createElement('h2')
  titulo.textContent = 'Quem está levando?'

  const quem = document.createElement('p')
  quem.className = 'quem'

  const lista = document.createElement('div')
  lista.className = 'quem-pode'

  const irmaos = document.createElement('div')
  irmaos.className = 'irmaos'
  irmaos.hidden = true

  const botoes = document.createElement('div')
  botoes.className = 'botoes'

  const cancelar = document.createElement('button')
  cancelar.className = 'fantasma'
  cancelar.textContent = 'Cancelar'

  botoes.append(cancelar)
  caixa.append(titulo, quem, lista, irmaos, botoes)
  return { caixa, quem, lista, irmaos, cancelar }
}

/**
 * Pergunta a quem entregar, e devolve a escolha.
 *
 * Resolve com `null` quando a portaria desiste, e com
 * `{ responsavelId, tambem }` quando ela escolhe — `tambem` sao os irmaos que
 * ela decidiu chamar junto.
 *
 * Quando a crianca nao tem responsavel cadastrado, devolve `{ responsavelId:
 * null }` sem mostrar nada: a escola pode ainda nao ter subido a segunda
 * planilha, e travar a saida por isso seria parar a escola inteira no meio do
 * turno por uma pendencia administrativa.
 */
export async function escolherResponsavel({ alunoId, nome }) {
  let podem
  try {
    podem = await responsaveisDe(alunoId)
  } catch (erro) {
    /*
      Nao consegui perguntar NAO e "nao ha ninguem cadastrado".

      Seguir aqui gravaria uma entrega sem responsavel numa crianca que talvez
      tenha um impedido — que e precisamente o caso que a 2.1 existe para
      cobrir. Entao a duvida vira recusa, com o motivo escrito.
    */
    return { erro: `Não consegui verificar quem pode levar (${erro.message}).` }
  }

  if (podem.length === 0) return { responsavelId: null, tambem: [] }

  const { caixa, quem, lista, irmaos, cancelar } = montarCaixa()
  quem.textContent = nome

  const selecionados = new Set()

  return new Promise((resolve) => {
    const fechar = (valor) => {
      caixa.close()
      caixa.remove()
      resolve(valor)
    }

    for (const r of podem) {
      const linha = document.createElement('button')
      linha.className = r.impedido ? 'responsavel impedido' : 'responsavel'
      linha.disabled = r.impedido

      const nomeEl = document.createElement('span')
      nomeEl.className = 'nome'
      nomeEl.textContent = r.nome

      const detalhe = document.createElement('span')
      detalhe.className = 'detalhe'
      /*
        A autorizacao temporaria (fase 3) aparece na MESMA lista, dita como
        tal: a porteira precisa saber que e "hoje", e por quem — e a trilha
        vai guardar isso. O impedido continua vencendo, inclusive aqui.
      */
      detalhe.textContent = r.impedido
        ? `${r.vinculo || 'responsável'} — NÃO PODE LEVAR`
        : [
            r.vinculo,
            r.temporario ? `hoje, autorizado por ${r.autorizadoPor}` : '',
            r.telefone,
          ]
            .filter(Boolean)
            .join(' · ')

      linha.append(nomeEl, detalhe)

      if (!r.impedido) {
        linha.onclick = async () => {
          /*
            Irmaos so aparecem DEPOIS da escolha do adulto.

            Perguntar antes exigiria adivinhar por quem — e "irmao" aqui
            significa "outra crianca que ESTE adulto pode levar", nao "mesmo
            sobrenome". Sobrenome erra com familia recomposta; responsavel
            acerta por construcao.
          */
          const outros = await irmaosDe(r.id, alunoId)
          if (outros.length === 0) return fechar({ responsavelId: r.id, tambem: [] })

          lista.hidden = true
          irmaos.hidden = false
          irmaos.replaceChildren()

          const aviso = document.createElement('p')
          aviso.textContent =
            outros.length === 1
              ? `${r.nome} também pode levar esta criança. Chamar junto?`
              : `${r.nome} também pode levar estas crianças. Chamar junto?`
          irmaos.append(aviso)

          for (const irmao of outros) {
            const item = document.createElement('label')
            item.className = 'irmao'
            const marca = document.createElement('input')
            marca.type = 'checkbox'
            marca.onchange = () => {
              if (marca.checked) selecionados.add(irmao.id)
              else selecionados.delete(irmao.id)
            }
            const texto = document.createElement('span')
            texto.textContent = `${irmao.nome} — ${irmao.turma}`
            item.append(marca, texto)
            irmaos.append(item)
          }

          const confirmar = document.createElement('button')
          confirmar.className = 'principal larga'
          confirmar.textContent = 'Entregar'
          confirmar.onclick = () =>
            fechar({ responsavelId: r.id, tambem: [...selecionados] })
          irmaos.append(confirmar)
        }
      }

      lista.append(linha)
    }

    cancelar.onclick = () => fechar(null)
    caixa.addEventListener('cancel', (e) => {
      e.preventDefault()
      fechar(null)
    })

    document.body.append(caixa)
    caixa.showModal()
    cancelar.focus()
  })
}
