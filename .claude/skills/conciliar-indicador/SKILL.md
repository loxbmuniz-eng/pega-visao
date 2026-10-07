---
name: conciliar-indicador
description: Método para quando o MESMO número aparece diferente em dois lugares do painel Suinco (Indicadores × Relatório × Pátio ao vivo × Pagamento de Frete × API /bi). Define o indicador, puxa os dois valores, mede a diferença, segue o caminho do cálculo até achar onde divergem, e fecha com uma fonte só. Use quando o Luis ou um setor disser "aqui dá X e lá dá Y", depois de mexer num cálculo, ou antes de publicar indicador novo.
---

# Conciliar indicador

Adaptada de `metric-reconciliation` (nimrodfisher/data-analytics-skills,
licença MIT, Copyright (c) 2026 Nimrod Fisher). Ver
`ORIGEM_DAS_SKILLS_DE_DESIGN.md`. Complementa o agente
`suinco-fidelidade-do-dado`: ele confere; esta skill é o passo a passo.

## Por que isto importa aqui

"Uma função, dois chamadores" é regra da casa porque número divergente já
aconteceu (o tempo de pátio já teve duas definições — ver
`docs/REGISTRO_DE_OCORRENCIAS.md`). Gestor que vê dois valores para a
mesma coisa para de confiar nos dois.

## Passos

1. **Definir por escrito.** Numerador, denominador, filtros, período e
   FUSO (America/Sao_Paulo — o dia da operação não é o dia UTC). Metade
   das divergências morre aqui: os dois lugares medem coisas diferentes
   com o mesmo nome.
2. **Puxar os dois valores** do mesmo período, com a contagem de linhas de
   cada um e o caminho do cálculo (função do `app/`, rota do backend,
   consulta SQL).
3. **Medir a diferença** absoluta e em %. Diferença zero com contagem de
   linhas diferente também é achado.
4. **Seguir o caminho** dos dois lados, passo a passo. Onde costuma
   divergir neste projeto:
   - fuso e corte do dia (`toISOString()` devolve UTC);
   - `null` virando zero (`Number(x) || null` e o contrário);
   - carga anulada, excluída ou de teste entrando numa conta e não na outra;
   - cache do navegador × dado do servidor ("o servidor é quem manda");
   - média × mediana; arredondamento em etapa diferente.
5. **Classificar a causa**: definição diferente, dado desatualizado, grão
   diferente (por carga × por nota), ou defeito de cálculo.
6. **Fechar**: uma função só, chamada pelos dois lados. Se for defeito,
   o fluxo de defeito da casa (teste que reprova → correção → ocorrência).

## Saída

Tabela "fonte A × fonte B", diferença, causa com o trecho de código, e o
que foi feito. Sem causa achada, a saída diz "não achei" — não arredonda
a diferença para baixo do tapete.
