---
name: claude-ads
description: Auditoria de campanha de mídia paga a partir do export CSV do Meta Ads ou Google Ads — gasto desperdiçado, vencedores, realocação de verba e plano de ação. Use quando o pedido envolver anúncio, campanha, verba, CPA, ROAS, CTR, criativo que não performa, ou "para onde mover o orçamento".
---

# Auditoria de anúncios

O motor está em `projetos/claude_ads/`. **Ele calcula; você interpreta.**

```bash
cd projetos/claude_ads
./ads auditar <arquivo.csv> --cpa-alvo 50 --roas-alvo 3
./ads verba <arquivo.csv>       # só a realocação
./ads criativo <arquivo.csv>    # ranking por CTR
./ads plano <arquivo.csv>       # lista numerada de ações
```

## As três travas — e por que existem

**1. Volume mínimo por dimensão.** CTR precisa de 1.000 impressões; "teve
tráfego e não converteu" precisa de 30 cliques; comparar CPA ou eleger
vencedor precisa de 5 conversões. Matar criativo com 3 cliques é o erro mais
caro da otimização manual: mede-se ruído e o vencedor morre antes de existir
amostra. O que está abaixo do limiar sai em **"sem volume para julgar"** — que
não é a mesma coisa que perdedor.

**2. Referência é a mediana das próprias linhas do cliente**, nunca benchmark
de mercado. E só vale com pelo menos 3 linhas comparáveis: com menos, a
mediana é a própria linha e julgar ali é sortear. Nesse caso o relatório pede
`--cpa-alvo`.

**3. Teto de crescimento na realocação.** Dobrar a verba de um vencedor não
dobra o resultado — o leilão encarece e o público satura. O plano nunca
sugere mais que 2x o gasto atual de uma linha, e o que sobra vira
recomendação de **criativo ou público novo**, não mais verba no mesmo lugar.

## O que nunca fazer

- Inventar métrica que não está no arquivo, ou citar benchmark de mercado
  como se fosse dado do cliente.
- Recomendar pausa de linha sem volume.
- Entregar análise de concorrente sem fonte externa declarada.
- Transformar o relatório em pausa automática: nada aqui deve rodar sem
  alguém olhar.

## O que o relatório não sabe

Sazonalidade, estoque, margem por produto, mudança na landing page, e se a
conversão registrada é a que importa para o negócio. Diga isso ao usuário —
faz parte da leitura honesta.
