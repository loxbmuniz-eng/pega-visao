# Por quê — camada STRIPE

Três níveis, nunca dois: nível 1 é o dado que identifica a linha (placa, nº
carga, número de indicador — negrito, `--text`); nível 2 é estrutura
(cabeçalho de coluna, rótulo de KPI — caixa alta, entreletra aberta,
`--text-dim`, sem negrito pesado); nível 3 é contexto (hora, participação —
o mesmo tom, menor, peso normal).

`th` virou rótulo sem caixa própria: sem fundo em gradiente nem régua de
2px, só a tipografia (caixa alta + `--text-dim`) e um fio de 1px separando
do corpo — a mesma superfície de vidro do card aparece atrás, então o
cabeçalho se distingue por ser texto discreto, não por ser uma caixa.
`--text-dim` já estava calibrado (comentário do próprio arquivo, linha
~1861) contra o card nos dois temas — reaproveitado, não recalculado.

Números de quantidade (`.c-peso`, `.c-entregas`, `.c-ganchos`, `.num-forte`)
ganharam na TELA o mesmo `text-align:right` + `tabular-nums` que o PDF já
tinha só em `@media print` — mesma classe, mesma régua, agora nos dois
lugares. `.cel-num`/`.tot-num` já alinhavam fora do print; só faltava
completar a família.

Campo de tabela = dado até o cursor chegar: `td input`/`td select` nascem
sem borda nem fundo (provado em `prints/stripe_campo_1_repouso.png` — "2952"
lê como célula comum), ganham moldura no hover (`_2_hover.png`) e o anel
dourado + fundo no foco (`_3_foco.png`). A troca é instantânea, sem
`transition`, porque mudar cor no clique não é animação — não abre exceção
à regra de só `transform`/`opacity`. Torre mantém `text-align:center` nos
seus `input[number]` (regra por id, mais específica): coluna estreita
demais para o alinhamento à direita valer o espaço.

Badge trocou de bolha (raio 14px) para chip (`--radius-sm`, já nomeado no
arquivo pra célula de etapa) — só a forma; as seis cores de estado e o
texto de cada uma continuam exatamente como o gestor definiu.

Nada de `@media print` aqui: `.print-page th/td` já vence por `!important`
no arquivo-base, então o PDF sai como sempre saiu — conferido lendo o
CSS, não assumido.
