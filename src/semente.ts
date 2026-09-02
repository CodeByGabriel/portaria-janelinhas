/*
  A escola vai do Pré 1 ao 9º ano: Educacao Infantil, Fundamental I e
  Fundamental II. Sao 11 turmas, e isso muda a interface — uma tela de sala
  com turma fixa no codigo nao serve. A professora escolhe a dela ao entrar.
*/

export const TURMAS = [
  'Pré 1',
  'Pré 2',
  '1º ano',
  '2º ano',
  '3º ano',
  '4º ano',
  '5º ano',
  '6º ano',
  '7º ano',
  '8º ano',
  '9º ano',
] as const

export type Turma = (typeof TURMAS)[number]

export const SEGMENTOS = [
  'Educação Infantil',
  'Fundamental I',
  'Fundamental II',
] as const

export type Segmento = (typeof SEGMENTOS)[number]

/** A que segmento pertence cada turma. Usado para agrupar a lista de turmas. */
export function segmentoDa(turma: Turma): Segmento {
  if (turma.startsWith('Pré')) return 'Educação Infantil'
  const ano = Number.parseInt(turma, 10)
  return ano <= 5 ? 'Fundamental I' : 'Fundamental II'
}

export interface Aluno {
  id: string
  nome: string
  turma: Turma
  /**
   * Ha uma restricao registrada para esta crianca.
   *
   * BOOLEANO, e nao o texto. O texto vive so no servidor e sai por
   * `/alerta`, uma crianca por vez, quando alguem esta prestes a agir.
   *
   * `/alunos` entrega o cadastro inteiro ao navegador — ja e minimizacao ao
   * contrario, e `docs/lgpd.md` registra isso. Mandar junto a anotacao de
   * guarda de cada crianca faria cada tablet da portaria carregar, em repouso,
   * a situacao familiar da escola inteira. O aviso de que existe algo a ler
   * cabe num booleano.
   */
  temAlerta?: boolean
}

/*
  Quatro criancas por turma. Nomes brasileiros com acentuacao, apostrofo e
  hifen de verdade, para que a busca seja exercitada com o que a escola tem —
  e nao com nomes de laboratorio.

  E um par de HOMONIMAS, de proposito: "Maria Eduarda Nogueira" no 1º ano e no
  6º ano. Numa escola de 292 criancas isso acontece, e ate aqui a semente nao
  tinha nenhum caso — entao a marca de homonimo nao podia ser exercitada nem
  pelo teste, nem pelos prints, nem pela demonstracao na frente da escola.

  Semente sem o caso dificil e semente que so prova o caminho facil. Chamar a
  Maria Eduarda errada avisa a SALA errada, e a crianca certa continua
  esperando no portao sem ninguem saber.
*/
const NOMES: readonly string[] = [
  // Pré 1
  'Alice Fernandes',
  'Théo Marçal',
  'Maitê Salgado',
  'Bernardo Antunes',
  // Pré 2
  'Íris Pacheco',
  'Gael Espíndola',
  'Cecília Barroso',
  'Ravi Bacelar',
  // 1º ano
  'Maria Eduarda Nogueira',
  'João Conceição',
  'Lara Mendonça',
  'Benício Andrade',
  // 2º ano
  'Ana Beatriz Souza',
  'Miguel Bittencourt',
  'Manuela Vasconcelos',
  "Pedro D'Alessandro",
  // 3º ano
  'Sofia Rezende',
  'Arthur Magalhães',
  'Helena Siqueira',
  'Davi Nascimento',
  // 4º ano
  'Maria Cecília Rocha',
  'Anthony Peçanha',
  'Isabela Furtado',
  'Lorenzo Sampaio',
  // 5º ano
  'Elisa Guimarães',
  'Vicente Aragão',
  'Antonella Xavier',
  'Noah Teixeira',
  // 6º ano
  'Maria Eduarda Nogueira',
  'Heitor Camargo',
  "Maria Sant'Ana",
  'Bruno Assunção',
  // 7º ano
  'Liz Monteiro',
  'Thiago Alves',
  'Ana-Clara Vasconcelos',
  'Enzo Bittencourt',
  // 8º ano
  'Beatriz Nogueira',
  'Murilo Cavalcanti',
  'Yasmin Albuquerque',
  'Otávio Rebouças',
  // 9º ano
  'Giovanna Paixão',
  'Rafael Menezes',
  'Luíza Sant’Anna',
  'Gustavo Bandeira',
]

const POR_TURMA = 4

/*
  Uma restricao na semente, e por que ela precisa estar aqui.

  Restricao de guarda e o maior risco juridico deste projeto, e ate agora a
  semente nao tinha nenhum caso — entao a caixa de alerta nao podia ser
  exercitada sem que o teste IMPORTASSE uma planilha, o que substitui o
  cadastro inteiro. Uma dessas execucoes morreu no meio e deixou o servidor com
  dois alunos, envenenando todas as rodadas seguintes. Semente sem o caso
  dificil empurra o caso dificil para dentro do teste, onde ele vira efeito
  colateral.

  Ravi Bacelar, do Pré 2, de proposito: nenhuma outra verificacao usa aquela
  turma, entao a caixa nao aparece no meio de um teste que nao e sobre ela.

  O texto e FICCAO DECLARADA, como todo o resto da semente. Nenhum dado real
  de crianca entra neste repositorio.
*/
const RESTRICOES: Readonly<Record<string, string>> = {
  'Ravi Bacelar':
    'Guarda compartilhada. Entregar somente à mãe ou à avó materna, conforme decisão judicial de 2026 (ficção da semente).',
}

/** As restricoes da semente, prontas para o deposito guardar. */
export function alertasDaSemente(): { id: string; texto: string }[] {
  return semear()
    .filter((a) => RESTRICOES[a.nome])
    .map((a) => ({ id: a.id, texto: RESTRICOES[a.nome]! }))
}

export function semear(): Aluno[] {
  return NOMES.map((nome, i) => ({
    id: `a${String(i + 1).padStart(2, '0')}`,
    nome,
    turma: TURMAS[Math.floor(i / POR_TURMA)],
    temAlerta: RESTRICOES[nome] !== undefined,
  }))
}
