/*
  Cliente do WebSocket, com retentativa de espera crescente.

  Wifi de escola cai no meio da saida. O servidor sempre manda o retrato
  COMPLETO, nunca deltas — entao reconectar e automaticamente correto: chega
  a verdade inteira e a tela redesenha. Nao ha estado a reconciliar.

  A politica de espera e a mesma de src/espera.ts, duplicada aqui porque o
  navegador nao importa .ts. As duas copias tem que mudar juntas.
*/

const TETO_MS = 10000

function esperaDaTentativa(tentativa) {
  if (tentativa < 0) return 500
  return Math.min(500 * 2 ** tentativa, TETO_MS)
}

/*
  Quem e este aparelho NAO viaja mais na URL.

  Ate a fase 2 a conexao levava `?papel=portaria&turma=...` — uma etiqueta que o
  cliente colava em si mesmo. Agora o navegador manda sozinho o cookie do
  aparelho no aperto de mao do WebSocket, e o servidor decide. Nao ha o que
  passar daqui.
*/
export function ligar({ aoRetrato, aoRecusa, aoEstadoDaRede }) {
  let ws = null
  let tentativa = 0
  let vivo = true
  let agendado = null

  function abrir() {
    if (!vivo) return

    const protocolo = location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${protocolo}://${location.host}/ws`)

    ws.onopen = () => {
      tentativa = 0
      aoEstadoDaRede?.('ligado')
    }

    ws.onmessage = (evento) => {
      let dado
      try {
        dado = JSON.parse(evento.data)
      } catch {
        return
      }
      if (dado.tipo === 'retrato') aoRetrato(dado)
      else if (dado.tipo === 'recusa') aoRecusa?.(dado)
    }

    ws.onclose = () => {
      aoEstadoDaRede?.('desligado')
      if (!vivo) return
      agendado = setTimeout(abrir, esperaDaTentativa(tentativa++))
    }

    ws.onerror = () => {
      if (ws && ws.readyState !== WebSocket.CLOSED) ws.close()
    }
  }

  abrir()

  return {
    enviar(comando) {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(comando))
        return true
      }
      return false
    },
    fechar() {
      vivo = false
      if (agendado) clearTimeout(agendado)
      ws?.close()
    },
  }
}
