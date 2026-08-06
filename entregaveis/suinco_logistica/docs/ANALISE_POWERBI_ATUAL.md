# Análise do Power BI atual × dados que o painel entrega

Arquivo lido: `CENTRO_LOGISTICA_POWERBI_READY.pbix` (300 KB).

**O que consegui ler:** os scripts TMDL (32 medidas por extenso), o diagrama do
modelo (27 tabelas) e as 4 páginas do relatório com os campos de cada visual.

**O que não consegui:** o modelo tabular completo fica num arquivo binário
interno (`DataModel`) que não abre sem o Power BI. Cinco medidas usadas nos
visuais não aparecem nos scripts — elas existem, só não em texto que eu alcance.
Onde eu não tiver certeza, está dito.

---

## 1. Resumo em um parágrafo

O Power BI foi desenhado para **gestão de frota completa** — abastecimento,
manutenção, pneus, multas, acidentes, treinamentos, custo por km. O painel do
pátio cobre **embarque**: programação, chegada, carregamento, faturamento e
saída. São escopos diferentes, e o menor está contido no maior.

Na prática: **o painel alimenta 4 das 27 tabelas do modelo**, e é justamente
onde estão as páginas "Visão do Dia" e "Tempos de Pátio". As páginas
"Financeiro" e "Transportadoras" dependem de dados que o painel não coleta —
valor de frete, quilometragem, preço por quilo.

Isso não é defeito do BI nem do painel. É informação para decidir o que conectar
agora e o que continua vindo de outra fonte.

---

## 2. O que o modelo espera

27 tabelas:

**Fatos (14):** `fact_Viagens`, `fact_Expedicao`, `fact_StatusFrota`,
`fact_Ocorrencias`, `fact_CustosLogisticos`, `fact_Abastecimentos`,
`fact_Manutencao`, `fact_Pneus`, `fact_Multas`, `fact_Acidentes`,
`fact_Treinamentos`, `fact_Previsoes`

**Dimensões (13):** `dim_Calendario`, `dim_Veiculos`, `dim_Transportadoras`,
`dim_Rotas`, `dim_Clientes`, `dim_Motoristas`, `dim_Produtos`, `dim_Fazendas`,
`dim_Oficinas`, `dim_Postos`, `dim_Sistemas`, `dim_CategoriasCusto`,
`dim_Operadores`

**Apoio:** `LOG_EVENTOS`, `CONFIG_Parametros`, `Medidas`

---

## 3. De → Para: o que o painel entrega

### 3.1 Conecta direto (só renomear colunas)

| Tabela no BI | View do servidor | Observação |
|---|---|---|
| `LOG_EVENTOS` | `fact_movimentacoes` | `num_carga`→`CargaId`, `data_hora`→`Timestamp`, `status`→`StatusNovo` |
| `dim_Veiculos` | `dim_frota` | 749 placas, cadastro oficial |
| `dim_Rotas` | `dim_rota` | 32 rotas |
| `dim_Transportadoras` | `dim_transportadora` | **Falta a coluna `tipo`** — ver 4.3 |

`LOG_EVENTOS` é o encaixe mais importante: as medidas de tempo de pátio e os dois
alertas dependem dela, e os valores de status que você usa nas medidas
(`"Aguardando Veículo"`, `"Embarque Iniciado"`, `"Faturado"`, `"Seguiu Viagem"`)
são exatamente os que o servidor grava. Bate sem adaptação.

### 3.2 Conecta parcialmente

**`fact_Viagens`** ← `dim_carga`

| Coluna que o BI usa | O painel tem? | Como fica |
|---|---|---|
| `peso_kg` | Sim | `PesoKg` |
| `peso_tons` | Não | Coluna calculada: `PesoKg / 1000` |
| `qtd_entregas` | Sim | `QtdEntregas` |
| `status_viagem` | Diferente | Ver 4.2 |
| `valor_frete` | **Não** | Não coletado |
| `km` | **Não** | Não coletado |
| `otif_status` | **Não** | Não coletado |

### 3.3 Não vem do painel

Nada disso é coletado no pátio, e conectar não vai fazer aparecer:

`fact_Expedicao` (preço por kg), `fact_Ocorrencias`, `fact_CustosLogisticos`,
`fact_Abastecimentos`, `fact_Manutencao`, `fact_Pneus`, `fact_Multas`,
`fact_Acidentes`, `fact_Treinamentos`, `fact_Previsoes`, `dim_Clientes`,
`dim_Motoristas`, `dim_Produtos`, `dim_Fazendas`, `dim_Oficinas`, `dim_Postos`,
`dim_Sistemas`, `dim_CategoriasCusto`, `dim_Operadores`.

`dim_Calendario` e `CONFIG_Parametros` também não vêm — e é o certo. Calendário
se cria no próprio Power BI; parâmetros são configuração, não dado operacional.

### 3.4 O servidor entrega e o BI ainda não usa

| View | O que traz | Para que serve |
|---|---|---|
| `tempos_por_etapa` | Duração de cada etapa, **em minutos, já calculada** | Substitui cálculo em DAX |
| `dim_status` | As 6 etapas com `OrdemNoFluxo` e `Cor` | Ordenar e colorir corretamente |
| `dim_carga` | Rota, cliente, destino, doca, sequência, paletizada, ganchos | Detalhe por carga |

---

## 4. Achados que mudam número na tela

### 4.1 "Horas de Pátio (espera)" está medindo outra coisa

A medida hoje:

```dax
VAR Chegada = CALCULATE(MIN(LOG_EVENTOS[data_hora]), LOG_EVENTOS[status] = "Aguardando Veículo")
VAR Inicio  = CALCULATE(MIN(LOG_EVENTOS[data_hora]), LOG_EVENTOS[status] = "Embarque Iniciado")
RETURN IF(..., (Inicio - Chegada) * 24)
```

No fluxo do painel, **"Aguardando Veículo" não é a chegada do caminhão** — é o
momento em que a Logística *programa* a carga, muitas vezes na véspera. A chegada
é **"Aguardando Embarque"**, registrada pela Portaria quando o caminhão entra no
pátio.

Como está, a medida conta o tempo entre programar e começar a carregar. Uma carga
programada às 16h de terça e carregada às 8h de quarta soma 16 horas de "espera"
— com o caminhão em casa a noite inteira.

Isso contamina **"Custo do Tempo Parado (R$)"**, que multiplica essas horas pelo
custo hora. O número sai, e sai alto.

**Correção:**

```dax
VAR Chegada = CALCULATE(MIN(LOG_EVENTOS[data_hora]), LOG_EVENTOS[status] = "Aguardando Embarque")
```

Ou, mais simples, usando o que o servidor já entrega:

```dax
Horas de Pátio (espera) =
DIVIDE(
    CALCULATE(SUM(tempos_por_etapa[MinutosNaEtapa]),
              tempos_por_etapa[Etapa] = "Aguardando Embarque"),
    60
)
```

### 4.2 `status_viagem` usa valores que não existem no pátio

As medidas filtram `"Pendencia"` e `"Em Rota"`. O painel trabalha com seis status
fixos, validados no banco:

`Aguardando Veículo` → `Aguardando Embarque` → `Embarque Iniciado` →
`Embarque Finalizado` → `Faturado` → `Seguiu Viagem`

Conectando sem ajustar, **"Viagens Pendentes" e "Viagens Em Rota" devolvem zero**
— o filtro não encontra nada. Não dá erro; só zera.

Equivalências sugeridas:

| Medida atual | Equivalente no pátio |
|---|---|
| Viagens Pendentes | Status ainda não é `Seguiu Viagem` |
| Viagens Em Rota | Status = `Seguiu Viagem` |

### 4.3 `dim_Transportadoras[tipo]` não existe na origem

`"% Viagens Frota Própria"` e `"Custo Frete Frota Terceirizada"` filtram por
`tipo = "Propria"`. Essa coluna não existe no cadastro de frota.

Mas o painel guarda a informação equivalente **na carga**, no campo `PraOnde`,
com quatro valores: `FROTA PROPRIA`, `CROSS-DOCKING`, `DEDICADA`, `RET FRIGO`.

```dax
% Viagens Frota Própria =
DIVIDE(
    CALCULATE([Total Viagens], dim_carga[PraOnde] = "FROTA PROPRIA"),
    [Total Viagens]
)
```

Diferença conceitual que vale registrar: `tipo` classificaria a **transportadora**;
`PraOnde` classifica a **carga**. Uma transportadora pode aparecer nos dois modos.
Se a classificação por empresa for necessária, é cadastro novo — me diga e eu
acrescento.

### 4.4 Medidas que cruzam tabelas de granularidade diferente

`"Custo Logístico % Valor Expedido"` divide um valor de `fact_Viagens` por um de
`fact_Expedicao`. Duas tabelas fato, granularidades distintas.

Funciona **enquanto as duas estiverem filtradas pelo mesmo calendário**. Se um
visual filtrar por algo que só existe em uma delas — transportadora, por exemplo —
o numerador filtra e o denominador não. O percentual sai, e sai errado.

Não é erro hoje; é armadilha para quando alguém arrastar um campo novo. Vale um
comentário na medida.

### 4.5 A armadilha de somar peso pelo histórico

Se um dia alguém somar `PesoKg` a partir de `fact_movimentacoes`, o número vem
**seis vezes maior**: há uma linha por etapa, e a carga passa por seis.

Regra prática: **contagem e tempo** vêm de `fact_movimentacoes`; **peso, valor e
atributos da carga** vêm de `dim_carga`.

---

## 5. Onde o servidor economiza trabalho de DAX

As cinco medidas `Tempo Médio ...` da página "Tempos de Pátio" calculam duração
entre eventos. O servidor já entrega isso pronto em `tempos_por_etapa`:

```dax
Tempo Médio Espera Embarque (min) =
CALCULATE(AVERAGE(tempos_por_etapa[MinutosNaEtapa]),
          tempos_por_etapa[Etapa] = "Aguardando Embarque")
```

Vantagem além da simplicidade: a view **exclui etapa em andamento**. Carga parada
agora não entra na média com duração zero — que é o erro clássico desse cálculo,
e ele puxa a média para baixo exatamente no dia em que o pátio está travado.

---

## 6. Ordem sugerida

**Etapa 1 — o que funciona hoje**
Conectar `LOG_EVENTOS`, `dim_Veiculos`, `dim_Rotas`, `dim_Transportadoras` e
`dim_carga` às views. Acrescentar `tempos_por_etapa` e `dim_status`. As páginas
"Visão do Dia" e "Tempos de Pátio" passam a viver de dado real e atual.

**Etapa 2 — ajustar as medidas**
Corrigir 4.1 (chegada), 4.2 (status), 4.3 (frota própria). São três correções e
elas mudam número na tela — melhor fazer com alguém do pátio olhando junto para
validar se o resultado bate com a percepção de quem está lá.

**Etapa 3 — decidir sobre o resto**
`valor_frete`, `km`, `otif_status`, preço por kg e as tabelas de manutenção não
existem no painel hoje. Três caminhos, e a escolha é sua:

- passar a coletar no painel (frete e km são viáveis: campo na tela de
  programação);
- continuar vindo de outra fonte, e o BI junta as duas;
- ficar de fora por enquanto, e as páginas que dependem disso saem do relatório
  até haver dado.

Não recomendo deixar visual com número vindo de tabela vazia. Cartão zerado sem
explicação é pior que cartão ausente: alguém vai acreditar nele.

---

## 7. Inventário das 32 medidas lidas

| Pasta | Medida | Depende de | Situação |
|---|---|---|---|
| 00 Base | Total Viagens | fact_Viagens | Conecta |
| 00 Base | Total Peso Expedido (tons) | fact_Expedicao | Sem origem |
| 00 Base | Custo Frete Total (R$) | valor_frete | Sem origem |
| 00 Base | % OTIF | otif_status | Sem origem |
| 00 Base | Viagens Pendentes | status_viagem | Ajustar (4.2) |
| 00 Base | Viagens Em Rota | status_viagem | Ajustar (4.2) |
| 00 Base | Total Ocorrencias | fact_Ocorrencias | Sem origem |
| 00 Base | Custo por Tonelada (R$) | derivada | Depende das acima |
| 00 Base | Km Rodados | km | Sem origem |
| 00 Base | Entregas Totais | qtd_entregas | Conecta |
| 00 Base | Valor Expedido (R$) | preco_kg | Sem origem |
| 00 Base | Preço Médio por Kg (R$) | derivada | Sem origem |
| 00 Base | Última Atualização | LOG_EVENTOS | Conecta |
| 01 Executivo | Custo Logístico Total (R$) | derivada | Marcada como provisória no código |
| 01 Executivo | Custo Logístico % Valor Expedido | duas fatos | Ver 4.4 |
| 01 Executivo | Custo por Km (R$) | km | Sem origem |
| 01 Executivo | Custo Frete por Entrega (R$) | derivada | Parcial |
| 01 Executivo | Valor Expedido LY (R$) | dim_Calendario | Sem origem |
| 01 Executivo | Valor Expedido YoY % | derivada | Sem origem |
| 02 Fretes | % Viagens Frota Própria | tipo | Ajustar (4.3) |
| 02 Fretes | Custo Frete Frota Terceirizada (R$) | tipo + valor_frete | Ajustar + sem origem |
| 02 Fretes | Peso Médio por Viagem (tons) | peso_tons | Conecta com coluna calculada |
| 02 Fretes | Km Médio por Viagem | km | Sem origem |
| 02 Fretes | Custo Frete por Ton.Km (R$) | km + valor_frete | Sem origem |
| 04 Financeiro | Horas de Pátio (espera) | LOG_EVENTOS | **Conecta, mas ver 4.1** |
| 04 Financeiro | Custo do Tempo Parado (R$) | derivada | Herda o erro de 4.1 |
| 09 Segurança | Taxa de Ocorrências por Viagem | fact_Ocorrencias | Sem origem |
| 09 Segurança | Ocorrências por 100 Viagens | derivada | Sem origem |
| 15 Alertas | Alerta: Cargas Paradas no Pátio | LOG_EVENTOS | **Conecta** |
| 15 Alertas | Alerta: Cargas Faturadas Sem Sair | LOG_EVENTOS | **Conecta** |
| 90 Parâmetros | Param Custo Hora Parada | CONFIG_Parametros | Criar no BI |
| 90 Parâmetros | Param Horas Sem Mov | CONFIG_Parametros | Criar no BI |

As cinco medidas `Tempo Médio ...` da página "Tempos de Pátio" existem no modelo
mas não nos scripts que consegui ler. Pela nomenclatura, todas encaixam em
`tempos_por_etapa` (seção 5).

---

## 8. Uma coisa que o modelo acertou e vale manter

Os dois alertas — **"Cargas Paradas no Pátio"** e **"Cargas Faturadas Sem Sair"**
— conectam sem nenhum ajuste e são os indicadores mais úteis do arquivo inteiro.

"Faturada sem sair" é dinheiro parado com o caminhão no pátio, e é exatamente o
tipo de coisa que ninguém percebe olhando a tela do dia. Vale subir esses dois
para a primeira página.
