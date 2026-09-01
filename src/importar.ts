import { TURMAS, type Aluno, type Turma } from './semente.ts'
import { normalizar } from './busca.ts'

export interface Erro {
  linha: number
  motivo: string
}

export interface Resultado {
  alunos: Aluno[]
  duplicados: number
  erros: Erro[]
}

/*
  ---------------------------------------------------------------------------
  Decodificacao

  `Request.text()` decodifica como UTF-8. O Excel em portugues, no "Salvar
  como -> CSV (separado por virgulas)", grava em ANSI (Windows-1252) por
  padrao. Como TODA turma desta escola tem caractere acentuado — Pré 1, 1º
  ano, 9º ano — um arquivo ANSI lido como UTF-8 recusa 100% das linhas com
  "turma desconhecida", culpando dados que estao certos.

  Entao: tenta UTF-8 estrito; se falhar, decodifica como Windows-1252.
  A tabela cobre a faixa 0x80-0x9F, onde 1252 difere de latin-1.
*/

const CP1252_ALTOS = [
  '€', '', '‚', 'ƒ', '„', '…', '†', '‡',
  'ˆ', '‰', 'Š', '‹', 'Œ', '', 'Ž', '',
  '', '‘', '’', '“', '”', '•', '–', '—',
  '˜', '™', 'š', '›', 'œ', '', 'ž', 'Ÿ',
]

function deCp1252(bytes: Uint8Array): string {
  let saida = ''
  for (const b of bytes) {
    saida += b >= 0x80 && b <= 0x9f ? CP1252_ALTOS[b - 0x80] : String.fromCharCode(b)
  }
  return saida
}

/** Decodifica o corpo enviado, aceitando UTF-8 ou o ANSI que o Excel gera. */
export function decodificar(bytes: ArrayBuffer | Uint8Array): string {
  const vetor = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(vetor)
  } catch {
    return deCp1252(vetor)
  }
}

/*
  ---------------------------------------------------------------------------
  CSV

  O separador e decidido UMA VEZ, pelo cabecalho — nao por linha. Decidir por
  linha fazia uma coluna de observacao com ponto e virgula ("alergia; asma")
  reparticionar aquela linha sozinha e jogar a crianca fora com uma mensagem
  apontando para a coluna errada.

  Campos entre aspas sao respeitados, inclusive com separador e quebra de
  linha dentro. "Souza, Ana" e um nome, nao duas colunas. Aspas duplicadas
  ("") sao uma aspa literal, como manda o RFC 4180.
*/

function contarFora(linha: string, alvo: string): number {
  let dentro = false
  let n = 0
  for (const c of linha) {
    if (c === '"') dentro = !dentro
    else if (c === alvo && !dentro) n++
  }
  return n
}

function separadorDo(cabecalho: string): string {
  return contarFora(cabecalho, ';') > contarFora(cabecalho, ',') ? ';' : ','
}

/** Quebra o CSV inteiro em linhas de campos, respeitando aspas. */
function analisarCsv(texto: string, separador: string): string[][] {
  const linhas: string[][] = []
  let campos: string[] = []
  let campo = ''
  let dentro = false

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]

    if (dentro) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"'
          i++
        } else {
          dentro = false
        }
      } else {
        campo += c
      }
      continue
    }

    if (c === '"') {
      dentro = true
    } else if (c === separador) {
      campos.push(campo.trim())
      campo = ''
    } else if (c === '\n') {
      campos.push(campo.trim())
      linhas.push(campos)
      campos = []
      campo = ''
    } else if (c !== '\r') {
      campo += c
    }
  }

  campos.push(campo.trim())
  linhas.push(campos)
  return linhas
}

/*
  ---------------------------------------------------------------------------
  Identidade

  O id vem do CONTEUDO (nome normalizado + turma), nunca da posicao.

  Com id posicional, corrigir uma linha e reimportar deslocava todos os ids
  abaixo dela: o "i002" que era Carlos virava Bruno. Um tablet com a lista
  velha na memoria chamava i002 achando que chamava Carlos, e o servidor
  chamava Bruno — a sala do Bruno era avisada, e o Bruno ia para o portao.
  Nada disso dava erro, porque o id existia nos dois cadastros.

  Com id derivado do conteudo, reimportar a mesma crianca devolve o mesmo id,
  e corrigir uma linha nao mexe em nenhuma outra.
*/

function digerir(texto: string): string {
  let h = 2166136261
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export function idDe(nome: string, turma: Turma): string {
  return `i${digerir(`${normalizar(nome)}|${turma}`)}`
}

/*
  ---------------------------------------------------------------------------
*/

const MARCACAO = /[<>]/
/** Versao global: `replace` sem a flag /g troca so a PRIMEIRA ocorrencia. */
const MARCACAO_TODAS = /[<>]/g
const LIMITE_NOME = 80

export function analisar(csv: string): Resultado {
  const alunos: Aluno[] = []
  const erros: Erro[] = []
  const vistos = new Set<string>()
  let duplicados = 0

  const primeiraLinha = csv.split(/\r?\n/, 1)[0] ?? ''
  const separador = separadorDo(primeiraLinha)
  const linhas = analisarCsv(csv, separador)

  const cabecalho = (linhas[0] ?? []).map((c) => normalizar(c))
  const iNome = cabecalho.indexOf('nome')
  const iTurma = cabecalho.indexOf('turma')

  if (iNome === -1 || iTurma === -1) {
    return {
      alunos,
      duplicados,
      erros: [{ linha: 1, motivo: 'a planilha precisa das colunas Nome e Turma' }],
    }
  }

  for (let i = 1; i < linhas.length; i++) {
    const campos = linhas[i]
    if (campos.every((c) => c === '')) continue

    const nome = campos[iNome] ?? ''
    const turmaBruta = campos[iTurma] ?? ''

    if (nome === '') {
      erros.push({ linha: i + 1, motivo: 'nome vazio' })
      continue
    }

    if (MARCACAO.test(nome)) {
      erros.push({ linha: i + 1, motivo: 'nome com caractere invalido (< ou >)' })
      continue
    }

    if (nome.length > LIMITE_NOME) {
      erros.push({ linha: i + 1, motivo: `nome longo demais (${nome.length} caracteres)` })
      continue
    }

    const turma = TURMAS.find((t) => normalizar(t) === normalizar(turmaBruta))
    if (!turma) {
      // O valor recusado volta na mensagem, entao passa pelo mesmo filtro do
      // nome e pelo mesmo teto: entrada do cliente nao volta crua nem sem limite.
      const mostrado = turmaBruta.replace(MARCACAO_TODAS, '').slice(0, 40)
      erros.push({ linha: i + 1, motivo: `turma desconhecida: "${mostrado}"` })
      continue
    }

    // Duplicado e mesmo nome NA MESMA TURMA. Dois homonimos em turmas
    // diferentes sao duas criancas, e fundi-los seria pior que qualquer erro.
    const id = idDe(nome, turma)
    if (vistos.has(id)) {
      duplicados++
      continue
    }
    vistos.add(id)

    alunos.push({ id, nome, turma: turma as Turma })
  }

  return { alunos, duplicados, erros }
}
