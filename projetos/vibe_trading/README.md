# Vibe Trading

Agente de pesquisa de trading: **backtest com custo, validação fora da
amostra e debate entre analistas** — sem escrever código quantitativo e sem
dependência nenhuma além do Python 3.11.

```bash
./vibe comparar                          # estratégias contra comprar e segurar
./vibe backtest --estrategia rompimento
./vibe validar --estrategia media_movel  # treino x validação
./vibe debate --saida dossie.md
```

**Leia o `HANDOFF.md`** — ele tem o mapa completo: como rodar com dados
reais, as três decisões de projeto que sustentam os números, o que não
existe e como continuar.

O resumo em uma linha: o sinal da barra `i` executa na **abertura** da barra
`i+1`, custo entra sempre e contra você, e nada aqui manda ordem para
corretora nenhuma.
