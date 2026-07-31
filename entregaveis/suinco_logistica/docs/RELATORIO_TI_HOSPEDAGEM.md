# Relatório Técnico — Hospedagem e Armazenamento Compartilhado
## Painel Logístico Suinco (substituição do controle atual em Excel/VBA)

- **Destinatário:** Tecnologia da Informação — Suinco
- **Assunto:** Definição de arquitetura de hospedagem e persistência de dados
- **Status:** Aguardando decisão de TI sobre onde hospedar
- **Documentos relacionados:** `GUIA_TI_IMPLANTACAO.md` (roteiro operacional passo a passo),
  `MODELO_DADOS_SHAREPOINT.md` (schema das listas), `DECISOES_CONFIRMADAS.md` (histórico de decisões)

---

## 1. Sumário executivo

O setor de Logística desenvolveu um painel web que substitui o controle de expedição feito
hoje em planilha Excel com macros VBA. O painel está **funcionalmente completo e testado**:
cobre o fluxo dos quatro setores (Logística, Portaria, Expedição, Faturamento), os seis
status operacionais de uma carga, cadastro de frota com 2.038 placas reais já carregadas,
indicadores gerenciais, exportação para PDF e exportação para Power BI.

**O que falta é exclusivamente decisão de infraestrutura.** Hoje o painel grava os dados no
navegador de cada usuário (`localStorage`). Isso significa que **cada setor enxerga apenas os
próprios dados** — o que é suficiente para demonstração, mas inviável para operação real,
onde Portaria, Expedição e Faturamento precisam ver e alterar a mesma carga.

Este documento apresenta as opções de hospedagem, o comparativo técnico entre elas, os
requisitos de segurança e governança, e o que precisa ser provisionado em cada cenário.
A recomendação está na seção 6.

**Decisão solicitada ao TI:** escolher uma das quatro opções de arquitetura da seção 5 e
provisionar os itens listados na seção 9.

---

## 2. Contexto e justificativa

### 2.1. Situação atual (o problema)

O controle de expedição é feito hoje em uma planilha Excel com macros VBA, com os seguintes
problemas operacionais já observados:

| Problema atual | Consequência operacional |
|---|---|
| Arquivo único aberto por uma pessoa de cada vez | Setores esperam a planilha "desocupar"; informação chega atrasada à Portaria |
| Cópias divergentes do arquivo circulando | Duas versões da verdade; retrabalho de conciliação |
| Sem trilha de auditoria | Não se sabe quem alterou um status, nem quando |
| Macros VBA sem controle de versão | Alteração quebra a planilha sem possibilidade de rollback |
| Dependência de Excel instalado e macros habilitadas | Bloqueio por política de segurança; não funciona em celular |
| Sem integração nativa com Power BI | Indicadores gerenciais dependem de exportação manual |

### 2.2. Situação desejada

Um sistema onde os quatro setores operam sobre a **mesma base de dados, ao mesmo tempo**,
com trilha de auditoria completa, controle de acesso por setor, e conexão direta com Power BI —
dentro das políticas de segurança e das ferramentas já licenciadas pela empresa.

### 2.3. Por que não resolver com "salvar o arquivo em pasta compartilhada"

Esta alternativa costuma ser sugerida e precisa ser descartada com fundamento técnico:
um arquivo HTML em pasta de rede ou OneDrive **não compartilha dados entre usuários**.
Cada navegador que abre o arquivo mantém seu próprio `localStorage`, isolado por origem.
Compartilhar o arquivo compartilha o *programa*, não os *dados* — dois usuários abrindo o
mesmo arquivo continuam vendo bases separadas.

Armazenamento compartilhado exige, obrigatoriamente, **um serviço que receba e sirva os dados**
(banco de dados ou API). Não existe arranjo de pastas que substitua isso. É por essa razão
específica que este documento existe.

---

## 3. O que já está pronto (não depende do TI)

Para dimensionar corretamente o esforço restante, segue o que já está entregue e testado:

- **Aplicação completa** em HTML/CSS/JavaScript, sem framework e sem processo de build —
  são arquivos estáticos, servidos por qualquer hospedagem web.
- **Máquina de estados dos 6 status** com validação de transição (impede pular etapa).
- **Trava de frota**: bloqueia criação de carga com placa não cadastrada.
- **Base real de frota**: 2.038 placas normalizadas a partir de extrato de 2 anos do ERP.
- **Trilha de movimentações**: todo evento gera registro com operador, setor e horário.
- **Indicadores gerenciais** com comparação por período e gráficos.
- **Exportação PDF** (operacional e executivo) e **exportação para Power BI**.
- **Camada de dados isolada** (`SuincoStore` em `data.js`) — ver seção 7.
- **Versionamento em Git**, com histórico de decisões documentado.

**Esforço restante estimado para integração:** 3 a 5 dias úteis de desenvolvimento após o
ambiente estar provisionado, independentemente da opção escolhida.

---

## 4. Requisitos

### 4.1. Requisitos funcionais

| ID | Requisito |
|---|---|
| RF-01 | Múltiplos usuários leem e gravam a mesma base simultaneamente |
| RF-02 | Alteração feita por um setor fica visível aos demais sem reabrir a aplicação |
| RF-03 | Trilha de auditoria imutável (registros de movimentação não podem ser apagados) |
| RF-04 | Controle de acesso por setor |
| RF-05 | Acesso via navegador, incluindo dispositivos móveis (Portaria opera no pátio) |
| RF-06 | Conexão com Power BI para indicadores gerenciais |

### 4.2. Requisitos não funcionais

| ID | Requisito | Parâmetro |
|---|---|---|
| RNF-01 | Usuários simultâneos | 10 a 15 (pico de troca de turno) |
| RNF-02 | Volume de dados | ~50 cargas/dia; ~300 movimentações/dia; ~110 mil registros/ano |
| RNF-03 | Disponibilidade | Horário de operação (turnos); indisponibilidade breve tolerável com plano de contingência |
| RNF-04 | Tempo de resposta | Registro de movimentação em até 2 segundos |
| RNF-05 | Retenção | Mínimo 5 anos (trilha de auditoria) |
| RNF-06 | Autenticação | Preferencialmente SSO corporativo (Microsoft 365) |

### 4.3. Classificação da informação

Os dados tratados são **operacionais internos**: placas de veículos, nomes de
transportadoras, números de carga, destinos, pesos e horários de movimentação.

**Ponto de atenção para LGPD — achado concreto, não hipotético:** o campo *Motorista* e
parte dos registros de transportadora correspondem a **pessoas físicas** (transportadores
autônomos). Na conferência da base extraída do ERP foram identificados **23 registros de
placa, correspondentes a 6 transportadores distintos, cujo nome cadastrado inclui o CPF**,
no formato herdado do ERP (exemplo real, com o número omitido aqui:
`Bruno Sergio Ferreira CPF ###########`).

Isso caracteriza tratamento de dado pessoal e traz duas implicações que pedem posição
formal do TI/DPO:

1. A hospedagem deve permanecer em ambiente sob controle da empresa ou de fornecedor com
   contrato de tratamento de dados adequado — o que, na prática, **desqualifica a Opção D**
   (seção 5) para produção.
2. O painel **não utiliza o CPF para nenhuma funcionalidade**: ele veio junto no campo de
   nome da transportadora, por como o ERP cadastra autônomos. **Recomendação:** remover ou
   mascarar esses identificadores antes da carga em produção, aplicando minimização de
   dados. O ajuste é simples e pode ser feito antes da fase 4 do plano (seção 11).

---

## 5. Opções de arquitetura

Quatro caminhos viáveis, apresentados com o critério técnico de cada um.

### Opção A — SharePoint Online (Listas) + aba no Teams

Aplicação hospedada no próprio tenant Microsoft 365; dados em Listas do SharePoint;
autenticação por SSO corporativo; acesso pela aba do Teams.

**Arquitetura:**
```
Usuário → Teams (aba) → SSO Entra ID → API REST SharePoint → Listas → Power BI
```

| Aspecto | Avaliação |
|---|---|
| Licenciamento | Já contemplado no Microsoft 365 existente — sem custo adicional |
| Dados | Permanecem no tenant da empresa, sob políticas de retenção e DLP já vigentes |
| Autenticação | SSO nativo; usuário já logado no Teams não digita senha |
| Power BI | Conector nativo para Listas do SharePoint |
| Governança | Aderente às diretrizes corporativas; auditoria unificada no M365 |
| Limitação técnica | Limite de 5.000 itens por visualização (contornável com indexação e arquivamento — ver 8.3) |
| Esforço de TI | Alto: site, 6 listas, App Registration, permissões, manifesto do Teams |
| Dependência | Requer administrador do Entra ID e do SharePoint |

### Opção B — Azure (Static Web Apps + banco gerenciado)

Aplicação em Azure Static Web Apps; dados em Azure SQL ou Cosmos DB; autenticação Entra ID.

| Aspecto | Avaliação |
|---|---|
| Licenciamento | Custo mensal (estimativa na seção 10), normalmente dentro de crédito Azure existente |
| Dados | Tenant Azure da empresa; região configurável (Brasil Sul) |
| Autenticação | SSO nativo via Entra ID |
| Power BI | Conector nativo para Azure SQL — mais robusto que Listas |
| Governança | Aderente; integra com Azure Monitor, backup automatizado |
| Limitação técnica | Nenhuma relevante nesta escala |
| Esforço de TI | Médio: assinatura, resource group, banco, App Registration |
| Dependência | Requer assinatura Azure e administrador do Entra ID |

### Opção C — Servidor interno (on-premises)

Aplicação e banco (PostgreSQL ou SQL Server) em servidor próprio da empresa.

| Aspecto | Avaliação |
|---|---|
| Licenciamento | Sem custo de nuvem; usa infraestrutura existente |
| Dados | Totalmente on-premises — máximo controle |
| Autenticação | Integrável ao Active Directory local |
| Power BI | Requer gateway de dados local |
| Governança | Sob políticas de servidor já existentes |
| Limitação técnica | Acesso externo (celular no pátio) exige VPN ou publicação com certificado |
| Esforço de TI | Médio a alto: provisionamento, certificado TLS, backup, rotina de atualização |
| Dependência | Requer servidor disponível e equipe de infraestrutura |

### Opção D — Plataforma externa (Supabase, Render, Fly.io e similares)

Aplicação e banco em provedor externo de baixo custo.

| Aspecto | Avaliação |
|---|---|
| Licenciamento | Gratuito ou baixo custo nesta escala |
| Dados | **Fora do controle corporativo** — provável conflito com política de dados |
| Autenticação | Própria da plataforma; sem SSO corporativo nativo |
| Power BI | Via conector PostgreSQL, com exposição de credencial |
| Governança | **Não aderente** sem avaliação formal de fornecedor e contrato de tratamento de dados |
| Esforço de TI | Baixo |
| Dependência | Nenhuma interna — mas exige aprovação formal de segurança |

> **Observação honesta:** a Opção D é a mais rápida de executar e a única que não depende do
> TI para sair do papel, mas é apresentada aqui **como opção não recomendada para produção**,
> justamente por não atender aos requisitos de governança. Só faria sentido como piloto
> temporário e com dados fictícios, se houver aprovação formal para isso.

---

## 6. Recomendação

**Recomendação primária: Opção A (SharePoint Online + Teams).**

Justificativa:

1. **Custo incremental zero** — usa licenciamento Microsoft 365 já contratado.
2. **Aderência a governança** — os dados nunca saem do tenant; herdam retenção, DLP,
   auditoria e políticas de acesso já aprovadas pela empresa.
3. **Melhor experiência para o usuário final** — o painel aparece como aba dentro do Teams,
   que os setores já usam; sem nova senha, sem novo aplicativo para instalar.
4. **Integração nativa com Power BI**, atendendo à demanda de indicadores gerenciais.
5. **Decisão já registrada** — a hospedagem como aba do Teams foi definida anteriormente
   (ver `DECISOES_CONFIRMADAS.md`, seção 6) e este relatório a mantém.

**Recomendação alternativa: Opção B (Azure)** — indicada caso o TI julgue que o limite de
5.000 itens por visualização do SharePoint representa risco de médio prazo, ou caso já
exista padrão corporativo de hospedar aplicações internas em Azure. Tecnicamente superior
em performance e em modelagem de dados; o contraponto é o custo mensal e o esforço um pouco
maior de provisionamento inicial.

Ambas atendem plenamente aos requisitos. **A escolha entre A e B é de política de
infraestrutura, não de viabilidade técnica** — o desenvolvimento se adapta a qualquer uma
das duas sem reescrita da aplicação (ver seção 7).

---

## 7. Por que a troca de backend é de baixo risco

A aplicação foi construída desde o início com a persistência isolada em um único módulo,
o `SuincoStore`, em `data.js`:

```javascript
/* ---------- storage adapter (trocar aqui quando vier o SharePoint) ---------- */
const SuincoStore = {
  load() { /* hoje: localStorage.getItem(...) */ },
  save() { /* hoje: localStorage.setItem(...) */ }
};
```

Toda a lógica de negócio — máquina de estados, validação de transição, trava de frota,
cálculo de indicadores — consome esse adaptador e **não conhece a origem dos dados**.
Trocar o backend significa reescrever as funções `load`/`save`/`query` desse módulo para
chamar a API escolhida. As telas, as regras e os relatórios permanecem intactos.

Consequência prática para a decisão do TI: **não há aprisionamento**. Se a Opção A for
escolhida agora e no futuro a empresa migrar para Azure, a troca é novamente localizada no
mesmo módulo.

---

## 8. Riscos técnicos e mitigações

Não existe sistema multiusuário sem esta classe de problema. Cada item abaixo tem solução
definida e testável.

### 8.1. Escrita simultânea sobre a mesma carga
**Cenário:** Portaria e Expedição alteram a mesma placa no mesmo instante.
**Mitigação:** concorrência otimista via ETag (`If-Match`). Recebendo `412 Precondition
Failed`, o painel recarrega o registro e avisa o usuário em vez de sobrescrever.

### 8.2. Expiração de sessão durante o turno
**Cenário:** aba aberta por 8 horas.
**Mitigação:** renovação silenciosa de token (MSAL.js). Falhando, o painel exibe "sessão
expirada, entre novamente" — nunca falha em silêncio.

### 8.3. Limite de 5.000 itens por visualização (específico da Opção A)
**Cenário:** a lista `Movimentacoes` cresce continuamente (~110 mil registros/ano).
**Mitigação:** (a) indexar as colunas usadas em filtro; (b) rotina mensal de arquivamento
das cargas encerradas há mais de 90 dias para lista de histórico separada. Com isso a lista
operacional permanece na casa das centenas de itens.

### 8.4. Alteração de dados fora do painel
**Cenário:** alguém edita a Lista direto pelo SharePoint ou Excel e quebra a sequência de status.
**Mitigação:** coluna `Status` como tipo Escolha (impede valor inválido) e fluxo do Power
Automate replicando a validação de transição no servidor. Sem isso, a regra vale apenas
para quem usa o painel.

### 8.5. Operação sem rede no pátio
**Cenário:** instabilidade de rede na Portaria.
**Mitigação atual:** nenhuma — é limitação real e está declarada como tal.
**Evolução possível:** fila local de ações pendentes, reenviadas quando a conexão retorna.
Não foi implementada para não criar falsa sensação de segurança.

### 8.6. Perda de dados
**Mitigação:** Opção A — retenção e versionamento nativos do SharePoint; Opção B — backup
automatizado do Azure SQL (point-in-time restore); Opção C — rotina de backup a definir com
a equipe de infraestrutura.

---

## 9. O que se solicita ao TI

### 9.1. Decisão
Escolha entre Opção A e Opção B (seção 5).

### 9.2. Provisionamento — Opção A (SharePoint + Teams)

| # | Item | Responsável |
|---|---|---|
| 1 | Site do SharePoint tipo Team Site dedicado à Logística | Admin SharePoint |
| 2 | 6 Listas conforme `MODELO_DADOS_SHAREPOINT.md`, com `Status` do tipo Escolha | Admin SharePoint |
| 3 | Indexação de `Frota.Placa` e `Movimentacoes.CargaId`/`Timestamp` | Admin SharePoint |
| 4 | App Registration (SPA) no Entra ID com permissão `Sites.Selected` + `User.Read`, com consentimento de administrador | Admin Entra ID |
| 5 | Definição da URL de hospedagem dos arquivos estáticos (HTTPS) | TI |
| 6 | Permissão dos 4 setores nas Listas; `Movimentacoes` como *Colaborar sem exclusão* | Admin SharePoint |
| 7 | Publicação do app no catálogo interno do Teams | Admin Teams |

### 9.3. Parâmetros a devolver para o desenvolvimento

Para substituir o `SuincoStore` pelas chamadas reais, são necessários:

- URL do site do SharePoint
- Nomes/IDs internos das 6 Listas
- *Application (client) ID* e *Directory (tenant) ID* do App Registration
- URL final de hospedagem do painel

Sem esses quatro parâmetros não é possível escrever a integração real. Valores de exemplo
não serão inventados para simular funcionamento.

### 9.4. Posições formais solicitadas

- **DPO / Segurança:** tratamento dos identificadores de pessoa física na base de frota
  (seção 4.3) — manter, mascarar ou remover.
- **Segurança:** aprovação do modelo de permissão proposto (seção 9.2, item 6).

---

## 10. Estimativa de custos

| Opção | Custo de licença | Custo de infraestrutura | Observação |
|---|---|---|---|
| A — SharePoint/Teams | R$ 0 | R$ 0 | Coberto pelo M365 existente |
| B — Azure | R$ 0 | Faixa de R$ 50 a R$ 250/mês | Azure SQL Basic/S0 + Static Web Apps; normalmente absorvido por crédito existente |
| C — On-premises | R$ 0 | Custo interno de servidor | Depende de capacidade ociosa disponível |
| D — Externa | R$ 0 a R$ 150/mês | — | Não recomendada (seção 5) |

**Custo de desenvolvimento da integração:** 3 a 5 dias úteis, já contemplado no escopo do
projeto — sem custo adicional em qualquer das opções.

---

## 11. Plano de implantação

| Fase | Descrição | Pré-requisito | Duração |
|---|---|---|---|
| 1 | Decisão de arquitetura pelo TI | Este relatório | — |
| 2 | Provisionamento do ambiente | Fase 1 | A definir pelo TI |
| 3 | Integração do `SuincoStore` com a API real | Parâmetros da seção 9.3 | 3 a 5 dias úteis |
| 4 | Carga da base de frota (2.038 placas) | Fase 3 + posição do DPO | 1 dia |
| 5 | Piloto com 1 usuário de cada setor, simultâneo | Fase 4 | 1 semana |
| 6 | Ajustes do piloto | Fase 5 | 2 a 3 dias |
| 7 | Publicação para os 4 setores | Fase 6 | 1 dia |
| 8 | Operação assistida (Excel/VBA mantido como contingência) | Fase 7 | 2 semanas |

**Contingência:** o controle atual em Excel/VBA permanece disponível até o fim da fase 8.
Não há descontinuação do processo atual antes da validação em produção.

---

## 12. Conclusão

O painel está pronto e testado; a lacuna é exclusivamente de infraestrutura. A recomendação
é a **Opção A (SharePoint Online + Teams)** por custo incremental zero, aderência às
diretrizes corporativas e melhor experiência para o usuário final — com a **Opção B (Azure)**
como alternativa igualmente válida caso haja padrão corporativo nesse sentido.

A arquitetura da aplicação isola a persistência em um único módulo, o que torna a escolha
reversível e de baixo risco.

**Próximo passo:** decisão do TI quanto à opção de arquitetura e início do provisionamento
descrito na seção 9.
