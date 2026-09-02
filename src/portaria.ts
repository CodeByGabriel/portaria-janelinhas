import { Livro } from './livro.ts'
import { ehPapel, ehAcao, AcaoNaoPermitida, TransicaoInvalida, type Papel } from './estados.ts'
import { TURMAS, type Turma } from './semente.ts'
import { analisar, decodificar } from './importar.ts'
import { analisarResponsaveis } from './responsaveis.ts'
import { analisarCsv, separadorDo } from './importar.ts'
import { Deposito } from './deposito.ts'
import type { Comando, EventoAuditoria } from './protocolo.ts'
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

    let token = ''
    try {
      const bytes = await pedido.arrayBuffer()
      if (bytes.byteLength > 4096) return new Response('token longo demais', { status: 413 })
      const corpo: unknown = JSON.parse(new TextDecoder().decode(bytes))
      if (typeof corpo === 'object' && corpo !== null && 'token' in corpo) {
        const bruto = (corpo as { token: unknown }).token
        if (typeof bruto === 'string') token = bruto.trim()
      }
    } catch {
      return new Response('corpo invalido', { status: 400 })
    }

    if (token.length < 16 || token.length > 128) {
      return new Response('token nao reconhecido', { status: 401 })
    }

    const quem = sessaoDe(this.deposito.dispositivoPor(await impressaoDe(token)))
    if (!quem) return new Response('token nao reconhecido', { status: 401 })

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
    const chaveConfigurada = this.env.CHAVE_ADMIN
    const chaveDada = pedido.headers.get('X-Chave-Admin')

    if (pedido.method === 'POST') {
      /*
        Sem chave configurada, ninguem emite. Fail-closed do lado certo: uma
        instancia mal configurada nao aceita aparelho novo, em vez de aceitar
        qualquer um.
      */
      if (
        !chaveConfigurada ||
        !chaveDada ||
        !iguaisEmTempoConstante(chaveDada, chaveConfigurada)
      ) {
        await descartar(pedido)
        return new Response('chave de administracao invalida', { status: 401 })
      }

      let papel = ''
      let turma: string | undefined
      let apelido = ''
      try {
        const corpo = (await pedido.json()) as Record<string, unknown>
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
      if (!/^[0-9a-f]{8}$/.test(referencia)) {
        return new Response('referencia invalida', { status: 400 })
      }
      const alvo = this.deposito
        .listarDispositivos()
        .find((d) => d.impressao.startsWith(referencia))
      if (!alvo) return new Response('aparelho desconhecido', { status: 404 })

      const revogou = this.deposito.revogarDispositivo(alvo.impressao, Date.now())
      return Response.json({ revogado: revogou })
    }

    await descartar(pedido)
    return new Response('metodo nao suportado', { status: 405 })
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
    const url = new URL(pedido.url)

    /*
      As rotas de porta de entrada vem ANTES da verificacao, porque sao elas
      que a produzem. Tudo o mais abaixo exige aparelho autorizado.
    */
    if (url.pathname === '/entrar') return this.entrar(pedido)
    if (url.pathname === '/sair') {
      return new Response(null, {
        status: 204,
        headers: { 'Set-Cookie': cookieApagado(ehSeguro(pedido)) },
      })
    }
    if (url.pathname === '/dispositivos') return this.dispositivos(pedido)

    /*
      Se este servidor esta em modo demonstracao.

      Aberta de proposito, e sem revelar nada: a resposta e um booleano que
      qualquer pessoa ja poderia descobrir tentando um token conhecido. Ela
      existe para a TELA poder anunciar o modo — um sistema com tokens
      previsiveis que nao diz isso e uma armadilha.
    */
    if (url.pathname === '/modo') {
      return Response.json({ demonstracao: this.env.MODO_DEMO === 'sim' })
    }

    const quem = await this.autorizacaoDe(pedido)

    /*
      Quem sou eu — a pergunta que a tela faz ao abrir.

      Fica ANTES da recusa geral porque a resposta dela, quando nao ha ninguem,
      e a mesma: 401. Mas a tela precisa poder perguntar sem que isso conte como
      tentativa de entrar.
    */
    if (url.pathname === '/eu') {
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
      const alunoId = url.searchParams.get('alunoId') ?? ''
      if (alunoId.length === 0 || alunoId.length > 64) {
        return new Response('alunoId invalido', { status: 400 })
      }

      const aluno = this.livro.alunos().find((a) => a.id === alunoId)
      if (!aluno) return new Response('aluno desconhecido', { status: 404 })

      /*
        A turma vem da SESSAO, nao da URL.

        Enquanto ela vinha do parametro, a propria sala escolhia qual turma
        dizer que era — e o filtro so impedia quem escrevesse o parametro
        errado. Agora ela vem do aparelho, que a escola emitiu.
      */
      if (quem.papel === 'sala' && aluno.turma !== quem.turma) {
        return new Response('a sala so le alerta da propria turma', { status: 403 })
      }

      return Response.json({ alunoId, texto: this.deposito.alertaDe(alunoId) })
    }

    if (url.pathname === '/registro') {
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
      const alunoId = url.searchParams.get('alunoId') ?? ''
      if (alunoId.length === 0 || alunoId.length > 64) {
        return new Response('alunoId invalido', { status: 400 })
      }
      const aluno = this.livro.alunos().find((a) => a.id === alunoId)
      if (!aluno) return new Response('aluno desconhecido', { status: 404 })
      if (quem.papel === 'sala' && aluno.turma !== quem.turma) {
        return new Response('a sala so le a propria turma', { status: 403 })
      }
      /*
        O TELEFONE so vai para a portaria.

        Quem liga para o responsavel e quem esta no portao. A sala precisa saber
        QUEM esta autorizado — para reconhecer o nome quando alguem bate na
        porta — e nao precisa do contato de ninguem.

        Onze salas guardando o telefone de centenas de adultos em cada tablet e
        exatamente a minimizacao ao contrario que o `docs/lgpd.md` ja registra
        para `/alunos`. Aqui da para nao repetir o erro, entao nao se repete.
      */
      const podem = this.livro.responsaveisDe(alunoId)
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
      if (quem.papel !== 'portaria') {
        return new Response('so a portaria chama irmaos', { status: 403 })
      }
      const responsavelId = url.searchParams.get('responsavelId') ?? ''
      const exceto = url.searchParams.get('exceto') ?? ''
      if (responsavelId.length === 0 || responsavelId.length > 64) {
        return new Response('responsavelId invalido', { status: 400 })
      }
      return Response.json(this.livro.irmaosPara(responsavelId, exceto))
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

      const bytes = await pedido.arrayBuffer()
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

    if (pedido.headers.get('Upgrade') !== 'websocket') {
      return new Response('esperava upgrade para websocket', { status: 426 })
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

    if (this.sessoes.size >= LIMITE_SESSOES) {
      return new Response('conexoes demais neste momento', { status: 503 })
    }

    const par = new WebSocketPair()
    const cliente = par[0]
    const servidor = par[1]
    servidor.accept()

    const sessao: Conexao = { ws: servidor, papel: quem.papel, turma: quem.turma }
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
    ].join('|'),
  )
  if (erro instanceof AcaoNaoPermitida) return erro.message.slice(0, 120)
  if (erro instanceof TransicaoInvalida) return erro.message.slice(0, 120)
  if (erro instanceof Error && permitido.test(erro.message)) {
    return erro.message.slice(0, 120)
  }
  return 'comando recusado'
}
