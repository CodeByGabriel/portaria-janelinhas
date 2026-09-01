export const TURMAS = ['Maternal', 'Jardim I', 'Jardim II', '1º ano'] as const
export type Turma = (typeof TURMAS)[number]

export interface Aluno {
  id: string
  nome: string
  turma: Turma
}

const NOMES: readonly string[] = [
  'Thaís Gonçalves',
  'João Conceição',
  'Ana Beatriz Souza',
  'Thiago Alves',
  'Maria Cecília Rocha',
  'Davi Nascimento',
  'Lara Mendonça',
  'Bruno Assunção',
  'Íris Pacheco',
  'Heitor Camargo',
  'Alice Fernandes',
  'Miguel Bittencourt',
  'Sofia Rezende',
  'Arthur Magalhães',
  'Helena Siqueira',
  'Bernardo Antunes',
  'Manuela Vasconcelos',
  'Théo Marçal',
  'Valentina Queiroz',
  'Gael Espíndola',
  'Cecília Barroso',
  'Anthony Peçanha',
  'Isabela Furtado',
  'Lorenzo Sampaio',
  'Elisa Guimarães',
  'Benício Andrade',
  'Antonella Xavier',
  'Noah Teixeira',
  'Maitê Salgado',
  'Vicente Aragão',
  'Liz Monteiro',
  'Ravi Bacelar',
]

export function semear(): Aluno[] {
  return NOMES.map((nome, i) => ({
    id: `a${String(i + 1).padStart(2, '0')}`,
    nome,
    turma: TURMAS[Math.floor(i / 8)],
  }))
}
