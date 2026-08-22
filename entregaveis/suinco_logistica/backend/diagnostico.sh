#!/usr/bin/env bash
# =====================================================================
# EMBARQUE SUINCO — diagnóstico do servidor
# ---------------------------------------------------------------------
# Responde a pergunta que sempre chega do pátio: "fulano não consegue
# entrar". Roda tudo de uma vez e imprime um relatório curto que pode ser
# fotografado e mandado no grupo.
#
#     sudo bash entregaveis/suinco_logistica/backend/diagnostico.sh
#
# NÃO altera nada. Só lê. Pode rodar com o pátio operando.
# NÃO imprime senha, token nem hash — foi escrito para ser fotografado.
# =====================================================================

set -uo pipefail   # sem -e: um teste que falha é resultado, não motivo para parar

APP_USER="suinco"
APP_DIR="/opt/embarque-suinco"
DB_NAME="embarque_suinco"
DOMINIO_API="${DOMINIO_API:-api.embarquesuinco.com.br}"
DOMINIO_PAINEL="${DOMINIO_PAINEL:-https://embarquesuinco.com.br}"
PORTA_APP=3000

azul()  { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
ok()    { printf '   \033[0;32mok\033[0m   %s\n' "$*"; }
mal()   { printf '   \033[0;31mFALHA\033[0m %s\n' "$*"; PROBLEMAS+=("$*"); }
aviso() { printf '   \033[0;33m!\033[0m    %s\n' "$*"; }
info()  { printf '        %s\n' "$*"; }

PROBLEMAS=()

[[ $EUID -eq 0 ]] || { echo "rode com sudo: sudo bash $0"; exit 1; }

# --- 1. O serviço está de pé? ----------------------------------------
azul "1. Serviço"
if systemctl is-active --quiet embarque-suinco; then
  DESDE="$(systemctl show embarque-suinco -p ActiveEnterTimestamp --value)"
  ok "embarque-suinco ativo desde $DESDE"
  # Reinício recente é pista forte: se o serviço subiu há poucos minutos,
  # quem tentou entrar antes disso pegou o servidor no chão.
  REINICIOS="$(systemctl show embarque-suinco -p NRestarts --value)"
  [[ "${REINICIOS:-0}" -gt 0 ]] && aviso "já reiniciou $REINICIOS vez(es) desde o boot"
else
  mal "o serviço embarque-suinco NÃO está ativo — ninguém consegue entrar"
  systemctl status embarque-suinco --no-pager -n 15 2>&1 | sed 's/^/        /'
fi

# --- 2. Banco --------------------------------------------------------
azul "2. Banco de dados"
if sudo -u postgres psql -d "$DB_NAME" -tAc 'select 1' >/dev/null 2>&1; then
  ok "PostgreSQL responde em $DB_NAME"
else
  mal "PostgreSQL não respondeu — o login falha com erro 500"
fi

# --- 2b. O banco está na mesma versão do código? ----------------------
# Falha silenciosa e cara: o código novo consulta colunas que só existem
# depois da migração. Se o serviço subiu sem migrar, TODA operação com
# carga passa a devolver erro 500 — inclusive mudar status — enquanto o
# login e a tela continuam funcionando normalmente. O sintoma parece "o
# painel parou", e a causa está aqui.
azul "2b. Migrações do banco"
if [[ -d "$APP_DIR/migrations" ]]; then
  APLICADAS="$(sudo -u postgres psql -d "$DB_NAME" -tAc \
    'SELECT arquivo FROM _migrations' 2>/dev/null | sort)"
  PENDENTES=()
  for arq in "$APP_DIR"/migrations/*.sql; do
    [[ -e "$arq" ]] || continue
    nome="$(basename "$arq")"
    grep -qx "$nome" <<<"$APLICADAS" || PENDENTES+=("$nome")
  done
  if [[ ${#PENDENTES[@]} -eq 0 ]]; then
    ok "banco atualizado ($(wc -l <<<"$APLICADAS") migração(ões) aplicada(s))"
  else
    mal "${#PENDENTES[@]} migração(ões) PENDENTE(S): ${PENDENTES[*]}"
    info "isso quebra toda operação com carga. Corrija com:"
    info "  cd $APP_DIR && sudo -u $APP_USER node scripts/migrar.js"
    info "  sudo systemctl restart embarque-suinco"
  fi
else
  aviso "não achei $APP_DIR/migrations"
fi

# --- 3. A API responde localmente? -----------------------------------
azul "3. API local (127.0.0.1:$PORTA_APP)"
SAIDA_LOCAL="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 \
  "http://127.0.0.1:$PORTA_APP/health" 2>/dev/null)"
if [[ "$SAIDA_LOCAL" == "200" ]]; then
  ok "/health responde 200 no Node"
else
  mal "/health no Node devolveu '$SAIDA_LOCAL' (esperado 200)"
fi

# --- 4. O caminho do navegador: HTTPS público ------------------------
# Este é o teste que importa. Node respondendo em 127.0.0.1 não prova
# nada para quem está no pátio: entre o operador e o Node existem DNS,
# certificado e Nginx, e já foi cada um deles em algum momento.
azul "4. Caminho público (https://$DOMINIO_API)"
SAIDA_PUB="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
  "https://$DOMINIO_API/health" 2>/dev/null)"
if [[ "$SAIDA_PUB" == "200" ]]; then
  ok "https://$DOMINIO_API/health responde 200"
else
  mal "https://$DOMINIO_API/health devolveu '$SAIDA_PUB' — o pátio não alcança a API"
  curl -sS -o /dev/null --max-time 10 "https://$DOMINIO_API/health" 2>&1 | sed 's/^/        /'
fi

# Preflight de CORS: se isto falhar, o navegador recusa o login ANTES de
# mandar a senha, e o operador vê "servidor não respondeu" com o servidor
# perfeitamente no ar.
ORIGEM="$(curl -s -i -X OPTIONS --max-time 10 \
  -H "Origin: $DOMINIO_PAINEL" \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type' \
  "https://$DOMINIO_API/auth/login" 2>/dev/null \
  | grep -i '^access-control-allow-origin:' | tr -d '\r')"
if [[ -n "$ORIGEM" ]]; then
  ok "CORS liberado para o painel — $ORIGEM"
else
  mal "o preflight de CORS não devolveu Access-Control-Allow-Origin para $DOMINIO_PAINEL"
fi

# --- 5. Certificado --------------------------------------------------
azul "5. Certificado HTTPS"
CERT="/etc/letsencrypt/live/$DOMINIO_API/cert.pem"
if [[ -f "$CERT" ]]; then
  FIM="$(openssl x509 -enddate -noout -in "$CERT" 2>/dev/null | cut -d= -f2)"
  FIM_S="$(date -d "$FIM" +%s 2>/dev/null || echo 0)"
  DIAS=$(( (FIM_S - $(date +%s)) / 86400 ))
  if [[ "$DIAS" -gt 10 ]]; then ok "vence em $DIAS dias ($FIM)"
  else mal "vence em $DIAS dias ($FIM) — renove agora: certbot renew"; fi
else
  mal "não achei o certificado em $CERT"
fi

# --- 6. Operadores cadastrados ---------------------------------------
# Sem senha, sem hash: só nome, e-mail, setor e ativo. A pergunta que
# isto responde é "o usuário existe e está ativo?".
azul "6. Operadores"
if [[ -d "$APP_DIR" ]]; then
  sudo -u postgres psql -d "$DB_NAME" -P pager=off -c \
    "select nome, email, setor, case when ativo then 'sim' else 'NÃO' end as ativo
       from operadores order by setor, nome;" 2>&1 | sed 's/^/   /'
else
  mal "não achei $APP_DIR"
fi

# --- 7. O que os logs dizem ------------------------------------------
azul "7. Últimas horas de log"
JANELA="${JANELA:-6 hours ago}"

ERROS_5XX="$(journalctl -u embarque-suinco --since "$JANELA" --no-pager 2>/dev/null \
  | grep -ciE '"status":5[0-9][0-9]|Error|ECONNREFUSED' )"
if [[ "${ERROS_5XX:-0}" -gt 0 ]]; then
  mal "$ERROS_5XX linha(s) de erro no serviço desde '$JANELA' — amostra:"
  journalctl -u embarque-suinco --since "$JANELA" --no-pager 2>/dev/null \
    | grep -iE '"status":5[0-9][0-9]|Error|ECONNREFUSED' | tail -8 | sed 's/^/        /'
else
  ok "nenhum erro de servidor registrado desde '$JANELA'"
fi

# 429 é a causa mais traiçoeira: o pátio inteiro sai pelo mesmo IP, então
# uma troca de turno pode estourar o limite e barrar quem digitou certo.
BLOQUEIOS="$(journalctl -u embarque-suinco --since "$JANELA" --no-pager 2>/dev/null \
  | grep -c '429' )"
if [[ "${BLOQUEIOS:-0}" -gt 0 ]]; then
  aviso "$BLOQUEIOS resposta(s) 429 (limite de tentativas) desde '$JANELA'"
  info "o painel mostra isso como [LIMITE]. O limite é por IP, e o pátio compartilha o IP."
else
  ok "nenhum bloqueio por excesso de tentativas"
fi

# Os dois limites vivem só no .env — sem isto, "qual valor está valendo
# agora" só se responde abrindo o arquivo na mão. Mostrado aqui porque foi
# exatamente essa pergunta, sem resposta rápida, que custou tempo no
# incidente de 08/08/2026.
RL_GERAL="$(grep -E '^RATE_LIMIT=' "$APP_DIR/.env" 2>/dev/null | cut -d= -f2)"
RL_LOGIN="$(grep -E '^RATE_LIMIT_LOGIN=' "$APP_DIR/.env" 2>/dev/null | cut -d= -f2)"
info "limite geral (RATE_LIMIT): ${RL_GERAL:-300 (padrão, não definido no .env)} por minuto/IP"
info "limite de login (RATE_LIMIT_LOGIN): ${RL_LOGIN:-30 (padrão, não definido no .env)} por minuto/IP"

# Login recusado por senha é 401 — não é falha de servidor, mas explica
# um relato de "não consigo entrar" que não tem nada a ver com rede.
RECUSAS="$(journalctl -u embarque-suinco --since "$JANELA" --no-pager 2>/dev/null \
  | grep -c 'POST /auth/login.*401' )"
[[ "${RECUSAS:-0}" -gt 0 ]] && info "$RECUSAS tentativa(s) de login com senha errada desde '$JANELA'"

# `grep -c` e `curl -w` SAEM COM ERRO E IMPRIMEM AO MESMO TEMPO.
#
# Foi o que quebrou o diagnóstico em 22/08/2026, com esta mensagem no
# terminal do gestor:
#
#     diagnostico.sh: line 189: [[: 0 0: syntax error in expression
#
# `grep -c` imprime "0" e sai com código 1 quando não acha nada — "não
# achei" é erro para o grep. Aí o `|| echo 0` dispara EM CIMA de um zero
# que já foi impresso, a variável vira "0 0", e a comparação numérica
# quebra. O mesmo vale para `curl -w '%{http_code}'`, que imprime "000" e
# sai com erro quando não conecta.
#
# A saída é `|| true` (que não imprime nada) e o valor padrão aplicado na
# expansão, não no comando.
NGINX_5XX="$(grep -c ' 50[0-9] ' /var/log/nginx/error.log 2>/dev/null || true)"
[[ "${NGINX_5XX:-0}" -gt 0 ]] && aviso "$NGINX_5XX erro(s) 5xx no log do Nginx"

# --- 8. Versão publicada ---------------------------------------------
azul "8. Versão no servidor"
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" log -1 --format='   %h  %ad  %s' --date=format:'%d/%m %H:%M' 2>/dev/null
else
  info "código copiado (sem .git em $APP_DIR) — versão vem do repositório de origem"
fi

# --- Veredito --------------------------------------------------------
azul "Resultado"
if [[ ${#PROBLEMAS[@]} -eq 0 ]]; then
  printf '   \033[0;32mO servidor está saudável.\033[0m\n'
  echo
  echo '   Se mesmo assim alguém não entra, o problema está no aparelho ou na'
  echo '   rede da pessoa. Peça o código entre colchetes que aparece na tela:'
  echo '     [SENHA]    e-mail ou senha errados — o servidor recebeu e recusou'
  echo '     [LIMITE]   muitas tentativas no mesmo minuto, do mesmo IP'
  echo '     [REDE]     o aparelho não alcança a API — Wi-Fi/dados da pessoa'
  echo '     [TEMPO]    a API demorou demais — internet ruim no aparelho'
  echo '     [BLOQUEIO] a API respondeu mas recusou a origem — CORS/servidor'
  echo '     [HTTP5xx]  erro dentro do servidor — rode este diagnóstico de novo'
else
  printf '   \033[0;31m%d problema(s) encontrado(s):\033[0m\n' "${#PROBLEMAS[@]}"
  for p in "${PROBLEMAS[@]}"; do echo "     - $p"; done
fi
echo
