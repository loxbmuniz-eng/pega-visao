# Pós-morte — instabilidade de 08/08/2026

O que aconteceu, por que aconteceu, o que foi corrigido e o que ainda depende
de confirmação. Escrito para não precisar reconstruir essa história de
memória da próxima vez.

---

## 1. Linha do tempo (ordem dos fatos, não hora exata)

1. Painel começa a mostrar **"Sem conexão com o servidor"** e o login passa a
   recusar com **"Muitas tentativas de login... espere um minuto"**, sem
   liberar mesmo depois de esperar.
2. Primeira correção: o limite de tentativas de login (`RATE_LIMIT_LOGIN`)
   estava no padrão de fábrica (30/minuto) — baixo demais para um escritório
   inteiro saindo do mesmo IP. Subimos para 300. Login voltou a funcionar
   para a maioria, mas o Administrador (Luís) continuou bloqueado.
3. Investigação mais funda: existe um **segundo** limite, geral, para
   qualquer chamada à API (`RATE_LIMIT`, padrão 300/minuto), separado do
   limite de login. Um único IP (`177.85.5.10` — provavelmente o IP
   compartilhado do escritório, várias pessoas atrás do mesmo roteador)
   estava estourando esse limite geral. Subimos para 2000.
4. Painel volta a oscilar: **"fica online e offline"**, rodapé laranja
   piscando. Passamos um comando de navegador (sem mexer no servidor) para
   forçar o painel a se limpar e recarregar do zero.
5. Esse recarregamento do zero expôs um **segundo bug, real, pré-existente**:
   "Seguiu Viagem hoje" caiu de 5 para 0. Não foi perda de dado — foi um erro
   de leitura (item 2 abaixo).
6. A causa da oscilação "online/offline" acabou sendo um **terceiro problema**,
   mais profundo: o próprio painel, ao tentar se reconectar, martelava o
   servidor sem intervalo — e o servidor, defendendo-se com o limite, recusava
   ainda mais forte, o que gerava mais tentativas. Uma espiral.
7. Os dois bugs de código foram corrigidos, testados e publicados (commits
   abaixo). A configuração de limites subida em produção continua valendo.

---

## 2. As três causas raízes (confirmadas por evidência, não por suspeita)

### Causa 1 — IP compartilhado do escritório estourando o limite geral

Confirmado lendo o log de acesso do nginx ao vivo: o IP `177.85.5.10`
(Windows/Edge) gerava um volume de requisições muito acima dos outros
aparelhos (Mac, iPhones), majoritariamente recusadas com 429. Provável IP
único compartilhado por várias estações do escritório atrás do mesmo NAT.

**Ação:** `RATE_LIMIT_LOGIN=300` e `RATE_LIMIT=2000` em
`/opt/embarque-suinco/.env`, aplicado com `systemctl restart embarque-suinco`.
Isso é configuração de produção, não está no código — não precisa de deploy
para mudar de novo, só editar o `.env` e reiniciar o serviço (ver
`MANUAL_DO_SERVIDOR.md`).

### Causa 2 — leitura completa do painel descartava os dados mais recentes

`backend/src/rotas/estado.js`, rota `GET /api/estado`: a leitura "completa"
(quando o painel recarrega do zero, sem `?desde=`) buscava até 5000 linhas
**da mais antiga para a mais nova** (`ORDER BY ... ASC LIMIT 5000`). Assim
que o histórico passa de 5000 linhas — o que já acontece — as linhas mais
antigas enchem a cota inteira e **as de hoje nunca chegam**. Foi exatamente
isso que fez "Seguiu Viagem hoje" mostrar 0: o dado nunca saiu do banco, só
não chegou na tela.

**Correção:** inverter para `ORDER BY ... DESC LIMIT 5000` só na leitura
completa (a leitura incremental, que já é um recorte pequeno e recente,
continua `ASC` — nunca esbarra no limite). Confirmado por leitura de código
que `fundirEstadoRemoto()` (`data.js`) mescla por id sem depender da ordem do
array, então a mudança é segura para quem consome.

- Commit no código: `0ea1bd5`
- Publicado (branch de produção do painel): `9814764`
- **Só entra em vigor no servidor depois que alguém rodar `atualizar.sh` na
  VPS** — é mudança de backend, não é automática como o painel.

### Causa 3 — o painel martelava o próprio limite que o recusava

`suinco-api.js`, `sincronizarAgora()`: toda troca em tempo real (carga
criada, carga atualizada, movimentação nova, reconexão do socket) disparava
uma nova sincronização, sem esperar a anterior terminar e **sem nenhum
recuo** se o servidor respondesse 429. Numa rede instável — o socket
reconectando repetidamente — isso vira o próprio painel martelando o limite
que está recusando, e cada recusa gera mais tentativas. Essa é a causa real
do "fica online e offline": não era o valor do limite estar errado, era o
painel não recuar depois de ser recusado.

**Correção:** trava contra chamadas simultâneas (quem chega durante uma
sincronia em andamento só marca "roda mais uma vez ao terminar", não
empilha) e recuo que dobra a cada 429 — começa em 5 s, dobra até um teto de
60 s, volta ao mínimo assim que uma sincronia der certo.

- Commit no código: `d1c977d`
- Publicado: `d24fd2b`
- Frontend puro — já está no ar via Vercel, não depende de nenhum comando no
  servidor.

---

## 3. O que foi verificado e descartado como causa

Para não reabrir hipóteses já investigadas com evidência:

- **Bloqueio por conta/usuário** — não existe esse mecanismo em `auth.js`.
- **`trust proxy` mal configurado** (contagem de saltos de proxy errada) —
  conferido lendo a config do nginx: é exatamente um salto até o Node, a
  config bate.
- **Socket.IO derrubando sessão duplicada** — não existe essa lógica em
  `tempo-real.js`; nenhuma sessão é expulsa por outra entrar.
- **Backend caindo sozinho** — todo ciclo de `SIGTERM`/reinício visto no log
  do servidor correspondia a um `systemctl restart` nosso, intencional, não a
  uma queda espontânea.
- **Loop infinito de atualização do painel** (service worker) — a versão do
  service worker é uma constante fixa, sem indício de bug de versionamento
  causando recarregamento repetido.
- **Perda de dado no banco** — os 5 registros de "Seguiu Viagem hoje" nunca
  saíram do PostgreSQL; o bug era só de leitura (causa 2).

---

## 4. Pendências — o que ainda depende de alguém rodar algo na VPS

- [ ] Confirmar que `atualizar.sh` já rodou em produção (aplica a causa 2).
- [ ] Rodar a checagem somente-leitura para confirmar o dado no banco:
  ```bash
  sudo -u postgres psql -d embarque_suinco -c "
  SELECT count(*) FILTER (WHERE status_novo = 'Seguiu Viagem' AND data_evento >= current_date)
    AS seguiu_viagem_hoje_no_banco
  FROM fact_statusfrota;
  "
  ```
- [ ] Confirmação de quem estava travado (Administração) de que login e
  painel estão estáveis agora, sem piscar entre online/offline.

## 5. Lições que viram regra no `PROTOCOLO_MESTRE_DE_MUDANCAS.md`

- Configuração de limite (`RATE_LIMIT*`) resolve sintoma de volume, mas não
  resolve um cliente que não recua — os dois precisam andar juntos.
- Qualquer "leitura completa com `LIMIT`" precisa pensar em qual ponta do
  tempo o corte descarta. `ASC + LIMIT` corta o futuro; `DESC + LIMIT` corta
  o passado. Uma leitura "estado atual" quase sempre quer a segunda.
- Reset, rollback e reboot foram cogitados sob pressão e **nenhum dos três
  era a causa real** — os três teriam custado tempo e risco sem resolver
  nada. Causa raiz por evidência, sempre antes de ação destrutiva.
