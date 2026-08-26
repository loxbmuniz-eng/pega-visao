# O que falta blindar

Lista viva dos pontos levantados na auditoria de 26/08/2026, com o estado
de cada um. **Existe para que nenhuma pendência dependa da memória de
ninguém** — nem da minha, nem da do Luis. Quem abrir este arquivo vê o que
está aberto sem precisar rolar conversa nenhuma.

Regra: um item só sai da lista de PENDENTE quando alguém rodou e viu
funcionar. "Já vai rodar" não conta.

---

## FEITO — 26/08/2026

### ✅ O backup nunca tinha sido restaurado

O `instalar.sh` carrega desde o primeiro dia a frase *"backup que nunca foi
restaurado não é backup"* dentro do próprio cron. Era verdade: ninguém
tinha restaurado.

Agora existe `backend/scripts/testar_restauracao_backup.sh`. Ele restaura o
backup mais recente num banco **descartável**, compara tabela por tabela
com a produção, confere campo a campo cinco cargas antigas e apaga o banco
de teste no fim. Da produção ele só lê contagens — nunca escreve.

Conferido nos cinco caminhos: backup bom, arquivo corrompido, conteúdo
divergente, backup com mais de 48h e pasta vazia. Nenhum banco de teste
sobrou depois das rodadas.

**Falta o Luis rodar uma vez no servidor** (ver PENDENTE P3).

### ✅ O comando de conferir migração estava errado

O `APLICADAS_EM_PRODUCAO.txt` mandava conferir o servidor com
`SELECT nome FROM migracoes`. A tabela chama-se `_migrations` e a coluna,
`arquivo`. O comando dava erro justo na hora de conferir. Corrigido.

---

## PENDENTE — precisa da mão do Luis, no servidor

Estas quatro não são opinião: são coisas que **já estão custando** todo dia.

### P1. As migrações 035 e 036 não subiram

O servidor está na **034**. O que quebra enquanto não sobe:

| Migração | Sem ela |
|---|---|
| 035 | a Montagem do dia duplica linha a cada "puxar do modelo". O painel hoje tem um remendo por rota+destino que segura a maioria dos casos, mas a identidade exata só volta com a coluna. |
| 036 | a transportadora do dia não salva. A exceção do dia se perde e volta a da frota. |

```
ssh root@2.25.95.253
cd /opt/suinco-src && git pull
sudo bash entregaveis/suinco_logistica/backend/atualizar.sh
```

Depois de rodar e ver a confirmação, **avise** — o número em
`backend/migrations/APLICADAS_EM_PRODUCAO.txt` sobe de 034 para 036. Nunca
antes.

### P2. As 53 linhas duplicadas que já estão gravadas

A correção do painel evita duplicata **nova**. Ela não apaga o que já foi
gravado. Isso apaga, em dois passos de propósito:

```
# 1. ver o que sairia, sem apagar nada
sudo -u postgres psql -d embarque_suinco \
  -f /opt/suinco-src/entregaveis/suinco_logistica/backend/scripts/limpar_montagem_duplicada.sql

# 2. se a lista fizer sentido, apagar
sudo -u postgres psql -d embarque_suinco -v apagar=1 \
  -f /opt/suinco-src/entregaveis/suinco_logistica/backend/scripts/limpar_montagem_duplicada.sql
```

Só saem linhas **vazias**, não efetivadas, não canceladas, e que têm uma
irmã mais antiga do mesmo dia com a mesma rota e o mesmo destino. Linha com
placa, número, peso ou motorista nunca sai.

### P3. Rodar o teste de restauração do backup, uma vez

```
ssh root@2.25.95.253
bash /opt/suinco-src/entregaveis/suinco_logistica/backend/scripts/testar_restauracao_backup.sh
```

No fim ele imprime VEREDITO. Qualquer coisa diferente de "O BACKUP PRESTA",
mande a saída inteira. Depois disso, o ideal é repetir uma vez por mês.

### P4. Os 6 destinos que faltam na planilha da semana

A migração 033 subiu com **101 das 107 linhas**. Faltam seis, porque não
tenho o código de rota deles e **não vou inventar código de rota**:

- GPA-DF — segunda
- Restaurante Gaúcha — terça
- Minas Indústrias — quinta
- Hong Kong — sexta
- Suinco–Leila — sexta
- Suinco–Maria Eduarda — sexta

Me mande o código de rota de cada um (o mesmo que aparece no cadastro de
Rotas) e eu fecho a planilha.

---

## ABERTO — precisa de decisão, não de digitação

### R1. Ninguém é avisado se o servidor cair

Hoje o `systemd` reinicia o processo sozinho se ele morre, e o painel mostra
"⚠️ Modo Offline" para quem estiver com a tela aberta. Isso cobre o
horário de trabalho. **Não cobre madrugada, fim de semana e feriado** — e
não cobre a máquina inteira cair, só o processo.

Um vigia rodando dentro do próprio VPS não resolve: se o VPS cai, o vigia
cai junto. Vale para o robô de WhatsApp planejado também — ele vai morar no
mesmo VPS. Quem avisa que o servidor caiu precisa estar **fora** dele.

**Recomendação:** um serviço externo de uptime batendo em
`https://api.embarquesuinco.com.br/health` de 5 em 5 minutos. O `/health`
já existe, já responde sem login de propósito, e já devolve se o banco
respondeu. Não custa código nenhum — custa cinco minutos de cadastro e a
escolha de para onde o aviso vai.

**Decisão do Luis:** para onde o aviso deve chegar — e-mail, aplicativo no
celular, ou os dois.

### R3. Sete pacotes atrasados

`npm audit` dá **0 vulnerabilidades** hoje. Portanto isto não é urgência de
segurança — é manutenção. Em dois grupos:

| Seguro (mesma versão maior) | Perigoso (versão maior nova) |
|---|---|
| `pg` 8.22 → 8.23 | `bcryptjs` 2 → 3 — **mexe em senha de todo mundo** |
| `playwright` 1.61 → 1.62 | `express` 4 → 5 — muda roteamento e middleware |
| | `helmet` 7 → 8, `express-rate-limit` 7 → 8, `dotenv` 16 → 17 |

**Recomendação:** subir os dois seguros junto com a próxima entrega, com a
bateria inteira verde. Os cinco de versão maior, **um de cada vez**, cada um
com sua própria rodada de testes, e nunca numa manhã de dia útil. O
`bcryptjs` é o que exige mais cuidado: se o formato do hash mudar, ninguém
loga.

---

## DÍVIDA CONHECIDA — decidido não mexer

Isto não é tarefa pendente: é escolha registrada, para não ser
redescoberta daqui a três meses como se fosse novidade. Por isso não
aparece na lista que o portão de publicação cobra.

### `cargas.js` com 1.544 linhas e 14 rotas

É o arquivo que trata **toda** carga do sistema. É grande demais para o
conforto, e a tentação é quebrar em pedaços.

**Recomendação: não quebrar agora.** Refatoração não conserta defeito
nenhum — troca legibilidade por risco, e o risco recai justamente sobre o
caminho crítico, duas semanas depois de um incidente. Os 314 testes do
servidor cobrem esse arquivo; o momento certo de dividi-lo é quando uma
mudança de verdade exigir mexer nele, com os testes já verdes por perto.

Fica registrado como dívida conhecida, não como tarefa pendente.


## Histórico

| Data | O que mudou |
|---|---|
| 26/08/2026 | Lista criada. Teste de restauração de backup entregue; comando de conferência de migração corrigido. |
