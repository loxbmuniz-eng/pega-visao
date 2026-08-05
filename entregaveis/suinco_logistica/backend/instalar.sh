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

# --- 1. Pacotes do sistema -------------------------------------------
azul "1. Pacotes do sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg git ufw nginx postgresql \
                       postgresql-contrib certbot python3-certbot-nginx >/dev/null
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

if [[ -f "$ENV_FILE" ]]; then
  # Reinstalação: reaproveita a senha que já está em uso. Gerar outra aqui
  # deixaria o serviço sem conseguir conectar no próprio banco.
  DB_PASS="$(grep -E '^PGPASSWORD=' "$ENV_FILE" | cut -d= -f2-)"
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
RATE_LIMIT_LOGIN=10
EOF
  ok ".env gerado com segredos aleatórios"
else
  ok ".env já existia — preservado"
fi
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
MemoryDenyWriteExecute=true

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
        proxy_set_header Connection "upgrade";
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
  if [[ -d "/etc/letsencrypt/live/$DOMINIO_API" ]]; then
    ok "certificado já existe (renovação é automática)"
  else
    certbot --nginx -d "$DOMINIO_API" --non-interactive --agree-tos \
            --register-unsafely-without-email --redirect >/dev/null 2>&1 \
      && ok "HTTPS ativo, com redirecionamento de http para https" \
      || aviso "certbot falhou. Rode manualmente: certbot --nginx -d $DOMINIO_API"
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
SAUDE="$(curl -s --max-time 10 "http://127.0.0.1:$PORTA_APP/health" || true)"
echo "$SAUDE" | grep -q '"ok":true' || { journalctl -u embarque-suinco -n 20 --no-pager; erro "/health não respondeu ok"; }
ok "/health respondeu: $SAUDE"

PLACAS="$(su - postgres -c "psql -tAd $DB_NAME -c 'SELECT count(*) FROM dim_veiculos'")"
ROTAS="$(su - postgres -c "psql -tAd $DB_NAME -c 'SELECT count(*) FROM dim_rotas'")"
ok "base carregada: $PLACAS placas, $ROTAS rotas"

BI_TOKEN_ATUAL="$(grep -E '^BI_TOKEN=' "$ENV_FILE" | cut -d= -f2-)"

cat <<FIM

=====================================================================
 INSTALAÇÃO CONCLUÍDA
=====================================================================

 API           https://$DOMINIO_API
 Serviço       systemctl status embarque-suinco
 Logs          journalctl -u embarque-suinco -f
 Backup        /var/backups/embarque-suinco (diário, 14 dias)

 FALTA UM PASSO: criar o primeiro operador.

   cd $APP_DIR
   sudo -u $APP_USER node scripts/operador.js criar seu@email.com "Seu Nome" Administração

 Depois, um por setor:
   ... criar portaria@suinco.com.br    "Portaria"    Portaria
   ... criar expedicao@suinco.com.br   "Expedição"   Expedição
   ... criar faturamento@suinco.com.br "Faturamento" Faturamento
   ... criar logistica@suinco.com.br   "Logística"   Logística

 TOKEN DO POWER BI (anote — é o que o BI usa para ler as views):

   $BI_TOKEN_ATUAL

 As senhas do banco e o segredo do JWT ficam em $ENV_FILE,
 legível só pelo usuário $APP_USER. Não precisa anotar nem enviar
 para ninguém.

=====================================================================
FIM
