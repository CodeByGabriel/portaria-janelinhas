export type Estado = 'aguardando' | 'chamado' | 'liberado' | 'entregue'
export type Acao = 'chamar' | 'liberar' | 'entregar' | 'cancelar'
export type Papel = 'portaria' | 'sala'

export const DONO: Record<Acao, Papel> = {
  chamar: 'portaria',
  liberar: 'sala',
  entregar: 'portaria',
  cancelar: 'portaria',
}

export class TransicaoInvalida extends Error {
  readonly de: Estado
  readonly acao: Acao

  constructor(de: Estado, acao: Acao) {
    super(`nao e possivel "${acao}" a partir de "${de}"`)
    this.name = 'TransicaoInvalida'
    this.de = de
    this.acao = acao
  }
}

const MAPA: Partial<Record<Estado, Partial<Record<Acao, Estado>>>> = {
  aguardando: { chamar: 'chamado' },
  chamado: { liberar: 'liberado', cancelar: 'aguardando' },
  liberado: { entregar: 'entregue' },
}

export function proximo(de: Estado, acao: Acao): Estado {
  const destino = MAPA[de]?.[acao]
  if (!destino) throw new TransicaoInvalida(de, acao)
  return destino
}
