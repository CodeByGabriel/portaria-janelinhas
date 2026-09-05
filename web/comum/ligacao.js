/*
  Cliente do WebSocket, com retentativa de espera crescente.

  Wifi de escola cai no meio da saida. O servidor sempre manda o retrato
  COMPLETO, nunca deltas — entao reconectar e automaticamente correto: chega
  a verdade inteira e a tela redesenha. Nao ha estado a reconciliar.

  A politica de espera e a mesma de src/espera.ts, duplicada aqui porque o
  navegador nao importa .ts. As duas copias tem que mudar juntas.
*/

const TETO_MS = 10000

/*
  Batimento.

  Uma conexao meio-aberta — o wifi caiu sem ninguem fechar o socket — ficava
  "conectado" na tela, com o quadro parado, por minutos: nem o navegador nem o
  servidor percebem sozinhos. A tela pergunta a cada meio minuto; se em 75 s
  nao chegar NADA (retrato, recusa ou a resposta do ping), a conexao e fechada
  daqui e a reconexao normal assume. Setenta e cinco segundos e o pior caso de
  quadro parado; antes, era ate o roteador desistir.
*/
const PING_MS = 30000
const SILENCIO_MAXIMO_MS = 75000

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
  let batimento = null
  let ultimaMensagem = 0

  function pararBatimento() {
    if (batimento) clearInterval(batimento)
    batimento = null
  }

  function abrir() {
    if (!vivo) return

    const protocolo = location.protocol === 'https:' ? 'wss' : 'ws'
    const socket = new WebSocket(`${protocolo}://${location.host}/ws`)
    ws = socket

    socket.onopen = () => {
      tentativa = 0
      ultimaMensagem = Date.now()
      aoEstadoDaRede?.('ligado')
      pararBatimento()
      batimento = setInterval(() => {
        if (socket.readyState !== WebSocket.OPEN) return
        if (Date.now() - ultimaMensagem > SILENCIO_MAXIMO_MS) {
          // Meio-aberta: fecha daqui, e o onclose reconecta.
          socket.close()
          return
        }
        socket.send('{"tipo":"ping"}')
      }, PING_MS)
    }

    socket.onmessage = (evento) => {
      ultimaMensagem = Date.now()
      let dado
      try {
        dado = JSON.parse(evento.data)
      } catch {
        return
      }
      if (dado.tipo === 'retrato') aoRetrato(dado)
      else if (dado.tipo === 'recusa') aoRecusa?.(dado)
      // 'pong' so serve para o batimento, que ja contou a chegada acima.
    }

    socket.onclose = () => {
      pararBatimento()
      aoEstadoDaRede?.('desligado')
      if (!vivo) return
      agendado = setTimeout(abrir, esperaDaTentativa(tentativa++))
    }

    socket.onerror = () => {
      if (socket.readyState !== WebSocket.CLOSED) socket.close()
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
      pararBatimento()
      ws?.close()
    },
  }
}
