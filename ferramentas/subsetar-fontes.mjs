/**
 * Reduz as fontes ao que o app realmente escreve.
 *
 *   node ferramentas/subsetar-fontes.mjs
 *
 * O Fraunces desenha exclusivamente o cabecalho — o nome da escola, o papel da
 * tela e o nome da turma. Vinte e poucos caracteres. Baixado inteiro do Google
 * (subset "latin"), ele custa 35 KB; reduzido ao que aparece, cai para menos de
 * um quinto disso.
 *
 * Isso importa porque a rede e o wifi de uma escola, e porque o orcamento de
 * peso da primeira carga da portaria e 120 KB. Trinta e cinco quilobytes para
 * escrever uma frase que nunca muda seria a maior linha do orcamento — e a
 * menos util.
 *
 * O Instrument Sans NAO e subsetado: ele escreve nome de crianca, e nome de
 * crianca vem de planilha. Recortar a fonte pelos glifos que a semente usa
 * garantiria um retangulo vazio no lugar do "Ø" de alguem, no dia em que a
 * escola importasse a lista de verdade. Fonte de corpo se subseta por
 * INTERVALO (o "latin" do Google ja faz isso), nunca por amostra.
 *
 * Roda o pyftsubset do fonttools, que ja esta instalado. Se nao estiver, o
 * script diz o que falta e nao deixa o arquivo pela metade.
 */
import { spawnSync } from 'node:child_process'
import { statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const FONTES = join(RAIZ, 'web', 'comum', 'fontes')

/*
  Tudo o que o cabecalho pode escrever.

  Nome da escola, papeis das telas, e as onze turmas — que sao um conjunto
  FECHADO, vindo de `semente.ts`. Se a escola renomear uma turma para algo com
  caractere fora desta lista, o texto cai para a fonte seguinte da pilha em vez
  de sumir: `font-family` sempre termina numa fonte de sistema.
*/
const DO_CABECALHO = [
  'Janelinhas do Saber',
  'Portaria',
  'Tela da sala',
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
  'Educação Infantil',
  'Fundamental I',
  'Fundamental II',
  'Atenção: há uma restrição registrada',
  'Em saída',
  'Chamar aluno',
  'Importar planilha',
].join('')

const alvo = join(FONTES, 'fraunces-600-latin.woff2')
const saida = join(FONTES, 'fraunces-600-cabecalho.woff2')

if (!existsSync(alvo)) {
  console.error(`nao achei ${alvo} — baixe o subset latin do Google antes`)
  process.exit(1)
}

const antes = statSync(alvo).size

const r = spawnSync(
  'python',
  [
    '-m',
    'fontTools.subset',
    alvo,
    /*
      Por INTERVALO, e nao mais pela amostra do cabecalho: o Fraunces passou a
      desenhar tambem o titulo da porta e os titulos das caixas ("Quem esta
      levando?", "Atencao: ha uma restricao registrada"), e a amostra nao
      tinha 'z', 'Q', 'v' nem '?'. Latim basico + suplemento (acentos do
      portugues) + a pontuacao tipografica que as telas usam.
    */
    '--unicodes=' +
      [
        'U+0020-007E', // latim basico: letras, numeros, pontuacao, '?'
        'U+00AA,U+00BA', // ª e º (turmas: 1º ano...)
        'U+00C0-00C3,U+00C7,U+00C9,U+00CA,U+00CD,U+00D3-00D5,U+00DA,U+00DC', // maiusculas acentuadas do portugues
        'U+00E0-00E3,U+00E7,U+00E9,U+00EA,U+00ED,U+00F3-00F5,U+00FA,U+00FC', // minusculas acentuadas do portugues
        'U+2013,U+2014,U+2018,U+2019,U+201C,U+201D,U+2026', // travessoes, aspas tipograficas, reticencias
      ].join(','),
    '--flavor=woff2',
    `--output-file=${saida}`,
    // Sem layout de tabelas que o cabecalho nao usa: kern e ligadura padrao
    // bastam para uma linha de titulo.
    '--layout-features=kern,liga,calt',
    '--no-hinting',
    '--desubroutinize',
  ],
  { encoding: 'utf8' },
)

if (r.status !== 0) {
  console.error('pyftsubset falhou:')
  console.error(r.stderr || r.stdout || '(sem saida)')
  process.exit(1)
}

const depois = statSync(saida).size
console.log(
  `fraunces: ${(antes / 1024).toFixed(1)} KB -> ${(depois / 1024).toFixed(1)} KB` +
    ` (latim basico + acentos do portugues, ${Math.round((1 - depois / antes) * 100)}% menor)`,
)
