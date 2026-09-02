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

export function semear(): Aluno[] {
  return NOMES.map((nome, i) => ({
    id: `a${String(i + 1).padStart(2, '0')}`,
    nome,
    turma: TURMAS[Math.floor(i / POR_TURMA)],
  }))
}
