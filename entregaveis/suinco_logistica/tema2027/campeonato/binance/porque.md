# BINANCE — por quê

**Ideia central:** o painel já era "vidro" (glass, gradientes, brilho). Uma
mesa de operação não pode competir com o próprio dado por 8 horas — então
achatei a vidraça inteira para painéis lisos, separados por fio de 1px, e
devolvi o espaço que o brilho ocupava para densidade e para números.

**As 3 decisões mais fortes**

1. **Achatar pela variável, não pelo seletor.** `--vidro-bg`, `--vidro-bg-
   forte`, `--vidro-sombra` e `--vidro-brilho` já eram a fonte única de
   verdade do "vidro" no `styles.css` original — lidas por card, stat-box,
   header, nav e `th`. Em vez de reescrever cada um, apontei esses quatro
   nomes para valores planos (reaproveitando `--navy`/`--navy-light`, que o
   próprio autor já tinha criado para "superfície opaca, onde translucidez
   atrapalha"). Uma mudança, dezenas de superfícies corrigidas de uma vez —
   e nenhuma cor nova inventada.

2. **`--vidro-sombra` vira sombra zerada (`0 0 0 0 rgba(0,0,0,0)`), nunca
   `none`.** `.stat-ativo` soma essa variável a uma segunda sombra na mesma
   declaração (`box-shadow: anel-dourado, var(--vidro-sombra)`); `none`
   dentro de uma lista de sombras invalida a propriedade inteira e apagaria
   o anel que marca "este indicador está filtrando a tabela" — cor com
   significado, a que a escola manda proteger. Descobri isso lendo o CSS
   antes de mexer, não depois de quebrar.

3. **Tudo dentro de `@media screen`.** O servidor gera os PDFs com este
   mesmo arquivo. Em vez de caçar, propriedade por propriedade, o que
   poderia vazar pro papel, coloquei a camada inteira atrás de uma consulta
   de mídia que o `page.pdf()` do Chromium nunca ativa — a pergunta "isto
   aparece impresso?" fica respondida uma vez, no topo do arquivo.

**O que deixei de fazer de propósito**

Não toquei na régua de cor de 3px das caixas da faixa BI (resolve um
contraste de 1,9 já documentado), nem nas marcas `✓ ● ·` (são texto, não
estilo), nem no padding calibrado em pixel de `#torre-tabela`/`#mont-tabela`
no desktop — três decisões que já têm prova escrita no próprio `styles.css`
e que eu não tinha motivo, nem medição nova, para reabrir.

**Nota sobre os prints:** a API compartilhada trocou de porta no meio do
campeonato (3010 → 3013); depois do conserto do `tirar_prints.py` (procura
automática de porta), tirei os 16 prints — 4 abas × {claro, escuro} ×
{1440, 390} — e olhei cada um antes de entregar.
