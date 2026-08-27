# Mapa do Embarque Suinco — documento mestre do arquiteto

**Uso interno · atualizado em 27/08/2026**

O que o sistema é, do que ele é feito, onde mexer, quando não mexer, e o que
fazer quando alguma coisa para. Escrito para o arquiteto do sistema — e para
responder à TI sem hesitar.

Todo dado técnico aqui foi conferido no código e no servidor no momento da
escrita. Não é resumo de memória.

| | |
|---|---|
| Setores em produção | 8 |
| Migrações de banco | 37 |
| Testes automatizados | 281 no servidor · 111 baterias de tela |

---

## Índice

1. [A resposta de 30 segundos](#1-a-resposta-de-30-segundos)
2. [O stack](#2-o-stack)
3. [As três camadas](#3-as-três-camadas--e-o-que-acontece-quando-alguém-clica)
4. [Segurança e a TI](#4-segurança--e-o-que-dizer-para-a-ti)
5. [Buscar um dado importante](#5-buscar-um-dado-importante)
6. [Backup](#6-backup--onde-está-e-como-pegar)
7. [Onde mexer, quando mexer](#7-onde-mexer-quando-mexer)
8. [Quando algo para](#8-quando-algo-para--sintoma-causa-comando)
9. [Chaves e acessos](#9-chaves-e-acessos--quem-tem-o-quê)
10. [O que ainda falta](#10-o-que-ainda-falta)

---

## 1. A resposta de 30 segundos

Quando alguém perguntar "o que é isso que vocês fizeram?", esta é a resposta.
Decore o primeiro parágrafo; o resto do documento só te dá o que sustentar.

> "É um sistema web próprio que controla o embarque de cargas da cooperativa em
> tempo real. Oito setores usam a mesma tela: a Logística programa, a Portaria
> registra entrada e saída, a Expedição carrega, o Faturamento emite a nota.
> Toda ação fica assinada com nome, setor e horário. Roda em servidor próprio,
> com banco PostgreSQL e backup diário."

- **Qual o problema que ele resolve:** antes a informação vivia em planilhas e
  ligações. "Onde está o caminhão?" era telefone para o pátio, várias vezes por
  dia, com resposta diferente em cada cópia da planilha.
- **Quem construiu:** desenvolvido sob medida para a Suinco, com código no nosso
  repositório — não é software alugado de terceiro, não tem mensalidade por
  usuário, e a cooperativa é dona do código e dos dados.
- **Onde os dados moram:** em servidor contratado pela cooperativa, no Brasil,
  com backup automático diário guardado por 14 dias.

---

## 2. O stack

A pergunta que te pegou. Primeiro a resposta curta, depois o detalhe que a TI
vai querer.

> "Frontend em JavaScript puro, sem framework. Backend em Node.js com Express.
> Banco PostgreSQL. Tempo real por Socket.IO. Front hospedado na Vercel,
> backend em VPS própria com Nginx e HTTPS."

### O detalhe, camada por camada

| Camada | Tecnologia | Por que essa escolha |
|---|---|---|
| **Painel** (o que abre no navegador) | HTML + CSS + JavaScript sem framework, empacotado num arquivo único | Abre rápido no celular do pátio, funciona offline depois da primeira visita, e não depende de biblioteca de terceiro que muda sozinha. |
| **Servidor** | Node.js 20+ com Express 4 | É a mesma linguagem do painel — uma pessoa só consegue dar manutenção nas duas pontas. |
| **Banco de dados** | PostgreSQL (via `pg`, SQL escrito à mão) | Banco relacional maduro e gratuito. SQL à mão em vez de ORM: dá para ler exatamente o que vai ao banco. |
| **Tempo real** | Socket.IO 4 | É o que faz a tela de um setor mudar quando outro registra algo, sem ninguém apertar atualizar. |
| **Segurança** | JWT, bcrypt, helmet, express-rate-limit, CORS | Sessão assinada, senha com hash, cabeçalhos de proteção, limite de requisições e origem controlada. |
| **Relatórios em PDF** | Playwright (Chromium no servidor) | O PDF sai idêntico em qualquer aparelho porque quem imprime é o servidor, não o celular de cada um. |
| **Aviso no celular** | web-push (Web Push / VAPID) | Notificação chega com o aplicativo fechado, sem precisar publicar app em loja. |
| **Hospedagem** | Painel na Vercel · Servidor em VPS Hostinger com Nginx + Certbot | O painel é estático e a Vercel entrega de graça e rápido; o servidor precisa de banco e disco, então fica em máquina própria. |

> **Se perguntarem "e se o desenvolvedor sumir?"** — o código está num
> repositório Git com histórico completo, os testes automatizados descrevem o
> comportamento esperado, e existe um manual do servidor com todos os comandos.
> Qualquer desenvolvedor Node consegue continuar.

---

## 3. As três camadas — e o que acontece quando alguém clica

Entender este caminho resolve 80% das dúvidas de "por que não apareceu?".

1. **O painel** (`embarquesuinco.com.br`) roda no navegador da pessoa. Ele grava
   primeiro no próprio aparelho e só depois manda pro servidor — por isso
   continua funcionando se a internet do pátio cair.
2. **O servidor** (`api.embarquesuinco.com.br`) é quem manda de verdade. Ele
   confere se aquele setor pode fazer aquilo, grava no banco e avisa todo mundo
   pelo Socket.IO. **Esconder um botão na tela não é segurança — recusar no
   servidor é.**
3. **O banco PostgreSQL** guarda tudo, e nada é apagado de verdade: correção
   gera revisão, exclusão marca a data. O histórico é permanente.

> **A consequência prática:** quando você publica uma mudança no painel, ela
> chega a todo mundo em minutos pela Vercel. Quando a mudança é no servidor,
> **alguém precisa rodar a atualização na VPS** — senão o painel novo conversa
> com um servidor velho.

---

## 4. Segurança — e o que dizer para a TI

O pessoal da TI ficou de cara porque um sistema apareceu na empresa sem passar
por eles. É uma reação legítima. O que desarma é transparência com fatos.

### O que responder ao Pedro

- **O repositório pode ser compartilhado?** Sim. Auditado antes:
  **nenhuma senha, chave ou token está no repositório**, nem no histórico de
  commits. Os segredos vivem só no `.env` da VPS, bloqueado por regra explícita
  de versionamento.
- **Os dados são da cooperativa?** Sim — banco em servidor contratado pela
  Suinco, sem terceiro intermediando.
- **Tem controle de acesso?** Cada pessoa tem login próprio, o setor define o
  que ela vê e faz, existe segundo fator disponível, sessão revogável e bloqueio
  pela Administração. Toda ação fica registrada com autor e horário.
- **Tem backup?** Diário, automático, guardado 14 dias — e existe um script que
  **testa a restauração**, porque backup que nunca foi restaurado é promessa,
  não backup.
- **Passou por teste?** 281 testes automatizados no servidor e 111 baterias de
  tela, rodados a cada publicação.

### O que é honesto reconhecer

**Não minta para a TI — o custo de ser pego é maior que o de admitir.** Três
pontos que eles podem levantar e você deve admitir de frente:

1. O sistema nasceu fora do processo formal de TI.
2. Hoje ele depende de uma VPS que só você e eu acessamos — **não há um segundo
   administrador**.
3. A senha de root do servidor precisa ser trocada, e isso ainda não foi feito.

Levar esses três pontos você mesmo transforma uma auditoria hostil numa conversa
de melhoria.

> **A proposta que fecha a conversa:** ofereça acesso de leitura do repositório
> à TI e peça que indiquem um segundo responsável técnico pelo servidor. Custa
> nada e resolve o incômodo real deles, que é não ter visibilidade.

### Prova da auditoria do repositório

Comandos que qualquer um pode repetir para confirmar que não há segredo
versionado:

```bash
# a senha de root nunca entrou em nenhum commit de nenhuma branch
git log --all --oneline -S'<a senha>'        # → vazio

# o .env é bloqueado por regra explícita
git check-ignore -v entregaveis/suinco_logistica/backend/.env
# → .gitignore:6:entregaveis/suinco_logistica/backend/.env

# o único .env versionado é o EXEMPLO, com os campos em branco
git ls-files | grep "\.env"
# → entregaveis/suinco_logistica/backend/.env.exemplo
```

O que aparece no repositório e é aceitável: o **endereço IP** do servidor, em
scripts e manuais de operação. IP não é segredo — o que protege o servidor é a
senha (e, no futuro, chave SSH), não o endereço ser desconhecido.

---

## 5. Buscar um dado importante

Três caminhos, do mais seguro para o mais técnico. Comece sempre pelo primeiro.

### Caminho 1 — pelo painel · *sem risco*

Serve para 95% dos casos: **Histórico** responde "o que aconteceu com esta
carga", **Relatórios** exporta período em PDF, e cada linha do Histórico abre a
linha do tempo completa ao ser tocada. Não precisa de terminal.

### Caminho 2 — consulta direta no banco · *exige cuidado*

Quando você precisa de algo que o painel não mostra. Use sempre `SELECT` —
nunca `UPDATE` ou `DELETE` à mão.

```bash
# no terminal da VPS. O usuário do banco é postgres, não root.
su postgres
psql embarque_suinco
```

```sql
-- exemplo: tudo que aconteceu com uma placa nos últimos 7 dias
SELECT c.numero_carga, c.placa, e.acao, e.setor, e.autor, e.criado_em
FROM log_eventos e JOIN fact_viagens c ON c.id = e.carga_id
WHERE c.placa = 'ABC1D23' AND e.criado_em > now() - interval '7 days'
ORDER BY e.criado_em;

-- sair: \q   e depois  exit
```

### Caminho 3 — o diagnóstico pronto · *sem risco*

Responde "o sistema está saudável?" sem você precisar saber SQL. Pode rodar com
o pátio operando.

```bash
cd /opt/suinco-src
bash entregaveis/suinco_logistica/backend/diagnostico.sh
```

---

## 6. Backup — onde está e como pegar

O backup roda sozinho todo dia e guarda 14 dias. Você não precisa criar nada;
precisa saber achar e restaurar.

| | |
|---|---|
| Onde ficam os backups | `/var/backups/embarque-suinco` |
| Frequência · retenção | Diária, automática · 14 dias |
| Formato | `.sql.gz` (dump comprimido) |
| Código rodando | `/opt/embarque-suinco` |
| Cópia do repositório | `/opt/suinco-src` |
| Segredos | `/opt/embarque-suinco/.env` |
| Nome do serviço | `embarque-suinco` |

**Ver os backups que existem** · *sem risco*
```bash
ls -lh /var/backups/embarque-suinco
```

**Forçar um backup agora** · *sem risco* — faça isto **antes** de qualquer coisa arriscada
```bash
/etc/cron.daily/backup-embarque-suinco && ls -lh /var/backups/embarque-suinco | tail -3
```

**Baixar um backup para o seu computador** · *sem risco* — rode no **seu** computador, não na VPS
```bash
scp root@2.25.95.253:/var/backups/embarque-suinco/embarque_suinco_AAAAMMDD.sql.gz ~/Downloads/
```

**Restaurar** · ⚠️ *último recurso*

> **Restaurar apaga tudo que aconteceu depois daquele backup.** Um dia inteiro de
> pátio pode sumir. Só faça isso com o sistema já quebrado, sabendo exatamente o
> que perde — e, se der, me chame antes.

```bash
systemctl stop embarque-suinco
gunzip -c /var/backups/embarque-suinco/embarque_suinco_AAAAMMDD.sql.gz | su postgres
systemctl start embarque-suinco
```

> **A prova de que o backup presta:** existe um script que restaura num banco
> descartável e confere se os dados chegaram inteiros —
> `scripts/testar_restauracao_backup.sh`. Ele roda junto com o
> `atualizar_tudo.sh`.

---

## 7. Onde mexer, quando mexer

A regra que evita o incidente: **mudança no painel é barata, mudança no servidor
exige atualizar a VPS, e mudança no banco é definitiva.**

| Quero mudar… | Onde vive | Risco | Precisa fazer o quê |
|---|---|---|---|
| Texto, cor, posição de botão | `styles.css`, `app.js` | baixo | Publicar o painel. Chega sozinho. |
| Uma tela nova, um campo novo na tela | `app.js`, `index_suinco.html` | baixo | Publicar o painel + rodar a bateria de testes. |
| Regra de quem pode fazer o quê | `backend/src/dominio/fluxo.js` | médio | Publicar **e** atualizar a VPS. Painel novo com servidor velho recusa a ação. |
| Um campo novo guardado no banco | `backend/migrations/` | **alto** | Backup antes, migração, atualizar a VPS. Migração aplicada não volta atrás sozinha. |
| Guias dos setores | `tutoriais/roteiros.py` | baixo | Rodar o gerador. Os PDFs saem com prints novos. |

### Quando NÃO mexer

- **Durante a janela de embarque.** O pátio carregando é o pior momento para
  descobrir um defeito. Prefira início da manhã ou fim do dia.
- **Sem teste que prove.** A regra desta casa: primeiro escreve o teste que
  falha, depois corrige. Correção sem teste volta.
- **Duas mudanças de uma vez.** Se quebrar, você não sabe qual foi.
- **Sexta à tarde.** Clássico, e verdadeiro.

### O comando que publica no servidor

```bash
cd /opt/suinco-src && git pull
bash entregaveis/suinco_logistica/backend/atualizar_tudo.sh
```

> **Por que `atualizar_tudo.sh` e não `atualizar.sh`:** o primeiro faz tudo —
> atualiza, aplica migrações, testa a restauração do backup e imprime um resumo
> do que aconteceu. É o que você me manda depois.

---

## 8. Quando algo para — sintoma, causa, comando

Ache o sintoma na coluna da esquerda. Não pule para o comando sem ler a causa.

| O que as pessoas relatam | Causa mais provável | O que fazer |
|---|---|---|
| **"O painel não abre"** / fica girando | O serviço do servidor caiu, ou o certificado venceu | `systemctl status embarque-suinco`. Se parado: `systemctl restart embarque-suinco` |
| **"Abre mas fica desconectado"** (rodapé vermelho) | O painel não alcança o servidor — rede da empresa ou serviço fora | Abrir `api.embarquesuinco.com.br/health` no navegador. Responde = é rede local; não responde = é o servidor. |
| **"Registrei e o outro setor não vê"** | Gravou offline e ainda não subiu, ou o servidor recusou | A pessoa vê o aviso de conexão no rodapé. Voltando a rede, a fila sobe sozinha. Se o aviso disse "recusado", é permissão de setor. |
| **"O relatório em PDF não sai"** | O Chromium do servidor não está pronto | Conferir em `/health` o campo `pdf.pronto`. Falso → rodar `atualizar.sh` na VPS. |
| **"Não chega notificação no celular"** | Chaves de aviso ausentes, ou a pessoa não ativou no aparelho | Sino **Avisos** no painel → Ativar. No servidor, as chaves ficam no `.env` (`VAPID_*`). |
| **"Sumiu uma carga"** | Quase sempre foi cancelada ou excluída por alguém — nada some sozinho | Histórico → buscar pelo número. O log mostra quem fez e quando. Administração consegue restaurar. |
| Tudo lento, todo mundo reclamando | Disco cheio na VPS ou limite de requisições atingido | `df -h` para o disco; `diagnostico.sh` para o resto. |

> **Regra de ouro do socorro:** antes de reiniciar, deletar ou restaurar
> qualquer coisa, **tire um backup** (seção 6) e anote o que você viu na tela.
> Metade dos incidentes fica sem diagnóstico porque a evidência foi apagada na
> pressa de resolver.

---

## 9. Chaves e acessos — quem tem o quê

Sendo o arquiteto, esta é a lista que você precisa conseguir recitar.

| Acesso | Onde se usa | Onde a chave vive |
|---|---|---|
| **Servidor (root)** | SSH em `2.25.95.253` | Só na sua cabeça / gerenciador de senhas — ⚠️ **trocar** |
| **Banco de dados** | Usuário `postgres` na VPS | `/opt/embarque-suinco/.env` |
| **Assinatura de sessão** | Login dos operadores | `.env` → `JWT_SEGREDO` |
| **Aviso no celular** | Push nos aparelhos | `.env` → `VAPID_PUBLICA` / `VAPID_PRIVADA` |
| **Repositório** | GitHub · código-fonte | Sua conta GitHub |
| **Publicação do painel** | Vercel | Conta Vercel ligada ao GitHub |
| **Domínio** | `embarquesuinco.com.br` | Registro em nome da cooperativa |

> **Pendência de segurança em aberto:** a senha de root do servidor foi exposta
> em conversa e **ainda não foi trocada**. Na VPS: `passwd root`. É rápido e
> elimina o único risco real desta lista.

---

## 10. O que ainda falta

Um mapa honesto mostra também o que não está pronto. Nenhum destes pontos impede
a operação; todos merecem data.

**Segurança e continuidade**
- Trocar a senha de root do servidor.
- Segundo responsável técnico — hoje só você acessa a VPS.
- Monitor de queda (UptimeRobot) para avisar antes de o pátio perceber.

**Operação**
- 6 códigos de rota ainda faltando no cadastro.
- Atualização de pacotes em janela combinada.
- Robô de WhatsApp com o resumo do dia — projetado, não construído.

---

*Programação de Embarque · Suinco Cooperativa Agroindustrial · documento de uso
interno. Versão em página navegável, com botões de copiar comando, no artifact
correspondente.*
