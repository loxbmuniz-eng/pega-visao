# Projetos

Quatro projetos, um por nicho do carrossel. Cada um roda sozinho, tem README
próprio e testes que passam hoje.

| Projeto | O que é | Testes |
|---|---|---|
| [`estudio/`](estudio/) | Vídeo escrito em HTML, CSS e JS — render determinístico e lote por planilha | 15 |
| [`vibe_trading/`](vibe_trading/) | Backtest com custo, validação fora da amostra e debate entre analistas | 36 |
| [`claude_ads/`](claude_ads/) | Auditoria de anúncios: gasto desperdiçado, vencedores, realocação de verba | 23 |
| [`navegador_agente/`](navegador_agente/) | Um navegador de verdade para agentes de IA, com robots.txt no núcleo | 28 |

**102 testes.** Nenhum projeto tem dependência: Node 22+ ou Python 3.11+, e
mais nada.

---

## O agrupamento

O carrossel trazia cinco cards. Viraram quatro projetos porque **HyperFrames**
(compor vídeo em código) e **Open-Gen-AI** (rodar modelos na própria máquina)
são a mesma bancada na prática: você gera o material e monta o vídeo no mesmo
lugar. Estão juntos em `estudio/` — a composição no motor de render, a
geração em `estudio/geracao/`, com adaptador por provedor.

**Vibe Trading** ficou separado, como pedido. **Claude Ads** e **Camofox**
também: nada em comum com os outros além de rodarem com agente.

---

## O que cada um recusa fazer

Vale mais que a lista de recursos, porque é o que evita entregar algo que
parece pronto e não é.

- **`estudio`** não deixa a cena animar sozinha. Quem manda no relógio é o
  renderizador, e o `base.css` desliga `animation` e `transition` à força.
  Sem isso, o quadro 47 sai diferente numa máquina carregada — e o vídeo
  entregue deixa de ser o vídeo aprovado.

- **`vibe_trading`** não deixa a estratégia comprar no fechamento do dia em
  que decidiu. O sinal da barra `i` executa na **abertura** da barra `i+1`. É
  o que separa backtest de ficção, e tem teste de gap que prova.

- **`claude_ads`** não julga linha sem amostra. 1.000 impressões para falar de
  CTR, 30 cliques para dizer que não converteu, 5 conversões para eleger
  vencedor. O que fica de fora vai para "sem volume para julgar" — que não é
  sinônimo de perdedor.

- **`navegador_agente`** não tem antidetecção, de propósito. Extrair dados,
  pesquisar concorrente e automatizar fluxo precisam de um navegador que
  execute JavaScript — não de disfarce para passar por quem já disse não.

---

## Rodar os testes

```bash
cd projetos/estudio          && npm run teste
cd projetos/vibe_trading     && python3 -m unittest discover -s testes -p 'test_*.py'
cd projetos/claude_ads       && python3 -m unittest discover -s testes -p 'test_*.py'
cd projetos/navegador_agente && npm run teste
```

---

## Campanhas já rodadas no estúdio

| Campanha | Fonte | Saída |
|---|---|---|
| FRVIN Last Dance · 06.09.2026 | artifact "copy e estratégia" | `carrossel` 9 slides, 1080×1920, 38,8s |
| GROOVING Four Years · 05.09.2026 | handoff de 29/08/2026 | `carrossel`, story 1080×1920 e feed 1080×1350, 28,8s |

Os dados estão em `estudio/exemplos/`. Nos dois casos a copy foi
**transcrita, não reescrita**, e o que faltava ficou marcado em amarelo no
próprio vídeo — a regra veio dos documentos das campanhas: *dado que não
temos não se inventa*.

> **Estes dois vídeos são tipográficos porque não havia imagem nenhuma
> disponível.** Não são a identidade das marcas. Com os cards em PNG, a cena
> `cartoes` anima a arte real — é para isso que ela existe.
