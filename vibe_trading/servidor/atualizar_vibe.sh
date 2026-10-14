#!/usr/bin/env bash
# =====================================================================
# VIBE TRADING — atualizacao diaria do vigia
# ---------------------------------------------------------------------
# Roda como o usuario vibe, NUNCA como administrador: o codigo que vem do
# repositorio nao ganha poder sobre o servidor (onde tambem roda o Embarque
# Suinco). Busca a versao nova, roda a bateria inteira numa pasta a parte e so
# troca se ela passar. Para trocar, encerra o proprio vigia; o systemd religa
# ja na versao nova (Restart=always). Se a bateria reprovar, nada muda e o
# Telegram avisa.
# =====================================================================

set -Eeuo pipefail

VIBE_DIR="${VIBE_DIR:-/opt/vibe}"
RAMO="${RAMO:-main}"
APP="$VIBE_DIR/app"
VENV="$VIBE_DIR/venv"
PROVA="$VIBE_DIR/prova"

[[ "$(id -u)" -ne 0 ]] || { echo "rode como o usuario do vigia, nao como administrador" >&2; exit 1; }

avisar() {
  "$VENV/bin/python" -c 'import sys; sys.path.insert(0, sys.argv[1]); import vigia; vigia.telegram(vigia.carregar_segredos(), sys.argv[2])' \
    "$APP" "$1" >/dev/null 2>&1 || true
}
# Parar no meio nunca e silencioso: diz a linha, avisa no Telegram e limpa a prova.
# O vigia segue na versao que ja rodava (nada foi trocado).
trap 'echo "atualizacao parou na linha $LINENO (o vigia segue na versao atual)" >&2; avisar "Atualizacao do vigia PAROU no meio (linha $LINENO). O vigia segue na versao atual."; rm -rf "$PROVA"' ERR

git -C "$APP" fetch -q origin "$RAMO"
atual="$(git -C "$APP" rev-parse HEAD)"
novo="$(git -C "$APP" rev-parse "origin/$RAMO")"
if [[ "$atual" == "$novo" ]]; then
  echo "sem versão nova (${atual:0:7})"
  exit 0
fi

rm -rf "$PROVA"
mkdir -p "$PROVA"
git -C "$APP" archive "origin/$RAMO" | tar -x -C "$PROVA"
"$VENV/bin/pip" install -q --disable-pip-version-check -r "$PROVA/servidor/requisitos.txt"

# cada versao testada guarda o proprio registro (os 10 mais recentes): uma recusa
# nunca perde a prova do motivo
REGISTRO="$VIBE_DIR/bateria_${novo:0:7}.log"
# (find, e nao ls: sem registro nenhum ainda, ls devolve erro e, com pipefail, o
# script morria calado antes da bateria)
find "$VIBE_DIR" -maxdepth 1 -name 'bateria_*.log' -printf '%T@ %p\n' | sort -rn | tail -n +10 | cut -d' ' -f2- | xargs -r rm -f
# teto de 2 horas: uma versao que trava (laco infinito) e recusada, nao prende a
# atualizacao para sempre (no servidor a bateria leva uns 10 minutos)
if VIBE_SERVIDOR=1 timeout 2h nice -n 15 "$VENV/bin/python" "$PROVA/testes/test_motor.py" > "$REGISTRO" 2>&1; then
  cp "$REGISTRO" "$VIBE_DIR/ultima_bateria.log"
  git -C "$APP" merge -q --ff-only "origin/$RAMO"
  # o systemd religa o vigia (Restart=always) ja na versao nova
  pkill -u "$(id -u)" -f "$APP/vigia.py" || true
  echo "atualizado de ${atual:0:7} para ${novo:0:7}: bateria verde"
  avisar "Vigia atualizado (${novo:0:7}): bateria verde no servidor. $(git -C "$APP" log -1 --format=%s)"
else
  codigo=$?
  motivo="a bateria reprovou"
  [[ $codigo -eq 124 ]] && motivo="a bateria passou de 2 horas (travou)"
  cp "$REGISTRO" "$VIBE_DIR/ultima_bateria.log"
  echo "versão ${novo:0:7} RECUSADA: $motivo (veja $REGISTRO)"
  avisar "Atualização ${novo:0:7} RECUSADA: $motivo no servidor. O vigia segue na versão ${atual:0:7}."
fi
rm -rf "$PROVA"
