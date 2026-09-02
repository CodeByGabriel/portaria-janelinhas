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

/*
  Os aparelhos de demonstracao.

  Desde a 2.2 o papel nao vem mais da URL: vem de um token por aparelho, num
  cookie. Estes tokens sao os que o Durable Object semeia quando `MODO_DEMO`
  esta ligado — previsiveis de proposito, para o teste nao precisar emitir um
  aparelho antes de cada verificacao.
*/
const TOKEN = {
  portaria: 'demonstracao-portaria-0000',
  sala: (turma: string) =>
    'demonstracao-sala-' +
    turma
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase(),
}

/*
  Todo pedido leva um cookie de aparelho.

  O padrao e a portaria, que e quem faz a maioria das rotas. Passar
  `{ token: null }` manda o pedido SEM cookie — e assim que se testa o portao.
*/
const pedir = (
  caminho: string,
  init: RequestInit & { token?: string | null } = {},
) => {
  const { token, ...resto } = init
  const escolhido = token === undefined ? TOKEN.portaria : token
  const headers: Record<string, string> = {
    ...((resto.headers as Record<string, string>) ?? {}),
  }
  if (escolhido) headers.Cookie = `janelinhas_dispositivo=${escolhido}`
  return portaria().fetch(new Request(`http://do${caminho}`, { ...resto, headers }))
}

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
async function ligar(token: string): Promise<Ligacao> {
  const resposta = await portaria().fetch(
    new Request('http://do/ws', {
      headers: { Upgrade: 'websocket', Cookie: `janelinhas_dispositivo=${token}` },
    }),
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

describe('gate de aparelho — o furo C2, agora com identidade de verdade', () => {
  /*
    O C2 original: `papel === 'sala' ? 'sala' : 'portaria'` fazia "Sala",
    "SALA", " sala", "professora", vazio e ausente virarem TODOS portaria — e a
    portaria enxerga a escola inteira. Uma maiuscula num bookmark expunha nome,
    turma e estado de saida de todas as criancas, sem sinal de erro na tela.

    O conserto de entao foi validar o papel. Mas papel na URL nunca foi
    identidade: era uma etiqueta que o cliente colava em si mesmo, e qualquer
    pessoa com o endereco continuava virando portaria. Estes testes guardam o
    portao que substituiu aquilo — e a forma do C2 continua aqui, porque a
    licao e a mesma: entrada nao reconhecida NAO vira acesso ampliado.
  */
  it('sem cookie de aparelho, nenhuma rota abre', async () => {
    for (const caminho of ['/alunos', '/registro', '/importar', '/alerta?alunoId=a01']) {
      expect((await pedir(caminho, { token: null })).status).toBe(401)
    }
  })

  it.each([
    'Sala',
    'SALA',
    'professora',
    'portaria',
    'demonstracao-portaria-000',
    'demonstracao-portaria-00000',
    'DEMONSTRACAO-PORTARIA-0000',
  ])('token "%s" nao vira aparelho nenhum', async (token) => {
    expect((await pedir('/alunos', { token })).status).toBe(401)
  })

  it('e o token errado nao vira portaria por engano', async () => {
    // O ponto do C2: quando a entrada nao e reconhecida, o resultado e recusa —
    // nunca o papel de maior alcance.
    const r = await pedir('/alunos', { token: 'quase-demonstracao-portaria' })
    expect(r.status).toBe(401)
    expect(await r.text()).not.toContain('nome')
  })

  it('o aparelho certo abre, e so o que lhe cabe', async () => {
    expect((await pedir('/alunos')).status).toBe(200)
    expect((await pedir('/alunos', { token: TOKEN.sala('Pré 1') })).status).toBe(403)
  })
})

describe('rotas HTTP — furo C3', () => {
  it('so a portaria le o cadastro', async () => {
    expect((await pedir('/alunos', { token: TOKEN.sala('Pré 1') })).status).toBe(403)
    const r = await pedir('/alunos')
    expect(r.status).toBe(200)
    expect((await r.json<unknown[]>()).length).toBe(44)
  })

  it('so a portaria le a trilha', async () => {
    expect((await pedir('/registro', { token: TOKEN.sala('Pré 1') })).status).toBe(403)
    expect((await pedir('/registro')).status).toBe(200)
  })

  it('importar exige POST', async () => {
    expect((await pedir('/importar')).status).toBe(405)
  })

  it('importar exige o papel da portaria', async () => {
    const r = await pedir('/importar', {
      token: TOKEN.sala('Pré 1'),
      method: 'POST',
      body: 'Nome,Turma',
    })
    expect(r.status).toBe(403)
  })

  it('caminho desconhecido nao vaza nada', async () => {
    expect((await pedir('/qualquer')).status).toBe(404)
  })
})

describe('WebSocket — a sala so enxerga a propria turma', () => {
  it('entrega um retrato assim que conecta', async () => {
    const ws = await ligar(TOKEN.portaria)
    const retrato = await proximoRetrato(ws)
    expect(retrato.tipo).toBe('retrato')
    expect(Array.isArray(retrato.chamadas)).toBe(true)
    ws.close()
  })

  it('REGRESSAO: sala sem turma declarada nao ve ninguem', async () => {
    const portariaWs = await ligar(TOKEN.portaria)
    await proximoRetrato(portariaWs)
    const cega = await ligar(TOKEN.sala('9º ano'))
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

  it('REGRESSAO: aparelho com turma que deixou de existir NAO vira sessao cega', async () => {
    /*
      A assimetria antiga vinha da URL: papel invalido nao conectava, mas turma
      invalida CONECTAVA e virava sessao cega — a professora entrava, nao via
      crianca nenhuma, e nao havia erro em lugar nenhum. Ela concluia que
      ninguem tinha chegado, com um responsavel esperando no portao.

      Com a turma vindo do aparelho, a URL nao consegue mais produzir esse
      estado. Mas ele ainda pode nascer de outro lado, e este e o caso que
      importa agora: a escola RENOMEIA uma turma, e os tablets emitidos para o
      nome antigo continuam no banco.

      Aqui o aparelho e inserido direto no SQLite, porque emitir pela rota
      valida a turma — e o cenario que este teste cobre e justamente o banco
      guardando algo que a rota nao aceitaria mais.
    */
    const { impressaoDe } = await import('./sessao.ts')
    const impressao = await impressaoDe('aparelho-de-turma-extinta')

    await runInDurableObject(portaria(), (_i, estado) => {
      estado.storage.sql.exec(
        `INSERT INTO dispositivos (impressao, papel, turma, apelido, criadoEm, revogadoEm)
         VALUES (?, 'sala', 'Sexto Ano', 'tablet de turma renomeada', ?, NULL)`,
        impressao,
        1_000_000,
      )
    })

    // Nao conecta, e nao entra. Erro visivel, nunca sessao vazia em silencio.
    const ws = await portaria().fetch(
      new Request('http://do/ws', {
        headers: {
          Upgrade: 'websocket',
          Cookie: 'janelinhas_dispositivo=aparelho-de-turma-extinta',
        },
      }),
    )
    expect(ws.status).toBe(401)
    expect(
      (await pedir('/entrar', {
        token: null,
        method: 'POST',
        body: JSON.stringify({ token: 'aparelho-de-turma-extinta' }),
      })).status,
    ).toBe(401)
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
    return pedir('/importar', { method: 'POST', body: csv })
  }

  it('a trilha continua integra depois da eviccao', async () => {
    const ws = await ligar(TOKEN.portaria)
    await proximoRetrato(ws)
    ws.send(JSON.stringify({ tipo: 'chamar', alunoId: 'a01' }))
    await proximoRetrato(ws)
    ws.send(JSON.stringify({ tipo: 'chamar', alunoId: 'a02' }))
    await proximoRetrato(ws)
    ws.close()

    const antes = await (await pedir('/registro')).json<unknown[]>()
    expect(antes.length).toBe(2)

    await derrubarInstancia()

    const depois = await (await pedir('/registro')).json<unknown[]>()
    expect(depois.length).toBe(2)
    expect(depois).toEqual(antes)
  })

  it('REGRESSAO: a eviccao NAO devolve a semente no lugar da escola', async () => {
    const r = await importar(PLANILHA)
    expect(r.status).toBe(200)

    const importados = await (await pedir('/alunos')).json<{ nome: string }[]>()
    expect(importados.length).toBe(3)

    await derrubarInstancia()

    const depois = await (await pedir('/alunos')).json<{ nome: string }[]>()
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
    const portariaWs = await ligar(TOKEN.portaria)
    await proximoRetrato(portariaWs)
    const sala = await ligar(TOKEN.sala('Pré 1'))
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

    const nova = await ligar(TOKEN.portaria)
    const retrato = await proximoRetrato(nova)
    const chamadas = retrato.chamadas as { alunoId: string; estado: string }[]
    expect(chamadas.length).toBe(1)
    expect(chamadas[0].alunoId).toBe('a01')
    expect(chamadas[0].estado).toBe('liberado')
    nova.close()
  })

  it('a versao do cadastro sobrevive, para o tablet saber que a lista venceu', async () => {
    const ws = await ligar(TOKEN.portaria)
    const inicial = await proximoRetrato(ws)
    ws.close()
    await importar(PLANILHA)

    await derrubarInstancia()

    const nova = await ligar(TOKEN.portaria)
    const depois = await proximoRetrato(nova)
    expect(depois.cadastro).toBeGreaterThan(inicial.cadastro as number)
    nova.close()
  })

  it('entregue sai do disco, nao so da memoria', async () => {
    const portariaWs = await ligar(TOKEN.portaria)
    await proximoRetrato(portariaWs)
    const sala = await ligar(TOKEN.sala('Pré 1'))
    await proximoRetrato(sala)

    portariaWs.send(JSON.stringify({ tipo: 'chamar', alunoId: 'a01' }))
    await proximoRetrato(portariaWs)
    sala.send(JSON.stringify({ tipo: 'liberar', alunoId: 'a01' }))
    await proximoRetrato(sala)
    /*
      Desde a 2.1, entregar exige DIZER A QUEM quando a crianca tem
      responsaveis cadastrados — e a semente cadastra os da Alice. Sem o
      responsavel, o comando e recusado e a crianca fica no quadro, que e
      exatamente o que este teste passou a pegar quando a 2.1 entrou.
    */
    const podem = await (
      await pedir('/responsaveis?alunoId=a01')
    ).json<{ id: string; impedido: boolean }[]>()
    const autorizado = podem.find((r) => !r.impedido)!

    portariaWs.send(
      JSON.stringify({ tipo: 'entregar', alunoId: 'a01', responsavelId: autorizado.id }),
    )
    await proximoRetrato(portariaWs)
    portariaWs.close()
    sala.close()

    await derrubarInstancia()

    const nova = await ligar(TOKEN.portaria)
    const retrato = await proximoRetrato(nova)
    expect((retrato.chamadas as unknown[]).length).toBe(0)
    // mas a trilha guarda as tres transicoes
    const trilha = await (await pedir('/registro')).json<unknown[]>()
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
    const r = await pedir('/importar', { method: 'POST', body: gigante })
    expect(r.status).toBe(413)
    const corpo = await r.json<{ erros: { motivo: string }[] }>()
    expect(corpo.erros[0].motivo).toMatch(/grande demais/)
  })

  it('a resposta nao carrega um erro por linha invalida', async () => {
    const muitosErros = 'Nome,Turma\n' + 'Ana Souza,Turma Fantasma\n'.repeat(500)
    const r = await pedir('/importar', { method: 'POST', body: muitosErros })
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
    const ws = await ligar(TOKEN.portaria)
    await proximoRetrato(ws)
    ws.send(JSON.stringify({ tipo: 'chamar', alunoId: 'a01' }))
    await ateQue(ws, (r) => (r.chamadas as unknown[]).length === 1)
    ws.close()

    await envelhecerNoDisco(1_000_000) // 1970, bem antes de qualquer corte
    await derrubarInstancia()

    const nova = await ligar(TOKEN.portaria)
    const retrato = await proximoRetrato(nova)
    expect((retrato.chamadas as unknown[]).length).toBe(0)
    nova.close()
  })

  it('e a expiracao entra na trilha como acao do sistema, nao da portaria', async () => {
    const ws = await ligar(TOKEN.portaria)
    await proximoRetrato(ws)
    ws.send(JSON.stringify({ tipo: 'chamar', alunoId: 'a01' }))
    await ateQue(ws, (r) => (r.chamadas as unknown[]).length === 1)
    ws.close()

    await envelhecerNoDisco(1_000_000)
    await derrubarInstancia()

    const nova = await ligar(TOKEN.portaria)
    await proximoRetrato(nova)
    const trilha = await (
      await pedir('/registro')
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
    const ws = await ligar(TOKEN.portaria)
    await proximoRetrato(ws)
    ws.send(JSON.stringify({ tipo: 'chamar', alunoId: 'a01' }))
    await ateQue(ws, (r) => (r.chamadas as unknown[]).length === 1)
    ws.close()

    const trancado = await pedir('/importar', {
      method: 'POST',
      body: 'Nome,Turma\nAna Beatriz Souza,Pré 1',
    })
    expect(trancado.status).toBe(409)

    await envelhecerNoDisco(1_000_000)
    await derrubarInstancia()

    const nova = await ligar(TOKEN.portaria)
    await proximoRetrato(nova)
    const liberado = await pedir('/importar', {
      method: 'POST',
      body: 'Nome,Turma\nAna Beatriz Souza,Pré 1',
    })
    expect(liberado.status).toBe(200)
    nova.close()
  })

  it('uma chamada de agora NAO expira', async () => {
    // O outro lado do erro: expirar cedo demais tira do quadro uma crianca com
    // o responsavel esperando no portao neste instante.
    const ws = await ligar(TOKEN.portaria)
    await proximoRetrato(ws)
    ws.send(JSON.stringify({ tipo: 'chamar', alunoId: 'a01' }))
    await ateQue(ws, (r) => (r.chamadas as unknown[]).length === 1)
    ws.close()

    await derrubarInstancia()

    const nova = await ligar(TOKEN.portaria)
    const retrato = await proximoRetrato(nova)
    expect((retrato.chamadas as unknown[]).length).toBe(1)
    nova.close()
  })

  it('a recusa da importacao NOMEIA quem esta em saida', async () => {
    const ws = await ligar(TOKEN.portaria)
    await proximoRetrato(ws)
    ws.send(JSON.stringify({ tipo: 'chamar', alunoId: 'a01' }))
    await ateQue(ws, (r) => (r.chamadas as unknown[]).length === 1)

    const r = await pedir('/importar', {
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
    const ws = await ligar(TOKEN.portaria)
    await proximoRetrato(ws)
    ws.close()

    await bancoAntigo()
    await derrubarInstancia()

    const nova = await ligar(TOKEN.portaria)
    await proximoRetrato(nova)
    const trilha = await (
      await pedir('/registro')
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
      const ws = await ligar(TOKEN.portaria)
      const retrato = await proximoRetrato(ws)
      expect(retrato.tipo).toBe('retrato')
      ws.close()
    }

    const trilha = await (await pedir('/registro')).json<unknown[]>()
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
    const portariaWs = await ligar(TOKEN.portaria)
    const sala = await ligar(TOKEN.sala('Pré 1'))
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

    const nova = await ligar(TOKEN.portaria)
    const retrato = await proximoRetrato(nova)
    expect((retrato.chamadas as { estado: string }[])[0]?.estado).toBe('retorno')

    const trilha = await (
      await pedir('/registro')
    ).json<{ acao: string; razao: string }[]>()
    const retorno = trilha.find((e) => e.acao === 'retornar')
    expect(retorno?.razao).toBe('esqueceu-material')
    // E as outras acoes continuam com o campo vazio, nao ausente.
    expect(trilha.filter((e) => e.acao !== 'retornar').every((e) => e.razao === '')).toBe(true)
    nova.close()
  })

  it('razao invalida e RECUSADA, e a recusa diz o que aconteceu', async () => {
    const portariaWs = await ligar(TOKEN.portaria)
    const sala = await ligar(TOKEN.sala('Pré 1'))
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
    const retrato = await (await pedir('/registro')).json<unknown[]>()
    expect(retrato.length).toBe(2)

    portariaWs.close()
    sala.close()
  })

  it('razao mandada em outra acao nao chega ao disco', async () => {
    const ws = await ligar(TOKEN.portaria)
    await proximoRetrato(ws)
    ws.send(JSON.stringify({
      tipo: 'chamar', alunoId: 'a01', razao: 'esqueceu-material',
    }))
    await ateQue(ws, (r) => (r.chamadas as unknown[]).length === 1)
    ws.close()
    await derrubarInstancia()

    const trilha = await (
      await pedir('/registro')
    ).json<{ acao: string; razao: string }[]>()
    expect(trilha[0].acao).toBe('chamar')
    expect(trilha[0].razao).toBe('')
  })

  it('razao gigante e recusada pelo teto de forma', async () => {
    // O caminho do WebSocket nao tinha nada equivalente ao limite de 1 MB do
    // /importar, e agora ele escreve em disco retido 90 dias.
    const ws = await ligar(TOKEN.portaria)
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


describe('restricao: o texto nunca sai em lote', () => {
  const COM_RESTRICAO = [
    'Nome,Turma,Restrição',
    'Ana Beatriz Souza,Pré 1,Guarda compartilhada — não entregar ao pai sem autorização',
    'Bruno Assuncao,Pré 1,',
    'Carlos Lima,9º ano,Só a avó materna busca',
  ].join('\n')

  beforeEach(async () => {
    await reset()
    await pedir('/importar', { method: 'POST', body: COM_RESTRICAO })
  })

  async function idDe(nome: string) {
    const alunos = await (
      await pedir('/alunos')
    ).json<{ id: string; nome: string; turma: string; temAlerta?: boolean }[]>()
    const a = alunos.find((x) => x.nome === nome)
    if (!a) throw new Error(`nao achei ${nome}`)
    return a
  }

  it('REGRESSAO: /alunos entrega o booleano, NUNCA o texto', async () => {
    /*
      `/alunos` despeja o cadastro inteiro no navegador — ja e minimizacao ao
      contrario, registrado em docs/lgpd.md. Com o texto dentro, cada tablet da
      portaria carregaria em repouso a situacao familiar da escola toda: uma
      tela aberta e esquecida no balcao passaria a expor guarda e conflito de
      292 familias em vez de nome e turma.

      O texto nao mora no tipo `Aluno`, entao nao ha o que esquecer de remover.
      Este teste guarda a serializacao inteira contra o texto.
    */
    const corpo = await (await pedir('/alunos')).text()
    expect(corpo).not.toContain('Guarda compartilhada')
    expect(corpo).not.toContain('avó materna')
    expect(corpo).toContain('temAlerta')

    const comAlerta = await idDe('Ana Beatriz Souza')
    const semAlerta = await idDe('Bruno Assuncao')
    expect(comAlerta.temAlerta).toBe(true)
    expect(semAlerta.temAlerta).toBe(false)
  })

  it('a portaria le o texto de UMA crianca por vez', async () => {
    const a = await idDe('Ana Beatriz Souza')
    const r = await pedir(`/alerta?alunoId=${a.id}`)
    expect(r.status).toBe(200)
    const corpo = await r.json<{ texto: string }>()
    expect(corpo.texto).toMatch(/Guarda compartilhada/)
  })

  it('crianca sem restricao devolve texto vazio, nao erro', async () => {
    // Vazio e uma resposta; erro faria a tela tratar "sem restricao" como
    // "nao consegui saber", e as duas coisas exigem condutas opostas.
    const b = await idDe('Bruno Assuncao')
    const r = await pedir(`/alerta?alunoId=${b.id}`)
    expect(r.status).toBe(200)
    expect((await r.json<{ texto: string }>()).texto).toBe('')
  })

  it('C3: sem aparelho, /alerta nem responde', async () => {
    const a = await idDe('Ana Beatriz Souza')
    expect((await pedir(`/alerta?alunoId=${a.id}`, { token: null })).status).toBe(401)
    expect((await pedir(`/alerta?alunoId=${a.id}`, { token: 'invalido' })).status).toBe(401)
  })

  it('a sala so le a restricao da PROPRIA turma', async () => {
    /*
      O mesmo ataque que o filtro de turma ja fecha na leitura e na escrita: os
      ids sao adivinhaveis, entao sem esta barreira a sala do Pré 1 varreria os
      ids e leria a anotacao de guarda de todas as criancas da escola — que e o
      dado mais sensivel que este sistema toca.
    */
    const daPre = await idDe('Ana Beatriz Souza')
    const doNono = await idDe('Carlos Lima')
    const pre = encodeURIComponent('Pré 1')

    const propria = await pedir(`/alerta?alunoId=${daPre.id}`, { token: TOKEN.sala('Pré 1') })
    expect(propria.status).toBe(200)
    expect((await propria.json<{ texto: string }>()).texto).toMatch(/Guarda/)

    const alheia = await pedir(`/alerta?alunoId=${doNono.id}`, { token: TOKEN.sala('Pré 1') })
    expect(alheia.status).toBe(403)

    // E sala sem turma declarada nao le nada, como nao ve nada.
    // A turma vem do APARELHO: nao ha mais 'sala sem turma' para testar aqui.
    expect((await pedir(`/alerta?alunoId=${doNono.id}`, { token: TOKEN.sala('9º ano') })).status).toBe(200)
  })

  it('alunoId invalido ou ausente e recusado antes de tocar no disco', async () => {
    expect((await pedir('/alerta')).status).toBe(400)
    expect((await pedir('/alerta?alunoId=')).status).toBe(400)
    expect(
      (await pedir(`/alerta?alunoId=${'x'.repeat(200)}`)).status,
    ).toBe(400)
    expect((await pedir('/alerta?alunoId=naoexiste')).status).toBe(404)
  })

  it('a restricao sobrevive ao reinicio', async () => {
    const a = await idDe('Ana Beatriz Souza')
    await derrubarInstancia()
    const r = await pedir(`/alerta?alunoId=${a.id}`)
    expect((await r.json<{ texto: string }>()).texto).toMatch(/Guarda compartilhada/)
  })

  it('reimportar SEM a coluna limpa as restricoes', async () => {
    /*
      E o caminho de correcao e de eliminacao que a trilha nao tem: a restricao
      vive no cadastro, que a escola substitui quando quiser. Uma anotacao
      errada — ou uma que deixou de valer porque a decisao judicial mudou — sai
      com a proxima planilha, sem precisar de nada especial.
    */
    const semColuna = ['Nome,Turma', 'Ana Beatriz Souza,Pré 1'].join('\n')
    const r = await pedir('/importar', { method: 'POST', body: semColuna })
    expect(r.status).toBe(200)

    const a = await idDe('Ana Beatriz Souza')
    expect(a.temAlerta).toBe(false)
    expect(
      (await (await pedir(`/alerta?alunoId=${a.id}`)).json<{ texto: string }>())
        .texto,
    ).toBe('')
  })

  it('marcacao na planilha nao vira codigo na tela da portaria', async () => {
    const comMarcacao = [
      'Nome,Turma,Observação',
      'Ana Beatriz Souza,Pré 1,<script>alert(1)</script> não entregar',
    ].join('\n')
    await pedir('/importar', { method: 'POST', body: comMarcacao })

    const a = await idDe('Ana Beatriz Souza')
    const texto = (
      await (await pedir(`/alerta?alunoId=${a.id}`)).json<{ texto: string }>()
    ).texto
    expect(texto).not.toContain('<')
    expect(texto).not.toContain('>')
    expect(texto).toContain('não entregar')
  })
})


describe('autenticacao por aparelho — o papel deixa de vir da URL', () => {
  const CHAVE = 'chave-de-desenvolvimento-nao-use-em-producao'
  const PORTARIA = 'demonstracao-portaria-0000'
  const PRE1 = 'demonstracao-sala-pre-1'

  beforeEach(async () => {
    await reset()
  })

  const cru = (caminho: string, init?: RequestInit) =>
    portaria().fetch(new Request(`http://do${caminho}`, init))

  const comCookie = (token: string, caminho: string, init: RequestInit = {}) =>
    portaria().fetch(
      new Request(`http://do${caminho}`, {
        ...init,
        headers: { ...(init.headers ?? {}), Cookie: `janelinhas_dispositivo=${token}` },
      }),
    )

  it('REGRESSAO: `` deixou de significar qualquer coisa', async () => {
    /*
      Era a etiqueta que o cliente colava em si mesmo. Qualquer pessoa com o
      endereco virava portaria e baixava o cadastro inteiro — nome e turma de
      292 criancas por uma URL. Este teste existe para o dia em que alguem
      "restaurar" o parametro por engano.
    */
    for (const caminho of ['/alunos', '/registro']) {
      expect((await cru(caminho)).status).toBe(401)
    }
    const ws = await portaria().fetch(
      new Request('http://do/ws', { headers: { Upgrade: 'websocket' } }),
    )
    expect(ws.status).toBe(401)
  })

  it('sem cookie, nada abre', async () => {
    expect((await cru('/alunos')).status).toBe(401)
    expect((await cru('/registro')).status).toBe(401)
    expect((await cru('/alerta?alunoId=a01')).status).toBe(401)
  })

  it('o token vira cookie, e o cookie abre as portas da portaria', async () => {
    const r = await cru('/entrar', {
      method: 'POST',
      body: JSON.stringify({ token: PORTARIA }),
    })
    expect(r.status).toBe(200)

    const cookie = r.headers.get('Set-Cookie') ?? ''
    expect(cookie).toContain('janelinhas_dispositivo=')
    // HttpOnly: um XSS na tela nao consegue exfiltrar o token do aparelho.
    expect(cookie).toContain('HttpOnly')
    // SameSite=Strict: um link mandado num grupo nao age na sessao de ninguem.
    expect(cookie).toContain('SameSite=Strict')

    const quem = await r.json<{ papel: string; turma: string | null }>()
    expect(quem.papel).toBe('portaria')
    expect(quem.turma).toBe(null)

    expect((await comCookie(PORTARIA, '/alunos')).status).toBe(200)
  })

  it('token errado e token revogado devolvem a MESMA resposta', async () => {
    /*
      A diferenca seria um oraculo: quem varre tokens saberia quando acertou um
      que ja existiu, e passaria a procurar por aparelhos revogados em vez de
      chutar no escuro.
    */
    const inexistente = await cru('/entrar', {
      method: 'POST',
      body: JSON.stringify({ token: 'nao-existe-este-token-aqui' }),
    })

    const lista = await (
      await comCookie(PORTARIA, '/dispositivos')
    ).json<{ referencia: string; papel: string }[]>()
    const alvo = lista.find((d) => d.papel === 'portaria')!
    await comCookie(PORTARIA, `/dispositivos?referencia=${alvo.referencia}`, {
      method: 'DELETE',
    })

    const revogado = await cru('/entrar', {
      method: 'POST',
      body: JSON.stringify({ token: PORTARIA }),
    })

    expect(revogado.status).toBe(inexistente.status)
    expect(await revogado.text()).toBe(await inexistente.text())
  })

  it('revogar tem efeito IMEDIATO, sem esperar sessao expirar', async () => {
    // Aparelho perdido as 15h nao pode continuar chamando crianca as 15h05.
    expect((await comCookie(PORTARIA, '/alunos')).status).toBe(200)

    const lista = await (
      await comCookie(PORTARIA, '/dispositivos')
    ).json<{ referencia: string; papel: string }[]>()
    const alvo = lista.find((d) => d.papel === 'portaria')!
    const r = await comCookie(PORTARIA, `/dispositivos?referencia=${alvo.referencia}`, {
      method: 'DELETE',
    })
    expect((await r.json<{ revogado: boolean }>()).revogado).toBe(true)

    expect((await comCookie(PORTARIA, '/alunos')).status).toBe(401)
  })

  it('a sala so alcanca a propria turma, e a turma vem do APARELHO', async () => {
    const r = await cru('/entrar', { method: 'POST', body: JSON.stringify({ token: PRE1 }) })
    expect(r.status).toBe(200)
    const quem = await r.json<{ papel: string; turma: string }>()
    expect(quem.papel).toBe('sala')
    expect(quem.turma).toBe('Pré 1')

    // A sala nao le a lista inteira, nem com cookie valido.
    expect((await comCookie(PRE1, '/alunos')).status).toBe(403)
    // Nem administra aparelhos.
    expect((await comCookie(PRE1, '/dispositivos')).status).toBe(401)
  })

  it('REGRESSAO: a turma nao vem mais da URL, entao nao ha sessao cega', async () => {
    /*
      A assimetria antiga: papel invalido nao conectava, mas turma invalida
      CONECTAVA e virava sessao cega. A professora entrava, nao via crianca
      nenhuma, e nao havia erro em lugar nenhum — ela concluia que ninguem
      tinha chegado, com um responsavel esperando no portao.

      Agora a turma vem do aparelho. Mandar outra na URL nao muda nada.
    */
    const ws = await portaria().fetch(
      new Request('http://do/ws?turma=9%C2%BA%20ano', {
        headers: { Upgrade: 'websocket', Cookie: `janelinhas_dispositivo=${PRE1}` },
      }),
    )
    expect(ws.status).toBe(101)
    const cliente = ws.webSocket!
    cliente.accept()

    const retrato = await new Promise<Record<string, unknown>>((resolve) => {
      cliente.addEventListener('message', (e: MessageEvent) => {
        const m = JSON.parse(String(e.data))
        if (m.tipo === 'retrato') resolve(m)
      })
    })
    // Se a URL mandasse, esta sessao veria o 9º ano. Ela ve o Pré 1 — e mesmo
    // vazio, e o vazio da turma CERTA.
    expect(retrato.tipo).toBe('retrato')
    cliente.close()
  })

  it('emitir aparelho exige a chave de administracao', async () => {
    const semChave = await cru('/dispositivos', {
      method: 'POST',
      body: JSON.stringify({ papel: 'portaria', apelido: 'tablet novo' }),
    })
    expect(semChave.status).toBe(401)

    // Nem a portaria autenticada emite: um tablet roubado nao fabrica mais
    // aparelhos, e a escalada para.
    const comoPortaria = await comCookie(PORTARIA, '/dispositivos', {
      method: 'POST',
      body: JSON.stringify({ papel: 'portaria', apelido: 'tablet novo' }),
    })
    expect(comoPortaria.status).toBe(401)

    const comChave = await cru('/dispositivos', {
      method: 'POST',
      headers: { 'X-Chave-Admin': CHAVE },
      body: JSON.stringify({ papel: 'sala', turma: '9º ano', apelido: 'tablet do 9º' }),
    })
    expect(comChave.status).toBe(200)
    const emitido = await comChave.json<{ token: string; turma: string }>()
    expect(emitido.token.length).toBeGreaterThan(30)
    expect(emitido.turma).toBe('9º ano')

    // E o token emitido funciona de verdade.
    const entrou = await cru('/entrar', {
      method: 'POST',
      body: JSON.stringify({ token: emitido.token }),
    })
    expect(entrou.status).toBe(200)
  })

  it('aparelho com papel ou turma invalidos NAO e gravado', async () => {
    // Linha que nunca vira sessao so serve para alguem descobrir depois que o
    // tablet nunca funcionou — no dia da saida.
    for (const corpo of [
      { papel: 'diretora', apelido: 'x' },
      { papel: 'sala', apelido: 'sem turma' },
      { papel: 'sala', turma: 'Turma Fantasma', apelido: 'x' },
    ]) {
      const r = await cru('/dispositivos', {
        method: 'POST',
        headers: { 'X-Chave-Admin': CHAVE },
        body: JSON.stringify(corpo),
      })
      expect(r.status).toBe(422)
    }
  })

  it('o token nunca volta depois de emitido, nem para a portaria', async () => {
    const lista = await (await comCookie(PORTARIA, '/dispositivos')).text()
    expect(lista).not.toContain(PORTARIA)
    expect(lista).not.toContain('demonstracao-sala')
    // A referencia curta identifica a linha sem ajudar a forjar nada.
    expect(lista).toMatch(/"referencia":"[0-9a-f]{8}"/)
  })

  it('sair apaga o cookie', async () => {
    const r = await comCookie(PORTARIA, '/sair')
    expect(r.headers.get('Set-Cookie')).toContain('Max-Age=0')
  })

  it('o modo demonstracao se anuncia', async () => {
    // Sistema com token previsivel que nao diz isso na tela e armadilha.
    const r = await cru('/modo')
    expect((await r.json<{ demonstracao: boolean }>()).demonstracao).toBe(true)
  })
})


describe('responsaveis — a trilha passa a dizer A QUEM', () => {
  beforeEach(async () => {
    await reset()
  })

  const idDe = async (nome: string) => {
    const alunos = await (
      await pedir('/alunos')
    ).json<{ id: string; nome: string; turma: string }[]>()
    const a = alunos.find((x) => x.nome === nome)
    if (!a) throw new Error(`nao achei ${nome}`)
    return a
  }

  const responsaveisDe = async (alunoId: string) =>
    (await pedir(`/responsaveis?alunoId=${alunoId}`)).json<
      { id: string; nome: string; impedido: boolean }[]
    >()

  async function ateEntregar(alunoId: string, responsavelId?: string) {
    const portariaWs = await ligar(TOKEN.portaria)
    const alunos = await (await pedir('/alunos')).json<{ id: string; turma: string }[]>()
    const turma = alunos.find((a) => a.id === alunoId)!.turma
    const sala = await ligar(TOKEN.sala(turma))
    await retratoInicial(portariaWs)
    await retratoInicial(sala)

    const recusas: { motivo: string }[] = []
    portariaWs.addEventListener('message', (e: MessageEvent) => {
      const m = JSON.parse(String(e.data))
      if (m.tipo === 'recusa') recusas.push(m)
    })

    portariaWs.send(JSON.stringify({ tipo: 'chamar', alunoId }))
    await ateQue(sala, (r) => r.chamadas.some((c) => c.alunoId === alunoId))
    sala.send(JSON.stringify({ tipo: 'liberar', alunoId }))
    await ateQue(portariaWs, (r) =>
      r.chamadas.some((c) => c.alunoId === alunoId && c.estado === 'liberado'),
    )

    portariaWs.send(JSON.stringify({ tipo: 'entregar', alunoId, responsavelId }))
    await new Promise((r) => setTimeout(r, 400))

    const retrato = portariaWs.__retratos.at(-1)
    portariaWs.close()
    sala.close()
    return { recusas, aindaNoQuadro: retrato!.chamadas.some((c) => c.alunoId === alunoId) }
  }

  it('a semente traz familias, senao nada disto poderia ser exercitado', async () => {
    /*
      Ate a 2.1 a semente tinha 44 criancas e nenhum adulto. Foi o mesmo buraco
      dos homonimos e da restricao — e a licao ja custou tres vezes: semente sem
      o caso dificil empurra o caso dificil para dentro do teste, onde ele vira
      efeito colateral.
    */
    const alice = await idDe('Alice Fernandes')
    const podem = await responsaveisDe(alice.id)
    expect(podem.length).toBe(2)
    expect(podem.map((r) => r.nome)).toContain('Marta Fernandes')
  })

  it('entregar SEM dizer a quem e recusado', async () => {
    // A metade da promessa que faltava: um registro de saida que nao responde
    // "a quem" nao serve no dia em que a familia pergunta.
    const alice = await idDe('Alice Fernandes')
    const r = await ateEntregar(alice.id)
    expect(r.recusas.length).toBe(1)
    expect(r.recusas[0].motivo).toMatch(/escolha um respons/)
    expect(r.aindaNoQuadro).toBe(true)
  })

  it('entregar ao responsavel certo grava id E nome na trilha', async () => {
    const alice = await idDe('Alice Fernandes')
    const marta = (await responsaveisDe(alice.id)).find((r) => r.nome === 'Marta Fernandes')!

    const r = await ateEntregar(alice.id, marta.id)
    expect(r.recusas.length).toBe(0)
    expect(r.aindaNoQuadro).toBe(false)

    const trilha = await (
      await pedir('/registro')
    ).json<{ acao: string; responsavelId: string; responsavelNome: string }[]>()
    const entrega = trilha.find((e) => e.acao === 'entregar')!
    expect(entrega.responsavelId).toBe(marta.id)
    /*
      O NOME tambem, e nao so o id: a trilha e registro historico e precisa
      continuar legivel depois que a planilha de responsaveis for substituida —
      do mesmo jeito que ela ja guarda o nome do aluno.
    */
    expect(entrega.responsavelNome).toBe('Marta Fernandes')

    // E as outras acoes continuam com o campo vazio, nunca ausente.
    expect(trilha.filter((e) => e.acao !== 'entregar').every((e) => e.responsavelId === '')).toBe(
      true,
    )
  })

  it('IMPEDIDO nao entrega, e reconhecer nao libera', async () => {
    /*
      Aqui a restricao deixa de ser alerta e vira barreira. Na 1.9 o sistema so
      podia garantir que alguem LEU a anotacao, porque nao sabia quem estava no
      portao. Agora sabe, e "nao entregar ao pai" e uma regra que ele cumpre
      sozinho — sem "li e vou continuar".
    */
    const alice = await idDe('Alice Fernandes')
    const ricardo = (await responsaveisDe(alice.id)).find(
      (r) => r.nome === 'Ricardo Fernandes',
    )!
    expect(ricardo.impedido).toBe(true)

    const r = await ateEntregar(alice.id, ricardo.id)
    expect(r.recusas.length).toBe(1)
    expect(r.recusas[0].motivo).toMatch(/impedido de levar/)
    expect(r.aindaNoQuadro).toBe(true)
  })

  it('o impedimento vive no PAR: o mesmo adulto leva o outro filho', async () => {
    const outra = await idDe('Maria Eduarda Nogueira')
    const ricardo = (await responsaveisDe(outra.id)).find(
      (r) => r.nome === 'Ricardo Fernandes',
    )!
    expect(ricardo.impedido).toBe(false)

    const r = await ateEntregar(outra.id, ricardo.id)
    expect(r.recusas.length).toBe(0)
    expect(r.aindaNoQuadro).toBe(false)
  })

  it('o impedido APARECE na lista, marcado', async () => {
    /*
      Some-lo faria a portaria ver uma lista curta e silenciosa, e concluir que
      aquele adulto nao foi cadastrado — quando o que existe e uma decisao de
      que ele nao pode levar. A diferenca entre "nao consta" e "nao pode" e a
      unica coisa que importa quando ele esta parado na frente dela.
    */
    const alice = await idDe('Alice Fernandes')
    const podem = await responsaveisDe(alice.id)
    expect(podem.some((r) => r.impedido)).toBe(true)
  })

  it('irmaos vem de MESMO RESPONSAVEL, nao de sobrenome', async () => {
    /*
      Irmao por sobrenome erra com familia recomposta; irmao por responsavel
      acerta por construcao. E era a 1.4, que o plano adiou ate existir este
      modelo.
    */
    const alice = await idDe('Alice Fernandes')
    const marta = (await responsaveisDe(alice.id)).find((r) => r.nome === 'Marta Fernandes')!

    const irmaos = await (
      await pedir(`/irmaos?responsavelId=${marta.id}&exceto=${alice.id}`)
    ).json<{ nome: string }[]>()

    expect(irmaos.length).toBeGreaterThan(0)
    expect(irmaos.every((i) => i.nome === 'Maria Eduarda Nogueira')).toBe(true)
  })

  it('o impedido NAO aparece na lista de irmaos', async () => {
    // Nao faz sentido oferecer chamar o irmao a quem nao pode levar nenhum.
    const alice = await idDe('Alice Fernandes')
    const ricardo = (await responsaveisDe(alice.id)).find(
      (r) => r.nome === 'Ricardo Fernandes',
    )!
    const irmaos = await (
      await pedir(`/irmaos?responsavelId=${ricardo.id}&exceto=x`)
    ).json<{ id: string }[]>()
    expect(irmaos.some((i) => i.id === alice.id)).toBe(false)
  })

  it('a sala le os responsaveis da propria turma, e so dela', async () => {
    const alice = await idDe('Alice Fernandes')
    const ravi = await idDe('Ravi Bacelar')

    const propria = await pedir(`/responsaveis?alunoId=${alice.id}`, {
      token: TOKEN.sala(alice.turma),
    })
    expect(propria.status).toBe(200)

    const alheia = await pedir(`/responsaveis?alunoId=${ravi.id}`, {
      token: TOKEN.sala(alice.turma),
    })
    expect(alheia.status).toBe(403)
  })

  it('so a portaria pergunta por irmaos', async () => {
    const alice = await idDe('Alice Fernandes')
    const r = await pedir(`/irmaos?responsavelId=x&exceto=${alice.id}`, {
      token: TOKEN.sala(alice.turma),
    })
    expect(r.status).toBe(403)
  })

  it('importar planilha VAZIA nao apaga as autorizacoes da escola', async () => {
    /*
      Trocar por vazio apagaria TODAS as autorizacoes de uma vez, no meio do
      turno, sem ninguem notar ate a primeira entrega travar. Planilha que nao
      produz vinculo nenhum e planilha errada.
    */
    const r = await pedir('/importar-responsaveis', {
      method: 'POST',
      body: ['Aluno,Turma,Responsavel', 'Fulano de Tal,Pré 1,Alguem'].join(String.fromCharCode(10)),
    })
    expect(r.status).toBe(422)
    expect((await r.json<{ trocado: boolean }>()).trocado).toBe(false)

    const alice = await idDe('Alice Fernandes')
    expect((await responsaveisDe(alice.id)).length).toBe(2)
  })

  it('a importacao substitui, e sobrevive ao reinicio', async () => {
    const r = await pedir('/importar-responsaveis', {
      method: 'POST',
      body: [
        'Aluno,Turma,Responsavel,Vinculo,Telefone',
        'Alice Fernandes,Pré 1,Solange Prado,tia,(11) 90000-9999',
      ].join('\n'),
    })
    expect(r.status).toBe(200)

    const alice = await idDe('Alice Fernandes')
    expect((await responsaveisDe(alice.id)).map((x) => x.nome)).toEqual(['Solange Prado'])

    await derrubarInstancia()
    const depois = await responsaveisDe(alice.id)
    expect(depois.map((x) => x.nome)).toEqual(['Solange Prado'])
  })

  it('REGRESSAO: trocar a lista de alunos nao deixa autorizacao orfa em silencio', async () => {
    /*
      O defeito mais silencioso da 2.1, e o unico que piora sozinho.

      Toda importacao de alunos RECALCULA os ids a partir de nome+turma. Uma
      crianca que mudou de turma ganha id novo; uma que saiu, some. Os vinculos
      dela ficam apontando para ninguem — e `responsaveisDe` passa a devolver
      lista vazia, o que faz `entregar` voltar a funcionar SEM exigir
      responsavel.

      Repare no formato: o app continua funcionando. Nao ha erro, nao ha tela
      vermelha, a saida corre normal. A escola so perde a protecao inteira da
      2.1, no dia em que reimporta a lista do bimestre, e ninguem descobre ate
      alguem perguntar para quem a crianca foi.

      Nao da para consertar sozinho — so a escola tem a segunda planilha. Da
      para podar o que ficou pendurado e DIZER quantos eram.
    */
    const antes = await (await pedir('/alunos')).json<{ id: string; nome: string }[]>()
    const alice = antes.find((a) => a.nome === 'Alice Fernandes')!
    expect(
      (await (await pedir(`/responsaveis?alunoId=${alice.id}`)).json<unknown[]>()).length,
    ).toBe(2)

    // A mesma crianca, em OUTRA turma: id novo, vinculo velho apontando para
    // ninguem. E o caso mais comum de todos — virada de ano letivo.
    const r = await pedir('/importar', {
      method: 'POST',
      body: ['Nome,Turma', 'Alice Fernandes,2º ano'].join(String.fromCharCode(10)),
    })
    expect(r.status).toBe(200)

    const corpo = await r.json<{ vinculosPerdidos: number }>()
    expect(corpo.vinculosPerdidos).toBeGreaterThan(0)

    // E o que sobrou esta limpo: nada apontando para crianca que nao existe.
    const depois = await (await pedir('/alunos')).json<{ id: string }[]>()
    expect(
      (await (await pedir(`/responsaveis?alunoId=${depois[0].id}`)).json<unknown[]>()).length,
    ).toBe(0)
  })

  it('responsavel que ficou sem nenhuma crianca tambem sai', async () => {
    // Guardar nome e telefone de um adulto que nao busca ninguem e guardar dado
    // pessoal sem finalidade — e a finalidade e a unica coisa que justifica o
    // dado estar ali.
    await pedir('/importar', {
      method: 'POST',
      body: ['Nome,Turma', 'Alguem Novo,2º ano'].join(String.fromCharCode(10)),
    })
    const alunos = await (await pedir('/alunos')).json<{ id: string }[]>()
    expect(
      (await (await pedir(`/responsaveis?alunoId=${alunos[0].id}`)).json<unknown[]>()).length,
    ).toBe(0)

    // A prova de que a tabela esvaziou: reimportar responsaveis para o aluno
    // novo funciona, e traz so ele.
    const r = await pedir('/importar-responsaveis', {
      method: 'POST',
      body: ['Aluno,Turma,Responsavel', 'Alguem Novo,2º ano,Tutor Novo'].join(
        String.fromCharCode(10),
      ),
    })
    expect(r.status).toBe(200)
    expect((await r.json<{ responsaveis: number }>()).responsaveis).toBe(1)
  })

  it('so a portaria importa responsaveis', async () => {
    const r = await pedir('/importar-responsaveis', {
      token: TOKEN.sala('Pré 1'),
      method: 'POST',
      body: ['Aluno,Turma,Responsavel', 'Alice Fernandes,Pré 1,Alguem'].join(String.fromCharCode(10)),
    })
    expect(r.status).toBe(403)
  })
})


describe('red team da fase 2', () => {
  const CHAVE = 'chave-de-desenvolvimento-nao-use-em-producao'

  beforeEach(async () => {
    await reset()
  })

  it('REGRESSAO: o telefone do responsavel NAO vai para a sala', async () => {
    /*
      Quem liga para o responsavel e quem esta no portao. A sala precisa saber
      QUEM esta autorizado — para reconhecer o nome quando alguem bate na porta
      — e nao precisa do contato de ninguem.

      Onze salas guardando o telefone de centenas de adultos em cada tablet e a
      mesma minimizacao ao contrario que `docs/lgpd.md` ja registra para
      `/alunos`. Aqui deu para nao repetir o erro.
    */
    const alunos = await (await pedir('/alunos')).json<{ id: string; nome: string; turma: string }[]>()
    const alice = alunos.find((a) => a.nome === 'Alice Fernandes')!

    const daPortaria = await (
      await pedir(`/responsaveis?alunoId=${alice.id}`)
    ).json<{ telefone?: string }[]>()
    expect(daPortaria.some((r) => (r.telefone ?? '').length > 0)).toBe(true)

    const corpoDaSala = await (
      await pedir(`/responsaveis?alunoId=${alice.id}`, { token: TOKEN.sala(alice.turma) })
    ).text()
    expect(corpoDaSala).not.toContain('telefone')
    expect(corpoDaSala).not.toContain('90000')
    // Mas ela continua sabendo quem pode levar, que e o que ela precisa.
    expect(corpoDaSala).toContain('Marta Fernandes')
  })

  it('a chave de administracao e comparada em tempo constante', async () => {
    /*
      `a !== b` para em cima do primeiro caractere diferente, e quem mede o
      tempo das respostas descobre o segredo caractere a caractere em vez de
      precisar adivinha-lo inteiro.

      Nao da para medir tempo de forma confiavel num teste. Da para garantir o
      COMPORTAMENTO: prefixo correto, tamanho errado e tamanho certo com um
      caractere trocado sao todos recusados igual.
    */
    const quase = [
      '',
      CHAVE.slice(0, -1),
      CHAVE + 'x',
      CHAVE.slice(0, -1) + 'X',
      CHAVE.toUpperCase(),
    ]
    for (const chave of quase) {
      const r = await pedir('/dispositivos', {
        token: null,
        method: 'POST',
        headers: { 'X-Chave-Admin': chave },
        body: JSON.stringify({ papel: 'portaria', apelido: 'x' }),
      })
      expect(r.status).toBe(401)
    }

    const certa = await pedir('/dispositivos', {
      token: null,
      method: 'POST',
      headers: { 'X-Chave-Admin': CHAVE },
      body: JSON.stringify({ papel: 'portaria', apelido: 'x' }),
    })
    expect(certa.status).toBe(200)
  })
})
