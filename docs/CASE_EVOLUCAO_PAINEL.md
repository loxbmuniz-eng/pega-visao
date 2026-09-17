# Painel Programação de Embarque Suinco — evolução do projeto

**Uso interno Suinco.** Contém dados de operação, de sistema e de cadastro da
empresa. Não distribuir fora da companhia.

| | |
|---|---|
| **Data do documento** | 16/09/2026 |
| **Escopo** | do início do projeto até 16/09/2026 |
| **Fontes** | banco de dados `embarque_suinco`; `docs/REGISTRO_DE_OCORRENCIAS.md`; histórico de versões (`git`) do repositório; documentação do projeto em `entregaveis/suinco_logistica/docs/` |
| **Ambiente consultado** | banco **local de desenvolvimento**. O banco de produção roda na VPS e não é alcançável a partir deste ambiente. Toda consulta deste documento está escrita para ser executada em produção, somente leitura, na seção 10 |

> **Advertência de método.** Este documento separa três categorias de número:
> **(a) apurado** — consulta ou comando executado, com saída;
> **(b) apurado em produção por terceiro** — medição feita no ambiente do
> gestor e transcrita, com data e origem;
> **(c) não apurado** — declarado como não apurado, com o motivo.
> Nenhum valor foi estimado, arredondado para cima ou inferido.

---

## 1. Sumário executivo

| Indicador | Valor | Categoria | Fonte |
|---|---|---|---|
| Suítes de teste de navegador | **188** (`test_*.py`) + 2 auditorias = 190 na bateria | (a) | `ls testes/test_*.py testes/auditoria_*.py \| wc -l` |
| Conferências dentro dessas suítes | **2.435** | (a) | contagem de chamadas `ck(...)` |
| Casos de teste de API (servidor) | **436** | (a) | `grep -cE "^\s*test\(" backend/testes/*.js` |
| Migrações de banco versionadas | **53** | (a) | `ls backend/migrations/*.sql \| wc -l` |
| Ocorrências de produção registradas | **72** (#01 a #72), de 14/08/2026 a 16/09/2026 | (a) | `docs/REGISTRO_DE_OCORRENCIAS.md` |
| Ocorrências com o teste que as trava citado pelo nome | **67 de 72 (93,1%)** | (a) | varredura do registro, §10 |
| Publicações canceladas pelo portão antes de chegar à operação | **16 ocasiões documentadas** | (a) | varredura do histórico de versões, §10 |
| Vulnerabilidades conhecidas nas dependências do servidor | **0** (0 críticas, 0 altas, 0 moderadas, 0 baixas) | (a) | `npm audit`, executado em 16/09/2026 |
| Veículos no cadastro oficial | **749 placas** | (a) | `SELECT count(*) FROM dim_veiculos` |
| Rotas cadastradas | **126**, das quais **125 ativas** | (a) | `SELECT ativa, count(*) FROM dim_rotas GROUP BY ativa` |
| Setores com permissão própria no fluxo | **12** | (a) | `backend/src/dominio/fluxo.js`, lista `SETORES` |
| Cargas movimentadas em produção | **467 cargas, 17 em aberto, 2.992 movimentações** em 15/09/2026 | (b) | registro do navegador da gestão, transcrito no commit `b19d1b4` |
| Tempo médio de cada etapa do ciclo | **não apurado** | (c) | ver §5 |

---

## 2. De onde o projeto partiu

A documentação do projeto registra o estado anterior em duas peças datadas:

- **31/07/2026** — `docs/RELATORIO_EXECUTIVO.md`: *"A Suinco controla hoje a
  expedição em uma planilha Excel com macros."* O mesmo documento descreve o
  modo de consolidação então vigente: cada setor enxergava a sua parte do
  processo e a consolidação acontecia por conversa, telefone e mensagem.
- **02/08/2026** — `docs/RELATORIO_EXECUTIVO_DIRETORIA.md` registra a pergunta
  que o projeto se propôs a responder — quantos veículos estão no pátio agora,
  há quanto tempo cada um está lá e onde o processo está travando — e o estado
  anterior: a resposta chegava por telefone, mensagem e deslocamento até o
  pátio, já desatualizada, e não ficava registrada. O mesmo documento registra
  que a planilha era sobrescrita, de modo que perguntas de série histórica não
  tinham como ser respondidas.

**Marcos de arquitetura, conforme a documentação do projeto:**

| Data | Marco | Fonte |
|---|---|---|
| 31/07/2026 | Primeiro relatório executivo; painel descrito como funcionalmente completo, sem backend provisionado | `docs/RELATORIO_EXECUTIVO.md` |
| 04/08/2026 | Início do plano de implantação (`GO_LIVE_MASTER.md`) | `GO_LIVE_MASTER.md`, campo "Início" |
| 05/08/2026 | Substituição da arquitetura SharePoint/Microsoft Graph/MSAL por backend próprio Node + PostgreSQL em VPS. A arquitetura SharePoint **nunca entrou em produção**: nenhuma Lista foi provisionada e nenhum dado da operação passou por ela | nota de auditoria em `docs/ARQUITETURA_E_OPERACAO.md`; aviso no topo de `docs/RELATORIO_EXECUTIVO.md` |
| 14/08/2026 | Primeiras ocorrências de produção registradas (#03 e #04) | `docs/REGISTRO_DE_OCORRENCIAS.md` |
| 20/08/2026 | Primeiro commit do painel presente **neste repositório** | `git log --reverse -- entregaveis/suinco_logistica` |

**Limite desta fonte, declarado:** o histórico de versões deste repositório
para o painel começa em **20/08/2026**. Os commits `c4730d2` e `4d7d5e5`,
citados na documentação como a virada de arquitetura de 05/08, **não estão
neste repositório** — foi verificado com `git cat-file -t`, que responde
"Not a valid object name". As datas anteriores a 20/08 vêm da documentação
do projeto, não do registro de versões.

---

## 3. O que foi construído

Núcleo operacional, conforme o código em produção:

| Componente | Definição |
|---|---|
| **Máquina de 6 etapas** | `Aguardando Veículo → Aguardando Embarque → Embarque Iniciado → Embarque Finalizado → Faturado → Seguiu Viagem`. Transição inválida é recusada no servidor, não só na tela (`backend/src/dominio/fluxo.js`) |
| **Permissão por setor** | 12 setores, cada um com a lista do que pode fazer. Modelo de lista de permissão: setor que não consta na lista é barrado por omissão |
| **Escopo de filial** | Filiais 105, 106 e 107 enxergam e operam apenas o que é delas |
| **Ciclo de devolução em 6 etapas** | Checklist digital repartido entre Portaria, Faturamento, Expedição, Controles Internos e Central de Notas, com registro de autor e horário por etapa (`devolucoes.js`, `backend/src/dominio/devolucoes.js`) |
| **Trava de frota** | Placa fora do cadastro não vira carga |
| **Trilha de auditoria** | Toda mudança de etapa grava autor, setor e horário em `fact_statusfrota`; toda alteração de carga grava revisão em `carga_revisoes` |
| **Fila offline** | Sem rede, o painel declara a condição na tela e não grava no vácuo |
| **Arquivo único** | O painel é um único `index.html`, o que permite abrir no celular do pátio sem instalação |
| **Portão de publicação** | `publicar.sh` roda a bateria completa e só mescla na branch de entrega se tudo passar (§7) |

Tamanho do código hoje, medido com `wc -l`:

| Arquivo | Linhas |
|---|---|
| `app.js` (telas e ações) | 12.559 |
| `styles.css` | 6.069 |
| `data.js` (estado, máquina de estados, sincronia) | 3.731 |
| `devolucoes.js` | 2.600 |
| `suinco-api.js` | 2.317 |
| `index_suinco.html` | 1.975 |
| **Painel, total** | **29.876** |
| `backend/src/**/*.js` | 9.820 |
| `testes/test_*.py` | 34.478 |
| `backend/testes/*.js` | 7.740 |

A relação entre código de produção (39.696 linhas) e código de teste
(42.218 linhas) é de **1,06 linha de teste por linha de produção**.

---

## 4. Volume

### 4.1. O que foi apurado no cadastro (categoria a)

| Indicador | Valor | Consulta |
|---|---|---|
| Veículos no cadastro | 749 | `SELECT count(*) FROM dim_veiculos;` |
| Origem do cadastro de veículos | 100% `seed` (carga inicial a partir de `frota_seed_2026.csv`, 749 placas) | `SELECT origem, count(*) FROM dim_veiculos GROUP BY origem;` |
| Rotas cadastradas | 126 (125 ativas, 1 aposentada) | `SELECT ativa, count(*) FROM dim_rotas GROUP BY ativa;` |
| Clientes no cadastro | 77.100 | `SELECT count(*) FROM dim_clientes;` |
| Setores com permissão no fluxo | 12 | `backend/src/dominio/fluxo.js`, `SETORES` |

Os três primeiros valores têm confirmação cruzada na documentação do projeto
(749 placas constam de `frota_seed_2026.csv` e de `docs/RELATORIO_EXECUTIVO_DIRETORIA.md`;
as rotas têm código e praça reais). O total de clientes **não tem confirmação
cruzada**: foi lido no banco local de desenvolvimento e deve ser reconferido em
produção com a consulta V8 da §10 antes de ser citado externamente.

### 4.2. O que foi apurado em produção por terceiro (categoria b)

O commit `b19d1b4` (16/09/2026) transcreve o registro de desempenho colhido no
navegador da gestão em **15/09/2026, às 15:27, 15:32 e 15:37**. Ele contém a
única medição de volume de produção disponível para este documento:

| Indicador | Valor em 15/09/2026 |
|---|---|
| Cargas na base local do terminal | **467** |
| Cargas em aberto | **17** |
| Movimentações registradas | **2.992** |
| Rotas sincronizadas | **113** |
| Veículos sincronizados | **749** |

**Ressalva:** esse número reflete o que o terminal daquele usuário mantinha em
memória. Desde 09/09/2026 o painel poda a cópia local para **30 dias**
(commit `624a6ea`), buscando o período anterior no servidor sob demanda. As
467 cargas são, portanto, a janela de 30 dias daquele terminal — **não** o
total histórico. O total histórico só pode ser obtido no banco de produção,
com a consulta V1 da §10.

### 4.3. O que não foi apurado, e por quê (categoria c)

O banco local consultado neste documento contém **0 cargas ativas** e
**9 movimentações**, todas criadas em 16/09/2026 pelas próprias suítes de
teste. Trinta e três dos 42 registros em `operadores` são contas de teste.
Este banco **não** contém dados de operação. A saída é reprodutível:

```
SELECT count(*) FROM fact_viagens WHERE excluida_em IS NULL;   -->  0
SELECT count(*) FROM fact_statusfrota WHERE apagada_em IS NULL; -->  9
SELECT min(data_evento)::date, max(data_evento)::date
  FROM fact_statusfrota;                     --> 2026-09-16 | 2026-09-16
```

Em consequência, **não foi apurado neste documento**: número total de cargas
que passaram pelo painel, número de veículos efetivamente utilizados, número de
rotas efetivamente utilizadas, número de operadores reais ativos e distribuição
de cargas por setor. As consultas para apurar cada um desses itens em produção
estão na §10.

---

## 5. Ciclo (chegada → embarque → faturamento → saída)

**Não apurado.** Motivo: a tabela `fact_statusfrota` do ambiente consultado não
contém transições de operação (§4.3). O cálculo de tempo por etapa exige a
série de transições de produção.

O que já está definido no sistema e permite o cálculo assim que a consulta for
executada em produção:

- Cada transição grava `data_evento` com o **instante do fato**, não o da
  edição. A regra está escrita no código (`data.js`, linha 1991): carimbar a
  hora da edição faria o indicador mentir a favor da operação.
- A meta de tempo de pátio está definida em **180 minutos (3 horas)**, no
  parâmetro `META_TEMPO_PATIO_MIN` de `data.js`, e é configurável em
  `DB.config.metaTempoPatioMin`. O documento registra que 3 horas é o objetivo
  declarado pela gestão, não um número derivado de medição.
- A definição de atraso adotada, por não existir hora prometida por rota:
  uma carga está atrasada quando o tempo total em pátio (chegada → saída)
  ultrapassa a meta.

**Sobre tendência:** mesmo com a consulta executada em produção, a série
disponível cobre aproximadamente **33 dias** (14/08/2026 a 16/09/2026, pela
data da primeira e da última ocorrência registrada). Trinta e três dias, com
sazonalidade semanal e sem controle de mix de rota, **não sustentam afirmação
de tendência**. A consulta V3 da §10 devolve a série semanal; ela serve para
estabelecer a **linha de base**, não para declarar melhoria.

**Linha de base a registrar agora.** Para que o próximo ciclo tenha
comparação, recomenda-se executar as consultas V1 a V5 em produção **na mesma
data**, arquivar a saída com data e responsável, e repetir em 90 dias.

---

## 6. Cobertura e confiabilidade

### 6.1. Evolução da cobertura de teste

| Data | Cobertura declarada | Fonte |
|---|---|---|
| 02/08/2026 | 10 baterias automatizadas, **78 verificações** | `docs/RELATORIO_EXECUTIVO_DIRETORIA.md` |
| 21/08/2026 | **260** testes de servidor + **95** suítes de navegador | `MIGRATION-GAPS.md`, seção "Como ler este documento" |
| 16/09/2026 | **436** casos de API + **188** suítes de navegador, com **2.435** conferências | apurado nesta data, §10 |

Crescimento de 21/08 para 16/09: casos de API **260 → 436 (+67,7%)**;
suítes de navegador **95 → 188 (+97,9%)**.

### 6.2. O registro de ocorrências

`docs/REGISTRO_DE_OCORRENCIAS.md` tem **3.319 linhas** e **72 ocorrências**
numeradas, de 14/08/2026 a 16/09/2026. Cada uma registra o relato de quem viu o
problema, a causa raiz, a correção e **o teste que impede que ela volte**.

| Indicador | Valor |
|---|---|
| Ocorrências registradas | 72 |
| Ocorrências que citam pelo nome o teste ou a guarda que as trava | **67 (93,1%)** |
| Ocorrências sem teste citado | 5 (#03, #04, #39, #47, #59) |
| Famílias de defeito catalogadas no índice | 14 |

O registro classifica as ocorrências em **famílias** — padrões recorrentes de
causa, e não de sintoma. Exemplos do índice: *"a mesma decisão escrita em dois
lugares"*, *"eco de sincronização"*, *"teste que mede o proxy, não a regra"*,
*"regra larga demais"*. A finalidade declarada é operacional: reconhecer a
família reduz o tempo de diagnóstico da próxima ocorrência da mesma família.

**Evidência de que o mecanismo funciona:** a ocorrência #72 (16/09) está
registrada como parente da #71 (16/09) — as duas são "decisão aplicada no nível
errado": na #71, gravar por linha quando bastava por lote; na #72, proibir
quebra de página na tabela inteira quando bastava proibir na linha. O
diagnóstico da segunda se apoiou explicitamente na primeira.

### 6.3. Segurança das dependências

`npm audit` no servidor, executado em 16/09/2026:
**0 críticas, 0 altas, 0 moderadas, 0 baixas, 0 informativas.**

---

## 7. O portão de publicação — o valor do controle

`publicar.sh` existe por uma razão documentada no cabeçalho do próprio script:
em 25/08 e 26/08/2026, três problemas chegaram à operação pela mesma porta — uma
mudança subiu ao painel dependendo de algo que o servidor ainda não tinha, e o
aviso disso dependia de alguém lembrar de dar. Os três casos estão nomeados no
script: botão "Excluir usuário" publicado sem a rota correspondente no servidor;
de-duplicação da montagem dependendo da migração 035, que não havia sido
aplicada, resultando em **53 linhas duplicadas** em um dia de operação; e a
repetição do mesmo caso no dia seguinte.

O portão roda a bateria completa e **só mescla na branch de entrega se tudo
passar**. Ele também confere se o arquivo gerado está em dia, se há migração
declarada e não aplicada em produção, e imprime as pendências que precisam ser
repassadas.

**Publicações canceladas pelo portão antes de chegar à operação: 16 ocasiões
documentadas** no corpo das mensagens de commit, entre 26/08/2026 e 16/09/2026.

| Data | Commit | O que o portão barrou |
|---|---|---|
| 26/08 | `09e1f2a` | Cancelou no passo 3 (comparação do arquivo gerado) |
| 26/08 | `05a63ca` | Componente de aviso estourando o cabeçalho em tela pequena |
| 27/08 | `1185591` | 110 verdes, 1 vermelho na fila de avisos |
| 02/09 | `d067bdc` | Barrou no passo 7: migração pendente sem a declaração do que quebra sem ela |
| 02/09 | `3f7005c` | Teste de gráficos dependente do dia do mês |
| 08/09 | `e367950` | Regressão: a Torre parou de guardar a sequência digitada |
| 09/09 | `96fad76` | Painel não cabia no celular em dois pontos |
| 10/09 | `55f982f` | Guarda de colunas da Montagem desatualizada (11 → 14 colunas) |
| 10/09 | `f264088` | Etapa 7: migração 049 sem declaração. Bateria passou inteira antes: 154 verdes, 0 falhas |
| 10/09 | `511fd9b` | Guardas medindo a trava antiga de placa |
| 11/09 | `545d517` | Suíte reaproveitando a API de outra porta |
| 12/09 | `2c51124` | Testes criando sessão pelo mecanismo antigo |
| 14/09 | `721705c` | 23 testes no lugar antigo da sessão |
| 16/09 | `40516c3` | Logo quebrada no cabeçalho de todo relatório impresso |
| 16/09 | `db070df` | Dois testes de devolução medindo a regra anterior |
| 16/09 | `635d421` | Regressão: guarda de toque duplo prendendo a tela de segundo fator |

**Ressalva de apuração:** o portão **não mantém registro persistente de
execuções** no repositório. As 16 ocasiões acima são as que estão escritas no
corpo de uma mensagem de commit. O número total de execuções canceladas é
**maior ou igual a 16 e não é apurável** a partir do repositório. As mensagens
citam numeração interna que chega a "v38" em 16/09, o que indica pelo menos 38
execuções do portão — mas a numeração não é gravada em arquivo e esse valor
não pode ser confirmado.

**Dois desses casos merecem destaque por medirem o valor do controle:**

1. `40516c3` (16/09) — a remoção das cópias da logo quebrou o cabeçalho de
   **todo relatório impresso**. O teste escrito para a mudança conferia se a
   classe CSS estava no arquivo; estava, e a logo não aparecia. O portão barrou
   por outro teste, existente para outra finalidade. O teste foi então
   reescrito para renderizar o cabeçalho como o servidor renderiza e **contar
   as cores do recorte**: 1 cor reprova (1 cor é branco puro — a marca não está
   lá). Medição depois da correção: **1.224 cores**.
2. `f264088` (10/09) — a bateria passou inteira (154 verdes, 0 falhas) e o
   portão barrou assim mesmo, na etapa 7, por uma migração declarada e sem a
   descrição do que quebra sem ela. É a classe de falha que teste de código não
   pega e que já havia chegado à operação duas vezes em agosto.

---

## 8. O que o painel substituiu

| Antes (documentado) | Agora (no sistema) | Fonte do "antes" |
|---|---|---|
| Planilha Excel com macros, sobrescrita ao fim do dia | Registro persistente em `fact_viagens` e `fact_statusfrota`, com revisão por alteração em `carga_revisoes` | `docs/RELATORIO_EXECUTIVO.md`, 31/07/2026 |
| Consolidação entre setores por conversa, telefone e mensagem | Doze setores com permissão própria no sistema, oito deles atuando no fluxo da carga, sobre a mesma carga e na mesma tela | `docs/RELATORIO_EXECUTIVO.md`, 31/07/2026 |
| "Quantos caminhões estão no pátio agora" respondido por telefone e deslocamento, já desatualizado e sem registro | Torre de Controle, com filtro por etapa e tempo de pátio por carga | `docs/RELATORIO_EXECUTIVO_DIRETORIA.md`, 02/08/2026 |
| Perguntas de série histórica sem resposta possível, porque a planilha era sobrescrita | Trilha de auditoria acumulada por transição, com autor, setor e horário | `docs/RELATORIO_EXECUTIVO_DIRETORIA.md`, 02/08/2026 |
| Cadastro de frota desatualizado nos terminais: **1.289 placas fora de operação** e **327 com transportadora errada** em navegadores com a versão antiga | Cadastro central em `dim_veiculos` (749 placas), atualizado no servidor | `docs/RELATORIO_EXECUTIVO_DIRETORIA.md`, §2.3 |
| Nota de transferência da devolução de filial anotada fora do sistema | Campo obrigatório no checklist, recusado pelo servidor se ausente (16/09/2026) | commit `825b44f` |
| Vale-pedágio da programação do dia montado a partir de planilha recebida como imagem, com a coluna de placa lida por dedução | Processo documentado em `docs/PEDAGIO_DA_PROGRAMACAO.md`, com as divergências da planilha de origem registradas como pergunta em aberto, não como correção silenciosa | commit `35231d2` |

**Item não apurado:** a economia de tempo de digitação e de conferência que a
substituição da planilha produziu **não foi medida**, nem antes nem depois.
Não existe registro de quanto tempo a operação gastava com a planilha. A §9
descreve como estabelecer essa linha de base.

---

## 9. Comparação de mercado

Escopo da comparação: sistemas de gestão de pátio (YMS) e de agendamento de
doca, que é a categoria comercial mais próxima do painel.

### 9.1. Preço

| Fornecedor | Preço publicado | Observação e fonte |
|---|---|---|
| **Opendock (Loadsmart)** | **Não publicado pelo fornecedor.** Comparativo de terceiros de 2026 indica **US$ 6.000 a US$ 7.000 por instalação por ano** | O valor não vem da página de preços do fornecedor; vem de diretório de software e análise independente, e deve ser tratado como faixa de referência, não como cotação. [LoadingCalendar, "How Much Does Dock Scheduling Software Cost? (2026)"](https://www.loadingcalendar.com/en/blog/how-much-does-dock-scheduling-software-cost) |
| **GoRamp** | **A partir de US$ 175/mês** para agendamento de doca; **a partir de € 249/mês** para a plataforma completa com gestão de pátio | Preço escalona por número de docas, usuários e módulos; escopos maiores exigem cotação. [GoRamp em Capterra](https://www.capterra.com/p/204639/GoRamp/) |
| **C3 Reservations** | **Não publicado.** Licenciamento por instalação, baseado em uso, apenas sob cotação | Posicionado para centros com 10+ docas e 100+ agendamentos por dia, com implantação conduzida por equipe de projeto. [G2 — C3 Reservations Pricing](https://www.g2.com/products/c3-reservations/pricing), atualizado em 12/02/2026 |
| **Senior YMS (Gestão de Pátio)** | **Modelo público, valor não apurado.** Vendido como SaaS com prazo determinado de **36 meses**, pagamento mensal, mais **serviço de implantação em pagamento único** | O modelo comercial está publicado; o valor está na loja online do fornecedor, que **não pôde ser acessada deste ambiente** (bloqueio de rede de saída). [Senior — YMS Gestão de Pátio](https://site.senior.com.br/sistema-de-logistica/yms-gestao-de-patio/) · [loja](https://store.senior.com.br/loja/seniorstore/produto/ate-250-agendamentos-yms/gestao-de-patio) |
| **TOTVS YMS** | **Não publicado.** Somente sob cotação | [TOTVS YMS](https://www.totvs.com/logistica/yms/) |

**Conclusão de preço, declarada com a incerteza que tem:** de cinco
fornecedores pesquisados, **nenhum publica preço na própria página**. Dois
(Opendock, GoRamp) têm faixa citada por terceiros. Um (Senior) publica o modelo
comercial e o prazo de 36 meses, mas o valor não foi apurado. Dois (C3, TOTVS)
operam exclusivamente por cotação. **Qualquer comparação de custo total exige
cotação formal**, e este documento não apresenta nenhuma.

### 9.2. Resultado publicado pelos fornecedores

| Alegação | Valor | Fonte |
|---|---|---|
| Redução de custo de detenção, clientes do segmento de bebidas | **até 72%** | Página de indústria do Opendock (via resultado de busca; a página não pôde ser acessada diretamente deste ambiente) |
| Horas de trabalho de armazém economizadas por ano | **600** | idem |
| Aumento de fluxo processado | **30%** | idem |

**Ressalva.** Circula a referência a *"−62% de espera"* e *"+31% de giro de
doca"* atribuída ao Opendock. **Essas duas cifras não foram confirmadas** nesta
pesquisa. As três cifras acima são as que apareceram nas fontes consultadas, e
mesmo elas vêm de material de marketing do próprio fornecedor, sobre a operação
de clientes nos Estados Unidos. **Não são números da Suinco e não são
comparáveis com a operação da Suinco** sem uma linha de base medida aqui.

### 9.3. O que um YMS de mercado não cobre no fluxo desta casa

Comparação funcional, não de preço. Os itens abaixo são específicos do processo
da Suinco e estão implementados no painel:

| Recurso | Por que não é padrão de mercado |
|---|---|
| **Ciclo de devolução em 6 etapas com permissão por setor** | O checklist de devolução é repartido entre Portaria, Faturamento, Expedição, Controles Internos e Central de Notas, cada um assinando a sua etapa. YMS de mercado trata devolução como recebimento, não como processo de cinco assinaturas |
| **Escopo de filial** | Filiais 105, 106 e 107 operam com visão restrita ao que é delas, no mesmo sistema, e com uma regra própria — nota de transferência obrigatória — que não vale para a matriz |
| **Sobras e divergências de devolução** | Tabelas `devolucao_divergencias` e `devolucao_itens`, com rastro de item que sai da devolução |
| **Fila offline** | O pátio opera com cobertura irregular. O painel guarda a pendência e declara a condição na tela, em vez de gravar no vácuo |
| **Arquivo único que abre no celular do pátio** | Um único `index.html`, sem instalação, sem loja de aplicativos, sem dependência de rede corporativa |
| **Portão de publicação** | Nenhum fornecedor entrega o controle de mudança do cliente. Aqui ele é código versionado, e barrou 16 publicações documentadas (§7) |

---

## 10. Como cada número foi apurado

### 10.1. Comandos executados neste ambiente

A partir de `/home/user/pega-visao/entregaveis/suinco_logistica`:

```bash
# Suítes de navegador na bateria
ls testes/test_*.py testes/auditoria_*.py | wc -l                 # 190
ls testes/test_*.py | wc -l                                       # 188

# Conferências dentro das suítes (chamadas ck(...), menos as definições)
tot=$(grep -rhoE "(^|[^a-zA-Z_])ck\(" testes/test_*.py | wc -l)    # 2622
defs=$(grep -rhcE "^def ck\(" testes/test_*.py | awk '{s+=$1}END{print s}')  # 187
echo $((tot-defs))                                                # 2435

# Casos de teste de API
grep -rhoE "^\s*test\(" backend/testes/*.js | wc -l               # 436

# Migrações versionadas
ls backend/migrations/*.sql | wc -l                               # 53

# Vulnerabilidades de dependência
npm --prefix backend audit --json | \
  python3 -c "import sys,json;print(json.load(sys.stdin)['metadata']['vulnerabilities'])"
# {'info':0,'low':0,'moderate':0,'high':0,'critical':0,'total':0}

# Linhas de código
wc -l data.js app.js devolucoes.js suinco-api.js styles.css index_suinco.html
find backend/src -name "*.js" | xargs wc -l | tail -1
wc -l testes/test_*.py | tail -1
wc -l backend/testes/*.js | tail -1
```

Ocorrências registradas e cobertura por teste:

```bash
python3 - <<'EOF'
import re
t=open('docs/REGISTRO_DE_OCORRENCIAS.md',encoding='utf-8').read()
b=re.split(r'^## (#\d+)',t,flags=re.M); ids=b[1::2]; corpos=b[2::2]
com=[i for i,c in zip(ids,corpos)
     if re.search(r'(Guarda|Teste que trava|O TESTE|Testes?:)',c,re.I)
     or re.search(r'test_[a-z0-9_]+\.py|\.test\.js',c)]
print("ocorrências:",len(ids),"| com teste citado:",len(com),
      "| sem:",[i for i in ids if i not in com])
EOF
# ocorrências: 72 | com teste citado: 67 | sem: ['#04','#03','#39','#47','#59']
```

Publicações canceladas pelo portão, a partir de `/home/user/pega-visao`:

```bash
for h in $(git log --all --pretty=format:"%h"); do
  b=$(git log -1 --pretty=format:"%B" $h | tr 'ÃÁÀÂÉÊÍÓÔÕÚÇ' 'ãáàâéêíóôõúç')
  if echo "$b" | grep -qiE "port(ã|a)o[^.]{0,12}(reprov|cancel|barr|impediu|pegou)|reprovaram o port|reprovou o port|publicação cancelada"; then
    echo "$h | $(git log -1 --date=short --pretty=format:'%ad | %s' $h)"
  fi
done | sort -t'|' -k2
# 16 linhas
```

### 10.2. Consultas para executar no banco de PRODUÇÃO

Todas são **somente leitura** (`SELECT`). Nenhuma altera dado. Devem ser
executadas por quem tem acesso à VPS, com a saída arquivada junto da data e do
responsável. **Nenhuma delas retorna nome de pessoa** — os agregados são por
setor.

```sql
-- V1 · VOLUME TOTAL DE CARGAS E PERÍODO COBERTO
SELECT count(*)                                                   AS cargas,
       count(DISTINCT placa)       FILTER (WHERE placa <> '')      AS placas_usadas,
       count(DISTINCT rota_codigo) FILTER (WHERE rota_codigo <> '') AS rotas_usadas,
       min(criado_em)::date        AS primeiro_dia,
       max(criado_em)::date        AS ultimo_dia,
       (max(criado_em)::date - min(criado_em)::date) AS dias_cobertos
  FROM fact_viagens
 WHERE excluida_em IS NULL;

-- V2 · MOVIMENTAÇÕES, SETORES E OPERADORES QUE USARAM O SISTEMA
SELECT count(*)                       AS movimentacoes,
       count(DISTINCT carga_id)       AS cargas_movimentadas,
       count(DISTINCT operador_id)    AS operadores_distintos,
       count(DISTINCT setor)          AS setores_distintos,
       min(data_evento)::date         AS primeiro_dia,
       max(data_evento)::date         AS ultimo_dia
  FROM fact_statusfrota
 WHERE apagada_em IS NULL;

-- V3 · CICLO MÉDIO POR ETAPA, EM MINUTOS  (a linha de base do §5)
WITH etapa AS (
  SELECT carga_id, status_novo, min(data_evento) AS em
    FROM fact_statusfrota
   WHERE apagada_em IS NULL
   GROUP BY carga_id, status_novo),
p AS (
  SELECT carga_id,
     max(em) FILTER (WHERE status_novo = 'Aguardando Embarque')  AS chegou,
     max(em) FILTER (WHERE status_novo = 'Embarque Iniciado')    AS iniciou,
     max(em) FILTER (WHERE status_novo = 'Embarque Finalizado')  AS terminou,
     max(em) FILTER (WHERE status_novo = 'Faturado')             AS faturou,
     max(em) FILTER (WHERE status_novo = 'Seguiu Viagem')        AS saiu
    FROM etapa GROUP BY carga_id)
SELECT count(*) FILTER (WHERE chegou IS NOT NULL AND saiu IS NOT NULL) AS ciclos_completos,
       round(avg(EXTRACT(epoch FROM (iniciou  - chegou))  /60)::numeric,1) AS med_espera_min,
       round(avg(EXTRACT(epoch FROM (terminou - iniciou)) /60)::numeric,1) AS med_embarque_min,
       round(avg(EXTRACT(epoch FROM (faturou  - terminou))/60)::numeric,1) AS med_faturamento_min,
       round(avg(EXTRACT(epoch FROM (saiu     - faturou)) /60)::numeric,1) AS med_liberacao_min,
       round(avg(EXTRACT(epoch FROM (saiu     - chegou))  /60)::numeric,1) AS med_patio_total_min
  FROM p;

-- V4 · A MESMA CONTA, SEMANA A SEMANA (para ver se há série suficiente)
WITH etapa AS (
  SELECT carga_id, status_novo, min(data_evento) AS em
    FROM fact_statusfrota WHERE apagada_em IS NULL GROUP BY 1,2),
p AS (
  SELECT carga_id,
     max(em) FILTER (WHERE status_novo = 'Aguardando Embarque') AS chegou,
     max(em) FILTER (WHERE status_novo = 'Seguiu Viagem')       AS saiu
    FROM etapa GROUP BY 1)
SELECT date_trunc('week', chegou)::date AS semana,
       count(*)                          AS ciclos,
       round(avg(EXTRACT(epoch FROM (saiu - chegou))/60)::numeric,1) AS med_patio_min
  FROM p
 WHERE chegou IS NOT NULL AND saiu IS NOT NULL
 GROUP BY 1 ORDER BY 1;

-- V5 · ADERÊNCIA À META DE 180 MINUTOS  (o indicador de SLA já definido)
WITH etapa AS (
  SELECT carga_id, status_novo, min(data_evento) AS em
    FROM fact_statusfrota WHERE apagada_em IS NULL GROUP BY 1,2),
p AS (
  SELECT carga_id,
     max(em) FILTER (WHERE status_novo = 'Aguardando Embarque') AS chegou,
     max(em) FILTER (WHERE status_novo = 'Seguiu Viagem')       AS saiu
    FROM etapa GROUP BY 1)
SELECT count(*)                                                        AS ciclos,
       count(*) FILTER (WHERE EXTRACT(epoch FROM (saiu-chegou))/60 <= 180) AS dentro_da_meta,
       round(100.0 * count(*) FILTER (WHERE EXTRACT(epoch FROM (saiu-chegou))/60 <= 180)
             / nullif(count(*),0), 1)                                   AS pct_dentro_da_meta
  FROM p WHERE chegou IS NOT NULL AND saiu IS NOT NULL;

-- V6 · USO POR SETOR (sem nome de pessoa)
SELECT setor, count(*) AS movimentacoes, count(DISTINCT operador_id) AS operadores
  FROM fact_statusfrota
 WHERE apagada_em IS NULL
 GROUP BY setor ORDER BY movimentacoes DESC;

-- V7 · CICLO DE DEVOLUÇÃO: VOLUME E TEMPO ENTRE A PRIMEIRA E A ÚLTIMA ASSINATURA
SELECT count(*) AS devolucoes,
       min(data_dev) AS primeira, max(data_dev) AS ultima,
       round(avg(EXTRACT(epoch FROM (
              greatest(portaria_em, faturamento_em, expedicao_em,
                       controles_em, notas_em)
            - least   (portaria_em, faturamento_em, expedicao_em,
                       controles_em, notas_em)))/3600)::numeric, 1) AS med_horas_do_checklist
  FROM devolucoes
 WHERE excluida_em IS NULL;

-- V8 · CADASTRO (confere os números do §4.1 contra produção)
SELECT (SELECT count(*) FROM dim_veiculos)                     AS veiculos,
       (SELECT count(*) FROM dim_rotas)                        AS rotas,
       (SELECT count(*) FROM dim_rotas WHERE ativa)            AS rotas_ativas,
       (SELECT count(*) FROM dim_clientes)                     AS clientes,
       (SELECT count(*) FROM operadores WHERE ativo)           AS operadores_ativos,
       (SELECT count(DISTINCT setor) FROM operadores WHERE ativo) AS setores_com_usuario;
```

**As saídas obtidas neste ambiente para V1 a V7 são de banco de teste e não
representam a operação.** Para registro de reprodutibilidade: V1 devolveu
0 cargas; V2 devolveu 9 movimentações, todas de 16/09/2026; V3 e V4 devolveram
zero linhas úteis. As consultas estão sintaticamente validadas contra o esquema
real — todas foram executadas sem erro.

---

## 11. O que falta medir, e como começar a medir hoje

| Lacuna | Por que não foi apurada | Como registrar a linha de base |
|---|---|---|
| Volume total de cargas, veículos e rotas em uso | Banco de produção não alcançável deste ambiente | Executar V1, V2 e V8 em produção; arquivar a saída com data e responsável |
| Tempo médio por etapa do ciclo | idem | Executar V3; arquivar como linha de base, sem declarar tendência |
| Aderência à meta de 3 horas | idem | Executar V5; arquivar. Este é o indicador mais direto para a diretoria |
| Série temporal suficiente para afirmar melhoria | A série cobre ~33 dias | Repetir V3, V4 e V5 a cada 30 dias, em data fixa, e comparar apenas a partir do terceiro ponto |
| Tempo de operação gasto com a planilha antes do painel | Nunca foi medido | Não é mais recuperável. Registrar em seu lugar o tempo atual de execução de cada etapa (V3) como base para o próximo ciclo |
| Número total de execuções canceladas pelo portão | O portão não grava registro persistente | Acrescentar ao `publicar.sh` uma linha por execução (data, resultado, motivo) em arquivo versionado. Passa a ser apurável a partir da próxima publicação |
| Custo comparado com YMS de mercado | Nenhum dos cinco fornecedores publica preço na própria página | Solicitar cotação formal a dois fornecedores, com o escopo real (número de docas, filiais e usuários), e arquivar |
| Ocorrências sem teste citado | 5 de 72 (#03, #04, #39, #47, #59) | Revisar cada uma e escrever a guarda, ou registrar por escrito por que não cabe guarda |
