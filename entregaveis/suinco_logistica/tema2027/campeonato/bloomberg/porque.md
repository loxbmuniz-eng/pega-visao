# Bloomberg — por quê

Camada em cima de `styles.css`, não reescrita: quase toda cor/forma do painel já sai de variável CSS, então reskino sobretudo TOKENS (`--navy-*`, `--gold-*`, `--text*`, `--border*`, `--vidro-*`, `--radius*`) e só dou seletor explícito para a casca (raio, sombra, vidro, tipografia). Fundo quase-preto (claro: cinza-papel), texto monoespaçado, âmbar como único acento, zero `border-radius`, zero `box-shadow`, zero `backdrop-filter` — cada regra reaproveita o seletor exato do original, na mesma especificidade, sem `!important` de emergência.

O que **não** toquei, de propósito: as seis cores de status (`--st-*`) e `--ok`/`--warn` são régua do gestor, já calibrada a 4,99:1+ nos dois temas — reskin de casca não é aval pra mexer nisso. As marcas `✓ ● ·` continuam texto puro. `--header-h`/`--nav-h`/`--nav-w` ficaram intocadas porque várias regras fazem `calc()` com elas.

Tudo dentro de `@media screen`: o PDF (`backend/src/servicos/pdf.js`) monta documento próprio e nem recebe esta camada, mas a tela viva também usa `window.print()` em algum ponto — embrulhar garante contraste zero com a folha impressa sem eu precisar auditar cada `@media print` do arquivo original.

Testado com `tirar_prints.py` (escuro) e uma cópia local só trocando `data-tema` para `claro` (o script comum não tem essa opção) — 1440 e 390, quatro abas, dois temas: 16 prints, todos legíveis, sem corte de informação.
