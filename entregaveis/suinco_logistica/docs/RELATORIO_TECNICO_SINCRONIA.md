# Relatório Técnico — Operação Compartilhada em Tempo Real

- **Destinatário:** Tecnologia da Informação — Suinco
- **Assunto:** Sincronização multiusuário do Painel Logístico via SharePoint/Graph
- **Data:** 01/08/2026
- **Status:** Implementado e verificado por simulação de 2 e de 4 usuários simultâneos
- **Documentos relacionados:** `RELATORIO_TI_HOSPEDAGEM.md` (v3),
  `CAPACIDADE_E_PERGUNTAS_FREQUENTES.md`, `testes/README.md`

---

## 1. O que mudou e por quê

### 1.1. O problema

A versão anterior implementava apenas o caminho de **escrita**: o painel gravava
nas Listas do SharePoint, alimentando o Power BI, mas nunca lia de volta. Na
prática, cada terminal continuava sendo uma ilha — a Portaria não enxergava a
carga que a Logística tinha acabado de criar.

Isso não atendia ao requisito. Esta entrega fecha a lacuna.

### 1.2. O que passou a existir

| Capacidade | Antes | Agora |
|---|---|---|
| Escrita nas Listas | ✅ | ✅ |
| **Leitura compartilhada** | ❌ | ✅ |
| **Atualização automática** | ❌ | ✅ a cada 15 s |
| **Uma linha por carga** | ❌ (uma por status) | ✅ |
| **Proteção de alteração local** | ❌ | ✅ |
| **Recuperação automática de falha** | ❌ | ✅ |

---

## 2. Arquitetura da sincronização

### 2.1. Por que consulta periódica, e não *push*

O SharePoint não empurra alterações para o navegador. As alternativas eram:

| Opção | Avaliação |
|---|---|
| **Consulta periódica (adotada)** | Simples, sem infraestrutura adicional, degrada bem. |
| Webhooks via Power Automate | Exigiria endpoint público para receber a notificação — infraestrutura nova e superfície de exposição que o ganho não justifica. |
| SignalR / WebSocket | Exigiria servidor de aplicação, que o projeto deliberadamente não tem. |

**Intervalo: 15 segundos.** É menor que o tempo de qualquer ação física no
pátio, então para a operação é indistinguível de tempo real. Com 20 pessoas
conectadas dá cerca de 80 leituras por minuto — muito abaixo dos limites de
taxa do serviço.

Além do ciclo, há duas leituras extras: ao abrir o painel (carga completa) e ao
**voltar para a aba** — o momento em que informação desatualizada mais incomoda.

### 2.2. Leitura incremental

Depois da primeira carga, as consultas pedem apenas o que mudou desde a leitura
anterior, filtrando por `Timestamp_Sincronia`. Duas consequências:

- o tráfego não cresce junto com o histórico;
- **evita esbarrar no limite de 5.000 itens por consulta**, que seria atingido
  em poucas semanas se cada ciclo lesse a Lista inteira.

A tabela de frota (`dim_Veiculos`) é lida só na carga inicial — muda raramente.

### 2.3. Gravação por *upsert*

A gravação anterior era sempre `POST`, então **cada mudança de status criava uma
linha nova** em `fact_Viagens`: uma carga que percorre os 6 status virava 6
linhas. Isso inviabilizava a leitura compartilhada (qual linha é a carga?) e
obrigaria o Power BI a desduplicar.

Agora a gravação procura a linha pela chave de negócio (`Carga_ID` para cargas,
`Placa` para frota) e faz `PATCH` se existir, `POST` se não. O identificador do
item fica em cache para as gravações seguintes não repetirem a busca.

`fact_StatusFrota` e `LOG_EVENTOS` continuam sendo `POST` puro — são log, e log
não se atualiza.

### 2.4. Onde a carga é enviada — uma correção que vale registrar

A sincronização da carga era disparada de dentro de `registrarMovimentacao()`.
Só que as regras de negócio chamam essa função **antes** de aplicar a mudança no
objeto. Exemplo real, em `registrarChegadaPortaria()`:

```js
registrarMovimentacao({ ..., statusNovo: 'Aguardando Embarque', ... });
c.status = 'Aguardando Embarque';     // a mudança acontece DEPOIS
```

O resultado era um `PATCH` com o **estado anterior** da carga: o servidor
recebia a escrita, o `Timestamp_Sincronia` até se atualizava, mas o
`Status_Atual` continuava o antigo — e a mudança nunca chegava aos outros
setores. O defeito foi encontrado pela simulação de dois usuários, não por
inspeção.

A correção **não reordenou nenhuma regra de negócio**. A carga passou a ser
enviada a partir de `SuincoStore.save()`, que por construção roda depois de a
mutação estar aplicada, e que é chamado por todas as regras. Só sobem as cargas
cujo `atualizadoEm` mudou desde o último envio.

---

## 3. Resolução de conflito

Não há bloqueio pessimista — travar registros num painel de pátio criaria mais
problema do que resolve. As regras são:

**1. Última escrita vence, comparando `Atualizado_Em`.** Se dois setores mexerem
na mesma carga, prevalece a alteração mais recente. Na prática o risco é baixo
porque cada setor atua em uma etapa distinta do fluxo.

**2. Alteração local ainda não sincronizada nunca é sobrescrita.** A carga
recebe a marca `_pendente` ao ser gravada e só a perde quando a gravação é
confirmada. Sem isso, o ciclo de 15 s apagaria da tela uma mudança que o
operador acabou de fazer e que ainda não subiu — o pior erro possível aqui, e o
motivo de esta regra existir antes de qualquer outra.

**3. Movimentações só são acrescentadas.** São log, deduplicadas por `id`.

**4. Eco é cortado.** O que chega do servidor é marcado como já sincronizado,
senão a gravação seguinte devolveria tudo de volta — cada leitura gerando uma
escrita, indefinidamente, entre todos os terminais.

---

## 4. Comportamento offline e recuperação

O painel grava localmente primeiro e devolve o controle na hora; a subida
acontece em segundo plano. Sem rede, o registro entra numa fila persistida e
sobe na ordem original quando a conexão volta.

**Correção nesta entrega:** antes, um terminal que entrasse em estado offline só
tentava de novo se a placa de rede oscilasse (evento `online` do navegador) ou
se alguém recarregasse a página. Isso não cobre o caso mais comum — o servidor
recusar ou expirar enquanto a rede segue de pé. O resultado era um terminal
parado com a fila cheia, sem nada que o tirasse dali.

Agora o próprio ciclo de sincronização é o caminho de recuperação: estando
offline, faz uma leitura curta para confirmar que o serviço voltou e, só então,
despeja a fila. A recuperação é automática e não depende do operador.

---

## 5. Verificação

Duas simulações automatizadas, com navegadores independentes — contextos
separados, sem compartilhar `localStorage` nem sessão, equivalentes a máquinas
diferentes. Ambas rodam contra um servidor que implementa os endpoints do Graph
usados pelo painel (`ferramentas/mock_graph_server.py`).

### 5.1. Dois usuários (`testes/test_multiusuario.py`)

```
[OK] ambos conectados ao repositório compartilhado
[OK] Portaria enxergou a carga criada pela Logística
[OK]    dados chegaram íntegros
[OK] Logística viu a mudança feita pela Portaria
[OK] fact_Viagens tem 1 linha para a carga, não uma por status
[OK]    a linha reflete o status mais recente
[OK] log registra os dois operadores
[OK] mudança local pendente sobreviveu ao ciclo de sincronia
[OK] fila esvaziou após reconectar
[OK] sem erros de página
```

### 5.2. Turno completo, 4 setores (`testes/test_4setores.py`)

Quatro navegadores percorrendo os 6 status na mesma carga:

```
[OK] Portaria vê a carga programada (propagou em 500ms)
[OK] Portaria registra chegada
[OK] Expedição vê o veículo no pátio (propagou em 0ms)
[OK] Expedição inicia o embarque
[OK] Expedição finaliza o embarque
[OK] Faturamento vê a carga carregada (propagou em 500ms)
[OK] Faturamento fatura
[OK] Portaria vê que já foi faturada (propagou em 500ms)
[OK] Portaria registra a saída
[OK] Logística vê o ciclo encerrado (propagou em 0ms)

[OK] fact_Viagens: 1 linha para a carga
[OK]    status final correto — Seguiu Viagem
[OK]    campos de negócio preservados — Rota 525, 30 ganchos, RET FRIGO
[OK] fact_StatusFrota registrou as 6 etapas
[OK] auditoria com os 4 operadores
[OK] sem erros de página
```

As cinco baterias anteriores (fluxo de status, senha, tipo de operação, base de
frota, CSV) seguem sem falhas — a sincronização não alterou nenhuma regra de
negócio.

### 5.3. Sobre o servidor de simulação

Ele prova que **a camada de sincronização do painel está correta**. Não
substitui um teste contra o tenant real, que continua sendo necessário na
homologação — o que ele não cobre é o comportamento específico do SharePoint:
latência real, limitação de taxa e o formato exato dos campos provisionados.

**Trava de segurança:** o modo de simulação só se ativa com
`SP_CONFIG.modoSimulacao = true` **e** `graphBaseUrl` apontando para
`localhost`/`127.0.0.1`. Apontando para o Graph real, o modo é ignorado e a
autenticação normal acontece — não há como desligar o SSO em produção mexendo
nessa chave.

---

## 6. O que o TI precisa provisionar

Sem alteração em relação à v3 do relatório de hospedagem, com **duas adições**:

### 6.1. Coluna nova obrigatória

| Lista | Coluna | Tipo | Por quê |
|---|---|---|---|
| `fact_Viagens` | `Atualizado_Em` | Data e Hora | **Decide qual versão vence** quando dois setores mexem na mesma carga. Sem ela a fusão não tem como comparar. |
| `fact_Viagens` | `Aguardando_Carga` | Sim/Não | Marca a carga que entrou pela Portaria sem programação prévia. |

### 6.2. Índices — agora obrigatórios, não recomendados

A sincronização consulta por estes campos a cada ciclo. **Sem índice, o
SharePoint recusa a consulta assim que a Lista passa de 5.000 itens:**

| Lista | Coluna a indexar |
|---|---|
| `fact_Viagens` | `Carga_ID`, `Timestamp_Sincronia` |
| `fact_StatusFrota` | `Timestamp_Sincronia` |
| `dim_Veiculos` | `Placa` |

### 6.3. Permissão

`Sites.Selected` + `User.Read`, como antes — agora exercendo **leitura e
escrita** no site de Logística. Lembrando que `Sites.Selected` exige a concessão
explícita ao site (seção 9.2.1 do relatório de hospedagem): sem ela tudo
autentica e **toda operação retorna 403**.

---

## 7. Limites conhecidos

Registrados para não haver surpresa na homologação:

1. **A propagação leva até 15 segundos.** É consulta periódica, não *push*. Para
   a operação de pátio isso é indistinguível de tempo real, mas não é
   instantâneo e não deve ser apresentado como tal.
2. **Sem bloqueio de registro.** Duas pessoas editando a mesma carga no mesmo
   instante: vence a última. A alteração perdida não é recuperável pela
   interface — fica no log de auditoria, mas não volta sozinha.
3. **A fila offline vive no navegador daquele terminal.** Reinstalar a máquina
   com registros pendentes perde esses registros. Na prática, uma janela de
   minutos.
4. **Não foi testado contra o SharePoint real.** Nenhum tenant esteve
   disponível. Latência, limitação de taxa e o formato dos campos provisionados
   só se confirmam na homologação.
5. **O encerramento de ciclo continua dependendo do Power Automate.** Sem a URL
   do fluxo configurada, ele avisa que não arquivou e não apaga nada.

---

## 8. Próximo passo

Preencher os três parâmetros de `SP_CONFIG` (`clientId`, `tenantId`, `siteId`),
provisionar as Listas com as colunas e índices das seções 6.1 e 6.2, e conceder
`Sites.Selected` ao site. A partir daí o mesmo código que passou nas simulações
passa a falar com o SharePoint real — nada mais muda na aplicação.
