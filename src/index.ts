export { Portaria } from './portaria.ts'

const DO_PORTARIA = new Set([
  '/ws',
  '/registro',
  '/alunos',
  '/importar',
  '/alerta',
  '/entrar',
  '/sair',
  '/dispositivos',
  '/modo',
  '/eu',
  '/responsaveis',
  '/irmaos',
  '/importar-responsaveis',
  // Fase 3: o backend fala com o satelite por aqui, com a chave de administracao.
  '/cadastro',
  '/trilha',
  '/delegacoes',
])

export default {
  async fetch(
    pedido: Request,
    env: { PORTARIA: DurableObjectNamespace },
  ): Promise<Response> {
    const url = new URL(pedido.url)

    if (url.pathname === '/saude') return new Response('ok')

    if (DO_PORTARIA.has(url.pathname)) {
      const id = env.PORTARIA.idFromName('escola')
      return env.PORTARIA.get(id).fetch(pedido)
    }

    return new Response('nao encontrado', { status: 404 })
  },
}
