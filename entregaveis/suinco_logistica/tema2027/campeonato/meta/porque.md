# Por quê — camada META

1. `--vidro-sombra` já era a variável que .card, .stat-box, .bento.bi-faixa e
   #header liam pra sombra — só trocar o VALOR (duas camadas: contato fino +
   alcance largo) já eleva as quatro superfícies de uma vez, sem caçar
   seletor por seletor num arquivo de 6 mil linhas. Um só ponto, quatro
   chamadores — a mesma lógica que o CLAUDE.md já pede pro resto do código.
2. Borda vira sombra por `border-color:transparent`, nunca `border:none` —
   `border-color` não move um pixel de layout (box-sizing:border-box), então
   a Torre continua cabendo nos 1.002px medidos em styles.css; `none`
   arriscaria realocar a tabela mais apertada do painel.
3. Onde a borda carregava IDENTIDADE (topo do stat-box, traço à esquerda de
   `.funcao-aba`) ela fica — só os lados que eram CONTORNO DE CAIXA somem.
4. Três contornos de ESTADO viram preenchimento: `.stat-ativo` (era anel
   inset), `.cel-filtro-ativa` (era barra de 3px) e a aba ativa do menu
   (era régua lateral) — os três agora acendem por fundo dourado suave,
   do jeito que a escola pede.
5. `--radius/-sm/-lg` sobem (14/9/20px) — quase todo componente já lia a
   variável, então "cantos generosos" chegou de graça em card, botão,
   input, modal, pílula.
6. Padding de `.card`/`.stat-box`/`.funcao-aba` caiu 1–2px: o canto maior
   já dá a sensação de "macio" sozinho, então o respiro que a borda ocupava
   virou altura de tela, não estofamento — atende o "sem espaço sobrando".
7. Zero `transition` nova: todo hover/ativo troca de estado na hora, então
   não existe animação pra desligar em `prefers-reduced-motion`.
8. Tudo embrulhado em `@media screen` — garante `@media print` intocado
   mesmo se um dia esta camada for concatenada ao arquivo único dos PDFs.

**Prova incompleta, por honestidade, não por escolha**: a API comum
(127.0.0.1:3010) caiu no meio da bateria de prints (nenhum processo com
`PORT=3010` sobrou — não foi bloqueio de login, foi queda) e ficou fora do
ar por >25 min de tentativas repetidas. REGRA ZERO proíbe subir outra API.
Entrego com prova real só do desktop escuro (4 abas, 1440px — ✅ visto e
correto). Claro e 390px têm o TOKEN pronto (`:root[data-tema="claro"]`
acima) mas ⬜ **não foram vistos rodando** — Luis: "não afirme que funciona
sem rodar", então não afirmo.
