/// <reference types="@cloudflare/vitest-plugin/types" />
import { env, abortAllDurableObjects, reset, runInDurableObject } from 'cloudflare:test'
import { describe, it, expect, beforeEach } from 'vitest'

/*
  A camada de rede do Durable Object, que ate agora nao tinha um unico teste.

  `portaria.ts` e `index.ts` nao sao instanciaveis pelo `node --test`: eles
  dependem de WebSocketPair e DurableObjectState, que so existem no workerd.
  Consequencia — o gate de papel, o filtro de turma na conexao, os codigos de
  erro das rotas HTTP e o ciclo de vida do WebSocket viviam so sob o
  fim-a-fim, que precisa do servidor de pe e nao roda no `npm test`.

  Estes testes protegem, no nivel de unidade, furos que hoje so o e2e cobre:
  C2 (papel fail-closed), C3 (rotas fechadas) e o furo 1 da segunda passagem
  (a sala agindo fora da propria turma).
*/

function portaria() {
  return env.PORTARIA.get(env.PORTARIA.idFromName('escola'))
}

const pedir = (caminho: string, init?: RequestInit) =>
  portaria().fetch(new Request(`http://do${caminho}`, init))

type Retrato = { tipo: string; chamadas: { alunoId: string; estado: string }[] }
type Ligacao = WebSocket & { __retratos: Retrato[] }

/**
 * Abre um WebSocket contra o Durable Object e devolve o lado do cliente.
 *
 * O coletor e ligado ANTES de qualquer espera, e guarda todo retrato que
 * chegar. Sem ele havia uma corrida silenciosa: o servidor manda o retrato
 * inicial no instante da conexao, e um `proximoRetrato` que so registra o
 * ouvinte depois disso espera para sempre por uma mensagem que ja passou.
 * Dava "nenhum retrato chegou" em testes cujo codigo estava certo, e passava
 * por sorte de escalonamento nos outros.
 */
async function ligar(query: string): Promise<Ligacao> {
  const resposta = await portaria().fetch(
    new Request(`http://do/ws?${query}`, { headers: { Upgrade: 'websocket' } }),
  )
  const ws = resposta.webSocket
  if (!ws) throw new Error(`sem webSocket na resposta (status ${resposta.status})`)
  ws.accept()

  const ligacao = ws as Ligacao
  ligacao.__retratos = []
  ws.addEventListener('message', (evento: MessageEvent) => {
    const m = JSON.parse(String(evento.data))
    if (m.tipo === 'retrato') ligacao.__retratos.push(m)
  })
  return ligacao
}

/**
 * Espera o PROXIMO retrato que chegar naquele socket.
 *
 * Semantica de evento, nao de estado: serve para "mandei um comando, quero a
 * resposta dele". Para o primeiro retrato da conexao, use `retratoInicial` —
 * aquele pode ja ter chegado antes de alguem estar ouvindo.
 */
function proximoRetrato(ws: WebSocket, msLimite = 3000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const ouvir = (evento: MessageEvent) => {
      const m = JSON.parse(String(evento.data))
      if (m.tipo === 'retrato') {
        ws.removeEventListener('message', ouvir)
        resolve(m)
      }
    }
    ws.addEventListener('message', ouvir)
    setTimeout(() => reject(new Error('nenhum retrato chegou')), msLimite)
  })
}

/**
 * Espera ate um retrato satisfazer a condicao.
 *
 * `proximoRetrato` pega o proximo que chegar — e se houver um antigo na fila,
 * ele resolve com o retrato errado e o teste mede outra coisa. Onde o que
 * importa e o ESTADO, e nao o proximo evento, use este.
 */
function ateQue(
  ws: WebSocket,
  condicao: (r: { chamadas: { alunoId: string; estado: string }[] }) => boolean,
  msLimite = 4000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const parar = setTimeout(() => {
      ws.removeEventListener('message', ouvir)
      resolve(false)
    }, msLimite)
    const ouvir = (evento: MessageEvent) => {
      const m = JSON.parse(String(evento.data))
      if (m.tipo === 'retrato' && condicao(m)) {
        clearTimeout(parar)
        ws.removeEventListener('message', ouvir)
        resolve(true)
      }
    }
    ws.addEventListener('message', ouvir)
  })
}

/**
 * O primeiro retrato da conexao, que pode ja ter chegado.
 *
 * O servidor o envia no instante do accept, e um ouvinte registrado depois
 * disso espera para sempre por uma mensagem que ja passou. Dava "nenhum retrato
 * chegou" em teste cujo codigo estava certo, e passava por sorte de
 * escalonamento nos demais — o coletor de `ligar` existe para isto.
 */
async function retratoInicial(ws: Ligacao, msLimite = 3000): Promise<Retrato> {
  if (ws.__retratos.length) return ws.__retratos[0]
  await proximoRetrato(ws, msLimite)
  return ws.__retratos[0]
}

describe('gate de papel — furo C2, fail-closed', () => {
  it('recusa a conexao sem papel', async () => {
    expect((await pedir('/alunos')).status).toBe(400)
  })

  it.each(['Sala', 'SALA', 'professora', '', ' sala', 'PORTARIA'])(
    'recusa o papel "%s"',
    async (papel) => {
      const r = await pedir(`/alunos?papel=${encodeURIComponent(papel)}`)
      expect(r.status).toBe(400)
    },
  )

  it('aceita exatamente portaria e sala', async () => {
    expect((await pedir('/alunos?papel=portaria')).status).toBe(200)
    expect((await pedir('/alunos?papel=sala')).status).toBe(403)
  })
})

describe('rotas HTTP — furo C3', () => {
  it('so a portaria le o cadastro', async () => {
    expect((await pedir('/alunos?papel=sala')).status).toBe(403)
    const r = await pedir('/alunos?papel=portaria')
    expect(r.status).toBe(200)
    expect((await r.json<unknown[]>()).length).toBe(44)
  })

  it('so a portaria le a trilha', async () => {
    expect((await pedir('/registro?papel=sala')).status).toBe(403)
    expect((await pedir('/registro?papel=portaria')).status).toBe(200)
  })

  it('importar exige POST', async () => {
    expect((await pedir('/importar?papel=portaria')).status).toBe(405)
  })

  it('importar exige o papel da portaria', async () => {
    const r = await pedir('/importar?papel=sala', { method: 'POST', body: 'Nome,Turma' })
    expect(r.status).toBe(403)
  })

  it('caminho desconhecido nao vaza nada', async () => {
    expect((await pedir('/qualquer?papel=portaria')).status).toBe(404)
  })
})

describe('WebSocket — a sala so enxerga a propria turma', () => {
  it('entrega um retrato assim que conecta', async () => {
    const ws = await ligar('papel=portaria')
    const retrato = await proximoRetrato(ws)
    expect(retrato.tipo).toBe('retrato')
    expect(Array.isArray(retrato.chamadas)).toBe(true)
    ws.close()
  })

  it('REGRESSAO: sala sem turma declarada nao ve ninguem', async () => {
    const portariaWs = await ligar('papel=portaria')
    await proximoRetrato(portariaWs)
    const cega = await ligar('papel=sala')
    await proximoRetrato(cega)

    portariaWs.send(JSON.stringify({ tipo: 'chamar', alunoId: 'a01' }))
    const daPortaria = await proximoRetrato(portariaWs)
    expect((daPortaria.chamadas as unknown[]).length).toBe(1)

    const daCega = await proximoRetrato(cega)
    expect((daCega.chamadas as unknown[]).length).toBe(0)

    portariaWs.send(JSON.stringify({ tipo: 'cancelar', alunoId: 'a01' }))
    portariaWs.close()
    cega.close()
  })

  it('REGRESSAO: turma invalida na query nao amplia o que a sala ve', async () => {
    const portariaWs = await ligar('papel=portaria')
    await proximoRetrato(portariaWs)
    const inventada = await ligar('papel=sala&turma=Sexto%20Ano')
    await proximoRetrato(inventada)

    portariaWs.send(JSON.stringify({ tipo: 'chamar', alunoId: 'a01' }))
    await proximoRetrato(portariaWs)
    const vista = await proximoRetrato(inventada)
    expect((vista.chamadas as unknown[]).length).toBe(0)

    portariaWs.send(JSON.stringify({ tipo: 'cancelar', alunoId: 'a01' }))
    portariaWs.close()
    inventada.close()
  })
})

/*
  Derruba a instancia SEM apagar o disco — e a simulacao de reinicio.

  Nao uso evictDurableObject: ele existe no plugin, e a documentacao promete
  exatamente isto, mas na versao 1.1.3 ele nao resolve a promessa quando o
  objeto ja esta ocioso — os testes ficam pendurados ate o timeout. Verifiquei
  isolando: um fetch, um evict, outro fetch trava sozinho, sem nada do nosso
  codigo envolvido.

  abortAllDurableObjects faz o que precisamos e a propria documentacao diz que
  preserva os dados: "Unlike reset(), this does not delete persisted data."
*/
const derrubarInstancia = () => abortAllDurableObjects()

describe('persistencia — sobrevive ao reinicio do Durable Object', () => {
  const PLANILHA = [
    'Nome,Turma',
    'Ana Beatriz Souza,Pré 1',
    'Bruno Assuncao,Pré 1',
    'Carlos Lima,9º ano',
  ].join('\n')

  beforeEach(async () => {
    await reset()
  })

  async function importar(csv: string) {
    return pedir('/importar?papel=portaria', { method: 'POST', body: csv })
  }

  it('a trilha continua integra depois da eviccao', async () => {
    const ws = await ligar('papel=portaria')
    await proximoRetrato(ws)
    ws.send(JSON.stringify({ tipo: 'chamar', alunoId: 'a01' }))
    await proximoRetrato(ws)
    ws.send(JSON.stringify({ tipo: 'chamar', alunoId: 'a02' }))
    await proximoRetrato(ws)
    ws.close()

    const antes = await (await pedir('/registro?papel=portaria')).json<unknown[]>()
    expect(antes.length).toBe(2)

    await derrubarInstancia()

    const depois = await (await pedir('/registro?papel=portaria')).json<unknown[]>()
    expect(depois.length).toBe(2)
    expect(depois).toEqual(antes)
  })

  it('REGRESSAO: a eviccao NAO devolve a semente no lugar da escola', async () => {
    const r = await importar(PLANILHA)
    expect(r.status).toBe(200)

    const importados = await (await pedir('/alunos?papel=portaria')).json<{ nome: string }[]>()
    expect(importados.length).toBe(3)

    await derrubarInstancia()

    const depois = await (await pedir('/alunos?papel=portaria')).json<{ nome: string }[]>()
    expect(depois.length).toBe(3)
    expect(depois.map((a) => a.nome).sort()).toEqual([
      'Ana Beatriz Souza',
      'Bruno Assuncao',
      'Carlos Lima',
    ])
    // O sintoma antigo: 44 alunos ficticios reaparecendo no lugar da escola.
    expect(depois.length).not.toBe(44)
  })

  it('as chamadas em transito sobrevivem: quem estava liberado continua liberado', async () => {
    const portariaWs = await ligar('papel=portaria')
    await proximoRetrato(portariaWs)
    const sala = await ligar('papel=sala&turma=' + encodeURIComponent('Pré 1'))
    await proximoRetrato(sala)

    portariaWs.send(JSON.stringify({ tipo: 'chamar', alunoId: 'a01' }))
    await proximoRetrato(portariaWs)
    sala.send(JSON.stringify({ tipo: 'liberar', alunoId: 'a01' }))

    // Confirma que liberar de fato passou ANTES de derrubar a instancia.
    // Sem isto, uma recusa silenciosa deixa o teste medindo a coisa errada:
    // ele consome um retrato antigo da fila e conclui que funcionou.
    const confirmado = await ateQue(
      portariaWs,
      (r) => r.chamadas.some((c) => c.alunoId === 'a01' && c.estado === 'liberado'),
    )
    expect(confirmado).toBe(true)
    portariaWs.close()
    sala.close()

    await derrubarInstancia()

    const nova = await ligar('papel=portaria')
    const retrato = await proximoRetrato(nova)
    const chamadas = retrato.chamadas as { alunoId: string; estado: string }[]
    expect(chamadas.length).toBe(1)
    expect(chamadas[0].alunoId).toBe('a01')
    expect(chamadas[0].estado).toBe('liberado')
    nova.close()
  })

  it('a versao do cadastro sobrevive, para o tablet saber que a lista venceu', async () => {
    const ws = await ligar('papel=portaria')
    const inicial = await proximoRetrato(ws)
    ws.close()
    await importar(PLANILHA)

    await derrubarInstancia()

    const nova = await ligar('papel=portaria')
    const depois = await proximoRetrato(nova)
    expect(depois.cadastro).toBeGreaterThan(inicial.cadastro as number)
    nova.close()
  })

  it('entregue sai do disco, nao so da memoria', async () => {
    const portariaWs = await ligar('papel=portaria')
    await proximoRetrato(portariaWs)
    const sala = await ligar('papel=sala&turma=' + encodeURIComponent('Pré 1'))
    await proximoRetrato(sala)

    portariaWs.send(JSON.stringify({ tipo: 'chamar', alunoId: 'a01' }))
    await proximoRetrato(portariaWs)
    sala.send(JSON.stringify({ tipo: 'liberar', alunoId: 'a01' }))
    await proximoRetrato(sala)
    portariaWs.send(JSON.stringify({ tipo: 'entregar', alunoId: 'a01' }))
    await proximoRetrato(portariaWs)
    portariaWs.close()
    sala.close()

    await derrubarInstancia()

    const nova = await ligar('papel=portaria')
    const retrato = await proximoRetrato(nova)
    expect((retrato.chamadas as unknown[]).length).toBe(0)
    // mas a trilha guarda as tres transicoes
    const trilha = await (await pedir('/registro?papel=portaria')).json<unknown[]>()
    expect(trilha.length).toBe(3)
    nova.close()
  })
})

describe('tetos de tamanho', () => {
  beforeEach(async () => {
    await reset()
  })

  it('recusa planilha maior que o limite', async () => {
    const gigante = 'Nome,Turma\n' + 'Ana Souza,Pré 1\n'.repeat(80_000)
    const r = await pedir('/importar?papel=portaria', { method: 'POST', body: gigante })
    expect(r.status).toBe(413)
    const corpo = await r.json<{ erros: { motivo: string }[] }>()
    expect(corpo.erros[0].motivo).toMatch(/grande demais/)
  })

  it('a resposta nao carrega um erro por linha invalida', async () => {
    const muitosErros = 'Nome,Turma\n' + 'Ana Souza,Turma Fantasma\n'.repeat(500)
    const r = await pedir('/importar?papel=portaria', { method: 'POST', body: muitosErros })
    expect(r.status).toBe(422)
    const corpo = await r.json<{ erros: unknown[]; errosTotal: number }>()
    expect(corpo.erros.length).toBe(100)
    expect(corpo.errosTotal).toBe(500)
  })
})

describe('chamada esquecida nao atravessa a noite', () => {
  beforeEach(async () => {
    await reset()
  })

  /*
    Envelhece a chamada no DISCO, sem tocar na aplicacao.

    Nao ha como adiantar o relogio do workerd, e por um `Date.now()` injetavel
    no Durable Object so para isto o teste passaria a medir um cano de teste em
    vez do caminho de producao. Reescrever `desde` no SQLite produz exatamente
    o estado que o disco teria depois de uma noite, e o caminho exercitado
    depois disso e o de producao inteiro: hidratacao, expiracao, persistencia,
    transmissao.
  */
  async function envelhecerNoDisco(quandoMs: number) {
    await runInDurableObject(portaria(), (_instancia, estado) => {
      estado.storage.sql.exec('UPDATE chamadas SET desde = ?, em = ?', quandoMs, quandoMs)
    })
  }

  it('REGRESSAO: um chamado de ontem nao volta no quadro de hoje', async () => {
    /*
      Enquanto o Livro morria a cada reinicio, o quadro nascia vazio todo dia.
      Com a persistencia da 0.2 ele sobrevive — e um "chamado" que ninguem
      fechou volta na manha seguinte parecendo responsavel no portao AGORA.
      A professora libera uma crianca para ninguem.
    */
    const ws = await ligar('papel=portaria')
    await proximoRetrato(ws)
    ws.send(JSON.stringify({ tipo: 'chamar', alunoId: 'a01' }))
    await ateQue(ws, (r) => (r.chamadas as unknown[]).length === 1)
    ws.close()

    await envelhecerNoDisco(1_000_000) // 1970, bem antes de qualquer corte
    await derrubarInstancia()

    const nova = await ligar('papel=portaria')
    const retrato = await proximoRetrato(nova)
    expect((retrato.chamadas as unknown[]).length).toBe(0)
    nova.close()
  })

  it('e a expiracao entra na trilha como acao do sistema, nao da portaria', async () => {
    const ws = await ligar('papel=portaria')
    await proximoRetrato(ws)
    ws.send(JSON.stringify({ tipo: 'chamar', alunoId: 'a01' }))
    await ateQue(ws, (r) => (r.chamadas as unknown[]).length === 1)
    ws.close()

    await envelhecerNoDisco(1_000_000)
    await derrubarInstancia()

    const nova = await ligar('papel=portaria')
    await proximoRetrato(nova)
    const trilha = await (
      await pedir('/registro?papel=portaria')
    ).json<{ acao: string; papel: string; origem: string; de: string; para: string }[]>()

    // O "chamar" continua la: a expiracao acrescenta, nunca reescreve.
    expect(trilha.length).toBe(2)
    expect(trilha[0].acao).toBe('chamar')

    const fim = trilha[1]
    expect(fim.acao).toBe('cancelar')
    expect(fim.de).toBe('chamado')
    expect(fim.para).toBe('aguardando')
    // Dizer 'portaria' aqui afirmaria que a porteira cancelou. Ninguem cancelou.
    expect(fim.papel).toBe('sistema')
    expect(fim.origem).toMatch(/expiracao/)
    nova.close()
  })

  it('REGRESSAO: uma chamada esquecida deixa de trancar a importacao para sempre', async () => {
    /*
      `substituirCadastro` recusa a troca com crianca em saida — protecao certa.
      Mas com a chamada sobrevivendo aos reinicios, uma esquecida de ontem
      trancava a secretaria fora da importacao sem saida nenhuma: antes bastava
      reiniciar o servidor, e agora reiniciar nao adianta.
    */
    const ws = await ligar('papel=portaria')
    await proximoRetrato(ws)
    ws.send(JSON.stringify({ tipo: 'chamar', alunoId: 'a01' }))
    await ateQue(ws, (r) => (r.chamadas as unknown[]).length === 1)
    ws.close()

    const trancado = await pedir('/importar?papel=portaria', {
      method: 'POST',
      body: 'Nome,Turma\nAna Beatriz Souza,Pré 1',
    })
    expect(trancado.status).toBe(409)

    await envelhecerNoDisco(1_000_000)
    await derrubarInstancia()

    const nova = await ligar('papel=portaria')
    await proximoRetrato(nova)
    const liberado = await pedir('/importar?papel=portaria', {
      method: 'POST',
      body: 'Nome,Turma\nAna Beatriz Souza,Pré 1',
    })
    expect(liberado.status).toBe(200)
    nova.close()
  })

  it('uma chamada de agora NAO expira', async () => {
    // O outro lado do erro: expirar cedo demais tira do quadro uma crianca com
    // o responsavel esperando no portao neste instante.
    const ws = await ligar('papel=portaria')
    await proximoRetrato(ws)
    ws.send(JSON.stringify({ tipo: 'chamar', alunoId: 'a01' }))
    await ateQue(ws, (r) => (r.chamadas as unknown[]).length === 1)
    ws.close()

    await derrubarInstancia()

    const nova = await ligar('papel=portaria')
    const retrato = await proximoRetrato(nova)
    expect((retrato.chamadas as unknown[]).length).toBe(1)
    nova.close()
  })

  it('a recusa da importacao NOMEIA quem esta em saida', async () => {
    const ws = await ligar('papel=portaria')
    await proximoRetrato(ws)
    ws.send(JSON.stringify({ tipo: 'chamar', alunoId: 'a01' }))
    await ateQue(ws, (r) => (r.chamadas as unknown[]).length === 1)

    const r = await pedir('/importar?papel=portaria', {
      method: 'POST',
      body: 'Nome,Turma\nAna Beatriz Souza,Pré 1',
    })
    expect(r.status).toBe(409)
    const corpo = await r.json<{ erros: { motivo: string }[] }>()
    // Sem o nome, a secretaria fica procurando as cegas qual crianca travou.
    expect(corpo.erros[0].motivo).toMatch(/\(.+,\s*chamado\)/)
    ws.close()
  })
})


describe('a coluna nova da trilha, e o banco que nao a tem', () => {
  beforeEach(async () => {
    await reset()
  })

  /*
    Fabrica um banco da VERSAO ANTERIOR — a trilha sem a coluna `razao`.

    Ate aqui nada no projeto conseguia produzir esse banco: todo teste de
    persistencia comeca com `reset()`, entao todos rodavam contra um esquema
    recem-criado. O primeiro ALTER TABLE do projeto ia entrar sem uma linha de
    cobertura do unico cenario que ele existe para tratar.
  */
  async function bancoAntigo() {
    await runInDurableObject(portaria(), (_instancia, estado) => {
      const sql = estado.storage.sql
      sql.exec('DROP TABLE IF EXISTS trilha')
      sql.exec(`
        CREATE TABLE trilha (
          seq     INTEGER PRIMARY KEY AUTOINCREMENT,
          alunoId TEXT NOT NULL,
          nome    TEXT NOT NULL,
          turma   TEXT NOT NULL,
          acao    TEXT NOT NULL,
          papel   TEXT NOT NULL,
          origem  TEXT NOT NULL,
          de      TEXT NOT NULL,
          para    TEXT NOT NULL,
          em      INTEGER NOT NULL
        )
      `)
      sql.exec(
        `INSERT INTO trilha (alunoId, nome, turma, acao, papel, origem, de, para, em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        'a01', 'Crianca De Ontem', 'Pré 1', 'chamar', 'portaria', 'portaria',
        'aguardando', 'chamado', 1_000_000,
      )
    })
  }

  it('a migracao acrescenta a coluna sem perder o que ja estava la', async () => {
    const ws = await ligar('papel=portaria')
    await proximoRetrato(ws)
    ws.close()

    await bancoAntigo()
    await derrubarInstancia()

    const nova = await ligar('papel=portaria')
    await proximoRetrato(nova)
    const trilha = await (
      await pedir('/registro?papel=portaria')
    ).json<{ nome: string; razao: string }[]>()

    expect(trilha.length).toBe(1)
    expect(trilha[0].nome).toBe('Crianca De Ontem')
    // Evento anterior a coluna existir: razao vazia, nunca undefined.
    expect(trilha[0].razao).toBe('')
    nova.close()
  })

  it('e o objeto continua subindo depois, sem laco de boot', async () => {
    /*
      O caminho errado seria disparar o ALTER a partir de um numero de versao
      guardado: banco novo nasceria com a coluna, leria a versao ausente como
      antiga, dispararia o ALTER e o SQLite responderia `duplicate column
      name`. Excecao dentro do blockConcurrencyWhile e laco de boot — nenhuma
      tela sobe e recarregar repete.

      Quem decide se a coluna existe e o PRAGMA, entao rodar de novo da no
      mesmo. Este teste derruba e sobe tres vezes.
    */
    await bancoAntigo()
    for (let volta = 0; volta < 3; volta++) {
      await derrubarInstancia()
      const ws = await ligar('papel=portaria')
      const retrato = await proximoRetrato(ws)
      expect(retrato.tipo).toBe('retrato')
      ws.close()
    }

    const trilha = await (await pedir('/registro?papel=portaria')).json<unknown[]>()
    expect(trilha.length).toBe(1)
  })

  it('a razao do retorno atravessa o disco', async () => {
    /*
      Migracao, INSERT e SELECT precisam andar juntos. Com `DEFAULT ''`,
      esquecer o INSERT ou o SELECT nao da erro: o Livro guarda a trilha em RAM,
      entao a razao aparece enquanto o objeto viver e evapora na primeira
      hibernacao. Registro plausivelmente incompleto e o pior defeito possivel
      numa trilha de entrega de crianca — por isso o teste passa pelo disco.
    */
    const portariaWs = await ligar('papel=portaria')
    const sala = await ligar('papel=sala&turma=' + encodeURIComponent('Pré 1'))
    await retratoInicial(portariaWs)
    await retratoInicial(sala)

    portariaWs.send(JSON.stringify({ tipo: 'chamar', alunoId: 'a01' }))
    await ateQue(portariaWs, (r) => (r.chamadas as { estado: string }[])[0]?.estado === 'chamado')
    sala.send(JSON.stringify({ tipo: 'liberar', alunoId: 'a01' }))
    await ateQue(portariaWs, (r) => (r.chamadas as { estado: string }[])[0]?.estado === 'liberado')
    sala.send(JSON.stringify({
      tipo: 'retornar', alunoId: 'a01', razao: 'esqueceu-material',
    }))
    await ateQue(portariaWs, (r) => (r.chamadas as { estado: string }[])[0]?.estado === 'retorno')

    portariaWs.close()
    sala.close()
    await derrubarInstancia()

    const nova = await ligar('papel=portaria')
    const retrato = await proximoRetrato(nova)
    expect((retrato.chamadas as { estado: string }[])[0]?.estado).toBe('retorno')

    const trilha = await (
      await pedir('/registro?papel=portaria')
    ).json<{ acao: string; razao: string }[]>()
    const retorno = trilha.find((e) => e.acao === 'retornar')
    expect(retorno?.razao).toBe('esqueceu-material')
    // E as outras acoes continuam com o campo vazio, nao ausente.
    expect(trilha.filter((e) => e.acao !== 'retornar').every((e) => e.razao === '')).toBe(true)
    nova.close()
  })

  it('razao invalida e RECUSADA, e a recusa diz o que aconteceu', async () => {
    const portariaWs = await ligar('papel=portaria')
    const sala = await ligar('papel=sala&turma=' + encodeURIComponent('Pré 1'))
    await retratoInicial(portariaWs)
    await retratoInicial(sala)

    portariaWs.send(JSON.stringify({ tipo: 'chamar', alunoId: 'a01' }))
    await ateQue(sala, (r) => (r.chamadas as unknown[]).length === 1)
    sala.send(JSON.stringify({ tipo: 'liberar', alunoId: 'a01' }))
    await ateQue(sala, (r) => (r.chamadas as { estado: string }[])[0]?.estado === 'liberado')

    const recusas: { motivo: string }[] = []
    sala.addEventListener('message', (e: MessageEvent) => {
      const m = JSON.parse(String(e.data))
      if (m.tipo === 'recusa') recusas.push(m)
    })

    sala.send(JSON.stringify({ tipo: 'retornar', alunoId: 'a01', razao: 'inventado' }))
    await new Promise((r) => setTimeout(r, 300))

    expect(recusas.length).toBe(1)
    // A allowlist de `motivoDe` precisa deixar este erro passar; sem isso a
    // recusa vira "comando recusado" e a professora nao sabe o que faltou.
    expect(recusas[0].motivo).toMatch(/raz/i)
    // E a crianca continua liberada: nada aconteceu pela metade.
    const retrato = await (await pedir('/registro?papel=portaria')).json<unknown[]>()
    expect(retrato.length).toBe(2)

    portariaWs.close()
    sala.close()
  })

  it('razao mandada em outra acao nao chega ao disco', async () => {
    const ws = await ligar('papel=portaria')
    await proximoRetrato(ws)
    ws.send(JSON.stringify({
      tipo: 'chamar', alunoId: 'a01', razao: 'esqueceu-material',
    }))
    await ateQue(ws, (r) => (r.chamadas as unknown[]).length === 1)
    ws.close()
    await derrubarInstancia()

    const trilha = await (
      await pedir('/registro?papel=portaria')
    ).json<{ acao: string; razao: string }[]>()
    expect(trilha[0].acao).toBe('chamar')
    expect(trilha[0].razao).toBe('')
  })

  it('razao gigante e recusada pelo teto de forma', async () => {
    // O caminho do WebSocket nao tinha nada equivalente ao limite de 1 MB do
    // /importar, e agora ele escreve em disco retido 90 dias.
    const ws = await ligar('papel=portaria')
    await proximoRetrato(ws)

    const recusas: { motivo: string }[] = []
    ws.addEventListener('message', (e: MessageEvent) => {
      const m = JSON.parse(String(e.data))
      if (m.tipo === 'recusa') recusas.push(m)
    })

    ws.send(JSON.stringify({ tipo: 'chamar', alunoId: 'a01', razao: 'x'.repeat(5000) }))
    await new Promise((r) => setTimeout(r, 300))

    expect(recusas.length).toBe(1)
    expect(recusas[0].motivo).toMatch(/longa demais/)
    // E o valor recebido NAO volta na mensagem: 5 mil caracteres entram, 5 mil
    // nao saem.
    expect(recusas[0].motivo.length).toBeLessThan(200)
    ws.close()
  })
})
