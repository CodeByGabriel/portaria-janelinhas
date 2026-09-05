import { normalizar } from './busca.ts'
import { TURMAS, type Turma } from './semente.ts'

/*
  Quem pode levar cada crianca embora.

  Ate aqui o sistema respondia "esta crianca saiu" e nao respondia "com quem".
  A trilha guardava a sala que liberou e a portaria que entregou — e nada sobre
  o adulto que estava do outro lado do portao. E o "a quem" e metade da
  promessa: um registro de saida que nao diz para quem a crianca foi nao serve
  no dia em que a familia pergunta.

  O vinculo e MUITOS PARA MUITOS, e nao um campo no aluno. Uma crianca tem mae,
  pai, avo, as vezes a vizinha autorizada; um responsavel busca dois ou tres
  filhos. Modelar como coluna obrigaria a escolher um "responsavel principal",
  que e uma ficcao — e no dia em que o outro aparece no portao, o sistema
  estaria errado por desenho.
*/

export interface Responsavel {
  /** Derivado do nome normalizado. Ver `idDe` — mesma regra do aluno. */
  id: string
  nome: string
  /** Mae, pai, avo, tio, vizinha... texto livre curto, vindo da planilha. */
  vinculo: string
  /** Opcional: a escola pode nao ter, ou nao querer guardar. */
  telefone: string
}

/** Uma crianca e um adulto que pode busca-la. */
export interface Vinculo {
  alunoId: string
  responsavelId: string
  /**
   * `true` quando este adulto NAO pode levar esta crianca.
   *
   * A restricao vive no vinculo, e nao no responsavel: "o pai nao busca" e uma
   * frase sobre um par, nunca sobre a pessoa. O mesmo adulto pode estar
   * impedido de buscar um filho e autorizado a buscar outro — e e exatamente
   * assim que decisao judicial costuma ser escrita.
   */
  impedido: boolean
}

export const LIMITE_NOME_RESPONSAVEL = 120
export const LIMITE_VINCULO = 40
export const LIMITE_TELEFONE = 24

const MARCACAO = /[<>]/g

/*
  O id vem do CONTEUDO, como o do aluno.

  Duas linhas da planilha com "Maria Aparecida Souza" sao a mesma pessoa, e ela
  precisa aparecer uma vez so na lista da portaria — senao a porteira escolhe
  entre duas Marias identicas e a trilha guarda qual das duas ela clicou, que
  nao significa nada.

  Sem a turma na composicao, de proposito: o responsavel atravessa turmas, e e
  isso que faz irmaos serem irmaos.
*/
export function idDeResponsavel(nome: string): string {
  return `r${digerir(normalizar(nome))}`
}

function digerir(texto: string): string {
  let h = 2166136261
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

export interface ErroDeLinha {
  linha: number
  motivo: string
}

export interface ResultadoDeResponsaveis {
  responsaveis: Responsavel[]
  vinculos: Vinculo[]
  erros: ErroDeLinha[]
  errosTotal: number
}

const LIMITE_ERROS = 100

/*
  As colunas da planilha de responsaveis.

  Uma LINHA POR PAR: a mesma crianca aparece tantas vezes quantos adultos
  puderem busca-la, e o mesmo adulto aparece em cada filho. E repetitivo de
  digitar e e o unico formato que a secretaria consegue produzir no Excel sem
  aprender nada novo — a alternativa (uma coluna "responsaveis" com nomes
  separados por ponto e virgula) quebra no primeiro sobrenome composto.

    Aluno         obrigatoria, casada por nome + turma
    Turma         obrigatoria, desambigua homonimos
    Responsavel   obrigatoria
    Vinculo       opcional  (mae, pai, avo...)
    Telefone      opcional
    Impedido      opcional  ("sim" impede este adulto de levar esta crianca)
*/
const TITULOS = {
  aluno: ['aluno', 'crianca', 'nome do aluno', 'estudante'],
  turma: ['turma', 'serie', 'ano'],
  responsavel: ['responsavel', 'autorizado', 'nome do responsavel'],
  vinculo: ['vinculo', 'parentesco', 'relacao'],
  telefone: ['telefone', 'celular', 'contato', 'fone'],
  impedido: ['impedido', 'restricao', 'nao pode buscar', 'bloqueado'],
}

function indiceDe(cabecalho: string[], aceitos: string[]): number {
  for (const titulo of aceitos) {
    const i = cabecalho.indexOf(titulo)
    if (i !== -1) return i
  }
  return -1
}

/** "sim", "s", "x", "1", "verdadeiro" contam como sim. Qualquer outra coisa, nao. */
function ehSim(valor: string): boolean {
  return ['sim', 's', 'x', '1', 'true', 'verdadeiro'].includes(normalizar(valor))
}

/**
 * Le a planilha de responsaveis contra o cadastro de alunos que ja existe.
 *
 * Casa por NOME + TURMA, e nao por id, porque a secretaria digita nome — e
 * porque casar por id exigiria que ela conhecesse os ids, que sao um detalhe
 * interno. Aluno que nao existe vira erro de linha, nunca um vinculo solto:
 * um vinculo apontando para ninguem e uma autorizacao que ninguem consegue
 * revisar depois.
 */
export function analisarResponsaveis(
  linhas: string[][],
  alunos: { id: string; nome: string; turma: Turma }[],
): ResultadoDeResponsaveis {
  const responsaveis = new Map<string, Responsavel>()
  const vinculos = new Map<string, Vinculo>()
  const erros: ErroDeLinha[] = []

  const cabecalho = (linhas[0] ?? []).map((c) => normalizar(c))
  const iAluno = indiceDe(cabecalho, TITULOS.aluno)
  const iTurma = indiceDe(cabecalho, TITULOS.turma)
  const iResp = indiceDe(cabecalho, TITULOS.responsavel)
  const iVinculo = indiceDe(cabecalho, TITULOS.vinculo)
  const iTelefone = indiceDe(cabecalho, TITULOS.telefone)
  const iImpedido = indiceDe(cabecalho, TITULOS.impedido)

  if (iAluno === -1 || iTurma === -1 || iResp === -1) {
    return {
      responsaveis: [],
      vinculos: [],
      erros: [{ linha: 1, motivo: 'a planilha precisa das colunas Aluno, Turma e Responsável' }],
      errosTotal: 1,
    }
  }

  /* Indice por nome normalizado + turma: e assim que a secretaria escreve. */
  const porNomeETurma = new Map<string, string>()
  /* Para pegar colisao de hash entre nomes diferentes de responsavel. */
  const nomePorId = new Map<string, string>()
  for (const a of alunos) porNomeETurma.set(`${normalizar(a.nome)}|${a.turma}`, a.id)

  for (let i = 1; i < linhas.length; i++) {
    const campos = linhas[i]
    if (campos.every((c) => c === '')) continue

    const nomeAluno = (campos[iAluno] ?? '').trim()
    const turmaBruta = (campos[iTurma] ?? '').trim()
    const nomeResp = (campos[iResp] ?? '').trim()

    if (nomeAluno === '' || nomeResp === '') {
      erros.push({ linha: i + 1, motivo: 'aluno ou responsável vazio' })
      continue
    }
    if (MARCACAO.test(nomeResp) || MARCACAO.test(nomeAluno)) {
      erros.push({ linha: i + 1, motivo: 'nome com caractere invalido (< ou >)' })
      continue
    }
    if (nomeResp.length > LIMITE_NOME_RESPONSAVEL) {
      erros.push({ linha: i + 1, motivo: `nome de responsável longo demais` })
      continue
    }

    const turma = TURMAS.find((t) => normalizar(t) === normalizar(turmaBruta))
    if (!turma) {
      const mostrado = turmaBruta.replace(MARCACAO, '').slice(0, 40)
      erros.push({ linha: i + 1, motivo: `turma desconhecida: "${mostrado}"` })
      continue
    }

    const alunoId = porNomeETurma.get(`${normalizar(nomeAluno)}|${turma}`)
    if (!alunoId) {
      const mostrado = nomeAluno.replace(MARCACAO, '').slice(0, 60)
      erros.push({
        linha: i + 1,
        motivo: `aluno nao encontrado no cadastro: "${mostrado}" (${turma})`,
      })
      continue
    }

    const id = idDeResponsavel(nomeResp)
    /*
      O id e um hash de 32 bits do nome normalizado: dois adultos com nomes
      DIFERENTES podem cair no mesmo id, e o segundo viraria o primeiro — com o
      telefone e os vinculos do outro. Improvavel; grave demais para ignorar.
    */
    const chaveNome = normalizar(nomeResp)
    const nomeAnterior = nomePorId.get(id)
    if (nomeAnterior !== undefined && nomeAnterior !== chaveNome) {
      erros.push({
        linha: i + 1,
        motivo: `colisao de identificador entre "${nomeResp.slice(0, 60)}" e outro responsavel; renomeie um dos dois (acrescente um sobrenome)`,
      })
      continue
    }
    nomePorId.set(id, chaveNome)
    /*
      O primeiro registro de um responsavel manda no vinculo e no telefone.

      Linhas seguintes do mesmo adulto costumam repetir os dados, e quando
      divergem — "mae" numa linha, "responsavel" noutra — a escolha e ficar com
      a primeira em vez de sobrescrever calada. Divergencia e coisa para a
      secretaria resolver na planilha, nao para o importador adivinhar.
    */
    if (!responsaveis.has(id)) {
      responsaveis.set(id, {
        id,
        nome: nomeResp,
        vinculo: (campos[iVinculo] ?? '')
          .replace(MARCACAO, '')
          .trim()
          .slice(0, LIMITE_VINCULO),
        telefone: (campos[iTelefone] ?? '')
          .replace(MARCACAO, '')
          .trim()
          .slice(0, LIMITE_TELEFONE),
      })
    }

    const chave = `${alunoId}|${id}`
    const impedido = iImpedido === -1 ? false : ehSim(campos[iImpedido] ?? '')
    /*
      Impedimento GANHA de autorizacao quando a mesma dupla aparece duas vezes.

      Se uma linha diz que o pai busca e outra diz que nao, o sistema fica com
      "nao". A planilha esta ambigua e alguem precisa corrigi-la; ate la, o
      lado seguro do erro e a crianca nao sair — e nao sair com quem talvez nao
      pudesse.
    */
    const anterior = vinculos.get(chave)
    vinculos.set(chave, {
      alunoId,
      responsavelId: id,
      impedido: impedido || (anterior?.impedido ?? false),
    })
  }

  return {
    responsaveis: [...responsaveis.values()],
    vinculos: [...vinculos.values()],
    erros: erros.slice(0, LIMITE_ERROS),
    errosTotal: erros.length,
  }
}
