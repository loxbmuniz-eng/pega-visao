# Decisões confirmadas — Migração Suinco (Excel/VBA → Painel HTML)

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
> **Nem tudo aqui é história.** As decisões de OPERAÇÃO registradas neste
> arquivo continuam valendo — o que caiu foi a plataforma (SharePoint,
> Teams, MSAL), não as regras de pátio.

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
- **Senha das abas Programação/Indicadores — REMOVIDA.** Era uma senha fixa,
  compartilhada e em texto puro no arquivo entregue, criada quando o painel
  não tinha login nenhum. Com a autenticação individual e o setor vindo do
  token assinado, ela só atrasava quem tem direito de entrar e ensinava a
  operação a digitar uma senha coletiva que qualquer um lê no código-fonte.
  O controle real é o servidor: a aba só aparece para o setor certo e a API
  recusa a gravação de quem não tem permissão.
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

## 12. Ocultação de abas por setor: mantida (com o problema de descoberta resolvido)

**Problema relatado:** "está faltando a parte da Portaria e Faturamento, não
consigo fazer o input da placa que chegou, saiu, nem aba do Faturamento". As
telas existiam e funcionavam — o que faltava era poder **vê-las**.

**Causa:** `aplicarPermissoesSetor()` (app.js) aplica `hidden` em toda aba fora
do setor do operador, conforme `SETOR_PERMISSOES` (data.js). Entrando como
**Logística** — o setor que vem selecionado por padrão no formulário de login —
Portaria e Faturamento não aparecem na navegação. Para quem abre o painel, o
efeito não é "acesso restrito", é "a tela não existe".

**Decisão do usuário: a ocultação FICA como está.** Chegou-se a liberar todas
as abas para todos os setores, e o usuário revisou e pediu para voltar ao
comportamento anterior. Cada setor continua vendo apenas as próprias abas
(Torre de Controle e Histórico seguem liberados para todos).

**O que foi corrigido, então, já que a causa raiz não era a regra e sim a
descoberta:** o modal de login passa a dizer explicitamente quais abas cada
setor abre e que, para operar outro posto (cobertura de turno, por exemplo),
usa-se **Trocar usuário** no topo e entra-se com o setor correspondente.
Assim ninguém repete a conclusão de que a funcionalidade não existe.

Vale registrar que isto continua sendo conveniência de interface, não
segurança: quem tem o arquivo consegue contornar. Controle de acesso real só
existe com SharePoint + SSO (ver `RELATORIO_TI_HOSPEDAGEM.md`). O que garante
rastreabilidade é a trilha de auditoria — toda movimentação grava operador e
setor.

**Adicionado junto (pedido: "traga em cada aba sua função"):** um box no topo
de cada uma das 9 abas com o setor dono, o que se faz ali e o efeito no status
da carga (mapa `TAB_FUNCAO` em data.js, renderizado por
`atualizarAvisoSetorAba()` em app.js).

**Correções de interface na mesma rodada:**
- A aba Faturamento não tinha texto explicativo algum (só o título "Ação
  Rápida por Placa") e seu campo de placa não aceitava **Enter**, ao contrário
  das outras telas. Ambos corrigidos, por consistência.
- Os avisos (toasts) ficavam fixos logo abaixo da navegação e cobriam por 5
  segundos o box de função e o cabeçalho da primeira tabela. Movidos para o
  **rodapé à direita**.

## 13. Relatório e dashboard executivos detalhados

**Pedido:** "as cores dos status nos relatórios gerados são importantes, e
preciso que o dashboard executivo e os relatórios executivos sejam mais
detalhados por status de carga, ranking do dia, menor tempo maior tempo" —
mais, depois: "timeline pode aparecer no relatório executivo" e "e qual
operador fez o input".

**Cor de status é informação, não decoração.** Criado `STATUS_COR_RELATORIO`
(data.js) com a cor própria de cada um dos 6 status, usando exatamente os
mesmos valores das badges da tela (styles.css) — quem lê o PDF usa o mesmo
código de cores do painel, sem reaprender nada. Isso é diferente de
`STATUS_CARREGAMENTO_META`, que colapsa 3 status em "CARREGADO" verde: aquele
mapa é correto para a planilha de sequenciamento do pátio (onde só importa se
o caminhão está carregado), mas insuficiente para o executivo, que precisa
distinguir os 6. Os dois coexistem, cada um no seu lugar.
O `print-color-adjust:exact` já declarado em `html,body` é o que impede o
navegador de descartar esses fundos ao gerar o PDF.

**O relatório executivo (`exportarPdfExecutivo`) passou de 2 blocos para 8:**
1. Indicadores do topo, agora com **Concluídas Hoje** e **Lead Time Médio do
   dia** (antes só havia número histórico, que não é o que se cobra na
   reunião).
2. **Cargas em aberto por status** — tabela colorida, com % e barra de
   proporção. Os 6 status aparecem sempre, inclusive os zerados: etapa vazia
   também é informação, e omitir a linha esconderia que a etapa está parada.
3. **Cargas concluídas hoje por status.**
4. **Menor e maior tempo — Lead Time (hoje)**, com a carga inteira
   identificada (placa, nº, transportadora, destino) — sem isso o gestor não
   consegue agir sobre o caso extremo, que é o objetivo do dado.
5. **Menor e maior tempo — Permanência no pátio (hoje).**
6. **Ranking do dia** — só cargas concluídas hoje (`rankingDoDia()`),
   separado do ranking histórico.
7. **Linha do tempo das cargas** (concluídas hoje e ainda em aberto), em
   formato de **matriz**: uma linha por carga, uma coluna por etapa do fluxo.
   Cada célula traz a **hora** e o **operador** que registrou o passo, com o
   setor abaixo e a cor do status. Escolheu-se matriz em vez de repetir a
   timeline vertical da tela para cada carga porque assim o gestor compara as
   cargas entre si e enxerga de imediato onde uma delas travou. Etapa não
   ocorrida fica visivelmente vazia (`—`); etapa não aplicável — carga
   registrada direto no pátio, sem programação prévia, que nunca teve
   "Aguardando Veículo" — aparece como `n/a`, para não ser lida como atraso.
8. **Ranking histórico (top 5)** e rodapé com as definições de Lead Time,
   Tempo de Pátio e do recorte "hoje".

**O dashboard na tela (aba Indicadores) recebeu os mesmos dois blocos novos**
— distribuição por status colorida e menor/maior tempo do dia — para tela e
PDF contarem a mesma história. Na tela os extremos viram cartões (leem melhor
em monitor); no PDF, tabela.

**Funções novas na camada de dados (data.js):** `distribuicaoPorStatus()`,
`rankingDoDia()`, `extremosTempo(cargas, metrica)` e `fmtHora()`. `extremosTempo`
devolve `amostra: 0` quando nenhuma carga tem a métrica calculável, para a
interface dizer "sem dados" em vez de exibir `0 min` — que seria lido como
"tudo instantâneo" e é exatamente o tipo de número enganoso que este projeto
evita.

**Correção de layout junto:** as regras de `.print-header` viviam só dentro de
`@media print`, então em qualquer visualização fora da impressão a logo saía no
tamanho natural (enorme). Movidas para a base do CSS.

## 14. Modo claro e modo escuro

**Pedido:** "quero modo claro e modo escuro". Revoga a diretriz original de
"fundo escuro sempre, em tela e em PDF" (seção de design do `styles.css`).

**Como funciona:** um atributo `data-tema` no `<html>` — sem valor ou
`"escuro"` para o tema escuro, `"claro"` para o claro. Botão no cabeçalho
alterna. O botão mostra o tema **atual** (🌙 Escuro / ☀️ Claro), não o que
acontece ao clicar, por ser menos ambíguo em uso.

**Cor vira variável, sempre.** O trabalho de verdade não foi o botão, foi
tirar as cores fixas do caminho: badges, notificações, extremos, células de
linha do tempo, campos de formulário e os gráficos em canvas tinham hexadecimal
escrito à mão, que ficaria ilegível em fundo claro. Agora tudo sai de variável
CSS, com dois blocos: `:root` (escuro) e `:root[data-tema="claro"]`.

Três decisões que valem registro:

1. **`--gold` foi dividido em dois.** O dourado da marca funciona como
   *preenchimento* nos dois temas (fundo de botão e chip, sempre com texto
   escuro por cima), mas como *cor de texto* ele some sobre branco. Criou-se
   `--gold-text`, que no escuro é o mesmo dourado e no claro escurece para
   `#7a5c0d`. Títulos, links, números e cabeçalhos de tabela usam `--gold-text`;
   fundos continuam com `--gold`.

2. **As cores dos 6 status passaram a ser variáveis** (`--st-<slug>-bg/fg/br`),
   e o CSS virou a **fonte única** delas. `corStatusRelatorio()` (data.js), que
   antes tinha uma tabela própria de hexadecimais, agora lê essas variáveis por
   `getComputedStyle` — assim relatórios e gráficos, que montam cor em string
   ou pintam em canvas e não conseguem usar `var()`, seguem o tema sem manter
   uma segunda lista de cores que sairia de sincronia. No tema claro os status
   viram tinta clara com texto escuro, preservando a mesma leitura semântica
   (vermelho → verde).

3. **A preferência é guardada numa chave própria do localStorage
   (`suinco_tema`), fora do `DB`.** Tema é preferência do dispositivo — o
   monitor da Portaria pode querer claro e o do escritório escuro. Se fosse
   para o `DB`, iria junto para o SharePoint um dia e passaria a impor o mesmo
   tema a todos. Na primeira abertura o painel segue o
   `prefers-color-scheme` do sistema operacional; a partir da primeira troca
   manual, a escolha do usuário manda.

**Impressão:** o PDF sai no tema ativo — quem está no claro imprime claro (e
economiza toner), quem está no escuro mantém o PDF escuro de antes.

**Correção de legibilidade encontrada no caminho:** as células coloridas do PDF
Operacional usavam texto quase preto fixo (`#06210f`). Sobre o amarelo e o
verde funcionava, mas sobre o vinho de "NÃO ESTÁ NA SUINCO" o texto sumia.
Criou-se `textoSobre(cor)` (data.js), que escolhe texto claro ou escuro pela
luminância do fundo (fórmula do WCAG) — cor de status em relatório impresso é
informação e precisa ser legível em todas as faixas.

**Verificação:** contraste medido nos dois temas para texto/fundo, badge e
título sobre card — todos acima de 6:1, com folga sobre o mínimo AA de 4.5:1.

## 15. Integração SharePoint / Power BI — o que foi feito e o que ficou pendente

> **NOTA (auditoria de 07/08/2026).** A seção abaixo registra o que existia
> em 02/08/2026. Em 05/08/2026 (commits `c4730d2`, `4d7d5e5`) o adaptador
> `suinco-sharepoint.js` e a arquitetura SharePoint/MSAL/Graph inteira foram
> **removidos** — não é mais "pendente de credencial", é código que não
> existe mais no projeto. O painel hoje fala com o backend Node/Express/
> PostgreSQL próprio (`suinco-api.js`), login por e-mail e senha validados
> no servidor. Quem procurar aqui pensando "só falta o TI liberar
> `clientId`/`tenantId`/`siteId` para ligar" vai se enganar: não há mais o
> que ligar por esse caminho. Seção preservada como registro histórico da
> decisão original, não como pendência ativa.

Pedido: instalar MSAL.js v2, substituir o `SuincoStore` pelo adaptador
assíncrono anexado, gravar em `fact_Viagens` / `fact_StatusFrota` /
`dim_Veiculos` / `LOG_EVENTOS`, overlay de sincronia, modo offline, botão de
encerrar ciclo, acabamento Fluent e rodapé de conexão.

### O que está pronto e testado
- **MSAL.js v2** carregado no `<head>` (CDN da Microsoft).
- **`suinco-sharepoint.js`**: adaptador completo — SSO, Microsoft Graph,
  fila offline persistida, sincronia automática ao voltar a rede,
  `arquivarDia()`, e os campos `Operador_ID`, `Operador_Setor` e
  `Timestamp_Sincronia` em **todo** registro gravado (é o que permite o
  Copilot responder "quem autorizou a saída da placa X às 14h?").
- **Mapeamento para o BI**: cargas → `fact_Viagens`; cada mudança de status →
  `fact_StatusFrota` **e** `LOG_EVENTOS`; frota → `dim_Veiculos`.
- **Overlay** "Sincronizando com a Nuvem Suinco…", **badge** de modo offline,
  **botão** `🚀 Encerrar e Arquivar Ciclo` na aba de Logística, acabamento
  Fluent (cantos, elevação, foco) mantendo a paleta da Suinco.

### O que NÃO está conectado, e por quê
O adaptador não tem como falar com tenant nenhum enquanto `SP_CONFIG`
estiver vazio. Faltam **`clientId`, `tenantId` e `siteId`** — que só o TI
fornece, após o provisionamento da seção 9 do `RELATORIO_TI_HOSPEDAGEM.md`.
Até lá o painel roda em **modo local** e **diz isso no rodapé**.

**Decisão deliberada sobre o rodapé:** o texto pedido era fixo — "✅ Conectado
ao SharePoint | Alimentando Power BI em Tempo Real". Ele agora é **dirigido
pelo estado real**: `⚙️ Modo Local` sem credenciais, `⚠️ Modo Offline` sem
rede, e a frase de conectado **apenas quando houver conexão de fato**.
Exibir "conectado" rodando em localStorage seria afirmar ao TI algo falso na
reunião em que eles vão auditar exatamente isso — qualquer F12 derruba a
alegação e leva junto a credibilidade do resto do projeto.

### Defeitos corrigidos no adaptador recebido
O arquivo `suincoadaptersharepoint.js` foi usado como especificação, não
copiado: aplicado como estava, quebraria o painel. O que foi encontrado:

1. **Colisão fatal de declaração.** Ele declara `const SuincoStore`, que já
   existe em `data.js` — duas `const` de mesmo nome no escopo global é
   `SyntaxError`, e a página não abre. O adaptador virou um módulo à parte
   (`SuincoSharePoint`), e o `SuincoStore` passou a delegar a ele.
2. **Inversão de regra de negócio no `arquivarDia()`.** Filtrava
   `status === 'Faturado' || status === 'Concluído'`. **"Concluído" não
   existe** neste sistema, e **"Faturado" é caminhão que ainda está no
   pátio** — arquivaria justamente quem não saiu e deixaria de fora quem
   saiu ("Seguiu Viagem"). Corrigido.
3. **`save(tipo, item)`** com dois argumentos, enquanto `SuincoStore.save()`
   é chamado sem argumentos em **18 pontos** das regras de negócio. Trocar a
   assinatura quebraria toda gravação. Mantida a assinatura original.
4. **Funções inexistentes**: chamava `renderizarTudo()` (aqui é `renderAll()`)
   e `gerarCSV()` (aqui é `exportarCsvPowerBI()`).
5. **`loginPopup`** — popup é bloqueado dentro de aba do Teams. Trocado por
   `loginRedirect`, o fluxo correto nesse contexto.
6. **`Sites.ReadWrite.All`** dá escrita em todos os sites do tenant. Trocado
   por **`Sites.Selected`**, restrito ao site de Logística — é o que costuma
   passar em revisão de segurança.
7. **`load()` sobrescrevia `DB.cargas` inteiro** sem mesclar, descartando o
   que estivesse pendente localmente.
8. **Sem fila offline**: o `catch` salvava o DB inteiro no localStorage, mas o
   registro que falhou nunca era reenviado — perda silenciosa. Implementada
   fila persistida, drenada em ordem quando a rede volta.

### Gravação local-first (divergência consciente do pedido)
O pedido dizia "converta todas as funções de persistência para async/await".
Optou-se por **gravar local primeiro e sincronizar em segundo plano**, em vez
de `await` bloqueante a cada clique. Dois motivos: a Portaria registra chegada
com o caminhão parado na frente dela — travar o botão 300–800 ms por clique, ou
pior, perder o registro quando o wi-fi do pátio oscila, degrada a operação; e
tornar `SuincoStore.save()` assíncrona obrigaria a reescrever a máquina de
estados inteira, que a diretriz manda **não alterar**. O resultado é o mesmo do
ponto de vista do SharePoint (nada se perde: ou já subiu, ou está na fila), com
a interface respondendo na hora.

### Encerrar ciclo: não apaga nada por conta própria
`arquivarDia()` dispara o webhook do Power Automate e **não remove dado local**.
A limpeza da lista operacional é do fluxo no servidor, **depois** de o
arquivamento ter dado certo. Sem URL de fluxo configurada, a função avisa que
não arquivou e não apaga nada. Encerrar o dia é irreversível; apagar antes de
confirmar o arquivamento seria a forma mais fácil de perder um dia de operação.

### Revisão do adaptador (2ª versão recebida): o que foi aproveitado

A segunda versão do `suincoadaptersharepoint.js` acrescentou Microsoft Graph e
os metadados `Timestamp_Sincronia` / `Operador_ID` — ambos já presentes na
implementação. Os oito defeitos listados acima **permanecem** nela, incluindo
os dois que impedem o sistema de funcionar (segundo `const SuincoStore` e o
`arquivarDia()` filtrando `'Faturado' || 'Concluído'`). Seguem corrigidos.

Duas melhorias reais dela **foram adotadas**:

1. **`Operador_ID` passa a usar a identidade autenticada** (UPN/e-mail vindo
   do MSAL) em vez do nome digitado na tela de login. Diferença que importa:
   nome digitado é auto-declarado — qualquer pessoa digita qualquer nome —,
   enquanto o UPN é verificado pelo Entra ID. Numa pergunta como "quem
   autorizou a saída da placa X às 14h?", a resposta precisa se sustentar.
   Sem autenticação, o campo cai no nome digitado com o prefixo
   `(auto-declarado)`, e o booleano `Operador_Verificado` deixa a diferença
   explícita para quem consultar a Lista.
2. **`storeAuthStateInCookie: true`**, necessário quando o painel roda dentro
   do iframe do Teams, onde o retorno do redirect nem sempre enxerga o storage
   da janela.

Uma **não** foi adotada: `cacheLocation: "localStorage"` para os tokens.
Mantido `sessionStorage`. Nos terminais compartilhados do pátio, token em
localStorage sobrevive ao fechamento do navegador, e o próximo operador
herdaria a sessão do anterior — arruinando exatamente a trilha de auditoria
que esta integração existe para garantir.

## 16. "Pra onde?" — quatro opções explícitas (correção de 31/07/2026)

Lista corrigida pelo gestor para: **FROTA PRÓPRIA, CROSS-DOCKING, DEDICADA,
RET FRIGO**. Duas mudanças em relação ao que estava:

- `CROSS` passou a **`CROSS-DOCKING`** (nome por extenso).
- O valor **vazio**, que significava "Direto Suinco", virou **`FROTA PROPRIA`**
  com valor próprio. Não existe mais opção em branco.

**Por que acabar com o valor vazio importa:** vazio carregando significado é
armadilha. Ele some no filtro do Power BI, aparece como célula em branco no
relatório, e ninguém distingue "é frota própria" de "o campo não foi
preenchido". Com valor explícito, as duas coisas passam a ser distinguíveis —
e, se um dia aparecer carga sem classificação, isso vira um erro visível em vez
de se confundir com frota própria.

**Regra de "Compartilhada?" mantida, com os nomes novos:** `CROSS-DOCKING` e
`RET FRIGO` continuam sendo as duas que resultam em `Compartilhada = Sim`.
`FROTA PROPRIA` e `DEDICADA` resultam em `Não`. A regra segue calculada, nunca
editável à mão.

**Migração dos dados já gravados** (`migrarPraOnde()` em data.js): `''` vira
`FROTA PROPRIA` e `CROSS` vira `CROSS-DOCKING`, ao carregar. Qualquer valor
desconhecido cai no padrão. Sem isso, uma carga antiga gravada como `CROSS`
deixaria silenciosamente de contar como Compartilhada — mudando indicador e
relatório sem ninguém perceber. Testado com os cinco casos, inclusive valor
inválido.

**Ponto que ficou em aberto — vale confirmar:** o rótulo antigo descrevia
`DEDICADA` como "frota própria". Agora que FROTA PRÓPRIA é uma opção separada,
os dois não podem significar a mesma coisa. Não foi inventada uma definição
nova para DEDICADA: a descrição entre parênteses foi apenas removida, e a opção
segue funcionando. Se DEDICADA for, por exemplo, frota de terceiro contratada
com exclusividade, basta dizer e o rótulo é ajustado.

Cor no relatório operacional: FROTA PRÓPRIA recebeu `#16697a` (teal), distinta
das três já existentes — azul para CROSS-DOCKING, vinho para DEDICADA, dourado
para RET FRIGO.

## 17. Relatórios: impressão em papel branco (correção de 31/07/2026)

**Sintoma relatado:** "os relatórios estão saindo em preto e branco".

**Causa:** o relatório herdava as cores do tema do painel. No tema escuro o
texto é quase branco — quando o navegador descarta os fundos coloridos (o
padrão da caixa de impressão do Chrome, na opção *Gráficos de segundo plano*),
sobra texto claro em papel branco e o relatório fica ilegível.

**Correção:** a impressão passou a ter identidade própria — papel branco, texto
escuro — independente do tema em que o painel esteja. As cores sólidas dos 6
status continuam nas células (estilo inline, de especificidade maior que as
regras de impressão), então:

- imprimindo **com** gráficos de fundo: a escala de cores do gestor sai
  completa, como antes;
- imprimindo **sem**: o relatório sai legível em preto sobre branco, em vez de
  praticamente vazio.

A legenda de status ganhou borda sólida, que imprime nos dois casos.

**Observação de verificação:** a primeira medição sugeriu que a página saía
totalmente em branco sem os gráficos de fundo. Isso era artefato do teste
automatizado: `imprimirContainer()` esconde o container no evento `afterprint`,
que a própria geração de PDF dispara — a segunda impressão da bateria pegava o
container já oculto. O teste foi corrigido para reabrir o relatório antes de
cada impressão.

## 18. Nomes de coluna corrigidos nos relatórios e formulários

Três rótulos descreviam mal o que a coluna carrega. Nenhum valor gravado mudou
— só o rótulo —, então nada invalida registro existente nem o modelo do Power BI.

| Antes | Agora | Motivo |
|---|---|---|
| "Pra onde?" | **Tipo de Operação** | O campo guarda FROTA PRÓPRIA / CROSS-DOCKING / DEDICADA / RET FRIGO, que é *como* a carga é operada, não para onde vai. O destino já tem campo próprio. |
| "Rota" (relatório) | **Destino** | Mostrava `c.destino`; o rótulo "Rota" sugeria outra coisa. |
| "Empresa" | **Transportadora** | Ambiguidade que originou a confusão da placa RMW1A91 — "empresa" podia ser lida como operadora/cliente. O dado sempre foi `c.transportadora`. |
| "Perfil" | **Tipo de Veículo** | Mostrava `c.tipoVeiculo`. |

**Qtd. Ganchos** no relatório operacional passou a exibir o número em negrito e
centralizado, com "Liso" quando é zero — antes o número se perdia visualmente
na última coluna.

## 19. Campo Rota (31/07/2026)

Lista oficial de rotas passada pelo gestor, com código, praça e — quando há —
o operador logístico responsável. **30 rotas cadastradas**, sem duplicatas.

O **código é o valor gravado**, porque é o que a operação usa no dia a dia
("carga da 510"); o nome acompanha para quem ainda não decorou o número.

**A lista está incompleta de propósito.** Faltam os códigos **511, 514, 515,
526, 527, 528, 530, 531, 533, 535, 537 e 539**, que o gestor informou que
enviaria depois. Por isso **"(rota não informada)" segue sendo opção válida**:
tornar a rota obrigatória travaria a Programação exatamente nas praças que
ainda não foram cadastradas. Para incluir as que faltam, basta acrescentar a
linha em `ROTAS` (data.js) — os dois formulários, as tabelas, o relatório e o
export do Power BI se atualizam sozinhos.

**Dois níveis de rótulo, por uma razão prática:** a rota 504 sozinha lista
cinco municípios (Paracatu, Unaí, João Pinheiro, Arinos e Buritis). O nome
completo esticava a linha inteira do relatório impresso para caber numa célula.
Então: `rotaLabel()` (completo, com cidades e operador) no formulário e na
ficha da carga, onde há espaço; `rotaCurta()` (só código + praça) nas tabelas
e no relatório.

Rota entra também no export do Power BI, em três colunas separadas —
`RotaCodigo`, `RotaNome`, `RotaOperador` — para permitir agrupar por praça ou
por operador logístico sem precisar quebrar texto no BI.

## 20. Ordenação do relatório operacional pela linha do tempo

**Sintoma relatado:** "está meio confuso, o Seguiu Viagem antes do Faturado e
Carregado".

**Causa:** o relatório ordenava apenas pela sequência de carregamento. Uma
carga que já saiu aparecia acima de outra ainda em faturamento só por ter
sequência menor, embaralhando as etapas.

**Correção:** a ordenação passa a ser, primeiro, a etapa da carga na linha do
tempo dos 6 status e, dentro de cada etapa, a sequência de carregamento. A
ordem segue a própria linha do tempo — o que ainda não chegou fica no topo, o
que já saiu fica no fim —, de modo que a parte que ainda exige ação está sempre
na parte de cima da folha.

A sequência de carregamento não se perdeu: virou **coluna própria (Seq.)**, ao
lado do Nº de ordem de leitura do relatório. Status desconhecido, vindo de
registro antigo, vai para o fim da lista em vez de subir ao topo por conta do
índice −1.

## 21. Relatório operacional: status na frente e tabela cabendo na folha

**Status na frente.** Os três campos de estado — Status (etapa dos 6), Status de
Carregamento (leitura do pátio) e Faturado — passaram para as primeiras
colunas, na ordem em que a linha do tempo acontece. Antes o Status ficava no
meio da tabela, entre "Tipo de Operação" e "Placa", e era preciso caçar a
informação mais importante no meio das colunas de cadastro. Identificação
(Seq., Carga, Destino, Rota, Placa, Transportadora) vem depois, porque responde
"qual carga é", não "em que pé ela está".

**Tabela estourando a folha — defeito encontrado ao conferir o PDF gerado.**
Com 16 colunas, a tabela ultrapassava a largura do A4 deitado e o navegador
cortava as últimas colunas na borda: a **Qtd. Ganchos simplesmente não saía no
papel**, apesar de estar correta na tela. Corrigido com `table-layout:fixed` e
larguras por coluna, mais quebra de linha nos cabeçalhos — que herdavam
`white-space:nowrap` e passavam por cima da coluna vizinha ("Status de
Carregamento" cobria "Faturado").

## 22. CSV do Power BI: colunas de texto protegidas do Excel

**Problema relatado:** a coluna J (`TipoVeiculo`) traz "3/4", que o Excel
converte sozinho em data ao abrir o CSV — e o valor chega corrompido no
Power BI.

**Correção:** os valores ambíguos passam a sair no formato `="3/4"`, a forma
reconhecida de dizer ao Excel "isto é texto, não interprete". Aplicada apenas
onde há ambiguidade real: "Carreta", "Truck" e "Toco" continuam saindo limpos.
Cobre também `NumeroCarga` com zero à esquerda ("007", que o Excel reduzia a 7).

**Escopo: SOMENTE a coluna `TipoVeiculo`.** A primeira versão desta correção
protegia também `Placa`, `NumeroCarga` e `RotaCodigo` — o que alterava o formato
de colunas que estavam corretas (o número de carga `007` passava a sair como
`="007"`). O gestor apontou o excesso e a lista foi reduzida à única coluna com
problema real. `CSV_COLUNAS_TEXTO` (data.js) não deve ser ampliada sem um caso
concreto de corrupção.

Cabeçalhos e demais colunas de todos os CSVs foram conferidos contra a versão
anterior à correção: **idênticos**.

**Fluxo confirmado pelo gestor:** o CSV exportado é aberto no Excel antes de ir
ao Power BI. É exatamente o caso que a sintaxe `="..."` resolve — ela é
específica do Excel. (Se algum dia o Power BI passar a ler o arquivo direto, sem
Excel no meio, o certo seria voltar ao valor cru `3/4` e deixar o BI inferir
texto.)

## 23. Senha removida da aba Relatórios (31/07/2026)

A pedido do gestor, **Relatórios** deixa de exigir senha e abre direto. Faz
sentido operacional: é a aba que a operação consulta e compartilha ao longo do
dia, e a barreira atrapalhava mais do que protegia.

Seguem com senha de interface: **Programação** e **Indicadores**.

Vale repetir o registro da seção 9.4 do relatório do TI: isto nunca foi
controle de acesso. A senha está em texto puro no código, visível com Ctrl+U.
Tirá-la de Relatórios não reduz segurança real, porque não havia segurança real
a reduzir — controle de acesso de verdade só passa a existir com a permissão
por Lista do SharePoint mais o SSO.

## 24. `index.html` passa a ser o arquivo único publicado (05/08/2026)

Havia duas branches divergindo sobre o mesmo nome de arquivo. A branch que a
Vercel publica renomeou `painel_suinco_completo.html` → `index.html`; a branch
de trabalho tinha renomeado `index.html` → `index_suinco.html`. As duas
estavam certas isoladamente e incompatíveis juntas.

**Decisão:** um nome só, com papéis separados.

| Arquivo | Papel |
|---|---|
| `index_suinco.html` | **Fonte.** Referencia styles.css, data.js, app.js e o logo como arquivos separados. É o que se edita. |
| `index.html` | **Build.** Arquivo único gerado, com tudo embutido. É o que a Vercel publica em embarquesuinco.com.br e o que se manda por e-mail/WhatsApp. |

Consequências práticas:

1. `build_arquivo_unico.py` agora grava em `index.html`. O fallback que aceitava
   `index.html` como fonte foi removido — com a saída tendo esse nome, o
   fallback faria o build se alimentar da própria saída e embutir CSS e JS duas
   vezes.
2. **`index.html` não se edita à mão.** Qualquer alteração se faz na fonte e
   depois `python3 build_arquivo_unico.py`. Editar o build direto funciona até o
   próximo build, que apaga a alteração sem avisar.
3. Os testes em `testes/` apontam para `index.html` — passam a exercitar
   exatamente o arquivo que vai ao ar, não uma cópia parecida.

`painel_suinco_completo.html` deixa de existir. Quem tiver o link antigo salvo
precisa trocar pelo domínio: **embarquesuinco.com.br**.

## 25. Auditoria "superpowers" (07/08/2026) — dois bugs de dado, corrigidos; lista para depois

Pedido: aplicar as skills de depuração sistemática e revisão de código do
plugin `superpowers` para caçar bugs do mesmo formato do que travava o
"Chegou" naquela sessão (mudança local otimista, servidor recusa, ninguém
avisa) — e fechar duas lacunas concretas já mapeadas.

### Corrigidos nesta sessão, cada um com teste de regressão

1. **Chegada sem programação da Portaria era rejeitada em silêncio.**
   `registrarChegadaPortaria()` cria a carga localmente e sobe pelo mesmo
   `POST /api/cargas` da Programação — que só aceitava Logística/
   Administração. A rejeição (403) nem lançava exceção (`upsert()` retorna
   `{recusado:true}`), e `sincronizarCargasAlteradas()` só tratava exceção
   lançada. Efeito real: caminhão chega sem programação, a Portaria
   registra, a tela mostra sucesso, e a carga nunca existe no banco — some
   de todos os outros terminais. Existia até uma função pronta para esse
   caso (`podeRegistrarChegadaSemProgramacao`, em `dominio/fluxo.js`) —
   escrita e nunca chamada por rota nenhuma. Corrigido: `POST /api/cargas`
   agora aceita dois caminhos (programação normal vs. `aguardandoCarga:true`
   sem trava de frota, com o servidor ignorando qualquer campo de negócio
   que o corpo tente mandar nesse segundo caso — só a placa é do cliente).
2. **`liberarPendencias()` nunca era chamada.** `_pendente`/
   `_statusPendentes` só eram limpos no sucesso imediato; uma carga que
   passasse pela fila offline ficava marcada como pendente PARA SEMPRE,
   mesmo depois de a gravação subir — e como a marca vai para o
   `localStorage` inteiro, o bloqueio sobrevivia a fechar a aba. A regra 3
   de `fundirEstadoRemoto` recusava qualquer atualização remota daquela
   carga a partir daí. Corrigido: `liberarPendencias()` liga no callback
   `aoReceberDados` já existente, quando `SuincoSharePoint.pendentes()===0`.
3. **Generalização do item 1**: qualquer recusa de criação/edição de carga
   (não só a chegada sem programação) ficava só no console. Adicionado
   `aoRecusarCarga`/`receberRecusaDeCarga`, espelhando o par
   `aoRecusarStatus`/`receberRecusaDeStatus` que já existia para status.
4. **`capacidadeKg:0` virava `null`** em `POST /api/frota`
   (`Number(x) || null` — falsy collapse). Corrigido para
   `Number.isFinite`.
5. **`backend/src/rotas/cadastros.js` tinha zero teste** — as oito outras
   baterias de `api.test.js` nunca batiam em `/api/frota` nem `/api/rotas`.
   Fechado: `describe('9. Cadastros — Frota e Rotas', ...)`, 16 casos.
6. **Documentação órfã do SharePoint/MSAL** — `RELATORIO_DE_TESTES.md`,
   `ARQUITETURA_E_OPERACAO.md` e a seção 15 deste documento descreviam a
   arquitetura MSAL/SharePoint (removida em 05/08/2026, ver seção 24) como
   se ainda estivesse pendente de credencial. Anotado com nota de correção
   em cada um, sem apagar o texto original — preservado como registro
   histórico.

### Achados a triar — resolvidos em 08/08/2026

A lista de candidatos (função exportada/definida com zero chamadas) foi
lida um a um e decidida — nenhum ficou em aberto:

**Excluídos (comprovadamente mortos, com evidência, não só ausência de
chamada):**
- `blocoExtremos` + `renderExtremosHoje` (`app.js`) + `extremosTempo`
  (`data.js`): formavam o bloco "menor/maior tempo" do PDF e da tela de
  Indicadores. O próprio código já documentava a substituição — comentário
  em `app.js` (bloco de 05/08/2026): *"Substitui os extremos maior/menor
  por média contra meta"* — e o alvo de `renderExtremosHoje`
  (`#ind-extremos-wrap`) não existe mais no HTML. CSS órfão correspondente
  (`.extremo-bloco`, `.extremo-card` etc., os que só essas duas funções
  usavam) removido junto.
- `podeEditarCadastros` (`backend/src/dominio/fluxo.js`): a preocupação
  registrada aqui era risco de divergência com `exigirSetor('Logística')`,
  usado de fato em `rotas/cadastros.js`. Não existe divergência: o
  middleware `exigirSetor` (`middleware/auth.js`) já inclui
  `'Administração'` automaticamente em QUALQUER chamada, sempre — a mesma
  regra que `podeEditarCadastros` reimplementava. A função nunca teve
  propósito próprio; só duplicava uma garantia que já existe num lugar só.
- `proximoStatus` (`backend/src/dominio/fluxo.js`): comentário dizia "usado
  pelo painel para desenhar o botão certo", mas é função de backend — o
  painel (frontend) não a chama nem poderia. Confirmado sem chamador em
  nenhuma rota. Cada tela desenha seu próprio botão de avanço
  explicitamente; nunca existiu um "próximo status genérico" no frontend
  para esta função alimentar.

**Mantidos, decisão registrada (não é esquecimento, é escolha):**
- `comOverlaySync` + `mostrarSyncOverlay`/`esconderSyncOverlay` (`app.js`):
  infraestrutura pronta para mostrar um overlay de "sincronizando" durante
  uma operação — nunca foi ligada a nenhuma chamada real. Diferente do
  cluster de extremos, não há evidência de que foi substituída por outra
  coisa; é uma capacidade construída e não adotada, não uma sobra. Mantida:
  custo de existir é zero, e é candidata natural a entrar quando o
  redesenho visual (pendente, ver pedido do usuário em 08/08/2026) decidir
  dar feedback visual de sincronia.
- `corTextoSobre` (`app.js`) e `textoSobre` (`data.js`): duas implementações
  do mesmo utilitário de acessibilidade (cor de texto que contrasta com um
  fundo), nenhuma chamada hoje porque os gráficos atuais sempre acompanham
  legenda numérica em vez de depender só de cor. Mantidas por serem
  utilitários de acessibilidade prontos — descartar agora só para
  reescrever igual durante o redesenho visual não compensa. Ao entrar no
  redesenho, decidir ali se as duas convergem numa só (a de `data.js` usa a
  fórmula de luminância relativa do WCAG, mais correta; a de `app.js` é uma
  aproximação mais simples).
- `estaFaturado` (`data.js`) e `rankingDoDia` (`data.js`): utilitários
  pequenos, corretos, sem custo de manutenção. Mantidos — não há sinal de
  que foram substituídos, só ainda não usados.

### Decisão sobre o cliente Socket.IO — fechada em 07/08/2026

O único script externo que o painel carrega hoje é o cliente Socket.IO
(`index_suinco.html`, infraestrutura própria — `api.embarquesuinco.com.br`
— não CDN de terceiro), sem verificação de integridade. Avaliadas as duas
alternativas (fixar hash SRI; embutir cópia estática no build único) e as
duas trocam o risco atual por um pior: as duas dependem de alguém lembrar
de atualizar manualmente a cada vez que o backend mudar de versão do
pacote `socket.io`, e a versão embutida pode degradar em SILÊNCIO (cai
para a consulta periódica sem avisar) em vez de travar visivelmente como o
SRI travaria.

**Decisão: manter como está.** Buscar o cliente do próprio servidor a cada
carga nunca desalinha por construção — o `socket.io` do servidor sempre
serve o cliente correspondente à sua própria versão, sem passo manual
nenhum. O que a integridade protegeria (um MITM alterando o script em
trânsito) já é coberto pelo HTTPS; o que sobraria (o próprio servidor
comprometido) já dá a um atacante acesso a tudo o resto do sistema.
Raciocínio completo em `ARQUITETURA_E_OPERACAO.md` §6.4.

## 26. ATAK: nenhuma integração por API — do ERP, só relatório exportado e importado (29/09/2026)

Decisão do dono, em duas mensagens do mesmo dia:

- Sobre o **Delivery B2B**: *"o que é colocado no Delivery B2B muitas vezes é
  preenchido por um motorista e não são dados fiéis, só então caiu essa ideia
  de integrar ao Delivery B2B, pois o nosso processo de dev já resolve"*.
- Sobre o **ERP Atak ("Sisatak")**: *"sai, tudo que formos pegar do Atak ERP
  vai ser exportando relatório deles e importando no sistema, como estamos
  fazendo com as devs agora"*.

**O que vale daqui em diante:**

1. O painel **não** se conecta à API de nenhum sistema da ATAK — nem Delivery
   B2B, nem ERP. Não há chamado de integração aberto.
2. A **fonte da verdade da devolução é o ciclo do painel** (carimbo de cada
   setor, pesagem, destinação, nota), não a ocorrência registrada pelo
   motorista.
3. Todo dado do ERP entra pelo caminho do WRMVE790 (`POST
   /api/devolucoes/:id/sisatak`, `dominio/sisatak.js`,
   `servicos/planilha_xls.js`): alguém **exporta o relatório no Sisatak** e
   **importa no painel**, com prévia antes de gravar, marcação do que já foi
   importado (não duplica) e recusa explicada na tela. O próximo relatório
   (frota, clientes, rotas…) chega do mesmo jeito: o dono manda o arquivo.

**O que foi avaliado e descartado**, para ninguém reabrir sem saber o motivo:
a proposta de 29/09 de ler por API a ocorrência de entrega do Delivery B2B e
abrir o checklist sozinha (apresentação "Devolução integrada ao Delivery B2B"
e rascunho de chamado). Caiu pela fidelidade do dado, não por custo ou prazo.

## Pagamento de Frete (05/10/2026) — Daniela da Logística, via Alysson; decisões do dono

1. **Só PDFs entram**: DeliveryB2B ("Relatório de Status das Entregas") e Atak
   (WRVDA501 — Notas por Carga), um por carga ou vários numa vez. **Nada de
   importar XLSX**; o leitor de XLSX fica no código, sem botão, "para o painel
   entender a linguagem" (`dominio/planilha_controle.js`).
2. **A aba é a planilha**: as colunas A–P da planilha da Daniela, na ordem,
   mais Q–V (% Entregue, % Liberado, % Pago, A pagar agora, Data Tratativa,
   Observação). O arquivo exportado é **idêntico ao modelo aprovado**
   (CONTROLE_CARGAS, RESUMO, LEIA-ME), gerado da MESMA grade da tela.
3. **Acesso por setor** — "os usuários permanecem na aba de usuários, e as
   permissões são definidas lá": setor "Pagamento de Frete" (migração 058,
   CHECK + `fluxo.js` + `data.js`). Sem marca por pessoa, sem tela nova.
   A Administração entra sempre.
4. **Percentual pela quantidade de notas**, sem valor em R$ ("mais o
   checklist mesmo para controle").
5. **Paga-se direto só a nota Finalizada** no B2B; as outras precisam de
   consulta no sistema — só a tratativa OK / OK B2B libera.
6. **Carga VERIFICAR não libera nada** ("conferir"); pagar assim pergunta e
   exige confirmação. 100% é teto; anular exige motivo e não apaga.
7. **Data do pagamento manual**, pode ficar em branco.
8. Vocabulário das tratativas = o da planilha dela (SEM TRATATIVA, DEV, DEV
   NO SISTEMA, OK B2B, OK, SUMIU DO B2B). O sentido escrito no LEIA-ME ainda
   depende da confirmação da Daniela; a transportadora é preenchida à mão
   (os PDFs não a trazem).
10. **Rodada 2 (05/10, tarde).** Tratativas: SEM TRATATIVA · DEVOLUÇÃO · OK ·
    SUMIU DO B2B — "tira o OK B2B e DEV NO SISTEMA e substitui a DEV por
    DEVOLUÇÃO"; OK e DEVOLUÇÃO liberam ("quando for dado OK, ou mudado pra
    DEVOLUÇÃO, o status precisa mudar pra A PAGAR"). Status p/ pagamento é o
    que fazer: conferir / A PAGAR / PARCIAL / INTEGRAL (INTEGRAL = 100% liberado
    e 100% pago; LIBERADA ainda não paga mostra A PAGAR — proposta aceita).
    Data Pagamento, Data Tratativa e Observação editáveis; Transportadora só
    das cadastradas na Frota ("melhora o relacionamento com o nosso banco").
    Pagar em carga 100% liberada já vem 100%. Vitrine avisa que não grava.
    Fluxo da Daniela (99 finalizadas + 1 pendente → parcial hoje → semana que
    vem OK/DEVOLUÇÃO → A PAGAR → INTEGRAL) coberto por teste de ponta a ponta.
11. **Os dois relatórios são O modelo** ("sempre será assim; nunca deve chegar
    um que não siga"). O leitor lê pela estrutura e recusa o que foge dela;
    o campo CARGA do B2B pode vir "103-001-118771" — o número é o último
    trecho (#112).
12. **Rodada 45 (05/10, fim de tarde).** (a) Nota do sistema que FALTA no B2B é
    pendência normal ("Não localizada no B2B"): não entra no liberado e não
    trava a carga — a 118771 (31 × 30) ficou PENDENTE · A PAGAR 74,2%; "ela
    fica pendente, não libera a carga integral". VERIFICAR só com nota só no
    B2B, B2B com mais notas que o sistema, ou nada finalizado. (b) "Todo estado
    é um selo com texto e cor" — situação, o que fazer, tratativa, resumo das
    pendências, canhoto. (c) A aba é uma fila de trabalho: topo "O que fazer
    hoje" (A PAGAR · Pendências sem olhar · Conferir) e "Panorama"; ordem por
    prioridade; idade das pendências sem tratativa (dias desde que entraram,
    destaque acima de 7); pagamento em lote das A PAGAR (um lançamento por
    carga); Fechamento por mês do pagamento, provisão e idade — contagem de
    notas, sem R$. (d) Filtros amplos (carga, transportadora, data do
    pagamento, data da consulta, pendências, situação, status) e exportação do
    recorte da tela, com o filtro escrito no topo do arquivo. (e) Sem lembrete
    de reimportar: "ela decide; se não for preciso, altera manualmente; se
    for, reimporta". SUMIU DO B2B fica (a nota estava e depois não aparece).
    (f) Governança: reimportar sobrescreve com memória e deixa trilha do antes;
    pagamento repetido em 2 min pergunta; vigia diário de integridade da aba.
9. **Canhoto original: uma caixinha por carga, sim ou não** — "isso não
   interfere na questão do fechamento do digital, é só para acompanhamento".
   Não entra em liberado, pago nem a pagar. Marcar carimba o dia e quem marcou
   (migração 059; colunas W–X da planilha; cartões no RESUMO, inclusive
   "Pagas sem canhoto" — 100% pago e o papel não chegou).

## Relatório de Administração de Fretes (05/10/2026) — dono

- Período de mais de um dia sai **separado por dia**, cada dia com cabeçalho
  e a sua lista, na planilha e no PDF; a sequência recomeça no 1 por dia.
- **Data da Programação e Data do Faturamento** nos dois; **KM e Frete** no
  PDF (a planilha já tinha o KM). Só este relatório muda.


## 27. Sentry: erros do painel e do servidor num lugar só, sem dado de cliente (07/10/2026)

Pedido do dono ("Use Sentry for this"); registro aprovado em 07/10 ("1 e 2"),
conteúdo pela recomendação. Conta: organização `suinco` no Sentry, plano
grátis, sem cartão — nada aqui pode gerar cobrança.

**O que já existe (✅ no ar, fora do código):**
- projetos `suinco-painel` e `suinco-servidor`;
- um vigia de disponibilidade ATIVO na API (`/health`, a cada 60 s, alerta
  depois de 3 falhas seguidas). O vigia do site foi criado e DESLIGADO: o
  plano grátis cobre um.

**Como entra no código (⬜ proposta, vai pelo fluxo da casa):**

1. **O painel não carrega o SDK do Sentry.** O SDK do navegador custa dezenas
   de KB, e o painel tem 7 KB de folga no limite de 760 KB
   (`test_logo_uma_copia_so`); também abriria uma conexão do navegador com um
   terceiro (CSP do `vercel.json`). O painel manda o erro para a NOSSA API
   (`POST /api/erros`, ~1 KB de código: `window.onerror` +
   `unhandledrejection`, com a fila offline que o `suinco-api.js` já tem), e o
   servidor repassa ao Sentry. Um ponto só de filtro, nenhuma mudança de CSP,
   o painel continua funcionando sem internet.
2. **O servidor usa o SDK oficial de Node**, ligado SÓ se existir
   `SENTRY_DSN` no `backend/.env`. Sem a variável, nada muda — o servidor
   antigo e o novo se comportam igual (regra "SEM ESTA MIGRAÇÃO"). A chave
   nunca entra no git; o `backend/.env.exemplo` ganha a linha vazia.
3. **O que vai:** mensagem e pilha do erro, rota, versão (commit), ambiente,
   SETOR de quem estava usando.
4. **O que NUNCA vai** (LGPD — skill `lgpd`): corpo da requisição, parâmetros
   da URL, cookie, token, nome de pessoa, telefone, CPF, nome de cliente,
   nota fiscal. `sendDefaultPii` desligado, `beforeSend` apaga
   `request.data`, `query_string` e `cookies`. Gravação de tela (Replay):
   desligada — ela filmaria dado de cliente.
5. **Prova antes de publicar:** teste que provoca um erro e confere que o
   envio sai SEM os campos proibidos, e que o servidor sem `SENTRY_DSN` sobe
   igual.

**Depende do servidor:** o Luis acrescenta a linha `SENTRY_DSN=` no `.env`
do servidor (o valor é passado a ele fora do chat e do git), depois do
`atualizar_tudo.sh` que levar o código.

**Emenda de 08/10/2026 — como entrou no código (🟡 commitado; vale depois do
portão e do `atualizar_tudo.sh`).** Pela recomendação, informada no relato:

1. **Sem o SDK do Sentry também no servidor.** O envio é um POST no formato
   "envelope" do Sentry, montado campo a campo por LISTA BRANCA
   (`backend/src/servicos/erros.js`, `montarEvento`). O SDK manda tudo e
   apaga o proibido depois; aqui só sai o que está escrito. Uma dependência
   a menos no `npm ci`.
2. **`POST /api/erros` exige login**, como toda rota de operação (a barreira
   SEGURANÇA 3 da bateria reprovou a rota aberta — e estava certa). Erro na
   tela de entrada fica de fora: se a entrada quebra, ninguém entra, e isso
   ninguém deixa de ver. Com login, ninguém de fora gasta a cota.
3. **O aviso do painel não entra na fila offline**: a fila é de gravação da
   operação e o rodapé conta as pendentes. Sem rede, o aviso se perde.
4. **Cada origem no seu projeto**: `SENTRY_DSN` (suinco-servidor) e
   `SENTRY_DSN_PAINEL` (suinco-painel, opcional; vazio = vai tudo para o do
   servidor com a etiqueta `origem`). O `/health` responde `sentry:
   {servidor, painel}` — ligado ou não, sem SSH.
5. **Queda do servidor**: o erro é gravado no disco na hora
   (`erro_da_ultima_queda.json`, só com a chave) e enviado na subida
   seguinte; o processo continua caindo como antes (`uncaughtExceptionMonitor`
   observa, não segura).
6. **Freio**: o mesmo erro uma vez por hora; no máximo 20 envios a cada 10
   minutos; 30 avisos por minuto por pessoa na rota; 10 por página aberta.
7. **Limpeza da mensagem**: e-mail, token, CPF, CNPJ, telefone, número de
   5 dígitos ou mais (carga, nota) e valor citado depois de dois-pontos. A
   rota vai como molde (`/api/cargas/:id`); a pilha, sem `?parâmetros`.

Prova: bloco 58 do `api.test.js` (13 testes, contra um Sentry falso local) e
`test_erro_da_tela_vai_ao_servidor` (pela tela). Ambos reprovaram contra o
código publicado.

8. **A chave entra por script, não por editor** (`backend/scripts/ligar_sentry.sh`):
   o `.env` guarda a senha do banco e a chave do login, e uma linha perdida
   num editor derruba o servidor. O script confere o formato do DSN, guarda
   cópia, troca só as linhas `SENTRY_DSN*`, reinicia e confere o `/health`;
   se o servidor não voltar, devolve o `.env` de antes. Prova:
   `testes/ligar_sentry.test.js` (6).

## 28. Conector da Hostinger: ler à vontade, mudar só com ordem, comprar e apagar nunca (07/10/2026)

O dono ligou o conector da Hostinger à conta onde roda o servidor
(VPS KVM 2, 2.25.95.253). Ligar não cobra; mas o MESMO conector consegue
comprar servidor no cartão cadastrado, reinstalar e apagar. Por isso, três
faixas — registro aprovado em 07/10 ("1 e 2"):

| Faixa | Operações | Regra |
|---|---|---|
| **Ler** | estado do servidor, métricas (CPU, memória, disco, tempo no ar), lista de backups, varredura de vírus (Monarx), DNS | rotina; sem pedir |
| **Mudar** | tirar foto (snapshot), reiniciar, firewall da Hostinger | só com ordem do dono, dizendo antes, em uma linha, o que muda |
| **Nunca por iniciativa** | comprar, reinstalar (`recreate`), restaurar backup, apagar foto/backup/DNS | nem sugerido como atalho; se for necessário, é decisão do dono com o passo a passo conferido como comando de servidor |

**Foto antes de cada atualização.** Antes de mandar o `atualizar_tudo.sh`
para o dono rodar, a foto do servidor é tirada e conferida ("pronta"). Se a
atualização der errado, o servidor volta inteiro em minutos, sem conserto à
mão. Cuidados:
- a Hostinger guarda UMA foto: a nova substitui a anterior;
- foto não substitui o backup do banco — o passo 2 do `atualizar_tudo.sh`
  (prova de que o backup restaura) continua;
- sessão sem o conector: a foto é tirada pelo painel da Hostinger (hPanel),
  e o roteiro diz isso em vez de pular o passo.

**Achados da primeira leitura (07/10/2026), a investigar:**
- backups da Hostinger em 29/09, 04/10, 05/10 e 06/10 — nenhum de 30/09 a
  03/10. Falta saber se é a regra do plano ou falha;
- nenhum grupo de firewall da Hostinger no servidor. Não quer dizer servidor
  aberto (pode haver firewall por dentro); conferir pelo diagnóstico antes
  de propor qualquer mudança.

## 29. Carga sem movimentação há mais de 3 dias é INATIVA (07/10/2026)

Decisão do dono, em duas mensagens: *"caminhão no pátio com mais de 7 dias
considerado inativo, some dos indicadores e para de poluir dados, mesmo
para cargas"* — e logo depois: *"na verdade 3 dias após última
movimentação"*.

**O que vale (✅ painel no ar no portão 54, `7a4458a`, 07/10; a coluna "Inativa" da porta do Power BI vale depois da migração 064 no servidor):**
1. Inativa = carga no pátio (ainda não "Seguiu Viagem") com mais de 3 dias
   desde a ÚLTIMA movimentação. Automático, pelo relógio.
2. Sai de todo indicador, dos relatórios executivos, da contagem do Pátio
   ao vivo e da porta do Power BI — uma função só para todos.
3. Volta a ativa sozinha se receber movimentação nova.
4. Na Torre (recomendação aceita sem objeção): sai da fila principal para
   um bloco recolhido "Inativos (mais de 3 dias)".
5. Nada é apagado: continua no Histórico com todas as datas.

**Descartado no mesmo dia, para ninguém reabrir:** a regra da auditoria
noturna "nenhuma movimentação há horas em dia útil" — *"isso aqui não
precisa pois por exemplo hoje temos muitas cargas no carregamento e é
normal um caminhão passar até no máximo 3 dias no pátio"*.

## 30. Quadro por transportadora: quatro números, sem devolução e sem pontualidade (07/10/2026)

Na aba Indicadores, uma linha por transportadora, só para Logística e
Administração (número sensível de fornecedor), sem nota única nem ranking:
cargas concluídas · tempo de pátio típico (mediana) · cargas com CT-e ou
canhoto pendente · % de frete combinado.

**Devolução ficou de fora**, com as palavras do dono: *"não são todas as
devoluções que entram no Embarque Suinco, porque existem devoluções que nem
voltam para a Suinco, então as devoluções da aba Devoluções são somente as
devoluções que retornaram pra Suinco, então esse dado não é concreto
integralmente"*. Volta quando houver a fonte completa — por exemplo um
relatório do Sisatak com todas as devoluções, importado como o WRMVE790.

**Pontualidade ficou de fora:** ninguém registra a hora combinada de chegada.
Para medir, a Programação precisaria de um campo a mais — decisão adiada até
os quatro números estarem em uso.

## 31. Quem usa o painel em qual aparelho (09/10/2026)

Com as palavras do dono: *"na verdade quem usa no celular é expedicao e
administracao, portaria nao usa no celular, comercial usa no celular"*,
*"logistica usa no celular"*, *"ninguem usa no tablet"*.

- **Celular:** Logística, Expedição, Administração e Comercial.
- **Portaria:** computador. Não usa celular.
- **Tablet:** ninguém.

**Substitui** o que estava no `PRODUCT.md` desde 08/10 ("na Portaria o
aparelho de trabalho é tablet ou PC fixo") e a auditoria `/impeccable`, que
tratava 1024×768 e 768×1024 como "o tablet da Portaria".

**O que muda por causa disso:**
- saem da fila as duas propostas pensadas para tablet: a "ação em um
  clique" da Portaria a duas telas no tablet em pé, e a Torre truncando
  placa e peso no tablet deitado;
- o Lote 5b (#127, portão 73) **fica como está** — *"mas tudo bem deixa do
  jeito que ta"*: o cabeçalho em duas linhas até 820 px vale para janela
  estreita e para o celular;
- a paridade de celular (`suinco-paridade-mobile`) mira quem usa o
  telefone: Logística, Expedição, Administração e Comercial.

**Lote 6 do /impeccable descartado (09/10/2026, mesmo dia).** As skills novas
(make-interfaces-feel-better, humanizer, stop-slop, antislop, better-icons)
foram passadas no painel como lente e viraram proposta: emoji das listas
vazias trocados pelos ícones do painel, toque de 44 px em dois títulos dos
Indicadores no celular, botão que afunda ao apertar, títulos equilibrados e
três textos reescritos. O dono aprovou e, antes de qualquer mudança, voltou
atrás: *"na verdade ta bom como esta nao precisa fazer isso"*. Nada foi
alterado. As skills continuam instaladas em `.claude/skills/` para uso
futuro; o levantamento não vira fila.

## 32. A Logística trabalha na aba Pagamento de Frete (09/10/2026)

**Do dono:** *"vamo liberar o pagamento de frete pra logistica pois as meninas
precisam ter acesso pra poder fazer alteracao, deixa o acesso liberado pra
logistica"*.

A pergunta que faltava — a permissão é por SETOR (decisão de 05/10: "os
usuários permanecem na aba de usuários, e as permissões são definidas lá"),
então vale para todo o setor Logística, não só para "as meninas"; e se era o
acesso completo ou só editar — foi feita e dispensada pelo dono. Ficou o
recomendado, que é o que a frase dele diz: **acesso completo, para o setor
Logística inteiro.**

- **A Logística faz na aba tudo o que o setor Pagamento de Frete faz:**
  importar os PDFs, editar CT-e, transportadora e datas, pagar e anular
  pagamento, excluir e restaurar carga, exportar a planilha e o PDF
  detalhado, cadastrar transportadora sem placa (esse já tinha, #129).
- **Não muda:** o setor Pagamento de Frete continua só com a aba dele;
  Portaria, Expedição, Faturamento, Comercial, Qualidade e filiais
  continuam sem a aba; nada no pátio muda.
- **Onde mora:** `SETORES_DA_ABA_FRETE` em `backend/src/dominio/fluxo.js` —
  as rotas da aba e o PDF detalhado leem dali; no painel, a aba `frete` na
  linha da Logística em `SETOR_PERMISSOES` (`data.js`).
- **Enquanto o servidor não for atualizado** a Logística vê a aba e lê
  *"O servidor ainda não liberou a Logística nesta aba — passa a valer quando
  o servidor for atualizado"* — e não "esta aba é de outro setor", que a
  mandaria pedir à Administração um acesso que ela já tem.

Travado por `test_logistica_no_pagamento_de_frete` (pela tela, com a API de
verdade; reprovou no publicado) e pelo bloco 61 do `api.test.js`.
