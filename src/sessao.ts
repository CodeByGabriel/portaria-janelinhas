import { ehPapel, type Papel } from './estados.ts'
import { TURMAS, type Turma } from './semente.ts'

/*
  Quem esta falando com o servidor.

  Ate aqui a resposta vinha da query string: `?papel=portaria`. Isso nunca foi
  autenticacao — era uma etiqueta que o proprio cliente colava em si mesmo, e
  qualquer pessoa com o endereco virava portaria e baixava o cadastro inteiro.
  Funcionava para a vitrine, com semente ficticia, e e o unico item que sozinho
  impede subir a lista de verdade da escola.

  Agora a resposta vem de um TOKEN POR APARELHO, guardado num cookie que o
  JavaScript da pagina nao alcanca.

  Este arquivo e o unico lugar que decide identidade. Trocar por Better Auth
  depois e trocar `sessaoDe` — nada mais no projeto pergunta quem e quem.
*/

export interface Dispositivo {
  /** SHA-256 do token, em hex. O token cru nunca e guardado. */
  impressao: string
  papel: Papel
  /** Obrigatoria para `sala`, ausente para `portaria`. */
  turma?: Turma
  /** Como a escola chama este aparelho: "tablet da secretaria". */
  apelido: string
  criadoEm: number
  /** Nao-nulo depois de revogado. Revogado nao entra, nunca. */
  revogadoEm: number | null
}

export type Sessao = { papel: Papel; turma?: Turma; apelido: string }

/*
  O token de demonstracao de uma turma.

  ASCII puro, e nao e detalhe: o token viaja num COOKIE, e cookie viaja num
  header HTTP. Um "é" ali passa por caminhos que o codificam de formas
  diferentes nas duas pontas, e o resultado e uma conexao recusada sem que
  nada esteja errado. Descobri exatamente assim — `demonstracao-sala-pré-1`
  era aceito pelo servidor e recusado na rede.

  Acentos saem por NFD, que separa a letra da marca, e a marca e removida.
  "Pré 1" vira "pre-1"; "3º ano" vira "3o-ano" pelo mesmo caminho, porque o
  ordinal masculino decompoe.
*/
export function tokenDemoDe(turma: string): string {
  const semAcento = turma
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
  return `demonstracao-sala-${semAcento}`
}

export const NOME_DO_COOKIE = 'janelinhas_dispositivo'

/*
  Trinta e dois bytes de aleatoriedade real.

  Nao e um numero curto que alguem digita de cabeca: e colado uma vez, no dia
  em que a escola prepara o aparelho, e depois some dentro do cookie. Um token
  curto o bastante para ser digitado seria curto o bastante para ser adivinhado.
*/
export function gerarToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return base64url(bytes)
}

function base64url(bytes: Uint8Array): string {
  let texto = ''
  for (const b of bytes) texto += String.fromCharCode(b)
  return btoa(texto).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

/**
 * A impressao do token: SHA-256 em hex.
 *
 * O banco guarda so isto. Um vazamento da tabela de dispositivos nao entrega
 * nenhum token utilizavel — do mesmo jeito que uma tabela de senhas nao deve
 * entregar senha. E como o token e aleatorio de 32 bytes, nao ha dicionario a
 * percorrer: hash simples basta, sem custo de derivacao.
 */
export async function impressaoDe(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token)
  const resumo = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(resumo)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/*
  Le um cookie do pedido.

  Feito a mao porque e uma linha e porque o Worker nao tem parser de cookie —
  e porque uma dependencia a mais neste caminho seria uma dependencia no
  caminho que decide se uma crianca pode sair.
*/
export function cookieDo(pedido: Request, nome: string): string | null {
  const cru = pedido.headers.get('Cookie')
  if (!cru) return null
  for (const parte of cru.split(';')) {
    const igual = parte.indexOf('=')
    if (igual < 0) continue
    if (parte.slice(0, igual).trim() === nome) return parte.slice(igual + 1).trim()
  }
  return null
}

/*
  O cookie da sessao, e cada atributo dele.

    HttpOnly    o JavaScript da pagina nao le. Um XSS na tela da portaria nao
                consegue exfiltrar o token do aparelho.
    SameSite    Strict: o cookie nao acompanha nenhuma navegacao vinda de fora.
                Sem isso, um link num grupo de WhatsApp dispararia acoes na
                sessao de quem clicasse.
    Path=/      o WebSocket, as rotas HTTP e as paginas usam o mesmo cookie.
    Max-Age     um ano. E um tablet de escola, montado uma vez; pedir o token de
                novo toda semana treina a secretaria a colar o token em qualquer
                tela que peca.
    Secure      so fora de localhost — em https ele e obrigatorio, e em
                desenvolvimento (http://127.0.0.1) ele impediria o cookie de
                existir.
*/
export function cookieDeSessao(token: string, seguro: boolean): string {
  const partes = [
    `${NOME_DO_COOKIE}=${token}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    'Max-Age=31536000',
  ]
  if (seguro) partes.push('Secure')
  return partes.join('; ')
}

export function cookieApagado(seguro: boolean): string {
  const partes = [`${NOME_DO_COOKIE}=`, 'HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=0']
  if (seguro) partes.push('Secure')
  return partes.join('; ')
}

/** Um pedido em https merece o atributo Secure; localhost nao pode ter. */
export function ehSeguro(pedido: Request): boolean {
  return new URL(pedido.url).protocol === 'https:'
}

/*
  Transforma um dispositivo guardado numa sessao — ou em nada.

  FAIL-CLOSED, e a assimetria antiga morre aqui. Antes, papel invalido nao
  conectava mas TURMA invalida conectava e virava sessao cega: a professora
  entrava, nao via crianca nenhuma, e nao havia erro em lugar nenhum — ela
  concluia que ninguem tinha chegado. Agora turma que nao existe recusa a
  conexao, com erro visivel, do mesmo jeito que papel.
*/
/*
  Comparacao de tempo constante, para o segredo de administracao.

  `a !== b` para em cima do primeiro caractere diferente. Quem mede o tempo das
  respostas descobre o segredo caractere a caractere, em vez de precisar
  adivinha-lo inteiro — e um Worker responde rapido o bastante para o sinal
  existir.

  E hipotese remota num app de escola. Tambem sao seis linhas, e a alternativa e
  deixar escrito no codigo que a gente sabia e achou improvavel.
*/
export function iguaisEmTempoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diferenca = 0
  for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diferenca === 0
}

export function sessaoDe(dispositivo: Dispositivo | null): Sessao | null {
  if (!dispositivo) return null
  if (dispositivo.revogadoEm !== null) return null
  if (!ehPapel(dispositivo.papel)) return null

  if (dispositivo.papel === 'sala') {
    const turma = dispositivo.turma
    if (!turma || !(TURMAS as readonly string[]).includes(turma)) return null
    return { papel: 'sala', turma, apelido: dispositivo.apelido }
  }

  return { papel: 'portaria', apelido: dispositivo.apelido }
}
