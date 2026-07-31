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
