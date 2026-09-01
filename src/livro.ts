import { proximo, type Estado, type Papel } from './estados.ts'
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

  constructor(alunos: Aluno[] = semear()) {
    for (const aluno of alunos) this.cadastro.set(aluno.id, aluno)
  }

  alunos(): Aluno[] {
    return [...this.cadastro.values()]
  }

  aplicar(comando: Comando, agora: number): EventoAuditoria {
    const aluno = this.cadastro.get(comando.alunoId)
    if (!aluno) throw new Error(`aluno desconhecido: ${comando.alunoId}`)

    const de: Estado = this.chamadas.get(comando.alunoId)?.estado ?? 'aguardando'
    const para = proximo(de, comando.tipo)

    if (para === 'aguardando') {
      this.chamadas.delete(comando.alunoId)
    } else {
      this.chamadas.set(comando.alunoId, {
        alunoId: aluno.id,
        nome: aluno.nome,
        turma: aluno.turma,
        estado: para,
        em: agora,
      })
    }

    const evento: EventoAuditoria = {
      alunoId: aluno.id,
      nome: aluno.nome,
      acao: comando.tipo,
      de,
      para,
      em: agora,
    }
    this.trilha.push(evento)
    return evento
  }

  /**
   * A sala so enxerga a propria turma, e o filtro e aqui — no servidor.
   * Sala sem turma declarada nao ve ninguem: e mais seguro mostrar nada do
   * que mostrar a escola inteira por causa de um parametro esquecido.
   */
  retratoPara(papel: Papel, turma?: Turma, agora = 0): Retrato {
    const todas = [...this.chamadas.values()]
    const chamadas =
      papel === 'sala' ? (turma ? todas.filter((c) => c.turma === turma) : []) : todas
    return { tipo: 'retrato', chamadas, em: agora }
  }

  registro(): EventoAuditoria[] {
    return [...this.trilha]
  }

  substituirCadastro(alunos: Aluno[]): void {
    this.cadastro.clear()
    this.chamadas.clear()
    for (const aluno of alunos) this.cadastro.set(aluno.id, aluno)
  }
}
