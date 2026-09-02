import { proximo, exigirDono, type Estado, type Papel, type Acao } from './estados.ts'
import { semear, type Aluno, type Turma } from './semente.ts'
import type { Chamada, Retrato, Comando, EventoAuditoria, Instantaneo } from './protocolo.ts'

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
        desde: anterior?.desde ?? agora,
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
   * Usa a transicao que ja existe — `cancelar`, de chamado para aguardando — e
   * grava na trilha como qualquer outra acao. Nao e remocao silenciosa.
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
   * pessoa fechar.
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
      if (chamada.estado !== 'chamado' || chamada.em >= antesDe) continue

      this.chamadas.delete(chamada.alunoId)
      const evento: EventoAuditoria = {
        alunoId: chamada.alunoId,
        nome: chamada.nome,
        turma: chamada.turma,
        acao: 'cancelar',
        papel: 'sistema',
        origem: 'expiracao automatica',
        de: 'chamado',
        para: 'aguardando',
        em: agora,
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
