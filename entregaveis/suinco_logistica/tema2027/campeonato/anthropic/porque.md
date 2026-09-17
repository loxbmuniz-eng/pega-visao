# Por quê — ANTHROPIC / Calma Editorial
Ideia central: a hierarquia certa já existia (régua de cor, ✓ ● ·, coluna de identificação em negrito) — sobrava temperatura decorativa por cima dela brigando pela mesma atenção. A camada não soma elementos: abaixa véu, sombra e brilho para peso e tamanho de fonte voltarem a mandar sozinhos.

**3 decisões mais fortes:**
1. Tokens de borda/sombra/ambiente (`--vidro-borda`, `--border-soft`, `--vidro-sombra`, `--amb-*`) baixam de alpha uma vez e se propagam por card/stat-box/header/nav — nunca toco `--border` (contorno de input sobre fundo igual no escuro) nem `--st-*`/`--text-*` testados por contraste.
2. Régua de cor das caixas de indicador intocada: só `.stat-box::before` (véu do topo) suaviza; `.bento.bi-faixa .stat-box::after` (a borda que resolveu o contraste 1,9) não muda.
3. Botões e aba ativa perdem degradê/glow duplo — a cor já diz a hierarquia. `--btn-success`/`--btn-danger` mantidos exatos (4,74:1 medido); hover só com `transform`+`opacity`.

Deixei de fazer: mexer em densidade/padding (dono já pediu menos rolagem); tirar versalete de badge/th (é varredura rápida, não hierarquia); tocar cor de status/texto/`--border`; qualquer coisa em `.doc-*`/print — tudo em `@media screen`, PDF sai igual a hoje.
