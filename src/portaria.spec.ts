/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'

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
