#!/usr/bin/env bash
# =====================================================================
# O PASSO A PASSO COMPLETO — num comando só
# ---------------------------------------------------------------------
# Pedido do Luis em 26/08/2026: "faca o passo a passo até completar tudo
# que é necessário no nosso sistema".
#
#     ssh root@2.25.95.253
#     bash /opt/suinco-src/entregaveis/suinco_logistica/backend/atualizar_tudo.sh
#
# O QUE ELE FAZ, na ordem:
#   1. atualizar.sh — puxa o código, aplica as migrações pendentes, gera as
#      chaves do aviso no celular se ainda não existirem, reinstala o que
#      mudou, reinicia o serviço e roda o diagnóstico;
#   2. prova que o backup restaura de verdade, num banco descartável;
#   3. imprime um bloco pronto para mandar de volta.
#
# O PASSO QUE APAGAVA LINHA DA MONTAGEM SAIU (30/09/2026). Ele tratava
# "mesma rota e mesmo destino no mesmo dia" como duplicata — e o modelo da
# semana do dono tem, de propósito, duas cargas iguais em vários dias
# (quarta: duas Patos de Minas e duas São Gotardo). Na rodada de 30/09 ele
# propôs apagar a SEGUNDA carga de Patos de Minas e a de São Gotardo do
# próprio dia. Nada foi apagado. Decisão do dono: "não é minha intenção
# apagar destino nenhum". Travado por test_atualizar_tudo_nao_apaga_montagem.
#
# NADA AQUI APAGA DADO. O passo 2 só lê a produção.
# =====================================================================

set -uo pipefail

SRC="${SRC:-/opt/suinco-src}"
BASE="entregaveis/suinco_logistica/backend"
LOG="/tmp/suinco-passo-a-passo-$(date +%Y%m%d-%H%M%S).log"

azul()  { printf '\n\033[1;36m%s\033[0m\n' "== $*"; }
ok()    { printf '   \033[0;32mok\033[0m   %s\n' "$*"; }
falha() { printf '   \033[0;31mX\033[0m    %s\n' "$*"; }
aviso() { printf '   \033[0;33m!\033[0m    %s\n' "$*"; }

[[ $EUID -eq 0 ]] || { echo "precisa ser root. Entre como root e rode: bash $0"; exit 1; }

# Ocorrência #97: a versão que roda é a que acabou de ser baixada, não a
# que estava no disco. Ver scripts/codigo_novo_primeiro.sh.
source "$SRC/$BASE/scripts/codigo_novo_primeiro.sh"
codigo_novo_primeiro "$BASE/atualizar_tudo.sh" "$@"

# COMO VIRAR O USUÁRIO postgres, nesta máquina.
#
# O VPS da Suinco NÃO tem sudo instalado — descoberto em 26/08/2026, com o
# dono parado no terminal lendo "command 'sudo' from deb sudo... Try: apt
# install". Escrever `sudo -u postgres` num script que só roda como root é
# depender de um pacote que ninguém prometeu que existe.
#
# `su` vem no sistema base e sempre esteve lá — o instalar.sh já usava só
# ele. Aqui a função tenta o su e cai no sudo se algum dia rodar numa
# máquina onde o postgres não aceite su. Uma função, um lugar para consertar.
como_postgres() {
  if su -s /bin/sh postgres -c 'true' 2>/dev/null; then
    su -s /bin/sh postgres -c "$1"
  elif command -v sudo >/dev/null 2>&1; then
    sudo -u postgres sh -c "$1"
  else
    echo "não consegui virar o usuário postgres (nem su nem sudo)" >&2
    return 1
  fi
}

# Consulta de uma linha só, com o SQL vindo pela entrada padrão.
#
# Escrever a consulta INLINE dentro de `su -c "psql -c \"SELECT...\""` é
# empilhar três níveis de aspas, e foi exatamente onde este script quebrou na
# primeira escrita. Com arquivo temporário não há aspa nenhuma para escapar.
consulta() {
  local arq; arq="$(mktemp)"
  cat > "$arq"
  chmod 644 "$arq"          # o usuário postgres precisa conseguir ler
  como_postgres "psql -d embarque_suinco -tA -f '$arq'" 2>/dev/null
  rm -f "$arq"
}


exec > >(tee -a "$LOG") 2>&1
echo "Log completo desta execução: $LOG"

PROBLEMAS=()

# ---------------------------------------------------------------------
azul "PASSO 1 de 2 — código, migrações e reinício"
if bash "$SRC/$BASE/atualizar.sh"; then
  ok "servidor atualizado"
else
  falha "o atualizar.sh reclamou — leia o bloco acima antes de seguir"
  PROBLEMAS+=("atualizacao")
fi

# ---------------------------------------------------------------------
azul "PASSO 2 de 2 — o backup restaura mesmo?"
TESTE="$SRC/$BASE/scripts/testar_restauracao_backup.sh"
if [[ ! -f "$TESTE" ]]; then
  aviso "não achei $TESTE — pulei"
else
  if bash "$TESTE"; then
    ok "backup conferido"
  else
    falha "o teste de backup encontrou problema — leia o bloco acima"
    PROBLEMAS+=("backup")
  fi
fi

# ---------------------------------------------------------------------
azul "RESUMO"
COMMIT="$(cd "$SRC" && git rev-parse --short HEAD 2>/dev/null || echo '?')"
ATIVO="$(systemctl is-active embarque-suinco 2>/dev/null || echo desconhecido)"
SAUDE="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/health 2>/dev/null || true)"
MIG="$(consulta <<'SQL' || true
SELECT arquivo FROM _migrations ORDER BY arquivo DESC LIMIT 1
SQL
)"
[[ -n "$MIG" ]] || MIG='não consegui ler'

AVISOS="$(grep -qE '^VAPID_PRIVADA=.+' /opt/embarque-suinco/.env 2>/dev/null \
          && echo 'ligado' || echo 'DESLIGADO')"

# Os vigias do servidor (02/10/2026): quantos estão bem e quais não estão.
VIGIAS="$(consulta <<'SQL' || true
SELECT count(*) FILTER (WHERE ok) || ' ok, ' || count(*) FILTER (WHERE NOT ok) || ' com problema'
       || COALESCE(' (' || string_agg(verificacao, ', ') FILTER (WHERE NOT ok) || ')', '')
  FROM vigia_registros
SQL
)"
[[ -n "$VIGIAS" ]] || VIGIAS='não consegui ler'


echo
echo "--------- COPIE DAQUI ---------"
echo "commit no servidor  : $COMMIT"
echo "serviço             : $ATIVO"
echo "/health local       : ${SAUDE:-000}"
echo "última migração     : $MIG"
echo "aviso no celular    : $AVISOS"
echo "vigias              : $VIGIAS"
echo "node no servidor    : $(node -v 2>/dev/null || echo '?')"
echo "problemas nesta rodada : ${PROBLEMAS[*]:-nenhum}"
echo "-------- ATÉ AQUI -------------"
echo

if [[ ${#PROBLEMAS[@]} -eq 0 ]]; then
  ok "tudo feito. Mande o bloco acima."
  exit 0
fi
falha "terminou com ${#PROBLEMAS[@]} ponto(s) para olhar: ${PROBLEMAS[*]}"
echo "     O log inteiro está em $LOG"
exit 1
