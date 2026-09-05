import {
  semear,
  alertasDaSemente,
  responsaveisDaSemente,
  type Aluno,
} from './semente.ts'
import type { Dispositivo } from './sessao.ts'
import type { Responsavel, Vinculo } from './responsaveis.ts'
import type { Chamada, EventoAuditoria, Instantaneo, Delegacao } from './protocolo.ts'

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

CREATE TABLE IF NOT EXISTS responsaveis (
  id       TEXT PRIMARY KEY,
  nome     TEXT NOT NULL,
  vinculo  TEXT NOT NULL DEFAULT '',
  telefone TEXT NOT NULL DEFAULT ''
);

/*
  O vinculo e a tabela, e nao uma coluna no aluno.

  Uma crianca tem mae, pai, avo, as vezes a vizinha autorizada; um adulto busca
  dois ou tres filhos. Um "responsavel principal" seria ficcao, e no dia em que
  o outro aparece no portao o sistema estaria errado por desenho.
*/
CREATE TABLE IF NOT EXISTS vinculos (
  alunoId       TEXT NOT NULL,
  responsavelId TEXT NOT NULL,
  impedido      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (alunoId, responsavelId)
);

CREATE INDEX IF NOT EXISTS vinculos_por_responsavel ON vinculos (responsavelId);

/*
  Autorizacao temporaria (fase 3). Tabela nova, e nao coluna: nasce com
  CREATE IF NOT EXISTS, entao um banco antigo ganha a tabela vazia na primeira
  subida sem nenhuma migracao por ALTER.
*/
CREATE TABLE IF NOT EXISTS delegacoes (
  id                TEXT PRIMARY KEY,
  alunoId           TEXT NOT NULL,
  nome              TEXT NOT NULL,
  vinculo           TEXT NOT NULL DEFAULT '',
  telefone          TEXT NOT NULL DEFAULT '',
  validoDe          INTEGER NOT NULL,
  validoAte         INTEGER NOT NULL,
  autorizadoPor     TEXT NOT NULL,
  autorizadoPorNome TEXT NOT NULL DEFAULT '',
  criadoEm          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS delegacoes_por_aluno ON delegacoes (alunoId);

CREATE TABLE IF NOT EXISTS dispositivos (
  impressao  TEXT PRIMARY KEY,
  papel      TEXT NOT NULL,
  turma      TEXT NOT NULL DEFAULT '',
  apelido    TEXT NOT NULL DEFAULT '',
  criadoEm   INTEGER NOT NULL,
  revogadoEm INTEGER
);

CREATE TABLE IF NOT EXISTS meta (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);
`

/* A linha do SQLite vira Dispositivo. `turma` vazia significa ausente. */
function comoDispositivo(l: Record<string, unknown>): Dispositivo {
  const turma = String(l.turma ?? '')
  return {
    impressao: String(l.impressao),
    papel: String(l.papel) as Dispositivo['papel'],
    turma: turma === '' ? undefined : (turma as Dispositivo['turma']),
    apelido: String(l.apelido ?? ''),
    criadoEm: Number(l.criadoEm),
    revogadoEm: l.revogadoEm === null || l.revogadoEm === undefined ? null : Number(l.revogadoEm),
  }
}

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
    /*
      A trilha passou a gravar QUEM recebeu a crianca. Bancos anteriores a 2.1
      tem eventos sem esses campos — e eles precisam continuar legiveis, com o
      responsavel vazio, em vez de sumir ou virar `undefined`.
    */
    if (!this.temColuna('trilha', 'responsavelId')) {
      this.sql.exec(`ALTER TABLE trilha ADD COLUMN responsavelId TEXT NOT NULL DEFAULT ''`)
    }
    if (!this.temColuna('trilha', 'responsavelNome')) {
      this.sql.exec(`ALTER TABLE trilha ADD COLUMN responsavelNome TEXT NOT NULL DEFAULT ''`)
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
      const familias = responsaveisDaSemente()
      this.trocarResponsaveis(familias.responsaveis, familias.vinculos)
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
        'SELECT alunoId, nome, turma, acao, papel, origem, de, para, em, razao,' +
          ' responsavelId, responsavelNome FROM trilha ORDER BY seq',
      )
      .toArray() as unknown as EventoAuditoria[]

    const responsaveis = this.sql
      .exec('SELECT id, nome, vinculo, telefone FROM responsaveis ORDER BY nome')
      .toArray() as unknown as Responsavel[]

    const vinculos = this.sql
      .exec('SELECT alunoId, responsavelId, impedido FROM vinculos')
      .toArray()
      .map((l) => ({
        alunoId: String(l.alunoId),
        responsavelId: String(l.responsavelId),
        impedido: Number(l.impedido) === 1,
      }))

    return {
      alunos,
      chamadas,
      trilha,
      responsaveis,
      vinculos,
      delegacoes: this.listarDelegacoes(),
      versaoCadastro: Number(this.meta('versaoCadastro') ?? '1'),
    }
  }

  /** Append-only. Nao existe atualizacao nem remocao individual de evento. */
  registrar(evento: EventoAuditoria): void {
    this.sql.exec(
      `INSERT INTO trilha
         (alunoId, nome, turma, acao, papel, origem, de, para, em, razao,
          responsavelId, responsavelNome)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      evento.responsavelId,
      evento.responsavelNome,
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

  /*
    Vinculos que apontam para criancas que nao existem mais.

    Toda importacao de alunos RECALCULA os ids a partir de nome+turma. Uma
    crianca que mudou de turma, ou que saiu da escola, ganha id novo ou some — e
    os vinculos dela ficam apontando para ninguem.

    Isso e grave e e silencioso: `responsaveisDe` passa a devolver lista vazia,
    e `entregar` volta a funcionar SEM exigir responsavel. A escola perde a
    protecao inteira da 2.1 no dia em que reimporta a lista do bimestre, sem
    nenhum sinal — o app parece continuar funcionando, e funciona mesmo, so que
    sem a trava.

    Entao a poda e obrigatoria E o numero volta para a tela: nao dá para
    consertar sozinho (so a escola tem a segunda planilha), mas dá para dizer.
  */
  podarVinculosOrfaos(): number {
    const antes = this.contarVinculos()
    this.sql.exec(
      'DELETE FROM vinculos WHERE alunoId NOT IN (SELECT id FROM cadastro)',
    )
    // Responsavel sem nenhuma crianca deixa de ter razao de existir: guardar
    // nome e telefone de um adulto que nao busca ninguem e guardar dado
    // pessoal sem finalidade.
    this.sql.exec(
      'DELETE FROM responsaveis WHERE id NOT IN (SELECT responsavelId FROM vinculos)',
    )
    return antes - this.contarVinculos()
  }

  /**
   * So os responsaveis e vinculos, sem hidratar o resto.
   *
   * `carregar()` monta o instantaneo inteiro e semeia na primeira vez — chamar
   * aquilo no meio de uma importacao seria pagar o preco de tudo e correr o
   * risco de acionar um caminho que nao tem nada a ver com o que se quer aqui.
   */
  responsaveisEVinculos(): { responsaveis: Responsavel[]; vinculos: Vinculo[] } {
    const responsaveis = this.sql
      .exec('SELECT id, nome, vinculo, telefone FROM responsaveis ORDER BY nome')
      .toArray() as unknown as Responsavel[]
    const vinculos = this.sql
      .exec('SELECT alunoId, responsavelId, impedido FROM vinculos')
      .toArray()
      .map((l) => ({
        alunoId: String(l.alunoId),
        responsavelId: String(l.responsavelId),
        impedido: Number(l.impedido) === 1,
      }))
    return { responsaveis, vinculos }
  }

  contarVinculos(): number {
    return Number(this.sql.exec('SELECT COUNT(*) AS n FROM vinculos').one().n)
  }

  /*
    Dispositivos autorizados.

    Guarda a IMPRESSAO do token, nunca o token. Um vazamento desta tabela nao
    entrega nenhum aparelho — do mesmo jeito que uma tabela de senhas nao deve
    entregar senha.

    Revogar nao apaga a linha: escreve a data. Assim a escola continua sabendo
    que aquele tablet existiu, quando entrou e quando saiu — e um `DELETE` a
    mais nao vira, por acidente, um aparelho revogado voltando a funcionar.
  */
  registrarDispositivo(d: Dispositivo): void {
    this.sql.exec(
      `INSERT INTO dispositivos (impressao, papel, turma, apelido, criadoEm, revogadoEm)
       VALUES (?, ?, ?, ?, ?, ?)`,
      d.impressao,
      d.papel,
      d.turma ?? '',
      d.apelido,
      d.criadoEm,
      d.revogadoEm,
    )
  }

  dispositivoPor(impressao: string): Dispositivo | null {
    const linhas = this.sql
      .exec(
        'SELECT impressao, papel, turma, apelido, criadoEm, revogadoEm' +
          ' FROM dispositivos WHERE impressao = ?',
        impressao,
      )
      .toArray()
    if (linhas.length === 0) return null
    return comoDispositivo(linhas[0])
  }

  listarDispositivos(): Dispositivo[] {
    return this.sql
      .exec(
        'SELECT impressao, papel, turma, apelido, criadoEm, revogadoEm' +
          ' FROM dispositivos ORDER BY criadoEm',
      )
      .toArray()
      .map(comoDispositivo)
  }

  revogarDispositivo(impressao: string, em: number): boolean {
    const antes = this.sql
      .exec('SELECT revogadoEm FROM dispositivos WHERE impressao = ?', impressao)
      .toArray()
    if (antes.length === 0 || antes[0].revogadoEm !== null) return false
    this.sql.exec('UPDATE dispositivos SET revogadoEm = ? WHERE impressao = ?', em, impressao)
    return true
  }

  contarDispositivos(): number {
    return Number(this.sql.exec('SELECT COUNT(*) AS n FROM dispositivos').one().n)
  }

  /*
    Substitui responsaveis e vinculos inteiros, como o cadastro.

    Substituicao, e nao mesclagem: a planilha e a verdade da escola, e um
    vinculo que sumiu dela sumiu porque alguem o tirou. Mesclar deixaria
    autorizacoes antigas vivas para sempre, e a unica forma de revogar seria
    lembrar de fazer isso em outro lugar.
  */
  trocarResponsaveis(responsaveis: Responsavel[], vinculos: Vinculo[]): void {
    this.sql.exec('DELETE FROM vinculos')
    this.sql.exec('DELETE FROM responsaveis')
    for (const r of responsaveis) {
      this.sql.exec(
        'INSERT INTO responsaveis (id, nome, vinculo, telefone) VALUES (?, ?, ?, ?)',
        r.id,
        r.nome,
        r.vinculo,
        r.telefone,
      )
    }
    for (const v of vinculos) {
      this.sql.exec(
        'INSERT INTO vinculos (alunoId, responsavelId, impedido) VALUES (?, ?, ?)',
        v.alunoId,
        v.responsavelId,
        v.impedido ? 1 : 0,
      )
    }
  }

  /* ---------- fase 3: trilha por cursor, versao externa, delegacoes ---------- */

  /**
   * Eventos DEPOIS de um `seq`, em ordem, ate `limite`.
   *
   * E o cursor que o backend usa para puxar a trilha (3.2). Append-only mais
   * `seq` monotonico dao entrega at-least-once com deduplicacao exata: receber
   * duas vezes e inofensivo, pular e impossivel.
   */
  trilhaDepois(apos: number, limite: number): (EventoAuditoria & { seq: number })[] {
    return this.sql
      .exec(
        'SELECT seq, alunoId, nome, turma, acao, papel, origem, de, para, em, razao,' +
          ' responsavelId, responsavelNome FROM trilha WHERE seq > ? ORDER BY seq LIMIT ?',
        apos,
        limite,
      )
      .toArray()
      .map((l) => ({ ...(l as unknown as EventoAuditoria), seq: Number(l.seq), em: Number(l.em) }))
  }

  /**
   * A versao do cadastro segundo o BACKEND (3.1).
   *
   * `null` quando o cadastro vigente veio de planilha ou da semente — e por
   * isso a planilha LIMPA este valor ao importar: senao o backend repetiria a
   * mesma versao depois de uma importacao manual, receberia "ja vigente", e a
   * planilha ficaria valendo para sempre sem ninguem perceber.
   */
  versaoExterna(): number | null {
    const v = this.meta('versaoExterna')
    return v === null ? null : Number(v)
  }

  gravarVersaoExterna(versao: number): void {
    this.gravarMeta('versaoExterna', String(versao))
  }

  limparVersaoExterna(): void {
    this.sql.exec("DELETE FROM meta WHERE chave = 'versaoExterna'")
  }

  listarDelegacoes(): Delegacao[] {
    return this.sql
      .exec(
        'SELECT id, alunoId, nome, vinculo, telefone, validoDe, validoAte,' +
          ' autorizadoPor, autorizadoPorNome FROM delegacoes ORDER BY validoAte',
      )
      .toArray()
      .map((l) => ({
        id: String(l.id),
        alunoId: String(l.alunoId),
        nome: String(l.nome),
        vinculo: String(l.vinculo ?? ''),
        telefone: String(l.telefone ?? ''),
        validoDe: Number(l.validoDe),
        validoAte: Number(l.validoAte),
        autorizadoPor: String(l.autorizadoPor),
        autorizadoPorNome: String(l.autorizadoPorNome ?? ''),
      }))
  }

  /** Repetir o mesmo id substitui: o backend pode reenviar sem medo. */
  salvarDelegacao(d: Delegacao, criadoEm: number): void {
    this.sql.exec(
      `INSERT INTO delegacoes
         (id, alunoId, nome, vinculo, telefone, validoDe, validoAte,
          autorizadoPor, autorizadoPorNome, criadoEm)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         alunoId = excluded.alunoId, nome = excluded.nome, vinculo = excluded.vinculo,
         telefone = excluded.telefone, validoDe = excluded.validoDe,
         validoAte = excluded.validoAte, autorizadoPor = excluded.autorizadoPor,
         autorizadoPorNome = excluded.autorizadoPorNome`,
      d.id,
      d.alunoId,
      d.nome,
      d.vinculo,
      d.telefone,
      d.validoDe,
      d.validoAte,
      d.autorizadoPor,
      d.autorizadoPorNome,
      criadoEm,
    )
  }

  removerDelegacao(id: string): boolean {
    const antes = Number(
      this.sql.exec('SELECT COUNT(*) AS n FROM delegacoes WHERE id = ?', id).one().n,
    )
    this.sql.exec('DELETE FROM delegacoes WHERE id = ?', id)
    return antes > 0
  }

  /** Vencidas saem do disco. Na leitura elas ja nao contavam; isto e higiene. */
  podarDelegacoes(antesDe: number): number {
    const antes = this.contarDelegacoes()
    this.sql.exec('DELETE FROM delegacoes WHERE validoAte < ?', antesDe)
    return antes - this.contarDelegacoes()
  }

  /** Delegacao de crianca que saiu do cadastro nao tem mais a quem servir. */
  podarDelegacoesOrfas(): number {
    const antes = this.contarDelegacoes()
    this.sql.exec('DELETE FROM delegacoes WHERE alunoId NOT IN (SELECT id FROM cadastro)')
    return antes - this.contarDelegacoes()
  }

  contarDelegacoes(): number {
    return Number(this.sql.exec('SELECT COUNT(*) AS n FROM delegacoes').one().n)
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
