#!/usr/bin/env bash
# =====================================================================
# EMBARQUE SUINCO — instalação do servidor
# ---------------------------------------------------------------------
# Deixa o VPS pronto do zero: Node, PostgreSQL, Nginx, HTTPS, firewall,
# serviço que sobe sozinho no boot, banco criado e base de frota carregada.
#
# Rode como root, de dentro do repositório clonado:
#     sudo bash entregaveis/suinco_logistica/backend/instalar.sh
#
# É SEGURO RODAR DE NOVO. Cada etapa confere se já foi feita antes de
# fazer. Rodar duas vezes não duplica banco, não troca senha e não derruba
# o serviço que está no ar — é assim que a atualização funciona.
# =====================================================================

set -Eeuo pipefail

APP_USER="suinco"
APP_DIR="/opt/embarque-suinco"
DB_NAME="embarque_suinco"
DB_USER="suinco"
DOMINIO_API="${DOMINIO_API:-api.embarquesuinco.com.br}"
DOMINIO_PAINEL="${DOMINIO_PAINEL:-https://embarquesuinco.com.br}"
PORTA_APP=3000

FONTE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAINEL_DIR="$(dirname "$FONTE")"

azul()    { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
ok()      { printf '   \033[0;32mok\033[0m   %s\n' "$*"; }
aviso()   { printf '   \033[0;33m!\033[0m    %s\n' "$*"; }
erro()    { printf '\n\033[0;31mERRO:\033[0m %s\n\n' "$*" >&2; exit 1; }

trap 'erro "falhou na linha $LINENO. Nada foi deixado pela metade sem aviso — leia a mensagem acima e me mande."' ERR

# --- 0. Verificações antes de mexer em qualquer coisa -----------------
azul "0. Conferindo o ambiente"
[[ $EUID -eq 0 ]] || erro "rode com sudo: sudo bash $0"
[[ -f "$FONTE/package.json" ]] || erro "não achei o package.json. Rode de dentro do repositório clonado."
command -v apt-get >/dev/null || erro "este script é para Ubuntu/Debian. Me diga qual distro você usa que eu adapto."

. /etc/os-release
ok "sistema: $PRETTY_NAME"
ok "domínio da API: $DOMINIO_API"

# Porta 80/443 já ocupada é o tropeço mais provável neste servidor: o
# template da Hostinger vem com Docker, e um container publicando a 80
# impede o Nginx de subir. Melhor descobrir agora, com o servidor intacto,
# do que no meio da instalação com metade das coisas configuradas.
for porta in 80 443; do
  QUEM="$(ss -lptnH "sport = :$porta" 2>/dev/null | head -1 || true)"
  if [[ -n "$QUEM" ]] && ! grep -q nginx <<<"$QUEM"; then
    printf '\n\033[0;31mPORTA %s JÁ OCUPADA\033[0m\n' "$porta" >&2
    printf '  %s\n\n' "$QUEM" >&2
    if command -v docker >/dev/null && docker ps --format '{{.Names}}\t{{.Ports}}' 2>/dev/null | grep -q ":$porta->"; then
      printf 'Há um container Docker publicando a porta %s:\n\n' "$porta" >&2
      docker ps --format '  {{.Names}}  ->  {{.Ports}}' 2>/dev/null >&2
      printf '\nPare o container (docker stop NOME) ou remapeie a porta dele,\n' >&2
      printf 'e rode este script de novo.\n\n' >&2
    else
      printf 'Descubra o que é com:  ss -lptn "sport = :%s"\n' "$porta" >&2
      printf 'Pare o serviço e rode este script de novo.\n\n' >&2
    fi
    exit 1
  fi
done
ok "portas 80 e 443 livres"

# --- 1. Pacotes do sistema -------------------------------------------
azul "1. Pacotes do sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
# rsync e iproute2 (ss) são usados pelo script e nem sempre vêm no template.
apt-get install -y -qq curl ca-certificates gnupg git ufw rsync iproute2 nginx \
                       postgresql postgresql-contrib certbot python3-certbot-nginx >/dev/null
ok "nginx, postgresql, certbot, ufw"

# Node 20+ pelo repositório oficial. O do Ubuntu costuma ser antigo demais
# para o `node --test` e para o socket.io atual.
if ! command -v node >/dev/null || [[ $(node -v | sed 's/v\([0-9]*\).*/\1/') -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs >/dev/null
fi
ok "node $(node -v), npm $(npm -v)"

# --- 2. Usuário do sistema -------------------------------------------
azul "2. Usuário da aplicação"
# A API não roda como root. Se um dia for comprometida, o estrago fica
# limitado ao que este usuário alcança — que é quase nada.
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "/home/$APP_USER" --shell /usr/sbin/nologin "$APP_USER"
  ok "usuário $APP_USER criado (sem shell, sem login)"
else
  ok "usuário $APP_USER já existe"
fi

# --- 3. Banco de dados ------------------------------------------------
azul "3. PostgreSQL"
systemctl enable --now postgresql >/dev/null 2>&1
ENV_FILE="$APP_DIR/.env"

ENV_JA_EXISTIA=0
if [[ -f "$ENV_FILE" ]]; then
  # Reinstalação: reaproveita a senha que já está em uso. Gerar outra aqui
  # deixaria o serviço sem conseguir conectar no próprio banco.
  DB_PASS="$(grep -E '^PGPASSWORD=' "$ENV_FILE" | cut -d= -f2-)"
  ENV_JA_EXISTIA=1
  aviso "reaproveitando as credenciais do .env existente"
else
  DB_PASS="$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)"
fi

su - postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'\"" | grep -q 1 || \
  su - postgres -c "psql -qc \"CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS'\"" >/dev/null
su - postgres -c "psql -qc \"ALTER ROLE $DB_USER PASSWORD '$DB_PASS'\"" >/dev/null

su - postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='$DB_NAME'\"" | grep -q 1 || \
  su - postgres -c "createdb -O $DB_USER $DB_NAME" >/dev/null
ok "banco $DB_NAME e usuário $DB_USER prontos"

# O PostgreSQL escuta SÓ em localhost. Isto não é preferência: banco
# alcançável pela internet é o caminho mais curto para o vazamento.
PG_CONF="$(su - postgres -c 'psql -tAc "SHOW config_file"')"
if grep -qE "^\s*listen_addresses\s*=\s*'\*'" "$PG_CONF"; then
  sed -i "s/^\s*listen_addresses.*/listen_addresses = 'localhost'/" "$PG_CONF"
  systemctl restart postgresql
  aviso "PostgreSQL estava aceitando conexão externa — corrigido para localhost"
fi
ok "PostgreSQL restrito a localhost"

# --- 4. Código da aplicação ------------------------------------------
azul "4. Código"
mkdir -p "$APP_DIR"
# --delete mantém o destino igual à origem, sem deixar arquivo velho de
# uma versão anterior sobrando e sendo carregado sem ninguém perceber.
rsync -a --delete \
  --exclude node_modules --exclude .env --exclude testes \
  "$FONTE/" "$APP_DIR/"
# O seed da frota mora um nível acima, junto do painel.
cp "$PAINEL_DIR/frota_seed_2026.csv" "$APP_DIR/../frota_seed_2026.csv" 2>/dev/null || \
  cp "$PAINEL_DIR/frota_seed_2026.csv" "$APP_DIR/frota_seed_2026.csv"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
ok "código em $APP_DIR"

# --- 5. Configuração e segredos ---------------------------------------
azul "5. Configuração"
if [[ ! -f "$ENV_FILE" ]]; then
  JWT="$(openssl rand -base64 48 | tr -d '\n')"
  BI="$(openssl rand -hex 32)"
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=$PORTA_APP
PGHOST=127.0.0.1
PGPORT=5432
PGDATABASE=$DB_NAME
PGUSER=$DB_USER
PGPASSWORD=$DB_PASS
JWT_SECRET=$JWT
JWT_VALIDADE=12h
ORIGENS_PERMITIDAS=$DOMINIO_PAINEL,https://www.embarquesuinco.com.br
BI_TOKEN=$BI
RATE_LIMIT=300
RATE_LIMIT_LOGIN=30
EOF
  ok ".env gerado com segredos aleatórios"
else
  ok ".env já existia — preservado"
fi

# Reconcilia as chaves NÃO secretas de um .env antigo.
#
# O .env é preservado entre instalações, e isso é certo: regerar segredo
# derruba a sessão de todo mundo e quebra a conexão com o banco. Mas o
# efeito colateral é que uma configuração corrigida depois da primeira
# instalação nunca chega ao servidor.
#
# Foi assim que um operador ficou sem entrar: o painel abria em
# www.embarquesuinco.com.br, endereço que só passou a constar do modelo
# depois — o .env em uso ainda listava a versão sem www, e a API recusava.
# Segredo nenhum é tocado aqui.
adicionar_origem() {
  local nova="$1"
  local atual
  atual="$(grep -E '^ORIGENS_PERMITIDAS=' "$ENV_FILE" | cut -d= -f2-)"
  if [[ ",$atual," != *",$nova,"* ]]; then
    sed -i "s|^ORIGENS_PERMITIDAS=.*|ORIGENS_PERMITIDAS=${atual:+$atual,}$nova|" "$ENV_FILE"
    aviso "endereço $nova faltava na lista autorizada — adicionado"
  fi
}
if grep -qE '^ORIGENS_PERMITIDAS=' "$ENV_FILE"; then
  adicionar_origem "$DOMINIO_PAINEL"
  adicionar_origem "https://www.${DOMINIO_PAINEL#https://}"
else
  echo "ORIGENS_PERMITIDAS=$DOMINIO_PAINEL,https://www.${DOMINIO_PAINEL#https://}" >> "$ENV_FILE"
  aviso "ORIGENS_PERMITIDAS não existia no .env — criada"
fi
ok "endereços autorizados: $(grep -E '^ORIGENS_PERMITIDAS=' "$ENV_FILE" | cut -d= -f2-)"
# Só o dono lê. Este arquivo é o único lugar com segredo no servidor.
chown "$APP_USER:$APP_USER" "$ENV_FILE"
chmod 600 "$ENV_FILE"

# --- 6. Dependências e banco ------------------------------------------
azul "6. Dependências e migrations"
su -s /bin/bash "$APP_USER" -c "cd '$APP_DIR' && npm ci --omit=dev --no-audit --no-fund" >/dev/null 2>&1 || \
  su -s /bin/bash "$APP_USER" -c "cd '$APP_DIR' && npm install --omit=dev --no-audit --no-fund" >/dev/null
ok "dependências instaladas"

su -s /bin/bash "$APP_USER" -c "cd '$APP_DIR' && node scripts/migrar.js"
su -s /bin/bash "$APP_USER" -c "cd '$APP_DIR' && node scripts/seed.js"

# --- 7. Serviço -------------------------------------------------------
azul "7. Serviço systemd"
cat > /etc/systemd/system/embarque-suinco.service <<EOF
[Unit]
Description=Embarque Suinco API
Documentation=https://embarquesuinco.com.br
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node src/servidor.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=embarque-suinco

# Endurecimento. Se a aplicação for comprometida, estas linhas são o que
# impede o atacante de ir além do processo.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$APP_DIR
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true
RestrictNamespaces=true
LockPersonality=true

# MemoryDenyWriteExecute NÃO pode entrar aqui.
#
# Ela impede o processo de tornar memória executável — ótima prática para
# quase tudo, e incompatível com Node por construção: o V8 compila
# JavaScript para código de máquina em tempo de execução e precisa
# exatamente dessa transição.
#
# Com ela ligada o serviço morre com core dump logo no primeiro trecho de
# código que fica "quente" o bastante para ser compilado:
#   v8::base::OS::SetPermissions -> Check failed: 12 == errno   (12 = ENOMEM)
#
# Não é ajustável nem contornável com flag do Node. A única alternativa
# seria rodar com --jitless, que derruba o desempenho a um patamar
# inaceitável para um servidor. Fica de fora, e as linhas acima cobrem o
# resto da superfície.

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable embarque-suinco >/dev/null 2>&1
systemctl restart embarque-suinco
sleep 3
systemctl is-active --quiet embarque-suinco || {
  journalctl -u embarque-suinco -n 30 --no-pager
  erro "o serviço não subiu. O log está acima."
}
ok "serviço ativo e configurado para subir no boot"

# --- 8. Nginx ---------------------------------------------------------
azul "8. Nginx"
cat > /etc/nginx/sites-available/embarque-suinco <<EOF
# O cabeçalho Connection só pode valer "upgrade" quando o cliente PEDIU
# upgrade. Fixá-lo em "upgrade" para toda requisição — que era como estava —
# quebra o HTTP comum: o navegador fica esperando uma troca de protocolo que
# nunca vem, e a página trava no meio do carregamento.
#
# Foi exatamente o que aconteceu: o <script> do socket.io.js pendurava e a
# barra de progresso parava antes da metade. O curl não pegou porque não
# mantém a conexão viva do mesmo jeito.
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    listen [::]:80;
    server_name $DOMINIO_API;

    # Não anunciar a versão do nginx: é informação de graça para quem sonda.
    server_tokens off;

    client_max_body_size 2m;

    location / {
        proxy_pass http://127.0.0.1:$PORTA_APP;
        proxy_http_version 1.1;

        # Estes três cabeçalhos são o que faz o Socket.IO funcionar através
        # do proxy. Sem eles, o painel cai para consulta periódica e ninguém
        # entende por que "o tempo real parou".
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$host;

        # Sem X-Forwarded-For, o rate limit enxerga todo mundo como um IP só.
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
EOF

ln -sf /etc/nginx/sites-available/embarque-suinco /etc/nginx/sites-enabled/embarque-suinco
rm -f /etc/nginx/sites-enabled/default
nginx -t >/dev/null 2>&1 || erro "configuração do nginx inválida"
systemctl reload nginx
ok "nginx encaminhando $DOMINIO_API para a porta $PORTA_APP"

# --- 9. Firewall ------------------------------------------------------
azul "9. Firewall"
ufw allow 22/tcp   >/dev/null 2>&1   # SSH — sem isso você se tranca do lado de fora
ufw allow 80/tcp   >/dev/null 2>&1   # HTTP — o certbot precisa para validar
ufw allow 443/tcp  >/dev/null 2>&1   # HTTPS
ufw --force enable >/dev/null 2>&1
# A 5432 NÃO é aberta. O banco fala só com a aplicação, pelo localhost.
ufw status numbered | sed 's/^/     /'
ok "22, 80 e 443 abertas · 5432 fechada (é assim que tem que ser)"

# --- 10. HTTPS --------------------------------------------------------
azul "10. Certificado HTTPS"
if ! getent hosts "$DOMINIO_API" >/dev/null; then
  aviso "$DOMINIO_API ainda não resolve — pulando o certificado."
  aviso "Crie o registro A no Registro.br apontando para o IP deste servidor"
  aviso "e rode:  certbot --nginx -d $DOMINIO_API"
else
  # O certbot roda SEMPRE, mesmo com o certificado já emitido.
  #
  # Motivo, aprendido do jeito difícil: a etapa 8 reescreve a configuração
  # do Nginx do zero a cada execução. Quem coloca o bloco de HTTPS lá
  # dentro é o certbot. Pular esta etapa porque "o certificado já existe"
  # deixava a configuração recém-escrita SEM HTTPS nenhum — e o site saía
  # do ar a cada atualização, silenciosamente.
  #
  # Pior: a verificação final testa /health direto no Node, sem passar pelo
  # Nginx, então ela passava e o script anunciava sucesso com o painel
  # inacessível.
  #
  # --reinstall reaplica o certificado existente na configuração nova sem
  # pedir emissão nova à Let's Encrypt, então não consome cota nem depende
  # de a validação passar de novo.
  ARGS_CERTBOT=(--nginx -d "$DOMINIO_API" --non-interactive --agree-tos
                --register-unsafely-without-email --redirect)
  if [[ -d "/etc/letsencrypt/live/$DOMINIO_API" ]]; then
    ARGS_CERTBOT+=(--reinstall)
  fi
  if certbot "${ARGS_CERTBOT[@]}" >/dev/null 2>&1; then
    ok "HTTPS ativo, com redirecionamento de http para https"
  else
    aviso "certbot falhou. Rode manualmente: certbot --nginx -d $DOMINIO_API"
  fi

  # Confere que o bloco de HTTPS ficou mesmo na configuração. Sem isto o
  # script pode anunciar sucesso com o site fora do ar, que foi exatamente
  # o que aconteceu.
  if ! grep -q "listen 443" /etc/nginx/sites-available/embarque-suinco; then
    erro "o Nginx ficou sem o bloco de HTTPS. Rode: certbot --nginx -d $DOMINIO_API --reinstall"
  fi
fi
systemctl enable certbot.timer >/dev/null 2>&1 || true

# --- 11. Backup diário ------------------------------------------------
azul "11. Backup"
mkdir -p /var/backups/embarque-suinco
cat > /etc/cron.daily/backup-embarque-suinco <<'EOF'
#!/bin/sh
# Backup diário do banco. 14 dias de retenção.
# Backup que nunca foi restaurado não é backup — teste com:
#   gunzip -c ARQUIVO.sql.gz | sudo -u postgres psql banco_de_teste
DESTINO=/var/backups/embarque-suinco
ARQ="$DESTINO/embarque_suinco_$(date +%Y%m%d).sql.gz"
su - postgres -c "pg_dump embarque_suinco" | gzip > "$ARQ"
chmod 600 "$ARQ"
find "$DESTINO" -name '*.sql.gz' -mtime +14 -delete
EOF
chmod +x /etc/cron.daily/backup-embarque-suinco
/etc/cron.daily/backup-embarque-suinco && ok "backup diário ativo (primeiro já rodou)"

# --- 12. Verificação final -------------------------------------------
azul "12. Verificação"
# 12a. O Node responde? (direto, sem Nginx)
SAUDE="$(curl -s --max-time 10 "http://127.0.0.1:$PORTA_APP/health" || true)"
echo "$SAUDE" | grep -q '"ok":true' || { journalctl -u embarque-suinco -n 20 --no-pager; erro "/health não respondeu ok"; }
ok "/health respondeu: $SAUDE"

# 12b. E pelo caminho que o NAVEGADOR usa?
#
# Esta parte existe porque a verificação anterior sozinha dava falsa
# confiança: ela fala direto com o Node, então passa mesmo com o Nginx
# quebrado e o painel inacessível. Foi assim que uma atualização derrubou
# o HTTPS e o script ainda anunciou "instalação concluída".
#
# Aqui vai pelo endereço público, com HTTPS de verdade. Se o certificado,
# o Nginx ou o DNS estiverem errados, falha aqui — que é onde deve falhar.
if getent hosts "$DOMINIO_API" >/dev/null; then
  CODIGO="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$DOMINIO_API/health" || echo 000)"
  if [[ "$CODIGO" == "200" ]]; then
    ok "https://$DOMINIO_API/health respondeu 200 (o caminho do navegador)"
  else
    erro "https://$DOMINIO_API/health devolveu '$CODIGO'. O Node está de pé, mas o Nginx ou o certificado não. Rode: certbot --nginx -d $DOMINIO_API --reinstall"
  fi

  # O preflight é o que o navegador faz ANTES de qualquer login. Se ele
  # falhar, a tela mostra "servidor não respondeu" com o servidor no ar —
  # o erro mais difícil de diagnosticar que apareceu nesta implantação.
  PREFLIGHT="$(curl -s -D- -o /dev/null --max-time 15 -X OPTIONS \
    -H "Origin: $DOMINIO_PAINEL" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: content-type" \
    "https://$DOMINIO_API/auth/login" 2>/dev/null || true)"
  if grep -qi 'access-control-allow-origin' <<<"$PREFLIGHT"; then
    ok "preflight do login liberado para $DOMINIO_PAINEL"
  else
    erro "o preflight do login não devolveu CORS. O painel não vai conseguir entrar."
  fi
else
  aviso "$DOMINIO_API não resolve — não deu para testar o caminho do navegador"
fi

PLACAS="$(su - postgres -c "psql -tAd $DB_NAME -c 'SELECT count(*) FROM dim_veiculos'")"
ROTAS="$(su - postgres -c "psql -tAd $DB_NAME -c 'SELECT count(*) FROM dim_rotas'")"
ok "base carregada: $PLACAS placas, $ROTAS rotas"


# Quantos operadores já existem. O bloco "crie o primeiro operador" só faz
# sentido quando NÃO existe nenhum — e este script roda a cada atualização.
# Repetir a instrução com o pátio inteiro já cadastrado fez o gestor achar
# que precisava recriar todo mundo pelo terminal. Instrução que não se
# aplica é instrução que atrapalha.
OPERADORES="$(su - postgres -c "psql -tAd $DB_NAME -c 'SELECT count(*) FROM operadores'" 2>/dev/null | tr -d ' ')"

cat <<FIM

=====================================================================
 INSTALAÇÃO CONCLUÍDA
=====================================================================

 API           https://$DOMINIO_API
 Painel        $DOMINIO_PAINEL
 Serviço       systemctl status embarque-suinco
 Logs          journalctl -u embarque-suinco -f
 Diagnóstico   sudo bash $FONTE/diagnostico.sh
 Backup        /var/backups/embarque-suinco (diário, 14 dias)

 Endereços autorizados a abrir o painel:
   $(grep -E '^ORIGENS_PERMITIDAS=' "$ENV_FILE" | cut -d= -f2-)
FIM

if [[ "${OPERADORES:-0}" -eq 0 ]]; then
  cat <<FIM

 FALTA UM PASSO: criar o primeiro operador.

 Só o primeiro é por aqui. A tela de usuários fica DENTRO do painel, então
 alguém precisa existir antes de conseguir entrar. Depois deste, todos os
 outros saem pela tela — Administração → Usuários.

   cd $APP_DIR
   sudo -u $APP_USER node scripts/operador.js criar seu@email.com "Seu Nome" Administração
FIM
else
  cat <<FIM

 Operadores cadastrados: $OPERADORES

 Para criar, desativar ou trocar o setor de alguém, use a tela do painel:
 entre como Administração e abra a aba Usuários. Mesma tabela, mesma
 criptografia de senha — o terminal não faz nada que a tela não faça.
FIM
fi

cat <<FIM

 As senhas do banco, o segredo do JWT e o token do Power BI ficam em
 $ENV_FILE, legível só pelo usuário $APP_USER.
 Não precisa anotar nem enviar para ninguém.

 Para ler o token do Power BI quando for configurá-lo:
   grep BI_TOKEN $ENV_FILE

=====================================================================
FIM

# Impressão do token só na PRIMEIRA instalação.
#
# Antes ele era impresso a cada execução — e o script é feito para rodar de
# novo a cada atualização. Resultado: um segredo aparecendo na tela toda
# vez, indo parar em print, em rolagem de terminal e em conversa. Segredo
# que se repete é segredo que vaza.
#
# Numa instalação nova faz sentido mostrar uma vez, porque ninguém sabe que
# ele existe ainda. Depois disso, quem precisar lê do .env.
if [[ "$ENV_JA_EXISTIA" -eq 0 ]]; then
  printf '\n TOKEN DO POWER BI (aparece só nesta primeira instalação):\n\n   %s\n\n' \
    "$(grep -E '^BI_TOKEN=' "$ENV_FILE" | cut -d= -f2-)"
fi
