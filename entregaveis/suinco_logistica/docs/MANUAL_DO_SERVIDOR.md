# Manual do servidor — Embarque Suinco

Tudo que se faz no servidor, por que se faz, e o que esperar de cada comando.
Feito para ser usado sem pedir ajuda.

**Regra geral:** cole **um comando por vez** e espere terminar. Comando que
demora não travou — o instalador leva minutos e escreve muito na tela.

---

## Índice

1. [Endereços e nomes](#1-endereços-e-nomes)
2. [Entrar no servidor](#2-entrar-no-servidor)
3. [Quando o terminal trava](#3-quando-o-terminal-trava)
4. [Atualizar o sistema](#4-atualizar-o-sistema-o-comando-do-dia-a-dia)
5. [Diagnóstico](#5-diagnóstico-quando-algo-não-funciona)
6. [Serviço: parar, subir, reiniciar, ver log](#6-serviço)
7. [Usuários e senhas](#7-usuários-e-senhas)
8. [Banco de dados](#8-banco-de-dados)
9. [Backup e restauração](#9-backup-e-restauração)
10. [Certificado HTTPS](#10-certificado-https)
11. [Reiniciar o servidor inteiro](#11-reiniciar-o-servidor-inteiro)
12. [Power BI](#12-power-bi)
13. [Códigos de erro da tela de login](#13-códigos-de-erro-da-tela-de-login)
14. [O que NUNCA fazer](#14-o-que-nunca-fazer)
15. [Emergências](#15-emergências)

---

## 1. Endereços e nomes

| O que | Valor |
|---|---|
| Painel (o que os operadores abrem) | `https://embarquesuinco.com.br` |
| API (servidor de dados) | `https://api.embarquesuinco.com.br` |
| IP do servidor | `2.25.95.253` |
| Usuário do servidor | `root` |
| Provedor | Hostinger — VPS KVM 2, Ubuntu 24.04 |

Caminhos importantes dentro do servidor:

| O que | Onde |
|---|---|
| Código em execução | `/opt/embarque-suinco` |
| Cópia do repositório (de onde atualiza) | `/opt/suinco-src` |
| Segredos (senhas, token) | `/opt/embarque-suinco/.env` |
| Backups do banco | `/var/backups/embarque-suinco` |
| Nome do serviço | `embarque-suinco` |
| Nome do banco | `embarque_suinco` |
| Usuário do sistema que roda a API | `suinco` |

**O painel e o servidor são coisas separadas.** O painel fica na Vercel e se
atualiza sozinho quando o código muda. O servidor só muda quando você roda o
comando de atualização. É por isso que às vezes o painel está novo e o servidor
não — e é isso que o item 4 resolve.

---

## 2. Entrar no servidor

### Pelo Terminal do Mac

```
ssh root@2.25.95.253
```

- Na primeira vez pergunta `Are you sure you want to continue connecting?` →
  digite `yes` e Enter.
- Pede a senha do root. **Ela não aparece enquanto você digita** — nem asterisco,
  nem bolinha. É assim mesmo. Digite e dê Enter.
- Deu certo quando o prompt vira `root@srv1879038:~#`.

### Pelo navegador (quando o SSH der problema)

No painel da Hostinger, dentro da VPS, existe o botão **Terminal do navegador**.
Ele entra já logado como root, sem senha e sem SSH. Funciona igual.

### Sair

```
exit
```

Sair não desliga nada. O servidor continua rodando — a sessão é só a sua janela.

---

## 3. Quando o terminal trava

Em ordem, uma dessas resolve:

| Situação | O que fazer |
|---|---|
| Comando rodando que você quer parar | **Ctrl + C** |
| Terminal não aceita nada, parece morto | **Ctrl + Q** (destrava o que o Ctrl+S congelou) |
| Tela cheia de texto, não sai de jeito nenhum | **Esc**, depois digite `:q!` e Enter (é o editor do Git) |
| Aparece `:` ou `END` embaixo | Aperte **q** |
| Nada funciona | Feche a janela e abra de novo. O servidor não depende dela |
| "Não consigo digitar a senha" | Você consegue. Senha não aparece na tela. Digite no escuro e dê Enter |

**Por que o Git trava:** ao juntar código ele abre um editor pedindo mensagem, e
o editor padrão do Ubuntu não tem instrução na tela. Por isso todo comando de
atualização neste manual leva `-c core.editor=true` — é o que impede o editor de
abrir.

---

## 4. Atualizar o sistema (o comando do dia a dia)

Três comandos, um por vez:

```
cd /opt/suinco-src
```
Entra na pasta onde fica a cópia do código.

```
git -c core.editor=true pull --no-edit
```
Baixa a versão nova do código. **Não** aplica nada ainda — só traz os arquivos.
Se reclamar de arquivo modificado ou pedir alguma coisa, **pare e me avise antes
de forçar**.

```
sudo bash entregaveis/suinco_logistica/backend/instalar.sh
```
Aplica tudo: copia o código para o lugar certo, instala dependências, aplica
alterações de banco, renova o certificado, reinicia o serviço e confere se voltou.

**O instalador é seguro de rodar quantas vezes quiser.** Ele confere cada etapa
antes de fazer: não duplica banco, não troca senha, não apaga usuário. É assim
que a atualização funciona.

**Quanto demora:** de 1 a 5 minutos, escrevendo bastante na tela. Não travou.

**O que olhar no fim:**
- a linha `endereços autorizados:` — mostra de quais endereços o painel pode abrir;
- `Operadores cadastrados: N` — confirma que ninguém sumiu;
- se apareceu `APLICADA 00X_....sql`, uma alteração de banco entrou agora.

**Depois de atualizar**, peça a quem estiver usando o painel para dar
**Ctrl + Shift + R** (recarrega ignorando o cache). Sem isso o navegador pode
continuar com a versão antiga.

---

## 5. Diagnóstico (quando algo não funciona)

```
sudo bash entregaveis/suinco_logistica/backend/diagnostico.sh
```

Rode de dentro de `/opt/suinco-src`. **Não altera nada** e pode rodar com o pátio
operando. Não imprime senha nem token — foi escrito para ser fotografado.

Ele confere, em ordem:

| Seção | Responde |
|---|---|
| 1. Serviço | A API está de pé? Reiniciou sozinha recentemente? |
| 2. Banco | O PostgreSQL responde? |
| 2b. Migrações | O banco está na mesma versão do código? |
| 3. API local | A aplicação responde dentro do servidor? |
| 4. Caminho público | O pátio consegue chegar? O CORS está liberado? |
| 5. Certificado | Quantos dias faltam para vencer |
| 6. Operadores | Quem está cadastrado e ativo |
| 7. Logs | Erros e bloqueios das últimas 6 horas |
| 8. Versão | Qual código está rodando |

No fim ele diz se está tudo certo ou lista os problemas encontrados.

**A seção 2b é a que mais importa.** Migração pendente faz o login funcionar e
toda operação com carga falhar — o sintoma parece "o painel parou". Se aparecer
pendência, a correção é rodar o instalador (item 4).

---

## 6. Serviço

O serviço é a API. Ele sobe sozinho quando o servidor liga.

**Ver se está rodando:**
```
sudo systemctl status embarque-suinco
```
Procure por `active (running)` em verde. Para sair da tela, aperte **q**.

**Reiniciar** (depois de mexer em configuração):
```
sudo systemctl restart embarque-suinco
```
Leva 2 a 3 segundos. Quem estiver no painel nem percebe — as gravações do momento
ficam na fila do navegador e sobem sozinhas.

**Parar** (só se souber por quê):
```
sudo systemctl stop embarque-suinco
```
O pátio inteiro para de sincronizar enquanto estiver parado.

**Subir de novo:**
```
sudo systemctl start embarque-suinco
```

**Ver o log ao vivo** (fica rolando conforme acontece):
```
sudo journalctl -u embarque-suinco -f
```
Para sair: **Ctrl + C**.

**Ver as últimas 50 linhas:**
```
sudo journalctl -u embarque-suinco -n 50 --no-pager
```

**Ver só os erros das últimas 2 horas:**
```
sudo journalctl -u embarque-suinco --since "2 hours ago" --no-pager | grep -i erro
```

---

## 7. Usuários e senhas

**A regra:** o dia a dia é pela tela. Entre no painel como Administração e abra a
aba **Usuários**. Lá você cria, troca setor, bloqueia e desbloqueia. É a mesma
tabela e a mesma criptografia do terminal — o terminal não faz nada que a tela não
faça.

O terminal serve para duas situações: criar o **primeiro** operador (a tela fica
dentro do painel, então alguém precisa existir antes) e recuperar acesso se você
mesmo ficar trancado do lado de fora.

Todos os comandos abaixo rodam de dentro de `/opt/embarque-suinco`:

```
cd /opt/embarque-suinco
```

**Ver quem está cadastrado:**
```
sudo -u suinco node scripts/operador.js listar
```
Mostra setor, nome, e-mail e último acesso. `✗` marca quem está desativado.

**Criar operador:**
```
sudo -u suinco node scripts/operador.js criar joao@suinco.com.br "João Pedro" Faturamento
```
A senha é pedida depois, e **não aparece enquanto você digita**. Nunca passe a
senha no próprio comando: ela ficaria gravada no histórico do terminal.

Setores válidos: `Logística`, `Portaria`, `Expedição`, `Faturamento`,
`Administração`.

**Trocar a senha de alguém:**
```
sudo -u suinco node scripts/operador.js senha joao@suinco.com.br
```

**Bloquear o acesso de alguém:**
```
sudo -u suinco node scripts/operador.js desativar joao@suinco.com.br
```
Desativar não apaga: o histórico do que a pessoa fez continua no log de auditoria,
como tem que ser.

### Quem vê o quê

| Setor | Abas |
|---|---|
| Logística | Todas as operacionais |
| Administração | Todas as operacionais **+ Usuários** |
| Portaria | Torre, Portaria, Histórico |
| Expedição | Torre, Expedição, Histórico |
| Faturamento | Torre, Faturamento, Histórico |

A aba **Usuários** é só da Administração — e isso vale no servidor, não só na
tela: mesmo forçando pelo navegador, a API recusa.

---

## 8. Banco de dados

O banco escuta **só dentro do servidor**. Não é alcançável pela internet, e é
assim que tem que ficar.

**Abrir o banco:**
```
sudo -u postgres psql embarque_suinco
```
Dentro dele, todo comando termina com `;`. Para sair: `\q`.

**Consultas úteis** (cole inteiras, com o ponto e vírgula):

Quantas cargas existem hoje:
```
sudo -u postgres psql embarque_suinco -c "SELECT status_atual, count(*) FROM fact_viagens WHERE excluida_em IS NULL GROUP BY 1 ORDER BY 2 DESC;"
```

Últimos 20 eventos do pátio:
```
sudo -u postgres psql embarque_suinco -c "SELECT data_evento, placa, status_anterior, status_novo, operador_nome FROM fact_statusfrota ORDER BY data_evento DESC LIMIT 20;"
```

Quem fez o quê nas últimas horas (auditoria):
```
sudo -u postgres psql embarque_suinco -c "SELECT data_evento, operador_nome, setor, acao, placa FROM log_eventos ORDER BY data_evento DESC LIMIT 30;"
```

Quantas placas na frota:
```
sudo -u postgres psql embarque_suinco -c "SELECT count(*) FROM dim_veiculos;"
```

**Aplicar alterações de banco pendentes** (o instalador já faz isso; use só se o
diagnóstico apontar pendência):
```
cd /opt/embarque-suinco && sudo -u suinco node scripts/migrar.js
```
Depois, sempre:
```
sudo systemctl restart embarque-suinco
```

---

## 9. Backup e restauração

O backup roda **sozinho todo dia**, guarda 14 dias e fica em
`/var/backups/embarque-suinco`. Você não precisa criar nada.

**Ver os backups existentes:**
```
ls -lh /var/backups/embarque-suinco
```

**Forçar um backup agora** (antes de mexer em algo arriscado):
```
sudo /etc/cron.daily/backup-embarque-suinco && ls -lh /var/backups/embarque-suinco | tail -3
```

**Restaurar** — só em emergência real, e **isto apaga o que está lá hoje**:
```
sudo systemctl stop embarque-suinco
```
```
sudo -u postgres dropdb embarque_suinco && sudo -u postgres createdb -O suinco embarque_suinco
```
```
gunzip -c /var/backups/embarque-suinco/embarque_suinco_AAAAMMDD.sql.gz | sudo -u postgres psql embarque_suinco
```
```
sudo systemctl start embarque-suinco
```
Troque `AAAAMMDD` pela data do arquivo. **Antes de rodar isso, me chame** — restaurar
significa perder tudo que aconteceu depois daquele backup.

**Baixar um backup para o seu Mac** (rode no *seu* computador, não no servidor):
```
scp root@2.25.95.253:/var/backups/embarque-suinco/embarque_suinco_AAAAMMDD.sql.gz ~/Downloads/
```

---

## 10. Certificado HTTPS

Renova sozinho. O diagnóstico avisa quando faltam menos de 10 dias.

**Ver quando vence:**
```
sudo certbot certificates
```

**Renovar na mão** (se o diagnóstico reclamar):
```
sudo certbot renew --nginx
```

**Reinstalar do zero** (se o HTTPS parar de funcionar):
```
sudo certbot --nginx -d api.embarquesuinco.com.br --reinstall --redirect
```

---

## 11. Reiniciar o servidor inteiro

Quando aparecer `*** System restart required ***` ao entrar, é atualização de
segurança do Ubuntu esperando reinício. **Não é erro e não é urgente** — mas vale
fazer.

**Escolha a hora.** O servidor fica fora do ar por 1 a 2 minutos. Quem estiver
operando vê o painel em modo offline, e as gravações ficam na fila até voltar.
Melhor momento: fim de expediente ou pátio vazio.

```
sudo reboot
```

A conexão SSH cai na hora — é esperado, não é problema. Espere 2 minutos e entre
de novo:

```
ssh root@2.25.95.253
```

Não precisa rodar mais nada: o serviço e o banco sobem sozinhos. Para confirmar:

```
cd /opt/suinco-src && sudo bash entregaveis/suinco_logistica/backend/diagnostico.sh
```

---

## 12. Power BI

O token de leitura fica no `.env`. Para vê-lo quando for configurar o Power BI:

```
sudo grep BI_TOKEN /opt/embarque-suinco/.env
```

**Não cole esse token em conversa, e-mail ou print.** Leia direto no servidor,
use, e feche.

Se ele vazar (apareceu num print, por exemplo), troque:
```
sudo sed -i "s/^BI_TOKEN=.*/BI_TOKEN=$(openssl rand -hex 32)/" /opt/embarque-suinco/.env && sudo systemctl restart embarque-suinco
```
Depois releia o novo com o comando acima e reconfigure o Power BI.

---

## 13. Códigos de erro da tela de login

Quando alguém não consegue entrar, a tela mostra um código entre colchetes. Ele
diz de quem é o problema — peça a foto:

| Código | Significa | Quem resolve |
|---|---|---|
| `[SENHA]` | E-mail ou senha errados | A própria pessoa |
| `[LIMITE]` | Muitas tentativas no mesmo minuto | Esperar 1 minuto |
| `[REDE]` | O aparelho não alcança o servidor | Wi-Fi/dados da pessoa |
| `[TEMPO]` | Internet lenta no aparelho | A própria pessoa |
| `[FILTRADO]` | A rede da empresa está bloqueando o login | TI da Suinco |
| `[BLOQUEIO]` | Chega, mas a resposta não volta inteira | TI da Suinco (ou eu) |
| `[ENDEREÇO]` | Painel aberto num endereço não autorizado | A mensagem diz o endereço certo |
| `[HTTP500]` | Erro dentro do servidor | Rodar o diagnóstico |

Na tela de login também existe o link **"Testar conexão"**: ele roda quatro testes
no navegador da pessoa e mostra em qual etapa a coisa morre. É a forma mais rápida
de saber se o problema é do aparelho, da rede ou do servidor.

---

## 14. O que NUNCA fazer

**Não abra a porta 5432 no firewall.** É a do banco. Ele fica só dentro do
servidor de propósito — banco exposto na internet é o caminho mais curto para o
vazamento.

**Não mande senha, chave SSH ou token para ninguém** — inclusive para mim. Eu não
preciso e não devo receber. Tudo que eu precisar, eu peço em forma de comando que
você roda.

**Não edite o `.env` na mão.** Ele guarda a senha do banco e o segredo das
sessões. Trocar um caractere ali derruba a API. Se precisar mudar algo, me peça.

**Não use `rm -rf`** em nada, nunca, sem me perguntar antes.

**Não rode `git push` ou `git commit`** no servidor. Ele só recebe código, não
manda.

**Não confie em `df` para diagnosticar disco cheio** — no VPS ele engana. Se der
"no space left on device", me chame.

---

## 15. Emergências

### O painel parou para todo mundo

```
cd /opt/suinco-src && sudo bash entregaveis/suinco_logistica/backend/diagnostico.sh
```
Manda a saída para mim. Enquanto isso, tente:
```
sudo systemctl restart embarque-suinco
```

### O serviço não sobe

```
sudo journalctl -u embarque-suinco -n 40 --no-pager
```
As últimas linhas dizem o motivo. Se falar em **migração pendente**, a correção é:
```
cd /opt/embarque-suinco && sudo -u suinco node scripts/migrar.js && sudo systemctl restart embarque-suinco
```

### Uma pessoa não consegue entrar

Peça o código entre colchetes da tela dela (item 13) e o resultado do link
**"Testar conexão"**. Isso responde sem precisar mexer no servidor.

### Alguém excluiu uma carga por engano

Carga excluída fica marcada no banco, não apagada. Dá para recuperar — me chame
com o número da carga e a data.

### Perdi o acesso de Administração

```
cd /opt/embarque-suinco && sudo -u suinco node scripts/operador.js senha seu@email.com
```
Troca a sua senha pelo terminal e devolve o acesso.

---

## Resumo de bolso

```
ssh root@2.25.95.253                                    # entrar

cd /opt/suinco-src                                      # ir para o código
git -c core.editor=true pull --no-edit                  # baixar atualização
sudo bash entregaveis/suinco_logistica/backend/instalar.sh   # aplicar

sudo bash entregaveis/suinco_logistica/backend/diagnostico.sh  # o que está errado?

sudo systemctl status  embarque-suinco                  # está rodando?
sudo systemctl restart embarque-suinco                  # reiniciar a API
sudo journalctl -u embarque-suinco -n 50 --no-pager     # últimas linhas do log

cd /opt/embarque-suinco
sudo -u suinco node scripts/operador.js listar          # quem tem acesso

sudo reboot                                             # reiniciar o servidor
exit                                                    # sair
```
