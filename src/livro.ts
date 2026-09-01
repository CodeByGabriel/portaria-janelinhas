import { proximo, exigirDono, type Estado, type Papel, type Acao } from './estados.ts'
import { semear, type Aluno, type Turma } from './semente.ts'
import type { Chamada, Retrato, Comando, EventoAuditoria } from './protocolo.ts'

/**
 * O estado do dia da escola. Puro: sem rede, sem relogio, sem armazenamento.
 * O relogio entra sempre por parametro, para que o teste mande no tempo.
 */
export class Livro {
  private readonly cadastro = new Map<string, Aluno>()
  private readonly chamadas = new Map<string, Chamada>()
  private readonly trilha: EventoAuditoria[] = []
  /** Sobe a cada troca de cadastro. O cliente usa para saber que a lista dele venceu. */
  private versaoCadastro = 1

  constructor(alunos: Aluno[] = semear()) {
    for (const aluno of alunos) this.cadastro.set(aluno.id, aluno)
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
      throw new Error(
        `ha ${this.chamadas.size} crianca(s) em saida agora; termine a saida antes de trocar o cadastro`,
      )
    }
    this.cadastro.clear()
    for (const aluno of alunos) this.cadastro.set(aluno.id, aluno)
    this.versaoCadastro++
  }
}

export type { Acao }
