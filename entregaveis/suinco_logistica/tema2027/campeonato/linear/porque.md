# Por quê — LINEAR (precisão)

A base já tinha vidro, sheen e contraste calibrado — meu trabalho foi separar
**cor de estrutura** de **cor de marca**. Hoje `--border`/`--border-soft` no
escuro são dourados: a mesma cor do título brilha em toda borda de campo,
card e tabela. Redefini as duas para um cinza com viés azul-frio
(`rgba(151,168,214,…)`), reservando o dourado só para ação/seleção/status.
Zebra da tabela passou a usar essa mesma cor (`--linha-fio`), coerente com a
grade em vez de solta.

`letter-spacing` negativo (-0.012em) só em títulos de caixa-mista de peso
alto (`.card-title`, `h2` de modal, títulos de seção) — nunca em rótulo
maiúsculo (precisa de MAIS respiro, não menos) nem em número de indicador
(dígito colado é dígito difícil de diferenciar de longe, no pátio). O
cabeçalho de marca, em caixa alta, só teve o tracking reduzido (.5→.2px),
não invertido.

`--radius` caiu de 10 para 8px — valor que `.card` e os campos já usavam por
override local; a mudança apenas elimina a inconsistência, não cria uma
nova escala.

Cabeçalho de tabela: traço de 2px virou 1px (ainda dourado — é ele que diz
"isto é cabeçalho"), e ganhou uma divisória fina entre linhas que antes só
existia entre células do BI. Botões e badges sem sheen ganharam um
`background-image` (gradiente somado, não substituído) para não ficarem
"chapados" ao lado dos cards de vidro.

Nada de `--text`, `--st-*`, `--gold-text` ou `--warn-fg` foi tocado — são os
valores medidos pelo `test_contraste.py`. A régua de cor das caixas
`.bi-faixa` e as marcas `✓ ● ·` da linha do tempo não tiveram cor alterada,
só o respiro ao redor (padding, múltiplo de 4px).

Toda a camada está dentro de `@media screen{}` — inclusive as variáveis —
para que `@media print` fique geometricamente impossível de tocar, e não só
"combinado por convenção".

## Provas
- `prints/linear_torre.png`, `linear_indicadores.png`, `linear_devolucoes.png`,
  `linear_programacao.png` — 1440px, escuro
- `prints/linear_claro_*.png` — 1440px, claro
- `prints/linear_mob_*.png` — 390px, escuro
- `prints/linear_mob_claro_*.png` — 390px, claro

Sem rolagem lateral em nenhuma, nenhuma coluna cortada sem reticências/title,
tema claro e escuro ambos legíveis.
