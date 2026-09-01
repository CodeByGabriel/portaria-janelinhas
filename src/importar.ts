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

/**
 * O Excel brasileiro exporta CSV com ponto e virgula quando o separador
 * decimal do sistema e virgula. Como as duas convencoes chegam da escola,
 * decidimos por linha: quem tiver ';' usa ';'.
 */
function separar(linha: string): string[] {
  const separador = linha.includes(';') ? ';' : ','
  return linha.split(separador).map((c) => c.trim())
}

/**
 * Le a planilha da escola e devolve o que da para importar, o que estava
 * repetido e o que deu errado — com o numero da linha.
 *
 * As colunas sao achadas pelo NOME, nao pela posicao: cada escola exporta
 * numa ordem diferente e com colunas a mais. So Nome e Turma sao exigidas.
 *
 * Uma linha ruim nunca derruba a importacao inteira. Numa planilha de 292
 * criancas, recusar tudo por causa de uma turma escrita errado obrigaria a
 * secretaria a cacar a agulha sem nenhuma pista.
 */
export function analisar(csv: string): Resultado {
  const linhas = csv.split(/\r?\n/)
  const alunos: Aluno[] = []
  const erros: Erro[] = []
  const vistos = new Set<string>()
  let duplicados = 0

  const cabecalho = separar(linhas[0] ?? '').map((c) => normalizar(c))
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
    if (linhas[i].trim() === '') continue

    const campos = separar(linhas[i])
    const nome = (campos[iNome] ?? '').trim()
    const turmaBruta = (campos[iTurma] ?? '').trim()

    if (nome === '') {
      erros.push({ linha: i + 1, motivo: 'nome vazio' })
      continue
    }

    /*
      Nenhum nome de crianca tem sinal de menor ou maior. Se veio, ou a
      planilha esta corrompida ou alguem esta tentando injetar marcacao numa
      tela que exibe esse nome. As telas ja constroem o DOM sem innerHTML;
      isto e a segunda barreira, e e a que da mensagem de erro para a
      secretaria em vez de aceitar em silencio.
    */
    if (/[<>]/.test(nome)) {
      erros.push({ linha: i + 1, motivo: 'nome com caractere invalido (< ou >)' })
      continue
    }

    if (nome.length > 80) {
      erros.push({ linha: i + 1, motivo: `nome longo demais (${nome.length} caracteres)` })
      continue
    }

    const turma = TURMAS.find((t) => normalizar(t) === normalizar(turmaBruta))
    if (!turma) {
      erros.push({ linha: i + 1, motivo: `turma desconhecida: "${turmaBruta}"` })
      continue
    }

    /*
      Duplicado e mesmo nome NA MESMA TURMA. Duas criancas com o mesmo nome
      em turmas diferentes sao duas criancas — em escola isso acontece, e
      fundir as duas seria pior do que qualquer erro de importacao.
    */
    const chave = `${normalizar(nome)}|${turma}`
    if (vistos.has(chave)) {
      duplicados++
      continue
    }
    vistos.add(chave)

    alunos.push({
      id: `i${String(alunos.length + 1).padStart(3, '0')}`,
      nome,
      turma: turma as Turma,
    })
  }

  return { alunos, duplicados, erros }
}
