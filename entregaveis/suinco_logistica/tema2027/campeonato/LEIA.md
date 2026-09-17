# Campeonato de camadas — o registro, não a decoração

Dez agentes de design produziram, cada um, uma camada de CSS sobre o painel
publicado. Um juiz renderizou as dez com a mesma semente, nos dois temas, em
1440px e 390px, e julgou. O resultado virou a especificação do **Tema 2027**,
executada pelas seis etapas de `tema2027/`.

**Por que isto está no repositório, e não numa pasta temporária.** A decisão
de design deste painel passou a ter um porquê escrito, com prova medida e com
o nome de quem foi reprovado e por quê. Se isso viver só na conversa em que
aconteceu, some quando a sessão acabar — e a primeira pessoa que quiser mexer
no visual vai refazer a discussão inteira sem saber que ela já foi feita.

## O que tem aqui

- `VEREDITO.md` — a classificação, as eliminações com a medida que as
  provou, a decisão do campeão híbrido e a especificação em 8 etapas.
- `<competidor>/camada.css` — a camada como cada um entregou.
- `<competidor>/porque.md` — o raciocínio de cada um, nas palavras dele.

## ESTES ARQUIVOS NÃO ENTRAM NO PAINEL

`build_arquivo_unico.py` concatena `tema2027/*.css` — a busca **não é
recursiva**, então nada de `campeonato/` chega ao `index.html`. Conferido:
com esta pasta no lugar, o `index.html` regerado difere do anterior em **2
linhas**, as duas do carimbo de versão.

Isso importa porque cinco destas camadas foram **eliminadas**, e duas delas
por vazarem para o papel do relatório. Se um dia alguém mover um `camada.css`
daqui para o nível de cima, ele vai para produção. Não mova.

`testes/fixtures/controle_stripe_camada.css` é uma cópia deliberada da camada
da Stripe, usada como isca pelo `test_tema2027_papel.py`: aquele teste só é
aceito se **reprovar** com ela. É o que prova que a guarda enxerga vazamento
em vez de dizer "igual" por estar cega.
