# Modelo de dados — Listas do SharePoint

Este documento espelha exatamente as estruturas que `data.js` já usa em memória
(hoje persistidas em localStorage só para teste). Quando o Administrador do
Sistema/responsável de TI provisionar estas Listas no SharePoint, os nomes de
coluna abaixo devem ser usados como estão, para que a troca do adaptador de
armazenamento em `data.js` (`SuincoStore`) seja mecânica — trocar
`localStorage.getItem/setItem` por chamadas à API REST do SharePoint ou
Microsoft Graph, sem mudar o resto do painel.

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
| Sequencia | Número | Prioridade de montagem do dia, manual |
| Observacoes | Várias linhas de texto | |
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
