---
name: auditoria-do-dado
description: Auditoria da qualidade do dado da Suinco — campo vazio, duplicado, referência quebrada (placa sem Frota, nota sem carga), valor fora da faixa, dado velho. Classifica cada achado por gravidade e entrega um placar. Use antes de importar um relatório novo do Atak, antes de construir indicador sobre uma tabela, ao revisar a auditoria noturna da Administração, ou quando um número "parece errado".
---

# Auditoria do dado

Adaptada de `data-quality-audit` (nimrodfisher/data-analytics-skills,
licença MIT, Copyright (c) 2026 Nimrod Fisher). Ver
`ORIGEM_DAS_SKILLS_DE_DESIGN.md`. O painel já tem a auditoria noturna (só
leitura, caixa na Administração); esta skill é o método para auditar sob
demanda e para desenhar regra nova para ela.

## Regra de segurança

Auditoria é SÓ LEITURA. Nada de `UPDATE`/`DELETE` para "consertar" o que
a auditoria achou: correção de dado segue o fluxo da casa e, no servidor,
a regra de comando conferido linha por linha (CLAUDE.md). Dado real fica
fora do repositório (LGPD).

## As cinco verificações

1. **Completude** — campo vazio, coluna por coluna, com o limite aceitável
   escrito para cada um. Vazio ≠ zero: capacidade de veículo vazia é
   "não informado", não "zero kg".
2. **Duplicidade** — mesma carga, mesma nota, mesma placa em dobro.
   Decidir se é versão (histórico legítimo) ou erro (importação repetida).
3. **Referência** — placa da carga que não está na Frota; nota de frete
   sem carga; transportadora fora da lista. Contar órfãos por relação.
4. **Faixa de valor** — peso negativo, KM zero com frete cobrado, data de
   saída antes da entrada, hora no futuro, percentual pago acima de 100.
5. **Atualidade** — o último registro é de quando, comparado com o que se
   espera (a operação registra o dia inteiro; tabela parada há horas em
   dia útil é sinal).

## Gravidade

CRÍTICO (número publicado errado ou operação parada) · ALTO (indicador
distorcido) · MÉDIO (tela confusa) · BAIXO (cosmético). Cada achado com a
consulta que o reproduz e a quantidade de linhas afetadas.

## Saída

Placar por verificação (passou / quantos falharam), lista de achados por
gravidade, e para cada um: o que a operação vê de errado por causa dele.
