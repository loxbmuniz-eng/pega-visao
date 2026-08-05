# Painel Logístico Suinco
## Controle de pátio em tempo real — apresentação à Diretoria

- **Data:** 02/08/2026
- **Origem:** iniciativa da área de Logística
- **Estágio:** construído e testado; aguardando provisionamento do TI
- **Investimento em licença:** R$ 0 — usa o Microsoft 365 já contratado

---

## 1. A pergunta que este projeto responde

*Quantos caminhões estão no nosso pátio agora, há quanto tempo cada um está lá,
e onde o processo está travando hoje?*

Hoje essa pergunta se responde por telefone, mensagem e caminhada até o pátio.
A resposta chega em minutos, já desatualizada, e não fica registrada.

O painel responde na tela, para os quatro setores ao mesmo tempo, e **guarda a
resposta**. É essa última parte que muda o jogo no médio prazo.

---

## 2. O que está pronto

Uma tela única onde Logística, Portaria, Expedição e Faturamento operam sobre a
mesma carga, em tempo real:

- **Fluxo dos 6 status** com validação — não se pula etapa.
- **Trava de frota** — 749 placas oficiais; placa desconhecida não vira carga.
- **Torre de Controle** — todas as cargas em aberto, para qualquer setor.
- **Trilha de auditoria** — todo evento com autor, setor e horário.
- **Indicadores** com comparação por período e identificação de gargalo.
- **Relatório operacional** colorido por status, para o acompanhamento do dia.
- **Integração com o Power BI** pela estrutura que o modelo já usa.

**Verificação:** 10 baterias automatizadas, 78 verificações, incluindo simulação
com **10 operadores simultâneos** e auditoria de segurança com exploração real.
Tudo reproduzível pelo TI. O detalhamento está em `RELATORIO_DE_TESTES.md`.

---

## 3. O que este projeto muda na operação

### 3.1. O dado deixa de morrer no fim do dia

Hoje a planilha é sobrescrita. Não há como responder, com números: *quanto tempo
em média um caminhão espera entre chegar e começar o embarque? Qual
transportadora atrasa mais? Qual rota consome mais doca?*

Com cada movimentação carimbada, essas respostas passam a existir **sem ninguém
apurar nada**. O histórico se acumula sozinho.

**Este é o ganho mais valioso e o mais fácil de subestimar**, porque ele não
aparece na primeira semana. Aparece no terceiro mês, quando pela primeira vez se
consegue comparar dois períodos e dizer com dados se uma mudança funcionou. E é
o único que **não se recupera depois**: todo dia sem registrar é um dia que não
volta para a base histórica.

### 3.2. Fim da consolidação por conversa

Os quatro setores passam a ver e alterar a mesma carga. O tempo gasto ligando
para conferir status vira tempo de operação. E some a categoria de erro em que
dois setores agem sobre informações diferentes.

### 3.3. Gargalo deixa de ser opinião

Como cada etapa tem carimbo de tempo, o sistema mostra **onde** o processo trava,
por período. Isso muda a conversa de "quem errou" para "onde está o gargalo" — e
permite medir se uma correção funcionou.

Indicadores que passam a existir:

| Indicador | Para que serve |
|---|---|
| Tempo entre chegada e início do embarque | Mede a fila de pátio |
| Tempo de carregamento por tipo de veículo | Dimensiona doca e equipe |
| Tempo entre embarque finalizado e faturamento | Revela gargalo administrativo |
| Tempo total de permanência | Compromisso possível com a transportadora |
| Volume por rota e por operador logístico | Base para negociação de frete |
| Cargas fora de programação | Mede aderência ao processo |

### 3.4. Rastreabilidade que sustenta uma discussão

A trilha registra autor, setor, horário e a transição exata. Com o SSO ligado, a
identidade passa a ser **verificada** — o sistema distingue "usuário
autenticado" de "nome digitado". É a diferença entre um histórico que sustenta
uma conversa com cliente ou transportadora e um que não sustenta.

### 3.5. Menos dependência de pessoas específicas

Hoje o conhecimento do processo está distribuído entre quem opera a planilha. O
painel torna o fluxo explícito — cada aba diz o que se faz ali e qual o efeito.
Encurta treinamento e reduz o risco de uma ausência parar a expedição.

---

## 4. Onde isso chega no médio e longo prazo

**3 meses** — base histórica suficiente para os primeiros comparativos. Primeiro
gargalo identificado com número, não percepção.

**6 meses** — indicadores de permanência por transportadora viram insumo de
negociação. Aderência ao processo mensurável.

**12 meses** — um ano de histórico permite sazonalidade: quais meses, dias e
turnos concentram pressão no pátio. Base para dimensionar doca e escala.

**Além** — com os dados estruturados no SharePoint, ferramentas que a Suinco já
tem (Power BI, Copilot) passam a responder perguntas sobre a operação sem
desenvolvimento novo. A fundação já estará pronta.

**Sendo honesto sobre a régua:** não vou prometer percentual de redução de
tempo, porque hoje **não existe a medição de partida**. Qualquer número que eu
apresentasse agora seria chute com aparência de projeção. O primeiro mês de
operação é que estabelece a linha de base — e a partir dela a melhoria vira
mensurável. Prometer menos aqui é o que torna o resto crível.

---

## 5. O que ainda não está pronto — e por que digo isso primeiro

Prefiro que a Diretoria ouça as limitações de mim, agora, do que as descubra
depois:

1. **O painel ainda não é multiusuário em produção.** O código está pronto e
   testado, mas depende de três parâmetros que só o TI fornece. Enquanto isso,
   cada máquina tem seus próprios dados — e a tela **avisa isso no rodapé**.
2. **A senha das abas não é controle de acesso.** Está em texto puro no código.
   É barreira contra clique acidental. Controle real vem com a permissão do
   SharePoint mais o login corporativo.
3. **Nada foi testado contra o ambiente real da Suinco.** Nenhum esteve
   disponível. O que foi provado é que a lógica está correta.
4. **A atualização leva até 15 segundos.** Para o pátio é indistinguível de
   tempo real, mas não é instantâneo — e não deve ser apresentado como tal.
5. **12 rotas ainda faltam** no cadastro, e uma placa da base precisa de
   conferência humana.

Nenhum desses pontos impede o piloto. Todos estão documentados com o caminho de
resolução.

---

## 6. O que se pede

| # | Decisão | De quem | Prazo |
|---|---|---|---|
| 1 | Autorizar o provisionamento no Microsoft 365 | Diretoria + TI | — |
| 2 | Provisionar site, Listas, índices e permissão | TI | a definir |
| 3 | Devolver os 3 parâmetros de configuração | TI | — |
| 4 | Autorizar piloto com 1 usuário por setor | Diretoria | 1 semana |
| 5 | Completar as 12 rotas faltantes | Logística | — |

**Custo incremental de licença: zero.** Usa o SharePoint já contratado. Não há
servidor novo para comprar nem manter.

**Contingência:** o controle atual em Excel/VBA permanece disponível durante
todo o piloto e a operação assistida. Não se descontinua nada antes da validação
em produção.

---

## 7. Próximos passos de desenvolvimento

**Curto prazo (após o provisionamento)**
1. Conectar e validar em homologação — cerca de 1 hora.
2. Rodar as 10 baterias de teste contra o ambiente real.
3. Piloto acompanhado, ajustando o que a operação apontar.

**Médio prazo**
4. Notificação de mudança via Power Automate, reduzindo a latência abaixo dos
   15 segundos atuais.
5. Painel de indicadores no Power BI lendo direto das Listas.
6. Aposentar a barreira de senha assim que a permissão por Lista estiver ativa.

**Longo prazo — a decidir com base no uso real, não agora**
7. Integração com o ERP para eliminar a digitação do número de carga.
8. Aplicativo móvel para a Portaria registrar chegada do próprio pátio.
9. Previsão de tempo de permanência a partir do histórico acumulado.

Os itens 7 a 9 só fazem sentido **depois** que o básico estiver rodando e
medido. Listá-los agora é mostrar o caminho, não comprometer prazo.

---

## 8. Encerramento

Este painel não inventa um processo novo. Ele torna visível, mensurável e
auditável o processo que a Suinco **já executa** — e que hoje só existe na
memória de quem opera e numa planilha que se apaga todo dia.

A parte técnica está construída e verificada. As limitações estão listadas
acima, por escrito, antes de alguém perguntar. O que falta é uma decisão de
infraestrutura e uma semana de piloto.

Coloco o trabalho à disposição para crítica técnica — inclusive do TI, que tem
todo o código, todos os testes e todas as ressalvas em mãos para conferir. Se
houver falha na avaliação de vocês, prefiro descobrir na sala de reunião do que
no pátio.

---

### Anexos

| Documento | Conteúdo |
|---|---|
| `ARQUITETURA_E_OPERACAO.md` | Arquitetura, configuração, segurança, troubleshooting |
| `RELATORIO_DE_TESTES.md` | 10 baterias, 78 verificações, defeitos encontrados |
| `RELATORIO_TECNICO_SINCRONIA.md` | Operação compartilhada em detalhe |
| `RELATORIO_TI_HOSPEDAGEM.md` | Opções de arquitetura e provisionamento |
| `CAPACIDADE_E_PERGUNTAS_FREQUENTES.md` | 14 perguntas prováveis com resposta |
| `testes/` | Código dos testes, reproduzíveis pelo TI |
