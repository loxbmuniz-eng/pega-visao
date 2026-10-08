#!/usr/bin/env bash
# =====================================================================
# GRAVAR A SENHA DA ABA USUÁRIOS (08/10/2026, pedido do dono)
# ---------------------------------------------------------------------
# A parte de gerenciar usuários do painel pede uma senha, e quem confere é
# o servidor. A senha NÃO fica no código (o painel é público) nem no .env:
# o .env guarda só o hash dela (bcrypt, em base64). Este script é o caminho
# em vez de "abra o .env num editor e cole" — o .env guarda também a senha
# do banco e a chave do login, e uma linha perdida e o servidor não sobe.
#
# O QUE ELE FAZ, na ordem:
#   1. pede a senha DUAS vezes, sem mostrar o que se digita; mínimo de 8
#      caracteres; as duas têm que ser iguais — senão nada é gravado;
#   2. guarda uma cópia do .env como está (.env.antes-da-senha-usuarios,
#      mesmo dono e mesma permissão);
#   3. grava SÓ a linha SENHA_USUARIOS_HASH (troca se já existir); nenhuma
#      outra linha do .env muda;
#   4. reinicia o serviço e espera o /health dizer travaUsuarios: ligada;
#   5. se o servidor NÃO voltar, devolve o .env da cópia, reinicia de novo
#      e diz isso — o pátio não fica parado por causa de uma senha.
#
# O QUE ELE NÃO FAZ: não mexe no banco, no código, no Nginx nem no
# firewall. Não mostra a senha, não manda para lugar nenhum.
#
# No servidor, um comando por linha:
#     ssh root@2.25.95.253
#     bash /opt/suinco-src/entregaveis/suinco_logistica/backend/scripts/gravar_senha_usuarios.sh
#
# Para TIRAR a senha (a aba volta a abrir sem ela):
#     bash .../scripts/gravar_senha_usuarios.sh desligar
# =====================================================================

set -uo pipefail

ENV_FILE="${ENV_FILE:-/opt/embarque-suinco/.env}"
APP_DIR="${APP_DIR:-/opt/embarque-suinco}"
SAUDE_URL="${SAUDE_URL:-http://127.0.0.1:3000/health}"
REINICIAR="${REINICIAR:-systemctl restart embarque-suinco}"
ESPERA_S="${ESPERA_S:-30}"
COPIA="$ENV_FILE.antes-da-senha-usuarios"
MINIMO=8

ok()    { printf '   \033[0;32mok\033[0m   %s\n' "$*"; }
falha() { printf '   \033[0;31mX\033[0m    %s\n' "$*"; }

[[ -f "$ENV_FILE" ]] || { falha "não achei $ENV_FILE — o servidor está instalado?"; exit 1; }
[[ -w "$ENV_FILE" ]] || { falha "não consigo gravar em $ENV_FILE — entre como root"; exit 1; }

# 1. a senha, duas vezes, escondida
HASH=''
if [[ "${1:-}" == desligar ]]; then
  ESPERADO='desligada'
else
  ESPERADO='ligada'
  while true; do
    printf '\nDigite a senha da aba Usuários (não aparece na tela) e tecle Enter: ' >&2
    IFS= read -rs SENHA || SENHA=''
    printf '\nDigite de novo, para conferir: ' >&2
    IFS= read -rs SENHA2 || SENHA2=''
    echo >&2
    if (( ${#SENHA} < MINIMO )); then
      falha "a senha precisa de pelo menos $MINIMO caracteres. Nada foi gravado — tente de novo." >&2
    elif [[ "$SENHA" != "$SENHA2" ]]; then
      falha "as duas não são iguais. Nada foi gravado — tente de novo." >&2
    else
      break
    fi
    [[ -t 0 ]] || { unset SENHA SENHA2; exit 1; }   # sem teclado (teste): não fica pedindo para sempre
  done
  HASH="$(printf '%s' "$SENHA" | (cd "$APP_DIR" && node scripts/hash_da_senha.mjs))"
  unset SENHA SENHA2
  [[ -n "$HASH" ]] || { falha "não consegui gerar o hash da senha — nada foi gravado"; exit 1; }
fi

# 2. a cópia, com o mesmo dono e a mesma permissão do original
cp -p "$ENV_FILE" "$COPIA" || { falha "não consegui guardar a cópia — nada foi gravado"; exit 1; }
ok "cópia do .env guardada em $COPIA"

# 3. só a linha da senha muda
NOVO="$(mktemp "$ENV_FILE.novo.XXXXXX")"
grep -vE '^SENHA_USUARIOS_HASH=' "$ENV_FILE" > "$NOVO"
# o arquivo pode não terminar em quebra de linha: sem isto, o hash grudaria na última linha
[[ -s "$NOVO" && -n "$(tail -c1 "$NOVO")" ]] && echo >> "$NOVO"
[[ -n "$HASH" ]] && echo "SENHA_USUARIOS_HASH=$HASH" >> "$NOVO"
chown --reference="$ENV_FILE" "$NOVO" 2>/dev/null || true
chmod --reference="$ENV_FILE" "$NOVO"
mv "$NOVO" "$ENV_FILE"
if [[ -n "$HASH" ]]; then ok "senha gravada no .env, só o hash (as outras linhas não mudaram)"
else ok "senha tirada do .env (as outras linhas não mudaram)"; fi

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
  ok "servidor de pé"
  if [[ "$CORPO" != *'"travaUsuarios"'* ]]; then
    falha "este servidor ainda não tem o código da senha: rode o atualizar_tudo.sh — a senha já ficou gravada e passa a valer nele"
    exit 1
  fi
  ESTADO="$(printf '%s' "$CORPO" | sed -n 's/.*"travaUsuarios":"\([a-z]*\)".*/\1/p')"
  echo
  echo "--------- COPIE DAQUI ---------"
  echo "trava da aba Usuários: ${ESTADO:-?}"
  echo "-------- ATÉ AQUI -------------"
  [[ "$ESTADO" == "$ESPERADO" ]] && exit 0
  falha "o servidor diz '${ESTADO:-?}' e devia dizer '$ESPERADO' — mande esta tela"
  exit 1
fi

# 5. não voltou: desfaz
falha "o servidor não respondeu em ${ESPERA_S}s — devolvendo o .env como estava"
cp -p "$COPIA" "$ENV_FILE"
$REINICIAR
if esperar_saude >/dev/null; then
  ok "servidor de pé de novo, com o .env de antes (a senha como estava)"
else
  falha "o servidor continua sem responder — mande esta tela"
fi
exit 1
