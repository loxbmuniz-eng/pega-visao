# Exportação para Power BI

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
>
> A seção "o destino é conexão direta com o SharePoint", mais abaixo,
> descreve um destino que deixou de existir. O Power BI hoje lê do próprio
> banco — ver `MODELO_DE_DADOS_BI.md` e as rotas `/bi` do servidor.

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
