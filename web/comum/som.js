/*
  Som sintetizado. Nenhum arquivo de audio no repositorio: funciona offline
  e nao pesa.

  O navegador nao toca audio antes do primeiro gesto do usuario. Por isso
  destravar() precisa ser chamado de dentro de um clique — senao a primeira
  chamada da apresentacao sai muda, que e exatamente o momento que precisa
  funcionar.

  E DEPOIS DO PRIMEIRO GESTO O CONTEXTO PODE SUSPENDER DE NOVO. Aba em segundo
  plano, chamada telefonica, tela bloqueada, economia de bateria: o sistema
  suspende, e a versao anterior deste arquivo so testava `!contexto`. O objeto
  continuava existindo, entao tocarAbertura() executava inteira, agendava as
  notas num contexto parado, e nao saia som — sem nada na tela dizendo isso.
  A professora ficava esperando um aviso que nunca vinha, com o responsavel
  parado no portao.

  Este modulo nao toca no DOM: quem quiser avisar registra um retorno em
  `aoFalharSom`. Assim ele continua servindo a sala, a portaria e a demo, que
  desenham o aviso cada uma do seu jeito.
*/

const CHAVE_MUDO = 'janelinhas:mudo'
const CHAVE_VOLUME = 'janelinhas:volume'

/*
  Tres degraus, nao um controle continuo.

  Quem mexe nisto e uma professora de pe, com a turma esperando, num tablet.
  Tres alvos grandes acertam de primeira; um cursor deslizante exige mira e
  produz "quase inaudivel" por engano — que e a mesma falha que o mudo, so que
  sem nada na tela dizendo.
*/
const VOLUMES = { baixo: 0.45, medio: 1, alto: 1.8 }
const VOLUME_PADRAO = 'medio'

let contexto = null
let mudo = mudoGuardado()
let volume = volumeGuardado()
let avisar = () => {}

/*
  localStorage lanca excecao em aba anonima com armazenamento bloqueado, e o
  padrao de falha aqui e SOM LIGADO: um app que emudece sozinho por causa de
  uma configuracao de privacidade e pior que um que fala demais.
*/
function mudoGuardado() {
  try {
    return localStorage.getItem(CHAVE_MUDO) === 'sim'
  } catch {
    return false
  }
}

function guardarMudo(valor) {
  try {
    localStorage.setItem(CHAVE_MUDO, valor ? 'sim' : 'nao')
  } catch {
    /* sem armazenamento: vale so para esta sessao */
  }
}

function volumeGuardado() {
  try {
    const v = localStorage.getItem(CHAVE_VOLUME)
    // Valida contra os degraus conhecidos: valor adulterado ou de uma versao
    // antiga viraria NaN no ganho, e o oscilador falha em silencio.
    return v && v in VOLUMES ? v : VOLUME_PADRAO
  } catch {
    return VOLUME_PADRAO
  }
}

/** Devolve os degraus disponiveis, na ordem, para a tela montar o controle. */
export function degraus() {
  return Object.keys(VOLUMES)
}

export function volumeAtual() {
  return volume
}

export function definirVolume(degrau) {
  if (!(degrau in VOLUMES)) return volume
  volume = degrau
  try {
    localStorage.setItem(CHAVE_VOLUME, degrau)
  } catch {
    /* sem armazenamento: vale so para esta sessao */
  }
  return volume
}

/** Aplica o degrau escolhido ao ganho base de cada toque. */
function volumeDe(base) {
  return base * (VOLUMES[volume] ?? 1)
}

/**
 * Registra quem recebe o aviso de que o som nao saiu.
 * Chamado com uma mensagem quando falha, e com null quando volta a funcionar.
 */
export function aoFalharSom(retorno) {
  avisar = typeof retorno === 'function' ? retorno : () => {}
}

const AVISO_SUSPENSO = 'O som foi interrompido pelo aparelho. Toque aqui para reativar.'

export function destravar() {
  if (!contexto) {
    const Contexto = window.AudioContext || window.webkitAudioContext
    if (!Contexto) {
      avisar('Este navegador não toca som.')
      return
    }
    contexto = new Contexto()
    /*
      A unica notificacao CONFIAVEL de que o contexto voltou.

      Ver o comentario de acordar(): a promessa do resume() nao serve para
      saber quando ele volta, porque ela pode nunca resolver. O statechange
      dispara de verdade quando o navegador libera o audio — inclusive quando
      a liberacao vem de um gesto em outro lugar da tela, que a promessa
      daquela chamada especifica jamais veria.
    */
    contexto.onstatechange = () => {
      avisar(contexto.state === 'running' ? null : AVISO_SUSPENSO)
    }
  }
  acordar()
}

/*
  Tenta acordar o contexto e RESPONDE NA HORA se ele nao estiver rodando.

  A primeira versao disto fazia `contexto.resume().then(conferir, avisar)`, o
  que parecia certo e nao era: no Chrome, resume() num contexto sem ativacao do
  usuario devolve uma promessa que fica PENDENTE — nao resolve nem rejeita, e
  espera indefinidamente por um gesto. Nenhum dos dois ramos rodava, nenhum
  aviso aparecia, e a tela ficava exatamente tao calada quanto antes da
  correcao. A verificacao em `ferramentas/telas.mjs` pegou isso.

  Por isso o estado e lido de forma sincrona e o aviso sai imediatamente. O
  resume continua sendo tentado, e quem desfaz o aviso e o onstatechange.

  Devolve se o som pode sair agora.
*/
function acordar() {
  if (!contexto) return false
  if (contexto.state === 'running') {
    avisar(null)
    return true
  }
  avisar(AVISO_SUSPENSO)
  try {
    contexto.resume().catch(() => {})
  } catch {
    /* alguns navegadores lancam em vez de rejeitar */
  }
  return false
}

export function estaMudo() {
  return mudo
}

export function alternarMudo() {
  mudo = !mudo
  guardarMudo(mudo)
  /*
    Silenciar tem que apagar o aviso de som interrompido.

    Sem isto a tela ficava dizendo "toque aqui para reativar" depois de a
    professora ter desligado o som de proposito — o app insistindo em consertar
    algo que ela acabou de escolher. E ao religar o aviso volta se o problema
    ainda existir, em vez de ela achar que voltou e nao voltar.
  */
  if (mudo) avisar(null)
  else acordar()
  return mudo
}

function nota(frequencia, atraso, duracao, volume) {
  const comeco = contexto.currentTime + atraso
  const osc = contexto.createOscillator()
  const ganho = contexto.createGain()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(frequencia, comeco)
  ganho.gain.setValueAtTime(0.0001, comeco)
  ganho.gain.exponentialRampToValueAtTime(volume, comeco + 0.025)
  ganho.gain.exponentialRampToValueAtTime(0.0001, comeco + duracao)
  osc.connect(ganho).connect(contexto.destination)
  osc.start(comeco)
  osc.stop(comeco + duracao + 0.05)
}

/*
  Toca, ou diz por que nao tocou.

  Nao ha caminho em que esta funcao termine sem som E sem aviso — era isso que
  acontecia antes, quando a guarda era `if (mudo || !contexto) return`: depois
  do primeiro gesto o objeto existe para sempre, entao a guarda passava, as
  notas eram agendadas num contexto parado, e a sala ficava muda sem sinal.

  Quando o contexto nao esta rodando as notas NAO sao agendadas para depois:
  `nota()` marca o comeco a partir de `currentTime`, que num contexto parado
  nao anda, e um toque que sai tres minutos atrasado chama a professora para
  uma crianca que ja saiu. Melhor o aviso na tela.
*/
function tocar(notas) {
  if (mudo) return
  if (!contexto) {
    avisar('O som ainda não foi ligado nesta tela. Toque aqui para ligar.')
    return
  }
  if (!acordar()) return
  for (const n of notas) nota(...n)
}

/*
  Os dois toques, e por que sao estes.

  Faixa util numa sala com criancas falando: 600 Hz a 2 kHz. Abaixo disso o som
  se perde no ruido de fundo de vinte vozes; acima fica estridente e cansa quem
  ouve dezenas de vezes por tarde. A versao anterior punha a entrega em 392 Hz e
  0,16 s — grave demais para atravessar a sala, e tao curta que se confundia com
  um estalo do proprio tablet.

  Fundamental + quinta justa, sempre. E o intervalo que soa resolvido sem soar
  melodia: nao vira musiquinha que a turma imita, e nao vira alarme. E, por ser
  consonante, duas chamadas quase simultaneas nao produzem batimento aspero.

    abertura  E5 659,25 + B5 987,77   sobe: alguem chegou
    entrega   B5 987,77 + E5 659,25   desce: fechou

  As duas usam as MESMAS duas notas, em ordem trocada. A sala aprende um par de
  sons, nao quatro, e a direcao carrega o significado.

  Duracao total entre 250 ms e 1 s: menos que isso nao registra com barulho de
  fundo, mais que isso ainda esta tocando quando a professora ja olhou.
*/
const ABERTURA = [
  [659.25, 0, 0.32],
  [987.77, 0.14, 0.42],
]

const ENTREGA = [
  [987.77, 0, 0.2],
  [659.25, 0.1, 0.3],
]

/** Duas notas subindo. Alguem chegou no portao. */
export function tocarAbertura() {
  tocar(ABERTURA.map(([f, a, d]) => [f, a, d, volumeDe(0.16)]))
}

/** As mesmas duas notas, descendo. O ciclo fechou. */
export function tocarEntrega() {
  tocar(ENTREGA.map(([f, a, d]) => [f, a, d, volumeDe(0.12)]))
}
