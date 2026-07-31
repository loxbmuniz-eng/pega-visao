# Relatório Executivo — Painel Logístico Suinco

- **Destinatário:** Diretoria e Gerência de Logística — Suinco
- **Assunto:** Substituição do controle de expedição em Excel/VBA por painel integrado
- **Data:** 31 de julho de 2026
- **Documento técnico correspondente:** `RELATORIO_TI_HOSPEDAGEM.md` (versão 3)

---

## 1. Em uma página

A Suinco controla hoje a expedição em uma planilha Excel com macros. O painel
que substitui esse controle está **funcionalmente completo e testado**, com o
código de integração ao Microsoft 365 **já escrito**. Falta apenas o TI
provisionar o ambiente e devolver três parâmetros de configuração — cerca de
uma hora de trabalho do lado da aplicação depois disso.

**O que muda na prática:** hoje cada setor enxerga a sua parte do processo e a
consolidação acontece por conversa, telefone e mensagem. No painel, os quatro
setores — Logística, Portaria, Expedição e Faturamento — operam sobre a mesma
carga, em tempo real, e cada movimentação fica registrada com autor, setor e
horário.

**O que ainda não está entregue:** a operação compartilhada de verdade depende
do provisionamento do SharePoint. Enquanto isso não acontece, o painel grava no
navegador de cada usuário e **cada setor vê apenas os próprios dados** — o que
serve para demonstração e treinamento, não para produção. O painel declara essa
condição na própria tela, no rodapé.

---

## 2. O que foi construído

### 2.1. O núcleo operacional

| Recurso | O que resolve |
|---|---|
| **Fluxo dos 6 status** com validação de transição | Impede pular etapa. Uma carga não vai para "Faturado" sem ter passado por "Embarque Finalizado". |
| **Trava de frota** | Bloqueia criar carga com placa não cadastrada. Erro de digitação de placa deixa de virar carga fantasma. |
| **Torre de Controle** | Uma tela única com todas as cargas em aberto, para qualquer setor consultar sem precisar ligar para outro. |
| **Trilha de movimentações** | Todo evento registra quem fez, de qual setor e quando. |
| **Base de frota oficial** | 749 placas, com transportadora e tipo de veículo por placa, preenchidos automaticamente ao digitar a placa. |
| **Indicadores gerenciais** | Tempo por etapa, comparação entre períodos, identificação de gargalo. |
| **Relatório operacional** | A planilha de sequenciamento do dia, colorida por status, para acompanhamento contínuo. |
| **Relatório executivo e export para Power BI** | Alimenta a análise gerencial sem digitação manual. |

### 2.2. Integração com o Microsoft 365 (escrita, aguardando provisionamento)

- **Login único (SSO)** com a conta corporativa — sem senha nova para decorar.
- **Gravação nas Listas do SharePoint**, com a nomenclatura já usada no modelo
  do Power BI (`fact_Viagens`, `fact_StatusFrota`, `dim_Veiculos`,
  `LOG_EVENTOS`), para o BI ler sem retrabalho.
- **Operação sem rede**: se o wi-fi do pátio cair, o registro é guardado no
  aparelho e sobe automaticamente quando a conexão volta. Nenhum evento se
  perde.
- **Trilha de auditoria por operador**: cada registro carrega a identidade de
  quem agiu. É o que permite responder, meses depois, "quem autorizou a saída
  da placa X às 14h?".
- **Encerramento de ciclo**: um botão fecha o dia e aciona o arquivamento
  automático em pastas `/Ano/Mês/Dia/`.

### 2.3. Ajustes feitos na conferência com a Logística (hoje)

Estes vieram da rodada de validação com o gestor e valem registro porque
mostram o tipo de erro que a conferência pegou:

- **Base de frota não estava se atualizando.** A base oficial substituiu a
  anterior, mas os navegadores que já tinham a versão antiga continuavam com
  **1.289 placas fora de operação** e **327 com transportadora errada**. O
  sintoma apareceu numa placa que exibia a operadora no lugar da
  transportadora. Corrigido: a base agora se atualiza sozinha quando o arquivo
  muda, e avisa o operador do que mudou.
- **Relatório saía ilegível ao imprimir** — herdava as cores de tela, e no tema
  escuro o texto sumia no papel. Agora a impressão tem identidade própria.
- **Coluna de ganchos não saía no papel**: a tabela estourava a largura da
  folha e o navegador cortava as últimas colunas. Corrigido.
- **Ordem do relatório embaralhava as etapas** — uma carga que já saiu aparecia
  acima de outra ainda em faturamento. Agora segue a linha do tempo.
- **CSV corrompia o tipo de veículo "3/4"**, que o Excel convertia em data e
  chegava errado ao Power BI. Corrigido.
- **Nomes de coluna ambíguos** ("Empresa", "Pra onde?", "Rota") renomeados para
  o que de fato carregam. A ambiguidade de "Empresa" foi o que gerou a confusão
  entre operadora e transportadora.

---

## 3. Benefícios de longo prazo para a operação

### 3.1. O dado deixa de morrer no fim do dia

Hoje a planilha é sobrescrita. Não há como responder, com números, perguntas
como: quanto tempo em média um caminhão espera entre chegar e começar o
embarque? Qual transportadora atrasa mais? Qual rota consome mais doca?

Com cada movimentação registrada com horário e autor, essas respostas passam a
existir **sem ninguém precisar apurar nada** — o histórico se acumula sozinho.
Esse é o ganho que só aparece depois de alguns meses, e é o mais difícil de
recuperar se não começar agora.

### 3.2. Fim da consolidação por conversa

Portaria, Expedição e Faturamento passam a ver e alterar a mesma carga. O
tempo hoje gasto em ligar para conferir status vira tempo de operação. E, mais
importante, some a categoria de erro em que dois setores agem sobre informação
diferente.

### 3.3. Rastreabilidade que sustenta uma auditoria

A trilha registra autor, setor, horário e a transição exata de status. Quando o
SSO estiver ligado, a identidade passa a ser **verificada** pelo Entra ID, e não
apenas um nome digitado — o painel inclusive distingue os dois casos no
registro. É a diferença entre um histórico que sustenta uma discussão com
cliente ou transportadora e um que não sustenta.

### 3.4. Indicadores que apontam gargalo, não culpado

Como cada etapa tem carimbo de tempo, o sistema mostra **onde** o processo
trava, por período. Isso muda a conversa de "quem errou" para "onde está o
gargalo" — e permite medir se uma mudança de processo funcionou.

### 3.5. Base de frota como ativo, não como planilha

A base virou cadastro vivo, com placa, transportadora e tipo de veículo. A
trava de frota transforma esse cadastro em controle real: placa desconhecida
não entra. E o mecanismo de atualização garante que uma correção feita hoje
chegue a todos os terminais.

### 3.6. Redução de dependência de pessoa

O conhecimento do processo hoje está distribuído entre as pessoas que operam a
planilha. O painel torna o fluxo explícito: cada aba diz o que se faz ali e qual
o efeito no status. Isso encurta treinamento e reduz o risco de uma ausência
parar a expedição.

### 3.7. Um caminho pronto para o Power BI e o Copilot

O export já sai na nomenclatura do modelo do BI. Quando as Listas estiverem no
SharePoint, o Power BI lê direto da fonte, sem exportação manual — e o Copilot
passa a conseguir responder perguntas sobre a operação em linguagem natural,
porque os dados estarão estruturados e com autor.

---

## 4. Novo protocolo de programação de embarque

Esta é a mudança de processo que acompanha a ferramenta. O protocolo abaixo
descreve como a programação passa a funcionar.

### 4.1. Princípio central

**A carga nasce na Programação, não na Portaria.** Todo veículo que chega
deveria ter uma carga já programada esperando por ele. A entrada pela Portaria
sem programação prévia continua possível — a operação não pode parar —, mas
passa a ser tratada como exceção visível, marcada como *Aguardando Carga* até
que a Logística complete os dados.

### 4.2. Etapa 1 — Programação (Logística)

Aba **Programação**, protegida por senha de acesso restrito.

Ao criar a carga, informa-se:

| Campo | Regra |
|---|---|
| **Placa** | Obrigatória e **precisa estar na base de frota**. Transportadora e tipo de veículo são preenchidos automaticamente. |
| **Número da Carga** | Identificador da carga no processo. |
| **Motorista, Cliente, Destino** | Destino é a cidade/UF de entrega. |
| **Rota** | Código oficial (ex: `510 — Belo Horizonte`). Ver 4.7. |
| **Peso** | Em kg; o relatório converte para toneladas. |
| **Sequência** | Ordem de montagem do dia. É o que organiza o pátio. |
| **Tipo de Operação** | `FROTA PRÓPRIA`, `CROSS-DOCKING`, `DEDICADA` ou `RET FRIGO`. |
| **Compartilhada?** | **Calculado automaticamente** — nunca digitado. `CROSS-DOCKING` e `RET FRIGO` resultam em "Sim". |
| **Qtd. Ganchos** | 0 significa carga lisa. |
| **Qtd. Entregas** | Número de entregas da carga. |

A carga nasce no status **Aguardando Veículo**.

### 4.3. Etapa 2 — Chegada (Portaria)

A Portaria digita a placa e registra a chegada. A carga passa a **Aguardando
Embarque**. Se a placa não tiver carga programada, a Portaria registra a
chegada assim mesmo e a carga entra como *Aguardando Carga*, aparecendo na fila
de pendências da Programação.

### 4.4. Etapa 3 — Embarque (Expedição)

Dois registros: **Embarque Iniciado** quando o carregamento começa e **Embarque
Finalizado** quando termina. Não existe etapa de liberação intermediária.

### 4.5. Etapa 4 — Faturamento

Registra **Faturado**. Importante: *Faturado* ainda é caminhão no pátio — a
carga só está concluída quando sai.

### 4.6. Etapa 5 — Saída (Portaria)

A Portaria registra a saída e a carga passa a **Seguiu Viagem**. Todas as cargas
em aberto daquela placa são encerradas de uma vez, porque o caminhão sai uma vez
só.

### 4.7. Rotas

Foram cadastradas **30 rotas oficiais**, com código, praça e operador logístico
quando houver. O código é o que a operação usa no dia a dia ("carga da 510").

**A lista ainda está incompleta.** Faltam os códigos **511, 514, 515, 526, 527,
528, 530, 531, 533, 535, 537 e 539**, que serão informados. Por isso "(rota não
informada)" segue sendo opção válida — torná-la obrigatória agora travaria a
programação exatamente nas praças ainda não cadastradas.

### 4.8. Encerramento do ciclo

Ao fim do turno, a Logística aciona **Encerrar e Arquivar Ciclo**. O sistema
arquiva o movimento do dia em `/Ano/Mês/Dia/` e prepara a lista operacional para
o turno seguinte. A ação pede confirmação, informa quantas cargas ficaram em
aberto e **não apaga nada** se o arquivamento falhar.

### 4.9. Leitura do relatório operacional

O relatório do dia traz, nas primeiras colunas, o estado da carga em ordem de
linha do tempo — **Status**, **Status de Carregamento** e **Faturado** —,
seguido da identificação. As linhas são ordenadas pela etapa do processo: o que
ainda exige ação fica no topo da folha, o que já saiu fica no fim.

Cada status tem cor própria e constante, na tela e no papel, para leitura de
relance mesmo em foto compartilhada por mensagem.

---

## 5. O que falta

| # | Item | Responsável | Prazo estimado |
|---|---|---|---|
| 1 | Provisionar o site e as 4 Listas no SharePoint | TI | A definir |
| 2 | Registrar a aplicação no Entra ID e conceder acesso ao site | TI | A definir |
| 3 | Devolver os três parâmetros de configuração | TI | — |
| 4 | Conectar e validar em homologação | Desenvolvimento | ~1 hora |
| 5 | Completar as 12 rotas faltantes | Logística | — |
| 6 | Definir o fluxo de arquivamento no Power Automate | TI + Logística | A definir |
| 7 | Piloto com um usuário de cada setor, simultâneo | Logística | 1 semana |

**Contingência:** o controle atual em Excel/VBA permanece disponível durante
todo o piloto e a operação assistida. Não há descontinuação do processo atual
antes da validação em produção.

---

## 6. Ressalvas — o que este relatório não afirma

Registradas aqui de propósito, para não haver expectativa mal calibrada:

1. **O painel ainda não é multiusuário.** Sem o SharePoint, cada navegador tem
   os próprios dados. Qualquer demonstração que sugira o contrário está errada.
2. **A senha das abas restritas não é controle de acesso.** Está em texto puro
   no código e é visível por qualquer pessoa com o arquivo. É barreira contra
   clique acidental. Controle real só existe com a permissão por Lista do
   SharePoint mais o SSO.
3. **A permissão por setor é conveniência de interface**, não segurança — ela
   esconde abas, não impede acesso.
4. **Uma placa da base exige conferência humana:** `SIYOG36` não segue o formato
   brasileiro e provavelmente é `SIY0G36`, com zero no lugar da letra O. Não foi
   corrigida automaticamente porque alterar placa em sistema de registro por
   inferência é o tipo de correção que vira problema depois. Enquanto não for
   confirmada, se o caminhão chegar com a placa real, a trava de frota vai
   recusar a carga.
5. **O termo "DEDICADA" ficou sem definição escrita.** O rótulo antigo o
   descrevia como "frota própria", mas FROTA PRÓPRIA virou opção separada — os
   dois não podem significar a mesma coisa. A opção funciona normalmente; falta
   apenas registrar o que ela significa.
