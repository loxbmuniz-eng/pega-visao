---
name: Programação de Embarque Suinco
description: Painel de operação do embarque da Suinco — navy e dourado, dois temas, feito para quem opera ao vivo.
colors:
  navy-deep: "#101625"
  navy: "#1e2a52"
  navy-light: "#2a3a6c"
  navy-lighter: "#374a86"
  gold: "#e9b954"
  gold-dim: "#b9903f"
  gold-text-light: "#6b5008"
  wine: "#8f1f26"
  wine-light: "#b3363f"
  text: "#f2f4f8"
  text-dim: "#b7c0d4"
  paper-page: "#c6cfe0"
  paper: "#eff3f9"
  paper-raised: "#f6f9fc"
  ink: "#161a22"
  ink-dim: "#4b5565"
  graf-light: "#8a5f0e"
  status-aguardando-veiculo: "#c62828"
  status-aguardando-embarque: "#e07b1a"
  status-embarque-iniciado: "#f0c33c"
  status-embarque-finalizado: "#7fd4a2"
  status-faturado: "#34a862"
  status-seguiu-viagem: "#14603a"
  status-ink-dark: "#1a1200"
typography:
  display:
    fontFamily: "Barlow Condensed, Barlow, system-ui, sans-serif"
    fontSize: "34px"
    fontWeight: 700
    lineHeight: 1
  headline:
    fontFamily: "Barlow Condensed, Barlow, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
  title:
    fontFamily: "Barlow Condensed, Barlow, system-ui, sans-serif"
    fontSize: "16.5px"
    fontWeight: 600
  body:
    fontFamily: "Barlow, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.35
  label:
    fontFamily: "Barlow Condensed, Barlow, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
rounded:
  sm: "4px"
  md: "6px"
  lg: "10px"
  panel: "12px"
spacing:
  sp-1: "4px"
  sp-2: "8px"
  sp-3: "12px"
  sp-4: "16px"
  sp-5: "18px"
  sp-6: "26px"
components:
  button-primary:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.status-ink-dark}"
    rounded: "{rounded.sm}"
    padding: "7px 14px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "7px 14px"
  button-danger:
    backgroundColor: "{colors.wine}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
  nav-tab:
    textColor: "{colors.text-dim}"
    typography: "{typography.title}"
    height: "44px"
  nav-tab-active:
    textColor: "{colors.gold}"
    typography: "{typography.title}"
    height: "44px"
  stat-number:
    textColor: "{colors.gold}"
    typography: "{typography.display}"
  table-header:
    backgroundColor: "{colors.navy-light}"
    textColor: "{colors.gold}"
    typography: "{typography.label}"
    padding: "6px 5px"
  panel:
    backgroundColor: "{colors.navy}"
    textColor: "{colors.text}"
    rounded: "{rounded.panel}"
---

# Design System: Programação de Embarque Suinco

Registro da identidade visual **que já está no ar** (comando `document` da
`/impeccable`, 08/10/2026), medido na tela — vitrine do painel atual, os dois
temas, 1440, 1366, 1024 e 390 px. A fonte normativa continua sendo o código:
`entregaveis/suinco_logistica/styles.css` e a camada `tema2027/` por cima
dele. Os valores do cabeçalho são os do **tema escuro**; os do tema claro
estão nas cores `paper*`, `ink*`, `gold-text-light` e `graf-light`.

## Overview

**Creative North Star: "A Torre de Controle"**

O painel é a sala de onde se vê o pátio inteiro sem levantar da cadeira. As
duas telas que dão a cara dele são a **Torre de Controle** (todas as cargas em
aberto, com quem carimbou e quando) e o **Pátio ao vivo** (cada caminhão na sua
etapa, com o tempo que já passou e a previsão de saída). Tudo o mais segue a
mesma postura: calma, densa, sem enfeite, com o número da operação antes de
qualquer explicação.

Navy profundo é o chão; o dourado da marca aparece onde há significado — a aba
ativa, o número que importa, o botão principal —, e a estrutura (grade, fio,
contorno) fica num azul-acinzentado discreto. As seis cores de etapa do
caminhão são a única paleta viva e só dizem etapa. O tema claro é o mesmo
sistema em papel azulado, com o dourado escurecido para continuar legível.

Rápido por princípio: nada espera animação (teto de 180 ms), canto quase reto,
sombra mínima, profundidade por camada de tom e não por vidro — o vidro saiu
em 2027 porque custava processamento no tablet do pátio.

**Key Characteristics:**
- Navy e dourado; dourado é significado, não decoração.
- Barlow Condensed para títulos, navegação, números e cabeçalhos; Barlow no corpo.
- Seis cores de etapa, fixas, com três usos cada: preenchimento, texto sobre o preenchimento, e texto solto.
- Plano, em camadas de tom; canto de 4 a 12 px.
- Dois temas completos (escuro e claro), escolhidos pela preferência do aparelho até a primeira troca manual.
- Letra nunca abaixo de 12 px; contraste AA nos dois temas.

## Colors

Uma marca de duas cores (navy e dourado) sobre a qual vive uma escala de etapa
de seis cores, mais o vinho para perigo.

### Primary
- **Dourado Suinco** (gold): preenchimento do botão principal, véu da aba
  ativa, barra lateral da aba ativa, número em destaque e linha de cabeçalho
  de tabela no escuro. No tema claro, como COR DE TEXTO, vira o **Dourado
  Queimado** (gold-text-light), porque o dourado direto sobre papel não se lê.
- **Dourado de Gráfico** (`--graf-1`): barras e mapas de calor — o próprio
  dourado no escuro, o **Âmbar de Gráfico** (graf-light) no claro.

### Secondary
- **Vinho** (wine / wine-light): ação de perigo (Excluir, Cancelar) e o selo
  "frete a definir".

### Neutral
- **Noite do Pátio** (navy-deep): fundo da página no escuro e fundo de campo.
- **Navy Painel** (navy): superfície de painel e card no escuro.
- **Navy Cabeçalho** (navy-light) e **Navy Borda** (navy-lighter): cabeçalho
  de tabela e camadas acima do painel.
- **Giz** (text) e **Giz Apagado** (text-dim): texto principal e secundário no escuro.
- **Papel Azulado** (paper-page, paper, paper-raised): página, painel e
  superfície elevada no tema claro.
- **Tinta** (ink) e **Tinta Apagada** (ink-dim): texto principal e secundário no claro.

### Status (as seis etapas do caminhão)
Vermelho Aguardando Veículo, Laranja Aguardando Embarque, Amarelo Embarque
Iniciado, Verde-claro Embarque Finalizado, Verde Faturado, Verde-escuro
Seguiu Viagem. Escala definida pelo gestor; não muda sem novo aval. Cada uma
tem três tokens no código: `-bg` (preenchimento sólido, igual nos dois temas),
`-fg` (texto ESCRITO SOBRE o preenchimento) e `-txt` (a etapa como texto solto
sobre o painel, medida contra o card de cada tema).

### Named Rules
**A Regra do Preenchimento.** Token de preenchimento nunca é cor de texto
solto: `--gold`, `-bg` e `-fg` são para fundo e para o que vai em cima do
fundo; texto solto usa `--gold-text` e `-txt`. As duas vezes que isso foi
quebrado deram texto invisível no tema claro.

**A Regra da Etapa.** As seis cores de etapa só dizem etapa. Gráfico usa
`--graf-1`; categoria de gráfico não pega cor de etapa emprestada.

**Dourado é Significado.** Estrutura (grade, fio, contorno) é azul-acinzentado;
o dourado marca o ativo, o número que importa e a ação principal.

## Typography

**Display Font:** Barlow Condensed (com Barlow e system-ui de reserva)
**Body Font:** Barlow (com -apple-system, Segoe UI, Roboto, system-ui)
**Label/Mono Font:** Barlow Condensed nos rótulos; Inter só dentro dos relatórios em PDF.

**Character:** a condensada carrega o tom de quadro de operação — muito número
e rótulo curto em pouco espaço —, e a Barlow normal deixa o corpo e os campos
calmos de ler.

### Hierarchy
- **Display** (700, 34 px, altura 1): o número da faixa de indicadores (cargas em aberto, por etapa).
- **Headline** (600, 20 px): título de seção dentro da aba.
- **Title** (600; 700 quando ativo, 16,5 px): itens da navegação lateral.
- **Body** (400, 15 px, entrelinha 1,35): texto corrido, células e campos (os campos da tabela vão a 13 px).
- **Label** (600, 12 px): cabeçalho de tabela, rótulos de etapa (em caixa alta) e notas.

### Named Rules
**O Piso de 12 px.** Nenhuma letra abaixo de 12 px em nenhuma aba, nos dois
temas (`testes/test_piso_de_12px.py`).

## Layout

Cabeçalho fixo de 72 px (logo, nome, relógio, perfil, tema, avisos) e
navegação lateral fixa de 208 px a partir de 821 px de largura; abaixo disso a
navegação vira gaveta aberta pelo botão de menu. O conteúdo de cada aba é um
painel largo com faixa de números no topo, ações logo abaixo e a tabela ou o
quadro em seguida. Escala de espaçamento de 4 px (4, 8, 12, 16, 18, 26), com
18 px como vão padrão de grade. Densidade alta de propósito: a Torre cabe numa
tela de 1440 × 900 com seis cargas à vista; no celular, a faixa de números vira
pares e as tabelas viram cartões. A página nunca rola de lado; tabela larga rola
dentro dela.

**A Regra do Topo.** Numa aba de leitura (Indicadores), o recorte vem primeiro,
numa linha, e o que pede ação vem logo depois do que acontece agora — nunca
no fim. O que repete outro número ou só explica nasce recolhido (`<details>`,
lembrado por pessoa), e nada é apagado para encurtar a página.

**A Regra do Índice.** Aba com mais de três seções e mais de duas telas de
altura (Programação, Cadastros) abre com a barra "Ir para": as seções que a
pessoa vê, na ordem da tela, com salto imediato e o foco no título. Duas
datas que podem discordar na mesma aba dizem quando discordam, e oferecem
alinhar — nunca alinham sozinhas.

## Elevation & Depth

Plano, em camadas de tom. A página é a camada mais funda (Noite do Pátio ou
Papel), o painel fica um degrau acima e o cabeçalho de tabela outro. Sombra só
como fio de separação (`0 1px 2px` com o azul da noite) — nunca como volume.

### Named Rules
**A Regra Sem Vidro.** Superfície é opaca. O vidro com desfoque saiu do painel
porque custava processamento no tablet do pátio.

## Shapes

Canto vivo, não pílula: 4 px em botão, campo e selo; 6 px em caixa; 10 px em
modal e caixa de destaque; 12 px no painel de cada aba. Fios finos (1 px) em
azul-acinzentado. O destaque de estado é anel de 1,5 px ou barra lateral de
3 px — a linha da Torre com caminhão parado ganha a barra vermelha à esquerda.

## Components

### Buttons
- **Shape:** canto de 4 px.
- **Primary:** fundo dourado, texto quase preto, 600, 13,5 px, respiro de 7 × 14 px.
- **Secondary:** transparente, texto do tema, fio do tema, 600, 12,5 px.
- **Danger:** fundo vinho, texto branco. Sem servidor (Modo Local), os botões
  de ação ficam esmaecidos de propósito.
- **Movimento:** resposta em 120 a 180 ms, curva `cubic-bezier(.22,.61,.36,1)`.

### Navigation
Coluna lateral com ícone de traço e rótulo em Barlow Condensed 16,5 px; 44 px
de altura por item. Ativo: texto dourado, véu dourado leve e barra dourada à
esquerda. No celular, gaveta lateral com o mesmo item.

### Faixa de números (Torre)
Caixas lado a lado: número grande em display, rótulo com o ponto da cor da
etapa e uma nota de comparação ("= igual a ontem", "▼ 1 vs. ontem"). A caixa
principal ganha mini-gráfico e sublinhado dourado. Clicar numa caixa filtra a
tabela pela etapa.

### Tabela da Torre
Cabeçalho em condensada dourada sobre o navy de cabeçalho, com fio dourado
embaixo. Cada linha é uma carga: os campos editáveis parecem texto até
receberem foco; a etapa aparece como ponto colorido mais o nome em caixa alta
na cor `-txt`; carga parada no portão ganha a barra vermelha à esquerda.

### Cartão do Pátio ao vivo (componente assinatura)
Um botão por caminhão, na coluna da sua etapa: número da rota em display,
praça, carga, o anel de progresso do tempo na etapa (verde, âmbar, vermelho),
o selo "3h+" quando passa do limite, o tempo nesta etapa e a previsão "sai
por volta de". O cartão "próximo a carregar" ganha a faixa dourada no topo.
Tocar abre a ficha com a linha do tempo da carga.

### Inputs / Fields
Fundo de campo um tom abaixo do painel, fio do tema, canto de 4 px; na tabela
da Torre o campo se veste de texto (só a linha de baixo) e vira campo no foco.
Foco sempre visível (anel do tema).

### Pergunta do painel (`perguntarUI`)
Toda ação que pede certeza, senha ou motivo abre a mesma janela — nunca a
caixa do navegador. Título que diz a ação ("Excluir a carga programada da
placa…?"), explicação curta, lista com rolagem quando há várias cargas, e o
campo quando há o que digitar:
- **senha:** campo escondido; "Mostrar" só para conferir uma senha nova;
- **motivo:** nasce em branco, sempre; obrigatório;
- **digitar:** a palavra ou a placa que confirma o irreversível.
O erro aparece dentro da janela, dizendo o que falta, e ela não fecha. O
cursor nasce no campo; sem campo e com perigo, no **Cancelar**, para o Enter
de reflexo desistir em vez de apagar. Botão da ação em vinho quando é
perigo, dourado nos demais. Quando a ação se chama "Cancelar…", o botão de
desistir se chama **Voltar**. No celular os botões ocupam a largura, 44 px.

## Do's and Don'ts

### Do:
- **Do** usar `--gold-text` e os tokens `-txt` para texto solto; `--gold`, `-bg` e `-fg` só para preenchimento e para o que vai em cima dele.
- **Do** conferir toda cor nova nos dois temas, inclusive o valor dentro de campo, que a bateria de contraste não lê sozinha.
- **Do** manter 12 px como o menor tamanho de letra, também em texto de gráfico (SVG).
- **Do** manter a resposta em até 180 ms e respeitar `prefers-reduced-motion`.
- **Do** dar acesso por teclado a tudo que se clica (botão de verdade, ou `role` e `tabindex`).

### Don't:
- **Don't** usar as seis cores de etapa para outra coisa que não etapa.
- **Don't** pôr vidro, desfoque ou sombra de volume em superfície.
- **Don't** usar cor de etapa ou dourado de preenchimento como texto no tema claro.
- **Don't** criar pílula (canto redondo total) em botão ou caixa.
- **Don't** deixar a página rolar de lado em nenhuma largura.
- **Don't** usar a caixa do navegador (`prompt`, `confirm`, `alert`): senha aparece, motivo não se valida, erro fecha a janela. Toda pergunta é a do painel (`perguntarUI`).
