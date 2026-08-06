# Prompt de refino visual — Programação de Embarque Suinco

Escrito para esta operação, com os caminhos, as travas e os critérios reais do
projeto. Cole a partir da linha abaixo.

---

## Contexto

Você vai refinar a camada visual de um painel **em produção**, usado hoje no pátio
de um frigorífico por quatro setores ao mesmo tempo: Logística, Portaria,
Expedição e Faturamento. Não é protótipo. Erro aqui para caminhão.

**Não reescreva nada do zero.** Trabalhe de forma incremental sobre o que existe,
preservando integralmente a lógica de dados, os cálculos, as validações e as
regras de permissão já implementadas.

## Onde mexer — leia antes de abrir qualquer arquivo

O painel publicado é `entregaveis/suinco_logistica/index.html`, com cerca de
890 KB. **Ele é GERADO, não editado.** Alterações feitas nele são apagadas no
próximo build.

As fontes ficam em `entregaveis/suinco_logistica/`:

| Arquivo | O que é |
|---|---|
| `index_suinco.html` | Estrutura das telas |
| `styles.css` | Todo o visual |
| `app.js` | Renderização e eventos |
| `data.js` | Regras de negócio e cálculos — **não toque** |
| `build_arquivo_unico.py` | Gera o `index.html` embutindo CSS, JS, logo e a base de 749 placas |

Depois de qualquer alteração:

```bash
cd entregaveis/suinco_logistica && python3 build_arquivo_unico.py
```

Sem esse comando, nada do que você fez aparece para o usuário.

## O que já existe (não refaça)

- **Design tokens** no `:root` do `styles.css`: `--navy-deep`, `--navy-light`,
  `--gold`, `--border`, e a família `--st-*` com fundo/texto/borda de cada um dos
  seis status. Consolide o que faltar, mas não crie um sistema paralelo.
- **Tema claro e escuro**, alternável pelo cabeçalho.
- **Gráficos em canvas desenhado à mão** (`prepararCanvas`, `drawPieChart` em
  `app.js`). Não há Chart.js, e não deve haver — ver a regra de offline.
- **PWA** com service worker e manifest.
- **Tabela vira cartão no celular** (`.mobile-cartao`), com rótulo derivado do
  `<thead>`.

## Regras que não se negociam

**1. Nenhuma linha de `data.js`.** É onde vivem a máquina de estados, os cálculos
de tempo de pátio, os somatórios e as permissões por setor. Se um refino parecer
exigir mudança ali, pare e pergunte.

**2. Não altere nada dentro de `@media print`.** Os três relatórios têm larguras
de coluna calibradas para caber em A4, e são fotografados e circulados em grupos
de WhatsApp. Quebra de layout aqui só aparece na hora de imprimir, quando já é
tarde.

**3. Zero dependência externa.** O painel funciona offline e é servido com CSP
restrita. Nada de CDN, fonte do Google, biblioteca de gráfico ou ícone remoto.
Tudo embutido ou nada.

**4. Pisos de celular** — metade da operação usa telefone, de pé, às vezes de
luva:
- alvo de toque de **44px** em qualquer botão (52px nos da Portaria);
- fonte de **16px ou mais** em campo de digitação — abaixo disso o iOS dá zoom ao
  focar e desalinha a tela;
- nenhum texto abaixo de **11px**;
- a **página nunca rola de lado**; tabela larga rola dentro da própria caixa.

**5. Cuidado com nome de classe.** Já houve colisão: `.tabela-timeline` existia
para a matriz do relatório impresso, com fontes de 10px, e uma tabela de tela
criada com o mesmo nome herdou corpo de documento. Antes de nomear, procure.

## O trabalho, em ordem de valor

Faça **um item por vez**. Antes de cada um, diga o que vai mudar e em qual
arquivo. Depois de cada um, rode a verificação e informe o resultado.

### 1. Hierarquia visual nos KPIs (bento grid)

Hoje os indicadores usam grade uniforme (`.grid4`) — tudo com o mesmo peso, o que
não é verdade. "Cargas paradas há mais de 3h" importa mais que "total do dia".
Reorganize em grade assimétrica, com os indicadores de ação ocupando mais área.

Telas afetadas: Torre de Controle e Indicadores.

### 2. Estados vazios e de erro com cara de produto

`.empty-state` é texto plano hoje. Dê a ele ícone, hierarquia e — quando fizer
sentido — a ação que resolve. "Nenhuma carga no período escolhido" deveria
oferecer o botão que limpa o filtro.

### 3. Barra de filtros fixa ao rolar

A Visão do Pátio e o Histórico têm filtro no topo e tabela longa embaixo. Ao
rolar, o filtro some e o operador perde a referência do que está vendo. Deixe
`sticky`, e colapsável no celular para não comer a tela.

### 4. Micro-interações

Hover nos cartões, transição suave ao trocar de filtro e ao alternar aba,
`prefers-reduced-motion` respeitado. Nada acima de 200ms: quem está com o
caminhão na frente não espera animação.

### 5. Sparklines na tabela

Tendência das últimas semanas por transportadora, na própria linha da tabela de
indicadores. Desenhe em canvas, no mesmo padrão dos gráficos existentes.

Os dados já são calculados por `data.js` — **consuma, não recalcule**.

### 6. Consolidar espaçamentos nos tokens

Cores já estão no `:root`; espaçamento e raio ainda aparecem soltos. Extraia sem
mudar nenhum valor calculado, para o diff ser de nome, não de aparência.

## O que NÃO fazer

- **Command palette (Ctrl+K).** Metade dos usuários está no celular, de luva.
  Atalho de teclado não alcança quem mais precisa.
- **Skeleton loading.** Os dados são locais e a primeira pintura é imediata. O
  que demora é a sincronia com o servidor, e para isso já existe indicador
  próprio no rodapé. Skeleton aqui seria animação fingindo trabalho.
- **Trocar o canvas por biblioteca de gráfico.** Ver a regra de offline.

## Como verificar — obrigatório após cada item

```bash
cd entregaveis/suinco_logistica
python3 build_arquivo_unico.py

# Camada visual e comportamento (não precisam de servidor)
python3 testes/test_auditoria_mobile.py    # 3 aparelhos, todas as abas
python3 testes/test_auditoria_refino.py    # telas da mesma carga combinam
python3 testes/test_visao_patio.py         # linha do tempo e filtro
python3 testes/test_relatorios.py          # os três documentos impressos
python3 testes/test_mobile.py
python3 testes/test_refino.py

# Regra de negócio (exigem a API local no ar)
cd backend && npm run teste                # 68 casos contra PostgreSQL real
cd .. && python3 testes/test_login_api.py
python3 testes/test_adaptador_api.py
python3 testes/test_aviso_alteracao.py
```

**Critério de aceite: nenhuma falha nova.** Cada bateria termina com
`FALHAS: NENHUMA`; o backend, com `# fail 0`.

Se um teste falhar por medir a coisa errada — e não porque o produto quebrou —
corrija o teste e **diga explicitamente que fez isso e por quê**. Teste ajustado
em silêncio para ficar verde é pior que teste vermelho.

## Como entregar

Um commit por item, com mensagem explicando **por que** a mudança existe, não o
que ela faz — o diff já mostra o quê.

No fim de cada item, informe:
- o que mudou e em quais arquivos;
- o resultado das baterias;
- se algum teste foi ajustado, qual e por quê;
- se precisa de atualização no servidor. Mudança só de tela **não precisa**: o
  painel é publicado pela Vercel e se atualiza sozinho. Só peça o terminal se
  houver rota nova, alteração de banco ou permissão.
