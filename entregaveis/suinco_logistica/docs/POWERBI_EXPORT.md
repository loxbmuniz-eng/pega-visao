# Exportação para Power BI

## Hoje: CSV manual (ponte temporária)

A aba **Relatórios** tem um botão "Exportar Dados (CSV) — Power BI" que gera
5 arquivos CSV (separador `;`, com BOM UTF-8 pra abrir certo no Excel PT-BR),
no formato fato/dimensão:

| Arquivo | Conteúdo |
|---|---|
| `Fact_Movimentacoes.csv` | Uma linha por evento de mudança de status: CargaId, Placa, Timestamp, StatusAnterior, StatusNovo, Operador, Setor |
| `Dim_Carga.csv` | Uma linha por carga, com todos os campos cadastrais + status atual + Pra onde?/Compartilhada?/Ganchos/Entregas |
| `Dim_Transportadora.csv` | Cadastro de transportadoras |
| `Dim_Frota.csv` | Cadastro de frota (Placa → Transportadora → Tipo de Veículo) |
| `Dim_Status.csv` | Nome, ordem no fluxo e cor de cada um dos 9 status (8 do fluxo + Aguardando Carga) |

Esses 5 arquivos podem ser importados no Power BI Desktop (Obter Dados →
Texto/CSV, um por vez) e relacionados entre si pelas chaves óbvias
(`CargaId`/`Id`, `Placa`, `Transportadora`, `StatusNovo`/`Nome`).

## Isto é temporário — o destino é conexão direta com o SharePoint

Quando as Listas do SharePoint estiverem provisionadas (ver
`MODELO_DADOS_SHAREPOINT.md`), o jeito certo de alimentar o Power BI é
conectar **direto** nas Listas — não depender de alguém lembrar de clicar em
"Exportar" e importar o arquivo manualmente toda vez que quiser um relatório
atualizado. No Power BI Desktop:

1. **Obter Dados → SharePoint Online List**
2. Informar a URL do site do SharePoint
3. Selecionar as Listas `ProgramacaoEmbarque` e `Movimentacoes` (e as
   demais, se precisar de mais contexto — `Frota`, `Transportadoras`, `Docas`)
4. Modelar as relações no Power BI (mesma lógica fato/dimensão acima) e
   configurar atualização automática (Scheduled Refresh, se publicado no
   serviço Power BI, ou só reabrir o `.pbix` com "Atualizar")

Isso dá dados sempre atuais, sem exportação manual e sem risco de alguém
analisar um CSV desatualizado achando que é o estado corrente. O botão de
CSV deste painel deve ser descontinuado nesse momento (ou mantido só como
extração pontual/backup).
