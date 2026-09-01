/**
 * Politica de retentativa da ligacao com o servidor.
 *
 * Wifi de escola cai. Esta funcao decide quanto esperar antes de tentar de
 * novo: rapido nas primeiras vezes, para que uma queda curta passe
 * despercebida, e com teto para nao martelar o servidor quando a rede
 * estiver fora de verdade.
 *
 * A mesma regra existe em web/comum/ligacao.js, porque o navegador nao
 * importa .ts. As duas copias tem que mudar juntas.
 */
export const TETO_MS = 10_000

export function esperaDaTentativa(tentativa: number): number {
  if (tentativa < 0) return 500
  return Math.min(500 * 2 ** tentativa, TETO_MS)
}
