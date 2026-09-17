# Bateria do Tema 2027 — 191 verdes, 7 vermelhos, com a causa de cada

Log integral: scratchpad/bateria_tema2027.log
Build medido: 382c84f (as seis camadas integradas)

## CAUSA 4 — REGRESSÃO DE VERDADE (3)

### 1. test_contraste — dois elementos abaixo do piso, um por tema
```
escuro  stat-delta   razão 4.41 (min 4.5) · 10.5px · rgb(255,138,128) sobre rgb(62,64,82)   '▲ 10 vs. ontem'
claro   veic-tipo    razão 4.03 (min 4.5) · 10.5px · rgb(75,85,101)  sobre rgb(221,203,209) 'Carreta'
```
O fundo de ambos mudou por causa da camada. O do tema claro (rgb(221,203,209),
rosado) é a LINHA ACESA da Etapa 4 sobre o tema claro — a cor de destaque da
carga "Aguardando Veículo" não foi calibrada contra o texto que vive em cima
dela. Esse piso de 4,5 foi corrigido em 16/09 (4,03 -> 4,74 nos botões do
pátio); voltar abaixo dele é desfazer entrega de ontem.
DECISÃO É DO FABLE: é valor de cor.

### 2. test_toque_responde — a aba parou de responder ao dedo
Etapa 2, `10_cascas.css` linha 21:
```css
.nav-tab.active{ background:var(--acento-ativo); box-shadow:none; font-weight:700 }
```
contra o que está publicado desde ontem, `styles.css` linha 5892:
```css
.nav-tab:active{ box-shadow:inset 0 0 0 999px rgba(233,185,84,.14) }
```
`.nav-tab.active` e `.nav-tab:active` têm a MESMA especificidade (0,2,0). A
camada entra depois na cascata, então `none` vence e apaga o feedback de toque
na aba que está selecionada.

É a armadilha que o PRÓPRIO VEREDITO descreve, em outro seletor: "valor zerado
é `0 0 0 0 rgba(0,0,0,0)`, nunca `none`". A regra estava escrita e foi violada
no arquivo do lado.

### 3. test_auditoria_mobile — texto de 10,5px no celular, e 4px de rolagem
```
indicadores: 'Cargas Concluídas', 'Tempo Aguardando E', 'Tempo de Carregame' — 10.5px (piso 11)
cadastros:   página rola de lado 4px
```
Etapa 4, `30_tabelas.css`: `th{ font-size:10.5px }` dentro de `@media screen`,
SEM trava de largura. No celular o `th` continua existindo nas telas que não
viram cartão, e cai abaixo do piso de 11px.

É a MESMA família que a Etapa 3 achou e corrigiu no arquivo dela: bloco sem
largura apaga a compactação do celular. A Etapa 3 prendeu em
`min-width:641px`; a Etapa 4 não.

## CAUSA 2 — O TESTE MEDE UMA FORMA QUE MUDOU (4)

### 4. test_fila_e_campos_editaveis
`ck('coluna de datas existe na Torre', 'Datas' in t or 'Programação' in t)`
A tela agora mostra `PROGRAMAÇÃO · ÚLTIMA ETAPA`. A coluna está lá; só a caixa
mudou. `text-transform` altera o que o navegador devolve em `innerText`.

### 5. test_sobras_parciais_relatorio
`ck('coluna "Nº parcial" existe na tela', 'Nº parcial' in cab)`
A tela mostra `Nº PARCIAL`. Mesma causa.

### 6. test_tema2027_etapa5_acoes  e  ### 7. test_tema2027_etapa4_tabelas
Os dois comparam "publicado" contra "novo" usando o `index.html` LOCAL como
"publicado". Na integração o index.html local passou a TER a camada, então o
caso de controle deles ("o publicado REALMENTE anima box-shadow caro") não
encontra mais o defeito que deveria encontrar — e reprova por estar correto.
O teste não está errado; a referência dele é que precisa apontar para o
`index.html` da branch de entrega, não para o do lado.

## O CUSTO SISTÊMICO DO text-transform:uppercase
Dois testes quebraram só por causa da caixa. Qualquer teste que leia
`innerText` de cabeçalho e compare com caixa exata vai quebrar igual. Isso é
um custo recorrente da decisão, e o Fable precisa pesá-lo: não é um conserto
de dois testes, é uma classe de manutenção.
