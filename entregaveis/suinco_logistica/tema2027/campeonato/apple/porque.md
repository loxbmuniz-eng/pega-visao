# Por quê

Escola: profundidade e material. Tudo em `@media screen` — garante `@media print` intocado sem tocar em nenhuma regra dele.

Zero `backdrop-filter` novo: o painel já usa vidro pintado (alpha) no que se repete e vidro real só em header/nav/modal (terminal fraco no pátio) — decisão certa, eu só esticada a régua de peso, de dois pra três degraus: nav (estrutural) > card > stat-box/badge/chip, só com opacidade e sombra em camadas.

Sombra contextual usa `:has(.table-wrap)`: card cheio pesa mais que card raso; degrada sozinha sem suporte. `--radius-lg` só entrou em modal e caixa-destaque — o token já existia e dizia pra que servia, sem uso.

Tracking aperta só números grandes (nunca solta, nunca estoura largura). Não toquei `.btn:active`: o arquivo já documenta essa duplicação como defeito visto.

Novo: `prefers-reduced-transparency`/`prefers-contrast` — ninguém tinha feito, e é o que "material" pede: vidro que vira opaco quando o SO pede.
