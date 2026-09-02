import { semear, alertasDaSemente, type Aluno } from './semente.ts'
import type { Chamada, EventoAuditoria, Instantaneo } from './protocolo.ts'

/*
  A UNICA casa do SQL neste projeto.

  Por que existe: o Durable Object tinha o storage SQLite provisionado desde o
  primeiro commit (`new_sqlite_classes` no wrangler.toml) e nunca escreveu uma
  linha nele. Tudo vivia em RAM. As "Rules of Durable Objects" da Cloudflare
  sao explicitas: "In-memory state is not preserved if the Durable Object is
  evicted from memory due to inactivity, or if it crashes from an uncaught
  exception. Always persist important state to SQLite storage."

  Reinicio nao e excecao no modelo — e rotina: hibernacao por inatividade,
  eviccao, deploy, excecao nao tratada.

  O PIOR SINTOMA nao era perder a trilha. Era que `new Livro()` cai no padrao
  `semear()`, entao um reinicio nao deixava a tela vazia: ela voltava a mostrar
  os 44 alunos ficticios NO LUGAR da lista real importada pela escola. A
  porteira buscava um nome real, nao achava, e concluia que a crianca nao
  estava matriculada. Silencioso e plausivel — o pior tipo.

  A flag `semeado` na tabela `meta` e o que distingue "vazio porque nunca
  iniciou" de "vazio porque a escola assim quis". Sem ela, nao ha como decidir
  entre semear e respeitar.

  O Livro continua puro: ele NUNCA importa este arquivo. Quem costura os dois
  e o Durable Object, com escrita write-through — o padrao que a propria
  Cloudflare recomenda ("initialize from persistent storage and set instance
  variables the first time it is accessed").
*/

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS cadastro (
  id     TEXT PRIMARY KEY,
  nome   TEXT NOT NULL,
  turma  TEXT NOT NULL,
  alerta TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS chamadas (
  alunoId TEXT PRIMARY KEY,
  nome    TEXT NOT NULL,
  turma   TEXT NOT NULL,
  estado  TEXT NOT NULL,
  desde   INTEGER NOT NULL,
  em      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS trilha (
  seq     INTEGER PRIMARY KEY AUTOINCREMENT,
  alunoId TEXT NOT NULL,
  nome    TEXT NOT NULL,
  turma   TEXT NOT NULL,
  acao    TEXT NOT NULL,
  papel   TEXT NOT NULL,
  origem  TEXT NOT NULL,
  de      TEXT NOT NULL,
  para    TEXT NOT NULL,
  em      INTEGER NOT NULL,
  razao   TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS trilha_por_tempo ON trilha (em);

CREATE TABLE IF NOT EXISTS meta (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);
`

export class Deposito {
  private readonly sql: SqlStorage

  constructor(sql: SqlStorage) {
    this.sql = sql
  }

  /** Idempotente: pode rodar a cada construcao do Durable Object. */
  iniciar(): void {
    this.sql.exec(ESQUEMA)
    this.migrar()
  }

  /*
    Migracao de esquema, e por que ela e assim.

    `iniciar()` roda em TODA construcao do Durable Object, dentro do
    `blockConcurrencyWhile`. Uma excecao aqui e deterministica: nenhuma tela
    sobe, e recarregar repete o erro. Entao a regra e uma so — quem decide se a
    coluna existe e o BANCO, nunca um numero de versao que a gente acha que
    escreveu.

    O caminho errado, e tentador: por a coluna no ESQUEMA e disparar o ALTER a
    partir de uma versao guardada em `meta`. Banco novo nasceria com a coluna,
    leria a versao ausente como antiga, dispararia o ALTER e o SQLite
    responderia `duplicate column name` — laco de boot na primeira subida.

    `PRAGMA table_info` responde sobre o banco de verdade, entao vale igual num
    banco novo, num banco antigo e numa segunda passagem. E fica sincrono, sem
    `await` no meio: e assim que as escritas do Durable Object coalescem numa
    transacao so.
  */
  private migrar(): void {
    if (!this.temColuna('trilha', 'razao')) {
      this.sql.exec(`ALTER TABLE trilha ADD COLUMN razao TEXT NOT NULL DEFAULT ''`)
    }
    if (!this.temColuna('cadastro', 'alerta')) {
      this.sql.exec(`ALTER TABLE cadastro ADD COLUMN alerta TEXT NOT NULL DEFAULT ''`)
    }
  }

  private temColuna(tabela: string, coluna: string): boolean {
    const colunas = this.sql.exec(`PRAGMA table_info(${tabela})`).toArray()
    return colunas.some((c) => String((c as { name: unknown }).name) === coluna)
  }

  private meta(chave: string): string | null {
    const linhas = this.sql.exec('SELECT valor FROM meta WHERE chave = ?', chave).toArray()
    return linhas.length > 0 ? String(linhas[0].valor) : null
  }

  private gravarMeta(chave: string, valor: string): void {
    this.sql.exec(
      'INSERT INTO meta (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor',
      chave,
      valor,
    )
  }

  /**
   * Devolve o estado do dia para hidratar o Livro.
   *
   * Na PRIMEIRA vez — e so nela — semeia os alunos ficticios e marca a flag.
   * Depois disso o cadastro em disco manda, mesmo que a escola tenha
   * importado uma lista diferente. E o conserto do defeito descrito acima.
   */
  carregar(): Instantaneo {
    if (this.meta('semeado') === null) {
      this.trocarCadastro(semear(), 1, alertasDaSemente())
      this.gravarMeta('semeado', 'sim')
    }

    /*
      O texto do alerta NAO entra no instantaneo do cadastro.

      Ele sai daqui por `alertaDe`, uma crianca por vez, quando alguem esta
      prestes a agir. O que o cadastro carrega e o booleano — e assim `/alunos`,
      que despeja o cadastro inteiro no navegador, fica incapaz de vazar a
      situacao familiar de ninguem.
    */
    const alunos = this.sql
      .exec(
        "SELECT id, nome, turma, alerta <> '' AS temAlerta FROM cadastro ORDER BY id",
      )
      .toArray()
      .map((l) => ({
        id: String(l.id),
        nome: String(l.nome),
        turma: String(l.turma),
        temAlerta: Number(l.temAlerta) === 1,
      })) as unknown as Aluno[]

    const chamadas = this.sql
      .exec('SELECT alunoId, nome, turma, estado, desde, em FROM chamadas ORDER BY desde')
      .toArray() as unknown as Chamada[]

    const trilha = this.sql
      .exec(
        /*
          Migracao, INSERT e SELECT sao UM passo so.

          Com `DEFAULT ''`, esquecer o INSERT ou o SELECT nao da erro: o Livro
          guarda a trilha em RAM, entao a razao continua aparecendo enquanto o
          objeto viver, e evapora na primeira hibernacao. Registro plausivelmente
          incompleto e o pior defeito possivel numa trilha de entrega de crianca.
        */
        'SELECT alunoId, nome, turma, acao, papel, origem, de, para, em, razao' +
          ' FROM trilha ORDER BY seq',
      )
      .toArray() as unknown as EventoAuditoria[]

    return {
      alunos,
      chamadas,
      trilha,
      versaoCadastro: Number(this.meta('versaoCadastro') ?? '1'),
    }
  }

  /** Append-only. Nao existe atualizacao nem remocao individual de evento. */
  registrar(evento: EventoAuditoria): void {
    this.sql.exec(
      `INSERT INTO trilha (alunoId, nome, turma, acao, papel, origem, de, para, em, razao)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      evento.alunoId,
      evento.nome,
      evento.turma,
      evento.acao,
      evento.papel,
      evento.origem,
      evento.de,
      evento.para,
      evento.em,
      evento.razao,
    )
  }

  salvarChamada(c: Chamada): void {
    this.sql.exec(
      `INSERT INTO chamadas (alunoId, nome, turma, estado, desde, em)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(alunoId) DO UPDATE SET
         estado = excluded.estado, em = excluded.em, desde = excluded.desde`,
      c.alunoId,
      c.nome,
      c.turma,
      c.estado,
      c.desde,
      c.em,
    )
  }

  removerChamada(alunoId: string): void {
    this.sql.exec('DELETE FROM chamadas WHERE alunoId = ?', alunoId)
  }

  trocarCadastro(
    alunos: Aluno[],
    versao: number,
    alertas: { id: string; texto: string }[] = [],
  ): void {
    const texto = new Map(alertas.map((a) => [a.id, a.texto]))
    this.sql.exec('DELETE FROM cadastro')
    for (const a of alunos) {
      this.sql.exec(
        'INSERT INTO cadastro (id, nome, turma, alerta) VALUES (?, ?, ?, ?)',
        a.id,
        a.nome,
        a.turma,
        texto.get(a.id) ?? '',
      )
    }
    this.gravarMeta('versaoCadastro', String(versao))
  }

  /**
   * O texto da restricao de UMA crianca.
   *
   * Uma consulta por crianca, e nao um despejo: quem esta prestes a chamar ou
   * liberar pede a daquela crianca, e nada mais sai do servidor.
   */
  alertaDe(alunoId: string): string {
    const linhas = this.sql
      .exec('SELECT alerta FROM cadastro WHERE id = ?', alunoId)
      .toArray()
    return linhas.length > 0 ? String(linhas[0].alerta) : ''
  }

  /**
   * Remove eventos anteriores ao corte e devolve quantos saiu.
   *
   * Nao contradiz "append-only": append-only proibe EDITAR o passado, nao
   * proibe ter prazo de retencao. Persistir crescimento ilimitado e pior do
   * que mante-lo em RAM, porque agora ele sobrevive aos reinicios.
   */
  podar(antesDe: number): number {
    const antes = this.contarTrilha()
    this.sql.exec('DELETE FROM trilha WHERE em < ?', antesDe)
    return antes - this.contarTrilha()
  }

  contarTrilha(): number {
    return Number(this.sql.exec('SELECT COUNT(*) AS n FROM trilha').one().n)
  }
}
