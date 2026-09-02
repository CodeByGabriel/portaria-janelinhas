import { Livro } from './livro.ts'
import { ehPapel, ehAcao, AcaoNaoPermitida, TransicaoInvalida, type Papel } from './estados.ts'
import { TURMAS, type Turma } from './semente.ts'
import { analisar, decodificar } from './importar.ts'
import { Deposito } from './deposito.ts'
import type { Comando, EventoAuditoria } from './protocolo.ts'

interface Sessao {
  ws: WebSocket
  papel: Papel
  turma?: Turma
}

/** Corpo maximo aceito numa importacao. 292 alunos cabem em ~15 KB. */
const LIMITE_CORPO = 1_000_000

/** Teto de conexoes simultaneas. Uma escola tem uma portaria e 11 salas. */
const LIMITE_SESSOES = 200

/** Quantos dias a trilha guarda antes da poda diaria. */
const DIAS_DE_RETENCAO = 90
const UM_DIA = 24 * 60 * 60 * 1000

/*
  Depois de quantas horas uma chamada e considerada esquecida.

  Doze horas nao fecham nada legitimo: a saida mais longa da escola dura
  minutos, e o maior turno nao chega perto disso. Mas atravessam a noite, que e
  o que precisa ser cortado — chamada de ontem no quadro de hoje parece
  responsavel no portao AGORA.
*/
const HORAS_ATE_EXPIRAR = 12
const UMA_HORA = 60 * 60 * 1000

/**
 * Um Durable Object para a escola inteira. Guarda o estado do dia e as
 * conexoes abertas. Toda a regra mora no Livro; aqui so entra rede e disco.
 */
export class Portaria {
  private readonly estado: DurableObjectState
  private readonly deposito: Deposito
  private livro!: Livro
  private readonly sessoes = new Set<Sessao>()

  constructor(estado: DurableObjectState, _env: unknown) {
    this.estado = estado
    this.deposito = new Deposito(estado.storage.sql)

    /*
      blockConcurrencyWhile e para isto e so para isto: garantir que nenhum
      pedido seja entregue antes da hidratacao terminar. As "Rules of Durable
      Objects" avisam para nao usa-lo em operacao normal — ele limita a vazao
      a ~200 req/s — mas a inicializacao e exatamente o caso previsto.
    */
    estado.blockConcurrencyWhile(async () => {
      this.deposito.iniciar()
      this.livro = new Livro(this.deposito.carregar())
      this.expirarEsquecidas()
      await this.agendarPoda()
    })
  }

  /*
    Roda na hidratacao E no alarme diario, de proposito.

    So no alarme, uma chamada esquecida as 17h de sexta ficaria no quadro ate o
    alarme da madrugada — e apareceria para quem abrir a tela no sabado. So na
    hidratacao, um objeto que fica dias acordado nunca limparia. Os dois juntos
    cobrem os dois caminhos, e a operacao e idempotente: o que ja expirou nao
    esta mais no mapa.
  */
  private expirarEsquecidas(): void {
    const agora = Date.now()
    const eventos = this.livro.expirar(agora - HORAS_ATE_EXPIRAR * UMA_HORA, agora)
    for (const evento of eventos) this.persistir(evento)
    // Sem isto, uma tela aberta durante a virada continuaria mostrando a
    // crianca que acabou de sair do quadro — que e o estado que a expiracao
    // existe para desfazer.
    if (eventos.length > 0) this.transmitir()
  }

  /**
   * Escreve no disco o que o Livro acabou de decidir.
   *
   * As escritas ficam juntas, sem `await` entre elas, porque o SQL do Durable
   * Object e sincrono e escritas sem I/O intercalado coalescem numa unica
   * transacao atomica. Intercalar um fetch aqui quebraria essa garantia.
   */
  private persistir(evento: EventoAuditoria): void {
    this.deposito.registrar(evento)
    if (evento.para === 'aguardando' || evento.para === 'entregue') {
      this.deposito.removerChamada(evento.alunoId)
    } else {
      const viva = this.livro
        .retratoPara('portaria')
        .chamadas.find((c) => c.alunoId === evento.alunoId)
      if (viva) this.deposito.salvarChamada(viva)
    }
  }

  private async agendarPoda(): Promise<void> {
    if ((await this.estado.storage.getAlarm()) === null) {
      await this.estado.storage.setAlarm(Date.now() + UM_DIA)
    }
  }

  /**
   * Poda diaria da trilha. Alarms tem execucao at-least-once e podem repetir,
   * entao o handler precisa ser idempotente — apagar o que ja passou do prazo
   * duas vezes da no mesmo.
   */
  async alarm(): Promise<void> {
    this.deposito.podar(Date.now() - DIAS_DE_RETENCAO * UM_DIA)
    this.expirarEsquecidas()
    await this.estado.storage.setAlarm(Date.now() + UM_DIA)
  }

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
        const bytes = await pedido.arrayBuffer()
        // Teto de corpo. Sem ele, o parser percorre caractere a caractere um
        // arquivo de qualquer tamanho — e agora o resultado iria para o disco.
        if (bytes.byteLength > LIMITE_CORPO) {
          return Response.json(
            {
              alunos: 0,
              duplicados: 0,
              erros: [
                {
                  linha: 0,
                  motivo: `planilha grande demais (${Math.round(bytes.byteLength / 1024)} KB; o limite e ${LIMITE_CORPO / 1024} KB)`,
                },
              ],
              errosTotal: 1,
              trocado: false,
            },
            { status: 413 },
          )
        }
        csv = decodificar(bytes)
      } catch {
        return new Response('nao consegui ler a planilha enviada', { status: 400 })
      }

      const resultado = analisar(csv)

      if (resultado.alunos.length === 0) {
        return Response.json(
          {
            alunos: 0,
            duplicados: resultado.duplicados,
            erros: resultado.erros,
            errosTotal: resultado.errosTotal,
            trocado: false,
          },
          { status: 422 },
        )
      }

      try {
        this.livro.substituirCadastro(resultado.alunos)
        this.deposito.trocarCadastro(resultado.alunos, this.livro.versao())
      } catch (erro) {
        // Ha crianca em saida agora. Trocar o cadastro sumiria com ela de
        // todas as telas e deixaria a trilha com um liberar sem entregar.
        return Response.json(
          {
            alunos: 0,
            duplicados: 0,
            erros: [{ linha: 0, motivo: motivoDe(erro) }],
            errosTotal: 1,
            trocado: false,
          },
          { status: 409 },
        )
      }

      this.transmitir()
      return Response.json({
        alunos: resultado.alunos.length,
        duplicados: resultado.duplicados,
        erros: resultado.erros,
        errosTotal: resultado.errosTotal,
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

    if (this.sessoes.size >= LIMITE_SESSOES) {
      return new Response('conexoes demais neste momento', { status: 503 })
    }

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

        const transicao = this.livro.aplicar(
          { tipo: comando.tipo, alunoId },
          Date.now(),
          sessao.papel,
          sessao.turma,
        )
        // Write-through: o Livro decide, o disco registra em seguida. Uma
        // transicao que nao chega ao disco e uma transicao que o proximo
        // reinicio nega ter acontecido.
        this.persistir(transicao)
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
