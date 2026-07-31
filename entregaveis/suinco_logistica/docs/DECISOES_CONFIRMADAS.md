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

## 2. Fluxo de status: 6 status (modelo real do VBA em produção) — DECISÃO REVERTIDA

**Histórico da decisão (para não se perder o porquê):** inicialmente o usuário
escolheu o modelo de 8 status sugerido pelo Copilot, e o painel foi construído
em cima disso. Depois, o usuário enviou um relatório detalhado descrevendo o
comportamento REAL do sistema VBA em produção — que usa os 6 status
originais — e, ao ser confrontado com a contradição direta, confirmou
explicitamente que o modelo de **6 status** é o que vale, revertendo a escolha
anterior. "Liberado para Embarque" e "Liberado para Saída" (as duas etapas
extras do modelo de 8) **não existem** no fluxo real e foram removidas.

| # | Status | Cor | Setor que aciona | Como |
|---|---|---|---|---|
| 1 | Aguardando Veículo | vermelho | Logística | Valor padrão ao criar a carga (Programação) — ninguém aciona via botão |
| 2 | Aguardando Embarque | laranja | Portaria | Botão **"Chegou"** |
| 3 | Embarque Iniciado | amarelo | Expedição | Botão (com seletor de carga se ambíguo) |
| 4 | Embarque Finalizado | verde-claro | Expedição | Botão (com seletor de carga se ambíguo) |
| 5 | Faturado | verde | Faturamento | Botão (com seletor de carga se ambíguo) |
| 6 | Seguiu Viagem | verde-escuro | Portaria | Botão **"Saiu"** — aplicada a todas as cargas em aberto da placa de uma vez |

**Portaria tem só 2 botões**: Chegou (1→2) e Saiu (→6). Uma descrição
anterior mencionava um terceiro botão "Aguardando Embarque" separado — isso
foi esclarecido como impreciso; confirmado que são 2 botões.

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

## 9. Trava de Frota: bloqueia, não só avisa
Se a placa digitada na Programação não estiver cadastrada em Frota, a criação
da carga é **bloqueada** (não só um aviso deixando prosseguir manualmente,
como estava antes) — o operador precisa cadastrar a placa em
Cadastros → Frota primeiro. Isso reflete o comportamento real do VBA.

## 10. Campos novos confirmados (relatório detalhado do sistema atual)
- **Frota**: `capacidadeKg`, `uf`, `dataUltimaMovimentacao`,
  `precisaRevisao` (booleano) — a base real vem de um ERP/Sisatak com
  histórico de mais de 2.000 placas mapeadas, algumas sinalizadas como
  precisando de revisão humana antes de virar fonte de verdade definitiva.
- **Carga (Programação)**: campo `Motorista` (texto livre).
- **Movimentações (log)**: cada registro de mudança de status também grava
  snapshot de `cliente`, `motorista`, `tipoVeiculo`, `qtdEntregas`, além do
  que já existia (timestamp, operador, setor, placa, cargaId,
  statusAnterior, statusNovo, transportadora). O log **só** é gravado quando
  o status muda — nunca ao lançar/editar dados da carga.

## 11. Painel do Gestor (Indicadores) — detalhamento por período e gráficos
A aba Indicadores precisa comparar os indicadores por múltiplas janelas de
tempo lado a lado (últimas 6h, últimas 12h, hoje, semana, mês), não só uma
média geral — e exibir isso também como gráficos (barra/linha/pizza, Canvas
ou SVG nativo, sem dependência de CDN externo) com filtros combináveis por
Placa, Transportadora, Setor e período. Dentro da mesma sessão/navegador o
dashboard deve re-renderizar sozinho a cada mudança; atualização em tempo
real **entre usuários diferentes** só existe com o backend real do
SharePoint (ver `GUIA_TI_IMPLANTACAO.md`) — não fingir esse comportamento
antes de existir.

## 12. Rodada de evolução via 3 agentes em paralelo
Esta rodada de mudanças (campos novos, PDF no formato da planilha real,
export fact/dim pra Power BI, som, trava de senha de UX, timeline por carga,
painel do gestor multi-período com gráficos, e a correção de 6 status desta
seção) está sendo construída por 3 agentes em paralelo, cada um em um
worktree isolado, com focos diferentes (fidelidade visual / simplicidade de
uso / rigor de dados). O resultado será comparado e a melhor versão (ou a
combinação das melhores partes) será publicada nesta branch.

## 13. Pendências em aberto (não resolvidas ainda, não presumidas)
- **OTIF**: não calculado ainda. Depende de uma data/hora prometida de
  referência (horário programado? prazo do cliente? SLA por transportadora?)
  que ainda não foi definida. O painel mostra os demais indicadores de tempo
  normalmente e sinaliza essa lacuna na aba Indicadores.
- **Permissão por setor real**: hoje é só uma conveniência de interface
  (esconde abas conforme o setor informado no login local). Controle de
  acesso de verdade só existe quando a Lista do SharePoint tiver permissão
  configurada e o SSO estiver ligado — ver `MODELO_DADOS_SHAREPOINT.md`.
- **Base de Frota real**: recebida em 2026 (`FROTA_Base_Final_2026.xlsx` e
  `Auditoria_FROTA_2026.xlsx`) — ver processamento e observações na próxima
  atualização deste documento.
