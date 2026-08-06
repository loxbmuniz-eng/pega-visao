# Programação de Embarque Suinco — Relatório executivo do sistema

Documento de gestão. Explica o que foi construído, onde tudo mora, o que é
guardado, quem pode fazer o quê, e o que fazer quando algo dá errado.

Escrito para ser lido por quem não é da área técnica. Onde há termo técnico, ele
vem explicado na mesma frase.

---

## 1. O que o sistema faz, em um parágrafo

Substitui a planilha e o grupo de WhatsApp no controle do pátio. Cada carga é
cadastrada uma vez pela Logística e percorre seis etapas — programada, chegou,
começou a carregar, terminou, faturou, saiu. Cada setor registra a sua etapa na
própria tela, e **todos os outros enxergam a mudança na hora**, sem ninguém
avisar ninguém. No fim, o histórico completo fica gravado e vira relatório e
indicador.

---

## 2. Onde as coisas moram

O sistema tem **duas metades**, e entender essa separação explica quase todo o
resto.

| | Painel | Servidor de dados |
|---|---|---|
| Endereço | `embarquesuinco.com.br` | `api.embarquesuinco.com.br` |
| O que é | A tela que o operador abre | Onde os dados ficam guardados |
| Onde roda | Vercel (hospedagem de site) | VPS Hostinger, IP `2.25.95.253` |
| Custo | Plano gratuito | Plano contratado da Hostinger |
| Atualiza | **Sozinho**, ao publicarmos código novo | Só quando alguém roda o instalador |

**Por que separado:** a tela precisa abrir rápido de qualquer lugar, inclusive do
celular no pátio; os dados precisam de um servidor com banco, backup e controle
de acesso. Cada metade faz o que faz melhor.

**Consequência prática:** melhoria de tela chega sozinha no dia seguinte. Mudança
de regra no servidor exige um comando. É por isso que às vezes o painel está novo
e o servidor não.

---

## 3. Capacidade do servidor

VPS Hostinger, plano KVM 2, Ubuntu 24.04.

| Recurso | Total | Em uso hoje | Folga |
|---|---|---|---|
| Disco | 95,8 GB | ~3,3% | Muito ampla |
| Memória | — | ~3% | Muito ampla |
| Carga de processador | — | ~0,0 | Ocioso |

**Leitura honesta:** o servidor está **muito acima** do necessário para esta
operação. Isso não é desperdício — é o que garante que um pico de movimento, ou
um relatório pesado sendo gerado, não derrube o pátio.

**Quando isso vira preocupação:** o disco crescer acima de 70%. Pelo ritmo atual
de dados, isso levaria anos. O diagnóstico avisa antes.

### Quantas pessoas aguenta ao mesmo tempo

Testado com dez terminais simultâneos sem degradação. A operação real usa entre
quatro e oito. Há folga confortável.

---

## 4. Que dados são guardados

Seis tabelas. Nenhum dado financeiro, fiscal ou pessoal sensível — **não há CPF,
valor de nota, dado bancário ou informação de folha**.

| Tabela | O que guarda | Cresce quanto |
|---|---|---|
| `fact_viagens` | Uma linha por carga: placa, transportadora, rota, peso, cliente, destino, status atual | 1 por carga |
| `fact_statusfrota` | Uma linha por mudança de etapa: quando, quem, de qual status para qual | ~6 por carga |
| `log_eventos` | Trilha de auditoria: quem fez o quê, quando, de qual setor | 1 por ação relevante |
| `dim_veiculos` | Cadastro oficial de frota — 749 placas | Praticamente estático |
| `dim_rotas` | 32 rotas oficiais | Estático |
| `operadores` | Quem tem acesso: nome, e-mail, setor, senha criptografada | 1 por pessoa |

### Sobre as senhas

Senha **nunca** é guardada como texto. O que fica no banco é um resultado
matemático irreversível (bcrypt, custo 12) — nem eu, nem você, nem quem tiver o
banco em mãos consegue descobrir a senha de alguém a partir dele. Se a pessoa
esquecer, o caminho é criar uma nova, não recuperar a antiga.

### O que o sistema registra sobre cada ação

Toda mudança de etapa grava: **data e hora, placa, status anterior, status novo,
nome de quem fez, e o setor**. Isso responde perguntas como *"quem autorizou a
saída da placa X às 14h?"* — e responde com o nome verificado pelo login, não
com um nome digitado à mão.

---

## 5. Backup — o que é salvo, quando, e como recuperar

### Como funciona

| | |
|---|---|
| Frequência | **Diária**, automática |
| Conteúdo | O banco inteiro — todas as seis tabelas |
| Onde fica | `/var/backups/embarque-suinco`, no próprio servidor |
| Formato | Arquivo comprimido (`.sql.gz`) |
| Retenção | **14 dias**. O 15º dia apaga o mais antigo |
| Quem dispara | O próprio sistema, sem intervenção |

### Como conferir se está rodando

No terminal do servidor:

```
ls -lh /var/backups/embarque-suinco
```

Devem aparecer até 14 arquivos, um por dia, com a data no nome. Se o de ontem não
estiver lá, algo falhou — e o diagnóstico aponta.

### Como forçar um backup agora

Antes de qualquer mudança arriscada:

```
sudo /etc/cron.daily/backup-embarque-suinco
```

### Como restaurar

**Isto apaga tudo que aconteceu depois daquele backup.** É operação de
emergência, e vale fazer com alguém acompanhando. Os comandos estão no
`MANUAL_DO_SERVIDOR.md`, seção 9.

### A limitação honesta deste desenho

O backup fica **no mesmo servidor** que o banco. Se o servidor inteiro for
perdido, o backup vai junto.

Duas proteções cobrem parte disso: a Hostinger tem snapshot semanal do servidor
completo, e dá para baixar um backup para outra máquina quando quiser
(`MANUAL_DO_SERVIDOR.md`, seção 9).

**Recomendação:** se a operação passar a depender criticamente do histórico,
vale contratar cópia automática para fora do servidor. Hoje o risco é baixo
porque o dado é reconstituível a partir da operação, mas ele existe e está
declarado aqui de propósito.

---

## 6. Segurança — o que protege o quê

| Camada | O que faz |
|---|---|
| **Login individual** | Cada pessoa tem e-mail e senha próprios. Não há senha compartilhada |
| **Setor vem do servidor** | O que a pessoa pode fazer é decidido no servidor, não no navegador. Adulterar o navegador muda a tela, não a permissão |
| **Sessão de 12 horas** | Renovada automaticamente enquanto houver uso; terminal esquecido aberto expira sozinho |
| **Banco fechado** | O banco de dados **não é alcançável pela internet**. Só o próprio servidor conversa com ele |
| **Firewall** | Só três portas abertas: SSH (administração), 80 e 443 (site). O resto, fechado |
| **HTTPS** | Certificado válido, renovado automaticamente |
| **Limite de tentativas** | 30 tentativas de login por minuto e 300 requisições por minuto, por origem — barra ataque de força bruta |
| **Serviço isolado** | A aplicação roda com usuário próprio, sem poderes de administrador. Se for comprometida, o estrago fica limitado |

### O que ainda é frágil, dito com todas as letras

**O acesso interno da Suinco está bloqueado pela rede da empresa.** Dois gestores
operam pelo celular em rede móvel. Isso não é falha do sistema — é configuração
de firewall/antivírus corporativo, e há chamado pronto para a TI
(`CHAMADO_TI_LIBERACAO_REDE.md`).

**O backup mora no mesmo servidor** — ver seção 5.

---

## 7. O que cada setor faz

| Setor | O que vê | O que pode fazer |
|---|---|---|
| **Logística** | Tudo, exceto Usuários | Cadastrar carga, editar qualquer campo, mover qualquer etapa, cancelar carga, cadastrar frota e rotas, emitir relatórios |
| **Administração** | Tudo, inclusive Usuários | O mesmo da Logística, mais criar/bloquear acessos |
| **Portaria** | Sua aba e o Histórico | Registrar chegada e saída do caminhão; criar entrada para caminhão sem carga programada |
| **Expedição** | Sua aba e o Histórico | Iniciar e finalizar o carregamento |
| **Faturamento** | Sua aba e o Histórico | Marcar a carga como faturada |

**Regra que sustenta tudo isso:** a permissão é conferida **no servidor**, a cada
ação. A tela esconder um botão é conveniência; o servidor recusar é a proteção
de verdade.

### O que Portaria, Expedição e Faturamento passaram a ter

Cada um vê, dentro da própria aba, a **Visão do Pátio**: onde cada carga está na
linha do tempo das seis etapas, com a hora de cada uma e há quanto tempo o
caminhão está no pátio. Com filtro de período, para revisitar uma carga de outro
dia sem pedir ajuda à Logística.

---

## 8. Como o sistema se comporta quando algo falha

Este foi um dos pontos mais trabalhados, e vale a gestão conhecer.

**Sem internet no aparelho:** o operador continua registrando normalmente. As
gravações ficam numa fila no próprio navegador e sobem sozinhas quando a conexão
volta, **na ordem em que foram feitas**. Nada se perde — desde que a aba não seja
fechada.

**Servidor fora do ar:** mesma coisa. O painel abre, funciona, e sincroniza
depois.

**Duas pessoas mexendo na mesma carga:** o sistema detecta e avisa, em vez de uma
sobrescrever a outra em silêncio.

**Alguém não consegue entrar:** a tela diz **qual** é o problema, com um código
curto que a pessoa fotografa — `[SENHA]`, `[REDE]`, `[FILTRADO]`, `[LIMITE]`. E
há um botão "Testar conexão" que roda quatro testes e aponta a etapa exata onde
morre.

**Banco desatualizado em relação ao código:** o servidor **se recusa a subir** e
diz o que rodar. Serviço no ar mentindo é pior que serviço fora do ar.

---

## 9. O que existe de relatório e indicador

### Três documentos, prontos para impressão e foto

| Documento | Para quem | O que traz |
|---|---|---|
| **Relatório Operacional** | Pátio | Sequência do dia, status de cada carga, peso, ganchos, entregas |
| **Relatório Executivo** | Gestão | Cargas em aberto por status, tempo médio de pátio, gargalos, ranking de atraso |
| **Administração de Fretes** | Administrativo | Controle por carga: valor, negociação, instruções |

Todos saem com nome próprio e data no arquivo (`Suinco_Relatorio-Operacional_2026-08-06_14h32`), cabeçalho padronizado e a identificação de quem emitiu.

### Indicadores na tela

Tempo médio por etapa, comparação entre cinco janelas de tempo (6h, 12h, hoje,
semana, mês) com **linha de tendência** em cada indicador, ranking de veículos
com maior atraso, análise de gargalos, e distribuição das cargas em aberto por
etapa.

Tudo filtrável por transportadora, rota, tipo de operação ou placa — e **um
aviso em tela declara o filtro ativo**, para ninguém fotografar um número
filtrado achando que é o total.

---

## 10. Power BI — o que já está pronto

O servidor entrega **sete conjuntos de dados** prontos para o Power BI, por
HTTPS com credencial de leitura. Não é exportação manual de planilha: o Power BI
busca sozinho, na frequência que for configurada.

Os nomes de coluna foram mantidos idênticos aos do arquivo CSV antigo de
propósito — **o modelo existente do Power BI não precisa de retrabalho**.

Documentação completa em `MODELO_DE_DADOS_BI.md`. Pedido para a TI pronto em
`CHAMADO_TI_POWERBI.md`.

---

## 11. Atividade do domínio `embarquesuinco.com.br`

| | |
|---|---|
| Registro | Registro.br |
| DNS | Servidores do Registro.br |
| `embarquesuinco.com.br` | Aponta para a Vercel — o painel |
| `www.embarquesuinco.com.br` | Mesmo destino, também autorizado |
| `api.embarquesuinco.com.br` | Aponta para `2.25.95.253` — o servidor de dados |
| Certificados | Let's Encrypt, renovação automática |

### O que precisa de atenção anual

**A renovação do domínio no Registro.br.** É a única coisa neste sistema que, se
esquecida, tira tudo do ar de uma vez — e nenhum aviso técnico nosso alcança
isso. Vale marcar no calendário da empresa.

### Como conferir se o painel está no ar

Abra `https://api.embarquesuinco.com.br/health` em qualquer navegador. A resposta
esperada é:

```json
{"ok":true,"banco":"conectado","agora":"...","conectados":2}
```

`conectados` mostra quantos terminais estão ligados naquele instante — é o jeito
mais rápido de saber se o pátio está usando.

---

## 12. O que foi construído para não quebrar

Números do que sustenta a operação hoje:

| | |
|---|---|
| Testes automatizados no servidor | **68 casos**, contra banco de dados real |
| Baterias de teste de tela | **12 arquivos**, incluindo auditoria de celular em três aparelhos |
| Verificações por entrega | Todas rodam antes de qualquer publicação |

**O que esses testes cobrem:** login e permissão por setor, o fluxo completo dos
quatro setores, fila offline, conflito entre dois operadores, exportação para o
BI, os três relatórios impressos, uso em celular, e as telas de diagnóstico.

**Por que isso importa para a gestão:** cada correção feita fica travada por um
teste. O erro que já aconteceu uma vez não volta silenciosamente três meses
depois.

---

## 13. Rotina recomendada

| Quando | O quê | Quem |
|---|---|---|
| Diário | Nada. O sistema se cuida | — |
| Semanal | Olhar se o backup do dia anterior existe | Administração |
| Mensal | Rodar o diagnóstico completo | Administração |
| Ao entrar/sair alguém | Criar ou bloquear o acesso pela tela de Usuários | Administração |
| Anual | Renovar o domínio no Registro.br | Gestão |
| Quando avisado | Reiniciar o servidor após atualização do Ubuntu | Administração |

O comando do diagnóstico e todos os demais estão em `MANUAL_DO_SERVIDOR.md`.

---

## 14. O que ainda não foi feito

Declarado aqui para não haver surpresa:

- **Cadastros mestres** de motoristas, clientes, destinos e tipos de veículo.
  Hoje esses campos são digitação livre, o que gera variação de grafia.
- **Sugestão inteligente na digitação** — placa que lembra o motorista habitual,
  transportadora que lembra a rota histórica.
- **Metas configuráveis pela tela.** A meta de tempo de pátio (3 horas) está
  fixada no código.
- **Backup fora do servidor** — ver seção 5.
- **Liberação da rede interna da Suinco** — depende da TI.

---

## 15. Resumo para quem só vai ler esta parte

O sistema está **em produção e operando**. A infraestrutura tem folga larga.
Backup roda sozinho todo dia, com 14 dias de histórico. Nenhum dado sensível é
armazenado. Cada pessoa entra com acesso próprio, e o que ela pode fazer é
decidido no servidor, não na tela dela.

O painel funciona sem internet e sincroniza depois — o pátio não para por causa
de rede.

**A única pendência que trava gente hoje é externa:** a rede interna da Suinco
bloqueia o acesso pelos computadores, e dois gestores operam pelo celular. O
pedido para a TI está pronto e documentado.
