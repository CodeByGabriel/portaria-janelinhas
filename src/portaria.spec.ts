/// <reference types="@cloudflare/vitest-plugin/types" />
import { env, abortAllDurableObjects, reset } from 'cloudflare:test'
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

/** Abre um WebSocket contra o Durable Object e devolve o lado do cliente. */
async function ligar(query: string) {
  const resposta = await portaria().fetch(
    new Request(`http://do/ws?${query}`, { headers: { Upgrade: 'websocket' } }),
  )
  const ws = resposta.webSocket
  if (!ws) throw new Error(`sem webSocket na resposta (status ${resposta.status})`)
  ws.accept()
  return ws
}

/** Espera o proximo retrato que chegar naquele socket. */
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
