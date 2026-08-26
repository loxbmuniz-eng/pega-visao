# Modelo de dados — Embarque Suinco → Power BI

> ## ⚠️ Documento histórico — o SharePoint nunca entrou em produção
>
> Este texto foi escrito quando o painel **ia** rodar sobre Listas do
> SharePoint, com login da Microsoft (MSAL). Essa arquitetura **nunca chegou
> a ser usada**: nenhuma Lista foi provisionada, nenhum dado da operação
> passou por lá.
>
> Desde a migração de agosto/2026 o painel roda com backend próprio — Node +
> PostgreSQL num VPS — e o login é e-mail e senha do próprio painel.
>
> Os trechos sobre SharePoint, Teams, Graph, MSAL ou Listas ficam aqui como
> **registro de por que as decisões foram tomadas**, nunca como instrução do
> que fazer. O sistema de hoje está em `MAPA_COMPLETO_DO_SISTEMA.md`; a
> operação do servidor, em `MANUAL_DO_SERVIDOR.md`.

O que é gravado, onde, com que nome, e o que sai para o Power BI.

Este documento é a fonte de verdade do modelo. Quem for montar medida, relação
ou relatório trabalha a partir daqui.

---

## 1. Em uma frase

O painel do pátio grava em um **PostgreSQL** no servidor da Suinco. Sobre esse
banco existem **7 views** que já entregam os dados no formato de estrela
(dimensões + fatos), com os nomes de coluna que o Power BI espera. O Power BI lê
essas views por **HTTPS, com um token de leitura**, em JSON ou CSV.

Ninguém exporta arquivo à mão. O CSV continua existindo, mas como formato de
saída da mesma consulta — não como um arquivo que alguém precisa lembrar de
gerar.

---

## 2. As duas camadas, e por que existem duas

### Camada 1 — Tabelas (onde o painel grava)

São as tabelas físicas. Nomes em `snake_case`, alinhados ao modelo que já existia
nas Listas do SharePoint.

| Tabela | Tipo | O que guarda | Cresce como |
|---|---|---|---|
| `fact_viagens` | Fato | **Uma linha por carga**, atualizada conforme ela anda | ~1 linha por carga programada |
| `fact_statusfrota` | Fato | **Uma linha por mudança de status** | ~6 linhas por carga (uma por etapa) |
| `log_eventos` | Auditoria | Quem fez o quê, quando | 1 linha por ação relevante |
| `dim_veiculos` | Dimensão | Frota oficial — 749 placas | Estático, cresce com cadastro novo |
| `dim_rotas` | Dimensão | 32 rotas oficiais | Estático |
| `operadores` | Cadastro | Quem tem acesso ao painel | **Nunca sai para o BI** |

### Camada 2 — Views (o que o Power BI lê)

São consultas salvas sobre as tabelas acima. Elas existem por um motivo concreto:
os nomes de coluna que o Power BI já usava vieram do CSV antigo
(`NumeroCarga`, `PesoKg`, `StatusAtual`), e o banco usa outro padrão
(`numero_carga`, `peso_kg`, `status_atual`).

Em vez de escolher um padrão e quebrar o outro, as views traduzem. **O modelo do
Power BI não precisa de retrabalho** — os cabeçalhos são idênticos aos do CSV que
já era usado.

Além de traduzir, as views fazem duas coisas que o BI não precisa refazer:

- **Juntam a rota**: `vw_dim_carga` já traz `RotaNome` e `RotaOperador`, buscados
  em `dim_rotas`. Não é preciso relacionar no BI.
- **Escondem o que foi excluído**: carga excluída fica marcada no banco (para os
  outros terminais saberem que ela saiu), mas some das views. Carga que nunca
  virou operação não infla o volume programado do dia.

---

## 3. As 7 views, coluna por coluna

### 3.1 `dim_carga` — a carga e seu estado atual

**Granularidade:** uma linha por carga. É a **dimensão principal** do modelo.
Chave: `Id`.

| Coluna | Tipo | Significado |
|---|---|---|
| `Id` | texto | Identificador único da carga. Gerado pelo painel |
| `NumeroCarga` | texto | Número operacional, digitado pela Logística |
| `Placa` | texto | Placa do veículo. Sempre maiúscula, sem hífen |
| `Transportadora` | texto | Vem do cadastro de frota, não do que foi digitado |
| `TipoVeiculo` | texto | Carreta, Truck, Toco… Vem do cadastro de frota |
| `Motorista` | texto | Preenchido pela Portaria na chegada |
| `Cliente` | texto | Cliente da carga |
| `Destino` | texto | Destino da carga |
| `Produto` | texto | **Sempre vazio hoje.** Coluna existe para o modelo do BI não quebrar |
| `PesoKg` | inteiro | Peso em quilos |
| `Doca` | texto | Doca de carregamento |
| `RotaCodigo` | texto | Código da rota (ex.: `500`) |
| `RotaNome` | texto | Nome da rota, já resolvido |
| `RotaOperador` | texto | Operador logístico da rota, já resolvido |
| `Sequencia` | inteiro | Ordem de carregamento. Livre, definida pelo Programador |
| `PraOnde` | texto | `FROTA PROPRIA`, `CROSS-DOCKING`, `DEDICADA` ou `RET FRIGO` |
| `Paletizada` | texto | `Sim` ou `Não` |
| `QtdGanchos` | inteiro | Quantidade de ganchos. `0` = liso |
| `QtdEntregas` | inteiro | Número de entregas da carga. Mínimo 1 |
| `StatusAtual` | texto | Etapa em que a carga está agora |
| `CriadoEm` | data/hora | Quando a carga foi programada |
| `AtualizadoEm` | data/hora | Última alteração |

**Atenção ao usar:** esta view mostra o **estado atual**, não o histórico. Para
contar quantas cargas passaram por "Faturado" no mês, use `fact_movimentacoes` —
`dim_carga` só sabe onde a carga está agora.

### 3.2 `fact_movimentacoes` — o histórico do pátio

**Granularidade:** uma linha por mudança de status. É a **tabela fato principal**.
Nunca é alterada nem apagada — só recebe linhas novas.

| Coluna | Tipo | Significado |
|---|---|---|
| `CargaId` | texto | Liga com `dim_carga[Id]` |
| `Placa` | texto | Placa no momento do evento |
| `Timestamp` | data/hora | **Quando o evento aconteceu.** É a coluna de data do modelo |
| `StatusAnterior` | texto | De onde saiu. Vazio no primeiro evento |
| `StatusNovo` | texto | Para onde foi |
| `Operador` | texto | Nome de quem registrou |
| `Setor` | texto | Setor de quem registrou |
| `Cliente` | texto | Trazido da carga, para facilitar filtro |
| `Motorista` | texto | Trazido da carga |
| `TipoVeiculo` | texto | Trazido da carga |
| `QtdEntregas` | inteiro | Trazido da carga |

**É aqui que mora a resposta de "quantas cargas por dia".** Filtre por
`StatusNovo` na etapa que interessa e conte `CargaId` distinto.

### 3.3 `tempos_por_etapa` — quanto tempo em cada fase

**Granularidade:** uma linha por etapa concluída de cada carga. Este cálculo era
feito no navegador; agora está no banco, pronto.

| Coluna | Tipo | Significado |
|---|---|---|
| `CargaId` | texto | Liga com `dim_carga[Id]` |
| `Placa` | texto | Placa |
| `Transportadora` | texto | Transportadora da carga |
| `RotaCodigo` | texto | Rota da carga |
| `Etapa` | texto | Nome da etapa medida |
| `EntrouEm` | data/hora | Quando entrou na etapa |
| `SaiuEm` | data/hora | Quando saiu |
| `MinutosNaEtapa` | número | **Duração em minutos**, já calculada |

**Só entram etapas concluídas.** Carga parada agora em "Aguardando Embarque" não
aparece com essa etapa até ela terminar. É proposital: etapa em andamento não tem
duração, e contá-la como zero distorceria a média para baixo.

### 3.4 `dim_frota` — cadastro de veículos

**Granularidade:** uma linha por placa. Chave: `Placa`. 749 registros oficiais.

| Coluna | Tipo | Significado |
|---|---|---|
| `Placa` | texto | Chave |
| `Transportadora` | texto | Dona do veículo |
| `TipoVeiculo` | texto | Carreta, Truck, Toco… |
| `CapacidadeKg` | inteiro | Capacidade. Pode vir vazio |
| `UF` | texto | Estado de emplacamento. Pode vir vazio |
| `DataUltimaMovimentacao` | data/hora | **Sempre vazio hoje.** Reservado |
| `PrecisaRevisao` | texto | `Sim` ou `Não` |

Esta tabela é a **trava de frota**: placa que não está aqui não vira carga. Isso é
regra de negócio, não sugestão — o servidor recusa.

### 3.5 `dim_transportadora`

| Coluna | Tipo | Significado |
|---|---|---|
| `Id` | texto | Nome da transportadora (serve de chave) |
| `Nome` | texto | Mesmo valor |

Derivada da frota: é a lista de transportadoras distintas que têm veículo
cadastrado.

### 3.6 `dim_status` — as 6 etapas e a ordem delas

| Coluna | Tipo | Significado |
|---|---|---|
| `Nome` | texto | Nome da etapa |
| `OrdemNoFluxo` | inteiro | 1 a 6, na ordem real do pátio |
| `Cor` | texto | Cor em hexadecimal, a mesma do painel |

Conteúdo fixo:

| Nome | Ordem | Cor | Quem registra |
|---|---|---|---|
| Aguardando Veículo | 1 | `#c62828` | Logística (ao programar) |
| Aguardando Embarque | 2 | `#e07b1a` | Portaria (chegada) |
| Embarque Iniciado | 3 | `#f0c33c` | Expedição |
| Embarque Finalizado | 4 | `#7fd4a2` | Expedição |
| Faturado | 5 | `#34a862` | Faturamento |
| Seguiu Viagem | 6 | `#14603a` | Portaria (saída) |

**Use `OrdemNoFluxo` para ordenar** os status em qualquer visual. Ordenar por
nome coloca "Aguardando Embarque" antes de "Aguardando Veículo", que é o inverso
da realidade. E `Cor` permite padronizar o Power BI com as mesmas cores do painel,
sem ninguém escolher no olho.

### 3.7 `dim_rota` — as 32 rotas oficiais

| Coluna | Tipo | Significado |
|---|---|---|
| `Codigo` | texto | Código da rota. Chave |
| `Nome` | texto | Nome |
| `Detalhe` | texto | Descrição |
| `OperadorLogistico` | texto | Operador responsável |

---

## 4. Como as tabelas se relacionam

```
        dim_frota                dim_rota            dim_transportadora
       (Placa)                  (Codigo)                  (Id)
           |                        |                        |
           |  Placa                 |  RotaCodigo            |  Transportadora
           |                        |                        |
           +--------→  dim_carga  ←-+------------------------+
                        (Id)
                          |
                          |  CargaId
                          |
              +-----------+-----------+
              |                       |
     fact_movimentacoes        tempos_por_etapa
        (Timestamp)              (MinutosNaEtapa)
              |
              |  StatusNovo
              |
          dim_status
            (Nome)
```

**Relações a criar no Power BI:**

| De | Para | Cardinalidade | Direção |
|---|---|---|---|
| `fact_movimentacoes[CargaId]` | `dim_carga[Id]` | muitos → 1 | simples |
| `fact_movimentacoes[StatusNovo]` | `dim_status[Nome]` | muitos → 1 | simples |
| `tempos_por_etapa[CargaId]` | `dim_carga[Id]` | muitos → 1 | simples |
| `dim_carga[Placa]` | `dim_frota[Placa]` | muitos → 1 | simples |
| `dim_carga[RotaCodigo]` | `dim_rota[Codigo]` | muitos → 1 | simples |
| `dim_frota[Transportadora]` | `dim_transportadora[Id]` | muitos → 1 | simples |

Falta um **calendário**. Não vem do servidor de propósito — tabela de datas é
melhor criada no próprio Power BI, marcada como tabela de data, e relacionada a
`fact_movimentacoes[Timestamp]`.

---

## 5. Como o Power BI busca os dados

**Endereço base:** `https://api.embarquesuinco.com.br/bi/`

**As 7 views:**

```
https://api.embarquesuinco.com.br/bi/dim_carga
https://api.embarquesuinco.com.br/bi/fact_movimentacoes
https://api.embarquesuinco.com.br/bi/tempos_por_etapa
https://api.embarquesuinco.com.br/bi/dim_frota
https://api.embarquesuinco.com.br/bi/dim_transportadora
https://api.embarquesuinco.com.br/bi/dim_status
https://api.embarquesuinco.com.br/bi/dim_rota
```

**Dois formatos:**

- **JSON** (padrão) — recomendado. Tipos preservados, sem ambiguidade de
  separador ou decimal.
- **CSV** — acrescente `?formato=csv`. Separador `;`, codificação UTF-8 com BOM
  (para o Excel abrir acentuação certa). Existe para compatibilidade com o
  processo antigo.

**Autenticação:** um token de leitura, enviado no cabeçalho:

```
Authorization: Bearer SEU_TOKEN
```

Exemplo de consulta no Power Query (M):

```m
let
    Token  = "COLE_O_TOKEN_AQUI",
    Fonte  = Json.Document(
        Web.Contents(
            "https://api.embarquesuinco.com.br/bi/dim_carga",
            [Headers=[Authorization="Bearer " & Token]]
        )
    ),
    Tabela = Table.FromRecords(Fonte)
in
    Tabela
```

**O que esse token pode fazer:** somente ler as 7 views acima. Não cria, não
altera, não apaga, não acessa cadastro de operadores nem senha. É um token de
leitura de relatório — não é credencial de administrador.

---

## 6. O que NÃO sai para o Power BI

Deliberadamente fora:

- **`operadores`** — e-mail, setor e hash de senha. Nunca é exportado por rota
  nenhuma.
- **`log_eventos`** — trilha de auditoria (quem autorizou a saída da placa X às
  14h). Fica no banco para consulta pontual, não para relatório.
- **Cargas excluídas** — ficam marcadas no banco, mas as views as escondem.

---

## 7. Perguntas que a TI costuma fazer

**"Isso é conexão direta ao banco?"**
Não. É HTTPS com token, sobre a porta 443. A porta do PostgreSQL (5432) está
fechada para a internet e continua fechada — o banco só aceita conexão de dentro
do próprio servidor.

**"Com que frequência posso atualizar?"**
À vontade. As views são consultas leves sobre tabelas indexadas. Atualização de
hora em hora é confortável; de 15 em 15 minutos também.

**"Qual o volume?"**
Ordem de grandeza: `dim_frota` tem 749 linhas e é praticamente estática;
`dim_carga` cresce com o volume programado; `fact_movimentacoes` cresce cerca de
6 vezes o número de cargas. São dezenas de milhares de linhas por ano, não
milhões.

**"E se o token vazar?"**
Ele é trocado em um comando e o antigo para de funcionar na hora. Quem tiver o
token antigo perde o acesso imediatamente — e mesmo antes disso, o máximo que
conseguiria era ler dados operacionais de expedição.

**"Dá para restringir por IP?"**
Dá, se vocês tiverem IP fixo de saída. Me passem o IP que eu configuro no
servidor.
