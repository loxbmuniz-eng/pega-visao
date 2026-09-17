# Tema 2027 — delta medido, rodada 2 (17/09/2026)

Juiz: Fable 5.1. Tudo aqui foi medido por `testes/medir_tema2027_rodada2.py`
(nove cenários) e comparado por `testes/delta_tema2027_rodada2.py`. Referência =
`index.html` da branch de entrega (`origin/claude/pega-visao-up19-deliverables-6cqhjb`,
commit d8037b2). Novo = build desta branch com as seis camadas + as correções da
rodada 2. Mesma semente de 16 cargas, login local, API em 127.0.0.1:3010.

Arquivos: `tema2027_medidas_publicado.json`, `tema2027_medidas_t27.json`,
`ref_<aba>_<tema>_1440_full.png` (8), `t27_<aba>_<tema>_1440_full.png` (8),
`t27_<aba>_<tema>_390_full.png` (8), `t27_torre_escuro_1440_filtrando.png`,
`t27_torre_escuro_1440_foco.png`, `t27_programacao_claro_1440_hover.png`,
`t27_torre_escuro_1280_120cargas.png`, `print_ref.png` / `print_t27.png`.

## 1. Critério 1 — nada muda de lugar (1440, escuro e claro, iguais nos dois temas)

| aba | `#main.y` Δ | `#main.height` | `th` da Torre / Montagem (x, width) | `thead` linhas |
|---|---|---|---|---|
| torre | 0 | 2783 → 2762 (−21) | 12 colunas, todas iguais ±2px | iguais |
| programacao | 0 | 2259 → 2069 (−190) | 14 colunas, todas iguais ±2px | iguais |
| indicadores | 0 | 3102 → 2773 (−329) | — | — |
| devolucoes | 0 | 158 → 137 (−21) | — | — |

`#header` e `#nav`: `position: fixed`, `backdrop-filter: none` nos dois. `#main.height`
só diminui (é compactação). Faixa da Torre 182 → 175px (teto era +4).

## 2. Critério 2 — nada some

- Cortes (`scrollWidth > clientWidth`) em badge, botão, rótulo, `th`, aba: **nenhum** a 1440.
- 1280 com 120 cargas: `th` "Programação · Última etapa" — publicado 80/79 (já cortava 1px),
  novo 0 cortes. Montagem "Ganchos" 53/51 e "Entregas" 55/53 — **idênticos ao publicado**
  (folga negativa pré-existente, não é da camada).
- `medir_rolagem_com_dado.py`, 1280 × 467 cargas: `torre·computador = []`. Sem rolagem
  interna. (A rolagem de 6px que o executor da Etapa 4 mediu vinha da caixa alta; saiu.)
- Rótulos da faixa (linhas, por `Range`): a 1440 contagem idêntica ao publicado, todos em
  1 linha na Torre; a 1280 o publicado já quebrava "Aguardando Veículo/Embarque" e
  "Embarque Finalizado" em 2 linhas e continua igual; "Programação anterior" passou de 2
  para 1 linha; faixa 192 → 175px.
- Celular 390: `document.scrollWidth = 390` nas cinco abas; fonte < 11px só onde a base já
  tinha (9,5px da faixa compacta; "1 de 2" a 10px) — `test_auditoria_mobile.py` verde.

## 3. Critério 3 — legível

- `test_contraste.py`: 0 elementos abaixo de 4,5 nos dois temas (era 2).
- Caixa ativa por padrão ("Cargas em aberto") com "▲ 10 vs. ontem": 4,41 → ≥ 4,5 com
  `--acento-ativo` .16 → .12 no escuro.
- Linha acesa no claro: `.veic-tipo` 4,03 → fora da lista nos dois estados (repouso .07,
  hover .10, zebra cancelada na linha).
- Botões por PIXEL (fundo = cor mais frequente do recorte; texto = pixel mais distante):
  escuro danger 8,78 / hover 7,58 · primary 10,2 / 8,12 · sec 9,93 / 6,53;
  claro danger 8,78 / 6,9 · primary 10,2 / 7,95 · sec 13,64 / 8,05. Todos ≥ 4,5.
- Pré-existente no publicado, claro, Torre: `.sit-outras` 4,3 e "Caminhão NO PÁTIO" 1,39
  (mesmos elementos, mesmos valores na referência). Não é da camada. ⬜ fica para a base.

## 4. Critério 4 — papel

`test_tema2027_papel.py`: `ImageChops.difference(print_ref, print_t27).getbbox() = None`
(900×900). Caso de controle Stripe reprova (área 50,137–680,404). Confirmado de novo à mão.

## 5. Toque, foco, tablet

- Aba apertada (CDP `:active`, 1280): publicado responde; integrado NÃO respondia;
  rodada 2 responde (`inset 0 0 0 999px rgba(233,185,84,.14)` volta a aparecer).
- Tablet 1024×768 com toque (`pointer:coarse` = true): `.btn` e `.btn-sm` 44px
  (integrado: 36px).
- Tab até o 1.º campo numérico da Torre: `outline solid 2px rgb(233,185,84)`,
  `:focus-visible` true (publicado: `none`).
- Acordeão do celular (Indicadores/Cadastros): 52,5 / 43,5 / 43,5 / 61px — iguais ao
  publicado (integrado: 48,8 / 42,3 / 42,3 / 58,5).

## 6. guarda_do_padrao.py

Publicado 18 falhas, novo 18 — o mesmo conjunto (Torre no tablet rola 144px por dentro;
"?" de 13px em Cadastros; segmentos Rotas/Transportadoras/Placas; Gerar PDF). Nenhuma
nova. Duas que só apareciam no novo eram a guarda medindo alvo debaixo do rodapé fixo
(a compactação trouxe "Painel do Gestor" 26px para cima, para dentro da faixa do rodapé):
corrigido na própria guarda — "fora da vista" agora termina onde o rodapé fixo começa.

## 7. Bateria

Sete vermelhos do log de 382c84f: `test_contraste`, `test_toque_responde`,
`test_auditoria_mobile`, `test_fila_e_campos_editaveis`, `test_sobras_parciais_relatorio`,
`test_tema2027_etapa4_tabelas`, `test_tema2027_etapa5_acoes` → todos verdes no build final,
rodados um a um. Também verdes: `test_vidro`, `test_faixa_indicadores_bi`,
`test_etapa3_indicadores`, `test_movimento_do_painel`, `test_toque_duplo_nao_passa`,
`test_visao_patio_sem_rolagem_infinita`, `auditoria_mobile_hoje`, `test_tema2027_etapa1/2/6`,
`test_tema2027_so_tela`, `test_tema2027_papel`. A bateria inteira (`rodar_tudo.sh`) NÃO foi
rodada nesta sessão — é o portão (`publicar.sh`) quem a roda.
