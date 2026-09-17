# Suíço — por quê

Escola: grade + tipografia. Nenhuma moldura, sombra ou gradiente novo; o
que separa é o filete de 1px (já era `--border`/`--border-soft`) e o peso
do texto, não uma caixa desenhada.

**O que mudou de fato:** raio zerado, sombras e desfoque decorativo fora
(`--radius/--shadow/--vidro-sombra/--vidro-borrao`), halo ambiente do
`body::before` desligado, `.card` virou filete-no-topo em vez de caixa
fechada, botões/chips/pílulas retos, `<th>` e abas viraram versalete
tracked, degradês (header, abas ativas, botões, controle segmentado,
barra do Raio-X) viraram cor chapada.

**A queixa do dono ("cartões com espaço sobrando"):** todo `.stat-box`
— não só a Torre/Indicadores que já tinham `.bi-faixa` — virou faixa
contínua com régua de cor à esquerda e texto alinhado à base, em vez de
centralizado num quadrado alto. É visível na Esteira de Devoluções
(`#dev-pipeline`), que usava `.bento` puro: o número some no topo e o
espaço embaixo do rótulo desaparece.

**Contraste — nada de novo a medir:** não toquei em nenhuma cor nem
fundo calibrado. `--vidro-bg`/`--vidro-bg-forte` continuam com o mesmo
valor; só perderam brilho, borda e sombra por cima. Testei antes de
decidir: colocar `-txt` de status direto no fundo da PÁGINA (em vez do
fundo do CARD, que é contra o que o styles.css mediu) reprovava em claro
— até 3,41:1 em "Embarque Finalizado". Por isso os cartões continuam
com a superfície própria, só sem moldura.

**Respeitado:** a régua de cor (não fundo) nas caixas de indicador — e
estendida para toda `.bento`, não só `.bi-faixa`; as marcas `✓ ● ·`
(texto, intocadas); `@media print` (zero regras minhas ali).

**Não coberto:** o arquivo tem ~160 ocorrências de raio/sombra/gradiente
espalhadas em componentes de baixa visibilidade (carimbo de devolução,
avatar) fora das 4 abas testadas — fica para uma segunda passada.
