import { Livro } from './livro.ts'
import { ehPapel, ehAcao, AcaoNaoPermitida, TransicaoInvalida, type Papel } from './estados.ts'
import { TURMAS, type Turma } from './semente.ts'
import { analisar, decodificar } from './importar.ts'
import { analisarResponsaveis } from './responsaveis.ts'
import { analisarCsv, separadorDo } from './importar.ts'
import { Deposito } from './deposito.ts'
import {
  analisarCadastroExterno,
  analisarDelegacaoExterna,
  comoLogAuditoria,
  idDeDelegacao,
  idExternoValido,
} from './ecossistema.ts'
import type { Comando, EventoAuditoria, Delegacao } from './protocolo.ts'
import {
  NOME_DO_COOKIE,
  cookieApagado,
  cookieDeSessao,
  cookieDo,
  ehSeguro,
  gerarToken,
  impressaoDe,
  sessaoDe,
  tokenDemoDe,
  iguaisEmTempoConstante,
  type Dispositivo,
  type Sessao as Autorizacao,
} from './sessao.ts'

/* Uma conexao VIVA. Nao confundir com `Autorizacao`, que e quem o aparelho e. */
interface Conexao {
  ws: WebSocket
  papel: Papel
  turma?: Turma
  /** A impressao do aparelho, para a revogacao alcancar a conexao ja aberta. */
  impressao: string
  /** Janela corrente do teto de mensagens. */
  mensagens: { desde: number; n: number }
}

/*
  Teto de mensagens por conexao.

  Uma aba em laco, ou um aparelho autorizado mal-intencionado, mandava comandos
  na velocidade da rede e o Durable Object — que e de fila unica — atrasava a
  escola inteira. Cento e vinte em dez segundos e dez vezes o que um dedo
  consegue; acima disso a conexao cai e a tela reconecta sozinha.
*/
const TETO_MENSAGENS = 120
const JANELA_MENSAGENS = 10_000
/** Um comando tem tres campos curtos. Quatro KB e dez vezes isso. */
const LIMITE_COMANDO = 4096

/** Corpo maximo aceito numa importacao. 292 alunos cabem em ~15 KB. */
const LIMITE_CORPO = 1_000_000

/** Teto de conexoes simultaneas. Uma escola tem uma portaria e 11 salas. */
const LIMITE_SESSOES = 200

/** Corpo de uma delegacao. Um adulto, uma crianca, duas datas: cabe em bem menos. */
const LIMITE_CORPO_PEQUENO = 64 * 1024

/** Pagina da trilha exportada (3.2). */
const PAGINA_PADRAO = 500
const PAGINA_MAXIMA = 1000

/*
  Tentativas de entrar, por origem.

  `/entrar` e a unica rota que aceita o token cru, e nao tinha teto: um script
  varria tokens na velocidade da rede. Trinta falhas em quinze minutos e a
  origem espera — para o token ERRADO. O token certo passa sempre: o espaco de
  tokens tem 256 bits, entao quem acerta e quem tem o token, e a escola inteira
  atras de um NAT (uma origem so) nao pode ficar trancada porque alguem errou
  trinta vezes. O que o teto compra e tempo e ruido no log, nao impossibilidade
  matematica. E memoria do objeto — um reinicio zera — e isso basta.
*/
const JANELA_DE_TENTATIVAS = 15 * 60 * 1000
const MAXIMO_DE_FALHAS = 30
const MAXIMO_DE_ORIGENS = 10_000

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
  /*
    Segredos do Worker. `CHAVE_ADMIN` autoriza EMITIR aparelho, e nada mais.

    Sem ela configurada, ninguem emite — nem a portaria. Uma instancia mal
    configurada recusa aparelho novo em vez de aceitar qualquer um, que e o
    lado certo para uma configuracao faltando.
  */
  private readonly env: { CHAVE_ADMIN?: string; MODO_DEMO?: string }
  private readonly deposito: Deposito
  private livro!: Livro
  private readonly sessoes = new Set<Conexao>()
  private readonly falhasDeEntrada = new Map<string, { falhas: number; desde: number }>()

  constructor(estado: DurableObjectState, env: { CHAVE_ADMIN?: string; MODO_DEMO?: string }) {
    this.estado = estado
    this.env = env ?? {}
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
      await this.semearAparelhosDeDemonstracao()
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
      await this.estado.storage.setAlarm(proximaMadrugada(Date.now()))
    }
  }

  /**
   * Poda diaria da trilha. Alarms tem execucao at-least-once e podem repetir,
   * entao o handler precisa ser idempotente — apagar o que ja passou do prazo
   * duas vezes da no mesmo.
   *
   * Reagenda no `finally`: se a poda lancar e a plataforma esgotar as
   * retentativas, o alarme seria descartado e a poda pararia ate o proximo
   * reinicio, em silencio. O handler e idempotente, entao reagendar apos falha
   * e seguro. E o horario e a madrugada — antes, era "a hora do primeiro boot".
   */
  async alarm(): Promise<void> {
    try {
      const corte = Date.now() - DIAS_DE_RETENCAO * UM_DIA
      this.deposito.podar(corte)
      // ...e da memoria, pelo mesmo corte: /registro nao pode servir o que o
      // disco ja nao tem.
      this.livro.podarTrilha(corte)
      // Delegacao vencida ja nao contava na leitura; aqui ela sai do disco.
      this.deposito.podarDelegacoes(Date.now())
      this.livro.substituirDelegacoes(this.deposito.listarDelegacoes())
      this.expirarEsquecidas()
    } finally {
      await this.estado.storage.setAlarm(proximaMadrugada(Date.now()))
    }
  }

  /*
    Aparelhos de demonstracao, e por que eles sao seguros de existir.

    So sao criados quando `MODO_DEMO` vale exatamente "sim", e essa variavel
    mora em `.dev.vars` — um arquivo que o `wrangler dev` le e o `wrangler
    deploy` NAO envia. Nao e disciplina de quem opera; e o mecanismo que
    impede.

    Os tokens sao previsiveis de proposito: as ferramentas de teste, os prints e
    a demonstracao na frente da escola precisam entrar sem ninguem digitar nada.
    Justamente por isso as telas mostram uma tarja permanente quando este modo
    esta ligado — ver `/modo`. Um sistema com tokens conhecidos que NAO diz isso
    na tela e uma armadilha esperando alguem confundi-lo com producao.

    Roda uma vez, quando a tabela esta vazia: reiniciar nao duplica, e revogar
    um aparelho de demonstracao nao o traz de volta.
  */
  private async semearAparelhosDeDemonstracao(): Promise<void> {
    if (this.env.MODO_DEMO !== 'sim') return
    if (this.deposito.contarDispositivos() > 0) return

    const aparelhos: { token: string; papel: Papel; turma?: Turma; apelido: string }[] = [
      { token: 'demonstracao-portaria-0000', papel: 'portaria', apelido: 'portaria (demo)' },
      ...TURMAS.map((turma) => ({
        token: tokenDemoDe(turma),
        papel: 'sala' as Papel,
        turma,
        apelido: `sala ${turma} (demo)`,
      })),
    ]

    for (const a of aparelhos) {
      this.deposito.registrarDispositivo({
        impressao: await impressaoDe(a.token),
        papel: a.papel,
        turma: a.turma,
        apelido: a.apelido,
        criadoEm: Date.now(),
        revogadoEm: null,
      })
    }
  }

  /*
    Troca um token por um cookie de sessao.

    E a unica rota que aceita o token cru, e ela nao diz NADA sobre por que
    recusou: token inexistente e token revogado devolvem a mesma resposta. A
    diferenca seria um oraculo — alguem varrendo tokens saberia quando acertou
    um que ja existiu.

    So POST: um GET com o token na URL cairia no historico do navegador, nos
    logs do proxy da escola e no print que alguem manda no grupo.
  */
  private async entrar(pedido: Request): Promise<Response> {
    if (pedido.method !== 'POST') {
      await descartar(pedido)
      return new Response('use POST', { status: 405 })
    }

    const origem = origemDe(pedido)

    let token = ''
    try {
      const bytes = await pedido.arrayBuffer()
      if (bytes.byteLength > 4096) return new Response('token longo demais', { status: 413 })
      const corpo: unknown = lerJson(bytes)
      if (typeof corpo === 'object' && corpo !== null && 'token' in corpo) {
        const bruto = (corpo as { token: unknown }).token
        if (typeof bruto === 'string') token = bruto.trim()
      }
    } catch {
      return new Response('corpo invalido', { status: 400 })
    }

    const quem =
      token.length < 16 || token.length > 128
        ? null
        : sessaoDe(this.deposito.dispositivoPor(await impressaoDe(token)))

    if (!quem) {
      /*
        O teto vale para o token ERRADO, e so para ele: a origem que ja errou
        demais recebe 429 em vez de 401, e nada mais. O token certo e conferido
        antes de olhar o balde, entao um tablet legitimo atras do mesmo NAT de
        quem esta martelando continua entrando.
      */
      const espera = this.esperaDe(origem)
      if (espera > 0) {
        return new Response('tentativas demais; aguarde', {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(espera / 1000)) },
        })
      }
      this.anotarFalha(origem)
      return new Response('token nao reconhecido', { status: 401 })
    }

    this.falhasDeEntrada.delete(origem)
    return Response.json(
      { papel: quem.papel, turma: quem.turma ?? null, apelido: quem.apelido },
      { headers: { 'Set-Cookie': cookieDeSessao(token, ehSeguro(pedido)) } },
    )
  }

  /*
    Emitir, listar e revogar aparelhos.

    EMITIR exige a chave de administracao, que e um segredo do Worker e nao
    existe em nenhuma tela. Um tablet roubado da portaria nao consegue fabricar
    mais aparelhos — a escalada para. O token aparece UMA vez, na resposta:
    depois disso so existe a impressao dele.

    LISTAR e REVOGAR ficam com a portaria. E uma escolha com custo: um tablet
    roubado da portaria consegue revogar as salas, o que e sabotagem. A
    alternativa era revogacao so pela chave de administracao — e ai, no dia em
    que um aparelho some, a escola depende de alguem achar o notebook certo. Na
    portaria, a secretaria revoga na hora. Sabotagem se desfaz emitindo de novo;
    um aparelho perdido que continua valendo, nao.
  */
  private async dispositivos(pedido: Request): Promise<Response> {
    if (pedido.method === 'POST') {
      /*
        Sem chave configurada, ninguem emite. Fail-closed do lado certo: uma
        instancia mal configurada nao aceita aparelho novo, em vez de aceitar
        qualquer um.
      */
      if (!this.chaveAdminConfere(pedido)) {
        await descartar(pedido)
        return new Response('chave de administracao invalida', { status: 401 })
      }

      let papel = ''
      let turma: string | undefined
      let apelido = ''
      try {
        const bytes = await pedido.arrayBuffer()
        if (bytes.byteLength > LIMITE_CORPO_PEQUENO) {
          return new Response('corpo grande demais', { status: 413 })
        }
        const corpo = lerJson(bytes) as Record<string, unknown>
        papel = String(corpo.papel ?? '')
        apelido = String(corpo.apelido ?? '').replace(/[<>]/g, '').slice(0, 60)
        if (corpo.turma !== undefined && corpo.turma !== null) turma = String(corpo.turma)
      } catch {
        return new Response('corpo invalido', { status: 400 })
      }

      const token = gerarToken()
      const dispositivo: Dispositivo = {
        impressao: await impressaoDe(token),
        papel: papel as Papel,
        turma: turma as Turma | undefined,
        apelido: apelido || 'sem apelido',
        criadoEm: Date.now(),
        revogadoEm: null,
      }

      // Valida ANTES de gravar: dispositivo que nao vira sessao e uma linha que
      // so serve para alguem descobrir depois que o tablet nunca funcionou.
      if (!sessaoDe(dispositivo)) {
        return new Response('papel ou turma invalidos para um aparelho', { status: 422 })
      }

      this.deposito.registrarDispositivo(dispositivo)
      // O token aparece AQUI e nunca mais.
      return Response.json({ token, papel: dispositivo.papel, turma: dispositivo.turma ?? null })
    }

    const quem = await this.autorizacaoDe(pedido)
    if (!quem || quem.papel !== 'portaria') {
      await descartar(pedido)
      return new Response('so a portaria administra aparelhos', { status: 401 })
    }

    if (pedido.method === 'GET') {
      // Sem a impressao inteira: os primeiros caracteres bastam para a pessoa
      // reconhecer qual linha e qual aparelho, e nao ajudam quem quer forjar.
      return Response.json(
        this.deposito.listarDispositivos().map((d) => ({
          referencia: d.impressao.slice(0, 8),
          papel: d.papel,
          turma: d.turma ?? null,
          apelido: d.apelido,
          criadoEm: d.criadoEm,
          revogadoEm: d.revogadoEm,
        })),
      )
    }

    if (pedido.method === 'DELETE') {
      const referencia = new URL(pedido.url).searchParams.get('referencia') ?? ''
      if (!/^[0-9a-f]{8,64}$/.test(referencia)) {
        return new Response('referencia invalida', { status: 400 })
      }
      // Prefixo de 8 hex entre poucos aparelhos nao colide na pratica; se
      // colidir, e recusa, nao "o primeiro que aparecer".
      const candidatos = this.deposito
        .listarDispositivos()
        .filter((d) => d.impressao.startsWith(referencia))
      if (candidatos.length === 0) return new Response('aparelho desconhecido', { status: 404 })
      if (candidatos.length > 1) {
        return new Response('referencia ambigua entre aparelhos; use mais caracteres', {
          status: 409,
        })
      }
      const alvo = candidatos[0]

      const revogou = this.deposito.revogarDispositivo(alvo.impressao, Date.now())
      // Revogar vale AGORA, inclusive para a tela que ja estava aberta.
      const derrubadas = this.derrubarConexoesDe(alvo.impressao)
      return Response.json({ revogado: revogou, conexoesDerrubadas: derrubadas })
    }

    await descartar(pedido)
    return new Response('metodo nao suportado', { status: 405 })
  }

  /*
    A chave de administracao, por cabecalho.

    Aceita `Authorization: Bearer` — o jeito do backend, fase 3 — e
    `X-Chave-Admin`, que /dispositivos ja usava. Sem chave configurada, nada
    confere: fail-closed do lado certo. Comparacao em tempo constante, como
    sempre foi.
  */
  private chaveAdminConfere(pedido: Request): boolean {
    const configurada = this.env.CHAVE_ADMIN
    if (!configurada) return false
    const autorizacao = pedido.headers.get('Authorization') ?? ''
    const portadora = autorizacao.startsWith('Bearer ') ? autorizacao.slice(7).trim() : ''
    const dada = portadora || (pedido.headers.get('X-Chave-Admin') ?? '')
    if (!dada) return false
    return iguaisEmTempoConstante(dada, configurada)
  }

  /** Quanto uma origem ainda precisa esperar para tentar entrar; 0 se pode. */
  private esperaDe(origem: string): number {
    const registro = this.falhasDeEntrada.get(origem)
    if (!registro) return 0
    const restante = registro.desde + JANELA_DE_TENTATIVAS - Date.now()
    if (restante <= 0) {
      this.falhasDeEntrada.delete(origem)
      return 0
    }
    return registro.falhas >= MAXIMO_DE_FALHAS ? restante : 0
  }

  private anotarFalha(origem: string): void {
    const agora = Date.now()
    const registro = this.falhasDeEntrada.get(origem)
    if (!registro || registro.desde + JANELA_DE_TENTATIVAS <= agora) {
      // Sem teto no mapa, uma varredura com origens falsas enche a memoria do
      // objeto. Esvaziar tudo e grosseiro, mas e limitado — e quem estava
      // bloqueado so ganha, no pior caso, mais dez tentativas.
      if (this.falhasDeEntrada.size >= MAXIMO_DE_ORIGENS) this.falhasDeEntrada.clear()
      this.falhasDeEntrada.set(origem, { falhas: 1, desde: agora })
      return
    }
    registro.falhas++
  }

  /*
    3.1 — o cadastro vindo do backend, no lugar da planilha.

    Substituicao completa e atomica, como a planilha: nao ha PATCH por aluno.
    A diferenca que importa e que o id do aluno e o do BACKEND, estavel — e por
    isso o caminho da API nao orfana vinculo nenhum.

    `versao` e do backend e monotonica: repetir a mesma e idempotente (200,
    trocado: false); mandar uma menor e 409. A planilha, quando importada,
    LIMPA a versao externa, para que o proximo envio do backend sempre valha.
    Tudo sincrono depois da validacao: uma transacao so.
  */
  private async cadastro(pedido: Request): Promise<Response> {
    if (!this.chaveAdminConfere(pedido)) {
      await descartar(pedido)
      return new Response('chave de administracao invalida', { status: 401 })
    }

    if (pedido.method === 'GET') {
      return Response.json({
        versao: this.deposito.versaoExterna(),
        interna: this.livro.versao(),
        alunos: this.livro.alunos().length,
      })
    }
    if (pedido.method !== 'PUT') {
      await descartar(pedido)
      return new Response('use PUT', { status: 405 })
    }

    const recusar = (status: number, erros: { linha: number; motivo: string }[]) =>
      Response.json(
        {
          trocado: false,
          versao: this.deposito.versaoExterna(),
          alunos: 0,
          responsaveis: 0,
          vinculos: 0,
          erros,
          errosTotal: erros.length,
        },
        { status },
      )

    let corpo: unknown
    try {
      const bytes = await pedido.arrayBuffer()
      if (bytes.byteLength > LIMITE_CORPO) {
        return recusar(413, [
          {
            linha: 0,
            motivo: `cadastro grande demais (${Math.round(bytes.byteLength / 1024)} KB; o limite e ${LIMITE_CORPO / 1024} KB)`,
          },
        ])
      }
      corpo = lerJson(bytes)
    } catch {
      return recusar(400, [{ linha: 0, motivo: 'corpo nao e JSON valido' }])
    }

    const analise = analisarCadastroExterno(corpo)
    if (!analise.ok) {
      return Response.json(
        {
          trocado: false,
          versao: this.deposito.versaoExterna(),
          alunos: 0,
          responsaveis: 0,
          vinculos: 0,
          erros: analise.erros,
          errosTotal: analise.errosTotal,
        },
        { status: 422 },
      )
    }

    const contagens = {
      alunos: analise.alunos.length,
      responsaveis: analise.responsaveis.length,
      vinculos: analise.vinculos.length,
    }
    const vigente = this.deposito.versaoExterna()
    if (vigente !== null) {
      if (analise.versao === vigente) {
        return Response.json({ trocado: false, versao: vigente, ...contagens, erros: [], errosTotal: 0 })
      }
      if (analise.versao < vigente) {
        return recusar(409, [
          { linha: 0, motivo: `versao ${analise.versao} e anterior a vigente (${vigente})` },
        ])
      }
    }

    try {
      // Recusa com crianca em saida — o mesmo 409 da planilha, pelo mesmo motivo.
      this.livro.substituirCadastro(analise.alunos)
    } catch (erro) {
      return recusar(409, [{ linha: 0, motivo: motivoDe(erro) }])
    }
    this.deposito.trocarCadastro(analise.alunos, this.livro.versao(), analise.alertas)
    this.deposito.trocarResponsaveis(analise.responsaveis, analise.vinculos)
    this.deposito.podarDelegacoesOrfas()
    this.deposito.gravarVersaoExterna(analise.versao)
    this.livro.substituirResponsaveis(analise.responsaveis, analise.vinculos)
    this.livro.substituirDelegacoes(this.deposito.listarDelegacoes())

    this.transmitir()
    return Response.json({ trocado: true, versao: analise.versao, ...contagens, erros: [], errosTotal: 0 })
  }

  /*
    3.2 — a trilha por cursor, para o backend puxar.

    Nao passa pelo Livro: o cursor e o `seq` do disco, e o Livro nao o conhece
    de proposito — ele e detalhe de armazenamento. `/registro` continua sendo a
    leitura da portaria; esta e a do backend.
  */
  private async trilha(pedido: Request): Promise<Response> {
    if (!this.chaveAdminConfere(pedido)) {
      await descartar(pedido)
      return new Response('chave de administracao invalida', { status: 401 })
    }
    if (pedido.method !== 'GET') {
      await descartar(pedido)
      return new Response('use GET', { status: 405 })
    }
    const url = new URL(pedido.url)
    const apos = inteiroDe(url.searchParams.get('apos'), 0, 0, Number.MAX_SAFE_INTEGER)
    const limite = inteiroDe(url.searchParams.get('limite'), PAGINA_PADRAO, 1, PAGINA_MAXIMA)
    if (apos === null || limite === null) {
      return new Response(
        `apos precisa ser inteiro nao negativo; limite, inteiro entre 1 e ${PAGINA_MAXIMA}`,
        { status: 400 },
      )
    }
    const eventos = this.deposito.trilhaDepois(apos, limite).map((e) => comoLogAuditoria(e.seq, e))
    return Response.json({
      eventos,
      proximo: eventos.length > 0 ? eventos[eventos.length - 1].seq : null,
    })
  }

  /*
    3.3 — delegacao "hoje a avo busca".

    O backend cria e revoga; as regras (quem autoriza, impedido vence, janela)
    estao no Livro. Revogar e idempotente: um retry do backend nao pode falhar
    por ter funcionado da primeira vez.
  */
  private async delegacoes(pedido: Request): Promise<Response> {
    if (!this.chaveAdminConfere(pedido)) {
      await descartar(pedido)
      return new Response('chave de administracao invalida', { status: 401 })
    }

    if (pedido.method === 'DELETE') {
      // A mesma validacao da criacao: o id que nao entraria nao e procurado.
      const id = idExternoValido(new URL(pedido.url).searchParams.get('id'))
      if (id === null) return new Response('id invalido', { status: 400 })
      this.livro.removerDelegacao(id)
      this.deposito.removerDelegacao(id)
      return new Response(null, { status: 204 })
    }
    if (pedido.method !== 'POST') {
      await descartar(pedido)
      return new Response('use POST ou DELETE', { status: 405 })
    }

    let corpo: unknown
    try {
      const bytes = await pedido.arrayBuffer()
      if (bytes.byteLength > LIMITE_CORPO_PEQUENO) {
        return Response.json(
          { erros: [{ linha: 0, motivo: 'corpo grande demais' }], errosTotal: 1 },
          { status: 413 },
        )
      }
      corpo = lerJson(bytes)
    } catch {
      return Response.json(
        { erros: [{ linha: 0, motivo: 'corpo nao e JSON valido' }], errosTotal: 1 },
        { status: 400 },
      )
    }

    const agora = Date.now()
    const analise = analisarDelegacaoExterna(corpo, agora)
    if (!analise.ok) {
      return Response.json({ erros: analise.erros, errosTotal: analise.errosTotal }, { status: 422 })
    }

    let completa: Delegacao
    try {
      completa = this.livro.adicionarDelegacao(analise.delegacao, agora)
    } catch (erro) {
      return Response.json(
        { erros: [{ linha: 0, motivo: motivoDe(erro) }], errosTotal: 1 },
        { status: 422 },
      )
    }
    this.deposito.salvarDelegacao(completa, agora)

    return Response.json(
      {
        id: completa.id,
        responsavelId: idDeDelegacao(completa.id),
        autorizadoPor: completa.autorizadoPorNome,
        validoAte: new Date(completa.validoAte).toISOString(),
      },
      { status: 201 },
    )
  }

  /**
   * Quem e este aparelho — a UNICA fonte de identidade do sistema.
   *
   * Antes vinha da query string (`?papel=portaria`), o que nunca foi
   * autenticacao: era uma etiqueta que o cliente colava em si mesmo. Agora vem
   * do cookie, que o JavaScript da pagina nao le, e da tabela de dispositivos,
   * onde revogar tem efeito imediato.
   */
  private async autorizacaoDe(pedido: Request): Promise<Autorizacao | null> {
    const token = cookieDo(pedido, NOME_DO_COOKIE)
    if (!token || token.length < 16 || token.length > 128) return null
    return sessaoDe(this.deposito.dispositivoPor(await impressaoDe(token)))
  }

  async fetch(pedido: Request): Promise<Response> {
    const resposta = await this.responder(pedido)
    /*
      Corpo que ninguem leu e lido AQUI, antes de a resposta sair.

      O runtime reclama — "Can't read from request stream after response has
      been sent", como excecao nao tratada no log — toda vez que uma resposta
      sai com o corpo do pedido por consumir. Acontecia em todo retorno
      antecipado com corpo (405, 403, 401, 429) e em toda rota que ignora o
      corpo (um POST em /alunos). Cancelar o fluxo NAO resolve; so ler resolve.
      Um lugar so, para nenhuma rota nova precisar lembrar disto.
    */
    if (pedido.body && !pedido.bodyUsed) await descartar(pedido)
    /*
      Nada daqui pode ser guardado por proxy ou navegador: e cadastro, trilha,
      restricao, responsavel. Um lugar so, para nenhuma rota esquecer.
    */
    if (resposta.status === 101) return resposta
    const semCache = new Response(resposta.body, resposta)
    semCache.headers.set('Cache-Control', 'no-store')
    return semCache
  }

  private async responder(pedido: Request): Promise<Response> {
    const url = new URL(pedido.url)

    /*
      As rotas de porta de entrada vem ANTES da verificacao, porque sao elas
      que a produzem. Tudo o mais abaixo exige aparelho autorizado.
    */
    if (url.pathname === '/entrar') return this.entrar(pedido)
    if (url.pathname === '/sair') {
      /*
        So POST, e so quem tem cookie. Como GET aberto, um link colado num
        grupo — ou uma imagem <img src="/sair"> em qualquer pagina — apagava o
        cookie do tablet: a professora abria a tela e encontrava a porta pedindo
        codigo, no meio da saida. O cookie e SameSite=Strict, entao um POST de
        outro site chega sem ele e recebe 401 sem Set-Cookie nenhum.
      */
      if (pedido.method !== 'POST') return new Response('use POST', { status: 405 })
      if (!cookieDo(pedido, NOME_DO_COOKIE)) {
        return new Response('nenhum aparelho para sair', { status: 401 })
      }
      return new Response(null, {
        status: 204,
        headers: { 'Set-Cookie': cookieApagado(ehSeguro(pedido)) },
      })
    }
    if (url.pathname === '/dispositivos') return this.dispositivos(pedido)

    /*
      Fase 3: o backend fala com o satelite por aqui. Sem cookie de aparelho —
      e um sistema, nao um tablet — e com a chave de administracao, que ja era
      o segredo entre a escola e este servico.
    */
    if (url.pathname === '/cadastro') return this.cadastro(pedido)
    if (url.pathname === '/trilha') return this.trilha(pedido)
    if (url.pathname === '/delegacoes') return this.delegacoes(pedido)

    /*
      Se este servidor esta em modo demonstracao.

      Aberta de proposito, e sem revelar nada: a resposta e um booleano que
      qualquer pessoa ja poderia descobrir tentando um token conhecido. Ela
      existe para a TELA poder anunciar o modo — um sistema com tokens
      previsiveis que nao diz isso e uma armadilha.
    */
    if (url.pathname === '/modo') {
      return soLeitura(pedido) ?? Response.json({ demonstracao: this.env.MODO_DEMO === 'sim' })
    }

    const quem = await this.autorizacaoDe(pedido)

    /*
      Quem sou eu — a pergunta que a tela faz ao abrir.

      Fica ANTES da recusa geral porque a resposta dela, quando nao ha ninguem,
      e a mesma: 401. Mas a tela precisa poder perguntar sem que isso conte como
      tentativa de entrar.
    */
    if (url.pathname === '/eu') {
      const soGet = soLeitura(pedido)
      if (soGet) return soGet
      if (!quem) return new Response('aparelho nao autorizado', { status: 401 })
      return Response.json({
        papel: quem.papel,
        turma: quem.turma ?? null,
        apelido: quem.apelido,
      })
    }

    if (!quem) {
      /*
        401, e nao 403: a diferenca importa para a tela. 401 significa "nao sei
        quem voce e" e a pagina abre o campo de token; 403 significaria "sei
        quem voce e e voce nao pode", que pedir token nenhum resolve.
      */
      await descartar(pedido)
      return new Response('aparelho nao autorizado', { status: 401 })
    }
    const papel: Papel = quem.papel

    /*
      Estas rotas devolvem dado de crianca, e so a um aparelho autorizado: a
      identidade veio do cookie e da tabela de dispositivos, conferida acima
      (2.2). O filtro por papel continua por cima disso — a portaria busca no
      cadastro inteiro; a sala nunca recebe a lista, so a propria turma pelo
      retrato.
    */
    if (url.pathname === '/alunos') {
      const soGet = soLeitura(pedido)
      if (soGet) return soGet
      if (papel !== 'portaria') return new Response('so a portaria busca alunos', { status: 403 })
      return Response.json(this.livro.alunos())
    }

    /*
      A restricao de UMA crianca, e so quando alguem esta prestes a agir.

      Existe como rota separada, e nao como campo em `/alunos`, porque
      `/alunos` despeja o cadastro inteiro no navegador — e isso ja e
      minimizacao ao contrario, registrado em `docs/lgpd.md`. Com o texto
      dentro, cada tablet da portaria carregaria em repouso a situacao familiar
      da escola toda. Aqui sai uma crianca por vez.

      A sala so alcanca a PROPRIA turma, pela mesma regra da leitura e da
      escrita: se a restricao vazasse por aqui, a sala do Pré 1 leria a
      anotacao de guarda de um aluno do 9º ano varrendo ids.
    */
    if (url.pathname === '/alerta') {
      const soGet = soLeitura(pedido)
      if (soGet) return soGet
      const alunoId = url.searchParams.get('alunoId') ?? ''
      if (alunoId.length === 0 || alunoId.length > 64) {
        return new Response('alunoId invalido', { status: 400 })
      }

      /*
        A turma vem da SESSAO, nao da URL — e a regra de quem ve o que mora no
        Livro. Para a sala, "nao existe" e "e de outra turma" recebem a MESMA
        resposta: responder 403 num caso e 404 no outro era um oraculo de
        matricula por id.
      */
      const aluno = this.livro.alunoVisivelPara(quem.papel, quem.turma, alunoId)
      if (!aluno) return new Response('aluno desconhecido', { status: 404 })

      return Response.json({ alunoId, texto: this.deposito.alertaDe(alunoId) })
    }

    if (url.pathname === '/registro') {
      const soGet = soLeitura(pedido)
      if (soGet) return soGet
      if (papel !== 'portaria') return new Response('so a portaria le o registro', { status: 403 })
      return Response.json(this.livro.registro())
    }

    /*
      Quem pode levar ESTA crianca.

      Uma crianca por vez, pelo mesmo motivo do `/alerta`: a lista completa de
      responsaveis da escola e nome e telefone de centenas de adultos, e o
      tablet da portaria nao precisa carregar isso em repouso para entregar uma
      crianca.

      A sala tambem le — ela precisa saber quem esta autorizado quando alguem
      bate na porta — mas so da propria turma, como todo o resto.
    */
    if (url.pathname === '/responsaveis') {
      const soGet = soLeitura(pedido)
      if (soGet) return soGet

      /*
        Buscar pelo nome de QUEM CHEGOU no portao.

        "Sou o pai da Alice" e o que se ouve de verdade — e o adulto que busca
        dois filhos em turmas diferentes teria de ser procurado duas vezes,
        pelo nome de cada crianca, com a porteira lembrando de cor quem e irmao
        de quem. Aqui ela digita o nome dele uma vez.

        SO A PORTARIA. A resposta cruza o nome de um adulto com a lista de
        criancas que ele busca, e nenhuma sala tem por que ter isso: a sala
        pergunta por crianca, uma de cada vez, e so da propria turma.
      */
      const consulta = url.searchParams.get('q')
      if (consulta !== null) {
        if (papel !== 'portaria') {
          return new Response('so a portaria busca por responsavel', { status: 403 })
        }
        if (consulta.length > 80) return new Response('consulta longa demais', { status: 400 })
        // Com o relogio: a avo autorizada para HOJE tambem e procuravel pelo
        // nome dela, e a de ontem nao. Mesma regra de `/responsaveis?alunoId`.
        return Response.json(this.livro.quemBusca(consulta, 8, Date.now()))
      }

      const alunoId = url.searchParams.get('alunoId') ?? ''
      if (alunoId.length === 0 || alunoId.length > 64) {
        return new Response('alunoId invalido', { status: 400 })
      }
      // Mesma regra, mesma resposta unica para a sala: ver /alerta.
      const aluno = this.livro.alunoVisivelPara(quem.papel, quem.turma, alunoId)
      if (!aluno) return new Response('aluno desconhecido', { status: 404 })
      /*
        O TELEFONE so vai para a portaria.

        Quem liga para o responsavel e quem esta no portao. A sala precisa saber
        QUEM esta autorizado — para reconhecer o nome quando alguem bate na
        porta — e nao precisa do contato de ninguem.

        Onze salas guardando o telefone de centenas de adultos em cada tablet e
        exatamente a minimizacao ao contrario que o `docs/lgpd.md` ja registra
        para `/alunos`. Aqui da para nao repetir o erro, entao nao se repete.
      */
      // Com o relogio, para a delegacao de hoje entrar — e a de ontem, nao.
      const podem = this.livro.responsaveisDe(alunoId, Date.now())
      if (quem.papel === 'portaria') return Response.json(podem)
      return Response.json(podem.map(({ telefone: _telefone, ...resto }) => resto))
    }

    /*
      Os irmaos que este adulto tambem pode levar.

      E a 1.4, que o plano adiou justamente ate existir este modelo: "mesmo
      responsavel", e nao um campo "familia". Irmao por sobrenome erra com
      familia recomposta; irmao por responsavel acerta por construcao.
    */
    if (url.pathname === '/irmaos') {
      const soGet = soLeitura(pedido)
      if (soGet) return soGet
      if (quem.papel !== 'portaria') {
        return new Response('so a portaria chama irmaos', { status: 403 })
      }
      const responsavelId = url.searchParams.get('responsavelId') ?? ''
      const exceto = url.searchParams.get('exceto') ?? ''
      if (responsavelId.length === 0 || responsavelId.length > 64) {
        return new Response('responsavelId invalido', { status: 400 })
      }
      // Com o relogio, pelo mesmo motivo de `/responsaveis`: a avo de hoje
      // busca dois netos, e o segundo nao pode sumir depois do primeiro.
      return Response.json(this.livro.irmaosPara(responsavelId, exceto, Date.now()))
    }

    /*
      A segunda planilha: uma linha por par crianca-adulto.

      Separada da primeira porque uma crianca tem N responsaveis, e enfiar isso
      na planilha de alunos exigiria uma coluna com nomes separados por ponto e
      virgula — que quebra no primeiro sobrenome composto.
    */
    if (url.pathname === '/importar-responsaveis') {
      if (pedido.method !== 'POST') {
        await descartar(pedido)
        return new Response('use POST', { status: 405 })
      }
      if (papel !== 'portaria') {
        await descartar(pedido)
        return new Response('so a portaria importa', { status: 403 })
      }

      let bytes: ArrayBuffer
      try {
        bytes = await pedido.arrayBuffer()
      } catch {
        return new Response('nao consegui ler a planilha enviada', { status: 400 })
      }
      if (bytes.byteLength > LIMITE_CORPO) {
        return Response.json(
          {
            responsaveis: 0,
            vinculos: 0,
            erros: [{ linha: 0, motivo: 'planilha grande demais' }],
            errosTotal: 1,
            trocado: false,
          },
          { status: 413 },
        )
      }

      const csv = decodificar(bytes)
      const primeira = csv.split(/\r?\n/, 1)[0] ?? ''
      const resultado = analisarResponsaveis(
        analisarCsv(csv, separadorDo(primeira)),
        this.livro.alunos(),
      )

      /*
        Nenhum vinculo lido significa planilha errada, e trocar por vazio
        apagaria TODAS as autorizacoes da escola de uma vez — no meio do turno,
        sem ninguem notar ate a primeira entrega travar.
      */
      if (resultado.vinculos.length === 0) {
        return Response.json(
          {
            responsaveis: 0,
            vinculos: 0,
            erros: resultado.erros,
            errosTotal: resultado.errosTotal,
            trocado: false,
          },
          { status: 422 },
        )
      }

      this.livro.substituirResponsaveis(resultado.responsaveis, resultado.vinculos)
      this.deposito.trocarResponsaveis(resultado.responsaveis, resultado.vinculos)
      // A planilha e a ultima a chegar: o proximo envio do backend precisa valer.
      this.deposito.limparVersaoExterna()
      this.transmitir()

      return Response.json({
        responsaveis: resultado.responsaveis.length,
        vinculos: resultado.vinculos.length,
        erros: resultado.erros,
        errosTotal: resultado.errosTotal,
        trocado: true,
      })
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

      let orfaos = 0
      try {
        this.livro.substituirCadastro(resultado.alunos)
        this.deposito.trocarCadastro(
          resultado.alunos,
          this.livro.versao(),
          resultado.alertas,
        )

        /*
          Trocar a lista de alunos ORFANA os vinculos: os ids sao recalculados
          de nome+turma, e uma crianca que mudou de turma ganha id novo. Sem a
          poda, `responsaveisDe` passaria a devolver vazio e `entregar` voltaria
          a funcionar SEM exigir responsavel — a escola perderia a protecao
          inteira da 2.1 sem nenhum sinal.

          Nao da para consertar sozinho: so a escola tem a segunda planilha. Da
          para DIZER, e e o que o numero abaixo faz.
        */
        orfaos = this.deposito.podarVinculosOrfaos()
        const restantes = this.deposito.responsaveisEVinculos()
        this.livro.substituirResponsaveis(restantes.responsaveis, restantes.vinculos)
        // Delegacao de crianca que saiu do cadastro sai junto, do disco e da
        // memoria; e a planilha passa a mandar sobre a versao do backend.
        this.deposito.podarDelegacoesOrfas()
        this.livro.substituirDelegacoes(this.deposito.listarDelegacoes())
        this.deposito.limparVersaoExterna()
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
        /*
          Quantas autorizacoes ficaram orfas nesta troca.

          Zero na maioria das vezes. Diferente de zero significa "reimporte a
          planilha de responsaveis, ou as entregas vao parar de exigir quem
          esta levando" — e e o unico aviso que a escola vai receber, porque
          depois disso o app volta a parecer perfeitamente normal.
        */
        vinculosPerdidos: orfaos,
      })
    }

    if (url.pathname !== '/ws') {
      return new Response('nao encontrado', { status: 404 })
    }

    if (pedido.method !== 'GET') {
      return new Response('use GET', { status: 405, headers: { Allow: 'GET' } })
    }
    if (pedido.headers.get('Upgrade') !== 'websocket') {
      return new Response('esperava upgrade para websocket', { status: 426 })
    }
    /*
      Origin, quando o navegador manda, precisa ser este servidor. O cookie
      SameSite=Strict ja nao acompanha um handshake iniciado por outro site,
      mas era a unica camada — e o cookie de desenvolvimento nao leva Secure.
      So o HOST e comparado: atras do ngrok o Worker ve http e a pagina e https.
      Sem Origin (ferramentas, testes) continua aceito.
    */
    const origemDoNavegador = pedido.headers.get('Origin')
    if (origemDoNavegador !== null) {
      let hostDaOrigem = ''
      try {
        hostDaOrigem = new URL(origemDoNavegador).host
      } catch {
        // origem invalida cai no 403 abaixo
      }
      if (hostDaOrigem !== url.host) {
        return new Response('origem nao permitida', { status: 403 })
      }
    }

    /*
      A turma vem do APARELHO, nao da URL.

      Aqui morre a assimetria antiga: papel invalido nao conectava, mas turma
      invalida conectava e virava sessao cega — a professora entrava, nao via
      crianca nenhuma, e nao havia erro em lugar nenhum. Ela concluia que
      ninguem tinha chegado. Agora `sessaoDe` recusa o dispositivo cuja turma
      nao existe, e a conexao nem acontece.
    */
    const turma = quem.turma

    // A impressao fica na conexao: e por ela que a revogacao alcanca o socket
    // que ja estava aberto quando o aparelho foi revogado. Vem ANTES do teto de
    // sessoes: o await no meio deixava duas conexoes passarem pelo mesmo vao.
    const impressao = await impressaoDe(cookieDo(pedido, NOME_DO_COOKIE) ?? '')

    if (this.sessoes.size >= LIMITE_SESSOES) {
      return new Response('conexoes demais neste momento', { status: 503 })
    }

    /*
      A chamada esquecida de ontem nao pode esperar o alarme: se o objeto ficou
      residente a noite inteira, a professora que liga o tablet de manha e o
      primeiro sinal do dia. Idempotente e barato; roda a cada conexao nova.
    */
    this.expirarEsquecidas()

    const par = new WebSocketPair()
    const cliente = par[0]
    const servidor = par[1]
    servidor.accept()

    const sessao: Conexao = {
      ws: servidor,
      papel: quem.papel,
      turma: quem.turma,
      impressao,
      mensagens: { desde: Date.now(), n: 0 },
    }
    this.sessoes.add(sessao)

    servidor.addEventListener('message', (evento: MessageEvent) => {
      /*
        Revogado nao age — nem se ja estava conectado.

        A identidade era conferida uma vez, no aperto de mao, e congelada na
        sessao. Um tablet perdido as 15h, revogado as 15h02, continuava com a
        tela aberta recebendo cada crianca da turma e liberando saida ate a
        conexao cair sozinha — e a tela da sala fica aberta o turno inteiro,
        reconectando por conta propria. A revogacao ja fecha a conexao na hora
        (derrubarConexoesDe); esta conferencia, sincrona e barata, e a segunda
        tranca, para o caminho que fechar nao alcancou.
      */
      if (!sessaoDe(this.deposito.dispositivoPor(sessao.impressao))) {
        this.sessoes.delete(sessao)
        servidor.close(1008, 'aparelho revogado')
        return
      }

      const agora = Date.now()
      if (agora - sessao.mensagens.desde > JANELA_MENSAGENS) {
        sessao.mensagens = { desde: agora, n: 0 }
      }
      if (++sessao.mensagens.n > TETO_MENSAGENS) {
        this.sessoes.delete(sessao)
        servidor.close(1008, 'mensagens demais')
        return
      }

      let alunoId = ''
      try {
        // Teto de BYTES por mensagem, antes de qualquer parse: o de mensagens
        // por segundo nao segura um quadro de 32 MB.
        const bruto = typeof evento.data === 'string' ? evento.data : ''
        if (bruto.length > LIMITE_COMANDO) {
          this.sessoes.delete(sessao)
          servidor.close(1009, 'mensagem grande demais')
          return
        }
        const cru: unknown = JSON.parse(bruto)
        if (typeof cru !== 'object' || cru === null || Array.isArray(cru)) {
          throw new Error('comando precisa ser um objeto')
        }
        /*
          Batimento. Uma conexao meio-aberta — wifi que caiu sem fechar o
          socket — ficava "conectado" na tela com o quadro parado. A tela
          pergunta de tempos em tempos; a resposta e a prova de que a linha
          esta viva. Nao passa pelo Livro: nao e comando.
        */
        if ((cru as { tipo?: unknown }).tipo === 'ping') {
          // Com o instante do servidor: e por ele que a tela corrige o
          // proprio relogio a cada batimento, e nao so a cada retrato.
          this.enviar(sessao, JSON.stringify({ tipo: 'pong', em: Date.now() }))
          return
        }
        const comando = cru as Partial<Comando>
        if (!ehAcao(comando.tipo)) throw new Error('acao desconhecida')
        if (typeof comando.alunoId !== 'string') throw new Error('alunoId precisa ser texto')
        // Teto no id: ele volta na mensagem de recusa. Sem limite, um cliente
        // manda 50 mil caracteres e recebe 50 mil de volta.
        if (comando.alunoId.length > 64) throw new Error('alunoId longo demais')
        alunoId = comando.alunoId

        /*
          Aqui so passa FORMA. Quais razoes existem e regra, e regra mora no
          Livro (invariante 8) — inclusive porque o modo demonstracao nao passa
          por este arquivo.

          Mas o teto de tamanho e forma, e precisa existir DESTE lado: o
          caminho do WebSocket nao tinha nada equivalente ao limite de 1 MB do
          /importar, e agora ele escreve em disco retido 90 dias. O valor
          tambem nunca e interpolado na recusa, pelo mesmo motivo do alunoId.
        */
        if (comando.razao !== undefined) {
          if (typeof comando.razao !== 'string') throw new Error('razao precisa ser texto')
          if (comando.razao.length > 64) throw new Error('razao longa demais')
        }

        // Forma, nao regra: quem pode levar quem e decidido no Livro.
        if (comando.responsavelId !== undefined) {
          if (typeof comando.responsavelId !== 'string') {
            throw new Error('responsavelId precisa ser texto')
          }
          if (comando.responsavelId.length > 64) {
            throw new Error('responsavelId longo demais')
          }
        }

        const transicao = this.livro.aplicar(
          {
            tipo: comando.tipo,
            alunoId,
            razao: comando.razao,
            responsavelId: comando.responsavelId,
          },
          Date.now(),
          sessao.papel,
          sessao.turma,
        )
        // Write-through: o Livro decide, o disco registra em seguida. Uma
        // transicao que nao chega ao disco e uma transicao que o proximo
        // reinicio nega ter acontecido.
        try {
          this.persistir(transicao)
        } catch {
          /*
            O Livro ja mudou e o disco nao. Deixar assim faria a recusa mentir
            (a transicao "recusada" estaria valendo na memoria) e a memoria
            divergir do disco ate o proximo reinicio. Entao a memoria volta a
            ser o que o disco diz — o disco e a verdade — e quem mandou ouve
            que nao gravou e pode tentar de novo.
          */
          this.livro = new Livro(this.deposito.carregar())
          this.transmitir()
          throw new Error('nao consegui gravar a transicao; tente de novo')
        }
        this.transmitir()
      } catch (erro) {
        this.enviar(sessao, JSON.stringify({ tipo: 'recusa', alunoId, motivo: motivoDe(erro) }))
      }
    })

    const encerrar = () => {
      this.sessoes.delete(sessao)
    }
    servidor.addEventListener('close', encerrar)
    servidor.addEventListener('error', encerrar)

    this.enviar(sessao, JSON.stringify(this.livro.retratoPara(papel, turma, Date.now())))

    return new Response(null, { status: 101, webSocket: cliente })
  }

  /** Fecha toda conexao viva daquele aparelho. Revogar precisa valer AGORA. */
  private derrubarConexoesDe(impressao: string): number {
    let derrubadas = 0
    for (const sessao of [...this.sessoes]) {
      if (sessao.impressao !== impressao) continue
      this.sessoes.delete(sessao)
      try {
        sessao.ws.close(1008, 'aparelho revogado')
      } catch {
        // ja fechada: o objetivo esta cumprido
      }
      derrubadas++
    }
    return derrubadas
  }

  /*
    TODO envio passa por aqui.

    `send()` num socket que o outro lado derrubou sem fechar — wifi que caiu,
    aba morta — lanca "Network connection lost". O `transmitir` ja tratava; o
    retrato inicial, o `pong` e a `recusa` nao, e cada um virava excecao nao
    tratada no log (noventa e cinco numa noite de sondas). Um lugar so: falhou,
    a sessao sai da lista e o socket e fechado por aqui.
  */
  private enviar(sessao: Conexao, texto: string): boolean {
    try {
      sessao.ws.send(texto)
      return true
    } catch {
      this.sessoes.delete(sessao)
      try {
        sessao.ws.close(1011, 'conexao perdida')
      } catch {
        // ja estava fechada
      }
      return false
    }
  }

  private transmitir(): void {
    const agora = Date.now()
    for (const sessao of [...this.sessoes]) {
      this.enviar(
        sessao,
        JSON.stringify(this.livro.retratoPara(sessao.papel, sessao.turma, agora)),
      )
    }
  }
}

/**
 * So deixa sair mensagem que a gente escreveu. Erro interno cru vazando para
 * o cliente ja apareceu como "Cannot read properties of null" na tela da
 * professora — texto que nao ajuda ninguem e conta como o servidor e por dentro.
 */
/*
  JSON so em UTF-8 VALIDO.

  O decodificador padrao troca byte invalido por U+FFFD em silencio — e foi
  assim que um "avó" mandado em Latin-1 virou "av�" dentro de uma delegacao,
  sem erro para ninguem. Um corpo que nao e UTF-8 nao e o que o backend mandou:
  melhor 400 agora do que um nome corrompido na trilha por 90 dias. Quem chama
  ja esta dentro de um try que responde 400 a qualquer excecao daqui.
*/
const UTF8_ESTRITO = new TextDecoder('utf-8', { fatal: true })
function lerJson(bytes: ArrayBuffer): unknown {
  // O BOM que alguns editores e bibliotecas poem na frente nao e JSON.
  return JSON.parse(UTF8_ESTRITO.decode(bytes).replace(/^﻿/, ''))
}

/** Rotas de leitura so por GET (ou HEAD): um DELETE /alunos nao devolve o cadastro. */
function soLeitura(pedido: Request): Response | null {
  if (pedido.method === 'GET' || pedido.method === 'HEAD') return null
  return new Response('use GET', { status: 405, headers: { Allow: 'GET' } })
}

/** As proximas 03:00 de Brasilia (06:00 UTC): a hora em que ninguem esta saindo da escola. */
function proximaMadrugada(agora: number): number {
  const d = new Date(agora)
  const hoje = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 6)
  return hoje > agora + 60_000 ? hoje : hoje + UM_DIA
}

/**
 * De onde veio o pedido, para o teto de tentativas. `CF-Connecting-IP` e o que
 * a Cloudflare poe; fora dela (wrangler dev, testes) tudo cai num balde so —
 * o que e conservador, e nao permissivo.
 */
function origemDe(pedido: Request): string {
  return pedido.headers.get('CF-Connecting-IP') ?? 'desconhecida'
}

/** Inteiro de query string, com padrao para ausente e `null` para invalido. */
function inteiroDe(bruto: string | null, padrao: number, minimo: number, maximo: number): number | null {
  if (bruto === null || bruto === '') return padrao
  if (!/^\d{1,16}$/.test(bruto)) return null
  const n = Number(bruto)
  return n >= minimo && n <= maximo ? n : null
}

/**
 * Consome e joga fora o corpo, para nao deixar fluxo aberto ao responder cedo.
 *
 * LE ate o fim, pedaco a pedaco, e descarta. A versao anterior chamava
 * `body.cancel()`, e o runtime continuava reclamando de fluxo nao lido depois
 * da resposta — cancelar nao conta como consumir. Ler pedaco a pedaco mantem a
 * memoria constante mesmo num corpo grande.
 */
async function descartar(pedido: Request): Promise<void> {
  try {
    if (!pedido.body || pedido.bodyUsed) return
    const leitor = pedido.body.getReader()
    while (!(await leitor.read()).done) {
      // pedaco lido e descartado
    }
  } catch {
    // corpo ja consumido ou inexistente: nada a fazer
  }
}

export function motivoDe(erro: unknown): string {
  /*
    Allowlist, nao denylist: mensagem de erro nao prevista vira "comando
    recusado" em vez de vazar o interior do servidor para a tela da professora.

    Consequencia que morde: TODO erro novo do Livro precisa entrar aqui, senao
    a recusa vira muda. "razao invalida" nasceria como "comando recusado", e a
    professora ficaria sem saber que faltou escolher o motivo.
  */
  const permitido = new RegExp(
    [
      'desconhecid',
      'precisa ser',
      'em saida',
      'outra turma',
      'declarar a turma',
      'longo demais',
      'raz[aã]o',
      // 2.1: quem esta levando a crianca, e quem NAO pode leva-la.
      'escolha um respons',
      'impedido de levar',
      // 3.3: as recusas da delegacao, que saem por HTTP com o mesmo filtro.
      'vencid',
      'invertida',
      'quem autoriza',
      'ja usado',
      // Disco falhou depois de o Livro decidir: a memoria voltou ao disco.
      'nao consegui gravar',
    ].join('|'),
  )
  if (erro instanceof AcaoNaoPermitida) return erro.message.slice(0, 120)
  if (erro instanceof TransicaoInvalida) return erro.message.slice(0, 120)
  if (erro instanceof Error && permitido.test(erro.message)) {
    return erro.message.slice(0, 120)
  }
  return 'comando recusado'
}
