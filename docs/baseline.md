# Baseline — o "antes" da refatoração

Medido em 01/09/2026, commit `bedc0ed`, branch `refatoracao-v2`.
Instância única e limpa (`.wrangler/state` removido antes), wrangler 4.128.0.

Este é o documento contra o qual os critérios de aceite das fases serão medidos.
Números crus em `baseline.json`; prints em `prints/antes/`.

---

## Os três portões

Rodados **crus**, com o código de saída lido diretamente — não canalizados para `head`
ou `grep`, que foi como o typecheck passou meses quebrado sem ninguém ver.

| Portão | Resultado | Código de saída |
|---|---|---|
| `npm test` | 113 testes, 0 falhas | **0** |
| `npm run typecheck` | 0 erros de tipo | **0** |
| `npm run fim-a-fim` | 30 verificações | **0** |

---

## Latência — o limiar de Doherty não é o problema

| Medida | Valor |
|---|---|
| Servidor: `chamar` enviado → retrato chegando na sala (mediana de 10) | **4,4 ms** |
| Servidor: pior caso das 10 amostras | 5,6 ms |
| Servidor: melhor caso | 3,8 ms |
| Fim a fim: comando saindo da portaria → cartão no DOM da sala | **9 ms** |

O limiar de Doherty é 400 ms. Estamos **44× abaixo** dele. A pesquisa listou "medir
latência" como pendência de risco; a medição fecha o assunto: não há nada a otimizar aqui,
e qualquer trabalho nessa direção seria desperdício.

Ressalva honesta: medido em `localhost`, com o Durable Object quente e um único cliente.
Sob o wifi da escola, com ngrok no caminho, o número será outro — mas o custo do servidor
é ~4 ms, então o que sobrar é rede, não aplicação.

---

## Peso transferido — primeiro carregamento da portaria

**8 requisições, 11.988 bytes (11,7 KiB) transferidos**, com cache desabilitado.

| Recurso | Tipo | Bytes |
|---|---|---|
| `/portaria/` | documento | 3.548 |
| `/comum/tokens.css` | folha de estilo | 2.606 |
| `/comum/avatar.js` | script | 1.628 |
| `/comum/cartao.js` | script | 1.168 |
| `/comum/ligacao.js` | script | 1.147 |
| `/comum/busca.js` | script | 849 |
| `/alunos?papel=portaria` | dados (44 alunos) | 870 |
| `/favicon.ico` | — | 172 |

Zero imagens, zero fontes, zero terceiros, zero framework. Os retratos são SVG gerado em
tempo de execução; o som é sintetizado.

**Consequência para o orçamento:** a pesquisa sugeriu um teto de 250 KB. Isso é **21×** o
peso atual — autorizaria uma regressão enorme sem disparar nenhum alarme. O plano adota
**≤ 120 KB**, que ainda deixa folga de 10× para as duas fontes woff2 da Fase 1.

**Achado lateral:** `/favicon.ico` é requisitado e não existe. 172 bytes de resposta de
erro em todo primeiro carregamento.

---

## Alvos de toque — medidos no DOM real

Confirmam o cálculo estático (40,08px) com precisão: **40,1px**.

| Controle | Tela | Largura × altura | 44px? |
|---|---|---|---|
| Campo de busca | portaria | 393,2 × **46,8** | passa |
| **Chamar** | portaria | 82,4 × **40,1** | **reprova** |
| **Importar** | portaria | 90,1 × **40,1** | **reprova** |
| **Abrir importação** (`summary`) | portaria | 359,2 × **18,7** | **reprova o mínimo AA** |
| **Liberar saída** | sala | 171 × **40,1** | **reprova** |
| **Mudo** | sala | 106,6 × **40,1** | **reprova** |

O `summary` de 18,7px é o pior caso e é **pior do que a análise estática previa**: fica
abaixo até dos 24px do WCAG 2.5.8 nível AA, não só dos 44px do 2.5.5 nível AAA que o
projeto adota como padrão.

A `.linha` da lista mede ~68px de altura e *parece* generosa, mas o alvo tocável dentro
dela tem 40,1px e fica encostado na margem direita.

---

## Contraste — cinco pares reprovam

Calculado pela fórmula do WCAG 2.2 sobre os tokens declarados em `web/comum/tokens.css`.

| Par | Razão | Mínimo | Veredito |
|---|---|---|---|
| **Botão desabilitado "Aguardando no portão"** | **2,12** | 4,5 | **reprova** |
| `--tinta-fraca` sobre o fundo da página | 3,54 | 4,5 | **reprova** |
| `--tinta-fraca` sobre o cartão | 3,85 | 4,5 | **reprova** |
| Borda do cartão `chamado` sobre o cartão | 1,43 | 3,0 | **reprova** |
| Borda do cartão `liberado` sobre o cartão | 1,48 | 3,0 | **reprova** |
| Borda padrão sobre o cartão | 1,29 | 3,0 | **reprova** |
| Etiqueta `chamado` | 5,72 | 4,5 | passa |
| Etiqueta `liberado` | 7,74 | 4,5 | passa |
| Faixa de aviso da sala | 5,72 | 4,5 | passa |
| Botão principal (branco sobre verde) | 6,55 | 4,5 | passa |
| Subtítulo do cabeçalho (opacidade 0,82) | 4,97 | 4,5 | passa |
| Etiqueta neutra "já em saída" | 6,57 | 4,5 | passa |
| Faixa de erro da portaria | 6,03 | 4,5 | passa |

O pior é o mais grave: `opacity: 0.45` aplicada ao elemento inteiro compõe **tanto o texto
quanto o fundo verde** contra a página, e o resultado é 2,12:1 — menos da metade do
exigido. É justamente o estado que confirma à professora que ela já fez a sua parte.

`--tinta-fraca` carrega a turma no cartão, o detalhe na linha, o rodapé de rede e o aviso
de truncamento da busca.

---

## Daltonismo — a pesquisa exagerou o risco

Simulação de dicromacia (matrizes de Viénot, Brettel & Mollon, 1999) sobre as cores reais.
Distância RGB entre os dois estados; 0 significa indistinguível.

| Elemento | Visão normal | Deuteranopia | Protanopia |
|---|---|---|---|
| Textos das etiquetas | 136 | **70** | 46 |
| Bordas dos cartões | 67 | 42 | 38 |
| Fundos das etiquetas | 28 | 16 | 12 |

Verde e âmbar **reduzem** a separação sob dicromacia, mas não colapsam. Somando que
`chamado` e `liberado` já trazem rótulo textual — e o W3C diz que texto sozinho satisfaz o
critério 1.4.1 — **não há violação de 1.4.1 nesses dois estados**.

Há para **`aguardando`**: o rótulo é string vazia e a etiqueta fica `hidden`. O estado é
comunicado por ausência.

O trabalho de acessibilidade da Fase 0 continua justificado, mas pelo motivo certo:
**contraste e alvo de toque**, mais o rótulo faltante — não por indistinguibilidade de cor.

---

## A lista "EM SAÍDA" com 15 chamados

| Medida | Valor |
|---|---|
| Linhas renderizadas | 15 |
| Altura da lista | **1.372 px** |
| Altura da janela (430×880, celular) | 880 px |
| Rolagens necessárias | **1,56 telas** |
| Agrupamento por estado | **não existe** |
| Badge de contagem | **não existe** |
| Timer de espera | **não existe** |

A tela que precisa gerenciar a fila é a única que não mostra o tamanho dela. O campo
`desde` existe no protocolo desde a correção do furo S2, é usado só como chave de
ordenação, e **nunca foi renderizado** — a porteira sabe a ordem, mas não sabe se o
primeiro espera há 40 segundos ou há 11 minutos.

---

## Áudio e tela

- **Destravamento após reload:** funciona, mas por acidente de arquitetura, não por
  detecção. A tela de entrada da sala está `hidden` e só o clique em "Entrar na sala" a
  revela — então após F5 a professora é obrigada a clicar de novo, e o clique passa por
  `destravar()`. Não há nenhuma verificação de `AudioContext.state` fora desse clique.
- **Falha silenciosa:** se o sistema suspender o contexto depois (aba em segundo plano,
  ligação, bloqueio de tela), `tocarAbertura()` executa normalmente e **não sai som, sem
  nenhum sinal na tela**. As guardas testam `!contexto`, nunca `contexto.state`.
- **Mudo não é lembrado.** Variável de módulo, reiniciada a cada carga. Nenhum uso de
  `localStorage` em todo o projeto.
- **Wake lock:** não existe. Nenhuma chamada a `navigator.wakeLock`. O tablet da sala apaga
  a tela pelo tempo do sistema e a chamada seguinte chega numa tela preta.

---

## Cobertura de teste — onde não há rede de proteção

| Camada | Cobertura |
|---|---|
| `estados.ts`, `livro.ts`, `busca.ts`, `importar.ts`, `semente.ts`, `espera.ts` | 113 testes de unidade |
| `portaria.ts` (o Durable Object) e `index.ts` | **zero testes de unidade** |
| Rota `/importar` | **zero verificações fim-a-fim** |

`portaria.ts` e `index.ts` não são testáveis pelo runner atual: Node não fornece
`WebSocketPair` nem `DurableObjectState`. Toda a camada de rede, roteamento, filtro de
papel e ciclo de vida do WebSocket existe apenas sob o `fim-a-fim.mjs`, que precisa do
servidor de pé. Os quatro códigos de erro de `/importar` (405, 403, 422, 409) nunca foram
exercitados contra o servidor.

É o que a tarefa 0.1 do plano resolve.

---

## O que esta baseline mudou no plano

1. **Latência sai da lista de riscos.** 4 ms de mediana. Nada a fazer.
2. **Orçamento de peso cai de 250 KB para 120 KB.** O teto proposto era 21× o real.
3. **O alvo de toque mais grave não era um botão**, e sim o `summary` de 18,7px, que
   reprova o nível AA e não só o AAA.
4. **A justificativa do trabalho de cor muda.** Não é "verde e âmbar são indistinguíveis";
   é "cinco pares reprovam contraste e `aguardando` não tem rótulo".
