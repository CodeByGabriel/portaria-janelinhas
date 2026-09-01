export class Portaria {
  constructor(_estado: DurableObjectState, _env: unknown) {}

  async fetch(_pedido: Request): Promise<Response> {
    return new Response('portaria viva')
  }
}

export default {
  async fetch(
    pedido: Request,
    env: { PORTARIA: DurableObjectNamespace },
  ): Promise<Response> {
    const url = new URL(pedido.url)
    if (url.pathname === '/saude') return new Response('ok')
    const id = env.PORTARIA.idFromName('escola')
    return env.PORTARIA.get(id).fetch(pedido)
  },
}
