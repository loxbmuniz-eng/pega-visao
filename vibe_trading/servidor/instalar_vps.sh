#!/usr/bin/env bash
# =====================================================================
# VIBE TRADING — o vigia no VPS, ao lado do Embarque Suinco
# ---------------------------------------------------------------------
# Põe o vigia (PAPEL, nenhuma ordem real) rodando 24 horas neste servidor,
# num canto separado do painel da Suinco:
#   - usuário próprio (vibe), pasta própria (/opt/vibe), sem senha de login;
#   - teto de processador (30%) e de memória (400 MB), prioridade baixa;
#   - nenhuma porta aberta: ele só busca candle público e fala com o Telegram.
#
# NÃO MEXE em: Nginx, PostgreSQL, firewall, certificados, nem no serviço
# embarque-suinco. Tira um retrato dessas coisas antes e confere no fim.
# Se alguma tiver mudado, avisa em vermelho.
#
# Modos:
#   sudo bash instalar_vps.sh                instala (ou refaz; é seguro rodar de novo)
#   sudo vibe-instalar --status              mostra se está tudo de pé
#   sudo vibe-instalar --atualizar           busca versão nova; só aplica com a bateria verde
#   sudo vibe-instalar --desinstalar         remove os serviços (pergunta antes de apagar dados)
#
# A atualização roda sozinha todo dia de madrugada, COMO O USUÁRIO vibe (nunca
# como administrador): testa a versão nova numa pasta à parte e só troca se a
# bateria inteira passar. Se reprovar, o vigia continua na versão de antes e o
# Telegram avisa. Nada que vem do repositório roda como administrador; esta
# cópia do instalador só muda quando você mesmo roda o instalador de novo.
# =====================================================================

set -Eeuo pipefail

VIBE_USER="${VIBE_USER:-vibe}"
VIBE_DIR="${VIBE_DIR:-/opt/vibe}"
REPO="${REPO:-git@github.com:loxbmuniz-eng/vibe-trading.git}"
RAMO="${RAMO:-main}"
UNIDADES="${UNIDADES:-/etc/systemd/system}"
BIN="${BIN:-/usr/local/sbin}"
APP="$VIBE_DIR/app"
VENV="$VIBE_DIR/venv"
TRAVA="${TRAVA:-/run/vibe-instalar.lock}"
# 0 pula a primeira carga de candles no passo 9 (o servico faz ao ligar).
PRIMEIRA_CARGA="${PRIMEIRA_CARGA:-1}"
VIGIA_ANTES=""
PAGINA_CHAVES="https://github.com/loxbmuniz-eng/vibe-trading/settings/keys/new"
# Impressão digital da chave ed25519 do github.com, publicada pelo GitHub em
# docs.github.com ("GitHub's SSH key fingerprints"). Conferida antes de confiar.
GITHUB_ED25519="SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU"

azul()  { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
ok()    { printf '   \033[0;32mok\033[0m   %s\n' "$*"; }
aviso() { printf '   \033[0;33m!\033[0m    %s\n' "$*"; }
erro()  { printf '\n\033[0;31mERRO:\033[0m %s\n\n' "$*" >&2; exit 1; }
# Se a instalacao parar no meio, o vigia que ja rodava volta a rodar.
religar_se_estava() {
  [[ "$VIGIA_ANTES" == "active" ]] && systemctl start vibe-vigia >/dev/null 2>&1 || true
}
# Erro dentro de um calculo intermediario $(...) so encerra aquele calculo; quem
# decide parar (e religar o vigia) e o script principal.
trap 'if [[ $BASHPID -eq $$ ]]; then religar_se_estava; erro "falhou na linha $LINENO. Nada do Embarque Suinco foi tocado. Copie a mensagem acima e me mande."; else exit 1; fi' ERR

# Comando como o usuário vibe, com a casa dele (git e ssh leem a configuração de lá).
como_vibe() { runuser -u "$VIBE_USER" -- env HOME="$VIBE_DIR" "$@"; }
pergunta() { local r=""; printf '%s ' "$1" >&2; IFS= read -r r || true; printf '%s' "$r"; }
pergunta_secreta() { local r=""; printf '%s ' "$1" >&2; IFS= read -rs r || true; printf '\n' >&2; printf '%s' "$r"; }
repo_local() { [[ "$REPO" == /* ]]; }

# O que do servidor da Suinco tem de continuar igual. Só lê, não muda nada.
retrato() {
  local s
  for s in embarque-suinco nginx postgresql; do
    printf '%-16s %s\n' "$s" "$(systemctl is-active "$s" 2>/dev/null || true)"
  done
  printf '%-16s %s\n' "portas" "$( (ss -ltnH 2>/dev/null || true) | awk '{print $4}' | sort -u | tr '\n' ' ')"
  printf '%-16s %s\n' "firewall" "$( (ufw status 2>/dev/null || true) | sha256sum | cut -c1-16)"
  printf '%-16s %s\n' "nginx (config)" "$( (cat /etc/nginx/sites-enabled/* 2>/dev/null || true) | sha256sum | cut -c1-16)"
}

# Telegram pelo próprio vigia (o token fica no segredos.json, nunca na linha de comando).
avisar() {
  [[ -x "$VENV/bin/python" && -f "$APP/vigia.py" ]] || return 0
  como_vibe "$VENV/bin/python" -c 'import sys; sys.path.insert(0, sys.argv[1]); import vigia; vigia.telegram(vigia.carregar_segredos(), sys.argv[2])' \
    "$APP" "$1" >/dev/null 2>&1 || true
}

# A bateria inteira, numa pasta, com prioridade baixa. Saída em ultima_bateria.log.
bateria() {
  como_vibe sh -c 'VIBE_SERVIDOR=1 nice -n 15 "$1/bin/python" "$2/testes/test_motor.py" > "$3" 2>&1' \
    _ "$VENV" "$1" "$VIBE_DIR/ultima_bateria.log"
}

# --------------------------------------------------------------------- #
# --status
# --------------------------------------------------------------------- #
status() {
  azul "Vigia"
  printf '   serviço: %s\n' "$(systemctl is-active vibe-vigia 2>/dev/null || true)"
  printf '   atualização diária: %s\n' "$(systemctl is-active vibe-atualizar.timer 2>/dev/null || true)"
  [[ -d "$APP/.git" ]] && printf '   versão: %s\n' "$(como_vibe git -C "$APP" log -1 --format='%h %s' 2>/dev/null || true)"
  printf '   última bateria: %s\n' "$(como_vibe tail -1 "$VIBE_DIR/ultima_bateria.log" 2>/dev/null || echo '-')"
  azul "Últimas linhas do log"
  como_vibe tail -n 12 "$APP/dados_vigia/vigia.log" 2>/dev/null | sed 's/^/   /' || true
  azul "Placar"
  como_vibe "$VENV/bin/python" "$APP/vigia.py" --placar 2>/dev/null | sed 's/^/ /' || true
  azul "Embarque Suinco (só leitura)"
  retrato | sed 's/^/   /'
  exit 0
}

# --------------------------------------------------------------------- #
# --atualizar  (o temporizador chama todo dia)
# --------------------------------------------------------------------- #
atualizar() {
  [[ -d "$APP/.git" ]] || erro "o vigia não está instalado em $APP"
  # mesmo chamado pelo administrador, a atualização roda como vibe
  como_vibe env VIBE_DIR="$VIBE_DIR" RAMO="$RAMO" bash "$APP/servidor/atualizar_vibe.sh"
  exit 0
}

# --------------------------------------------------------------------- #
# --desinstalar
# --------------------------------------------------------------------- #
desinstalar() {
  azul "Removendo o vigia (o Embarque Suinco não é tocado)"
  local ANTES r
  ANTES="$(retrato)"
  systemctl disable --now vibe-vigia.service vibe-atualizar.timer >/dev/null 2>&1 || true
  rm -f "$UNIDADES/vibe-vigia.service" "$UNIDADES/vibe-atualizar.service" "$UNIDADES/vibe-atualizar.timer"
  systemctl daemon-reload
  rm -f "$BIN/vibe-instalar"
  ok "serviços removidos"
  r="$(pergunta "Apagar também o diário, o placar e as chaves ($VIBE_DIR)? Digite APAGAR para apagar, ou só ENTER para guardar:")"
  if [[ "$r" == "APAGAR" ]]; then
    userdel -r "$VIBE_USER" >/dev/null 2>&1 || true
    rm -rf "$VIBE_DIR"
    ok "pasta $VIBE_DIR e usuário $VIBE_USER apagados"
    aviso "no GitHub, apague também a chave 'vps-vibe-somente-leitura' em Settings > Deploy keys do vibe-trading"
  else
    ok "dados guardados em $VIBE_DIR (o diário e o placar continuam lá)"
  fi
  [[ "$(retrato)" == "$ANTES" ]] && ok "Embarque Suinco igual a antes" || aviso "algo da Suinco mudou durante a remoção; confira: $(retrato)"
  exit 0
}

# Uma instalacao ou atualizacao por vez.
exec 9>"$TRAVA"
flock -w 900 9 || erro "outra instalacao ou atualizacao do vigia esta rodando ha mais de 15 minutos"

case "${1:-}" in
  --status)      [[ $EUID -eq 0 ]] || erro "rode com sudo"; status ;;
  --atualizar)   [[ $EUID -eq 0 ]] || erro "rode com sudo"; atualizar ;;
  --desinstalar) [[ $EUID -eq 0 ]] || erro "rode com sudo"; desinstalar ;;
  "")            ;;
  *)             erro "opção desconhecida: $1 (use --status, --atualizar ou --desinstalar)" ;;
esac

# ===================================================================== #
# instalação
# ===================================================================== #

azul "0. Conferindo o servidor antes de mexer em qualquer coisa"
[[ $EUID -eq 0 ]] || erro "rode com sudo: sudo bash $0"
command -v apt-get >/dev/null || erro "este script é para Ubuntu/Debian. Me diga qual sistema o VPS usa que eu adapto."
command -v systemctl >/dev/null || erro "este servidor não tem systemd"
command -v python3 >/dev/null || erro "python3 não encontrado"
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' \
  || erro "python3 muito antigo ($(python3 -V 2>&1)); o vigia precisa do 3.10 ou mais novo"
ok "sistema: $(. /etc/os-release 2>/dev/null && echo "${PRETTY_NAME:-?}"), $(python3 -V 2>&1)"
LIVRE_MB="$(df -Pm "$(dirname "$VIBE_DIR")" | awk 'NR==2 {print $4}')"
[[ "${LIVRE_MB:-0}" -ge 1024 ]] || erro "pouco disco livre (${LIVRE_MB} MB). O vigia precisa de 1 GB."
ok "disco livre: ${LIVRE_MB} MB"

ANTES="$(retrato)"
printf '\n   Retrato do Embarque Suinco agora (vou conferir de novo no fim):\n'
printf '%s\n' "$ANTES" | sed 's/^/      /'

cat <<EOF

   O que este script VAI fazer:
     - criar o usuário '$VIBE_USER' e a pasta $VIBE_DIR (só dele);
     - baixar o vigia do repositório privado vibe-trading (chave só de leitura);
     - instalar o Python do vigia dentro de $VIBE_DIR (não mexe no Python do sistema);
     - rodar a bateria inteira de testes (uns 3 a 5 minutos) antes de ligar;
     - criar os serviços vibe-vigia e vibe-atualizar, com teto de CPU e memória.

   O que ele NÃO VAI fazer:
     - mexer em Nginx, PostgreSQL, firewall, certificados ou no embarque-suinco;
     - abrir porta, pedir chave de corretora ou enviar ordem.

EOF
[[ "$(pergunta "Digite SIM para continuar:")" == "SIM" ]] || erro "cancelado. Nada foi feito."

azul "1. Pacotes do sistema (só o que faltar)"
FALTA=()
python3 -c 'import ensurepip, venv' 2>/dev/null || FALTA+=(python3-venv)
command -v git >/dev/null || FALTA+=(git)
repo_local || command -v ssh-keygen >/dev/null || FALTA+=(openssh-client)
if ((${#FALTA[@]})); then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "${FALTA[@]}" >/dev/null
  ok "instalado: ${FALTA[*]}"
else
  ok "nada a instalar"
fi

azul "2. Usuário e pasta"
if id -u "$VIBE_USER" >/dev/null 2>&1; then
  ok "usuário $VIBE_USER já existe"
else
  useradd --system --create-home --home-dir "$VIBE_DIR" --shell /usr/sbin/nologin "$VIBE_USER"
  ok "usuário $VIBE_USER criado (sem senha, sem login)"
fi
install -d -o "$VIBE_USER" -g "$VIBE_USER" -m 750 "$VIBE_DIR"
ok "pasta $VIBE_DIR"

azul "3. Acesso de leitura ao repositório"
if repo_local; then
  ok "repositório local: $REPO"
else
  como_vibe mkdir -p -m 700 "$VIBE_DIR/.ssh"
  if [[ ! -f "$VIBE_DIR/.ssh/id_ed25519" ]]; then
    como_vibe ssh-keygen -q -t ed25519 -N "" -C "vps-vibe-somente-leitura" -f "$VIBE_DIR/.ssh/id_ed25519"
    ok "chave de leitura criada"
  fi
  TMP_KH="$(mktemp)"
  ssh-keyscan -t ed25519 github.com > "$TMP_KH" 2>/dev/null || true
  DIGITAL="$(ssh-keygen -lf "$TMP_KH" 2>/dev/null | awk '{print $2}' | head -1)"
  [[ "$DIGITAL" == "$GITHUB_ED25519" ]] \
    || { rm -f "$TMP_KH"; erro "a chave do github.com não confere com a publicada pelo GitHub ($DIGITAL). Não continuo."; }
  # quem escreve na pasta do vibe e o proprio vibe (o administrador nunca segue atalho la dentro)
  como_vibe sh -c 'cat > "$1"' _ "$VIBE_DIR/.ssh/known_hosts" < "$TMP_KH"
  rm -f "$TMP_KH"
  ok "github.com conferido pela impressão digital publicada"
  while ! como_vibe git ls-remote "$REPO" >/dev/null 2>&1; do
    cat <<EOF

   Falta um passo seu no GitHub (1 minuto, só na primeira vez):
     1. Abra: $PAGINA_CHAVES
     2. Title:  VPS
     3. Key:    cole a linha abaixo, inteira
     4. NÃO marque "Allow write access" (o servidor só lê)
     5. Clique em "Add key"

$(cat "$VIBE_DIR/.ssh/id_ed25519.pub")

EOF
    r="$(pergunta "Depois de salvar no GitHub, aperte ENTER (ou digite sair):")"
    [[ "$r" == "sair" ]] && erro "parado antes de baixar o código. Rode de novo quando quiser; a chave fica guardada."
  done
  ok "o servidor lê o repositório"
fi

azul "4. Código"
VIGIA_ANTES="$(systemctl is-active vibe-vigia 2>/dev/null || true)"
if [[ "$VIGIA_ANTES" == "active" ]]; then
  systemctl stop vibe-vigia
  ok "vigia parado durante a instalação (volta no passo 10; dois vigias juntos estragariam o placar)"
fi
if [[ -d "$APP/.git" ]]; then
  como_vibe git -C "$APP" fetch -q origin "$RAMO"
  ANTERIOR="$(como_vibe git -C "$APP" rev-parse HEAD)"
  como_vibe git -C "$APP" merge -q --ff-only "origin/$RAMO"
  ok "atualizado: $(como_vibe git -C "$APP" log -1 --format='%h %s')"
else
  ANTERIOR=""
  como_vibe git clone -q -b "$RAMO" "$REPO" "$APP"
  ok "baixado: $(como_vibe git -C "$APP" log -1 --format='%h %s')"
fi

azul "5. Python do vigia (dentro de $VIBE_DIR)"
[[ -x "$VENV/bin/python" ]] || como_vibe python3 -m venv "$VENV"
como_vibe "$VENV/bin/pip" install -q --disable-pip-version-check -r "$APP/servidor/requisitos.txt"
ok "$(como_vibe "$VENV/bin/python" -V 2>&1), pacotes de servidor/requisitos.txt"

azul "6. Bateria de testes (uns 3 a 5 minutos, prioridade baixa)"
if bateria "$APP"; then
  ok "$(como_vibe tail -1 "$VIBE_DIR/ultima_bateria.log")"
else
  if [[ -n "$ANTERIOR" ]]; then
    como_vibe git -C "$APP" reset -q --hard "$ANTERIOR"
    aviso "voltei o código para ${ANTERIOR:0:7}"
  fi
  como_vibe tail -n 25 "$VIBE_DIR/ultima_bateria.log" | sed 's/^/   /'
  religar_se_estava
  erro "a bateria reprovou: não liguei o vigia com esta versão. Me mande as linhas acima."
fi

azul "7. Telegram"
JA_TEM="$(como_vibe "$VENV/bin/python" -c 'import sys; sys.path.insert(0, sys.argv[1]); import vigia; s = vigia.carregar_segredos(); print("sim" if s.get("telegram_token") and s.get("telegram_chat_id") else "nao")' "$APP" 2>/dev/null | tail -1)"
if [[ "$JA_TEM" == "sim" ]]; then
  ok "já configurado"
else
  printf '\n   No Telegram, o @BotFather te deu um token quando você criou o robô (/newbot).\n'
  TOKEN="$(pergunta_secreta "   Cole o token aqui (não aparece na tela; ENTER vazio pula o Telegram):")"
  if [[ -z "$TOKEN" ]]; then
    aviso "sem Telegram: você não recebe alertas. Rode este script de novo para configurar."
  else
    printf '%s' "$TOKEN" | como_vibe "$VENV/bin/python" "$APP/vigia.py" --guardar-segredo telegram_token >/dev/null
    unset TOKEN
    ok "token guardado (segredos.json, só o usuário vibe lê)"
    for tentativa in 1 2 3; do
      pergunta "   Agora mande qualquer mensagem (um 'oi') para o seu robô no Telegram e aperte ENTER:" >/dev/null
      if como_vibe "$VENV/bin/python" "$APP/vigia.py" --telegram-descobrir --gravar; then
        como_vibe "$VENV/bin/python" "$APP/vigia.py" --telegram-teste || true
        break
      fi
      [[ $tentativa -eq 3 ]] && aviso "não achei a sua conversa. Rode este script de novo depois."
    done
  fi
fi

azul "8. Arena das IAs (opcional)"
r="$(pergunta "   Quer guardar as chaves de IA e ligar a arena agora? (s/N)")"
if [[ "$r" =~ ^[sS] ]]; then
  CHAVE="$(pergunta_secreta "   Chave da Anthropic (Claude), ENTER vazio pula:")"
  [[ -n "$CHAVE" ]] && printf '%s' "$CHAVE" | como_vibe "$VENV/bin/python" "$APP/vigia.py" --guardar-segredo anthropic_api_key
  CHAVE="$(pergunta_secreta "   Chave da OpenRouter (Qwen), ENTER vazio pula:")"
  [[ -n "$CHAVE" ]] && printf '%s' "$CHAVE" | como_vibe "$VENV/bin/python" "$APP/vigia.py" --guardar-segredo openrouter_key
  unset CHAVE
  como_vibe "$VENV/bin/python" "$APP/vigia.py" --arena ligar
else
  ok "arena fica como está (desligada, se nunca foi ligada)"
fi

azul "9. Primeira carga de candles (aquece os indicadores, sem operar)"
if [[ "$PRIMEIRA_CARGA" == "1" ]]; then
  SAIDA="$(como_vibe "$VENV/bin/python" "$APP/vigia.py" --uma-vez 2>&1 || true)"
  printf '%s\n' "$SAIDA" | tail -n 4 | sed 's/^/   /'
  if grep -q "sem dados" <<<"$SAIDA"; then
    aviso "a fonte de candles não respondeu agora. O serviço tenta de novo a cada minuto;"
    aviso "se continuar, troque \"fonte\" para \"binance\" em $APP/vigia.json"
  else
    ok "candles carregados"
  fi
else
  ok "pulada (o serviço carrega ao ligar)"
fi

azul "10. Serviços"
cat > "$UNIDADES/vibe-vigia.service" <<EOF
[Unit]
Description=Vibe trading - vigia de papel (nenhuma ordem real)
After=network-online.target
Wants=network-online.target

[Service]
User=$VIBE_USER
Group=$VIBE_USER
WorkingDirectory=$APP
ExecStart=$VENV/bin/python -u $APP/vigia.py
Environment=PYTHONUNBUFFERED=1
Restart=always
RestartSec=30
# nunca disputa fôlego com o Embarque Suinco
Nice=10
CPUQuota=30%
MemoryMax=400M
IOSchedulingClass=idle
# só escreve na própria pasta
NoNewPrivileges=yes
ProtectSystem=strict
ReadWritePaths=$VIBE_DIR
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes

[Install]
WantedBy=multi-user.target
EOF
cat > "$UNIDADES/vibe-atualizar.service" <<EOF
[Unit]
Description=Vibe trading - atualizacao diaria (so aplica com a bateria verde)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
# roda como vibe: o codigo do repositorio nunca ganha poder de administrador
User=$VIBE_USER
Group=$VIBE_USER
Environment=VIBE_DIR=$VIBE_DIR
Environment=RAMO=$RAMO
ExecStart=/bin/bash $APP/servidor/atualizar_vibe.sh
Nice=15
CPUQuota=50%
IOSchedulingClass=idle
NoNewPrivileges=yes
ProtectSystem=strict
ReadWritePaths=$VIBE_DIR
ProtectHome=yes
PrivateTmp=yes
EOF
cat > "$UNIDADES/vibe-atualizar.timer" <<EOF
[Unit]
Description=Vibe trading - atualizacao diaria

[Timer]
OnCalendar=*-*-* 04:10:00
RandomizedDelaySec=20m
Persistent=true

[Install]
WantedBy=timers.target
EOF
# a copia de administrador e o arquivo que VOCE rodou agora, nunca o que veio do repositorio
ESTE="$(readlink -f "${BASH_SOURCE[0]}")"
[[ "$ESTE" == "$(readlink -f "$BIN/vibe-instalar" 2>/dev/null || true)" ]] || install -m 755 "$ESTE" "$BIN/vibe-instalar"
systemctl daemon-reload
systemctl enable vibe-vigia.service vibe-atualizar.timer >/dev/null 2>&1
systemctl restart vibe-vigia.service
systemctl start vibe-atualizar.timer
sleep 5
ESTADO="$(systemctl is-active vibe-vigia 2>/dev/null || true)"
[[ "$ESTADO" == "active" ]] && ok "vibe-vigia rodando" || aviso "vibe-vigia: $ESTADO (veja: journalctl -u vibe-vigia -n 30)"
ok "atualização diária às 04:10, só com a bateria verde"

azul "11. Conferindo o Embarque Suinco de novo"
DEPOIS="$(retrato)"
if [[ "$DEPOIS" == "$ANTES" ]]; then
  ok "igual a antes: serviço, Nginx, PostgreSQL, portas e firewall não mudaram"
else
  printf '\n\033[0;31m   ATENÇÃO: algo do servidor mudou durante a instalação:\033[0m\n'
  diff <(printf '%s\n' "$ANTES") <(printf '%s\n' "$DEPOIS") | sed 's/^/      /' || true
  printf '   Me mande estas linhas.\n'
fi

cat <<EOF

   Pronto. O vigia opera no PAPEL, 24 horas, e manda o resumo às 21 h.
   No Telegram:  /placar   /status   /ajuda
   Neste servidor:
     sudo vibe-instalar --status        se está tudo de pé
     sudo vibe-instalar --desinstalar   tira tudo (pergunta antes de apagar dados)

EOF
avisar "Vigia instalado no VPS (papel, nenhuma ordem real). Responde /placar, /status e /ajuda."
