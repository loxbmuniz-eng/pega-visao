# Por quê — SALA DE CONTROLE

Regra de ouro: só DUAS coisas deveriam brilhar sozinhas — "Aguardando Veículo"
(caminhão parado no portão) e "Rotas sem carga" (buraco na malha). Todo o
resto mantém a hierarquia original. Se tudo gritasse, nada gritaria.

O que a camada faz, e por quê:
1. **Linha da Torre "acende"** (`#torre-tbody tr:has(.badge-aguardando-veiculo)`):
   fundo/borda na LINHA, nunca na cor do texto — nenhuma razão de contraste já
   medida no arquivo muda. Escopo só na Torre: a mesma classe de badge também
   significa "precisa revisão" e "cancelada" noutras telas — carimbar lá mudaria
   o sentido.
2. **Pulso (só opacity, respeita `prefers-reduced-motion`)** na régua lateral
   das duas caixas de anomalia real, via `[style*="--st-cor:var(--st-aguardando-veiculo-bg)"]`
   — o mesmo atributo que o app.js já escreve como fonte da cor — e via
   `.stat-alerta`, já existente. `.stat-zerada` desliga o pulso: pátio limpo
   não é alarme.
3. **Números como instrumento**: monoespaçada só em `.stat-num`/`#clock` (caixas
   livres) — nunca em coluna de tabela de largura fixa, que é exatamente onde
   o projeto já reabriu rolagem lateral antes.
4. **Rótulos em caixa alta** — placa de painel, não muda cor.
5. Grade de pontos no fundo (`body::after`), bem fraca — textura de vidro de
   instrumento atrás dos cards, ajustada por tema.

Tudo dentro de `@media screen`: `@media print` fica intocado (confirmado com
`emulate_media('print')` — o `::after` e o mono somem no papel).
