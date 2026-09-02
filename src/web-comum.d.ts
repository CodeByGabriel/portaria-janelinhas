/*
  Declaracao de tipos para a copia da busca que roda no navegador.

  Existe para o `paridade.test.ts` poder importar o .js e comparar as duas
  implementacoes RODANDO — comparar o texto diria se as letras batem, nao se as
  regras batem. Sem isto o typecheck reclama de import implicitamente `any`.

  Os tipos sao propositalmente frouxos: o objetivo nao e tipar a copia, e sim
  permitir que o teste a execute.
*/
declare module '*/web/comum/busca.js' {
  export function normalizar(texto: string): string
  export function buscar(
    alunos: { id: string; nome: string; turma: string }[],
    consulta: string,
    limite?: number,
  ): { achados: { id: string; nome: string; turma: string }[]; total: number; homonimos: string[] }
}
