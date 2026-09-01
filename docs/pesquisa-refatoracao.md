# docs/pesquisa-refatoracao.md — Pesquisa & Planejamento da Refatoração do "Portaria Janelinhas"

Data: 01/09/2026. Escopo: pesquisa e planejamento (NÃO implementar código). Fonte da verdade sobre o app atual: vitrine funcional de 01/09/2026 (prints reais). Onde a auditoria exigiria o app em execução, marca-se **"confirmar no app rodando"**. Toda afirmação vinda da internet vem com link e, quando relevante, data; alegações de fornecedores são sinalizadas como material comercial.

---

## 1. Sumário executivo — as 10 decisões mais importantes

1. **Persistir a trilha de auditoria ANTES da visita à escola (P0).** A promessa "registra tudo" hoje vale só por sessão. No modelo de Durable Objects (DO), reinício é rotina: a documentação da Cloudflare descreve que o objeto **hiberna após ~10 s de inatividade** (perdendo estado em memória) e é **evictado do host após ~70–140 s de inatividade**, além de deploys e crashes. As "Rules of Durable Objects" dizem, textualmente: *"In-memory state is not preserved if the Durable Object is evicted from memory due to inactivity, or if it crashes from an uncaught exception. Always persist important state to SQLite storage."* (developers.cloudflare.com/durable-objects). O storage SQLite já está provisionado e não usado; escrita append-only é barata. Sem isso, o único evento que o app existe para proteger evapora num reinício. **Valida a análise prévia do revisor (item 1): correta e é o P0 número um.**
2. **Trocar o par cromático verde/âmbar por estados que nunca dependem só de cor (P0).** É o caso clássico de falha para daltônicos — ~8% dos homens e ~0,5% das mulheres têm deficiência de visão de cor do tipo vermelho/verde (colourblindawareness.org) — e viola o WCAG 2.2 critério 1.4.1 "Use of Color". Sob deuteranopia/protanopia, verde e âmbar convergem para marrons/olivas semelhantes. Cada estado precisa de **cor + ícone + rótulo textual + forma/posição**, como fazem os KDS de cozinha com a metáfora de semáforo.
3. **Manter a privacidade por arquitetura e o modelo satélite Workers/DO (decisão do dono, validada por mérito).** Nenhum concorrente pesquisado tem "só o aluno chamado aparece na tela + filtro de turma nos dois sentidos" como princípio: a maioria expõe grades, filas ou fotos na TV. É diferencial real e deve sobreviver à refatoração intacto.
4. **Redesenhar a entrada da portaria para reduzir digitação no pico das 17h (P1).** Digitar nome no celular sob pressa é o gargalo central. Não copiar geofencing/placa cegamente (exigem app de pai e cadastro pesado); oferecer busca por iniciais/sobrenome, fila opcional de "chegando" e chamada agrupada de irmãos.
5. **Modelar "responsáveis autorizados por aluno" + "a quem foi entregue" (P1, depende da escola).** A pergunta fundadora ("quem entregou qual criança A QUEM") **não existe** no modelo atual (planilha só traz Nome e Turma). É o maior buraco funcional frente a Pikmykid, ClipEscola e Filho sem Fila. **Confirma a análise prévia (item 2).**
6. **Substituir "desfazer proibido" por evento compensatório append-only (P1).** "Depois de liberado não há volta" vai encontrar o dedo errado da professora numa tela de toque. A saída fiel à filosofia é registrar "retornou à sala (motivo)", não um undo. **Confirma a análise prévia (item 3).**
7. **Adotar direção visual "Pátio" (recomendada), com tipografia de personalidade e escala real (P1).** O "cara de protótipo de IA" é um padrão documentado, não impressão vaga (ver §4).
8. **Autenticação real amarrando a turma à identidade (P1/P2, pré-requisito de dados reais).** Hoje o papel vem da query string e qualquer um escolhe qualquer turma. Better Auth (planejado no ecossistema) é o alvo. **Confirma a análise prévia (item 4).**
9. **Som de notificação discreto e não-repetitivo, com base em evidência (P1).** ~250 ms–1 s, faixa média-alta ~600 Hz–2 kHz, acorde neutro, disparo só em evento genuíno. A lição do "alarm fatigue" é direta (ver §4). **Confirma a análise prévia (item 5).**
10. **Tratar LGPD como requisito de primeira ordem desde o modelo de dados (P0/P1).** Dados de criança sob art. 14 (melhor interesse; consentimento parental específico e em destaque), minimização, retenção limitada da trilha, papéis operador (dono) × controlador (escola).

---

## 2. Benchmark de produtos de saída escolar (Tarefa 1)

**Aviso de viés comercial:** as descrições de Pikmykid, CurbSmart, ClipEscola, Filho sem Fila, School Dismissal Manager (SDM), StudentDismiss e iDismiss vêm em grande parte do marketing dos próprios fornecedores. Números de desempenho ("dismissal em 25 min com 200 carros", "reduz fila em até 75%", "processo cai para ~5 min") são **alegações comerciais não auditadas de forma independente**.

### Como o responsável anuncia a chegada

- **Pikmykid (EUA, comercial):** app do pai faz "announce" na fila; para quem não tem app, gerador de *car tag* (placa impressa no painel) e código manual (Dismissal ID digitado pelo staff no Dispatcher App). Distingue "walkers" anunciados e não anunciados. Fonte: pikmykid.com/faq.
- **School Dismissal Manager / FastLane (EUA, comercial):** pais fazem "check in" pelo site mobile ao chegar à fila; o sistema mescla os dados do dia com os motoristas e exibe para sala e administração. Fonte: schooldismissalmanager.com/HowItWorks.
- **CurbSmart (EUA, comercial):** placa (hangtag) com número por domicílio; check-in pelo app do pai OU staff insere o número; a alternativa PLACA.AI usa **câmera de leitura de placa (LPR)** automática, exatamente para não depender de o pai abrir o app. Fontes: nutrilinktechnologies.com, placa.ai.
- **StudentDismiss (EUA, comercial):** deliberadamente **SEM app de pais** ("nada para empurrar às famílias; roda em dias, não semanas"); opcionalmente kiosk com PIN. Fonte: studentdismissapp.com.
- **Filho sem Fila (BR, comercial):** app do pai avisa **10–15 min antes**; sincroniza com GPS; escola vê fotos/documentos do responsável em tablet/TV/SmartTV; criado em Santo André-SP em 2014; presente em 180+ instituições e 50+ cidades (dados de imprensa 2019–2020: mobiletime.com.br, exame.com, diariodocomercio.com.br). Integra-se ao SophiA.
- **ClipEscola "Estou Chegando" (BR, comercial):** GPS do pai sincronizado; um colaborador espelha a tela numa TV mostrando **foto do aluno + foto do responsável + raio de distância** (o trajeto não aparece). Fonte: clipescola.com.
- **App de referência do g1/Goiânia (Priscila Martins):** portaria registra a chegada; o nome aparece nas **lousas digitais**; gestores acompanham por celular; **sem app de pais**; em uso desde maio de 2026 na Escola Municipal Izabel Esperidião Jorge, Alto da Glória I. Fontes: jornalopcao.com.br, expresso360.com.br, brasilemfolhas.com.br (ago/2026).

### Aviso à sala, confirmação de entrega e "a quem"

- **Pikmykid:** staff faz *swipe* do nome no iPad → notifica os pais de que a criança foi dispensada e **gera registro auditável**; gerencia delegação de pickup ("amigo busca hoje") e casos de guarda/custódia. Fonte: pikmykid.com/press.
- **CurbSmart:** "Way Home Report" por professor; libera para adulto aprovado; modos ônibus/carro/contraturno. Fonte: nutrilinktechnologies.com.
- **ClipEscola:** autorização a terceiros (temporária/permanente) com **nome, CPF, foto e grau de parentesco**; pais removem autorização quando quiserem; carteirinha digital com QR. Fonte: clipescola.com.
- **Filho sem Fila:** gestão de autorizações de saída temporárias/permanentes 100% digital. Fonte: filhosemfila.com.br.
- **StudentDismiss / iDismiss:** dismissal silencioso e visual; **só a sala do aluno é notificada** ("low-key: only the student's classroom gets notified"); nome "acende" com a localização. Fonte: studentdismissapp.com.

### Preços (em USD; conversão a BRL não fixada aqui)

- **SDM:** US$500 de setup anual/escola + US$150/mês (schooldismissalmanager.com/termstrial.asp).
- **StudentDismiss:** US$399/ano por escola, sem contrato, sem taxa por aluno (studentdismissapp.com).
- **iDismiss:** US$299 por licença, sem limite de usuários (idismiss.org/features).
- **Pikmykid, CurbSmart, ClipEscola, Filho sem Fila, Agenda Edu:** preço público **não confirmado** (orçamento sob demanda). **Preços em BRL: não confirmado.**

### Tabela produto × capacidade

| Produto | Anúncio de chegada | Aviso à sala | Confirma "a quem" | Delegação/autorizados | Modos/portões | Relatórios |
|---|---|---|---|---|---|---|
| Pikmykid | app / placa / código | swipe no iPad | Sim (notifica + registro) | Sim (carpool, guarda) | Sim (ônibus/carro/contraturno) | Sim |
| SDM/FastLane | check-in web | lista/tela | Parcial | Sim (exceções pelos pais) | Sim | Sim |
| CurbSmart | placa / câmera LPR | Way Home Report | Sim (adulto aprovado) | Sim | Sim | Sim |
| StudentDismiss | sem app (opcional PIN) | tela silenciosa | Não central | Limitado | Parcial | Básico |
| Filho sem Fila | app + GPS (10–15 min) | TV com foto | foto/doc do responsável | Sim (temp/perm) | Parcial | Sim |
| ClipEscola | app + GPS | TV: foto aluno+resp | foto + CPF + parentesco | Sim (temp/perm) | Sim (módulos) | Sim |
| Ref. g1 (Goiânia) | portaria registra | lousa digital | Não | Não | Não | acompanhamento por celular |
| **Janelinhas (hoje)** | portaria digita nome | faixa + som + cartão **só da turma** | **Não (só o operador)** | **Não existe** | **Não** | trilha (**só por sessão**) |

### O que os melhores têm e o Janelinhas não — vale copiar?

1. **Responsáveis autorizados por aluno + parentesco/foto** (Pikmykid, ClipEscola, Filho sem Fila). **VALE COPIAR (versão enxuta):** resolve a pergunta fundadora "a quem". Para escola pequena: começar por nome + vínculo + telefone; foto opcional; **sem GPS**.
2. **Delegação "hoje a avó busca"** (Pikmykid, ClipEscola). **VALE COPIAR depois:** cobre imprevistos reais; exige portal de pais — encaixa quando o portal do ecossistema existir.
3. **Registro de guarda judicial/restrição** (CurbSmart; e obrigatório em normas BR — a Portaria SME nº 74/2026 de Ilhabela exige seguir decisões judiciais de guarda; portalr3.com.br, ago/2026). **VALE COPIAR:** campo "restrição / não entregar a X" com alerta visível na portaria; risco jurídico alto.
4. **Check-in por GPS/geofencing** (ClipEscola, Filho sem Fila). **NÃO COPIAR para esta escola:** depende de todo pai com smartphone/dados, GPS e wifi confiáveis e cadastro pesado — contraria "orçamento apertado" e a objeção nº 1 ("dá trabalho cadastrar todo mundo"). "Portaria digita" é mais robusto sob wifi ruim.
5. **Leitura de placa por câmera LPR** (PLACA.AI/CurbSmart). **NÃO COPIAR:** custo de hardware incompatível.
6. **Modos ônibus/carpool** (Pikmykid, CurbSmart). **NÃO COPIAR:** irrelevantes para o perfil; **contraturno** só se a escola tiver.
7. **App de pais para mudanças de dismissal** (SDM). **ADIAR:** o próprio StudentDismiss trata "sem app de pais" como *feature*; para escola pequena, o custo de adoção por família é alto — coerente com manter a portaria como ponto de controle.

---

## 3. Auditoria de usabilidade do fluxo atual (Tarefa 2)

Referências: 10 heurísticas de Nielsen (NN/g, nngroup.com/articles/ten-usability-heuristics); Laws of UX (lawsofux.com); WCAG 2.2 (w3.org/TR/WCAG22), critério **2.5.8 Target Size** (mínimo 24×24 px CSS no nível AA; **44×44 recomendado**), **1.4.1 Use of Color**, **1.4.3** contraste 4.5:1 (texto) e **1.4.11** 3:1 (não-texto). O Doherty Threshold (~400 ms) vem de Doherty & Thadani (IBM, 1982), resumido em lawsofux.com/doherty-threshold.

1. **Estados dependem de cor (verde/âmbar) — falha WCAG 1.4.1.** Evidência: pills âmbar "responsável chegou" / verde "liberado", faixa âmbar, borda verde no cartão liberado. Sob deuteranopia/protanopia (~8% dos homens; colourblindawareness.org) os dois viram marrons/olivas semelhantes (lyssna.com, cssawwwards.com/blog/color-blindness-accessible-design-guide-2026). **Proposta:** cada estado = cor + ícone distinto + rótulo textual + posição/forma. *Confirmar contraste real no app rodando.*
2. **Digitar nome no celular no pico das 17h — atrito de entrada** (Nielsen: flexibilidade/eficiência; Doherty <400 ms). Evidência: busca "CHAMAR ALUNO" digitada. Com muitos responsáveis juntos, digitar vira gargalo. **Proposta:** busca por iniciais/sobrenome; fila opcional de "chegando"; feedback visível **<400 ms** ao tocar "Chamar". *Medir latência: confirmar no app rodando.*
3. **Escolher a turma manualmente a cada entrada na sala** (Nielsen: recognition rather than recall; error prevention). Evidência: "a professora escolhe a dela ao entrar" num seletor por segmento. Errar a turma dá tela vazia e é fricção diária. **Proposta:** amarrar turma à identidade autenticada; enquanto não há login, lembrar a última turma no dispositivo.
4. **Lista "EM SAÍDA" única não escala visualmente** (Nielsen: visibility of system status; Lei de Hick). Evidência: lista única embaixo na portaria. **Proposta:** agrupar por estado (chamado/liberado), ordenar por tempo de espera, badge de contagem. *Confirmar com volume real no app rodando.*
5. **Homônimos e desambiguação** (Nielsen: error prevention; help users recognize). Evidência: o "corte de resultados em silêncio com homônimas" já foi furo fechado, mas distinguir duas "Maria Silva" ainda depende de turma/avatar. **Proposta:** mostrar turma + marca desambiguadora em cada resultado.
6. **Chamou o aluno errado (portaria) — recuperável, correto** (Nielsen: user control). Evidência: "Cancelar" enquanto chamado. **Manter:** é o único caminho reverso e está bem modelado.
7. **Dedo errado da professora — liberou errado, SEM volta** (Nielsen: user control and freedom; error prevention). Evidência: "depois de liberado não há volta". Numa TV/tela de toque, erro é inevitável. **Proposta:** evento compensatório append-only "retornou à sala (motivo)" — preserva a trilha sem mentir. **Não é undo.**
8. **Criança que não pode sair com determinada pessoa (guarda/restrição) — modelo não suporta.** Evidência: modelo só tem Nome+Turma. Risco jurídico alto (contratos escolares BR; Portaria SME 74/2026 de Ilhabela). **Proposta:** campo de restrição + alerta bloqueante na portaria. Depende da escola.
9. **Irmãos em turmas diferentes — hoje duas chamadas separadas.** Evidência: chamada por aluno; turmas distintas = duas salas avisadas em ações separadas. **Proposta:** agrupar irmãos por responsável numa única ação que dispara as duas salas. *Confirmar no app rodando.*
10. **Atraso de responsável / contraturno — sem estado.** **Proposta:** não criar estado novo agora; a ordenação por tempo de espera já sinaliza atraso. Contraturno só se a escola usar.
11. **Alvo de toque e legibilidade a 2 m** (WCAG 2.5.8; Lei de Fitts). Evidência: botões "Chamar"/"Liberar saída"/"Entregar". Portaria no polegar sob sol e sala vista a metros exigem alvos **≥44×44 px** e tipografia grande na sala. **Proposta:** botões primários altos e de alto contraste; tela da sala em modo "painel". *Medir tamanhos reais: confirmar no app rodando.*
12. **Áudio antes do gesto do usuário / reload no meio do turno** (robustez; visibility). Evidência: clique em "Entrar na sala" destrava o áudio. **Proposta:** re-verificar o destravamento após reload e adicionar **wake lock** (TV/tablet dorme e a chamada com som chega a tela apagada). *Confirmar no app rodando.*
13. **Ambiente barulhento e leitor de tela.** **Proposta:** alerta visual sempre redundante ao som; testar com leitor de tela. *Confirmar no app rodando.*

---

## 4. Direções de design + recomendação + tokens (Tarefa 3)

### Por que o design atual parece "protótipo de IA genérico"

Não é impressão vaga; é um padrão nomeado — **"AI design slop"**. A saída média de ferramentas de IA converge para: sans genérica (Inter/Roboto), **cartões brancos arredondados com sombra suave**, **"status pills"**, borda cinza de 1px, espaçamento uniforme sem hierarquia e paleta "segura" (superdesign.dev/blog/why-ai-design-looks-generic; smoothui.dev/blog/ai-design-slop; vibecodekit.dev/ai-slop-design; 925studios.co, 2026). A causa é estatística: um modelo prevê o token mais provável, e a média de "UI moderna" é exatamente esse visual.

**Diagnóstico específico do Janelinhas** (o "exatamente por quê" que o dono pediu): (a) **tipografia** sans de sistema sem escala expressiva — títulos, nomes e rótulos no mesmo peso/tamanho aparente, sem hierarquia; (b) **cor** verde/âmbar como decisão "default", sem papel semântico rígido nem redundância; (c) **componentes** = cartões brancos + pills, o clichê exato da lista de "tells"; (d) **espaçamento/hierarquia** uniforme, com rodapés cinzas minúsculos e sem foco claro na ação primária. O que profissionais fazem diferente: escala tipográfica real com fonte de personalidade, cor com papel semântico consistente, densidade deliberada por contexto e microdetalhes.

### Três direções distintas e nomeadas

**Direção A — "Pátio" (institucional quente, brasileiro; RECOMENDADA).**
Paleta (hex): verde-mata `#14532D` (identidade), creme papel `#FBF7EF` (fundo, **não branco puro**), terracota `#C2410C` (atenção "responsável chegou"), verde-folha `#15803D` (liberado), azul-lousa `#1D4ED8` (info/entregue), grafite `#1C1917` (texto). Tipografia (Google Fonts, gratuitas): títulos em **Fraunces** (fonts.google.com/specimen/Fraunces — serif com personalidade), corpo/rótulos em **Inter Tight** ou **Instrument Sans**. **Cartão do aluno:** fundo creme, **faixa lateral colorida grossa** por estado (redundância cor+posição), nome em serif grande, ícone de estado + rótulo textual. **Faixa:** barra terracota com ícone de sino e "2 responsáveis chegaram". **Portaria:** creme, botões terracota altos, busca dominante no topo. Referências: paletas quentes premiadas (awwwards.com), metáfora de semáforo de KDS.

**Direção B — "Painel" (KDS/aeroporto FIDS, alto contraste para relance).**
Paleta: fundo grafite `#0F172A`, cartão `#1E293B`, âmbar-sinal `#F59E0B` (nunca sozinho), verde-sinal `#22C55E`, vermelho-retorno `#EF4444`, texto `#F8FAFC`. Tipografia: **IBM Plex Sans** + números tabulares. **Cartão:** estilo "ticket" de cozinha com **timer de espera grande** e borda-topo colorida + ícone — inspirado nos KDS, onde a cor muda como semáforo ("verde = começar, amarelo = priorizar, vermelho = passou do tempo"; backofhouse.io, trycake.com). Melhor para a **TV da sala vista a metros**; pode ser duro no celular sob sol (*não confirmado — testar*).

**Direção C — "Caderno" (educação infantil, lúdico sóbrio).**
Paleta: off-white `#FFFDF7`, azul-caderno `#2563EB`, coral `#F97316`, verde-giz `#16A34A`, marrom-madeira `#78350F` (texto). Tipografia: **Baloo 2** (arredondada com caráter) em títulos + **Nunito Sans** no corpo. **Risco:** pode reforçar o clichê "arredondado" se mal executado; exige disciplina de escala e densidade.

### Recomendação justificada

**Direção A "Pátio".** Motivos amarrados a ESTE app/escola/usuários: (1) foge do clichê de IA (serif com personalidade + creme, não branco puro + sans de sistema); (2) o **creme reduz o brilho** de tela branca sob sol no celular da portaria e mantém legibilidade a metros na sala; (3) cor com **papel semântico rígido e sempre redundante** (cor+ícone+rótulo+posição) resolve o WCAG 1.4.1; (4) identidade institucional brasileira quente combina com escola pequena/afetiva melhor que o tema técnico escuro. A **Direção B fica como variante da tela da sala** (modo painel de alto contraste para leitura a distância), reaproveitando os mesmos tokens semânticos.

### Tokens concretos (substituem o tokens.css) — variáveis CSS

```css
:root {
  /* Cor — papel semântico */
  --cor-marca: #14532D;            /* verde-mata: cabeçalho, identidade */
  --cor-fundo: #FBF7EF;            /* creme papel: fundo geral (não branco puro) */
  --cor-superficie: #FFFFFF;       /* cartão */
  --cor-superficie-2: #F3EEE2;     /* cartão secundário/recolhido */
  --cor-texto: #1C1917;            /* grafite */
  --cor-texto-suave: #57534E;      /* rótulos secundários */

  --estado-aguardando: #78716C;    /* neutro cinza-pedra + ícone relógio */
  --estado-chamado:    #C2410C;    /* terracota "responsável chegou" + ícone sino */
  --estado-liberado:   #15803D;    /* verde-folha "liberado" + ícone check */
  --estado-entregue:   #1D4ED8;    /* azul "entregue" (terminal, trilha) + ícone porta */
  --estado-retorno:    #B91C1C;    /* evento compensatório "retornou" + ícone voltar */

  --contraste-min-texto: 4.5;      /* WCAG 1.4.3 */
  --contraste-min-nao-texto: 3.0;  /* WCAG 1.4.11 */

  /* Tipografia — escala real (base 16px, razão ~1.25) */
  --fonte-titulo: "Fraunces", Georgia, serif;
  --fonte-corpo: "Inter Tight", system-ui, sans-serif;
  --fs-display: 3.05rem; --lh-display: 1.05; --fw-display: 600; /* nome na TV da sala */
  --fs-h1: 2.44rem;      --lh-h1: 1.10;  --fw-h1: 600;
  --fs-h2: 1.95rem;      --lh-h2: 1.15;  --fw-h2: 600;
  --fs-h3: 1.56rem;      --lh-h3: 1.20;  --fw-h3: 500;
  --fs-corpo: 1.25rem;   --lh-corpo: 1.40; --fw-corpo: 400; /* portaria confortável ao polegar */
  --fs-rotulo: 1rem;     --lh-rotulo: 1.30; --fw-rotulo: 600; /* etiquetas de estado */
  --fs-nota: 0.875rem;   --lh-nota: 1.30; --fw-nota: 400;

  /* Espaçamento — escala 4/8pt */
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px;
  --sp-5: 24px; --sp-6: 32px; --sp-7: 48px; --sp-8: 64px;

  /* Raio */
  --raio-sm: 6px; --raio-md: 12px; --raio-lg: 20px; --raio-pill: 999px;

  /* Sombra — discreta (evita o "card flutuante de IA") */
  --sombra-1: 0 1px 2px rgba(28,25,23,.06);
  --sombra-2: 0 2px 8px rgba(28,25,23,.10);

  /* Alvo de toque (WCAG 2.5.8 / 2.5.5) */
  --toque-min: 44px; --toque-conforto: 56px;

  /* Motion */
  --dur-rapida: 120ms; --dur-media: 240ms; --dur-entrada: 320ms;
  --easing-padrao: cubic-bezier(.2,0,0,1);
  --easing-entrada: cubic-bezier(.05,.7,.1,1);
}
```
Referência de escala/pesos: Material Design 3 organiza a tipografia em papéis (display/headline/title/body/label) com tamanhos/pesos/line-height definidos — usado aqui como base para uma escala com hierarquia real (m3.material.io; developer.android.com/develop/ui/compose/designsystems/material3).

### Som da notificação da sala (base de evidência)

Parâmetros recomendados para o "ding" de chegada: **duração ~250 ms (teto 1 s)**, faixa **média-alta ~600 Hz–2 kHz** evitando graves (que "viajam mais longe, são difíceis de localizar e podem ser alarmantes" — guideline de som da Microsoft UX, learn.microsoft.com/windows/win32/uxguide/vis-sound), **acorde neutro** (1ª+5ª, nem maior nem menor), timbre suave (mallet/sino), volume moderado, **disparo só em evento genuíno e sem repetição**, com controle de mudo/volume. Shopify Polaris recomenda "sons curtos ≤250 ms; longos ≤1 s" e usa o exemplo análogo de "cliente chegou à loja" como informativo, não urgente (polaris-react.shopify.com/design/sounds). Edworthy et al. (Human Factors, 1991) e Haas & Edworthy (1996) mostram que **tempo, pitch e volume moderados = menor urgência percebida** — o inverso do som de alarme.

**Lição do "alarm fatigue" (por que não abusar do som):** a Joint Commission (Sentinel Event Alert 50, 08/04/2013) afirma, textualmente, *"It is estimated that between 85 and 99 percent of alarm signals do not require clinical intervention"*, e registrou 98 eventos ligados a alarmes entre jan/2009 e jun/2012 (80 com morte) — a dessensibilização leva profissionais a **baixar volume, desligar ou ignorar** (jointcommission.org). A revisão da AHRQ "Making Healthcare Safer III" (2020) confirma: *"the percentage of false alarms can range from 72 percent to 99 percent"* (ncbi.nlm.nih.gov/books/NBK555522). Tradução direta para o app: **cada som deve corresponder a um evento real (responsável chegou de fato), ou a professora vai silenciar o áudio** — e aí o sistema perde a função.

---

## 5. Implicações técnicas (Tarefa 4) — o que a base aguenta e o que muda

- **Persistência (a base aguenta; falta ligar):** SQLite-backed Durable Objects estão em disponibilidade geral (inclusive no plano Free, com limites) e o storage do DO já está provisionado e **não usado hoje**. Persistir trilha e cadastro em escrita append-only no próprio DO; usar a Alarms API para rotação/limpeza. **Atenção comercial:** a cobrança de storage SQLite passou a valer em **jan/2026** (target 07/01/2026) — monitorar uso. Fonte: developers.cloudflare.com/durable-objects (changelog, docs, release-notes).
- **Reinício/hibernação (muda a promessa "registra tudo"):** hiberna após ~10 s de inatividade (perde memória), evicção após ~70–140 s, além de deploy/crash; *"Always persist important state to SQLite storage"* ("Rules of Durable Objects"). Por isso o item 1 é **P0**.
- **Autenticação real (satélite; alvo Better Auth):** hoje o papel vem da query string — inaceitável para dados reais. Enquanto Better Auth não integra, usar **tokens por dispositivo/sala** emitidos pela escola. O papel fail-closed já existe e sobrevive; amarrar a turma à identidade.
- **PWA/push para responsáveis (limitação real do iOS):** Web Push em PWA no iOS funciona **só se o app for instalado na tela inicial** (desde iOS 16.4), com relatos persistentes de "assinatura que desaparece" ainda no iOS 18 e entrega menos confiável que Android/nativo (brainhub.eu, mobiloud.com/blog/progressive-web-apps-ios, magicbell.com, webscraft.org — 2025/2026). App nativo tem custo alto para orçamento apertado. **Recomendação: NÃO depender de push agora**; a portaria segue como ponto de controle. Push só quando o portal de pais existir, com fallback (feed in-app/e-mail).
- **Retrato completo vs deltas sob wifi ruim (manter retrato):** transmitir o estado completo é acertado para reconexão após queda de wifi — decisão de robustez validada ("mentir sobre qual aluno pode sair é o pior defeito"). Cuidar do peso da página (front HTML/CSS/JS puro ajuda) e da reconexão automática. *Confirmar peso/latência no app rodando.*
- **LGPD (primeira ordem):** dados de criança sob **art. 14** (tratamento no melhor interesse; §1º exige consentimento parental **específico e em destaque**) — planalto/Lei 13.709; guia do MPCE; interpretação da ANPD (conjur.com.br, lefosse.com). Definir papéis: **escola = controladora; dono do app = operador**. Minimização (Nome+Turma hoje é bom princípio de minimização), retenção limitada da trilha, direito de acesso/eliminação. Foto do aluno e responsáveis autorizados só entram **após** consentimento e base legal. Manter "nenhum dado real no repositório".
- **Privacidade por arquitetura (inegociável — sobrevive):** os 6 princípios continuam; a mudança de cor e o novo modelo de "a quem" devem ser desenhados **sem** violar "só o aluno chamado na tela" e "filtro de turma nos dois sentidos, leitura E escrita".

---

## 6. Backlog único priorizado (impacto × esforço)

**P0 — antes da visita à escola / integridade**
1. **Persistir trilha + cadastro no storage do DO (append-only).** Aceite: após `wrangler deploy` e após hibernação/evicção forçada, a trilha do dia continua íntegra e consultável; teste automatizado que reinicia o DO e verifica a persistência.
2. **Estados nunca dependem só de cor** (cor+ícone+rótulo+posição). Aceite: cada estado é distinguível em simulação de deuteranopia/protanopia sem a cor; contraste ≥4.5:1 (texto) e ≥3:1 (não-texto), verificado por ferramenta.
3. **Alvos de toque ≥44×44 px nas ações primárias.** Aceite: auditoria WCAG 2.5.8 sem violações nas telas de portaria e sala.
4. **Base LGPD documentada** (papéis operador/controlador, base legal, retenção) antes de qualquer dado real. Aceite: documento aprovado pela escola; nenhum dado real no repositório.

**P1 — fluxo e produto**
5. **Evento compensatório "retornou à sala (motivo)".** Aceite: transição liberado→retornou gera linha na trilha; nenhuma remoção; teste de regressão.
6. **Modelo "responsáveis autorizados por aluno" + "entregue a quem".** Aceite: importação/portal aceita responsáveis; "Entregar" exige escolher o responsável; a trilha grava o adulto. Depende da escola.
7. **Campo de restrição/guarda + alerta bloqueante na portaria.** Aceite: aluno com restrição mostra alerta antes de liberar/entregar. Depende da escola.
8. **Busca da portaria redesenhada** (iniciais/sobrenome; feedback <400 ms). Aceite: chamar aluno em ≤2 toques após achá-lo; feedback visual <400 ms.
9. **Chamada agrupada de irmãos.** Aceite: uma ação chama irmãos em turmas distintas, avisando cada sala.
10. **Direção visual "Pátio" + tokens novos; variante "Painel" para a sala.** Aceite: tokens.css substituído; telas revisadas contra o checklist anti-slop.
11. **Wake lock na sala + re-teste do destravamento de áudio após reload.** Aceite: a TV não dorme durante o turno; o áudio funciona após reload. *Confirmar no app rodando.*
12. **Som novo conforme os parâmetros de evidência + controle de mudo/volume.** Aceite: som ≤1 s, faixa média-alta, disparo só em evento; toggle de mudo.

**P2 — depende do ecossistema**
13. **Autenticação real (Better Auth) amarrando turma à identidade.** Aceite: papel/turma vêm da sessão autenticada, não da query string.
14. **Cadastro por API substituindo a planilha; convergência da trilha com o padrão LogAuditoria do backend.** Aceite: importação por API funcional; trilha exportável no formato do backend.
15. **Delegação "hoje a avó busca" via portal de pais.** Aceite: autorização temporária aparece na portaria no dia.
16. **Tetos de tamanho em importação e trilha (rotação).** Aceite: limites definidos e testados.

---

## 7. Plano de refatoração em fases

**Fase 0 — Integridade (P0).** *Entrega:* trilha/cadastro persistentes; estados acessíveis (cor+ícone+rótulo+posição); alvos de toque; base LGPD escrita. *Reescrito:* camada de storage do DO (hoje vazia); tokens de cor. *Reaproveitado (por mérito):* máquina de estados pura (`estados.ts`), `livro.ts`, protocolo de **retrato completo**, e os 6 princípios de privacidade por arquitetura — são o núcleo correto e testado (113 testes de unidade, 30 verificações fim-a-fim). *Depende do dono:* parâmetros de retenção LGPD.

**Fase 1 — Fluxo humano (P1).** *Entrega:* evento compensatório; busca redesenhada; irmãos agrupados; direção "Pátio"; wake lock + som novo. *Reescrito:* front das telas de portaria e sala (visual e interação), `som.js`. *Reaproveitado:* `busca.ts` (normalização de nome brasileiro — resolve Sant'Ana/D'Ávila com apóstrofos reto e tipográfico; mérito comprovado), `importar.ts` (analisador robusto a CSV com aspas, ANSI, duplicatas). *Depende do dono:* nomes exatos das turmas; se restrição/guarda entra já aqui.

**Fase 2 — "A quem" e identidade (P1/P2).** *Entrega:* responsáveis autorizados + "entregue a quem" + restrição/guarda; autenticação real amarrando turma. *Reescrito:* modelo de dados (cadastro), fluxo de "Entregar" (passa a exigir o responsável). *Reaproveitado:* máquina de estados (estendida com o responsável no evento `entregue`). *Depende do dono:* consentimento LGPD por responsável, foto do aluno, integração Better Auth.

**Fase 3 — Ecossistema (P2), contínuo.** *Entrega:* cadastro por API (substitui a planilha), convergência da trilha com LogAuditoria, delegação via portal de pais, push com fallback. *Reaproveitado:* o serviço satélite Workers/DO inteiro — decisão do dono mantida por mérito (tempo real no modelo de ator, fora do núcleo NestJS/PostgreSQL). *Depende do dono:* cronograma do portal de pais e do backend.

**Regra final:** nada vira código antes da aprovação do dono. Itens marcados **"confirmar no app rodando"** exigem verificação com o app em execução: latência real de resposta, tamanhos reais de alvo de toque, teste com leitor de tela, comportamento de áudio após reload e escala da lista "EM SAÍDA" sob volume real de responsáveis.

---

### Nota de método e limitações
Esta pesquisa não pôde executar o app (repositório indisponível no ambiente); todas as afirmações sobre o estado atual são rastreáveis à vitrine funcional de 01/09/2026, e os pontos que exigiriam o app rodando estão explicitamente marcados. As fontes de fornecedores foram sinalizadas como material comercial. Onde não houve confirmação (preços em BRL, brilho do tema escuro sob sol, latências), registrou-se **"não confirmado"** em vez de estimar. A pesquisa de referência (app da Escola Municipal Izabel Esperidião Jorge, Priscila Martins, Goiânia) foi confirmada em jornalopcao.com.br, expresso360.com.br e brasilemfolhas.com.br (ago/2026).