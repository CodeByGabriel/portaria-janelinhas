/*
  A mesma maquina de estados de src/estados.ts, em JavaScript, para o modo
  demo funcionar sem servidor. As duas copias tem que mudar juntas.

  MAPA usa Object.create(null) pelo mesmo motivo do original: com objeto
  literal comum, MAPA['aguardando']['constructor'] resolve na cadeia de
  prototipo, devolve a funcao Object (truthy) e atravessa a maquina inteira.
*/

export const ACOES = ['chamar', 'liberar', 'entregar', 'cancelar']

export const DONO = {
  chamar: 'portaria',
  liberar: 'sala',
  entregar: 'portaria',
  cancelar: 'portaria',
}

export function ehAcao(valor) {
  return typeof valor === 'string' && ACOES.includes(valor)
}

export class TransicaoInvalida extends Error {
  constructor(de, acao) {
    super(`nao e possivel "${acao}" a partir de "${de}"`)
    this.name = 'TransicaoInvalida'
    this.de = de
    this.acao = acao
  }
}

export class AcaoNaoPermitida extends Error {
  constructor(acao, papel) {
    super(`"${acao}" e da ${DONO[acao]}, nao da ${papel}`)
    this.name = 'AcaoNaoPermitida'
    this.acao = acao
    this.papel = papel
  }
}

const MAPA = Object.assign(Object.create(null), {
  aguardando: Object.assign(Object.create(null), { chamar: 'chamado' }),
  chamado: Object.assign(Object.create(null), { liberar: 'liberado', cancelar: 'aguardando' }),
  liberado: Object.assign(Object.create(null), { entregar: 'entregue' }),
})

export function proximo(de, acao) {
  if (!ehAcao(acao)) throw new TransicaoInvalida(de, acao)
  const destino = MAPA[de]?.[acao]
  if (typeof destino !== 'string') throw new TransicaoInvalida(de, acao)
  return destino
}

export function exigirDono(acao, papel) {
  if (!ehAcao(acao)) throw new TransicaoInvalida('aguardando', acao)
  if (DONO[acao] !== papel) throw new AcaoNaoPermitida(acao, papel)
}
