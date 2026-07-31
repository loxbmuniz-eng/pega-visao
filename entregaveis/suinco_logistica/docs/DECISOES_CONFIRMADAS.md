# Decisões confirmadas — Migração Suinco (Excel/VBA → Painel HTML)

Registro das decisões já tomadas em conversa, para não precisar redecidir nem
presumir de novo mais adiante. Datas em horário da conversa.

## 1. Arquivo `painel_suinco_v5_POWERBI.html` (anexado originalmente)
Esse arquivo **não é** o sistema de Programação/Portaria/Expedição/Faturamento
descrito nas regras de negócio — é um painel diferente, de controle de turno
(câmaras frias, expedição por NF, estoque de embalagens, recebimento,
ocorrências, passagem de turno, transportadoras/viagens por NF). Confirmado
por busca exaustiva no arquivo: zero ocorrências de `FROTA`, `Portaria`,
`Sequência`, `Faturamento`, `Aguardando Carga`, ou dos 6/8 status.

**Decisão:** construir do zero as telas do fluxo real, reaproveitando só a
casca visual/técnica do v5 (tema, abas, badges, notificações, padrão de
export). Câmaras frias e tudo que não pertence ao fluxo
Programação→Portaria→Expedição→Faturamento→Logística foi descartado, não
adaptado.

## 2. Fluxo de status: 8 status (modelo sugerido pelo Copilot)
Confirmado pelo usuário — **não** os 6 status originais do VBA.

| # | Status | Setor que aciona |
|---|---|---|
| — | Aguardando Carga | Portaria (chegada sem programação prévia) |
| 1 | Programado | Logística |
| 2 | Veículo em Pátio | Portaria (chegada) |
| 3 | Liberado para Embarque | Logística / Expedição |
| 4 | Embarque Iniciado | Expedição |
| 5 | Embarque Finalizado | Expedição |
| 6 | Faturado | Faturamento |
| 7 | Liberado para Saída | Faturamento |
| 8 | Seguiu Viagem | Portaria (saída — aplicada a todas as cargas da placa de uma vez) |

## 3. Regra "Aguardando Carga"
A Portaria pode registrar a chegada de **qualquer** placa (inclusive frota
própria) mesmo sem programação prévia. Se não existe carga programada para
essa placa, o sistema cria uma entrada "Aguardando Carga" visível a todos os
setores (visão de torre de controle). Quando a Logística completa os dados
(cliente, destino, produto, peso, doca), a carga vai **direto** para
"Veículo em Pátio" — nunca volta para "Programado", porque o caminhão já está
fisicamente no pátio.

## 4. Múltiplas cargas na mesma placa
Quando uma ação de Expedição/Faturamento/Logística é disparada "por placa"
(busca rápida) e a placa tem mais de uma carga elegível para aquela mesma
transição, o painel abre um seletor perguntando qual carga está sendo
processada (usa Número de Carga + Destino para diferenciar). **Exceção:**
chegada e saída na Portaria sempre se aplicam a todas as cargas em aberto da
placa ao mesmo tempo — é o mesmo caminhão, um único evento físico.

## 5. Campos adicionais confirmados
`Número de Carga` (identificador usado pela operação) e `Destino` (separado
de Cliente) fazem parte do cadastro de cada carga — inclusive usados como
critério de diferenciação no seletor de múltiplas cargas.

## 6. Hospedagem: aba personalizada do Teams (HTML/JS), não Power App
Um Power App (Power Apps Studio, fórmulas Power Fx) foi descartado como
caminho porque exigiria um entregável totalmente diferente (especificação de
telas, não HTML) e uma ferramenta que não está disponível nesta sessão para
construir diretamente. O painel continua HTML/JS/CSS, hospedado como aba
personalizada do Teams, falando com Listas do SharePoint via API
REST/Microsoft Graph com SSO Microsoft 365.

## 7. Backend hoje vs. backend final
`data.js` já está estruturado com um adaptador de armazenamento isolado
(`SuincoStore`) rodando em localStorage só para testes fora do Teams. Nenhum
endpoint do SharePoint foi inventado — isso fica documentado em
`MODELO_DADOS_SHAREPOINT.md` para quando o site/tenant real estiver disponível.

## 8. Pendências em aberto (não resolvidas ainda, não presumidas)
- **OTIF**: não calculado ainda. Depende de uma data/hora prometida de
  referência (horário programado? prazo do cliente? SLA por transportadora?)
  que ainda não foi definida. O painel mostra os demais indicadores de tempo
  normalmente e sinaliza essa lacuna na aba Indicadores.
- **Permissão por setor real**: hoje é só uma conveniência de interface
  (esconde abas conforme o setor informado no login local). Controle de
  acesso de verdade só existe quando a Lista do SharePoint tiver permissão
  configurada e o SSO estiver ligado — ver `MODELO_DADOS_SHAREPOINT.md`.
- **Base de Frota real**: aguardando os dados completos (Placa/Transportadora/
  Tipo de Veículo) para popular o cadastro — o painel já tem importação em
  lote pronta para isso (colar direto do Excel).

## 9. Rodada de evolução — "Pra onde?", Ganchos, PDF, Power BI, som, senha UX, linha do tempo, Painel do Gestor

- **Pra onde? / Compartilhada?**: campo `praOnde` com 4 valores (vazio =
  Direto Suinco, CROSS, DEDICADA, RET FRIGO). `Compartilhada?` é **sempre**
  calculada a partir dele (Sim quando CROSS ou RET FRIGO, Não caso
  contrário) — nunca um campo editável separado, pra não desalinhar.
- **Qtd. Ganchos (Gancheira)**: inteiro, 0 = "Liso". Editável na criação da
  carga, na tela de "Completar dados" (Aguardando Carga) e inline na fila de
  Programados.
- **Qtd. Entregas**: campo pedido explicitamente na coluna do PDF Operacional
  e no `Dim_Carga` do export Power BI, mas sem regra de negócio detalhada no
  briefing além de "existir". **Decisão de implementação** (não é regra de
  negócio inventada, é só a forma de captura): número inteiro digitado
  manualmente na Programação/Completar dados, padrão 1.
- **Mapeamento de cor do "Status de Carregamento" no PDF Operacional**: o
  briefing definiu explicitamente 4 dos 8 status. Para os que faltavam,
  ficou definido: "Liberado para Embarque" e "Aguardando Carga" foram
  tratados como "PÁTIO" (mesma cor amarela de "Veículo em Pátio", com texto
  próprio "SEM DADOS" para Aguardando Carga) — o veículo já está fisicamente
  parado na Suinco em ambos os casos. Cargas em "Aguardando Carga" (dados
  incompletos, sem Rota/Nº de Carga) não aparecem na lista do PDF
  Operacional — só depois que a Logística completa os dados.
- **Senha das abas Indicadores/Relatórios**: é só uma barreira de UX
  (`suinco2026`, visível no código-fonte) — não é controle de acesso real.
  Comentário explícito no código (`app.js`, função `pedirSenhaAba`) reforça
  isso. Controle de acesso de verdade só existe com permissão real de Lista
  do SharePoint + SSO.
- **Linha do tempo por carga** (Histórico): busca por placa ou Nº de carga,
  mostra os 8 (ou 9, se nasceu "Aguardando Carga") passos do fluxo como uma
  linha do tempo vertical — feitos com hora/operador/setor, pendentes
  visualmente diferenciados. O log tabular antigo continua existindo abaixo,
  como registro bruto de auditoria.
- **Painel do Gestor — quebra por período** (Indicadores): pedido adicional
  do gestor para que a aba seja "pente fino". Indicadores de tempo, contagem
  de cargas concluídas e ranking de transportadoras quebrados em 5 janelas:
  Últimas 6h e Últimas 12h (rolantes a partir de agora), Hoje (dia
  calendário), Semana (**últimos 7 dias corridos**, não semana calendário —
  escolhido por consistência com as janelas rolantes de 6h/12h e documentado
  aqui) e Mês (mês calendário). Quando não há cargas concluídas suficientes
  num período, a célula mostra "Sem dados suficientes" em vez de "0" ou "—"
  ambíguo. O ranking de transportadoras usa seletor de período (pílulas) em
  vez de uma matriz gigante indicador×transportadora×período, porque o
  número de transportadoras é variável e uma matriz assim ficaria densa
  demais — decisão de design pró-simplicidade, documentada aqui.
- **Som de confirmação**: 3 tons de 880Hz espaçados por 200ms (Web Audio
  API), tocado em toda ação que muda status de carga com sucesso (chegada,
  saída, avanço de status, completar Aguardando Carga) — nunca em digitação.
- **Export Power BI (CSV)**: ponte temporária — ver
  `docs/POWERBI_EXPORT.md`. Quando o SharePoint estiver provisionado, o
  Power BI deve conectar direto nas Listas, não depender deste CSV manual.

## 10. Correção: volta para os 6 status originais do VBA (revoga a seção 2)
Depois da rodada de evolução da seção 9, veio a correção oficial: o modelo
de 8 status sugerido pelo Copilot (seção 2) estava **errado** —
"Liberado para Embarque" e "Liberado para Saída" não existem no processo
real. Expedição vai direto de "Aguardando Embarque" pra "Embarque
Iniciado"; Faturamento vai direto de "Embarque Finalizado" pra "Faturado".
O modelo vigente (implementado em `data.js`/`STATUS_FLOW`, com o comentário
"CORREÇÃO OFICIAL" no código) é:

| # | Status | Setor que aciona |
|---|---|---|
| 1 | Aguardando Veículo | Logística (padrão ao criar a carga — ninguém aciona por botão) |
| 2 | Aguardando Embarque | Portaria, botão "Chegou" |
| 3 | Embarque Iniciado | Expedição |
| 4 | Embarque Finalizado | Expedição |
| 5 | Faturado | Faturamento |
| 6 | Seguiu Viagem | Portaria, botão "Saiu" (todas as cargas em aberto da placa de uma vez) |

"Aguardando Carga" continua existindo, mas não como status — é a flag
`aguardandoCarga`/texto no campo Número da Carga para a chegada sem
programação prévia (seção 3), que nasce direto em "Aguardando Embarque".
Os indicadores de tempo (seção 9) foram reencaixados nos checkpoints reais
deste modelo de 6 (ver comentário em `indicadoresDaCarga`, `data.js`).

## 11. Base de Frota real recebida — pendência da seção 8 resolvida
A base real de Frota chegou (`FROTA_Base_Final_2026.xlsx`, depois ampliada
com o extrato de 2 anos `Consulta_Veiculos_4.xlsx`) e está em
`frota_seed_2026.csv` (2.038 placas: Placa, Transportadora, TipoVeiculo,
PrecisaRevisao). Decisões de normalização/mesclagem documentadas em
`docs/NOTAS_BASE_FROTA.md` — não repetidas aqui para não divergir das duas
fontes.

**Decisão de implementação** (carregamento, não regra de negócio nova): o
painel carrega esse CSV automaticamente no primeiro uso (`data.js`,
`carregarFrotaSeedSeVazia`, chamada no `init()` de `app.js`) via `fetch`
relativo, só quando `DB.frota` ainda está vazio — nunca sobrescreve
cadastro/remoções feitas depois. Funciona quando o painel é servido por
HTTP (Teams/SharePoint ou `python3 -m http.server`); em `file://` o fetch
falha por CORS e o painel segue vazio, caindo de volta no cadastro manual/
import em lote que já existia. A tela Cadastros → Frota ganhou busca por
Placa/Transportadora e filtro "Só Precisa Revisão" porque 2.038 linhas sem
filtro não são navegáveis — exibe até 300 resultados por vez com contagem
do total, sem limitar os dados em si (só a renderização).
