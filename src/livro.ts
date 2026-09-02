import {
  proximo,
  exigirDono,
  ehRazaoRetorno,
  RAZOES_RETORNO,
  type Estado,
  type Papel,
  type Acao,
} from './estados.ts'
import { semear, type Aluno, type Turma } from './semente.ts'
import type { Responsavel, Vinculo } from './responsaveis.ts'
import type { Chamada, Retrato, Comando, EventoAuditoria, Instantaneo } from './protocolo.ts'

/*
  O que expira, e pela acao de quem.

  Uma tabela, e nao um `if`, para que acrescentar estado novo obrigue a decidir
  aqui se ele fecha sozinho — em vez de herdar "nao fecha" por omissao, que foi
  como `liberado` virou caso aberto eterno.

  `liberado` esta ausente de proposito: ver `expirar()`.
*/
const EXPIRAVEIS: Partial<Record<Estado, Acao>> = {
  chamado: 'cancelar',
  retorno: 'encerrar',
}

/**
 * O estado do dia da escola. Puro: sem rede, sem relogio, sem armazenamento.
 * O relogio entra sempre por parametro, para que o teste mande no tempo.
 *
 * A persistencia mora fora, em deposito.ts, e este arquivo nao a conhece. Quem
 * costura os dois e o Durable Object.
 */
export class Livro {
  private readonly cadastro = new Map<string, Aluno>()
  private readonly chamadas = new Map<string, Chamada>()
  private readonly trilha: EventoAuditoria[] = []
  /* Quem pode levar cada crianca. Ver `responsaveis.ts`. */
  private readonly responsaveis = new Map<string, Responsavel>()
  private readonly vinculos = new Map<string, Vinculo[]>()
  /** Sobe a cada troca de cadastro. O cliente usa para saber que a lista dele venceu. */
  private versaoCadastro = 1

  /**
   * Aceita uma lista de alunos (uso de teste) ou o instantaneo completo vindo
   * do disco (uso de producao).
   *
   * CUIDADO com o padrao `semear()`: em producao ele nunca deve ser alcancado.
   * Foi exatamente por ele que um reinicio substituia a lista real da escola
   * pelos alunos ficticios, em silencio. O Durable Object sempre constroi a
   * partir de `Deposito.carregar()`, que so semeia na primeirissima vez.
   */
  constructor(inicio: Aluno[] | Instantaneo = semear()) {
    const dados: Instantaneo = Array.isArray(inicio)
      ? { alunos: inicio, chamadas: [], trilha: [], versaoCadastro: 1 }
      : inicio

    for (const aluno of dados.alunos) this.cadastro.set(aluno.id, aluno)
    for (const chamada of dados.chamadas) this.chamadas.set(chamada.alunoId, chamada)
    this.trilha.push(...dados.trilha)
    for (const r of dados.responsaveis ?? []) this.responsaveis.set(r.id, r)
    for (const v of dados.vinculos ?? []) {
      const lista = this.vinculos.get(v.alunoId) ?? []
      lista.push(v)
      this.vinculos.set(v.alunoId, lista)
    }
    this.versaoCadastro = dados.versaoCadastro
  }

  versao(): number {
    return this.versaoCadastro
  }

  alunos(): Aluno[] {
    return [...this.cadastro.values()]
  }

  /**
   * Aplica um comando. O papel de quem manda NAO e opcional: sem ele, a
   * maquina de estados sozinha permite que um cliente qualquer chame e
   * libere em seguida, levando uma crianca ate a rua sem ninguem no portao.
   */
  aplicar(comando: Comando, agora: number, papel: Papel, turma?: Turma): EventoAuditoria {
    exigirDono(comando.tipo, papel)

    const aluno = this.cadastro.get(comando.alunoId)
    if (!aluno) throw new Error(`aluno desconhecido: ${comando.alunoId}`)

    /*
      A sala so age sobre a PROPRIA turma.

      O filtro de turma existia so na leitura (retratoPara). Sem ele tambem na
      escrita, uma sala do Pré 1 liberava um aluno do 9º ano: ela nem via a
      crianca no retrato, mas os ids sao sequenciais e adivinhaveis, entao
      bastava varre-los para transformar toda crianca "chamado" em "liberado".

      "liberado" e a confirmacao da professora — o unico evento que este
      sistema existe para proteger. Ele nao pode ser forjavel por quem tem a
      URL. Sala sem turma declarada nao age sobre ninguem.
    */
    if (papel === 'sala') {
      if (!turma) throw new Error('a sala precisa declarar a turma para agir')
      if (aluno.turma !== turma) {
        throw new Error(`aluno de outra turma: ${aluno.turma}`)
      }
    }

    const anterior = this.chamadas.get(comando.alunoId)
    const de: Estado = anterior?.estado ?? 'aguardando'
    const para = proximo(de, comando.tipo)

    /*
      A razao e validada AQUI, junto das outras regras, e nao no Durable Object.

      O DO so confere forma (invariante 8), e nem todo caminho passa por ele: o
      modo demonstracao chama `proximo`/`exigirDono` direto no navegador. Regra
      que mora no servidor de rede e regra que a demonstracao nao tem.

      Fail-closed como papel e turma: retorno sem razao valida nao acontece. Um
      retorno sem razao entra na trilha para sempre e ninguem descobre depois
      por que aconteceu.

      E o campo e ZERADO em toda outra acao. Copiar `comando.razao` sem esta
      guarda transformaria qualquer comando num canal de texto livre para dentro
      de uma tabela que nao tem UPDATE nem DELETE por linha.
    */
    /*
      Entregar exige DIZER A QUEM.

      E a metade da promessa que faltava: ate aqui a trilha registrava que a
      crianca saiu e nao registrava com quem. Um registro de saida que nao
      responde "a quem" nao serve no dia em que a familia pergunta.

      A exigencia so vale quando a escola cadastrou responsaveis para aquela
      crianca. Sem cadastro, entregar continua funcionando como antes — senao a
      2.1 travaria a saida de toda escola que ainda nao tivesse subido a
      segunda planilha, no meio do turno, sem aviso.
    */
    let responsavelId = ''
    let responsavelNome = ''
    if (comando.tipo === 'entregar') {
      const podem = this.responsaveisDe(comando.alunoId)
      if (podem.length > 0) {
        const escolhido = podem.find((r) => r.id === comando.responsavelId)
        if (!escolhido) {
          throw new Error(
            'diga quem esta levando a crianca: escolha um responsavel cadastrado',
          )
        }
        /*
          IMPEDIDO NAO ENTREGA. Aqui a restricao deixa de ser alerta e vira
          barreira: na 1.9 o sistema so podia garantir que alguem LEU a
          anotacao, porque nao sabia quem estava no portao. Agora sabe, e
          "nao entregar ao pai" e uma regra que ele pode cumprir sozinho.

          Reconhecer nao libera. Nao ha "li e vou continuar" para isto — a
          escola muda a planilha, ou a crianca nao sai com essa pessoa.
        */
        if (escolhido.impedido) {
          throw new Error(
            `${escolhido.nome} esta impedido de levar esta crianca; procure a secretaria`,
          )
        }
        responsavelId = escolhido.id
        responsavelNome = escolhido.nome
      }
    }

    let razao = ''
    if (comando.tipo === 'retornar') {
      if (!ehRazaoRetorno(comando.razao)) {
        throw new Error(
          `razao invalida para o retorno; use uma de: ${RAZOES_RETORNO.join(', ')}`,
        )
      }
      razao = comando.razao
    }

    /*
      'aguardando' (cancelado) e 'entregue' saem do mapa de chamadas.

      Entregue e terminal: o ciclo fechou, a crianca esta com o responsavel.
      Mantendo-a ali, o "retrato de chamadas ativas" cresce a cada saida ate
      conter o cadastro inteiro — e ele e retransmitido por inteiro, para
      cada sessao, a cada comando. Numa escola de 292 isso e centenas de
      retratos de centenas de entradas. A tela da sala tambem nunca mais
      esvaziaria. A trilha guarda o historico; o retrato guarda o agora.
    */
    if (para === 'aguardando' || para === 'entregue') {
      this.chamadas.delete(comando.alunoId)
    } else {
      this.chamadas.set(comando.alunoId, {
        alunoId: aluno.id,
        nome: aluno.nome,
        turma: aluno.turma,
        estado: para,
        // `desde` reinicia no `chamar`, e so nele: e "desde quando o
        // responsavel esta no portao". Ver o campo em protocolo.ts.
        desde: comando.tipo === 'chamar' ? agora : (anterior?.desde ?? agora),
        em: agora,
      })
    }

    const evento: EventoAuditoria = {
      alunoId: aluno.id,
      nome: aluno.nome,
      turma: aluno.turma,
      acao: comando.tipo,
      papel,
      // De qual sala veio. Sem isto, um "liberar" indevido nao tem origem
      // rastreavel depois do incidente.
      origem: papel === 'sala' ? (turma ?? '—') : 'portaria',
      de,
      para,
      em: agora,
      razao,
      responsavelId,
      responsavelNome,
    }
    this.trilha.push(evento)
    return evento
  }

  /**
   * A sala so enxerga a propria turma, e o filtro e aqui — no servidor.
   * Sala sem turma declarada nao ve ninguem: mostrar nada e mais seguro do
   * que mostrar a escola inteira por causa de um parametro esquecido.
   *
   * A ordem e por `desde` (chegada do responsavel), nao por `em`, para que a
   * fila nao reordene quando um estado muda.
   */
  retratoPara(papel: Papel, turma?: Turma, agora = 0): Retrato {
    const todas = [...this.chamadas.values()].sort((a, b) => a.desde - b.desde)
    const chamadas =
      papel === 'sala' ? (turma ? todas.filter((c) => c.turma === turma) : []) : todas
    return { tipo: 'retrato', chamadas, em: agora, cadastro: this.versaoCadastro }
  }

  /**
   * Quem pode levar esta crianca, com o impedido incluido e MARCADO.
   *
   * O impedido volta na lista de proposito. Some-lo faria a tela da portaria
   * mostrar uma lista curta e silenciosa, e a porteira concluiria que aquele
   * adulto simplesmente nao foi cadastrado — quando o que existe e uma decisao
   * de que ele nao pode levar. A diferenca entre "nao consta" e "nao pode" e a
   * unica coisa que importa quando ele esta parado na frente dela.
   */
  responsaveisDe(alunoId: string): (Responsavel & { impedido: boolean })[] {
    return (this.vinculos.get(alunoId) ?? [])
      .map((v) => {
        const r = this.responsaveis.get(v.responsavelId)
        return r ? { ...r, impedido: v.impedido } : null
      })
      .filter((r): r is Responsavel & { impedido: boolean } => r !== null)
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  }

  /**
   * As outras criancas que este adulto tambem pode levar hoje.
   *
   * E o vinculo de irmaos que a 1.4 esperava: "mesmo responsavel", e nao um
   * campo "familia" — que seria um segundo modelo de identidade competindo com
   * este. Irmao por sobrenome erra com familia recomposta; irmao por
   * responsavel acerta por construcao.
   *
   * O impedido nao entra: nao faz sentido oferecer chamar o irmao para quem
   * nao pode levar nenhum dos dois.
   */
  irmaosPara(responsavelId: string, exceto: string): Aluno[] {
    const achados: Aluno[] = []
    for (const [alunoId, lista] of this.vinculos) {
      if (alunoId === exceto) continue
      const v = lista.find((x) => x.responsavelId === responsavelId)
      if (!v || v.impedido) continue
      const aluno = this.cadastro.get(alunoId)
      if (aluno) achados.push(aluno)
    }
    return achados.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  }

  /** Substitui responsaveis e vinculos inteiros, como o cadastro. */
  substituirResponsaveis(responsaveis: Responsavel[], vinculos: Vinculo[]): void {
    this.responsaveis.clear()
    this.vinculos.clear()
    for (const r of responsaveis) this.responsaveis.set(r.id, r)
    for (const v of vinculos) {
      const lista = this.vinculos.get(v.alunoId) ?? []
      lista.push(v)
      this.vinculos.set(v.alunoId, lista)
    }
  }

  registro(): EventoAuditoria[] {
    return [...this.trilha]
  }

  /**
   * Fecha as chamadas esquecidas, e devolve os eventos para quem persiste.
   *
   * Enquanto este objeto morria a cada reinicio isto nao existia: o quadro
   * nascia vazio todo dia. Com a persistencia ele sobrevive, e um "chamado"
   * que ninguem fechou volta na manha seguinte parecendo responsavel no portao
   * AGORA — a professora libera uma crianca para ninguem. O segundo dano e
   * mais silencioso: `substituirCadastro` recusa a troca com crianca em saida,
   * entao uma chamada esquecida de ontem tranca a secretaria fora da
   * importacao para sempre. Antes bastava reiniciar.
   *
   * Usa as transicoes que ja existem — `cancelar` a partir de `chamado`,
   * `encerrar` a partir de `retorno` — e grava na trilha como qualquer outra
   * acao. Nao e remocao silenciosa.
   *
   * `papel: 'sistema'` e deliberado: dizer 'portaria' afirmaria que a porteira
   * cancelou, e ninguem cancelou. O campo e livre no evento de auditoria e
   * NAO pertence a uniao `Papel` que autoriza — 'sistema' nunca vira papel
   * aceitavel numa conexao.
   *
   * `liberado` fica de fora de proposito. Marca-lo como entregue seria o
   * sistema afirmando que um adulto recebeu a crianca sem nenhum adulto ter
   * recebido nada; devolve-lo a aguardando apagaria a confirmacao da
   * professora, que e o unico evento que este sistema existe para proteger.
   * Crianca liberada e nao entregue e caso aberto, e caso aberto e para uma
   * pessoa fechar — e a professora agora tem `retornar` para fechar o dela.
   *
   * `retorno` ENTRA. Sem isso ele viraria o novo caso aberto eterno: a crianca
   * voltou para a sala, ninguem chamou de novo, ninguem encerrou, e o quadro
   * carrega aquilo para sempre, inclusive trancando a troca de cadastro. E
   * fechar um `retorno` esquecido nao afirma nada falso: doze horas depois,
   * nao ha ninguem no portao.
   */
  expirar(antesDe: number, agora: number): EventoAuditoria[] {
    const eventos: EventoAuditoria[] = []
    for (const chamada of [...this.chamadas.values()]) {
      /*
        O corte e por `em`, nao por `desde`.

        `desde` e a chave de ORDENACAO da fila, e `aplicar` a preserva entre
        transicoes do mesmo ciclo (`anterior?.desde ?? agora`). Hoje as duas
        coincidem para quem esta `chamado`, porque toda chamada nasce vinda de
        `aguardando`, sem anterior — mas isso e coincidencia, nao regra, e a
        primeira transicao que traga um `desde` antigo faz a chamada nascer
        VENCIDA: o proximo `expirarEsquecidas()` a apaga do quadro com o
        responsavel parado no portao.

        `em` e o instante da ultima acao. E o que "esquecida" quer dizer.
      */
      const acao = EXPIRAVEIS[chamada.estado]
      if (!acao || chamada.em >= antesDe) continue

      this.chamadas.delete(chamada.alunoId)
      const evento: EventoAuditoria = {
        alunoId: chamada.alunoId,
        nome: chamada.nome,
        turma: chamada.turma,
        acao,
        papel: 'sistema',
        origem: 'expiracao automatica',
        de: chamada.estado,
        para: 'aguardando',
        em: agora,
        razao: '',
        responsavelId: '',
        responsavelNome: '',
      }
      this.trilha.push(evento)
      eventos.push(evento)
    }
    return eventos
  }

  /**
   * Troca o cadastro inteiro. Nao apaga a trilha: ela e append-only, e apagar
   * o historico ao reimportar uma planilha seria exatamente o furo que ela
   * existe para tapar.
   *
   * Recusa a troca se houver crianca em transito. Uma reimportacao no meio da
   * saida sumiria com criancas ja chamadas ou liberadas de todas as telas, e
   * deixaria a trilha com um "liberar" que nunca recebe o "entregar".
   */
  substituirCadastro(alunos: Aluno[]): void {
    if (this.chamadas.size > 0) {
      /*
        Nomeia quem esta em saida. "ha 1 crianca em saida agora" manda a
        secretaria procurar sem dizer onde — e depois da persistencia essa
        crianca pode ser de ontem, o que torna a busca as cegas ainda pior.
      */
      const presas = [...this.chamadas.values()]
        .map((c) => `${c.nome} (${c.turma}, ${c.estado})`)
        .join('; ')
      throw new Error(
        `ha ${this.chamadas.size} crianca(s) em saida agora; termine a saida antes de trocar o cadastro: ${presas}`,
      )
    }
    this.cadastro.clear()
    for (const aluno of alunos) this.cadastro.set(aluno.id, aluno)
    this.versaoCadastro++
  }
}

export type { Acao }
