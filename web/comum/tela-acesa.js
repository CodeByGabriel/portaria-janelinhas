/*
  Impede a tela de apagar durante a saida.

  Um tablet de sala apaga sozinho depois de um ou dois minutos parado, e a tela
  da sala fica minutos parada de proposito: ela so muda quando um responsavel
  chega no portao. Quando muda, e o momento em que a professora precisa ver.
  Com a tela apagada ela nao ve o cartao, e o som tambem nao sai — o navegador
  suspende o audio junto (ver `som.js`). Os dois canais caem ao mesmo tempo.

  O bloqueio some sozinho sempre que a aba deixa de estar visivel: trocar de
  aplicativo, atender uma ligacao, ou a propria tela travar. Por isso a
  reaquisicao no `visibilitychange` nao e refinamento, e a metade que faz a
  coisa funcionar num dia de uso.

  Sem DOM aqui: quem avisa a tela e o retorno registrado em `aoMudarTelaAcesa`,
  do mesmo jeito que `som.js`. Assim o modulo serve a sala, a demo e a oficina.
*/

const SUPORTA = typeof navigator !== 'undefined' && 'wakeLock' in navigator

let travaAtual = null
let querendo = false
let avisar = () => {}

/**
 * Registra quem recebe o estado do bloqueio.
 * Chamado com 'ativo', 'inativo' ou 'sem-suporte'.
 */
export function aoMudarTelaAcesa(retorno) {
  avisar = typeof retorno === 'function' ? retorno : () => {}
  avisar(estadoAtual())
}

function estadoAtual() {
  if (!SUPORTA) return 'sem-suporte'
  return travaAtual ? 'ativo' : 'inativo'
}

async function pedir() {
  if (!SUPORTA || !querendo || travaAtual) return
  /*
    O navegador recusa quando a aba nao esta visivel — e recusa lancando, nao
    devolvendo null. Sem o try, um `visibilitychange` disparado no caminho
    errado viraria excecao nao tratada na tela da professora.
  */
  try {
    travaAtual = await navigator.wakeLock.request('screen')
    travaAtual.addEventListener('release', () => {
      travaAtual = null
      avisar(estadoAtual())
      // Nao repede aqui: se a liberacao veio de a aba ter sido escondida, o
      // pedido falharia de novo. Quem repede e o visibilitychange.
    })
  } catch {
    travaAtual = null
  }
  avisar(estadoAtual())
}

/** Liga o bloqueio e passa a mante-lo enquanto a aba estiver em uso. */
export function manterTelaAcesa() {
  querendo = true
  if (!SUPORTA) {
    avisar('sem-suporte')
    return
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pedir()
    else avisar(estadoAtual())
  })
  pedir()
}

/** Devolve o bloqueio. A tela volta a apagar sozinha. */
export async function soltarTela() {
  querendo = false
  const trava = travaAtual
  travaAtual = null
  if (trava) {
    try {
      await trava.release()
    } catch {
      /* ja solta */
    }
  }
  avisar(estadoAtual())
}
