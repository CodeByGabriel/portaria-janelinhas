/*
  Som sintetizado. Nenhum arquivo de audio no repositorio: funciona offline
  e nao pesa.

  O navegador nao toca audio antes do primeiro gesto do usuario. Por isso
  destravar() precisa ser chamado de dentro de um clique — senao a primeira
  chamada da apresentacao sai muda, que e exatamente o momento que precisa
  funcionar.
*/

let contexto = null
let mudo = false

export function destravar() {
  if (!contexto) {
    const Contexto = window.AudioContext || window.webkitAudioContext
    if (!Contexto) return
    contexto = new Contexto()
  }
  if (contexto.state === 'suspended') contexto.resume()
}

export function estaMudo() {
  return mudo
}

export function alternarMudo() {
  mudo = !mudo
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

/** Duas notas quentes, subindo. A janelinha abriu. */
export function tocarAbertura() {
  if (mudo || !contexto) return
  nota(587.33, 0, 0.34, 0.16)
  nota(880.0, 0.15, 0.46, 0.13)
}

/** Toque seco e curto. O ciclo fechou. */
export function tocarEntrega() {
  if (mudo || !contexto) return
  nota(392.0, 0, 0.16, 0.11)
}
