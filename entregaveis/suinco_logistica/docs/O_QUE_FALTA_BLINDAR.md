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

Duas coisas, e as duas já estão custando todo dia.

### P1. Rodar o passo a passo no servidor — um comando só

O servidor está na migração **034**. Faltam a **035**, a **036** e a **037**,
e junto com elas duas conferências que nunca foram feitas.

**Tudo isso agora é um comando:**

```
ssh root@2.25.95.253
bash /opt/suinco-src/entregaveis/suinco_logistica/backend/atualizar_tudo.sh
```

Ele faz, na ordem: puxa o código, aplica as migrações, gera sozinho as
chaves do aviso no celular, reinstala o que mudou, reinicia, roda o
diagnóstico, **mostra** as linhas duplicadas da Montagem e pergunta antes de
apagar, e por fim prova que o backup restaura de verdade. No fim imprime um
bloco pronto para mandar de volta.

O que quebra enquanto não sobe:

| Migração | Sem ela |
|---|---|
| 035 | a Montagem do dia duplica linha a cada "puxar do modelo". O painel tem um remendo por rota+destino desde 26/08, mas a identidade exata só volta com a coluna. |
| 036 | a transportadora do dia não salva. A exceção (subcontratação, freteiro) some e vale sempre a do cadastro. |
| 037 | os avisos no celular não ligam. O painel mostra "ainda não foi ligado no servidor" e ninguém recebe nada. |

E as duas dívidas que o mesmo comando fecha:

- **as 53 linhas duplicadas** já gravadas na Montagem — a correção do painel
  evita duplicata nova, não apaga o que já está lá. Só saem linhas **vazias**,
  não efetivadas, não canceladas, com irmã mais antiga do mesmo dia, mesma
  rota e mesmo destino. Linha com placa, número, peso ou motorista nunca sai;
- **o backup nunca restaurado**. O `instalar.sh` carrega desde o primeiro dia
  a frase "backup que nunca foi restaurado não é backup". Agora tem prova.

Depois de rodar, **me mande o bloco final** — é com ele que o número em
`backend/migrations/APLICADAS_EM_PRODUCAO.txt` sobe de 034 para 037. Nunca
antes: aquele arquivo é registro do que ACONTECEU.

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

**Decidido (26/08): notificação no celular.** O passo a passo completo está
em `docs/ALERTA_DE_QUEDA.md` — cadastro no serviço externo, o que preencher,
a configuração por palavra-chave que pega "banco caiu mas o site abriu", e o
teste de parar o serviço de propósito uma vez para ver o alarme tocar.

**Falta o Luis fazer o cadastro e o teste.** Enquanto isso não acontecer,
continua valendo o de sempre: a gente descobre que caiu quando alguém do
pátio avisa.

### R3. Pacotes atrasados

`npm audit` dá **0 vulnerabilidade**. Não é urgência de segurança, é
manutenção.

**Feito em 26/08:** `pg` 8.22 → 8.23, mexendo só no arquivo de trava, com os
314 testes do servidor verdes depois.

**Adiado de propósito — `playwright` 1.61 → 1.62.** Parecia estar no mesmo
balde do `pg`, mas não está: é ele que gera o PDF dos relatórios no
servidor, e subir a versão faz o `instalar.sh` baixar um Chromium novo de
uns 150 MB no VPS. Ganho hoje: nenhum mensurável. Custo: um download grande
numa máquina cujo espaço livre eu não consigo conferir daqui. Vai junto com
os de versão maior, quando alguém puder olhar o `df -h` na hora.

**Aguardando janela combinada — os cinco de versão maior:**

| Pacote | O que muda |
|---|---|
| `bcryptjs` 2 → 3 | **mexe em senha de todo mundo** — testar login de usuário JÁ EXISTENTE antes de qualquer outra coisa |
| `express` 4 → 5 | roteamento e middleware |
| `helmet` 7 → 8 | cabeçalhos de segurança |
| `express-rate-limit` 7 → 8 | limite de requisições |
| `dotenv` 16 → 17 | leitura do .env |

Decisão do Luis em 26/08: **só depois de estabilizar**. Um de cada vez, cada
um com a bateria inteira, nunca em manhã de dia útil.


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
| 26/08/2026 | Avisos no celular entregues. P1, P2, P3 e P5 viraram um comando só (atualizar_tudo.sh). |
| 26/08/2026 | R1 decidido (push no celular) e guia escrito. `pg` subiu para 8.23; `playwright` adiado com motivo registrado. |
