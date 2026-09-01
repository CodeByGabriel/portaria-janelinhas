import { Livro } from './livro.ts'
import type { Papel } from './estados.ts'
import type { Turma } from './semente.ts'
import { TURMAS } from './semente.ts'
import type { Comando } from './protocolo.ts'

interface Sessao {
  ws: WebSocket
  papel: Papel
  turma?: Turma
}

/**
 * Um Durable Object para a escola inteira. Guarda o estado do dia e as
 * conexoes abertas. Toda a regra mora no Livro; aqui so entra rede.
 */
export class Portaria {
  private readonly livro = new Livro()
  private readonly sessoes = new Set<Sessao>()

  constructor(_estado: DurableObjectState, _env: unknown) {}

  async fetch(pedido: Request): Promise<Response> {
    const url = new URL(pedido.url)

    if (url.pathname === '/alunos') {
      return Response.json(this.livro.alunos())
    }

    if (url.pathname === '/registro') {
      return Response.json(this.livro.registro())
    }

    if (url.pathname !== '/ws') {
      return new Response('nao encontrado', { status: 404 })
    }

    if (pedido.headers.get('Upgrade') !== 'websocket') {
      return new Response('esperava upgrade para websocket', { status: 426 })
    }

    const papel: Papel = url.searchParams.get('papel') === 'sala' ? 'sala' : 'portaria'
    const turmaBruta = url.searchParams.get('turma')
    const turma = TURMAS.find((t) => t === turmaBruta)

    const par = new WebSocketPair()
    const cliente = par[0]
    const servidor = par[1]
    servidor.accept()

    const sessao: Sessao = { ws: servidor, papel, turma }
    this.sessoes.add(sessao)

    servidor.addEventListener('message', (evento: MessageEvent) => {
      try {
        const comando = JSON.parse(String(evento.data)) as Comando
        this.livro.aplicar(comando, Date.now())
        this.transmitir()
      } catch (erro) {
        servidor.send(
          JSON.stringify({
            tipo: 'recusa',
            alunoId: '',
            motivo: erro instanceof Error ? erro.message : 'erro desconhecido',
          }),
        )
      }
    })

    const encerrar = () => {
      this.sessoes.delete(sessao)
    }
    servidor.addEventListener('close', encerrar)
    servidor.addEventListener('error', encerrar)

    servidor.send(JSON.stringify(this.livro.retratoPara(papel, turma, Date.now())))

    return new Response(null, { status: 101, webSocket: cliente })
  }

  private transmitir(): void {
    const agora = Date.now()
    for (const sessao of this.sessoes) {
      try {
        sessao.ws.send(
          JSON.stringify(this.livro.retratoPara(sessao.papel, sessao.turma, agora)),
        )
      } catch {
        this.sessoes.delete(sessao)
      }
    }
  }
}
