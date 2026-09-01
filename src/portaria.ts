import { Livro } from './livro.ts'
import { ehPapel, ehAcao, AcaoNaoPermitida, TransicaoInvalida, type Papel } from './estados.ts'
import { TURMAS, type Turma } from './semente.ts'
import { analisar, decodificar } from './importar.ts'
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
    const papelBruto = url.searchParams.get('papel')

    /*
      Papel fail-closed.

      A versao anterior fazia `papel === 'sala' ? 'sala' : 'portaria'`, entao
      "Sala", "SALA", " sala", "professora", vazio e ausente TODOS viravam
      portaria — e portaria enxerga a escola inteira. Uma maiuscula num
      bookmark do tablet expunha nome, turma e estado de saida de todas as
      criancas, sem nenhum sinal de erro na tela.

      Agora: papel invalido nao entra. Errar da erro visivel, nao acesso
      ampliado silencioso.
    */
    if (!ehPapel(papelBruto)) {
      return new Response(
        'informe papel=portaria ou papel=sala (exatamente, em minusculas)',
        { status: 400 },
      )
    }
    const papel: Papel = papelBruto

    /*
      Estas rotas devolvem dado de crianca. Nao ha autenticacao na vitrine
      (esta fora de escopo pelo spec), mas o filtro por papel nao esta fora
      de escopo — o spec o chama de decisao de privacidade central. Exigir o
      papel nao e seguranca de verdade; e o minimo que impede um link colado
      num grupo, um crawler ou um preview bot de baixar o cadastro inteiro
      pela URL publica do ngrok.

      TODO(fase2): autenticacao de verdade antes de qualquer dado real.
    */
    if (url.pathname === '/alunos') {
      if (papel !== 'portaria') return new Response('so a portaria busca alunos', { status: 403 })
      return Response.json(this.livro.alunos())
    }

    if (url.pathname === '/registro') {
      if (papel !== 'portaria') return new Response('so a portaria le o registro', { status: 403 })
      return Response.json(this.livro.registro())
    }

    if (url.pathname === '/importar') {
      /*
        Todo retorno antecipado precisa descartar o corpo antes de responder.
        Abandonar o fluxo faz o runtime reclamar com "Can't read from request
        stream after response has been sent" — apareceu no log do wrangler.
      */
      if (pedido.method !== 'POST') {
        await descartar(pedido)
        return new Response('use POST', { status: 405 })
      }
      if (papel !== 'portaria') {
        await descartar(pedido)
        return new Response('so a portaria importa', { status: 403 })
      }

      let csv: string
      try {
        // Bytes crus, nao text(): text() assume UTF-8 e o Excel pt-BR grava
        // ANSI. decodificar() tenta UTF-8 estrito e cai para Windows-1252.
        csv = decodificar(await pedido.arrayBuffer())
      } catch {
        return new Response('nao consegui ler a planilha enviada', { status: 400 })
      }

      const resultado = analisar(csv)

      if (resultado.alunos.length === 0) {
        return Response.json(
          { alunos: 0, duplicados: resultado.duplicados, erros: resultado.erros, trocado: false },
          { status: 422 },
        )
      }

      try {
        this.livro.substituirCadastro(resultado.alunos)
      } catch (erro) {
        // Ha crianca em saida agora. Trocar o cadastro sumiria com ela de
        // todas as telas e deixaria a trilha com um liberar sem entregar.
        return Response.json(
          { alunos: 0, duplicados: 0, erros: [{ linha: 0, motivo: motivoDe(erro) }], trocado: false },
          { status: 409 },
        )
      }

      this.transmitir()
      return Response.json({
        alunos: resultado.alunos.length,
        duplicados: resultado.duplicados,
        erros: resultado.erros,
        trocado: true,
      })
    }

    if (url.pathname !== '/ws') {
      return new Response('nao encontrado', { status: 404 })
    }

    if (pedido.headers.get('Upgrade') !== 'websocket') {
      return new Response('esperava upgrade para websocket', { status: 426 })
    }

    const turmaBruta = url.searchParams.get('turma')
    const turma = TURMAS.find((t) => t === turmaBruta)

    const par = new WebSocketPair()
    const cliente = par[0]
    const servidor = par[1]
    servidor.accept()

    const sessao: Sessao = { ws: servidor, papel, turma }
    this.sessoes.add(sessao)

    servidor.addEventListener('message', (evento: MessageEvent) => {
      let alunoId = ''
      try {
        const cru: unknown = JSON.parse(String(evento.data))
        if (typeof cru !== 'object' || cru === null || Array.isArray(cru)) {
          throw new Error('comando precisa ser um objeto')
        }
        const comando = cru as Partial<Comando>
        if (!ehAcao(comando.tipo)) throw new Error('acao desconhecida')
        if (typeof comando.alunoId !== 'string') throw new Error('alunoId precisa ser texto')
        // Teto no id: ele volta na mensagem de recusa. Sem limite, um cliente
        // manda 50 mil caracteres e recebe 50 mil de volta.
        if (comando.alunoId.length > 64) throw new Error('alunoId longo demais')
        alunoId = comando.alunoId

        this.livro.aplicar(
          { tipo: comando.tipo, alunoId },
          Date.now(),
          sessao.papel,
          sessao.turma,
        )
        this.transmitir()
      } catch (erro) {
        servidor.send(JSON.stringify({ tipo: 'recusa', alunoId, motivo: motivoDe(erro) }))
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

/**
 * So deixa sair mensagem que a gente escreveu. Erro interno cru vazando para
 * o cliente ja apareceu como "Cannot read properties of null" na tela da
 * professora — texto que nao ajuda ninguem e conta como o servidor e por dentro.
 */
/** Consome e joga fora o corpo, para nao deixar fluxo aberto ao responder cedo. */
async function descartar(pedido: Request): Promise<void> {
  try {
    await pedido.body?.cancel()
  } catch {
    // corpo ja consumido ou inexistente: nada a fazer
  }
}

function motivoDe(erro: unknown): string {
  const permitido = /desconhecid|precisa ser|em saida|outra turma|declarar a turma|longo demais/
  if (erro instanceof AcaoNaoPermitida) return erro.message.slice(0, 120)
  if (erro instanceof TransicaoInvalida) return erro.message.slice(0, 120)
  if (erro instanceof Error && permitido.test(erro.message)) {
    return erro.message.slice(0, 120)
  }
  return 'comando recusado'
}
