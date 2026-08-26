# Modelo de dados — Listas do SharePoint

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
> **Este documento em particular nunca saiu do papel.** As colunas abaixo
> descrevem Listas que não existem em lugar nenhum. O modelo de dados que
> vale hoje são as tabelas do PostgreSQL, em `backend/migrations/`.


> ## ⚠️ Revisão de 31/07/2026 — leia antes de provisionar
>
> Este documento descreve o schema **conceitual** em 6 Listas. A implementação
> efetiva (`suinco-sharepoint.js`) usa **4 Listas**, com a nomenclatura já
> adotada no modelo do Power BI, para que o conector leia sem renomear nada:
>
> | Aqui | Na implementação | Observação |
> |---|---|---|
> | `ProgramacaoEmbarque` | **`fact_Viagens`** | as cargas |
> | `Movimentacoes` | **`fact_StatusFrota`** | cada mudança de status |
> | `Movimentacoes` (auditoria) | **`LOG_EVENTOS`** | trilha imutável, gravada em paralelo |
> | `Frota` | **`dim_Veiculos`** | cadastro placa → transportadora |
> | `Usuarios` | — | substituída pelo SSO do Entra ID |
> | `Transportadoras` | — | derivada de `dim_Veiculos`; não precisa de Lista própria |
> | `Docas` | — | **removida**: o campo Doca saiu do produto |
>
> **Ao provisionar, use os nomes da coluna do meio** — são os que o código
> procura. Os nomes desta página ficam como registro do desenho original.

## 1. Lista `Frota`
Cadastro de placa → transportadora → tipo de veículo, usado para o
preenchimento automático na Programação.

| Coluna | Tipo SharePoint | Observação |
|---|---|---|
| Placa | Uma linha de texto (Title) | Chave — sem acentos/traços, maiúsculas |
| Transportadora | Uma linha de texto | |
| TipoVeiculo | Uma linha de texto | Ex: Truck, Carreta, Toco |

## 2. Lista `ProgramacaoEmbarque` (as "cargas")
Uma linha por carga — nasce em `Programado` (Logística) ou `Aguardando Carga`
(Portaria, sem programação prévia).

| Coluna | Tipo SharePoint | Observação |
|---|---|---|
| Title / ID | Automático | Chave do item |
| NumeroCarga | Uma linha de texto | Número de carga usado pela operação |
| Placa | Uma linha de texto | |
| Transportadora | Uma linha de texto | Copiado de Frota na criação, editável |
| TipoVeiculo | Uma linha de texto | Copiado de Frota na criação, editável |
| Cliente | Uma linha de texto | |
| Destino | Uma linha de texto | Cidade/UF — diferencia cargas da mesma placa |
| Produto | Uma linha de texto | |
| Peso | Número | kg |
| Doca | Uma linha de texto | |
| Sequencia | Número | Prioridade de montagem do dia — **100% manual**, digitada livremente pelo Programador de Embarque, sem geração automática nem trava de duplicidade, editável a qualquer momento |
| Observacoes | Várias linhas de texto | |
| PraOnde | Escolha | vazio (Direto Suinco) / CROSS / DEDICADA / RET FRIGO |
| Compartilhada | Sim/Não (calculado) | **Não é gravado como escolha livre** — a Lista/formulário deve recalcular a partir de PraOnde (Sim quando CROSS ou RET FRIGO). No painel isto é uma função pura, nunca um campo editado diretamente. |
| QtdGanchos | Número (inteiro) | 0 = "Liso" (carga sem gancheira) |
| QtdEntregas | Número (inteiro) | Quantidade de entregas da carga |
| Status | Escolha | Ver lista de 9 valores abaixo |
| AguardandoCarga | Sim/Não | true enquanto o status é "Aguardando Carga" |
| CriadoEm | Data e Hora | |
| CriadoPor | Uma linha de texto (ou Pessoa, após SSO) | |
| AtualizadoEm | Data e Hora | |

**Valores de Status (Escolha, nesta ordem):**
`Aguardando Carga`, `Programado`, `Veículo em Pátio`, `Liberado para Embarque`,
`Embarque Iniciado`, `Embarque Finalizado`, `Faturado`, `Liberado para Saída`,
`Seguiu Viagem`.

## 3. Lista `Movimentacoes` (histórico / log — nunca editado, só inserido)
Uma linha por mudança de status. É o que alimenta todos os indicadores de
tempo por etapa. Nunca deve ser editada ou apagada manualmente.

| Coluna | Tipo SharePoint | Observação |
|---|---|---|
| Timestamp | Data e Hora | Momento exato da mudança |
| Operador | Uma linha de texto (ou Pessoa, após SSO) | |
| Setor | Escolha | Logística / Portaria / Expedição / Faturamento |
| Placa | Uma linha de texto | |
| CargaId | Uma linha de texto | Referência ao item de ProgramacaoEmbarque |
| StatusAnterior | Uma linha de texto | Vazio na primeira movimentação da carga |
| StatusNovo | Uma linha de texto | |

## 4. Lista `Usuarios`
Hoje o painel resolve isso com um formulário local (nome + setor, sem
autenticação real). Quando o SSO Microsoft 365 for conectado, o setor de cada
pessoa deve vir desta lista (ou de um grupo do Microsoft Entra), amarrado ao
e-mail/UPN do usuário autenticado — não a um campo de texto livre.

| Coluna | Tipo SharePoint | Observação |
|---|---|---|
| Nome / Pessoa | Pessoa | Vínculo com a conta Microsoft 365 |
| Setor | Escolha | Logística / Portaria / Expedição / Faturamento |

## 5. Lista `Transportadoras`
| Coluna | Tipo SharePoint | Observação |
|---|---|---|
| Nome | Uma linha de texto (Title) | |

## 6. Lista `Docas`
| Coluna | Tipo SharePoint | Observação |
|---|---|---|
| Nome | Uma linha de texto (Title) | |

---

## Permissão por Lista (controle de acesso real)

O painel hoje só esconde abas conforme o setor informado no login local — isso
é conveniência de interface, **não é segurança**. O controle de acesso de
verdade precisa ser configurado nas próprias Listas do SharePoint (permissão
por item/coluna, ou pelo menos por Lista) quando o SSO estiver ligado, para
que, por exemplo, a Portaria não consiga tecnicamente gravar um "Faturado"
mesmo que a interface não mostre esse botão pra ela.

## Próximo passo técnico (quando o tenant estiver pronto)

Em `data.js`, o objeto `SuincoStore` tem só dois métodos (`load`/`save`).
Substituir a implementação por chamadas à API REST do SharePoint
(`_api/web/lists/getbytitle('ProgramacaoEmbarque')/items`) ou Microsoft Graph
é o único ponto de mudança necessário — nenhuma tela ou regra de negócio
precisa ser tocada.
