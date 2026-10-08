#!/usr/bin/env bash
# =====================================================================
# LIGAR O AVISO DE ERRO AO SENTRY (08/10/2026, decisão 27)
# ---------------------------------------------------------------------
# O código do aviso de erro já vai com o atualizar_tudo.sh, DESLIGADO. Ele
# só liga com a chave (DSN) do Sentry no .env do servidor — e o .env guarda
# também a senha do banco e a chave do login: uma linha apagada sem querer
# num editor e o servidor não sobe. Por isso este script, em vez de "abra o
# .env e cole":
#
# O QUE ELE FAZ, na ordem:
#   1. pede a chave do projeto suinco-servidor (e, se quiser, a do
#      suinco-painel) e CONFERE o formato — chave torta não é gravada;
#   2. guarda uma cópia do .env como está (.env.antes-do-sentry, mesmo dono
#      e mesma permissão);
#   3. grava SÓ as linhas SENTRY_DSN e SENTRY_DSN_PAINEL (troca se já
#      existirem); nenhuma outra linha do .env muda;
#   4. reinicia o serviço e espera o /health responder;
#   5. se o servidor NÃO voltar, devolve o .env da cópia, reinicia de novo
#      e diz isso — o pátio não fica parado por causa de um aviso de erro.
#
# O QUE ELE NÃO FAZ: não mexe no banco, no código, no Nginx nem no
# firewall. Não manda a chave para lugar nenhum além do .env.
#
# ONDE ACHAR A CHAVE: sentry.io → Settings → Projects → suinco-servidor →
# Client Keys (DSN) → copiar o DSN. Para o painel, o mesmo caminho no
# projeto suinco-painel.
#
# COMO RODAR, no servidor, DEPOIS do atualizar_tudo.sh:
#     ssh root@2.25.95.253
#     bash /opt/suinco-src/entregaveis/suinco_logistica/backend/scripts/ligar_sentry.sh
#
# Para DESLIGAR: rode de novo e responda "desligar" no lugar da chave.
# =====================================================================

set -uo pipefail

ENV_FILE="${ENV_FILE:-/opt/embarque-suinco/.env}"
SAUDE_URL="${SAUDE_URL:-http://127.0.0.1:3000/health}"
REINICIAR="${REINICIAR:-systemctl restart embarque-suinco}"
ESPERA_S="${ESPERA_S:-30}"
COPIA="$ENV_FILE.antes-do-sentry"

ok()    { printf '   \033[0;32mok\033[0m   %s\n' "$*"; }
falha() { printf '   \033[0;31mX\033[0m    %s\n' "$*"; }

# https://<chave>@<host>[:porta][/caminho]/<número do projeto>
FORMATO='^https://[A-Za-z0-9]+@[A-Za-z0-9.-]+(:[0-9]+)?(/[A-Za-z0-9._-]+)*/[0-9]+$'

[[ -f "$ENV_FILE" ]] || { falha "não achei $ENV_FILE — o servidor está instalado?"; exit 1; }
[[ -w "$ENV_FILE" ]] || { falha "não consigo gravar em $ENV_FILE — entre como root"; exit 1; }

pedir() {   # $1 = projeto, $2 = obrigatório (sim/não). Devolve a chave, "desligar" ou vazio.
  local resposta
  while true; do
    if [[ "$2" == sim ]]; then
      printf '\nCole o DSN do projeto %s e tecle Enter\n(ou escreva desligar): ' "$1" >&2
    else
      printf '\nCole o DSN do projeto %s e tecle Enter\n(Enter vazio = os erros da tela vão para o suinco-servidor): ' "$1" >&2
    fi
    IFS= read -r resposta || resposta=''
    resposta="$(printf '%s' "$resposta" | tr -d '[:space:]')"
    if [[ -z "$resposta" && "$2" != sim ]]; then echo ''; return 0; fi
    if [[ "$resposta" == desligar ]]; then echo desligar; return 0; fi
    if [[ "$resposta" =~ $FORMATO ]]; then echo "$resposta"; return 0; fi
    falha "isso não tem a forma de um DSN (https://chave@endereço/número). Nada foi gravado — tente de novo." >&2
  done
}

SERVIDOR="$(pedir suinco-servidor sim)"
PAINEL=''
[[ "$SERVIDOR" != desligar ]] && PAINEL="$(pedir suinco-painel não)"

# 2. a cópia, com o mesmo dono e a mesma permissão do original
cp -p "$ENV_FILE" "$COPIA" || { falha "não consegui guardar a cópia — nada foi gravado"; exit 1; }
ok "cópia do .env guardada em $COPIA"

# 3. só as duas linhas do Sentry mudam
NOVO="$(mktemp "$ENV_FILE.novo.XXXXXX")"
grep -vE '^SENTRY_DSN(_PAINEL)?=' "$ENV_FILE" > "$NOVO"
# o arquivo pode não terminar em quebra de linha: sem isto, a chave grudaria na última linha
[[ -s "$NOVO" && -n "$(tail -c1 "$NOVO")" ]] && echo >> "$NOVO"
if [[ "$SERVIDOR" != desligar ]]; then
  echo "SENTRY_DSN=$SERVIDOR" >> "$NOVO"
  [[ -n "$PAINEL" && "$PAINEL" != desligar ]] && echo "SENTRY_DSN_PAINEL=$PAINEL" >> "$NOVO"
fi
chown --reference="$ENV_FILE" "$NOVO" 2>/dev/null || true
chmod --reference="$ENV_FILE" "$NOVO"
mv "$NOVO" "$ENV_FILE"
ok "chave gravada no .env (as outras linhas não mudaram)"

# 4. reiniciar e conferir
esperar_saude() {
  local i corpo
  for ((i = 0; i < ESPERA_S; i++)); do
    corpo="$(curl -s -m 3 "$SAUDE_URL" 2>/dev/null || true)"
    if [[ "$corpo" == *'"ok":true'* ]]; then echo "$corpo"; return 0; fi
    sleep 1
  done
  return 1
}

$REINICIAR
if CORPO="$(esperar_saude)"; then
  SERV="desligado"; PAIN="desligado"
  [[ "$CORPO" == *'"servidor":true'* ]] && SERV="ligado"
  [[ "$CORPO" == *'"painel":true'* ]] && PAIN="ligado"
  ok "servidor de pé"
  if [[ "$CORPO" != *'"sentry"'* ]]; then
    falha "este servidor ainda não tem o código do Sentry: rode o atualizar_tudo.sh — a chave já ficou gravada e passa a valer nele"
    exit 1
  fi
  echo
  echo "--------- COPIE DAQUI ---------"
  echo "sentry (erros do servidor): $SERV"
  echo "sentry (erros da tela)    : $PAIN"
  echo "-------- ATÉ AQUI -------------"
  exit 0
fi

# 5. não voltou: desfaz
falha "o servidor não respondeu em ${ESPERA_S}s — devolvendo o .env como estava"
cp -p "$COPIA" "$ENV_FILE"
$REINICIAR
if esperar_saude >/dev/null; then
  ok "servidor de pé de novo, com o .env de antes (Sentry como estava)"
else
  falha "o servidor continua sem responder — mande esta tela"
fi
exit 1
