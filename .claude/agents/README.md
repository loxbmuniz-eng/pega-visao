# O time do painel Suinco

Onze agentes, cada um com uma função do fluxo que a gente construiu. Chame pelo
nome (`use o suinco-investigador para...`) ou deixe o Claude escolher pela
descrição.

## O caminho de uma demanda nova

```
    pedido do Luis
          │
          ▼
  suinco-tradutor-de-pedido     "o que muda, onde, o que não muda, e a pergunta que falta"
          │   (aprovado)
          ▼
  suinco-teste-que-reprova      escreve o teste que FALHA contra o que está no ar
          │
          ▼
     implementação              (no chat principal, ou com o agente da área)
          │
          ├── suinco-servidor            migração, rota, permissão
          ├── suinco-paridade-mobile     funciona no pátio, não só no monitor
          └── suinco-fidelidade-do-dado  os números dizem a verdade
          │
          ▼
     suinco-portao              bateria completa → publicar.sh → bloco de status
          │
          ▼
   suinco-voz-do-dono           a mensagem que chega até ele
```

## O caminho de um problema relatado

```
  "o checklist está sendo apagado"
          │
          ▼
  suinco-investigador        reproduz, acha a causa raiz, mede a extensão
          │
          ▼
  suinco-teste-que-reprova   trava o defeito antes de corrigir
          │
          ▼
     correção → suinco-portao → suinco-voz-do-dono
```

## Quem é quem

| Agente | Chame quando | Não use para |
|---|---|---|
| **suinco-tradutor-de-pedido** | ele pediu algo novo | implementar |
| **suinco-investigador** | "não funciona", "some", "apaga", "zera" | corrigir |
| **suinco-teste-que-reprova** | causa raiz encontrada | investigar |
| **suinco-servidor** | coluna, rota, permissão, "mostra mas não grava" | mexer na tela |
| **suinco-paridade-mobile** | mudou tela; antes de publicar para o pátio | corrigir sozinho |
| **suinco-fidelidade-do-dado** | antes de um número chegar à diretoria | corrigir |
| **suinco-entregavel-html** | XLS virando dashboard; material institucional | painel em produção |
| **suinco-portao** | está pronto e testado | investigar ou codar |
| **suinco-voz-do-dono** | fechar entrega; explicar incidente | decidir técnico |

## Por que separados

Cada um carrega os **erros que já aconteceram na sua área** — a rota que existiu
8 dias sem chamador, o `destroy()` com animação, os 32 filtros que zeravam, o
mês de 2029 no seletor, o `|| ''` que apagava o trabalho de outro setor. Num
chat só, esse conhecimento se dilui e volta a ser cometido. Separado, cada agente
começa sabendo o que não pode repetir.

As skills continuam valendo para todos: `suinco-entrega-sem-ponto-solto`,
`suinco-yard-flow`, `systematic-debugging`, `test-driven-development`,
`verification-before-completion` (o mapa das 46 está em `.claude/skills/README.md`).

## Agentes em paralelo: só para LER (11/10/2026)

Vários agentes ao mesmo tempo, sim — para auditoria, varredura, investigação,
revisão: trabalho que lê e devolve achado. Escrevendo, NUNCA dois ao mesmo
tempo: todos dividem a mesma branch de trabalho, o mesmo `index.html` gerado e
o mesmo Postgres da bateria. Dois escrevendo é commit cruzado, build
sobrescrito e vermelho de contaminação — foi o que aconteceu em 09/10: uma
sessão publicou os portões 77 e 78 enquanto o portão 77 de outra rodava, e
duas ocorrências nasceram com o mesmo número (a segunda virou a #133). Quem escreve é um só; os outros
leem e entregam o achado para ele.

## O caminho do novo objetivo — o maior case da Suinco (09/09/2026)

```
  "quero a melhor integração com o Sisatak e o Delivery B2B"
          │
          ▼
  suinco-integrador-atak     mapa de sistemas, fonte da verdade por dado, contrato
          │                  de integração, o que depende da ATAK/TI, plano por fases
          │   (aprovado)
          ▼
  suinco-teste-que-reprova → suinco-servidor → suinco-portao   (como toda demanda)

  "esse case precisa ser o maior da Suinco"
          │
          ▼
  suinco-case                indicadores com consulta e fonte, antes × depois,
                             referência de mercado com URL, narrativa de uma página
```

Os dois não escrevem código de produção sozinhos. O integrador especifica; o
case mede. Quem implementa continua sendo o caminho de sempre, pelo portão.
